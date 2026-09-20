import { createHash, randomUUID } from "node:crypto";
import { BridgeRequestError } from "./request-policy.mjs";

export { canonicalItem } from "./request-policy.mjs";

function protocolError(message) {
  return new BridgeRequestError(message, { status: 502, code: "invalid_upstream_response" });
}

function itemId(prefix, key) {
  return `${prefix}_${createHash("sha256").update(String(key)).digest("hex").slice(0, 32)}`;
}

function messageId(message, index) {
  return itemId("msg", message.messageId || `anonymous:${index}`);
}

function textPart(text) {
  return { type: "output_text", text, annotations: [], logprobs: [] };
}

function toolArguments(value) {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch {
      throw protocolError("Copilot returned invalid JSON tool arguments.");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw protocolError("Copilot tool arguments must be a JSON object.");
  }
  return value;
}

export function outputItems(messages = [], tools = []) {
  const output = [];
  const definitions = new Map(tools.map((tool) => [tool.name, tool]));
  const textMessages = messages.filter((message) => message.content != null && message.content !== "");
  const hasTools = messages.some((message) => message.toolRequests?.length);
  const ids = new Set();
  const callIds = new Set();
  // Calls are delivered at the turn boundary; text precedes them in both modes.
  for (const [index, message] of textMessages.entries()) {
    if (typeof message.content !== "string") throw protocolError("Copilot message content must be text.");
    const id = messageId(message, index);
    if (ids.has(id)) throw protocolError("Copilot returned a duplicate message ID.");
    ids.add(id);
    const phase = ["commentary", "final_answer"].includes(message.phase)
      ? message.phase
      : hasTools || index < textMessages.length - 1 ? "commentary" : "final_answer";
    output.push({ id, type: "message", status: "completed", role: "assistant", phase, content: [textPart(message.content)] });
  }
  for (const message of messages) {
    for (const request of message.toolRequests || []) {
      const tool = definitions.get(request.name);
      if (!tool) throw protocolError("Copilot requested a tool that was not declared by the client.");
      if (typeof request.toolCallId !== "string" || !request.toolCallId) throw protocolError("Copilot returned a tool without a call ID.");
      if (callIds.has(request.toolCallId)) throw protocolError("Copilot returned a duplicate tool call ID.");
      callIds.add(request.toolCallId);
      const args = toolArguments(request.arguments ?? {});
      const common = {
        status: "completed",
        call_id: request.toolCallId,
        name: tool.originalName,
        ...(tool.namespace ? { namespace: tool.namespace } : {}),
      };
      if (tool.type === "custom") {
        if (typeof args.input !== "string" || Object.keys(args).some((key) => key !== "input")) {
          throw protocolError("A custom tool must return exactly one raw input string.");
        }
        output.push({ id: itemId("ctc", request.toolCallId), type: "custom_tool_call", ...common, input: args.input });
      } else if (tool.type === "function") {
        output.push({ id: itemId("fc", request.toolCallId), type: "function_call", ...common, arguments: JSON.stringify(args) });
      } else throw protocolError("Copilot returned an unsupported tool type.");
    }
  }
  return output;
}

export function createResponse({ id = `resp_${randomUUID().replaceAll("-", "")}`, model, messages = [], tools = [], usage = null, createdAt = Math.floor(Date.now() / 1000) }) {
  return {
    id,
    object: "response",
    created_at: createdAt,
    status: "completed",
    error: null,
    incomplete_details: null,
    model,
    output: outputItems(messages, tools),
    usage,
    store: false,
  };
}

export class ResponsesStream {
  constructor(res, { id, model, createdAt = Math.floor(Date.now() / 1000) }) {
    this.res = res;
    this.id = id || `resp_${randomUUID().replaceAll("-", "")}`;
    this.model = model;
    this.createdAt = createdAt;
    this.sequence = 0;
    this.started = false;
    this.finished = false;
    this.records = [];
    this.messages = new Map();
    this.anonymous = null;
    this.response = null;
  }

