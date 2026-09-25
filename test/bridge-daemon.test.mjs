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
import { createBridgeServer } from "../src/server.mjs";
import { SessionManager } from "../src/session-manager.mjs";
import { FakeClient } from "./helpers/stability-sdk.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const model = "gpt-6-astra";

function stateDirectory(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "codex-ghcp-daemon-test-"));
  fs.chmodSync(base, 0o700);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const env = { GHCP_DAEMON_DIR: base };
  return { env, paths: daemonPaths(env) };
}

function ownedProcess(t) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const exited = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
  });
  return { child, exited };
}

async function fakeBridge(t) {
  const bridge = { pid: process.pid, instanceId: randomUUID(), token: "a".repeat(64) };
  const health = { ok: true, protocol: "responses", pid: bridge.pid, instanceId: bridge.instanceId, preferredModel: model, modelCount: 1 };
  const readiness = { ready: true, state: "ready" }, requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === "/health") res.end(JSON.stringify(health));
    else if (req.headers.authorization === `Bearer ${bridge.token}` && req.url === "/readyz") {
      res.writeHead(readiness.ready === true ? 200 : 503);
      res.end(JSON.stringify(readiness));
    } else if (req.headers.authorization === `Bearer ${bridge.token}` && !readiness.ready) {
      res.writeHead(503); res.end(JSON.stringify({ error: { code: "upstream_unavailable" } }));
    } else if (req.headers.authorization === `Bearer ${bridge.token}`) res.end(JSON.stringify(modelCatalog([{ id: model }])));
    else { res.writeHead(401); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  bridge.port = server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return { bridge, health, readiness, requests };
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
  assert.equal(status.ready, true);
  assert.equal(status.upstreamState, "ready");
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

test("daemon status observes SDK unavailability without requesting catalog recovery", async t => {
  const { env, paths } = stateDirectory(t);
  const { bridge, health, readiness, requests } = await fakeBridge(t);
  health.ready = true;
  Object.assign(readiness, { ready: false, state: "unavailable" });
  writeRegistry(paths, bridge);
  const status = await daemonStatus(env);
  assert.equal(status.running, true);
  assert.equal(status.state, "running");
  assert.equal(status.ready, false);
  assert.equal(status.upstreamState, "unavailable");
  assert.deepEqual(requests, ["/health", "/readyz"]);
});

test("daemon status uses the production readiness route without replacing a disconnected SDK", async t => {
  const { env, paths } = stateDirectory(t), client = new FakeClient();
  let replacements = 0;
  const manager = new SessionManager({ client, clientFactory: () => { replacements++; return new FakeClient(); } });
  t.after(() => manager.stop());
  await manager.start();
  const bridge = { pid: process.pid, instanceId: randomUUID(), token: "a".repeat(64) };
  const server = createBridgeServer({ manager, apiKey: bridge.token, instanceId: bridge.instanceId });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.abortActiveRequests();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  bridge.port = server.address().port;
  writeRegistry(paths, bridge);
  client.ping = async () => { throw new Error("Owned SDK connection closed"); };
  const status = await daemonStatus(env);
  assert.equal(status.running, true);
  assert.equal(status.ready, false);
  assert.equal(status.upstreamState, "unavailable");
  assert.equal(manager.lifecycle.state, "unavailable");
  assert.equal(replacements, 0);
  assert.equal(client.sessions.length, 0);
});

test("daemon status cannot authenticate malformed or contradictory readiness responses", async t => {
  const { env, paths } = stateDirectory(t);
  const { bridge, readiness, requests } = await fakeBridge(t);
  writeRegistry(paths, bridge);
  for (const value of [{ ready: "false", state: "unavailable" }, { ready: false, state: "ready" },
    { ready: true, state: "unavailable" }, { ready: false, state: "unknown" }]) {
    Object.assign(readiness, value);
    const status = await daemonStatus(env);
    assert.equal(status.running, false);
    assert.equal(status.state, "unverified");
    assert.equal(status.ready, undefined);
  }
  assert.ok(!requests.includes("/v1/models"));
});

test("stop authenticates an owned bridge even when its SDK cannot recover", async t => {
  const { env, paths } = stateDirectory(t);
  const { bridge, health, readiness, requests } = await fakeBridge(t);
  const { child, exited } = ownedProcess(t);
  bridge.pid = health.pid = child.pid;
  Object.assign(readiness, { ready: false, state: "unavailable" });
  writeRegistry(paths, bridge);
  assert.deepEqual(await stopDaemon(env), { stopped: true, state: "stopped" });
  await exited;
  assert.equal(child.signalCode, "SIGTERM");
  assert.equal(fs.existsSync(paths.registry), false);
  assert.deepEqual(requests, ["/health", "/readyz"]);
});

test("stop preserves an owned process and registry when readiness authentication fails", async t => {
  const { env, paths } = stateDirectory(t);
  const { bridge, health, readiness } = await fakeBridge(t);
  const { child } = ownedProcess(t);
  bridge.pid = health.pid = child.pid;
  for (const token of [bridge.token, "c".repeat(64)]) {
    Object.assign(readiness, { ready: false, state: "unknown" });
    writeRegistry(paths, { ...bridge, token });
    await assert.rejects(stopDaemon(env));
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    assert.equal(fs.existsSync(paths.registry), true);
  }
});

test("stop refuses a live PID that does not belong to the responding bridge", async (t) => {
  const { env, paths } = stateDirectory(t);
  const { bridge } = await fakeBridge(t);
  const { child } = ownedProcess(t);
  writeRegistry(paths, { ...bridge, pid: child.pid });
  await assert.rejects(stopDaemon(env), /refusing to signal its PID/);
  assert.equal(child.exitCode, null);
  assert.equal(child.signalCode, null);
  assert.equal(fs.existsSync(paths.registry), true);
});
