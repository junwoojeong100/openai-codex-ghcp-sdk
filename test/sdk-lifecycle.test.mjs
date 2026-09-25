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

for (const mode of ["rejected", "returned-errors", "timeout"]) {
  test(`shutdown diagnoses graceful failure but accepts confirmed force-stop (${mode})`, async () => {
    const diagnostics = [];
    const client = peer({ async stop() {
      this.stops++;
      if (mode === "timeout") return new Promise(() => {});
      if (mode === "returned-errors") return [new Error("private-stop-detail")];
      throw new Error("private-stop-detail");
    } });
    const lifecycle = new SdkLifecycle({ client, cleanupTimeoutMs: 20, onDiagnostic: row => diagnostics.push(row) });
    const first = lifecycle.stop();
    assert.equal(lifecycle.stop(), first);
    await first;
    assert.equal(client.stops, 1);
    assert.equal(client.forced, 1);
    assert.deepEqual(diagnostics, [{ event: "bridge.upstream_cleanup_failed", operation: "stop",
      failureType: mode === "timeout" ? "timeout" : "rpc_error", timeoutMs: 20 }]);
    assert.equal(lifecycle.snapshot().ready, false);
  });
}

for (const mode of ["rejected", "timeout", "missing-method"]) {
  test(`shutdown rejects unconfirmed force-stop and still cleans other owned clients (${mode})`, async () => {
    const diagnostics = [], retired = peer();
    const client = peer({
      async stop() { this.stops++; throw new Error("private-stop-detail"); },
      async forceStop() {
        this.forced++;
        if (mode === "timeout") return new Promise(() => {});
        throw new Error("private-force-detail");
      },
    });
    if (mode === "missing-method") delete client.forceStop;
    const lifecycle = new SdkLifecycle({ client, cleanupTimeoutMs: 20, onDiagnostic: row => diagnostics.push(row) });
    lifecycle.retired.add(retired);
    const stopped = lifecycle.stop();
    assert.equal(lifecycle.stop(), stopped);
    await assert.rejects(stopped, error => {
      assert.equal(error.code, "upstream_cleanup_failed");
      assert.match(error.message, /1 owned Copilot SDK client/);
      assert.doesNotMatch(error.message, /private-/);
      return true;
    });
    assert.equal(client.stops, 1);
    assert.equal(retired.stops, 1);
    assert.equal(retired.forced, 0);
    assert.deepEqual(diagnostics.map(row => [row.operation, row.failureType]),
      [["stop", "rpc_error"], ["forceStop", mode === "timeout" ? "timeout" : "rpc_error"]]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private-/);
    await assert.rejects(lifecycle.stop(), { code: "upstream_cleanup_failed" });
    assert.equal(client.stops, 1);
  });
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

for (const operation of ["start", "ping", "listModels"]) {
  test(`startup timeouts identify the stalled SDK operation without exposing content (${operation})`, async t => {
    const diagnostics = [];
    const client = peer({ [operation]: () => new Promise(() => {}) });
    const lifecycle = setup(t, { client, startupTimeoutMs: 20, onDiagnostic: row => diagnostics.push(row) });
    await assert.rejects(lifecycle.start(), error => {
      assert.equal(error.code, "upstream_unavailable");
      assert.ok(error.message.includes(`SDK ${operation} timed out`));
      return true;
    });
    assert.equal(diagnostics.length, 1);
    const [{ elapsedMs, ...diagnostic }] = diagnostics;
    assert.deepEqual(diagnostic, { event: "bridge.upstream_connect_failed", generation: 1,
      operation, failureType: "timeout", timeoutMs: 20,
      ...(operation === "listModels" ? { catalogFailure: { kind: "deadline", rpcCode: null, statusCode: null, transportCode: null, retryable: true } } : {}) });
    assert.ok(elapsedMs >= 0);
    assert.equal(lifecycle.snapshot().ready, false);
    assert.ok(client.forced >= 1);
  });
}

test("SDK startup diagnostics omit upstream messages, credentials and arbitrary error codes", async t => {
  const diagnostics = [];
  const client = peer({ async listModels() {
    throw Object.assign(new Error("private-input private-credential"), { code: "private-code" });
  } });
  const lifecycle = setup(t, { client, onDiagnostic: row => diagnostics.push(row) });
  await assert.rejects(lifecycle.start(), error => {
    assert.match(error.message, /SDK listModels failed/);
    assert.doesNotMatch(error.message, /private-/);
    return true;
  });
  assert.equal(diagnostics[0].failureType, "rpc_error");
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-/);
});

