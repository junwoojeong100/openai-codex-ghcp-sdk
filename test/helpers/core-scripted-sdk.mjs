import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// Mechanical protocol peer, NOT an LLM. No fs/network or oracle imports: all
// hidden values must come back through real Codex tool results/native history.
export class CoreScriptedSdk {
  constructor(scenarioId) { this.scenarioId = scenarioId; this.sessions = []; }
  async start() {}
  async ping() { return { message: "ready" }; }
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
      // An interrupted native call can return its result and the next user
      // turn together. Consume only the context actually supplied by the bridge.
      const context = /<new_client_context>\n([\s\S]*?)\n<\/new_client_context>/.exec(output);
      if (this.id === "C15" && context) {
        const next = JSON.parse(context[1]).findLast(i => i.type === "message" && i.role === "user")?.content;
        assert.equal(typeof next, "string");
        assert.match(next, /^Read recovery\.txt/);
        await this.send({ prompt: next });
        return { success: true };
      }
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
    const legacy = this.config.tools.find(t => t.parameters?.properties?.command);
    if (!direct && !tool && legacy) {
      this.call(legacy, { command: legacy.parameters.properties.command.type === "array" ? ["/bin/sh", "-c", cmd] : cmd, timeout_ms: 20000 });
    } else this.call(tool, direct ? args : { input: `const r = await tools.exec_command(${JSON.stringify(args)}); text(r);` });
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
  agentOperation(operation, agentId) {
    const tool = this.config.tools.find(t => t.description?.split("\n")[0].includes(operation));
    assert.ok(tool, `Missing native agent operation: ${operation}`);
    const fields = tool.parameters.properties;
    // The pinned runtime advertises targets/target; older native profiles
    // advertise ids/id. Derive arguments from the actual declared schema.
    if (operation === "wait") {
      const key = fields.targets ? "targets" : fields.ids ? "ids" : null;
      assert.ok(key, "Unknown native wait schema");
      this.call(tool, { [key]: [agentId], timeout_ms: 10000 });
    } else {
      const key = fields.target ? "target" : fields.id ? "id" : null;
      assert.ok(key, "Unknown native close schema");
      this.call(tool, { [key]: agentId });
    }
  }
  advance(output) {
    if (this.id === "C02") {
      const values = tokens(this.outputs.join("\n")); assert.equal(values.length, 3, "Skill guide/helper must be read/executed by native Codex");
      this.reply(`CHILD MODE=SAFE ${values.join(" ")}`);
    } else if (this.id === "C04" && this.step === 1) this.shell("node app.mjs && git diff --check");
    else if (this.id === "C05" && this.step === 1) this.patch("*** Begin Patch\n*** Update File: discount.mjs\n@@\n-export function discount(price, percent) { return price * (100 - percent); }\n+export function discount(price, percent) { return price * (100 - percent) / 100; }\n*** End Patch");
    else if (this.id === "C05" && this.step === 2) this.shell("node --test");
    else if (["C06", "C16"].includes(this.id)) {
      const step = this.step + (this.id === "C16" ? 1 : 0);
      if (step === 1) this.named("list_mcp_resources", { server: "fixture" });
      else if (step === 2) this.named("read_mcp_resource", { server: "fixture", uri: "fixture://config" });
      else if (step === 3) this.named("mcp__fixture", { key: "missing" });
      else if (step === 4) { assert.match(output, /ENOENT/); this.named("mcp__fixture", { key: "selected" }); }
      else { const values = tokens(this.outputs.join("\n")); assert.equal(values.length, this.id === "C16" ? 2 : 3); this.reply(values.join(" ")); }
    } else if (this.id === "C10" && this.step === 1) this.named("counter", {});
    else if (this.id === "C17" && !this.child) {
      if (this.step === 1) {
        this.agentId = /"agent_id"\s*:\s*"([^"\s]+)"/.exec(output)?.[1]; assert.ok(this.agentId, output);
        this.agentOperation("wait", this.agentId);
      } else if (this.step === 2) { assert.ok(tokens(output).length, output); this.agentOperation("close_agent", this.agentId); }
      else this.reply(this.memory);
    } else this.reply(this.final(output));
  }
  final(output) {
    if (["C01", "C11", "C14", "C15", "C17", "C18"].includes(this.id)) { assert.ok(this.memory); return this.memory; }
    if (this.id === "C12") {
      const cwd = /^\/[^\r\n]+/m.exec(output)?.[0]; assert.ok(cwd, output); assert.match(output, /i <= items\.length/);
      return JSON.stringify({ findings: [{ title: "[P1] Fix the off-by-one bounds error", body: "The <= comparison reads past items.length and produces NaN; use < instead.", confidence_score: 1, code_location: { absolute_file_path: `${cwd}/review.mjs`, line_range: { start: 3, end: 3 } } }], overall_correctness: "patch is incorrect", overall_explanation: "Bounds error", overall_confidence_score: 1 });
    }
    if (this.id === "C13") return `<proposed_plan>
Use release code ${tokens(output)[0]} without changing files.
</proposed_plan>`;
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
    if (["C01", "C11", "C18"].includes(this.id)) this.shell("cat secret.txt");
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
    } else if (this.id === "C12") this.shell("pwd; git -c color.ui=false diff -- review.mjs");
    else if (this.id === "C13") this.named("request_user_input", { questions: [{ id: "release_code", header: "Release code", question: "Which release code should this plan use?", isOther: true, options: [{ label: "Canary", description: "Use a gradual rollout." }, { label: "Full", description: "Use one rollout." }] }] });
    else if (this.id === "C14") {
      if (/^Read memory\.txt/.test(latest)) this.shell("cat memory.txt");
      else if (latest.includes("irrelevant padding")) this.reply("ACK");
      else { assert.ok(this.memory, "Compacted native history lost the nonce"); this.reply(this.memory); }
    } else if (this.id === "C15") this.shell(/^Read recovery\.txt/.test(latest) ? "cat recovery.txt" : "node long-task.mjs");
    else if (this.id === "C16") this.named("list_mcp_resources", { server: "fixture" });
    else if (this.id === "C17") {
      this.child = !latest.includes("Use spawn_agent");
      if (this.child) this.shell("cat child.txt");
      else this.named("spawn_agent", { agent_type: "default", message: "Read child.txt with a native shell tool and return its exact contents. Do not edit files." });
    } else throw new Error(`Unscripted case ${this.id}`);
    return randomUUID();
  }
  async setModel(model) { this.config.model = model; }
  async abort() {}
  async disconnect() {}
}
