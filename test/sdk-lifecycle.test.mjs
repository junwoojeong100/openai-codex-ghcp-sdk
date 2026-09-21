import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SdkLifecycle } from "../src/sdk-lifecycle.mjs";

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function peer(overrides = {}) {
  return { starts: 0, stops: 0, forced: 0, pings: 0, alive: true,
    async start() { this.starts++; },
    async ping() { this.pings++; if (!this.alive) throw new Error("closed"); return {}; },
    async listModels() { return [{ id: "gpt-6-astra" }]; },
    async stop() { this.stops++; return []; },
    async forceStop() { this.forced++; }, ...overrides };
}
function setup(t, options = {}) {
  const lifecycle = new SdkLifecycle({ client: peer(), timeoutMs: 30, startupTimeoutMs: 100,
    cleanupTimeoutMs: 30, recoveryBackoffMs: 200, ...options });
  t.after(() => lifecycle.stop()); return lifecycle;
}

test("simultaneous failed readiness probes share one recovery despite backoff", async t => {
  const old = peer(), replacement = peer(); let factories = 0, lost = 0;
  const lifecycle = setup(t, { client: old, clientFactory: () => { factories++; return replacement; }, onLost: () => { lost++; } });
  await lifecycle.start(); old.alive = false;
  await Promise.all(Array.from({ length: 20 }, () => lifecycle.ensureReady()));
  assert.equal(factories, 1); assert.equal(lost, 1); assert.equal(old.forced, 1);
  assert.equal(replacement.starts, 1); assert.equal(lifecycle.client, replacement);
  assert.equal(lifecycle.snapshot().ready, true);
});

test("readiness is observational; it reports loss without implicitly reconnecting", async t => {
  let factories = 0; const old = peer();
  const lifecycle = setup(t, { client: old, clientFactory: () => { factories++; return peer(); } });
  await lifecycle.start(); old.alive = false;
  assert.equal((await lifecycle.readiness()).ready, false);
  assert.equal(factories, 0); assert.equal(lifecycle.state, "unavailable");
});

test("one cancelled recovery waiter does not cancel other callers or duplicate startup", async t => {
  const gate = deferred(), entered = deferred(), old = peer();
  const replacement = peer({ async start() { this.starts++; entered.resolve(); await gate.promise; } });
  const lifecycle = setup(t, { client: old, clientFactory: () => replacement });
  await lifecycle.start(); old.alive = false;
  const controller = new AbortController();
  const cancelled = lifecycle.ensureReady(controller.signal), failure = assert.rejects(cancelled, { name: "AbortError" });
  const healthy = lifecycle.ensureReady(); await entered.promise; controller.abort(); await failure;
  gate.resolve(); await healthy; assert.equal(replacement.starts, 1); assert.equal(lifecycle.state, "ready");
});

test("stop during recovery cleanup never creates a replacement", async t => {
  const gate = deferred(), entered = deferred(); let factories = 0;
  const old = peer({ async forceStop() { this.forced++; entered.resolve(); await gate.promise; } });
  const lifecycle = setup(t, { client: old, clientFactory: () => { factories++; return peer(); } });
  await lifecycle.start(); old.alive = false;
  const recovery = lifecycle.ensureReady(), failure = assert.rejects(recovery, { code: "upstream_unavailable" });
  await entered.promise; await lifecycle.stop(); gate.resolve(); await failure;
  assert.equal(factories, 0); assert.equal(lifecycle.state, "stopped");
});

test("stop during startup prevents late publication and cleans only that client", async t => {
  const gate = deferred(), entered = deferred(), ready = [];
  const client = peer({ async start() { this.starts++; entered.resolve(); await gate.promise; } });
  const lifecycle = setup(t, { client, onReady: event => ready.push(event) });
  const start = lifecycle.start(), failure = assert.rejects(start, { code: "upstream_unavailable" });
  await entered.promise; await lifecycle.stop(); gate.resolve(); await failure; await delay(0);
  assert.equal(ready.length, 0); assert.equal(lifecycle.state, "stopped"); assert.ok(client.forced >= 1);
});

test("timed-out late startup cannot replace or stop the next generation", async t => {
  const gate = deferred(), ready = [], old = peer({ async start() { this.starts++; await gate.promise; } });
  const replacement = peer();
  const lifecycle = setup(t, { client: old, startupTimeoutMs: 20, clientFactory: () => replacement, onReady: e => ready.push(e.client) });
  await assert.rejects(lifecycle.start(), { code: "upstream_unavailable" });
  await lifecycle.ensureReady(); gate.resolve(); await delay(10);
  assert.deepEqual(ready, [replacement]); assert.equal(replacement.forced, 0);
  assert.ok(old.forced >= 1); assert.equal(lifecycle.client, replacement);
});

test("failed recovery is bounded and rate-limited, with no model sends", async t => {
  const old = peer(), replacement = peer({ async start() { this.starts++; throw new Error("offline"); } });
  let factories = 0;
  const lifecycle = setup(t, { client: old, clientFactory: () => { factories++; return replacement; } });
  await lifecycle.start(); old.alive = false;
  await assert.rejects(lifecycle.ensureReady(), { code: "upstream_unavailable" });
  await assert.rejects(lifecycle.ensureReady(), { code: "upstream_unavailable" });
  assert.equal(factories, 1); assert.equal(lifecycle.state, "unavailable");
});

test("a factory cannot recycle a previous SDK client", async t => {
  const old = peer(); const lifecycle = setup(t, { client: old, clientFactory: () => old });
  await lifecycle.start(); old.alive = false;
  await assert.rejects(lifecycle.ensureReady(), { code: "upstream_unavailable" });
  assert.equal(old.starts, 1);
});

test("hung pings have a bounded deadline and mark the generation lost once", async t => {
  const old = peer(); let lost = 0;
  const lifecycle = setup(t, { client: old, timeoutMs: 15, onLost: () => { lost++; } });
  await lifecycle.start(); old.ping = () => new Promise(() => {});
  const results = await Promise.all([lifecycle.readiness(), lifecycle.readiness()]);
  assert.ok(results.every(r => !r.ready)); assert.equal(lost, 1);
});
