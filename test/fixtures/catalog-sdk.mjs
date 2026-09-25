import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "../../src/session-manager.mjs";
import { FakeClient } from "../helpers/stability-sdk.mjs";

const server = fileURLToPath(new URL("../../src/server.mjs", import.meta.url));
if (path.resolve(process.argv[1] || "") === server) {
  const start = SessionManager.prototype.start;
  SessionManager.prototype.start = async function () {
    this.clientFactory = () => {
      const client = new FakeClient({ models: [{ id: "gpt-6-astra", supportedReasoningEfforts: ["low"],
        capabilities: { supports: { reasoningEffort: true }, limits: { max_context_window_tokens: 272000, max_prompt_tokens: 240000 } } }] });
      const mode = process.env.GHCP_TEST_SHUTDOWN;
      if (mode) {
        const keepAlive = setInterval(() => {}, 1000);
        client.stop = async () => {
          if (mode === "graceful") { clearInterval(keepAlive); return []; }
          throw new Error("private-stop-detail");
        };
        client.forceStop = async () => {
          if (mode === "forced") { clearInterval(keepAlive); return; }
          if (mode === "timeout") return new Promise(() => {});
          throw new Error("private-force-detail");
        };
        if (process.env.GHCP_TEST_START_FAILURE) client.start = async () => { throw new Error("synthetic-startup-failure"); };
      }
      return client;
    };
    this.client = this.clientFactory();
    return start.call(this);
  };
}
