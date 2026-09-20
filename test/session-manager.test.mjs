import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { SessionManager, aggregateUsage } from "../src/session-manager.mjs";
import { normalizeRequest } from "../src/request-policy.mjs";
import { outputItems } from "../src/responses.mjs";

const model = "gpt-6-astra";
const functionTool = {
  type: "function", name: "read_file", description: "Read a file.",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};
const customTool = { type: "custom", name: "apply_patch", description: "Apply a patch.", format: { type: "text" } };
const headers = (id) => ({ "session-id": id, "thread-id": id });
const message = (content, messageId = "m1") => ({ messageId, content });

class FakeSession {
  constructor(config, client) {
    this.config = config;
    this.client = client;
    this.sessionId = config.sessionId;
    this.events = new EventEmitter();
    this.sent = [];
    this.submitted = [];
    this.switched = [];
    this.aborted = 0;
    this.disconnected = 0;
    this.turnNumber = 0;
    this.rpc = {
      tools: {
        handlePendingToolCall: async (request) => {
          this.submitted.push(request);
          this.emit("external_tool.completed", { requestId: request.requestId });
          await this.client.onSubmit?.(this, request);
          return { success: true };
        },
      },
    };
  }

  on(type, listener) {
    this.events.on(type, listener);
    return () => this.events.off(type, listener);
  }

  emit(type, data, extra = {}) {
    this.events.emit(type, { type, data, ...extra });
  }

  async send(options) {
    this.sent.push(options);
    if (this.client.onSend) await this.client.onSend(this, options);
    else this.reply(`reply:${options.prompt}`);
    return "user-message-id";
  }

  reply(content) {
    const messageId = `m${++this.turnNumber}`;
    this.emit("assistant.turn_start", {});
    this.emit("assistant.message_delta", { messageId, deltaContent: content });
    this.emit("assistant.usage", { model, inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 });
    this.emit("assistant.message", message(content, messageId));
    this.emit("assistant.turn_end", {});
    this.emit("session.idle", {});
  }

  toolCalls(requests, { pendingFirst = false } = {}) {
    const emitPending = () => {
      for (const request of requests) {
        this.emit("external_tool.requested", {
          requestId: `rpc-${request.toolCallId}`,
          toolCallId: request.toolCallId,
          toolName: request.name,
          arguments: request.arguments,
          sessionId: this.sessionId,
        });
      }
    };
    this.emit("assistant.turn_start", {});
    if (pendingFirst) emitPending();
    this.emit("assistant.message", { messageId: `m${++this.turnNumber}`, content: "", toolRequests: requests });
    if (!pendingFirst) queueMicrotask(emitPending);
  }

  async abort() { this.aborted += 1; }
  async disconnect() { this.disconnected += 1; }
  async setModel(id, options) { this.switched.push({ id, options }); }
}

class FakeClient {
  constructor({ onSend, onSubmit, createSession, models } = {}) {
    Object.assign(this, { onSend, onSubmit, createOverride: createSession });
    this.models = models || [{ id: model, capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ["low", "high"] }];
    this.sessions = [];
    this.deleted = [];
    this.stopped = false;
  }
  async start() {}
  async listModels() { return this.models; }
  async createSession(config) {
    const session = new FakeSession(config, this);
    this.sessions.push(session);
    await this.createOverride?.(session);
    return session;
  }
  async deleteSession(id) { this.deleted.push(id); }
  async stop() { this.stopped = true; return []; }
  async forceStop() { this.stopped = true; }
}

async function setup(t, options = {}, clientOptions = {}) {
  const client = new FakeClient(clientOptions);
  const manager = new SessionManager({ client, turnTimeoutMs: 500, pendingToolWaitMs: 100, cleanupTimeoutMs: 100, ...options });
  await manager.start();
  t.after(() => manager.stop());
  return { manager, client };
}

function body(input = "hello", options = {}) { return { model, input, ...options }; }
function call(request, index, id, args) {
  return { toolCallId: id, name: normalizeRequest(request).tools[index].name, arguments: args };
}

