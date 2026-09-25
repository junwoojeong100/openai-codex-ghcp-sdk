import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stopChildBridge } from "../src/bridge-daemon.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const serverPath = path.join(root, "src/server.mjs");
const launcherPath = path.join(root, "src/launcher.mjs");
const fixture = path.join(root, "test/fixtures/catalog-sdk.mjs");

function childProcess(t, argv, env = {}) {
  const child = spawn(process.execPath, argv, {
    cwd: root, stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, NODE_OPTIONS: `--import=${JSON.stringify(fixture)}`,
      HOST: "127.0.0.1", PORT: "0", GHCP_BRIDGE_PORT: "0", GHCP_MODEL: "gpt-6-astra",
      BRIDGE_API_KEY: "local-shutdown-test", CLEANUP_TIMEOUT_MS: "30", SDK_STARTUP_TIMEOUT_MS: "1000", ...env },
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exited = once(child, "close").then(([code, signal]) => ({ code, signal, stdout, stderr }));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  });
  return { child, exited };
}

async function startedServer(t, mode) {
  const bridge = childProcess(t, [serverPath], { GHCP_TEST_SHUTDOWN: mode });
  const [started] = await once(bridge.child, "message", { signal: AbortSignal.timeout(5000) });
  assert.equal(started.event, "bridge.started");
  const health = await fetch(`http://127.0.0.1:${started.port}/health`, { signal: AbortSignal.timeout(1000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ready, true);
  return bridge;
}

for (const [mode, signal, code] of [["graceful", "SIGTERM", 0], ["forced", "SIGINT", 0],
  ["rejected", "SIGTERM", 1], ["timeout", "SIGINT", 1]]) {
  test(`server signal shutdown reports its actual cleanup outcome (${mode}, ${signal})`, { timeout: 10000 }, async t => {
    const bridge = await startedServer(t, mode);
    bridge.child.kill(signal);
    const result = await bridge.exited;
    assert.equal(result.code, code, result.stderr);
    assert.equal(result.signal, null);
    assert.doesNotMatch(result.stderr, /private-|UnhandledPromiseRejection/);
    const diagnostics = result.stderr.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    assert.equal(diagnostics.some(row => row.event === "bridge.shutdown_failed"), code !== 0);
    if (mode !== "graceful") assert.ok(diagnostics.some(row => row.event === "bridge.upstream_cleanup_failed" && row.operation === "stop"));
    if (code !== 0) assert.ok(diagnostics.some(row => row.event === "bridge.upstream_cleanup_failed" && row.operation === "forceStop"));
  });
}

test("startup failure remains visible when SDK shutdown also fails", { timeout: 10000 }, async t => {
  const bridge = childProcess(t, [serverPath], { GHCP_TEST_SHUTDOWN: "rejected", GHCP_TEST_START_FAILURE: "1" });
  const result = await bridge.exited;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /SDK start failed/);
  assert.match(result.stderr, /bridge.shutdown_failed/);
  assert.doesNotMatch(result.stderr, /private-|UnhandledPromiseRejection/);
});

for (const mode of ["graceful", "forced", "rejected", "timeout"]) {
  test(`launcher preserves bridge cleanup failure after Codex exits successfully (${mode})`, { timeout: 10000 }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-shutdown-cli-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const executable = path.join(directory, "codex");
    fs.writeFileSync(executable, '#!/usr/bin/env node\nif (process.argv.includes("--version")) console.log("codex-cli 0.154.0");\n', { mode: 0o700 });
    const bridge = childProcess(t, [launcherPath], { GHCP_TEST_SHUTDOWN: mode, CODEX_BIN: executable });
    const result = await bridge.exited;
    assert.equal(result.code, ["rejected", "timeout"].includes(mode) ? 1 : 0, result.stderr);
    if (result.code !== 0) assert.match(result.stderr, /bridge did not shut down cleanly/);
    assert.doesNotMatch(result.stderr, /private-/);
  });
}

test("child bridge cleanup checks an already-exited failure", { timeout: 10000 }, async t => {
  const bridge = childProcess(t, ["-e", "process.exit(1)"]);
  await bridge.exited;
  await assert.rejects(stopChildBridge(bridge), /exit code 1/);
});

test("forced process termination is not reported as graceful bridge cleanup", { timeout: 10000 }, async t => {
  const bridge = childProcess(t, ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); process.send("ready");']);
  await once(bridge.child, "message", { signal: AbortSignal.timeout(5000) });
  await assert.rejects(stopChildBridge(bridge, 30), /signal SIGKILL/);
  assert.equal((await bridge.exited).signal, "SIGKILL");
});
