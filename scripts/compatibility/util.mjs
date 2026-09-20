import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const sha = x => createHash("sha256").update(x).digest("hex");
export const mkdir = p => { fs.mkdirSync(p, { recursive: true, mode: 0o700 }); return p; };
export function writeJson(file, value) {
  mkdir(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temporary, file);
}
export function safeRead(file, limit = 16 * 1024 * 1024) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error(`Invalid evidence file: ${path.basename(file)}`);
  return fs.readFileSync(file);
}
export function scrubber(env = process.env, extra = []) {
  const secrets = [...extra, ...Object.entries(env).filter(([key]) => /(?:TOKEN|KEY|SECRET|PASSWORD|AUTH)/i.test(key)).map(([, value]) => value)]
    .filter(value => typeof value === "string" && value.length > 5).sort((a, b) => b.length - a.length);
  return value => {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    let clean = serialized.replace(/Bearer\s+[^\s"\\]+/gi, "Bearer [REDACTED]").replace(/(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}/g, "[REDACTED]");
    for (const secret of secrets) clean = clean.split(secret).join("[REDACTED]");
    return typeof value === "string" ? clean : JSON.parse(clean);
  };
}
export function tree(root) {
  const files = {};
  let bytes = 0;
  const walk = (dir, prefix = "") => {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === ".git") continue;
      const absolute = path.join(dir, name), relative = prefix + name, info = fs.lstatSync(absolute);
      if (info.isSymbolicLink()) files[relative] = { link: fs.readlinkSync(absolute) };
      else if (info.isDirectory()) walk(absolute, relative + "/");
      else if (info.isFile()) {
        bytes += info.size;
        if (bytes > 1024 * 1024) throw new Error("Fixture exceeds 1 MiB evidence budget");
        const content = fs.readFileSync(absolute);
        files[relative] = { hash: sha(content), base64: content.toString("base64"), mode: info.mode & 0o777 };
      } else throw new Error("Unexpected special file in fixture");
    }
  };
  walk(root); return files;
}
export function implementationHash() {
  const files = [];
  for (const dir of ["src", "scripts/compatibility"]) {
    for (const name of fs.readdirSync(path.join(ROOT, dir)).sort()) if (name.endsWith(".mjs")) files.push(`${dir}/${name}`);
  }
  files.push("scripts/compatibility.mjs", "package.json", "package-lock.json");
  return sha(JSON.stringify(files.map(file => [file, sha(fs.readFileSync(path.join(ROOT, file)))])));
}
export function environment(env, { home, codexHome, tmp, token }) {
  const result = {};
  for (const key of ["PATH", "SHELL", "LANG", "LC_ALL", "SystemRoot", "WINDIR"]) if (env[key]) result[key] = env[key];
  return { ...result, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome, TMPDIR: tmp, TMP: tmp, TEMP: tmp,
    XDG_CONFIG_HOME: path.join(home, ".config"), XDG_CACHE_HOME: path.join(home, ".cache"),
    NO_COLOR: "1", TERM: "dumb", NO_PROXY: "127.0.0.1,localhost,::1", CODEX_GHCP_BRIDGE_TOKEN: token };
}
export function deadline(signal, milliseconds) {
  return AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.floor(milliseconds)))].filter(Boolean));
}
export function bounded(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; signal.removeEventListener("abort", abort); callback(value); };
    const abort = () => finish(reject, signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal.aborted) abort();
  });
}
export function run(command, args, { cwd, env, signal, input, maxBytes = 2 * 1024 * 1024 } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, failure;
    const fail = error => { failure ??= error; child.kill("SIGKILL"); };
    const abort = () => fail(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    for (const [stream, save] of [[child.stdout, s => stdout += s], [child.stderr, s => stderr += s]]) {
      stream.setEncoding("utf8"); stream.on("data", s => { bytes += Buffer.byteLength(s); if (bytes > maxBytes) fail(new Error("Process output limit")); else save(s); });
    }
    child.once("error", fail);
    child.stdin.on("error", error => { if (error.code !== "EPIPE") fail(error); });
    child.once("close", (code, exitSignal) => {
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure); else resolve({ code, signal: exitSignal, stdout, stderr, pid: child.pid });
    });
    child.stdin.end(input);
  });
}
export function statusFor(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timed-out";
  return error?.status === "blocked" ? "blocked" : error?.status === "unsupported" ? "unsupported" : "failed";
}
export class CaseError extends Error {
  constructor(message, status = "blocked", category = "environment") { super(message); this.status = status; this.category = category; }
}
