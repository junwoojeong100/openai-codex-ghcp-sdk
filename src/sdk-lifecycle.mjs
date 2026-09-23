import { performance } from "node:perf_hooks";
import { BridgeRequestError } from "./request-policy.mjs";
import { withinDeadline } from "./copilot-session-rpc.mjs";
import { supportedModels } from "./model-map.mjs";

const unavailable = detail => new BridgeRequestError(`The Copilot connection is unavailable${detail ? ` (${detail})` : ""}. No inference was retried.`, {
  status: 503, code: "upstream_unavailable",
});

// Each connection generation owns a distinct client. Recovery never retries a
// prompt/tool result, and late completions may only clean their own old client.
export class SdkLifecycle {
  constructor({ client, clientFactory, timeoutMs = 2000, startupTimeoutMs = 30_000,
    cleanupTimeoutMs = 5000, recoveryBackoffMs = 5000, onLost = () => {},
    onReady = () => {}, onDiagnostic = () => {} }) {
    Object.assign(this, { client, clientFactory, timeoutMs, startupTimeoutMs,
      cleanupTimeoutMs, recoveryBackoffMs, onLost, onReady, onDiagnostic });
    this.state = "starting";
    this.generation = 0;
    this.stopped = false;
    this.nextRecoveryAt = 0;
    this.retired = new Set();
    this.retiredClients = new WeakSet();
    this.usedClients = new WeakSet([client]);
    this.forceStops = new WeakMap();
  }

  owns(client, generation) {
    return this.client === client && this.generation === generation && !this.retiredClients.has(client);
  }

  snapshot() {
    return { ready: !this.stopped && this.state === "ready", state: this.state, generation: this.generation };
  }

  start() {
    if (this.stopped) return Promise.reject(unavailable());
    return this.starting ??= this.#connect(this.client);
  }

