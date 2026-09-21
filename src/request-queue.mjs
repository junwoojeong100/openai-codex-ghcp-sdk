import { performance } from "node:perf_hooks";
import { BridgeRequestError } from "./request-policy.mjs";

const cancelled = () => Object.assign(new Error("The client closed the request."), { name: "AbortError" });
const timeoutError = () => new BridgeRequestError("The request deadline expired, including queue wait. No request was retried.", {
  status: 504, code: "request_timeout",
});

// FIFO per conversation. Cancelling a waiter removes it immediately. Cancelling
// active work settles its caller, but retains the lock until owned cleanup ends.
export class RequestQueue {
  constructor({ timeoutMs = 360_000, maxPerFamily = 8, maxTotal = 128 } = {}) {
    for (const [name, value] of Object.entries({ timeoutMs, maxPerFamily, maxTotal })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid queue ${name}`);
    }
    Object.assign(this, { timeoutMs, maxPerFamily, maxTotal });
    this.families = new Map();
    this.counts = new Map();
    this.total = 0;
    this.closed = false;
    this.drainWaiters = new Set();
  }

  run(family, operation, { signal, timeoutMs = this.timeoutMs, onStart } = {}) {
    if (signal?.aborted) return Promise.reject(signal.reason ?? cancelled());
    if (this.closed) return Promise.reject(this.closeReason);
    if (this.total >= this.maxTotal || (this.counts.get(family) || 0) >= this.maxPerFamily) {
      return Promise.reject(new BridgeRequestError("The bridge request queue is full. No request was submitted.", {
        status: 429, code: "request_queue_full",
      }));
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new Error("Invalid request deadline"));
    let lane = this.families.get(family);
    if (!lane) { lane = { active: null, waiting: [] }; this.families.set(family, lane); }
    const controller = new AbortController();
    const entry = { operation, controller, signal, onStart, enqueuedAt: performance.now(), settled: false, started: false };
    const promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    entry.abort = () => this.#cancel(family, lane, entry, signal?.reason ?? cancelled());
    entry.timer = setTimeout(() => this.#cancel(family, lane, entry, timeoutError()), timeoutMs);
    signal?.addEventListener("abort", entry.abort, { once: true });
    this.total++;
    this.counts.set(family, (this.counts.get(family) || 0) + 1);
    lane.waiting.push(entry);
    if (signal?.aborted) entry.abort();
    this.#pump(family, lane);
    return promise;
  }

  #settle(entry, error, value) {
    if (entry.settled) return;
    entry.settled = true;
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener("abort", entry.abort);
    if (error) entry.reject(error); else entry.resolve(value);
  }

  #release(family, lane, entry) {
    entry.operation = null;
    this.total--;
    const count = (this.counts.get(family) || 1) - 1;
    if (count) this.counts.set(family, count); else this.counts.delete(family);
    if (!lane.active && !lane.waiting.length && this.families.get(family) === lane) this.families.delete(family);
    if (!this.total) { for (const resolve of this.drainWaiters) resolve(); this.drainWaiters.clear(); }
  }

  #cancel(family, lane, entry, error) {
    if (entry.settled) return;
    entry.controller.abort(error);
    this.#settle(entry, error);
    if (!entry.started) {
      const index = lane.waiting.indexOf(entry);
      if (index >= 0) lane.waiting.splice(index, 1);
      this.#release(family, lane, entry);
      this.#pump(family, lane);
    }
  }

  #pump(family, lane) {
    if (lane.active || this.closed) return;
    const entry = lane.waiting.shift();
    if (!entry) return;
    lane.active = entry;
    entry.started = true;
    const run = Promise.resolve().then(() => {
      entry.controller.signal.throwIfAborted();
      entry.onStart?.({ queueWaitMs: Math.ceil(performance.now() - entry.enqueuedAt) });
      return entry.operation(entry.controller.signal);
    });
    const finish = (error, value) => {
      this.#settle(entry, error, value);
      lane.active = null;
      this.#release(family, lane, entry);
      this.#pump(family, lane);
    };
    void run.then(value => finish(null, value), error => finish(error));
  }

  close(reason = cancelled()) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    for (const [family, lane] of this.families) {
      for (const entry of [...lane.waiting]) this.#cancel(family, lane, entry, reason);
      if (lane.active) this.#cancel(family, lane, lane.active, reason);
    }
  }

  drain() {
    return this.total ? new Promise(resolve => this.drainWaiters.add(resolve)) : Promise.resolve();
  }
}
