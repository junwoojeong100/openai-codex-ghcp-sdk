import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { SessionManager } from "../../src/session-manager.mjs";
import { observeSdk } from "../compatibility/instrumentation.mjs";
import { ROOT, safeRead, scrubber, writeJson } from "../compatibility/util.mjs";

if (process.env.GHCP_SOAK_OBSERVER && path.resolve(process.argv[1] || "") === path.join(ROOT, "src/server.mjs")) {
  const config = JSON.parse(safeRead(process.env.GHCP_SOAK_OBSERVER, 8192));
  if (!["live", "offline-self-test"].includes(config.executionKind) || !fs.statSync(config.output).isDirectory()) {
    throw new Error("Invalid owned terminal observer configuration.");
  }
  const clean = scrubber(process.env);
  const roles = new Map();
  const metrics = { executionKind: config.executionKind, model: config.model, pid: process.pid,
    sessions: 0, modelCalls: 0, rootAnswers: [], compactions: 0, maxInputTokens: 0, toolRequests: 0,
    inputTokens: 0, outputTokens: 0, filtered: 0, errors: 0, modelMismatches: 0, streamFailures: 0, streamCompletions: 0,
    requestBytes: 0, responseBytes: 0, maxRssBytes: 0, maxHeapBytes: 0 };
  const append = (name, row) => fs.appendFileSync(path.join(config.output, name),
    JSON.stringify(clean({ ...row, at: row.at ?? Date.now() })) + "\n", { mode: 0o600 });
  const records = { push(row) {
    const root = !row.agentId && !row.data?.agentId && !row.data?.parentToolCallId;
    if (row.type === "session.created") {
      metrics.sessions++;
      if (row.model !== config.model) metrics.modelMismatches++;
      roles.set(row.sessionId, row.tools.length ? "turn" : "compaction");
      if (!row.tools.length) metrics.compactions++;
      append("sdk.jsonl", { type: row.type, model: row.model, effort: row.effort ?? null,
        contextTier: row.contextTier, sessionId: row.sessionId, toolCount: row.tools.length });
    } else if (row.type === "assistant.usage" && root) {
      const data = row.data;
      metrics.modelCalls++;
      if (data.model !== config.model) metrics.modelMismatches++;
      metrics.inputTokens += data.inputTokens || 0; metrics.outputTokens += data.outputTokens || 0;
      metrics.maxInputTokens = Math.max(metrics.maxInputTokens, data.inputTokens || 0);
      if (data.contentFilterTriggered === true || data.finishReason === "content_filter") metrics.filtered++;
      append("sdk.jsonl", { type: row.type, sessionId: row.sessionId, model: data.model,
        inputTokens: data.inputTokens, outputTokens: data.outputTokens, cacheReadTokens: data.cacheReadTokens,
        finishReason: data.finishReason, contentFilterTriggered: data.contentFilterTriggered });
    } else if (row.type === "assistant.message" && root && roles.get(row.sessionId) === "turn") {
      const content = row.data.content || "";
      if (content && !row.data.toolRequests?.length) {
        metrics.rootAnswers.push({ chars: content.length, markers: [...new Set(content.match(/\b(?:SOAK|TUI)_[a-f0-9]{8}_\d{6}\b/g) || [])] });
        append("answers.jsonl", { sessionId: row.sessionId, content });
      }
    } else if (row.type === "session.error" && root) {
      metrics.errors++; append("sdk.jsonl", { type: row.type, errorType: row.data?.errorType, errorCode: row.data?.errorCode });
    } else if (row.type === "external_tool.requested" && root) {
      metrics.toolRequests++;
      append("sdk.jsonl", { type: row.type, sessionId: row.sessionId, toolName: row.data?.toolName });
    } else if (["session.setModel", "session.abort", "session.send", "tool.submit"].includes(row.type)) {
      append("sdk.jsonl", { type: row.type, sessionId: row.sessionId,
        ...(row.type === "session.setModel" ? { model: row.model, effort: row.effort ?? null, contextTier: row.contextTier } : {}) });
    } else if (["models.list", "session.model_verified", "session.model_verification_failed"].includes(row.type)) {
      append("sdk.jsonl", row);
    } else if (row.type === "client.deleteSession") {
      roles.delete(row.sessionId);
    }
  } };
  const start = SessionManager.prototype.start;
  let manager;
  SessionManager.prototype.start = async function () {
    manager = this;
    const factory = this.clientFactory;
    const options = { verifyModelState: config.verifyModelState === true };
    this.clientFactory = factory ? () => observeSdk(factory(), records, options) : null;
    this.client = observeSdk(this.client, records, options);
    const diagnostic = this.onDiagnostic;
    this.onDiagnostic = event => { append("diagnostics.jsonl", event); diagnostic(event); };
    return start.call(this);
  };
  const seen = new WeakSet(), emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, ...args) {
    if (event === "request" && !seen.has(this)) {
      seen.add(this);
      this.prependListener("request", (req, res) => {
        const row = { method: req.method, path: req.url, startedAt: Date.now(), requestBytes: 0, responseBytes: 0 };
        const control = config.verifyModelState === true && ["/health", "/v1/models"].includes(req.url);
        let controlBody = "", requestBody = "";
        const decoder = new StringDecoder("utf8");
        req.on("data", chunk => {
          row.requestBytes += chunk.length; metrics.requestBytes += chunk.length;
          if (config.verifyModelState === true && row.requestBytes <= 1024 * 1024) requestBody += decoder.write(chunk);
        });
        req.on("end", () => {
          if (config.verifyModelState !== true || !requestBody) return;
          requestBody += decoder.end();
          try {
            if (row.requestBytes > 1024 * 1024) throw new Error("Request exceeds observation limit");
            const body = JSON.parse(requestBody);
            row.requestShape = { model: body.model, stream: body.stream, format: body.text?.format,
              toolCount: body.tools?.length ?? 0 };
          } catch { row.invalidRequestShape = true; }
        });
        const write = res.write.bind(res), end = res.end.bind(res);
        const capture = chunk => {
          if (typeof chunk !== "string" && !Buffer.isBuffer(chunk)) return;
          const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
          const bytes = Buffer.byteLength(text);
          row.responseBytes += bytes; metrics.responseBytes += bytes;
          if ((control || config.verifyModelState === true && res.statusCode >= 400) && row.responseBytes <= 1024 * 1024) controlBody += text;
          if (text.startsWith("event: response.completed\n")) { row.terminal = "response.completed"; metrics.streamCompletions++; }
          if (text.startsWith("event: response.failed\n")) { row.terminal = "response.failed"; metrics.streamFailures++; }
        };
        res.write = (chunk, ...rest) => { capture(chunk); return write(chunk, ...rest); };
        res.end = (chunk, ...rest) => { capture(chunk); return end(chunk, ...rest); };
        res.once("close", () => {
          if (control || config.verifyModelState === true && res.statusCode >= 400) {
            try {
              if (row.responseBytes > 1024 * 1024) throw new Error("Control response exceeds observation limit");
              const body = JSON.parse(controlBody);
              if (control) row.body = body;
              else row.error = body.error;
            } catch { row.invalidControlBody = true; }
          }
          append("http.jsonl", { ...row, finishedAt: Date.now(), status: res.statusCode,
            contentType: res.getHeader("content-type"), finished: res.writableFinished });
        });
      });
    }
    return emit.call(this, event, ...args);
  };
  const flush = () => {
    const memory = process.memoryUsage();
    metrics.maxRssBytes = Math.max(metrics.maxRssBytes, memory.rss);
    metrics.maxHeapBytes = Math.max(metrics.maxHeapBytes, memory.heapUsed);
    writeJson(path.join(config.output, "sdk-metrics.json"), clean({ ...metrics, at: Date.now(),
      states: manager?.states.size ?? null, queue: manager?.queue.total ?? null }));
  };
  const timer = setInterval(flush, 5000);
  timer.unref();
  process.once("exit", () => { clearInterval(timer); flush(); });
}