test("empty mode exposes only handlerless client tools and denies SDK permissions", async (t) => {
  const { manager, client } = await setup(t);
  const seen = [];
  const result = await manager.execute(body([
    { role: "developer", content: "Follow the client's instructions." },
    { role: "user", content: "hello" },
  ], { instructions: "Base instruction", tools: [functionTool] }), headers("one"), { onEvent: (event) => seen.push(event) });
  const config = client.sessions[0].config;
  assert.deepEqual(config.availableTools, config.tools.map((tool) => `custom:${tool.name}`));
  assert.equal(config.tools[0].handler, undefined);
  assert.equal(config.tools[0].skipPermission, true);
  assert.equal(config.onPermissionRequest({}).kind, "reject");
  assert.equal(config.systemMessage.mode, "replace");
  assert.equal(config.systemMessage.content, "Base instruction\n\nFollow the client's instructions.");
  assert.deepEqual(config.infiniteSessions, { enabled: false });
  assert.equal(config.skipCustomInstructions, true);
  assert.equal(result.messages[0].content, "reply:hello");
  assert.equal(result.usage.total_tokens, 13);
  assert.equal(seen.length, 1);
});

test("full-history turns reuse one session and send only the new user message", async (t) => {
  const { manager, client } = await setup(t);
  const first = await manager.execute(body(), headers("one"));
  const input = [{ role: "user", content: "hello" }, ...outputItems(first.messages, first.tools), { role: "user", content: "next" }];
  const next = await manager.execute(body(input), headers("one"));
  assert.equal(client.sessions.length, 1);
  assert.deepEqual(client.sessions[0].sent.map((entry) => entry.prompt), ["hello", "next"]);
  assert.equal(next.messages[0].content, "reply:next");
});

test("anonymous requests are isolated and named sessions do not share histories", async (t) => {
  const { manager, client } = await setup(t);
  await Promise.all([
    manager.execute(body("one")), manager.execute(body("two")),
    manager.execute(body("three"), headers("three")), manager.execute(body("four"), headers("four")),
  ]);
  assert.equal(client.sessions.length, 4);
  assert.equal(new Set(client.sessions.map((session) => session.sessionId)).size, 4);
});

test("previous_response_id continues a session, rejects cross-session and stale references", async (t) => {
  const { manager, client } = await setup(t);
  await manager.execute(body(), headers("one"), { responseId: "resp_first" });
  await assert.rejects(manager.execute(body("no", { previous_response_id: "resp_first" }), headers("two")), { code: "session_mismatch" });
  await manager.execute(body("next", { previous_response_id: "resp_first" }), {}, { responseId: "resp_second" });
  await assert.rejects(manager.execute(body("different", { previous_response_id: "resp_first" })), { code: "stale_response" });
  await assert.rejects(manager.execute(body("no", { previous_response_id: "resp_missing" })), { code: "response_not_found" });
  assert.equal(client.sessions.length, 1);
  assert.deepEqual(client.sessions[0].sent.map((entry) => entry.prompt), ["hello", "next"]);
});

test("simultaneous retries in one family are serialized and do not resend the prompt", async (t) => {
  const { manager, client } = await setup(t);
  const [first, second] = await Promise.all([
    manager.execute(body(), headers("one"), { responseId: "resp_one" }),
    manager.execute(body(), headers("one"), { responseId: "resp_two" }),
  ]);
  assert.deepEqual(first, second);
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].sent.length, 1);
  await manager.execute(body("next", { previous_response_id: "resp_two" }));
  assert.equal(client.sessions[0].sent.length, 2);
});

test("function and custom calls wait for external request IDs, then submit all results once", async (t) => {
  const request = body("Use both tools.", { tools: [functionTool, customTool] });
  const raw = "*** Begin Patch\n*** Add File: example\n+sample\n*** End Patch\n";
  const { manager, client } = await setup(t, {}, {
    onSend: (session) => session.toolCalls([
      call(request, 0, "call_read", { path: "example" }), call(request, 1, "call_patch", { input: raw }),
    ]),
    onSubmit: (session) => { if (session.submitted.length === 2) session.reply("done"); },
  });
  const first = await manager.execute(request, headers("one"), { responseId: "resp_tools" });
  const output = outputItems(first.messages, first.tools);
  assert.equal(output.find((item) => item.type === "custom_tool_call").input, raw);
  const followup = body([
    { type: "function_call_output", call_id: "call_read", output: "file contents" },
    { type: "custom_tool_call_output", call_id: "call_patch", output: "applied" },
  ], { previous_response_id: "resp_tools" });
  const final = await manager.execute(followup, headers("one"), { responseId: "resp_done" });
  await manager.execute(followup, headers("one"), { responseId: "resp_retry" });
  assert.equal(final.messages[0].content, "done");
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].sent.length, 1);
  assert.deepEqual(client.sessions[0].submitted.map((entry) => [entry.requestId, entry.result.textResultForLlm]), [
    ["rpc-call_read", "file contents"], ["rpc-call_patch", "applied"],
  ]);
});