  #emit(type, fields = {}) {
    if (this.res.destroyed || this.res.writableEnded) {
      throw Object.assign(new Error("The client closed the response stream."), { name: "AbortError" });
    }
    this.res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: this.sequence++, ...fields })}\n\n`);
  }

  #response(fields = {}) {
    return {
      ...createResponse({ id: this.id, model: this.model, createdAt: this.createdAt }),
      ...fields,
    };
  }

  start() {
    if (this.started || this.finished) return;
    this.started = true;
    const response = this.#response({ status: "in_progress" });
    this.#emit("response.created", { response });
    this.#emit("response.in_progress", { response });
  }

  #addMessage(id, anonymous = false) {
    const record = { id, index: this.records.length, text: "", anonymous };
    this.records.push(record);
    this.messages.set(id, record);
    this.#emit("response.output_item.added", {
      output_index: record.index,
      item: { id, type: "message", status: "in_progress", role: "assistant", content: [] },
    });
    this.#emit("response.content_part.added", {
      item_id: id, output_index: record.index, content_index: 0, part: textPart(""),
    });
    return record;
  }

  #delta(record, delta) {
    if (!delta) return;
    record.text += delta;
    this.#emit("response.output_text.delta", {
      item_id: record.id, output_index: record.index, content_index: 0, delta, logprobs: [],
    });
  }

  handleSdkEvent(event) {
    if (this.finished || event.agentId || event.data?.parentToolCallId || event.type !== "assistant.message_delta") return;
    const { deltaContent, messageId: sdkId } = event.data || {};
    if (typeof deltaContent !== "string") throw protocolError("Copilot returned an invalid message delta.");
    if (!deltaContent) return;
    this.start();
    let record;
    if (sdkId) {
      this.anonymous = null;
      const id = itemId("msg", sdkId);
      record = this.messages.get(id) || this.#addMessage(id);
    } else {
      record = this.anonymous || this.#addMessage(itemId("msg", `anonymous:${this.records.length}`), true);
      this.anonymous = record;
    }
    this.#delta(record, deltaContent);
  }

  finish({ messages = [], tools = [], usage = null } = {}) {
    if (this.finished) return this.response;
    const response = createResponse({ id: this.id, model: this.model, messages, tools, usage, createdAt: this.createdAt });
    const finalMessages = messages.filter((message) => message.content != null && message.content !== "");
    // Reconcile before publishing any done events; never silently rewrite deltas.
    for (const record of this.records) {
      const item = response.output[record.index];
      if (item?.type !== "message" || !item.content[0].text.startsWith(record.text)) {
        throw protocolError("Copilot's final message does not match its streamed text.");
      }
      if (record.id !== item.id && !record.anonymous && finalMessages[record.index]?.messageId) {
        throw protocolError("Copilot's final message order does not match its stream.");
      }
      // Rare SDK stubs omit messageId on a delta or final message. The ID already
      // emitted on this stream remains authoritative for the matching text item.
      item.id = record.id;
    }
    this.start();
    for (const [index, item] of response.output.entries()) {
      if (item.type === "message") {
        const record = this.records[index] || this.#addMessage(item.id);
        const part = item.content[0];
        this.#delta(record, part.text.slice(record.text.length));
        this.#emit("response.output_text.done", {
          item_id: item.id, output_index: index, content_index: 0, text: part.text, logprobs: [],
        });
        this.#emit("response.content_part.done", { item_id: item.id, output_index: index, content_index: 0, part });
      } else {
        const field = item.type === "function_call" ? "arguments" : "input";
        const event = item.type === "function_call" ? "function_call_arguments" : "custom_tool_call_input";
        this.#emit("response.output_item.added", { output_index: index, item: { ...item, status: "in_progress", [field]: "" } });
        if (item[field]) this.#emit(`response.${event}.delta`, { item_id: item.id, output_index: index, delta: item[field] });
        this.#emit(`response.${event}.done`, { item_id: item.id, output_index: index, [field]: item[field] });
      }
      this.#emit("response.output_item.done", { output_index: index, item });
    }
    this.#emit("response.completed", { response });
    this.finished = true;
    this.response = response;
    this.res.end();
    return response;
  }

  fail(error) {
    if (this.finished) return this.response;
    if (this.res.destroyed || this.res.writableEnded) {
      this.finished = true;
      return null;
    }
    this.start();
    const response = this.#response({
      status: "failed",
      error: { code: error?.code || "copilot_error", message: error?.message || "The model response failed." },
      output: this.records.map((record) => ({
        id: record.id, type: "message", status: "incomplete", role: "assistant", content: [textPart(record.text)],
      })),
    });
    this.#emit("response.failed", { response });
    this.finished = true;
    this.response = response;
    this.res.end();
    return response;
  }
}
