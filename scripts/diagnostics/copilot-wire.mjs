import { createHash } from "node:crypto";
import { CopilotRequestHandler } from "@github/copilot-sdk";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const reasons = new Set(["stop", "length", "tool_calls", "function_call", "content_filter"]);

// Whitelist metadata rather than redacting arbitrary provider text after saving
// it. Neither request headers, prompts, tool outputs nor response prose survive.
export function requestEvidence(bytes, expectedModel) {
  const result = { bytes: bytes.length, sha256: sha(bytes), parsed: false };
  try {
    const body = JSON.parse(bytes.toString("utf8"));
    Object.assign(result, { parsed: true, modelMatches: typeof body.model === "string" ? body.model === expectedModel : null,
      messageCount: Array.isArray(body.messages) ? body.messages.length : null,
      toolCount: Array.isArray(body.tools) ? body.tools.length : null,
      streaming: body.stream === true });
  } catch { /* An observation failure must not change the request. */ }
  return result;
}

export function responseEvidence(bytes, contentType, expectedModel) {
  const result = { bytes: bytes.length, sha256: sha(bytes), parsedChunks: 0, invalidChunks: 0,
    protocols: [], done: false, contentFilter: false, nativeRefusal: false, refusalCategories: [],
    finishReasons: [], stopReasons: [], modelMatches: null, inputTokens: null, outputTokens: null,
    cacheReadTokens: null, cacheWriteTokens: null, textBytes: 0, toolCallDeltas: 0 };
  const add = (key, value) => { if (!result[key].includes(value)) result[key].push(value); };
  const model = value => { if (typeof value === "string") result.modelMatches = result.modelMatches !== false && value === expectedModel; };
  const usage = value => {
    if (count(value?.input_tokens) !== null) {
      result.cacheReadTokens = count(value.cache_read_input_tokens) ?? 0;
      result.cacheWriteTokens = count(value.cache_creation_input_tokens) ?? 0;
      result.inputTokens = count(value.input_tokens + result.cacheReadTokens + result.cacheWriteTokens);
    }
    if (count(value?.output_tokens) !== null) result.outputTokens = value.output_tokens;
  };
  const stop = value => {
    if (["end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal", "model_context_window_exceeded"].includes(value?.stop_reason)) add("stopReasons", value.stop_reason);
    if (value?.stop_reason === "refusal") {
      result.nativeRefusal = true;
      if (value.stop_details?.category) add("refusalCategories", value.stop_details.category === "reasoning_extraction" ? "reasoning_extraction" : "other");
    }
  };
  const block = value => {
    if (value?.type === "text" && typeof value.text === "string") result.textBytes += Buffer.byteLength(value.text);
    if (value?.type === "tool_use") result.toolCallDeltas++;
  };
  const text = bytes.toString("utf8");
  const chunks = contentType?.includes("text/event-stream")
    ? text.split(/\r?\n\r?\n/).map(part => part.split(/\r?\n/).filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).replace(/^ /, "")).join("\n")).filter(Boolean)
    : [text];
  for (const chunk of chunks) {
    if (chunk.trim() === "[DONE]") { result.done = true; continue; }
    let data;
    try { data = JSON.parse(chunk); if (!data || typeof data !== "object") throw new Error(); }
    catch { result.invalidChunks++; continue; }
    result.parsedChunks++;
    if (Array.isArray(data.choices)) {
      add("protocols", "chat-completions"); model(data.model);
      if (count(data.usage?.prompt_tokens) !== null) result.inputTokens = data.usage.prompt_tokens;
      if (count(data.usage?.completion_tokens) !== null) result.outputTokens = data.usage.completion_tokens;
      for (const choice of data.choices) {
        if (!choice || typeof choice !== "object") continue;
        if (reasons.has(choice.finish_reason)) add("finishReasons", choice.finish_reason);
        if (choice.finish_reason === "content_filter") result.contentFilter = true;
        const message = choice.delta ?? choice.message;
        if (typeof message?.content === "string") result.textBytes += Buffer.byteLength(message.content);
        if (Array.isArray(message?.tool_calls)) result.toolCallDeltas += message.tool_calls.length;
      }
    } else if (["message", "message_start", "message_delta", "message_stop", "content_block_start", "content_block_delta", "content_block_stop"].includes(data.type)) {
      add("protocols", "anthropic-messages");
      if (data.type === "message_start" || data.type === "message") {
        const message = data.message ?? data;
        model(message.model); usage(message.usage); stop(message);
        for (const item of Array.isArray(message.content) ? message.content : []) block(item);
      }
      if (data.type === "message_delta") { usage(data.usage); stop(data.delta); }
      if (data.type === "content_block_start") block(data.content_block);
      if (data.type === "content_block_delta" && data.delta?.type === "text_delta" && typeof data.delta.text === "string") result.textBytes += Buffer.byteLength(data.delta.text);
      if (data.type === "message_stop") result.done = true;
    }
  }
  // Unknown formats (including model-catalog responses) are not evidence that
  // inference was unfiltered. Keep missing evidence distinct from false.
  result.explicitBlock = result.protocols.length ? result.contentFilter || result.nativeRefusal : null;
  return result;
}

