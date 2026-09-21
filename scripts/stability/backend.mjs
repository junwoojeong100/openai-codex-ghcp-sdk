import http from "node:http";
import { CopilotClient } from "@github/copilot-sdk";
import { SessionManager } from "../../src/session-manager.mjs";
import { createBridgeServer } from "../../src/server.mjs";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";
import { modelCatalog } from "../../src/model-map.mjs";
import { observeSdk, observeHttp, listen } from "../compatibility/instrumentation.mjs";
import { bounded, sha } from "../compatibility/util.mjs";
import { CATALOG } from "./catalog.mjs";

export const waitUntil = async (predicate, signal, ms = 8000) => {
  const end = Date.now() + ms;
  while (!predicate()) { signal?.throwIfAborted(); if (Date.now() > end) throw new Error("Stability condition deadline"); await new Promise(r => setTimeout(r, 5)); }
};
const events = text => text.split(/\r?\n/).filter(s => s.startsWith("data: {")).map(s => JSON.parse(s.slice(6)));
const final = text => { try { return events(text).findLast(e => e.type === "response.completed")?.response; } catch { return null; } };
const hasResult = body => body.input?.some?.(i => ["function_call_output", "custom_tool_call_output"].includes(i.type));
function permute(tools) { return [...tools].reverse().map(t => t.type === "namespace" ? { ...t, tools: permute(t.tools) } : t); }
function changeDescription(tools) {
  for (const tool of tools) {
    if (tool.type === "namespace") { if (changeDescription(tool.tools)) return true; }
    else { tool.description = (tool.description ?? "") + "\nOwned stability policy change."; return true; }
  }
  return false;
}

