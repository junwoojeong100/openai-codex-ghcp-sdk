// Test-only SDK double for the real-TUI harness: real Codex, launcher and bridge; no model calls.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_MODEL_IDS } from "../../src/model-map.mjs";
import { SessionManager } from "../../src/session-manager.mjs";
import { FakeClient } from "../helpers/stability-sdk.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
if (path.resolve(process.argv[1] || "") === path.join(root, "src/server.mjs")) {
  const latest = prompt => {
    const match = /<conversation_history>\n([\s\S]*)\n<\/conversation_history>/.exec(prompt);
    return match ? JSON.parse(match[1]).findLast(item => item.type === "message" && item.role === "user")?.content ?? prompt : prompt;
  };
  const start = SessionManager.prototype.start;
  SessionManager.prototype.start = async function () {
    this.clientFactory = () => new FakeClient({
      models: SUPPORTED_MODEL_IDS.map(id => ({ id, name: id, supportedReasoningEfforts: ["low", "high"],
        capabilities: { supports: { reasoningEffort: id !== "claude-haiku-4.5" }, limits: { max_context_window_tokens: 65_536, max_prompt_tokens: 49_152 } },
        ...(id === "claude-haiku-4.5" ? {} : { billing: { tokenPrices: { maxPromptTokens: 32_768, longContext: { maxPromptTokens: 49_152 } } } }),
      })),
      createSession(session) {
        let selected = { modelId: session.config.model, contextTier: session.config.contextTier, reasoningEffort: session.config.reasoningEffort };
        session.rpc.model = { getCurrent: async () => ({ ...selected }) };
        const setModel = session.setModel.bind(session);
        session.setModel = async (id, options) => {
          await setModel(id, options);
          selected = { modelId: id, contextTier: options.contextTier, reasoningEffort: options.reasoningEffort };
        };
        const emit = session.emit.bind(session);
        session.emit = (type, data, extra) => emit(type, type === "assistant.usage" ? { ...data, model: selected.modelId } : data, extra);
      },
      onSend(session, { prompt }) {
        const text = latest(prompt);
        const wanted = /otherwise reply with only (TUI_[0-9a-f]{8}_\d{6})/.exec(text)?.[1] ?? /Reply with only (TUI_[0-9a-f]{8}_\d{6})/.exec(text)?.[1];
        if (!wanted) throw new Error("Unexpected TUI fixture request");
        session.reply(wanted);
      },
    });
    this.client = this.clientFactory();
    return start.call(this);
  };
}
