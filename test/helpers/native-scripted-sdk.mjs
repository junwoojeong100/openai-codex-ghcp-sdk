import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ValidationSdk, ValidationSession } from "./validation-sdk.mjs";

// Deliberately NOT a model. This fixture only translates the catalog's exact
// bounded command prompts into a native shell tool call, then echoes the real
// tool output. Real Codex still executes the command in its isolated sandbox.
// It can validate driver/protocol mechanics, never model behavior/compatibility.
export class ScriptedNativeSdk extends ValidationSdk {
  async createSession(config) {
    const session = new ScriptedNativeSession(config);
    this.sessions.push(session);
    return session;
  }
}
class ScriptedNativeSession extends ValidationSession {
  constructor(config) {
    super(config);
    this.rpc.tools.handlePendingToolCall = async (request) => {
      this.emit("external_tool.completed", { requestId: request.requestId });
      const raw = request.result.textResultForLlm;
      let output = raw;
      try {
        const data = JSON.parse(raw);
        if (typeof data.output === "string") output = data.output;
      } catch { /* Native unified-exec text envelope. */ }
      const markers = [...output.matchAll(/(?:Final output|Output):\r?\n/g)];
      if (markers.length) output = output.slice(markers.at(-1).index + markers.at(-1)[0].length);
      output = output.trim();
      try { const nested = JSON.parse(output); if (typeof nested.output === "string") output = nested.output.trim(); }
      catch { /* The captured command output may itself be non-JSON. */ }
      const expectedFailure = /(?:[Rr]eply|[Rr]eturn)(?: with)? exactly ([A-Z][A-Z_]+)\b/.exec(this.prompt);
      if (expectedFailure && /ENOENT|SyntaxError|Error:|CONFLICT|NO_MATCH|exit (?:code|status):?\s*[1-9]|Process exited with code [1-9]/i.test(raw)) output = expectedFailure[1];
      if (this.operation === "patch") {
        assert.ok(expectedFailure, "Patch fixture needs an exact expected response.");
        const rejected = /failed|not find|context|verification/i.test(raw);
        if (expectedFailure[1] === "CONFLICT") assert.ok(rejected, "Stale patch unexpectedly succeeded.");
        else assert.ok(!rejected && /FIXTURE_PATCH_APPLIED|Success|Updated the following files/.test(raw), "Patch lacks a success receipt.");
        output = expectedFailure[1];
      }
      const expectedPatchConflict = this.operation === "patch" && expectedFailure?.[1] === "CONFLICT" &&
        /apply_patch verification failed/i.test(raw);
      assert.ok(!/Script failed/i.test(raw) || expectedPatchConflict, "Native exec cell failed; do not fabricate its result.");
      assert.ok(output, `The scripted SDK cannot infer an answer from empty tool output: ${raw.slice(0, 150)}`);
      this.marker = output;
      this.reply(output);
      return { success: true };
    };
  }
  async send({ prompt }) {
    const envelope = prompt;
    const history = /<conversation_history>\n([\s\S]*)\n<\/conversation_history>/.exec(prompt);
    if (history) {
      const items = JSON.parse(history[1]);
      const latest = items.findLast((item) => item.type === "message" && item.role === "user");
      assert.equal(typeof latest?.content, "string", "Missing latest user prompt in replay fixture.");
      prompt = latest.content;
    }
    this.prompt = prompt;
    const patch = /\*\*\* Begin Patch\n[\s\S]*?\*\*\* End Patch/.exec(prompt)?.[0];
    this.operation = patch ? "patch" : "command";
    if (patch) {
      const directPatch = this.config.tools.find(({ parameters, description }) => parameters?.properties?.input &&
        !description.includes("exec_command") && /apply_patch|\*\*\* Begin Patch/.test(description));
      const tool = directPatch ?? this.config.tools.find(({ parameters, description }) => parameters?.properties?.input && description.includes("tools: { apply_patch"));
      assert.ok(tool, "Native apply_patch was not declared.");
      return this.callTool(tool, { input: directPatch ? patch : `await tools.apply_patch(${JSON.stringify(patch)}); text("FIXTURE_PATCH_APPLIED");` });
    }
    const command = /exact command from the current (?:workspace|working directory):\n([^\n]+)/.exec(prompt);
    if (!command) {
      if (!this.marker) {
        // A new SDK session may receive serialized completed native history.
        // The fixture can replay a previously supplied marker, never read files
        // independently or manufacture a hidden value.
        this.marker = envelope.match(/fixture-[a-f0-9-]+-한글/)?.[0];
      }
      assert.ok(this.marker && /repeat|recall/i.test(prompt), `Unscripted native prompt: ${prompt.slice(-200)}`);
      this.reply(this.marker); return "offline-recall";
    }
    const direct = this.config.tools.find(({ parameters }) => parameters?.properties?.cmd);
    const tool = direct ?? this.config.tools.find(({ parameters, description }) => parameters?.properties?.input && description.includes("exec_command"));
    assert.ok(tool, "The native client did not declare a supported shell tool surface.");
    const args = { cmd: command[1], max_output_tokens: 8192, yield_time_ms: 1000, login: false };
    return this.callTool(tool, direct ? args : { input: `const result = await tools.exec_command(${JSON.stringify(args)}); text(result);` });
  }
  callTool(tool, args) {
    const call = { toolCallId: `native-${randomUUID()}`, name: tool.name, arguments: args };
    this.emit("assistant.turn_start", {}); this.usage();
    this.emit("assistant.message", { messageId: `m${++this.next}`, content: "", toolRequests: [call] });
    queueMicrotask(() => this.emit("external_tool.requested", { ...call, requestId: `rpc-${call.toolCallId}`, toolName: call.name, sessionId: this.sessionId }));
    return "offline-native-command";
  }
}
