import { EventEmitter } from "node:events";
export const model = "gpt-6-astra";
const message = (content, messageId = "m1") => ({ messageId, content });
export class FakeSession {
  constructor(config, client) {
    this.config = config;
    this.client = client;
    this.sessionId = config.sessionId;
    this.events = new EventEmitter();
    this.sent = [];
    this.submitted = [];
    this.switched = [];
    this.aborted = 0;
    this.disconnected = 0;
    this.turnNumber = 0;
    this.rpc = {
      tools: {
        handlePendingToolCall: async (request) => {
          this.submitted.push(request);
          this.emit("external_tool.completed", { requestId: request.requestId });
          await this.client.onSubmit?.(this, request);
          return { success: true };
        },
      },
    };
  }

  on(type, listener) {
    this.events.on(type, listener);
    return () => this.events.off(type, listener);
  }

  emit(type, data, extra = {}) {
    this.events.emit(type, { type, data, ...extra });
  }

  async send(options) {
    this.sent.push(options);
    if (this.client.onSend) await this.client.onSend(this, options);
    else this.reply(`reply:${options.prompt}`);
    return "user-message-id";
  }

  reply(content) {
    const messageId = `m${++this.turnNumber}`;
    this.emit("assistant.turn_start", {});
    this.emit("assistant.message_delta", { messageId, deltaContent: content });
    this.emit("assistant.usage", { model, inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 });
    this.emit("assistant.message", message(content, messageId));
    this.emit("assistant.turn_end", {});
    this.emit("session.idle", {});
  }

  toolCalls(requests, { pendingFirst = false } = {}) {
    const emitPending = () => {
      for (const request of requests) {
        this.emit("external_tool.requested", {
          requestId: `rpc-${request.toolCallId}`,
          toolCallId: request.toolCallId,
          toolName: request.name,
          arguments: request.arguments,
          sessionId: this.sessionId,
        });
      }
    };
    this.emit("assistant.turn_start", {});
    if (pendingFirst) emitPending();
    this.emit("assistant.message", { messageId: `m${++this.turnNumber}`, content: "", toolRequests: requests });
    if (!pendingFirst) queueMicrotask(emitPending);
  }

  async abort() { this.aborted += 1; }
  async disconnect() { this.disconnected += 1; }
  async setModel(id, options) { this.switched.push({ id, options }); }
}

export class FakeClient {
  constructor({ onSend, onSubmit, createSession, models } = {}) {
    Object.assign(this, { onSend, onSubmit, createOverride: createSession });
    this.models = models || [{ id: model, capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ["low", "high"] }];
    this.sessions = [];
    this.deleted = [];
    this.stopped = false;
  }
  async start() {}
  async ping() { return { message: "ready" }; }
  async listModels() { return this.models; }
  async createSession(config) {
    const session = new FakeSession(config, this);
    this.sessions.push(session);
    await this.createOverride?.(session);
    return session;
  }
  async deleteSession(id) { this.deleted.push(id); }
  async stop() { this.stopped = true; return []; }
  async forceStop() { this.stopped = true; }
}

export function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export const headers = id => ({ "session-id": id, "thread-id": id });

export function replayInput(prompt) {
  const opening = "<conversation_history>\n", closing = "\n</conversation_history>";
  const start = prompt.indexOf(opening);
  if (start < 0) return [{ type: "message", role: "user", content: prompt }];
  const end = prompt.indexOf(closing, start + opening.length);
  if (end < 0) throw new Error("Incomplete replay envelope");
  const items = JSON.parse(prompt.slice(start + opening.length, end));
  const tail = prompt.slice(end + closing.length), prefix = "\n\nCurrent user request:\n";
  if (tail) {
    if (!tail.startsWith(prefix)) throw new Error("Unexpected replay request boundary");
    items.push({ type: "message", role: "user", content: tail.slice(prefix.length) });
  }
  return items;
}
