import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "../../src/session-manager.mjs";
import { FakeClient } from "../helpers/stability-sdk.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
if (process.env.GHCP_SOAK_OBSERVER && path.resolve(process.argv[1] || "") === path.join(root, "src/server.mjs")) {
  const config = JSON.parse(fs.readFileSync(process.env.GHCP_SOAK_OBSERVER, "utf8"));
  if (config.executionKind !== "offline-self-test") throw new Error("Mechanical terminal peer requires an explicit offline label.");
  const start = SessionManager.prototype.start;
  SessionManager.prototype.start = async function () {
    this.clientFactory = () => new FakeClient({
      models: [{ id: "gpt-6-astra", capabilities: { limits: { max_context_window_tokens: 65536, max_prompt_tokens: 49152 } } }],
      onSend(session, { prompt }) {
        const history = /<conversation_history>\n([\s\S]*)\n<\/conversation_history>/.exec(prompt);
        if (history) prompt = JSON.parse(history[1]).findLast(item => item.type === "message" && item.role === "user").content;
        const match = /joining SOAK, ([a-f0-9]{8}), and (\d{6}) with underscores/.exec(prompt);
        if (!match) throw new Error("Unexpected mechanical terminal prompt");
        session.reply(`SOAK_${match[1]}_${match[2]}`);
      },
    });
    this.client = this.clientFactory();
    return start.call(this);
  };
}
