// Test-only SDK double for the real-TUI harness: real Codex, launcher and bridge; no model calls.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { SUPPORTED_MODEL_IDS } from "../../src/model-map.mjs";
import { SessionManager } from "../../src/session-manager.mjs";
import { FakeClient, replayInput } from "../helpers/stability-sdk.mjs";

const testCommand = "node --test --experimental-test-isolation=none discount.test.mjs";
function call(session, tool, args) {
  if (!tool) throw new Error("The native fixture tool was not declared");
  session.toolCalls([{ toolCallId: randomUUID(), name: tool.name, arguments: args }]);
}
function shell(session, cmd) {
  const tool = session.config.tools.find(item => item.parameters?.properties?.cmd);
  call(session, tool, { cmd, login: false, yield_time_ms: 10000, max_output_tokens: 4000 });
}

const root = fileURLToPath(new URL("../..", import.meta.url));
if (path.resolve(process.argv[1] || "") === path.join(root, "src/server.mjs")) {
  const observer = process.env.GHCP_SOAK_OBSERVER ? JSON.parse(fs.readFileSync(process.env.GHCP_SOAK_OBSERVER, "utf8")) : {};
  const history = replayInput;
  const latest = prompt => {
    return history(prompt).findLast(item => item.type === "message" && item.role === "user")?.content ?? prompt;
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
        const label = /synthetic project label is (TUI_[0-9a-f]{8}_\d{6})/.exec(session.sent.map(row => row.prompt).join("\n"))?.[1];
        if (label) session.projectLabel = label;
        if (!session.config.tools.length) {
          if (!label) throw new Error("Compaction input lost the synthetic project label");
          session.reply(`The synthetic project label is ${label}. Keep it verbatim.`);
          return;
        }
        const wanted = /otherwise reply with only (TUI_[0-9a-f]{8}_\d{6})/.exec(text)?.[1]
          ?? /Reply with only (TUI_[0-9a-f]{8}_\d{6}(?: 안녕 café)?)/.exec(text)?.[1];
        if (!wanted && observer.pendingHandoffProbe === true) {
          const output = session.sent.flatMap(sent => history(sent.prompt)).findLast(item => item.type === "function_call_output")?.output;
          if (output) {
            const sample = /TUI_[0-9a-f]{8}_\d{6}/.exec(output)?.[0];
            if (!sample) throw new Error("The handoff replay omitted the actual MCP sample.");
            session.reply(sample);
          } else {
            const lookup = session.config.tools.find(tool => tool.description.includes("Fixture MCP lookup"));
            if (!lookup) throw new Error("The native fixture MCP tool was not declared.");
            session.toolCalls([{ toolCallId: "owned-handoff-lookup", name: lookup.name, arguments: { key: "selected" } }]);
          }
          return;
        }
        if (text.startsWith("Read-only baseline:")) {
          session.fixtureFlow = "code-baseline";
          session.baselineMarker = /reply with only (TUI_[0-9a-f]{8}_\d{6})/.exec(text)?.[1];
          if (!session.baselineMarker) throw new Error("The baseline request omitted its completion marker");
          shell(session, `cat sample.txt discount.mjs && ${testCommand}`); return;
        }
        if (text.startsWith("Repair the verified failure:")) {
          session.fixtureStep = 0; session.fixtureFlow = "code-repair";
          const patch = "*** Begin Patch\n*** Update File: discount.mjs\n@@\n-export function discount(price, percent) { return price * (100 - percent); }\n+export function discount(price, percent) { return price * (100 - percent) / 100; }\n*** End Patch";
          call(session, session.config.tools.find(tool => tool.description.includes("apply_patch") && !tool.description.includes("exec_command")), { input: patch });
          return;
        }
        if (wanted) { session.reply(wanted); return; }
        if (text.startsWith("Use only the fixture MCP lookup tool")) {
          session.fixtureStep = 0; session.fixtureFlow = "mcp";
          call(session, session.config.tools.find(tool => tool.description.includes("Fixture MCP lookup")), { key: "missing" });
          return;
        }
        if (text.startsWith("Without using tools, repeat only the exact synthetic sample")) {
          if (!session.sample) throw new Error("MCP continuation lost the tool result");
          session.reply(session.sample); return;
        }
        if (text.startsWith("What is the synthetic project label")) {
          if (!session.projectLabel) throw new Error("Native history lost the project label");
          session.reply(session.projectLabel); return;
        }
        if (text.startsWith("Write a 1500-word")) { session.emit("assistant.turn_start", {}); return; }
        throw new Error("Unexpected TUI fixture request");
      },
      onSubmit(session, request) {
        const output = request.result.textResultForLlm;
        const running = /Process running with session ID (\d+)/.exec(output);
        if (running) {
          call(session, session.config.tools.find(tool => tool.parameters?.properties?.session_id),
            { session_id: Number(running[1]), chars: "", yield_time_ms: 1000, max_output_tokens: 4000 });
          return;
        }
        session.sample ??= /TUI_[0-9a-f]{8}_\d{6}/.exec(output)?.[0];
        if (session.fixtureFlow === "mcp") {
          if (session.fixtureStep++ === 0) {
            if (!output.includes("ENOENT")) throw new Error("Expected native MCP error result");
            call(session, session.config.tools.find(tool => tool.description.includes("Fixture MCP lookup")), { key: "selected" });
          } else {
            if (!session.sample) throw new Error("Native MCP result omitted the sample");
            session.reply(session.sample);
          }
          return;
        }
        if (session.fixtureFlow === "code-baseline") {
          if (!/(?:#|ℹ) tests 3\b/.test(output) || !/(?:#|ℹ) fail [1-9]\d*\b/.test(output)) {
            throw new Error("The native baseline must report three tests and an actual failure");
          }
          session.reply(session.baselineMarker);
          return;
        }
        if (session.fixtureFlow !== "code-repair") throw new Error("Unexpected native result in SDK double");
        switch (session.fixtureStep++) {
          case 0: shell(session, `cat sample.txt && ${testCommand}`); break;
          case 1:
            session.sample = /TUI_[0-9a-f]{8}_\d{6}/.exec(output)?.[0];
            if (!session.sample) throw new Error("The native repair turn must re-read the sample");
            if (!/(?:#|ℹ) pass 3\b/.test(output)) throw new Error("The native repair must pass all three tests");
            session.reply(session.sample); break;
          default: throw new Error("Unexpected extra code-fixture result");
        }
      },
    });
    this.client = this.clientFactory();
    return start.call(this);
  };
}
