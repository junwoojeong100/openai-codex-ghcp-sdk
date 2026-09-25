import { performance } from "node:perf_hooks";
import { BridgeRequestError } from "./request-policy.mjs";
import { withinDeadline } from "./copilot-session-rpc.mjs";
import { supportedModels } from "./model-map.mjs";

const unavailable = detail => new BridgeRequestError(`The Copilot connection is unavailable${detail ? ` (${detail})` : ""}. No inference was retried.`, {
  status: 503, code: "upstream_unavailable",
});

// Classify only bounded metadata. Read-only catalog retries never authorize inference replay.
function catalogFailure(error, failureType) {
  const details = [error, error?.data, error?.cause, error?.data?.cause].filter(value => value && typeof value === "object");
  const statuses = details.flatMap(value => [value.status, value.statusCode]).filter(value => Number.isInteger(value) && value >= 400 && value <= 599);
  const statusCode = statuses.find(value => value < 500) ?? statuses[0] ?? null;
  const rpcCode = [-32603, -32602, -32601, -32099, -32097, -32096, -32800].includes(error?.code) ? error.code : null;
  const transportCode = details.map(value => value.code).find(value => ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"].includes(value)) ?? null;
  const rejected = statusCode !== null && statusCode < 500 || [-32601, -32602].includes(rpcCode) || details.some(value =>
    typeof value.code === "string" && ["authentication_error", "authorization_error", "permission_denied", "rate_limit_exceeded", "quota_exceeded", "invalid_api_key", "unauthorized", "forbidden"].includes(value.code.toLowerCase())
      || typeof value.message === "string" && /authenticat|unauthori[sz]ed|forbidden|credential|\btoken\b|\blog.?in\b|quota|rate.?limit|permission|policy/i.test(value.message));
  const cancelled = failureType === "cancelled" || rpcCode === -32800 || details.some(value => value.name === "AbortError" || value.code === "ABORT_ERR");
  const kind = cancelled ? "cancelled" : rejected ? "rejected"
    : failureType === "timeout" ? "deadline" : transportCode || [-32099, -32097, -32096].includes(rpcCode) ? "transport"
      : [500, 502, 503, 504].includes(statusCode) ? "server" : rpcCode === -32603 && statusCode === null ? "internal_rpc" : "unknown";
  return { kind, rpcCode, statusCode, transportCode, retryable: ["deadline", "transport", "server", "internal_rpc"].includes(kind) };
}

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
    return this.starting ??= this.#connectWithCatalogRecovery();
  }

  #replaceClient() {
    let replacement;
    try { replacement = this.clientFactory(); }
    catch {
      this.#diagnostic({ event: "bridge.upstream_client_creation_failed", generation: this.generation });
      throw unavailable("SDK client replacement failed");
    }
    if (!replacement || this.usedClients.has(replacement)) throw unavailable("Recovery requires a fresh SDK client");
    this.usedClients.add(replacement);
    this.client = replacement;
    return replacement;
  }

  async #connectWithCatalogRecovery() {
    const deadline = performance.now() + this.startupTimeoutMs;
    try {
      await this.#connect(this.client, { deadline,
        catalogTimeoutMs: this.clientFactory ? Math.max(1, Math.floor(this.startupTimeoutMs / 2)) : null });
    } catch (error) {
      if (this.stopped || !this.clientFactory || error.operation !== "listModels" || !error.catalogFailure?.retryable
          || !error.cleanupConfirmed || performance.now() >= deadline) throw error;
      this.state = "recovering";
      this.#diagnostic({ event: "bridge.upstream_catalog_recovering", generation: this.generation,
        reason: error.catalogFailure.kind,
        remainingMs: Math.max(0, Math.floor(deadline - performance.now())) });
      try {
        await this.#connect(this.#replaceClient(), { deadline });
      } catch (retryError) {
        this.state = this.stopped ? "stopped" : "unavailable";
        retryError.message += " SDK catalog recovery was exhausted after one fresh-client attempt.";
        throw retryError;
      }
      this.#diagnostic({ event: "bridge.upstream_catalog_recovered", generation: this.generation });
    }
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

  async #connect(client, { deadline, catalogTimeoutMs = null }) {
    const generation = ++this.generation;
    const startedAt = performance.now();
    const timeoutMs = Math.max(1, Math.floor(deadline - startedAt));
    let operationName = "start";
    let catalogTimer;
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
      if (catalogTimeoutMs !== null) catalogTimer = setTimeout(() => controller.abort(Object.assign(
        new Error("SDK catalog deadline exceeded."), { code: "sdk_operation_timeout" },
      )), catalogTimeoutMs);
      const models = supportedModels(await client.listModels());
      controller.signal.throwIfAborted();
      return models;
    })();
    try {
      const models = await withinDeadline(() => operation, timeoutMs, controller.signal);
      if (this.stopped || generation !== this.generation) throw unavailable();
      this.client = client;
      this.onReady({ client, models, generation });
      this.state = "ready";
    } catch (error) {
      const failureType = this.stopped ? "cancelled" : error?.code === "sdk_operation_timeout" ? "timeout"
        : controller.signal.aborted ? "cancelled" : "rpc_error";
      const catalog = operationName === "listModels" ? catalogFailure(error, failureType) : null;
      this.#diagnostic({ event: "bridge.upstream_connect_failed", generation, operation: operationName,
        failureType, timeoutMs: this.startupTimeoutMs, elapsedMs: Math.floor(performance.now() - startedAt),
        ...(catalog ? { catalogFailure: catalog } : {}),
        ...(this.clientFactory ? { attemptBudgetMs: timeoutMs, catalogTimeoutMs } : {}) });
      controller.abort(error);
      this.state = this.stopped ? "stopped" : "unavailable";
      this.retired.add(client);
      this.retiredClients.add(client);
      // A timed-out start can still finish. Clean the retired object once more
      // then; never publish it or touch the replacement client.
      const lateCleanup = () => this.#forceStop(client).catch(() => {
        this.#diagnostic({ event: "bridge.upstream_cleanup_failed", generation, operation: "lateForceStop" });
      });
      void operation.then(lateCleanup, lateCleanup);
      let cleanupConfirmed = false;
      try { await this.#forceStop(client); cleanupConfirmed = true; }
      catch (cleanupError) {
        this.#diagnostic({ event: "bridge.upstream_cleanup_failed", generation, operation: "forceStop",
          failureType: cleanupError?.code === "sdk_operation_timeout" ? "timeout" : "rpc_error" });
      }
      throw Object.assign(unavailable(`SDK ${operationName} ${failureType === "timeout" ? "timed out" : failureType === "cancelled" ? "cancelled" : "failed"}`),
        { operation: operationName, failureType, cleanupConfirmed, ...(catalog ? { catalogFailure: catalog } : {}) });
    } finally {
      clearTimeout(catalogTimer);
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
      this.#replaceClient();
      await this.#connectWithCatalogRecovery();
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
