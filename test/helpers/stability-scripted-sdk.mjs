import { randomUUID } from "node:crypto";
import { FakeClient, FakeSession } from "./stability-sdk.mjs";

// Mechanical peer: values may only be learned from actual client tool results
// or persisted history. Never reads a fixture or imports an oracle.
export class StabilityScriptedSdk extends FakeClient {
  constructor() { super(); this.alive = false; }
  async start() { this.alive = true; }
  async ping() { if (!this.alive) throw new Error("Owned SDK connection stopped"); return {}; }
  async forceStop() { this.alive = false; for (const s of this.sessions) s.events.removeAllListeners(); }
  async stop() { await this.forceStop(); return []; }
  async createSession(config) {
    if (!this.alive) throw new Error("Owned SDK is not started");
    const client = this;
    const peer = {
      async onSend(session, { prompt }) {
        if (!client.alive) throw new Error("Owned SDK disconnected");
        const values = [...prompt.matchAll(/value:(N_[a-f0-9]{20}_한글)/g)];
        const receipts = [...prompt.matchAll(/receipt:(N_[a-f0-9]{20}_한글)/g)];
        if (values.length && receipts.length) session.remembered = `value:${values.at(-1)[1]}\nreceipt:${receipts.at(-1)[1]}`;
        let latest = prompt;
        const match = /<conversation_history>\n([\s\S]*?)\n<\/conversation_history>/.exec(prompt);
        if (match) latest = JSON.parse(match[1]).findLast(i => i.type === "message" && i.role === "user")?.content ?? prompt;
        if (latest.startsWith("Use the read_fixture")) {
          const declared = config.tools.find(t => /^Client tool (?:[^\n.]+\.)?read_fixture\.\n/.test(t.description));
          if (!declared) throw new Error("Native fixture tool was not declared");
          session.toolCalls([{ name: declared.name, toolCallId: randomUUID(), arguments: {} }]);
        } else if (latest.startsWith("Keep the previously remembered")) session.reply("ACK");
        else {
          if (!session.remembered) throw new Error("No observed memory available");
          session.reply(session.remembered);
        }
      },
      async onSubmit(session, request) {
        session.remembered = request.result.textResultForLlm;
        session.reply(session.remembered);
      },
    };
    const session = new FakeSession(config, peer); this.sessions.push(session); return session;
  }
}