test("serial tool requests allow one call and continue after its real result", async (t) => {
  const request = body("Use one tool.", { tools: [functionTool], parallel_tool_calls: false });
  const { manager, client } = await setup(t, {}, {
    onSend: (session) => session.toolCalls([call(request, 0, "serial", { path: "example" })]),
    onSubmit: (session) => session.reply("done"),
  });
  const first = await manager.execute(request, headers("serial"), { responseId: "resp_serial" });
  assert.equal(outputItems(first.messages, first.tools).length, 1);
  const final = await manager.execute(body([
    { type: "function_call_output", call_id: "serial", output: "read result" },
  ], { previous_response_id: "resp_serial", parallel_tool_calls: false }), headers("serial"));
  assert.equal(final.messages[0].content, "done");
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].submitted.length, 1);
});

test("serial tool requests fail closed if the SDK emits multiple calls", async (t) => {
  const request = body("Use a tool.", { tools: [functionTool, customTool], parallel_tool_calls: false });
  const { manager, client } = await setup(t, {}, {
    onSend: (session) => session.toolCalls([
      call(request, 0, "one", {}), call(request, 1, "two", { input: "raw" }),
    ]),
  });
  await assert.rejects(manager.execute(request, headers("serial")), { status: 502, code: "parallel_tool_calls_violation" });
  assert.equal(client.sessions[0].submitted.length, 0);
  assert.equal(client.sessions[0].aborted, 1);
  assert.equal(client.sessions[0].disconnected, 1);
  assert.equal(client.deleted.length, 1);
  assert.equal(manager.states.size, 0);
  assert.equal(manager.callStates.size, 0);
});

test("full transcript custom tool follow-up retains namespace and raw argument bytes", async (t) => {
  const request = body("read it", { tools: [{ type: "namespace", name: "functions", tools: [customTool] }] });
  const raw = "first\n  second\n";
  const { manager, client } = await setup(t, {}, {
    onSend: (session) => session.toolCalls([call(request, 0, "call_raw", { input: raw })], { pendingFirst: true }),
    onSubmit: (session) => session.reply("read"),
  });
  const first = await manager.execute(request, headers("one"));
  const output = outputItems(first.messages, first.tools);
  assert.equal(output[0].namespace, "functions");
  await manager.execute(body([
    { role: "user", content: "read it" }, ...output,
    { type: "custom_tool_call_output", call_id: "call_raw", output: "ok" },
  ], { tools: request.tools }), headers("one"));
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].submitted.length, 1);
});

test("partial, duplicate, wrong-type and unknown tool results are rejected before any submission", async (t) => {
  const request = body("use tools", { tools: [functionTool] });
  const { manager, client } = await setup(t, {}, {
    onSend: (session) => session.toolCalls([call(request, 0, "a", {}), call(request, 0, "b", {})]),
    onSubmit: (session) => { if (session.submitted.length === 2) session.reply("ok"); },
  });
  await manager.execute(request, headers("one"), { responseId: "resp_tools" });
  const result = (id, type = "function_call_output") => ({ type, call_id: id, output: "ok" });
  for (const input of [[result("a")], [result("a"), result("a")], [result("a"), result("unknown")], [result("a", "custom_tool_call_output"), result("b")]]) {
    await assert.rejects(manager.execute(body(input, { previous_response_id: "resp_tools" }), headers("one")));
    assert.equal(client.sessions[0].submitted.length, 0);
  }
  await manager.execute(body([result("b"), result("a")], { previous_response_id: "resp_tools" }), headers("one"));
  assert.equal(client.sessions[0].submitted.length, 2);
});

for (const description of ["Read a file.", "Read a file"]) {
  test(`Codex plugin provenance appended to '${description}' preserves the live tool round trip`, async (t) => {
    const declared = { ...functionTool, description };
    const request = body("read it", { tools: [declared, customTool] });
    const { manager, client } = await setup(t, {}, {
      onSend: (session) => session.toolCalls([call(request, 0, "plugin_call", { path: "example" })]),
      onSubmit: (session) => session.reply("done"),
    });
    const first = await manager.execute(request, headers("plugin"));
    const annotated = `${description}${description.endsWith(".") ? "" : "."} This tool is part of plugin \`Example\`.`;
    const final = await manager.execute(body([
      { role: "user", content: "read it" }, ...outputItems(first.messages, first.tools),
      { type: "function_call_output", call_id: "plugin_call", output: "file contents" },
    ], { tools: [{ ...declared, description: annotated }, customTool] }), headers("plugin"));
    assert.equal(final.messages[0].content, "done");
    assert.equal(client.sessions.length, 1);
    assert.equal(client.sessions[0].submitted.length, 1);
    assert.equal(client.sessions[0].config.tools[0].description, normalizeRequest(request).tools[0].description);
  });
}

