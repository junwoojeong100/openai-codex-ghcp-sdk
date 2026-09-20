import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// Mechanical protocol peer, NOT an LLM. No fs/network or oracle imports: all
// hidden values must come back through real Codex tool results/native history.
export class CoreScriptedSdk {
  constructor(scenarioId) { this.scenarioId = scenarioId; this.sessions = []; }
  async start() {}
  async listModels() { return [{ id: "gpt-6-astra", supportedReasoningEfforts: ["low"], capabilities: { supports: { reasoningEffort: true } } }]; }
  async createSession(config) { const s = new ScriptedSession(config, this.scenarioId); this.sessions.push(s); return s; }
  async deleteSession() {}
  async stop() { return []; }
  async forceStop() {}
}
const tokens = text => [...new Set(String(text).match(/N_[a-f0-9]{20}_한글/g) || [])];
const REFACTOR = "*** Begin Patch\n*** Update File: calc.mjs\n@@\n-export function second() {\n-\treturn 1;\n+export function total() {\n+\treturn 2;\n }\n*** Update File: app.mjs\n@@\n-import { second } from './calc.mjs';\n-console.log(second());\n+import { total } from './calc.mjs';\n+console.log(total());\n*** Update File: notes.txt\n*** Move to: docs/notes.txt\n@@\n Keep these notes.\n*** Delete File: obsolete.txt\n*** Add File: README.md\n+Uses total.\n*** End Patch";
class ScriptedSession {
  constructor(config, scenarioId) {
    this.config = config; this.id = scenarioId; this.sessionId = config.sessionId ?? randomUUID(); this.events = new EventEmitter(); this.step = 0;
    this.outputs = [];
    this.rpc = { tools: { handlePendingToolCall: async request => {
      this.emit("external_tool.completed", { requestId: request.requestId });
      const output = request.result.textResultForLlm;
      this.outputs.push(output);
      this.memory ??= tokens(output)[0];
      const pending = /Process running with session ID (\d+)/.exec(output);
      if (pending) { this.poll(Number(pending[1])); return { success: true }; }
      this.advance(output);
      return { success: true };
    } } };
  }
  on(type, listener) { this.events.on(type, listener); return () => this.events.off(type, listener); }
  emit(type, data) { this.events.emit(type, { type, data }); }
  usage() { this.emit("assistant.usage", { model: this.config.model, inputTokens: 10, outputTokens: 5 }); }
  reply(content) {
    assert.equal(typeof content, "string");
    this.emit("assistant.turn_start", {}); this.usage();
    const messageId = randomUUID();
    for (const character of content) this.emit("assistant.message_delta", { messageId, deltaContent: character });
    this.emit("assistant.message", { messageId, content }); this.emit("assistant.turn_end", {}); this.emit("session.idle", {});
  }
  call(tool, args, { advance = true } = {}) {
    assert.ok(tool, `Missing native tool for ${this.id}; declared: ${this.config.tools.map(t => t.description?.split("\n")[0]).join(", ")}`);
    if (advance) this.step++;
    const call = { toolCallId: randomUUID(), name: tool.name, arguments: args };
    this.emit("assistant.turn_start", {}); this.usage();
    this.emit("assistant.message", { messageId: randomUUID(), content: "", toolRequests: [call] });
    queueMicrotask(() => this.emit("external_tool.requested", { ...call, requestId: `rpc-${call.toolCallId}`, toolName: call.name, sessionId: this.sessionId }));
  }
  shell(cmd, extra = {}) {
    const args = { cmd, login: false, max_output_tokens: 4000, yield_time_ms: 10000, ...extra };
    const direct = this.config.tools.find(t => t.parameters?.properties?.cmd);
    const tool = direct ?? this.config.tools.find(t => t.parameters?.properties?.input && t.description.includes("exec_command"));
    this.call(tool, direct ? args : { input: `const r = await tools.exec_command(${JSON.stringify(args)}); text(r);` });
  }
  poll(session_id) {
    const args = { session_id, chars: "", yield_time_ms: 1000, max_output_tokens: 4000 };
    const direct = this.config.tools.find(t => t.parameters?.properties?.session_id && !t.parameters?.properties?.cmd);
    const tool = direct ?? this.config.tools.find(t => t.parameters?.properties?.input && t.description.includes("write_stdin"));
    this.call(tool, direct ? args : { input: `const r = await tools.write_stdin(${JSON.stringify(args)}); text(r);` }, { advance: false });
  }
  patch(input) {
    const direct = this.config.tools.find(t => t.parameters?.properties?.input && /apply_patch|\*\*\* Begin Patch/.test(t.description) && !t.description.includes("exec_command"));
    const tool = direct ?? this.config.tools.find(t => t.parameters?.properties?.input && t.description.includes("tools: { apply_patch"));
    this.call(tool, { input: direct ? input : `const r = await tools.apply_patch(${JSON.stringify(input)}); text(r);` });
  }
  named(name, args) {
    const tool = this.config.tools.find(t => t.description?.split("\n")[0].includes(name));
    this.call(tool, args);
  }
  advance(output) {
    if (this.id === "C02") {
      const values = tokens(this.outputs.join("\n")); assert.equal(values.length, 3, "Skill guide/helper must be read/executed by native Codex");
      this.reply(`CHILD MODE=SAFE ${values.join(" ")}`);
    } else if (this.id === "C04" && this.step === 1) this.shell("node app.mjs && git diff --check");
    else if (this.id === "C05" && this.step === 1) this.patch("*** Begin Patch\n*** Update File: discount.mjs\n@@\n-export function discount(price, percent) { return price * (100 - percent); }\n+export function discount(price, percent) { return price * (100 - percent) / 100; }\n*** End Patch");
    else if (this.id === "C05" && this.step === 2) this.shell("node --test");
    else if (this.id === "C06") {
      if (this.step === 1) this.named("list_mcp_resources", { server: "fixture" });
      else if (this.step === 2) this.named("read_mcp_resource", { server: "fixture", uri: "fixture://config" });
      else if (this.step === 3) this.named("mcp__fixture", { key: "missing" });
      else if (this.step === 4) { assert.match(output, /ENOENT/); this.named("mcp__fixture", { key: "selected" }); }
      else { const values = tokens(this.outputs.join("\n")); assert.equal(values.length, 3); this.reply(values.join(" ")); }
    } else if (this.id === "C10" && this.step === 1) this.named("counter", {});
    else this.reply(this.final(output));
  }
  final(output) {
    if (this.id === "C01") { assert.ok(this.memory); return this.memory; }
    if (this.id === "C03") return JSON.stringify({ path: "src/주문 계산.mjs", line: 2, value: this.memory, empty: true,
      review: { path: "review.mjs", line: 3, operator: "<=", replacement: "<", input: [7], expected: 7 } });
    if (this.id === "C09") return `${this.memory} ${this.color}`;
    if (this.id === "C10") return `${this.memory} receipt:${this.memory}`;
    return output;
  }
  async send({ prompt }) {
    // Resume may recover memory only from the history delivered to this session.
    this.memory ??= tokens(prompt)[0];
    let latest = prompt;
    const history = /<conversation_history>\n([\s\S]*?)\n<\/conversation_history>/.exec(prompt);
    if (history) latest = JSON.parse(history[1]).findLast(i => i.type === "message" && i.role === "user")?.content ?? prompt;
    if (this.id === "C01") this.shell("cat secret.txt");
    else if (this.id === "C02") this.shell("cat note.txt ../.agents/skills/fixture-check/guide.txt; node ../.agents/skills/fixture-check/helper.mjs");
    else if (this.id === "C03") this.shell("grep -n targetPrice src/*; cat 'src/주문 계산.mjs'; wc -c empty.txt; git diff -- review.mjs");
    else if (this.id === "C04") this.patch(REFACTOR);
    else if (this.id === "C05") this.shell("node --test");
    else if (this.id === "C06") this.named("alpha.lookup", { key: "한글", ids: [2, 1], enabled: false, note: null });
    else if (this.id === "C07") {
      const command = /exactly this command:\n([^\n]+)/.exec(latest)?.[1]; assert.ok(command);
      this.shell(command, { sandbox_permissions: "require_escalated", justification: "Execute only the owned fixture command?" });
    } else if (this.id === "C08") this.shell("node sandbox-probe.mjs");
    else if (this.id === "C09") {
      if (/Read memory\.txt/.test(latest)) { this.color = "BLUE"; this.shell("cat memory.txt"); }
      else if (/Read other\.txt/.test(latest)) { this.color = "RED"; this.shell("cat other.txt"); }
      else { if (latest.includes("GREEN")) this.color = "GREEN"; assert.ok(this.memory); this.reply(this.final("")); }
    } else if (this.id === "C10") {
      if (/Read memory\.txt/.test(latest)) this.shell("cat memory.txt");
      else { assert.ok(this.memory, "Native resume omitted memory"); this.reply(this.final("")); }
    } else throw new Error(`Unscripted case ${this.id}`);
    return randomUUID();
  }
  async setModel(model) { this.config.model = model; }
  async abort() {}
  async disconnect() {}
}