export class StabilityBackend {
  constructor(options) {
    Object.assign(this, options);
    this.rawClients = []; this.sessions = []; this.actions = this.observation.controls;
    this.extraTasks = []; this.faultUsed = false;
  }
  record(action, data = {}) { const row = { action, ...data, at: Date.now() }; this.actions.push(row); return row; }
  createClient() {
    const raw = this.clientFactory?.() ?? new CopilotClient({ mode: "empty", baseDirectory: resolveCopilotHome(this.env.COPILOT_HOME), logLevel: "error", enableRemoteSessions: false });
    this.rawClients.push(raw);
    const wrap = session => {
      this.sessions.push(session);
      return new Proxy(session, { get: (target, key) => {
        if (key === "send") return async (...args) => {
          const ack = await target.send(...args);
          if (this.gate && !this.gate.used) {
            const gate = this.gate; gate.used = true;
            this.record("sdk-ack-held", { sessionId: target.sessionId });
            await bounded(gate.promise, AbortSignal.any([this.signal, AbortSignal.timeout(CATALOG.gateTimeoutMs)]));
            this.record("sdk-ack-released", { sessionId: target.sessionId });
          }
          return ack;
        };
        if (key === "on") return (type, listener) => target.on(type, event => {
          if (type === "assistant.message_delta" && this.corruptDelta && !this.corruptionUsed && !event.agentId && event.data?.deltaContent) {
            this.corruptionUsed = true;
            this.record("sdk-delta-id-corrupted", { sessionId: target.sessionId, originalIdHash: sha(String(event.data.messageId)), injectedId: "owned-invalid-stream-id" });
            listener({ ...event, data: { ...event.data, messageId: "owned-invalid-stream-id" } });
          } else listener(event);
        });
        const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const intercepted = new Proxy(raw, { get: (target, key) => {
      if (key === "createSession") return async config => wrap(await target.createSession(config));
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    return observeSdk(intercepted, this.observation.sdk);
  }
  armGate() {
    let release; const promise = new Promise(r => { release = r; });
    this.gate = { promise, release, used: false }; return this.gate;
  }
  snapshot(label) {
    const m = this.manager;
    return this.record("state", { label, generation: m.lifecycle.generation, readiness: m.lifecycle.snapshot(),
      states: m.states.size, pending: [...m.states.values()].reduce((n, s) => n + s.outstanding.size, 0),
      responses: m.responses.size, queue: m.queue.total, sdkSends: this.observation.sdk.filter(r => r.type === "session.send").length,
      submissions: this.observation.sdk.filter(r => r.type === "tool.submit").length });
  }
  async start() {
    this.manager = new SessionManager({ client: this.createClient(), clientFactory: () => this.createClient(), preferredModel: this.model,
      turnTimeoutMs: 60_000, requestTimeoutMs: 80_000, cleanupTimeoutMs: CATALOG.cleanupTimeoutMs, startupTimeoutMs: CATALOG.startupTimeoutMs,
      readinessIntervalMs: 15_000, onDiagnostic: event => this.observation.diagnostics.push({ ...event, at: Date.now() }) });
    await bounded(this.manager.start(), this.signal);
    this.catalog = modelCatalog(this.manager.listModels());
    this.server = createBridgeServer({ manager: this.manager, apiKey: this.token, onDiagnostic: e => this.observation.diagnostics.push({ ...e, at: Date.now() }) });
    observeHttp(this.server, this.observation.transport);
    this.server.on("request", req => {
      const row = this.observation.transport.at(-1);
      row.origin = req.headers["x-stability-origin"] ?? "native";
      row.threadId = req.headers["thread-id"] ?? null;
      row.sessionId = req.headers["session-id"] ?? null;
    });
    this.innerPort = await listen(this.server);
    this.proxy = http.createServer((req, res) => {
      const task = this.forward(req, res).catch(error => {
        if (!res.destroyed && error.name !== "AbortError") this.proxyError ??= error;
        if (!res.destroyed && !res.writableEnded) { if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "stability_proxy_error", message: error.message } })); }
      });
      this.extraTasks.push(task);
    });
    this.port = await listen(this.proxy);
    return this;
  }
  async fetch(body, headers, origin, signal = this.signal) {
    return fetch(`http://127.0.0.1:${this.innerPort}/v1/responses`, { method: "POST", body: JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: `Bearer ${this.token}`, ...(headers["session-id"] ? { "session-id": headers["session-id"] } : {}), ...(headers["thread-id"] ? { "thread-id": headers["thread-id"] } : {}), "x-stability-origin": origin }, signal });
  }
  async control(pathname, { recover = false } = {}) {
    const response = await fetch(`http://127.0.0.1:${this.innerPort}${pathname}`, { headers: { authorization: `Bearer ${this.token}`, "x-stability-origin": "control" }, signal: this.signal });
    const body = await response.json(); this.record("control-get", { path: pathname, status: response.status, body, recover }); return { status: response.status, body };
  }
  async loseSdk(label) {
    this.record("sdk-loss-start", { label, generation: this.manager.lifecycle.generation });
    await bounded(this.manager.client.forceStop(), this.signal);
    this.record("sdk-loss-complete", { label, generation: this.manager.lifecycle.generation });
    await this.control("/readyz"); await this.control("/health");
  }
  async forward(req, res) {
    if (req.method !== "POST" || req.url !== "/v1/responses") throw new Error("Unexpected stability ingress route");
    const controller = new AbortController();
    const close = () => { if (!res.writableEnded) controller.abort(); };
    req.once("aborted", close); res.once("close", close);
    const signal = AbortSignal.any([this.signal, controller.signal]);
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 * 1024) throw new Error("Stability request limit"); chunks.push(chunk); }
      const original = JSON.parse(Buffer.concat(chunks)); let body = structuredClone(original);
      const headers = req.headers, result = hasResult(body);
      const ingress = this.record("ingress", { requestHash: sha(JSON.stringify(original)), hasResult: result, threadId: headers["thread-id"] ?? null });
      if (this.scenario.id === "S02" && result && !this.faultUsed) {
        this.faultUsed = true;
        if (body.tools?.length) body.tools = permute(body.tools);
        for (const item of body.input ?? []) if (item.type === "additional_tools") item.tools = permute(item.tools);
        this.record("tools-permuted", { before: original, after: body });
      }
      if (this.scenario.id === "S03" && result && !this.faultUsed) {
        this.faultUsed = true; const changed = structuredClone(body);
        let changedTool = changed.tools?.length && changeDescription(changed.tools);
        if (!changedTool) for (const item of changed.input ?? []) if (item.type === "additional_tools" && !changedTool) changedTool = changeDescription(item.tools);
        if (!changedTool) throw new Error("No declared tool to change");
        const before = this.snapshot("before-policy-probe");
        const response = await this.fetch(changed, headers, "control-policy", signal), text = await response.text();
        this.record("policy-rejection", { status: response.status, response: text, originalHash: ingress.requestHash, request: changed, before, after: this.snapshot("after-policy-probe") });
      }
      if (["S05", "S06"].includes(this.scenario.id) && !this.faultUsed) {
        this.faultUsed = true; this.armGate();
        if (this.scenario.id === "S06") this.manager.queue.timeoutMs = CATALOG.injectedDeadlineMs;
      }
      const pendingResponse = this.fetch(body, headers, "native", signal);
      void pendingResponse.catch(() => {});
      if (this.scenario.id === "S05" && this.gate && !this.cancelProbeUsed) {
        this.cancelProbeUsed = true;
        try {
          await waitUntil(() => this.gate.used, signal, CATALOG.gateReadyTimeoutMs);
          const queued = new AbortController();
          const copy = this.fetch(body, headers, "control-cancelled", AbortSignal.any([queued.signal, signal])).then(async r => ({ status: r.status, text: await r.text() }), e => ({ errorName: e.name }));
          await waitUntil(() => this.manager.queue.total === 2, signal);
          this.snapshot("duplicate-queued"); queued.abort(); const outcome = await copy;
          await waitUntil(() => this.manager.queue.total === 1, signal);
          this.record("queued-copy-cancelled", { outcome, snapshot: this.snapshot("cancelled-before-release") });
        } finally { this.gate.release(); }
      }
      const response = await pendingResponse;
      const copyResult = this.scenario.id === "S04" && result && !this.faultUsed;
      const buffered = copyResult || (this.scenario.id === "S06" && this.gate);
      let text;
      if (buffered) text = await response.text();
      if (copyResult) {
        this.faultUsed = true; const first = this.snapshot("before-exact-retry");
        const duplicate = await this.fetch(body, headers, "control-duplicate", signal), duplicateText = await duplicate.text();
        this.record("exact-retry", { firstStatus: response.status, retryStatus: duplicate.status, firstOutput: final(text)?.output ?? null, retryOutput: final(duplicateText)?.output ?? null, requestHash: sha(JSON.stringify(body)), before: first, after: this.snapshot("after-exact-retry") });
      }
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" });
      if (buffered) res.end(text);
      else { for await (const chunk of response.body) if (!res.destroyed) res.write(chunk); if (!res.destroyed) res.end(); }
    } finally { req.off("aborted", close); res.off("close", close); }
  }
  async close() {
    if (this.closed) return;
    this.closed = true; this.gate?.release();
    if (this.proxy) { this.proxy.closeAllConnections(); await new Promise(r => this.proxy.close(r)); }
    if (this.server) { this.server.abortActiveRequests(); this.server.closeAllConnections(); await new Promise(r => this.server.close(r)); }
    await this.manager?.stop();
    await Promise.allSettled(this.extraTasks);
  }
}