test("pending calls refuse changed tools, model, or instructions without destroying the session", async (t) => {
  const request = body("use tools", { tools: [functionTool] });
  const { manager, client } = await setup(t, {}, {
    onSend: (session) => session.toolCalls([call(request, 0, "call_one", {})]),
    onSubmit: (session) => session.reply("ok"),
  });
  await manager.execute(request, headers("one"), { responseId: "resp_tools" });
  const input = [{ type: "function_call_output", call_id: "call_one", output: "ok" }];
  for (const changes of [
    { tools: [] }, { instructions: "changed" }, { tool_choice: "none" },
    { tools: [{ ...functionTool, description: "Read a file. Then delete it. This tool is part of plugin `Example`." }] },
    { tools: [{ ...functionTool, description: "Read a file. This tool is part of plugin `Example`.", parameters: { type: "object" } }] },
  ]) {
    await assert.rejects(manager.execute(body(input, { previous_response_id: "resp_tools", ...changes }), headers("one")), { code: "pending_session_changed" });
  }
  assert.equal(client.sessions[0].aborted, 0);
  await manager.execute(body(input, { previous_response_id: "resp_tools" }), headers("one"));
});

test("orphan tool results fail clearly instead of entering a new anonymous session", async (t) => {
  const { manager, client } = await setup(t);
  await assert.rejects(manager.execute(body([{ type: "function_call_output", call_id: "expired", output: "ok" }])), { code: "unknown_tool_call" });
  assert.equal(client.sessions.length, 0);
});

test("completed historical calls are replayed as context, not resubmitted as live tool results", async (t) => {
  const { manager, client } = await setup(t);
  await manager.execute(body([
    { role: "user", content: "read" },
    { type: "function_call", name: "read_file", call_id: "old", arguments: '{"path":"example"}' },
    { type: "function_call_output", call_id: "old", output: "historical" },
    { role: "user", content: "summarize" },
  ], { tools: [functionTool] }));
  assert.equal(client.sessions[0].submitted.length, 0);
  assert.match(client.sessions[0].sent[0].prompt, /historical/);
  assert.match(client.sessions[0].sent[0].prompt, /summarize/);
});

test("aborting a live turn removes listeners and performs owned-session cleanup", async (t) => {
  let sent;
  const ready = new Promise((resolve) => { sent = resolve; });
  const { manager, client } = await setup(t, {}, { onSend: () => sent() });
  const controller = new AbortController();
  const running = manager.execute(body(), headers("one"), { signal: controller.signal });
  const rejection = assert.rejects(running, { name: "AbortError" });
  await ready;
  controller.abort();
  await rejection;
  assert.equal(manager.states.size, 0);
  assert.equal(client.sessions[0].aborted, 1);
  assert.equal(client.sessions[0].disconnected, 1);
  assert.equal(client.deleted.length, 1);
  assert.equal(client.sessions[0].events.eventNames().length, 0);
});

