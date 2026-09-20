import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import lockfile from "proper-lockfile";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(rootDir, "src", "server.mjs");
const shutdownTimeoutMs = 30_000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function daemonPaths(env = process.env) {
  const home = os.homedir();
  const configured = env.GHCP_DAEMON_DIR?.replace(/^~(?=\/|$)/, home);
  const base = path.resolve(configured || (process.platform === "darwin"
    ? path.join(home, "Library", "Caches", "openai-codex-ghcp-sdk")
    : path.join(env.XDG_CACHE_HOME || path.join(home, ".cache"), "openai-codex-ghcp-sdk")));
  return {
    base,
    registry: path.join(base, "bridge.json"),
    log: path.join(base, "bridge.log"),
    lock: path.join(base, "bridge-state"),
  };
}

function checkPrivateEntry(filename, directory = false) {
  const stat = fs.lstatSync(filename);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`Expected a private ${directory ? "directory" : "file"}: ${filename}`);
  }
  if ((typeof process.getuid === "function" && stat.uid !== process.getuid()) || (stat.mode & 0o077)) {
    throw new Error(`Bridge state must be owned by this user and private: ${filename}`);
  }
  return stat;
}

function ensureBase(paths) {
  fs.mkdirSync(paths.base, { recursive: true, mode: 0o700 });
  checkPrivateEntry(paths.base, true);
}

export function readDaemonRegistry(paths = daemonPaths()) {
  if (!fs.existsSync(paths.registry)) return null;
  checkPrivateEntry(paths.base, true);
  if (checkPrivateEntry(paths.registry).size > 16_384) throw new Error("Bridge registry is too large.");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(paths.registry, "utf8"));
  } catch {
    throw new Error("Bridge registry is invalid; refusing to replace it or signal its PID.");
  }
  if (value?.version !== 1 || !Number.isSafeInteger(value.pid) || value.pid < 1 ||
      !Number.isSafeInteger(value.port) || value.port < 1 || value.port > 65_535 ||
      !/^[a-f0-9]{64}$/.test(value.token) || typeof value.instanceId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(value.instanceId) || typeof value.rootDir !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.fingerprint)) {
    throw new Error("Bridge registry is invalid; refusing to replace it or signal its PID.");
  }
  return value;
}

function writeDaemonRegistry(paths, value) {
  const temporary = `${paths.registry}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, paths.registry);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function fingerprint(env, port) {
  const hash = createHash("sha256");
  hash.update(rootDir);
  hash.update(String(port));
  for (const name of ["package-lock.json", ...fs.readdirSync(path.join(rootDir, "src"))
    .filter((entry) => entry.endsWith(".mjs")).sort().map((entry) => `src/${entry}`)]) {
    hash.update(name);
    hash.update(fs.readFileSync(path.join(rootDir, name)));
  }
  const entries = Object.entries(env).filter(([name]) =>
    /^(COPILOT_|MAX_|GH_TOKEN$|GITHUB_TOKEN$|GH_CONFIG_DIR$|HOME$|HTTPS?_PROXY$|NO_PROXY$|LOG_LEVEL$|TURN_TIMEOUT_MS$|CLEANUP_TIMEOUT_MS$|PENDING_TOOL_WAIT_MS$|STATE_IDLE_TTL_MS$)/.test(name));
  hash.update(JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b))));
  return hash.digest("hex");
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export async function bridgeHealth(bridge) {
  try {
    const response = await fetch(`http://127.0.0.1:${bridge.port}/health`, {
      signal: AbortSignal.timeout(1_500),
      redirect: "error",
    });
    const body = response.ok ? await response.json() : null;
    return body?.ok && body.protocol === "responses" && body.instanceId === bridge.instanceId && body.pid === bridge.pid ? body : null;
  } catch {
    return null;
  }
}