  #diagnostic(event) {
    try { this.onDiagnostic(event); } catch { /* Observability cannot prevent cleanup. */ }
  }

  #forceStop(client) {
    if (this.forceStops.has(client)) return this.forceStops.get(client);
    const task = withinDeadline(() => {
      if (typeof client.forceStop !== "function") throw new Error("SDK forceStop is required for safe recovery.");
      return client.forceStop();
    }, this.cleanupTimeoutMs);
    this.forceStops.set(client, task);
    const done = () => { if (this.forceStops.get(client) === task) this.forceStops.delete(client); };
    void task.then(done, done);
    return task;
  }

  async #connect(client) {
    const generation = ++this.generation;
    const startedAt = performance.now();
    let operationName = "start";
    const controller = new AbortController();
    this.connectController = controller;
    const operation = (async () => {
      controller.signal.throwIfAborted();
      await client.start();
      controller.signal.throwIfAborted();
      operationName = "ping";
      if (typeof client.ping !== "function") throw new Error("SDK ping is required for readiness.");
      await client.ping("codex-ghcp-readiness");
      controller.signal.throwIfAborted();
      operationName = "listModels";
      const models = supportedModels(await client.listModels());
      controller.signal.throwIfAborted();
      return models;
    })();
    try {
      const models = await withinDeadline(() => operation, this.startupTimeoutMs, controller.signal);
      if (this.stopped || generation !== this.generation) throw unavailable();
      this.client = client;
      this.onReady({ client, models, generation });
      this.state = "ready";
    } catch (error) {
      const failureType = this.stopped || controller.signal.aborted ? "cancelled"
        : error?.code === "sdk_operation_timeout" ? "timeout" : "rpc_error";
      this.#diagnostic({ event: "bridge.upstream_connect_failed", generation, operation: operationName,
        failureType, timeoutMs: this.startupTimeoutMs, elapsedMs: Math.floor(performance.now() - startedAt) });
      controller.abort(error);
      this.state = this.stopped ? "stopped" : "unavailable";
      this.retired.add(client);
      this.retiredClients.add(client);
      // A timed-out start can still finish. Clean the retired object once more
      // then; never publish it or touch the replacement client.
      const lateCleanup = () => this.#forceStop(client).catch(() => {});
      void operation.then(lateCleanup, lateCleanup);
      await this.#forceStop(client).catch(() => {});
      throw unavailable(`SDK ${operationName} ${failureType === "timeout" ? "timed out" : failureType === "cancelled" ? "cancelled" : "failed"}`);
    } finally {
      if (this.connectController === controller) this.connectController = null;
    }
  }

  #lost(generation) {
    if (generation !== this.generation || this.state !== "ready" || this.stopped) return;
    this.state = "unavailable";
    this.retiredClients.add(this.client);
    this.#diagnostic({ event: "bridge.upstream_lost", generation });
    this.onLost(generation);
  }

  async readiness() {
    if (this.stopped || this.state !== "ready") return this.snapshot();
    if (!this.probe) {
      const client = this.client, generation = this.generation;
      const task = (async () => {
        try {
          await withinDeadline(() => client.ping("codex-ghcp-readiness"), this.timeoutMs);
        } catch { this.#lost(generation); }
        return { ...this.snapshot(), ready: !this.stopped && generation === this.generation && this.state === "ready" };
      })();
      this.probe = task;
      const done = () => { if (this.probe === task) this.probe = null; };
      void task.then(done, done);
    }
    return this.probe;
  }

  #recover() {
    if (this.recovery) return this.recovery;
    if (this.stopped || !this.clientFactory || Date.now() < this.nextRecoveryAt) throw unavailable();
    this.state = "recovering";
    this.nextRecoveryAt = Date.now() + this.recoveryBackoffMs;
    this.#diagnostic({ event: "bridge.upstream_recovering", generation: this.generation });
    // Install the single-flight promise before any asynchronous cleanup.
    const task = Promise.resolve().then(async () => {
      this.retired.add(this.client);
      this.retiredClients.add(this.client);
      for (const old of [...this.retired]) {
        await this.#forceStop(old);
        this.retired.delete(old);
      }
      if (this.stopped) throw unavailable();
      const replacement = this.clientFactory();
      if (!replacement || this.usedClients.has(replacement)) throw new Error("Recovery requires a fresh SDK client.");
      this.usedClients.add(replacement);
      this.client = replacement; // ownership for shutdown, not readiness
      await this.#connect(replacement);
      this.#diagnostic({ event: "bridge.upstream_recovered", generation: this.generation });
    }).catch(() => {
      this.state = this.stopped ? "stopped" : "unavailable";
      this.nextRecoveryAt = Date.now() + this.recoveryBackoffMs;
      throw unavailable();
    });
    this.recovery = task;
    const done = () => { if (this.recovery === task) this.recovery = null; };
    void task.then(done, done);
    return task;
  }

  async ensureReady(signal) {
    signal?.throwIfAborted();
    if (this.stopped) throw unavailable();
    if (!this.recovery) {
      const result = await withinDeadline(() => this.readiness(), this.timeoutMs + 100, signal);
      signal?.throwIfAborted();
      if (this.stopped) throw unavailable();
      // A peer may have started recovery while we awaited the shared probe.
      // Join it BEFORE applying its backoff; do not reject parallel waiters.
      if (!result.ready && this.state !== "ready" && !this.recovery) this.#recover();
    }
    if (this.recovery) {
      await withinDeadline(() => this.recovery, this.startupTimeoutMs + 3 * this.cleanupTimeoutMs, signal);
    }
    signal?.throwIfAborted();
    if (this.stopped || this.state !== "ready") throw unavailable();
  }

  beginStop() {
    this.stopped = true;
    this.state = "stopped";
    this.connectController?.abort(unavailable());
  }

  stop() {
    if (this.closing) return this.closing;
    this.beginStop();
    this.closing = (async () => {
      const owned = new Set([this.client, ...this.retired]);
      for (const client of owned) {
        try {
          const errors = await withinDeadline(() => client.stop(), this.cleanupTimeoutMs);
          if (errors?.length) throw errors[0];
        } catch { await this.#forceStop(client).catch(() => {}); }
      }
    })();
    return this.closing;
  }
}