test("empty conversation and already-aborted requests do not create SDK sessions", async (t) => {
  const { manager, client } = await setup(t);
  await assert.rejects(manager.execute(body([{ role: "developer", content: "instructions only" }])), /no new conversation input/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(manager.execute(body(), {}, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(client.sessions.length, 0);
});

for (const action of ["disconnect", "shutdown"]) {
  test(`${action} during SDK session creation cancels promptly and cleans up a late session`, async (t) => {
    let release;
    let started;
    const creating = new Promise((resolve) => { started = resolve; });
    const pending = new Promise((resolve) => { release = resolve; });
    const { manager, client } = await setup(t, {}, { createSession: () => { started(); return pending; } });
    const controller = new AbortController();
    const running = manager.execute(body(), headers("creating"), { signal: controller.signal });
    const rejection = assert.rejects(running, { name: "AbortError" });
    await creating;
    const state = [...manager.states.values()][0];
    if (action === "shutdown") await manager.stop();
    else controller.abort();
    await rejection;
    assert.equal(manager.states.size, 0);
    assert.equal(client.sessions[0].sent.length, 0);
    release();
    await assert.rejects(state.creation, /creation was cancelled/);
    assert.equal(client.sessions[0].aborted, 1);
    assert.equal(client.sessions[0].disconnected, 1);
    assert.equal(client.deleted.length, 1);
  });
}

test("timeout and unexpected SDK tools fail and dispose the session", async (t) => {
  const timed = await setup(t, { turnTimeoutMs: 20 }, { onSend: () => {} });
  await assert.rejects(timed.manager.execute(body()), { code: "copilot_timeout" });
  assert.equal(timed.client.sessions[0].aborted, 1);
  const unknown = await setup(t, {}, {
    onSend: (session) => session.emit("external_tool.requested", { toolCallId: "bad", requestId: "bad", toolName: "builtin_shell" }),
  });
  await assert.rejects(unknown.manager.execute(body()), /did not declare/);
  assert.equal(unknown.client.sessions[0].aborted, 1);
});

test("state capacity evicts only idle sessions and expires response IDs", async (t) => {
  const { manager, client } = await setup(t, { maxStates: 1 });
  await manager.execute(body("first"), headers("one"), { responseId: "resp_first" });
  await manager.execute(body("second"), headers("two"));
  assert.equal(manager.states.size, 1);
  assert.equal(client.sessions[0].aborted, 1);
  await assert.rejects(manager.execute(body("next", { previous_response_id: "resp_first" })), { code: "response_not_found" });
});

test("SDK subagent text is not forwarded as the root assistant output", async (t) => {
  const forwarded = [];
  const { manager } = await setup(t, {}, {
    onSend: (session) => {
      session.emit("assistant.message_delta", { messageId: "hidden", deltaContent: "nested" }, { agentId: "subagent" });
      session.emit("assistant.message", message("nested", "hidden"), { agentId: "subagent" });
      session.reply("root");
    },
  });
  const result = await manager.execute(body(), {}, { onEvent: (event) => forwarded.push(event) });
  assert.deepEqual(result.messages.map((entry) => entry.content), ["root"]);
  assert.equal(forwarded.length, 1);
});

test("default replay limit accepts histories above the former 256 KiB cap", async (t) => {
  const { manager, client } = await setup(t);
  assert.equal(manager.maxReplayBytes, 256 * 1024 * 1024);
  const input = "x".repeat(256 * 1024 + 1);
  const result = await manager.execute(body(input), headers("large-history"));
  assert.equal(client.sessions[0].sent[0].prompt, input);
  assert.equal(result.messages[0].content, `reply:${input}`);
});

test("explicit history limits still count UTF-8 bytes rather than characters", async (t) => {
  const { manager, client } = await setup(t, { maxReplayBytes: 100 });
  const request = body("한".repeat(30));
  const serialized = JSON.stringify(normalizeRequest(request).input);
  assert.ok(serialized.length < 100);
  assert.ok(Buffer.byteLength(serialized) > 100);
  await assert.rejects(manager.execute(request), { status: 413, code: "history_too_large" });
  assert.equal(client.sessions.length, 0);
});

test("explicit history limits still include generated output", async (t) => {
  const { manager, client } = await setup(t, { maxReplayBytes: 100 }, {
    onSend: (session) => session.reply("x".repeat(100)),
  });
  await assert.rejects(manager.execute(body("hi")), { status: 413, code: "history_too_large" });
  assert.equal(client.sessions[0].sent.length, 1);
  assert.equal(client.sessions[0].aborted, 1);
  assert.equal(manager.states.size, 0);
});

test("history and model limits are checked before sending any prompt", async (t) => {
  const { manager, client } = await setup(t, { maxReplayBytes: 100 });
  await assert.rejects(manager.execute(body("x".repeat(100))), { code: "history_too_large" });
  await assert.rejects(manager.execute(body("hi", { model: "not-in-scope" })), { code: "model_unavailable" });
  assert.equal(client.sessions.length, 0);
});

test("usage is unknown without actual SDK counts and otherwise uses actual totals", () => {
  assert.equal(aggregateUsage([]), null);
  assert.equal(aggregateUsage([{ outputTokens: 2 }]), null);
  assert.deepEqual(aggregateUsage([{ inputTokens: 10, outputTokens: 4, cacheReadTokens: 3, reasoningTokens: 1 }]), {
    input_tokens: 10, output_tokens: 4, total_tokens: 14,
    input_tokens_details: { cached_tokens: 3 }, output_tokens_details: { reasoning_tokens: 1 },
  });
});
