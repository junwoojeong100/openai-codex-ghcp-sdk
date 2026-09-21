import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { CaseExecutor } from "../scripts/compatibility/execute.mjs";
import { StabilityExecutor } from "../scripts/stability/execute.mjs";
import { StabilityBackend } from "../scripts/stability/backend.mjs";
import { CATALOG, SCENARIOS } from "../scripts/stability/catalog.mjs";
import { FakeClient, deferred, model } from "./helpers/stability-sdk.mjs";

class ResponseSink extends EventEmitter {
  constructor() { super(); this.chunks = []; this.destroyed = false; this.writableEnded = false; this.headersSent = false; }
  writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; }
  write(chunk) { this.chunks.push(Buffer.from(chunk)); return true; }
  end(chunk) { if (chunk != null) this.write(chunk); this.writableEnded = true; this.emit("finish"); }
  get text() { return Buffer.concat(this.chunks).toString("utf8"); }
}
function request(body = { model, input: "owned request", stream: true }) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method: "POST", url: "/v1/responses", headers: { "thread-id": "owned" } });
  return req;
}
function backend(t, scenarioId = "S05") {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const observation = { controls: [], sdk: [], transport: [], diagnostics: [] };
  const result = new StabilityBackend({ scenario: SCENARIOS.find(s => s.id === scenarioId), model,
    env: {}, signal: controller.signal, observation });
  result.manager = { queue: { total: 1 }, states: new Map(), responses: new Map(),
    lifecycle: { generation: 1, snapshot: () => ({ ready: true }) } };
  return { backend: result, observation, controller };
}

test("stability teardown receives the declared cleanup reserve, not the shared 5s default", async t => {
  const budgets = [];
  t.mock.method(AbortSignal, "timeout", milliseconds => { budgets.push(milliseconds); return new AbortController().signal; });
  const core = new CaseExecutor({ scenario: { id: "C01" }, model });
  await core.finish();
  const stability = new StabilityExecutor({ scenario: SCENARIOS[0], model });
  await stability.finish();
  assert.deepEqual(budgets, [5000, CATALOG.cleanupReserveSeconds * 1000]);
});

test("configured teardown is a bounded deadline independent of the expired case signal", async t => {
  const signal = AbortSignal.abort(new Error("case expired"));
  const executor = new CaseExecutor({ scenario: { id: "C01" }, model, signal, teardownTimeoutMs: 20 });
  const host = { closed: false, close: () => closing };
  const closing = delay(80).then(() => { host.closed = true; });
  executor.hosts.push(host); t.after(() => closing);
  const evidence = await executor.finish();
  assert.equal(evidence.resources.cleaned, false);
  assert.equal(evidence.resources.errors.length, 1);
  assert.match(evidence.resources.errors[0], /abort|timed out|timeout/i);
  assert.ok(!evidence.resources.errors.includes("case expired"));
});

for (const type of ["json", "sse"]) test(`S05 preserves an upstream ${type} failure before the ACK gate`, async t => {
  const { backend: b, controller, observation } = backend(t);
  const timer = setTimeout(() => controller.abort(new Error("gate wait hid the response")), 150);
  t.after(() => clearTimeout(timer));
  const data = type === "json" ? JSON.stringify({ error: { code: "owned_upstream_failure", message: "original" } })
    : 'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"code":"owned_upstream_failure"}}}\n\n';
  let calls = 0;
  b.fetch = async (_body, _headers, origin) => {
    assert.equal(origin, "native"); calls++;
    return new Response(data, { status: type === "json" ? 422 : 200,
      headers: { "content-type": type === "json" ? "application/json" : "text/event-stream" } });
  };
  const res = new ResponseSink();
  await b.forward(request(), res);
  assert.equal(res.status, type === "json" ? 422 : 200);
  assert.equal(res.text, data);
  assert.equal(calls, 1);
  assert.ok(!observation.controls.some(c => c.action === "queued-copy-cancelled"));
  assert.equal(b.gate.used, false);
});

test("S05 preserves a rejected upstream fetch instead of waiting for an unreachable gate", async t => {
  const { backend: b, controller } = backend(t);
  const timer = setTimeout(() => controller.abort(new Error("gate timed out")), 150);
  t.after(() => clearTimeout(timer));
  const original = new Error("owned connection failure");
  b.fetch = async () => { throw original; };
  await assert.rejects(b.forward(request(), new ResponseSink()), error => error === original);
});

test("S05 still cancels a real queued copy before releasing a successfully held ACK", async t => {
  const { backend: b, observation, controller } = backend(t);
  const timer = setTimeout(() => controller.abort(new Error("probe hung")), 1000);
  t.after(() => clearTimeout(timer));
  const origins = [];
  b.fetch = async (_body, _headers, origin, signal) => {
    origins.push(origin);
    if (origin === "native") {
      b.gate.used = true;
      return new Response(new ReadableStream({ start(stream) {
        stream.enqueue(Buffer.from('data: {"type":"response.created"}\n\n'));
        void b.gate.promise.then(() => { stream.enqueue(Buffer.from('data: {"type":"response.completed"}\n\n')); stream.close(); });
      } }), { headers: { "content-type": "text/event-stream" } });
    }
    assert.equal(origin, "control-cancelled"); b.manager.queue.total = 2;
    return new Promise((_, reject) => signal.addEventListener("abort", () => {
      b.manager.queue.total = 1; reject(signal.reason);
    }, { once: true }));
  };
  const res = new ResponseSink();
  await b.forward(request(), res);
  assert.deepEqual(origins, ["native", "control-cancelled"]);
  assert.equal(observation.controls.find(c => c.label === "duplicate-queued").queue, 2);
  assert.equal(observation.controls.find(c => c.action === "queued-copy-cancelled").outcome.errorName, "AbortError");
  assert.match(res.text, /response.completed/);
});

test("S05 aborts its owned duplicate when a later probe step throws", async t => {
  const { backend: b, controller } = backend(t);
  let duplicateAborted = false;
  const original = new Error("snapshot failed");
  b.snapshot = () => { throw original; };
  b.fetch = async (_body, _headers, origin, signal) => {
    if (origin === "native") {
      b.gate.used = true;
      return new Response(new ReadableStream({ start(stream) { void b.gate.promise.then(() => stream.close()); } }),
        { headers: { "content-type": "text/event-stream" } });
    }
    b.manager.queue.total = 2;
    return new Promise((_, reject) => signal.addEventListener("abort", () => {
      duplicateAborted = true; b.manager.queue.total = 1; reject(signal.reason);
    }, { once: true }));
  };
  await assert.rejects(b.forward(request(), new ResponseSink()), error => error === original);
  assert.equal(duplicateAborted, true);
  controller.abort();
});

test("a late SDK acknowledgement cannot enter a gate already released by cleanup", async t => {
  const { backend: b, observation } = backend(t);
  const ready = deferred();
  const raw = new FakeClient({ onSend: () => ready.promise });
  b.clientFactory = () => raw;
  const client = b.createClient();
  const session = await client.createSession({ sessionId: "late-ack", model, tools: [] });
  const gate = b.armGate();
  const pending = session.send({ prompt: "owned" });
  gate.release(); ready.resolve();
  await pending;
  assert.ok(!observation.controls.some(c => c.action === "sdk-ack-held"));
});
