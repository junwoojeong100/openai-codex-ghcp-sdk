import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "../../src/session-manager.mjs";
import { FakeClient } from "../helpers/stability-sdk.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
if (process.env.GHCP_TERMINAL_FIXTURE && path.resolve(process.argv[1] || "") === path.join(root, "src/server.mjs")) {
  const config = JSON.parse(fs.readFileSync(process.env.GHCP_TERMINAL_FIXTURE, "utf8"));
  const record = { executionKind: "offline-terminal-fixture", sends: 0, sessions: 0, aborts: 0, byteDeltas: 0, diagnostics: [] };
  const timers = new Set();
  let recoveryStalled = false;
  const start = SessionManager.prototype.start;
  const latestPrompt = prompt => {
    const match = /<conversation_history>\n([\s\S]*)\n<\/conversation_history>/.exec(prompt);
    if (!match) return prompt;
    return JSON.parse(match[1]).findLast(item => item.type === "message" && item.role === "user")?.content;
  };
  SessionManager.prototype.start = async function () {
    this.clientFactory = () => new FakeClient({
      models: [{ id: "gpt-6-astra", supportedReasoningEfforts: ["low"], capabilities: {
        supports: { reasoningEffort: true }, limits: { max_context_window_tokens: 65_536, max_prompt_tokens: 49_152 },
      } }],
      createSession: async session => {
        record.sessions++;
        const abort = session.abort.bind(session);
        session.abort = async () => {
          record.aborts++;
          clearInterval(session.fixtureTimer);
          timers.delete(session.fixtureTimer);
          await abort();
        };
        if (config.hangFirstSetup && record.sessions === 1) await new Promise(() => {});
      },
      onSend(session, { prompt }) {
        record.sends++;
        const text = latestPrompt(prompt);
        const answer = /\b(?:FIRST_OK|AFTER_IDLE_OK|AFTER_INTERRUPT_OK|AFTER_SETUP_OK|AFTER_RECOVERY_OK)\b/.exec(text)?.[0];
        if (answer) { session.reply(answer); return; }
        if (/\bRECOVER_FIXTURE\b/.test(text)) {
          if (recoveryStalled) { session.reply("AUTO_RECOVERED_OK"); return; }
          recoveryStalled = true;
        } else if (/\bBYTES_FIXTURE\b/.test(text)) {
          session.emit("assistant.turn_start", {});
          let ticks = 0;
          session.fixtureTimer = setInterval(() => {
            record.byteDeltas++;
            session.emit("assistant.streaming_delta", { totalResponseSizeBytes: ++ticks * 512 });
            if (ticks === 8) {
              clearInterval(session.fixtureTimer);
              timers.delete(session.fixtureTimer);
              session.reply("STREAM_PROGRESS_OK");
            }
          }, 250);
          timers.add(session.fixtureTimer);
          return;
        } else if (!/\b(?:IDLE_FIXTURE|INTERRUPT_FIXTURE)\b/.test(text)) throw new Error("Unexpected terminal fixture request");
        session.emit("assistant.turn_start", {});
        session.fixtureTimer = setInterval(() => session.emit("session.usage_info", {
          currentTokens: 100, tokenLimit: 49_152, messagesLength: 1,
        }), 25);
        timers.add(session.fixtureTimer);
      },
    });
    this.client = this.clientFactory();
    const diagnostic = this.onDiagnostic;
    this.onDiagnostic = event => { record.diagnostics.push(event); diagnostic(event); };
    return start.call(this);
  };
  process.once("exit", () => {
    for (const timer of timers) clearInterval(timer);
    fs.writeFileSync(config.output, JSON.stringify(record), { mode: 0o600 });
  });
}
