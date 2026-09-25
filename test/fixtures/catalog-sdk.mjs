import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "../../src/session-manager.mjs";
import { FakeClient } from "../helpers/stability-sdk.mjs";

const server = fileURLToPath(new URL("../../src/server.mjs", import.meta.url));
if (path.resolve(process.argv[1] || "") === server) {
  const start = SessionManager.prototype.start;
  SessionManager.prototype.start = async function () {
    this.clientFactory = () => new FakeClient({ models: [{ id: "gpt-6-astra", supportedReasoningEfforts: ["low"],
      capabilities: { supports: { reasoningEffort: true }, limits: { max_context_window_tokens: 272000, max_prompt_tokens: 240000 } } }] });
    this.client = this.clientFactory();
    return start.call(this);
  };
}