test("a stalled startup catalog gets one fresh client within the original deadline", async t => {
  const gate = deferred(), ready = [], diagnostics = [];
  const old = peer({ listModels: () => gate.promise }), replacement = peer();
  let factories = 0;
  const lifecycle = setup(t, { client: old, startupTimeoutMs: 120,
    clientFactory: () => { factories++; return replacement; }, onReady: e => ready.push(e.client),
    onDiagnostic: event => diagnostics.push(event) });
  await Promise.all(Array.from({ length: 12 }, () => lifecycle.start()));
  assert.equal(factories, 1);
  assert.equal(old.forced, 1);
  assert.deepEqual(ready, [replacement]);
  assert.equal(replacement.starts, 1);
  assert.equal(lifecycle.snapshot().ready, true);
  const recovering = diagnostics.find(row => row.event === "bridge.upstream_catalog_recovering");
  assert.ok(recovering.remainingMs > 0 && recovering.remainingMs <= 60);
  assert.equal(diagnostics.filter(row => row.event === "bridge.upstream_catalog_recovered").length, 1);
  gate.resolve([{ id: "gpt-6-sol" }]);
  await delay(10);
  assert.deepEqual(ready, [replacement]);
  assert.ok(old.forced >= 2);
  assert.equal(replacement.forced, 0);
});

for (const [label, fields, kind] of [
  ["internal JSON-RPC", { code: -32603 }, "internal_rpc"],
  ["closed JSON-RPC", { code: -32097 }, "transport"],
  ["socket reset", { code: "ECONNRESET" }, "transport"],
  ["nested connection timeout", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }, "transport"],
  ["unavailable server", { data: { statusCode: 503 } }, "server"],
]) {
  test(`read-only catalog recovery handles ${label} once without inference`, async t => {
    const error = Object.assign(new Error("private diagnostics"), fields), diagnostics = [];
    const old = peer({ listModels: async () => { throw error; } }), replacement = peer();
    let factories = 0;
    const lifecycle = setup(t, { client: old, clientFactory: () => { factories++; return replacement; }, onDiagnostic: row => diagnostics.push(row) });
    await lifecycle.start();
    assert.equal(factories, 1); assert.equal(old.forced, 1); assert.equal(replacement.starts, 1);
    assert.equal(lifecycle.snapshot().ready, true);
    const failed = diagnostics.find(row => row.event === "bridge.upstream_connect_failed");
    assert.equal(failed.catalogFailure.kind, kind); assert.equal(failed.catalogFailure.retryable, true);
    assert.ok(diagnostics.some(row => row.event === "bridge.upstream_catalog_recovered"));
    assert.doesNotMatch(JSON.stringify(diagnostics), /private diagnostics/);
  });
}

for (const [label, error] of [
  ["authentication", Object.assign(new Error("Authentication failed: private-value"), { code: -32603 })],
  ["authorization", Object.assign(new Error("private-value"), { code: -32603, data: { statusCode: 403 } })],
  ["nested rejection over generic server failure", Object.assign(new Error("private-value"), { code: -32603, status: 503, data: { statusCode: 401 } })],
  ["structured authentication", Object.assign(new Error("private-value"), { code: -32603, data: { code: "authentication_error" } })],
  ["rate limit", Object.assign(new Error("private-value"), { code: -32603, cause: { status: 429 } })],
  ["invalid parameters", Object.assign(new Error("private-value"), { code: -32602 })],
  ["invalid parameters despite a transport cause", Object.assign(new Error("private-value"), { code: -32602, cause: { code: "ECONNRESET" } })],
  ["cancellation", Object.assign(new Error("private-value"), { code: -32800 })],
  ["SDK abort", Object.assign(new Error("private-value"), { name: "AbortError", code: -32603 })],
  ["unsupported server", Object.assign(new Error("private-value"), { code: -32603, statusCode: 501 })],
  ["untyped failure", Object.assign(new Error("private-value"), { code: "private-code" })],
  ["malformed error code", Object.assign(new Error("private-value"), { code: { toLowerCase: 42 } })],
]) {
  test(`catalog recovery does not retry ${label}`, async t => {
    let factories = 0;
    const diagnostics = [], client = peer({ listModels: async () => { throw error; } });
    const lifecycle = setup(t, { client, clientFactory: () => { factories++; return peer(); }, onDiagnostic: row => diagnostics.push(row) });
    await assert.rejects(lifecycle.start(), caught => caught.code === "upstream_unavailable" && !caught.catalogFailure.retryable);
    assert.equal(factories, 0);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private-/);
  });
}

