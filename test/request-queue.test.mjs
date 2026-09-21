import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { RequestQueue } from "../src/request-queue.mjs";

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function queue(t, options) {
  const q = new RequestQueue({ timeoutMs: 1000, ...options });
  t.after(async () => { q.close(); await q.drain(); }); return q;
}

test("queued cancellation is immediate and cannot execute after its predecessor", async t => {
  const q = queue(t), gate = deferred(), entered = deferred(), calls = [];
  const first = q.run("one", async () => { entered.resolve(); await gate.promise; calls.push("first"); });
  await entered.promise;
  const c = new AbortController();
  const cancelled = q.run("one", () => calls.push("cancelled"), { signal: c.signal });
  const rejected = assert.rejects(cancelled, { name: "AbortError" });
  const last = q.run("one", () => calls.push("last"));
  c.abort(); await rejected;
  assert.equal(q.total, 2); assert.equal(q.families.get("one").waiting.length, 1);
  assert.equal(await q.run("other", () => "independent"), "independent");
  gate.resolve(); await Promise.all([first, last]);
  assert.deepEqual(calls, ["first", "last"]); assert.equal(q.total, 0); assert.equal(q.families.size, 0);
});

test("an aborted active caller settles before cleanup, but retains the serial lock", async t => {
  const q = queue(t), cleanup = deferred(), entered = deferred(), c = new AbortController();
  const first = q.run("one", async signal => {
    entered.resolve();
    await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
    await cleanup.promise;
  }, { signal: c.signal });
  const rejected = assert.rejects(first, { name: "AbortError" });
  await entered.promise; let nextRan = false;
  const next = q.run("one", () => { nextRan = true; });
  c.abort(); await rejected; await delay(0);
  assert.equal(nextRan, false); assert.equal(q.total, 2);
  cleanup.resolve(); await next; assert.equal(q.total, 0);
});

test("the total deadline includes waiting and removes timed-out work", async t => {
  const q = queue(t), gate = deferred(), entered = deferred();
  const first = q.run("one", async () => { entered.resolve(); await gate.promise; }); await entered.promise;
  let ran = false;
  await assert.rejects(q.run("one", () => { ran = true; }, { timeoutMs: 15 }), { code: "request_timeout", status: 504 });
  assert.equal(q.total, 1); gate.resolve(); await first; assert.equal(ran, false);
});

test("running work receives the same total deadline reason without false completion", async t => {
  const q = queue(t); let reason;
  await assert.rejects(q.run("one", async signal => {
    await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true })); reason = signal.reason;
  }, { timeoutMs: 15 }), { code: "request_timeout" });
  await q.drain(); assert.equal(reason.code, "request_timeout");
});

test("per-family and global admission limits release slots on cancellation", async t => {
  const q = queue(t, { maxPerFamily: 2, maxTotal: 3 }), gate = deferred(), c = new AbortController();
  const first = q.run("one", () => gate.promise);
  const second = q.run("one", () => "never", { signal: c.signal });
  const rejected = assert.rejects(second, { name: "AbortError" });
  await assert.rejects(q.run("one", () => "never"), { code: "request_queue_full" });
  const other = q.run("two", () => gate.promise);
  await assert.rejects(q.run("three", () => "never"), { code: "request_queue_full" });
  c.abort(); await rejected; assert.equal(await q.run("three", () => "available"), "available");
  gate.resolve(); await Promise.all([first, other]);
});

test("shutdown cancels waiting work without launching it and drains owned active work", async t => {
  const q = queue(t), entered = deferred(); let waitingRan = false;
  const first = q.run("one", async signal => { entered.resolve(); await new Promise(r => signal.addEventListener("abort", r, { once: true })); });
  const a = assert.rejects(first, { name: "AbortError" }); await entered.promise;
  const second = q.run("one", () => { waitingRan = true; }); const b = assert.rejects(second, { name: "AbortError" });
  q.close(); await Promise.all([a, b, q.drain()]);
  assert.equal(waitingRan, false); assert.equal(q.total, 0);
  await assert.rejects(q.run("other", () => "never"), { name: "AbortError" });
});

test("already-aborted and pre-dispatch aborted requests never invoke an operation", async t => {
  const q = queue(t), c = new AbortController(); let calls = 0;
  const first = q.run("one", () => calls++, { signal: c.signal }); c.abort();
  await assert.rejects(first, { name: "AbortError" });
  await assert.rejects(q.run("two", () => calls++, { signal: c.signal }), { name: "AbortError" });
  await q.drain(); assert.equal(calls, 0);
});

test("failure releases the lane and invalid capacities fail fast", async t => {
  for (const options of [{ timeoutMs: 0 }, { maxTotal: 0 }, { maxPerFamily: 1.5 }]) assert.throws(() => new RequestQueue(options));
  const q = queue(t);
  await assert.rejects(q.run("one", () => { throw new Error("fault"); }), /fault/);
  assert.equal(await q.run("one", () => "next"), "next");
  assert.equal(q.counts.size, 0);
});
