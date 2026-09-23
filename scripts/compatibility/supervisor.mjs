import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { mkdir, writeJson, scrubber } from "./util.mjs";

const worker = fileURLToPath(new URL("./worker.mjs", import.meta.url));
// macOS returns EPERM, not ESRCH, while an exited group's last members are
// unreaped zombies. Keep treating the group as present until ESRCH.
export function groupExists(pid, kill = process.kill) {
  try { kill(-pid, 0); return true; } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}
export function killOwnedGroup(pid, signal = "SIGKILL", kill = process.kill) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) throw new Error("Invalid owned process group");
  // EPERM means no signalable member remains; callers still wait for ESRCH.
  try { kill(-pid, signal); } catch (error) { if (error.code !== "ESRCH" && error.code !== "EPERM") throw error; }
}
// SIGKILL delivery and process-group disappearance are not synchronous.
// Spend only the remaining case slot (at most 2s) observing our own group.
export async function waitForOwnedGroupExit(pid, milliseconds, {
  probe = groupExists, now = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 1 || !Number.isFinite(milliseconds)) throw new Error("Invalid owned process group wait");
  const deadline = now() + Math.max(0, Math.min(2000, milliseconds));
  while (probe(pid)) {
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleep(Math.min(10, remaining));
  }
  return true;
}

export function workerEnvironment(env = process.env) {
  const result = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "SHELL", "LANG", "LC_ALL", "SystemRoot", "WINDIR", "TMPDIR",
    "COPILOT_HOME", "GITHUB_TOKEN", "GH_TOKEN", "COPILOT_GITHUB_TOKEN", "GITHUB_HOST", "GH_HOST"])
    if (env[key]) result[key] = env[key];
  return result;
}

// Workers, native Codex, SDK subprocesses and native tools inherit this owned
// POSIX process group. No existing daemon discovery, process-name kill or user PID.
export async function supervise(config, { signal, env = process.env, command = process.execPath, workerFile = worker, onGroup, kill = process.kill } = {}) {
  if (process.platform === "win32") throw new Error("The bounded runner currently requires POSIX process-group supervision (macOS/Linux).");
  signal?.throwIfAborted();
  const gracefulShutdownMs = config.gracefulShutdownMs ?? 0;
  if (!Number.isSafeInteger(gracefulShutdownMs) || gracefulShutdownMs < 0 ||
      gracefulShutdownMs > 60000 || gracefulShutdownMs >= config.timeoutMs) throw new Error("Invalid graceful shutdown budget.");
  mkdir(config.directory); mkdir(config.workRoot);
  const configFile = path.join(config.workRoot, "worker-config.json");
  writeJson(configFile, config);
  const started = performance.now(), clean = scrubber(env);
  const child = spawn(command, [workerFile, configFile], {
    cwd: config.workRoot, env: workerEnvironment(env), detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let failure, killed = false, bytes = 0, groupGone = false, escalation;
  const logFile = path.join(config.directory, "worker.log");
  const stop = reason => {
    failure ??= reason;
    if (killed) return;
    killed = true;
    if (child.pid) {
      try { killOwnedGroup(child.pid, gracefulShutdownMs ? "SIGTERM" : "SIGKILL", kill); }
      catch (error) { failure ??= error; }
      if (gracefulShutdownMs) escalation = setTimeout(() => {
        try { killOwnedGroup(child.pid, "SIGKILL", kill); } catch (error) { failure ??= error; }
      }, gracefulShutdownMs);
    }
  };
  const abort = () => stop(signal.reason ?? new Error("Interrupted"));
  // Keep a small parent-side margin so group termination fits inside the case slot.
  const timer = setTimeout(() => stop(Object.assign(new Error("Case wall-clock deadline exceeded"), { name: "TimeoutError" })), Math.max(1, config.timeoutMs - gracefulShutdownMs - 100));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  if (child.pid) onGroup?.(child.pid, true);
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", text => {
      bytes += Buffer.byteLength(text);
      if (bytes > 1024 * 1024) stop(new Error("Worker output budget exceeded"));
      else fs.appendFileSync(logFile, clean(text), { mode: 0o600 });
    });
  }
  const exited = await new Promise(resolve => {
    child.once("error", error => { failure ??= error; });
    child.once("close", (code, exitSignal) => resolve({ code, signal: exitSignal }));
  });
  clearTimeout(timer); clearTimeout(escalation); signal?.removeEventListener("abort", abort);
  // Also remove straggling descendants after a normal worker exit.
  if (child.pid) {
    try {
      if (groupExists(child.pid, kill)) killOwnedGroup(child.pid, "SIGKILL", kill);
      groupGone = await waitForOwnedGroupExit(child.pid, config.timeoutMs - (performance.now() - started), { probe: pid => groupExists(pid, kill) });
    } catch (error) { failure ??= error; }
    onGroup?.(child.pid, false);
  }
  return { ...exited, killed, processGroupGone: groupGone, durationMs: Math.ceil(performance.now() - started),
    error: failure ? { name: failure.name, message: clean(failure.message) } : null };
}
