import fs from "node:fs";
import http from "node:http";
import path from "node:path";
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
    sessions: 0, modelCalls: 0, rootAnswers: [], compactions: 0, maxInputTokens: 0,
    inputTokens: 0, outputTokens: 0, filtered: 0, errors: 0, modelMismatches: 0, streamFailures: 0, streamCompletions: 0,
    requestBytes: 0, responseBytes: 0, maxRssBytes: 0, maxHeapBytes: 0 };
  const append = (name, row) => fs.appendFileSync(path.join(config.output, name),
    JSON.stringify(clean({ ...row, at: row.at ?? Date.now() })) + "\n", { mode: 0o600 });
  const records = { push(row) {
    const root = !row.agentId && !row.data?.parentToolCallId;
    if (row.type === "session.created") {
      metrics.sessions++;
      if (row.model !== config.model) metrics.modelMismatches++;
      roles.set(row.sessionId, row.tools.length ? "turn" : "compaction");
      if (!row.tools.length) metrics.compactions++;
      append("sdk.jsonl", { type: row.type, model: row.model, sessionId: row.sessionId, toolCount: row.tools.length });
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
        metrics.rootAnswers.push({ chars: content.length, markers: [...new Set(content.match(/\bSOAK_[a-f0-9]{8}_\d{6}\b/g) || [])] });
        append("answers.jsonl", { sessionId: row.sessionId, content });
      }
    } else if (row.type === "session.error" && root) {
      metrics.errors++; append("sdk.jsonl", { type: row.type, errorType: row.data?.errorType, errorCode: row.data?.errorCode });
    } else if (row.type === "client.deleteSession") {
      roles.delete(row.sessionId);
    }
  } };
  const start = SessionManager.prototype.start;
  let manager;
  SessionManager.prototype.start = async function () {
    manager = this;
    const factory = this.clientFactory;
    this.clientFactory = factory ? () => observeSdk(factory(), records) : null;
    this.client = observeSdk(this.client, records);
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
        req.on("data", chunk => { row.requestBytes += chunk.length; metrics.requestBytes += chunk.length; });
        const write = res.write.bind(res), end = res.end.bind(res);
        const capture = chunk => {
          if (typeof chunk !== "string" && !Buffer.isBuffer(chunk)) return;
          const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
          const bytes = Buffer.byteLength(text);
          row.responseBytes += bytes; metrics.responseBytes += bytes;
          if (text.startsWith("event: response.completed\n")) { row.terminal = "response.completed"; metrics.streamCompletions++; }
          if (text.startsWith("event: response.failed\n")) { row.terminal = "response.failed"; metrics.streamFailures++; }
        };
        res.write = (chunk, ...rest) => { capture(chunk); return write(chunk, ...rest); };
        res.end = (chunk, ...rest) => { capture(chunk); return end(chunk, ...rest); };
        res.once("close", () => append("http.jsonl", { ...row, finishedAt: Date.now(), status: res.statusCode, finished: res.writableFinished }));
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
