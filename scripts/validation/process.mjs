import assert from "node:assert/strict";
import { spawn } from "node:child_process";

export const asError = (reason, fallback = "Execution interrupted.") => reason instanceof Error
  ? reason : new Error(reason === undefined ? fallback : String(reason));

export function runProcess(command, args, {
  cwd, env, signal, timeoutMs = 240_000, maxBytes = 8 * 1024 * 1024, graceMs = 1_000,
} = {}) {
  for (const value of [timeoutMs, maxBytes, graceMs]) assert.ok(Number.isSafeInteger(value) && value > 0);
  if (signal?.aborted) return Promise.reject(asError(signal.reason));
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, { cwd, env, detached: grouped, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let failure;
    let killTimer;
    let finished = false;
    const kill = (kind) => {
      if (!child.pid || finished) return;
      try {
        if (grouped) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch (error) { if (error.code !== "ESRCH") failure ??= error; }
    };
    const stop = (reason) => {
      if (failure || finished) return;
      failure = asError(reason);
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), graceMs);
    };
    const onAbort = () => stop(signal.reason);
    const timer = setTimeout(() => stop(new Error(`Child process exceeded ${timeoutMs} ms.`)), timeoutMs);
    for (const [stream, append] of [[child.stdout, (text) => { stdout += text; }], [child.stderr, (text) => { stderr += text; }]]) {
      stream.setEncoding("utf8");
      stream.on("data", (text) => {
        bytes += Buffer.byteLength(text);
        if (bytes > maxBytes) stop(new Error(`Child output exceeded ${maxBytes} bytes.`));
        else append(text);
      });
    }
    const clean = () => {
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    // Even a spawn error is followed by close. Keep one settlement path and
    // retain captured output/ownership on all failures.
    child.once("error", (error) => { failure ??= error; });
    child.once("close", (code, exitSignal) => {
      const result = { code, signal: exitSignal, stdout, stderr, pid: child.pid ?? null, terminated: Boolean(failure), closed: true };
      clean();
      if (failure) { failure.processResult = result; reject(failure); }
      else resolve(result);
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