async function readBounded(body, limit, timeoutMs) {
  if (!body) return { bytes: Buffer.alloc(0), complete: true };
  const reader = body.getReader(), chunks = [];
  let size = 0, timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs); });
  const cancel = () => { void reader.cancel().catch(() => {}); }; // Never await cancellation of one tee branch.
  try {
    while (true) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next.timedOut) { cancel(); return { bytes: Buffer.concat(chunks), complete: false, limit: "time" }; }
      if (next.done) return { bytes: Buffer.concat(chunks), complete: true };
      const chunk = Buffer.from(next.value), keep = Math.min(chunk.length, limit - size);
      if (keep) chunks.push(chunk.subarray(0, keep));
      size += keep;
      if (chunk.length > keep) { cancel(); return { bytes: Buffer.concat(chunks), complete: false, limit: "bytes" }; }
    }
  } catch { cancel(); return { bytes: Buffer.concat(chunks), complete: false, limit: "read_error" }; }
  finally { clearTimeout(timer); }
}

// Opt-in diagnostic only. Always forward the original Request and Response;
// the SDK's authentication, model choice and filter settings remain untouched.
export class CopilotWireObserver extends CopilotRequestHandler {
  constructor({ model, records = [], maxBytes = 256 * 1024, timeoutMs = 45_000, forward } = {}) {
    super();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new Error("Observation bounds must be positive integers.");
    }
    Object.assign(this, { model, records, maxBytes, timeoutMs, forward });
    this.pending = new Set();
  }

  observe(body, row, key, summarize) {
    const task = readBounded(body, this.maxBytes, this.timeoutMs).then(({ bytes, complete, limit }) => {
      row[key] = { ...summarize(bytes), complete, ...(limit ? { limit } : {}) };
    }).catch(() => { row[key] = { complete: false, limit: "observation_error" }; });
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  async sendRequest(request, context) {
    const row = { transport: context.transport === "http" ? "http" : "other" };
    this.records.push(row);
    try { this.observe(request.clone().body, row, "request", bytes => requestEvidence(bytes, this.model)); }
    catch { row.request = { complete: false, limit: "clone_error" }; }
    const response = this.forward ? await this.forward(request, context) : await super.sendRequest(request, context);
    row.status = response.status;
    const contentType = response.headers.get("content-type");
    try { this.observe(response.clone().body, row, "response", bytes => responseEvidence(bytes, contentType, this.model)); }
    catch { row.response = { complete: false, limit: "clone_error" }; }
    return response;
  }

  async drain() { while (this.pending.size) await Promise.all([...this.pending]); }
}
