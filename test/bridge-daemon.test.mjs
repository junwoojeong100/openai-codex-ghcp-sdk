import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bridgeHealth, bridgeModels, daemonPaths, daemonStatus, readDaemonRegistry, stopDaemon } from "../src/bridge-daemon.mjs";
import { modelCatalog } from "../src/model-map.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = "gpt-6-astra";

function stateDirectory(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "codex-ghcp-daemon-test-"));
  fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const env = { GHCP_DAEMON_DIR: base };
  return { env, paths: daemonPaths(env) };
}

async function fakeBridge(t) {
  const bridge = { pid: process.pid, instanceId: randomUUID(), token: "a".repeat(64) };
  const health = { ok: true, protocol: "responses", pid: bridge.pid, instanceId: bridge.instanceId, preferredModel: model, modelCount: 1 };
  const server = http.createServer((req, res) => {
    if (req.url === "/health") res.end(JSON.stringify(health));
    else if (req.headers.authorization === `Bearer ${bridge.token}`) res.end(JSON.stringify(modelCatalog([{ id: model }])));
    else { res.writeHead(401); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  bridge.port = server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { bridge, health };
}

function writeRegistry(paths, bridge) {
  const registry = { version: 1, ...bridge, rootDir, fingerprint: "b".repeat(64) };
  fs.writeFileSync(paths.registry, JSON.stringify(registry), { mode: 0o600 });
  return registry;
}

test("daemon status without a registry does not start a bridge", async (t) => {
  const { env, paths } = stateDirectory(t);
  assert.equal(readDaemonRegistry(paths), null);
  assert.deepEqual(await daemonStatus(env), { running: false, state: "stopped" });
  assert.equal(fs.existsSync(paths.registry), false);
  assert.match(daemonPaths({}).base, /openai-codex-ghcp-sdk$/);
});

test("daemon registries must be valid, private regular files", (t) => {
  const { paths } = stateDirectory(t);
  fs.writeFileSync(paths.registry, "not json", { mode: 0o600 });
  assert.throws(() => readDaemonRegistry(paths), /invalid/);
  fs.writeFileSync(paths.registry, "{}");
  assert.throws(() => readDaemonRegistry(paths), /invalid/);
  fs.chmodSync(paths.registry, 0o644);
  assert.throws(() => readDaemonRegistry(paths), /private/);
  fs.unlinkSync(paths.registry);
  const target = path.join(paths.base, "other.json");
  fs.writeFileSync(target, "{}", { mode: 0o600 });
  fs.symlinkSync(target, paths.registry);
  assert.throws(() => readDaemonRegistry(paths), /private file/);
});

test("health requires matching PID, instance and Responses protocol", async (t) => {
  const { bridge, health } = await fakeBridge(t);
  assert.deepEqual(await bridgeHealth(bridge), health);
  assert.equal(await bridgeHealth({ ...bridge, pid: bridge.pid + 1 }), null);
  assert.equal(await bridgeHealth({ ...bridge, instanceId: randomUUID() }), null);
  health.protocol = "other";
  assert.equal(await bridgeHealth(bridge), null);
});

test("daemon status verifies authentication without returning the stored token", async (t) => {
  const { env, paths } = stateDirectory(t);
  const { bridge, health } = await fakeBridge(t);
  writeRegistry(paths, bridge);
  assert.deepEqual(await bridgeModels(bridge), [{ id: model, object: "model", owned_by: "github-copilot" }]);
  const status = await daemonStatus(env);
  assert.equal(status.running, true);
  assert.equal(status.pid, bridge.pid);
  assert.equal(status.turnWatchdog, null, "older processes must not claim the new watchdog is active");
  assert.equal(JSON.stringify(status).includes(bridge.token), false);
  health.turnWatchdog = { idleTimeoutMs: 90_000, firstProgressTimeoutMs: 180_000, recoveryAttempts: 1, intervalMs: 15_000 };
  assert.deepEqual((await daemonStatus(env)).turnWatchdog, health.turnWatchdog);
  writeRegistry(paths, { ...bridge, token: "c".repeat(64) });
  const unverified = await daemonStatus(env);
  assert.equal(unverified.running, false);
  assert.equal(unverified.state, "unverified");
});

test("stop refuses a live PID that does not belong to the responding bridge", async (t) => {
  const { env, paths } = stateDirectory(t);
  const { bridge } = await fakeBridge(t);
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
  });
  writeRegistry(paths, { ...bridge, pid: child.pid });
  await assert.rejects(stopDaemon(env), /refusing to signal its PID/);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  assert.equal(fs.existsSync(paths.registry), true);
});