export async function bridgeModels(bridge) {
  const response = await fetch(`http://127.0.0.1:${bridge.port}/v1/models`, {
    headers: { authorization: `Bearer ${bridge.token}` },
    signal: AbortSignal.timeout(3_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Bridge model lookup failed (HTTP ${response.status}).`);
  const body = await response.json();
  if (!Array.isArray(body.data)) throw new Error("Invalid bridge model catalog.");
  return body.data;
}

async function requireModel(bridge, model) {
  if (!(await bridgeHealth(bridge))) throw new Error("Could not verify the bridge instance.");
  if (!(await bridgeModels(bridge)).some((entry) => entry.id === model)) {
    throw new Error(`GitHub Copilot model is unavailable: ${model}. Run ./bin/ghcp-models.`);
  }
}

export async function stopChildBridge(bridge, timeoutMs = shutdownTimeoutMs) {
  const child = bridge?.child;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  let timer;
  const exited = await Promise.race([
    bridge.exited.then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await bridge.exited;
  }
}

export async function startBridge({ env = process.env, model, port = 0, background = false, logPath, signal }) {
  if (signal?.aborted) throw new Error("Bridge startup was cancelled.");
  const token = randomBytes(32).toString("hex");
  const instanceId = randomUUID();
  let logFd;
  if (logPath) {
    if (fs.existsSync(logPath)) checkPrivateEntry(logPath);
    logFd = fs.openSync(logPath, fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
  }
  let child;
  try {
    child = fork(serverPath, [], {
      cwd: rootDir,
      env: { ...env, HOST: "127.0.0.1", PORT: String(port), GHCP_MODEL: model, BRIDGE_API_KEY: token, BRIDGE_INSTANCE_ID: instanceId },
      execArgv: [],
      detached: background,
      stdio: ["ignore", logFd ?? "pipe", logFd ?? "pipe", "ipc"],
    });
  } finally {
    if (logFd !== undefined) fs.closeSync(logFd);
  }
  let output = "";
  const rememberOutput = (chunk) => { output = (output + chunk.toString()).slice(-8_192); };
  child.stdout?.on("data", rememberOutput);
  child.stderr?.on("data", rememberOutput);
  const bridge = {
    pid: child.pid, token, instanceId, child,
    exited: new Promise((resolve) => child.once("exit", (code, exitSignal) => resolve({ code, signal: exitSignal }))),
  };
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("Timed out waiting for the GHCP bridge.")), 60_000);
      const onAbort = () => finish(new Error("Bridge startup was cancelled."));
      const onError = (error) => finish(error);
      const onExit = (code) => finish(new Error(`The GHCP bridge exited during startup (code ${code}).`));
      const onMessage = (message) => {
        if (message?.event !== "bridge.started" || message.instanceId !== instanceId) return;
        if (!Number.isSafeInteger(message.port) || message.port < 1 || message.port > 65_535) {
          finish(new Error("The bridge reported an invalid port."));
        } else finish(null, message);
      };
      const finish = (error, message) => {
        clearTimeout(timer);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        child.removeListener("message", onMessage);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve(message);
      };
      child.once("error", onError);
      child.once("exit", onExit);
      child.on("message", onMessage);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    bridge.port = address.port;
    await requireModel(bridge, model);
    if (signal?.aborted) throw new Error("Bridge startup was cancelled.");
    return bridge;
  } catch (error) {
    await stopChildBridge(bridge);
    const detail = output.trim().replaceAll(token, "[local bridge token]");
    throw new Error(`${error.message}${detail ? `\n${detail}` : logPath ? ` See ${logPath}.` : ""}`);
  }
}

async function withRegistryLock(paths, operation) {
  ensureBase(paths);
  const release = await lockfile.lock(paths.lock, {
    realpath: false,
    stale: 120_000,
    update: 15_000,
    retries: { retries: 100, minTimeout: 500, maxTimeout: 500, factor: 1 },
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

function requireCheckout(registry) {
  if (registry.rootDir !== rootDir) {
    throw new Error("This bridge belongs to another checkout. Use that checkout or a different GHCP_DAEMON_DIR.");
  }
}

export async function ensureDaemon({ env = process.env, model, port = 0, signal } = {}) {
  const paths = daemonPaths(env);
  return withRegistryLock(paths, async () => {
    if (signal?.aborted) throw new Error("Bridge startup was cancelled.");
    const expectedFingerprint = fingerprint(env, port);
    const previous = readDaemonRegistry(paths);
    if (previous) {
      requireCheckout(previous);
      if (pidAlive(previous.pid)) {
        await requireModel(previous, model);
        if (previous.fingerprint !== expectedFingerprint) {
          throw new Error("Bridge files or settings changed. Close its Codex sessions, run ./bin/codex-ghcp-stop, and launch again.");
        }
        return previous;
      }
      fs.unlinkSync(paths.registry);
    }
    const bridge = await startBridge({ env, model, port, background: true, logPath: paths.log, signal });
    const registry = {
      version: 1, pid: bridge.pid, port: bridge.port, token: bridge.token,
      instanceId: bridge.instanceId, rootDir, fingerprint: expectedFingerprint,
      startedAt: new Date().toISOString(),
    };
    try {
      writeDaemonRegistry(paths, registry);
      bridge.child.disconnect();
      bridge.child.unref();
      return registry;
    } catch (error) {
      await stopChildBridge(bridge);
      if (readDaemonRegistry(paths)?.instanceId === registry.instanceId) fs.unlinkSync(paths.registry);
      throw error;
    }
  });
}

export async function daemonStatus(env = process.env) {
  const paths = daemonPaths(env);
  const registry = readDaemonRegistry(paths);
  if (!registry) return { running: false, state: "stopped" };
  requireCheckout(registry);
  const health = pidAlive(registry.pid) ? await bridgeHealth(registry) : null;
  let authenticated = false;
  if (health) {
    try { await bridgeModels(registry); authenticated = true; } catch { /* Report unverified state without exposing credentials. */ }
  }
  return {
    running: authenticated,
    state: authenticated ? "running" : pidAlive(registry.pid) ? "unverified" : "stale",
    pid: registry.pid,
    port: registry.port,
    ...(health ? { preferredModel: health.preferredModel, modelCount: health.modelCount } : {}),
    log: paths.log,
  };
}

export async function stopDaemon(env = process.env) {
  const paths = daemonPaths(env);
  if (!fs.existsSync(paths.base)) return { stopped: false, state: "stopped" };
  return withRegistryLock(paths, async () => {
    const registry = readDaemonRegistry(paths);
    if (!registry) return { stopped: false, state: "stopped" };
    requireCheckout(registry);
    if (pidAlive(registry.pid)) {
      if (!(await bridgeHealth(registry))) {
        throw new Error("Cannot verify the bridge instance; refusing to signal its PID.");
      }
      await bridgeModels(registry);
      try { process.kill(registry.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      const deadline = Date.now() + shutdownTimeoutMs;
      while (pidAlive(registry.pid) && Date.now() < deadline) await delay(100);
      if (pidAlive(registry.pid)) throw new Error("Bridge shutdown timed out; its registry was preserved. No unverified PID was killed.");
    }
    fs.unlinkSync(paths.registry);
    return { stopped: true, state: "stopped" };
  });
}

async function main() {
  const command = process.argv[2];
  if (process.argv.length !== 3 || !["status", "stop"].includes(command)) {
    throw new Error("Usage: bridge-daemon.mjs status|stop");
  }
  const result = await (command === "status" ? daemonStatus() : stopDaemon());
  console.log(JSON.stringify(result, null, 2));
  if (result.state === "unverified") process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
