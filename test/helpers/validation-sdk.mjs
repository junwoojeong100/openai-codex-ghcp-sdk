import { EventEmitter } from "node:events";
import { SUPPORTED_MODEL_IDS } from "../../src/model-map.mjs";
import { RAW_TOOL_INPUT } from "../../scripts/validation/drivers.mjs";

// Deterministic protocol double. Never authenticates, opens a service transport,
// invokes a model, or provides live compatibility credit.
export class ValidationSdk {
  constructor({ models, failStart = false } = {}) {
    this.models = models ?? SUPPORTED_MODEL_IDS.map((id) => ({ id,
      capabilities: { supports: { reasoningEffort: id !== "claude-haiku-4.5" } }, supportedReasoningEfforts: ["low", "high"] }));
    this.sessions = [];
    this.failStart = failStart;
  }
  async start() { if (this.failStart) throw new Error("Fixture authentication is unavailable."); }
  async listModels() { return this.models; }
  async createSession(config) {
    const session = new ValidationSession(config);
    this.sessions.push(session);
    return session;
  }
  async deleteSession() {}
  async stop() { return []; }
  async forceStop() {}
}
export class ValidationSession {
  constructor(config) {
    this.config = config;
    this.sessionId = config.sessionId;
    this.events = new EventEmitter();
    this.next = 0;
    this.rpc = { tools: { handlePendingToolCall: async (request) => {
      this.emit("external_tool.completed", { requestId: request.requestId });
      this.reply(request.result.textResultForLlm);
      return { success: true };
    } } };
  }
  on(type, listener) { this.events.on(type, listener); return () => this.events.off(type, listener); }
  emit(type, data) { this.events.emit(type, { type, data }); }
  usage() { this.emit("assistant.usage", { model: this.config.model, inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 }); }
  reply(content) {
    const messageId = `m${++this.next}`;
    this.emit("assistant.turn_start", {});
    this.emit("assistant.message_delta", { messageId, deltaContent: content });
    this.usage();
    this.emit("assistant.message", { messageId, content });
    this.emit("assistant.turn_end", {});
    this.emit("session.idle", {});
  }
  async send({ prompt }) {
    if (prompt.startsWith("Cancellation probe:")) return "pending-cancellation";
    if (prompt.startsWith("Call probe.read_fixture")) {
      const definition = this.config.tools[0];
      const args = definition.parameters.properties?.input ? { input: RAW_TOOL_INPUT } : { key: "integration" };
      const call = { toolCallId: `tool-${this.sessionId}`, name: definition.name, arguments: args };
      this.emit("assistant.turn_start", {});
      this.usage();
      this.emit("assistant.message", { messageId: `m${++this.next}`, content: "", toolRequests: [call] });
      queueMicrotask(() => this.emit("external_tool.requested", { requestId: `rpc-${call.toolCallId}`, ...call,
        toolName: call.name, sessionId: this.sessionId }));
      return "tool-requested";
    }
    const match = /Remember this marker: ("(?:[^"\\]|\\.)*")\./.exec(prompt);
    if (match) this.marker = JSON.parse(match[1]);
    if (!this.marker) throw new Error(`Unscripted offline prompt: ${prompt.slice(0, 70)}`);
    this.reply(this.marker);
    return "fixture-message";
  }
  async setModel(model, options) { this.config = { ...this.config, model, reasoningEffort: options?.reasoningEffort }; }
  async abort() {}
  async disconnect() {}
}
