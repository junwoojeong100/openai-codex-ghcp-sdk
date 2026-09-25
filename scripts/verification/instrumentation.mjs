import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { withinDeadline } from "../../src/copilot-session-rpc.mjs";
import { sha } from "./util.mjs";

export function observeSdk(client, records, { verifyModelState = false } = {}) {
  const record = value => records.push({ ...value, at: Date.now() });
  const verifyModel = async (session, operation, model, contextTier) => {
    if (!verifyModelState) return;
    try {
      const current = await withinDeadline(() => session.rpc.model.getCurrent(), 5000);
      record({ type: "session.model_verified", sessionId: session.sessionId, operation,
        requestedModel: model, requestedTier: contextTier ?? null, model: current.modelId,
        contextTier: current.contextTier, effort: current.reasoningEffort ?? null });
    } catch (error) {
      record({ type: "session.model_verification_failed", sessionId: session.sessionId, operation,
        failureType: error?.code === "sdk_operation_timeout" ? "timeout" : "rpc_error" });
    }
  };
  const wrapSession = (session, config) => {
    const sessionId = session.sessionId ?? config.sessionId;
    record({ type: "session.created", sessionId, model: config.model, effort: config.reasoningEffort ?? null,
      contextTier: config.contextTier ?? null,
      tools: (config.tools || []).map(({ name, parameters }) => ({ name, parameters })), availableTools: config.availableTools });
    for (const name of ["assistant.usage", "assistant.message", "external_tool.requested", "session.error"]) {
      session.on(name, event => record({ type: name, sessionId, agentId: event.agentId ?? null, data: event.data }));
    }
    return new Proxy(session, { get(target, key) {
      if (key === "rpc") return { ...target.rpc, tools: { ...target.rpc.tools, handlePendingToolCall: async request => {
        const text = request.result?.textResultForLlm;
        record({ type: "tool.submit", sessionId, requestId: request.requestId,
          resultHash: typeof text === "string" ? sha(text) : null,
          resultBytes: typeof text === "string" ? Buffer.byteLength(text) : null });
        return target.rpc.tools.handlePendingToolCall(request);
      } } };
      if (["send", "setModel", "abort", "disconnect"].includes(key)) return async (...args) => {
        record({ type: `session.${key}`, sessionId, ...(key === "send" ? { promptHash: sha(args[0]?.prompt || "") } : {}),
          ...(key === "setModel" ? { model: args[0], effort: args[1]?.reasoningEffort ?? null, contextTier: args[1]?.contextTier ?? null } : {}) });
        const result = await target[key](...args);
        if (key === "setModel") await verifyModel(target, "setModel", args[0], args[1]?.contextTier);
        return result;
      };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  return new Proxy(client, { get(target, key) {
    if (key === "createSession") return async config => {
      const session = wrapSession(await target.createSession(config), config);
      await verifyModel(session, "created", config.model, config.contextTier);
      return session;
    };
    if (key === "listModels" && verifyModelState) return async (...args) => {
      const models = await target.listModels(...args);
      record({ type: "models.list", models: models.map(({ id, capabilities, billing, supportedContextTiers }) => ({
        id, capabilities: { limits: capabilities?.limits }, billing, supportedContextTiers,
      })) });
      return models;
    };
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
export function observeHttp(server, records) {
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
    const finished = () => { if (!row.closed) row.responseText += responseDecoder.end(); row.status = response.statusCode; row.contentType = response.getHeader("content-type"); row.finishedAt = Date.now(); row.closed = true; row.finished = response.writableFinished; };
    response.once("finish", finished); response.once("close", finished);
  });
}