test("catalog RPC recovery remains single-attempt and requires confirmed cleanup", async t => {
  for (const cleanupFails of [false, true]) {
    let factories = 0;
    const failure = () => Promise.reject(Object.assign(new Error("private diagnostics"), { code: -32603 }));
    const old = peer({ listModels: failure, ...(cleanupFails ? { forceStop: async () => { throw new Error("cleanup failed"); } } : {}) });
    const replacement = peer({ listModels: failure });
    const lifecycle = setup(t, { client: old, clientFactory: () => { factories++; return replacement; } });
    await assert.rejects(lifecycle.start(), { code: "upstream_unavailable" });
    assert.equal(factories, cleanupFails ? 0 : 1);
    assert.equal(lifecycle.snapshot().ready, false);
  }
});

for (const operation of ["start", "ping"]) {
  test(`catalog recovery never retries ${operation} failures`, async t => {
    let factories = 0;
    const client = peer({ [operation]: async () => { throw Object.assign(new Error("private diagnostics"), { code: -32603 }); } });
    const lifecycle = setup(t, { client, clientFactory: () => { factories++; return peer(); } });
    await assert.rejects(lifecycle.start(), { code: "upstream_unavailable" });
    assert.equal(factories, 0);
  });
}

test("catalog recovery exhausts two clients without resetting the startup budget", async t => {
  const old = peer({ listModels: () => new Promise(() => {}) });
  const replacement = peer({ listModels: () => new Promise(() => {}) });
  let factories = 0;
  const lifecycle = setup(t, { client: old, startupTimeoutMs: 120,
    clientFactory: () => { factories++; return replacement; } });
  const started = Date.now();
  await assert.rejects(lifecycle.start(), error => error.code === "upstream_unavailable" && /exhausted/.test(error.message));
  assert.ok(Date.now() - started < 200, "the second client must not receive another 120 ms budget");
  assert.equal(factories, 1);
  assert.equal(lifecycle.state, "unavailable");
  assert.equal(old.forced, 1);
  assert.equal(replacement.forced, 1);
});

for (const mode of ["rpc-error", "cleanup-error", "cleanup-deadline", "cancelled", "reused-client", "factory-error"]) {
  test(`catalog recovery is fail-closed (${mode})`, async t => {
    let factories = 0;
    const old = peer({ listModels: () => mode === "rpc-error" ? Promise.reject(new Error("private-auth-error")) : new Promise(() => {}) });
    const lifecycle = setup(t, { client: old, startupTimeoutMs: 80, cleanupTimeoutMs: 100,
      clientFactory: () => {
        factories++;
        if (mode === "factory-error") throw new Error("private-factory-error");
        return mode === "reused-client" ? old : peer();
      } });
    old.forceStop = async () => {
      old.forced++;
      if (mode === "cleanup-error") throw new Error("private-cleanup-error");
      if (mode === "cleanup-deadline") await delay(60);
      if (mode === "cancelled") lifecycle.beginStop();
    };
    await assert.rejects(lifecycle.start(), error => {
      assert.equal(error.code, "upstream_unavailable");
      assert.doesNotMatch(error.message, /private-/);
      return true;
    });
    assert.equal(factories, ["reused-client", "factory-error"].includes(mode) ? 1 : 0);
    assert.equal(lifecycle.snapshot().ready, false);
    assert.equal(old.starts, 1);
  });
}
