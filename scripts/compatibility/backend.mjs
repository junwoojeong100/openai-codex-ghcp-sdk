import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { CopilotClient } from "@github/copilot-sdk";
import { SessionManager } from "../../src/session-manager.mjs";
import { createBridgeServer } from "../../src/server.mjs";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";
import { modelCatalog } from "../../src/model-map.mjs";
import { bounded, CaseError, sha } from "./util.mjs";

export function observeSdk(client, records) {
  const record = value => records.push({ ...value, at: Date.now() });
  const wrapSession = (session, config) => {
    const sessionId = session.sessionId ?? config.sessionId;
    record({ type: "session.created", sessionId, model: config.model, effort: config.reasoningEffort ?? null,
      tools: (config.tools || []).map(({ name, parameters }) => ({ name, parameters })), availableTools: config.availableTools });
    for (const name of ["assistant.usage", "assistant.message", "external_tool.requested", "session.error"]) {
      session.on(name, event => record({ type: name, sessionId, agentId: event.agentId ?? null, data: event.data }));
    }
    return new Proxy(session, { get(target, key) {
      if (key === "rpc") return { ...target.rpc, tools: { ...target.rpc.tools, handlePendingToolCall: async request => {
        record({ type: "tool.submit", sessionId, requestId: request.requestId });
        return target.rpc.tools.handlePendingToolCall(request);
      } } };
      if (["send", "setModel", "abort", "disconnect"].includes(key)) return async (...args) => {
        record({ type: `session.${key}`, sessionId, ...(key === "send" ? { promptHash: sha(args[0]?.prompt || "") } : {}),
          ...(key === "setModel" ? { model: args[0] } : {}) });
        return target[key](...args);
      };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  return new Proxy(client, { get(target, key) {
    if (key === "createSession") return async config => wrapSession(await target.createSession(config), config);
    if (["deleteSession", "stop", "forceStop"].includes(key)) return async (...args) => {
      const result = await target[key](...args); record({ type: `client.${key}`, sessionId: key === "deleteSession" ? args[0] : undefined }); return result;
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
}
export async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server.address().port;
}
function observeHttp(server, records) {
  server.prependListener("request", (request, response) => {
    const row = { id: randomUUID(), method: request.method, path: request.url, startedAt: Date.now(), request: null, responseText: "" };
    records.push(row); let body = "", bytes = 0, bodyBytes = 0;
    const requestDecoder = new StringDecoder("utf8"), responseDecoder = new StringDecoder("utf8");
    // Observe bytes without changing IncomingMessage encoding: production uses Buffer.concat.
    request.on("data", chunk => { bodyBytes += chunk.length; if (bodyBytes > 8 * 1024 * 1024) request.destroy(); else body += requestDecoder.write(chunk); });
    request.on("end", () => { body += requestDecoder.end(); if (body) { try { row.request = JSON.parse(body); } catch { row.invalidJson = true; } } });
    const write = response.write.bind(response), end = response.end.bind(response);
    const capture = chunk => {
      if (chunk == null || typeof chunk === "function") return;
      const data = typeof chunk === "string" ? chunk : responseDecoder.write(chunk);
      bytes += Buffer.byteLength(data);
      if (bytes <= 8 * 1024 * 1024) row.responseText += data; else row.truncated = true;
    };
    response.write = (chunk, ...rest) => { capture(chunk); return write(chunk, ...rest); };
    response.end = (chunk, ...rest) => { capture(chunk); return end(chunk, ...rest); };
    const finished = () => { if (!row.closed) row.responseText += responseDecoder.end(); row.status = response.statusCode; row.contentType = response.getHeader("content-type"); row.finishedAt = Date.now(); row.closed = true; };
    response.once("finish", finished); response.once("close", finished);
  });
}
export class Backend {
  constructor({ provider = "ghcp", model, env, token, signal, transport, sdk, diagnostics, clientFactory, turnTimeoutMs = 120_000 }) {
    if (provider !== "ghcp") throw new Error("Only the GHCP provider belongs to this 70-case suite.");
    Object.assign(this, { provider, model, env, token, signal, transport, sdk, diagnostics, clientFactory, turnTimeoutMs });
  }
  async start() {
    const raw = this.clientFactory?.() ?? new CopilotClient({ mode: "empty", baseDirectory: resolveCopilotHome(this.env.COPILOT_HOME), logLevel: "error", enableRemoteSessions: false });
    this.manager = new SessionManager({ client: observeSdk(raw, this.sdk), preferredModel: this.model, turnTimeoutMs: this.turnTimeoutMs,
      cleanupTimeoutMs: 1000, onDiagnostic: event => this.diagnostics.push(event) });
    await bounded(this.manager.start(), this.signal);
    const models = this.manager.listModels();
    if (!models.some(x => x.id === this.model && x.policy?.state !== "disabled"))
      throw new CaseError(`Unavailable Copilot model ${this.model}; no fallback.`);
    this.catalog = modelCatalog(models);
    this.server = createBridgeServer({ manager: this.manager, apiKey: this.token, onDiagnostic: event => this.diagnostics.push(event) });
    observeHttp(this.server, this.transport);
    this.port = await listen(this.server); return this;
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.shutdown(); return this.closePromise;
  }
  async shutdown() {
    if (this.server) {
      this.server.abortActiveRequests?.(); this.server.closeAllConnections();
      await new Promise(resolve => this.server.close(resolve));
    }
    if (this.manager) await bounded(this.manager.stop(), AbortSignal.timeout(3500));
  }
}
