import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "../src/session-manager.mjs";
import { normalizeRequest } from "../src/request-policy.mjs";
import { FakeClient, headers, model } from "./helpers/stability-sdk.mjs";

const body = (input = "Recall the project label.", options = {}) => ({ model, input, ...options });
const tool = { type: "function", name: "lookup", parameters: { type: "object", properties: {} } };
const failure = { source: "top_level", failureKind: "transport", model };
const terminal = { errorType: "query", message: "private upstream error; no message parsing is needed" };
const fail = session => {
  session.emit("model.call_failure", failure);
  session.emit("session.error", terminal);
};

async function setup(t, options = {}, clientOptions = {}) {
  const client = new FakeClient(clientOptions), diagnostics = [];
  const manager = new SessionManager({ client, turnTimeoutMs: 1000, requestTimeoutMs: 1500,
    turnFirstProgressTimeoutMs: 500, turnIdleTimeoutMs: 500, startupTimeoutMs: 200,
    cleanupTimeoutMs: 30, readinessTimeoutMs: 50, readinessIntervalMs: 60_000,
    onDiagnostic: row => diagnostics.push(row), ...options });
  await manager.start();
  t.after(() => manager.stop());
  return { manager, client, diagnostics };
}

test("an acknowledged transport failure preserves history, instructions and the successful response cache", async t => {
  let sends = 0, ready = 0;
  const { manager, client, diagnostics } = await setup(t, {}, { onSend: session => {
    if (++sends === 1) session.reply("acknowledged");
    else if (sends === 2) setImmediate(() => fail(session));
    else session.reply("PROJECT_LABEL");
  } });
  await manager.execute(body("Remember PROJECT_LABEL.", { instructions: "private trusted policy", reasoning: { effort: "high" } }),
    headers("recall"), { responseId: "resp_before" });
  const request = body("Recall the project label.", { previous_response_id: "resp_before", reasoning: { effort: "high" } });
  const result = await manager.execute(request, headers("recall"), { responseId: "resp_recovered", onReady: () => ready++ });
  assert.equal(result.messages[0].content, "PROJECT_LABEL");
  assert.equal(ready, 1);
  assert.equal(client.sessions.length, 2);
  assert.equal(client.sessions[0].aborted, 1);
  assert.equal(client.sessions[0].disconnected, 1);
  assert.equal(client.deleted.length, 1);
  assert.equal(client.sessions[1].config.systemMessage.content, "private trusted policy");
  assert.equal(client.sessions[1].config.reasoningEffort, "high");
  const prompt = client.sessions[1].sent[0].prompt;
  assert.match(prompt, /Remember PROJECT_LABEL/);
  assert.equal(prompt.split("Recall the project label.").length, 2);
  assert.ok(prompt.endsWith("Current user request:\nRecall the project label."));
  const recovery = diagnostics.find(row => row.event === "bridge.turn_recovering");
  assert.equal(recovery.cause, "copilot_transport_error");
  assert.equal(recovery.sessionId, client.sessions[0].sessionId);
  assert.equal(recovery.requestId, "resp_recovered");
  assert.doesNotMatch(JSON.stringify(diagnostics), /private/);
  assert.deepEqual(await manager.execute(request, headers("recall")), result);
  assert.equal(sends, 3);
});

const unclassified = [
  ["query without transport metadata", session => session.emit("session.error", terminal)],
  ["API failure", session => { session.emit("model.call_failure", { ...failure, failureKind: "api", statusCode: 503 }); session.emit("session.error", terminal); }],
  ["mixed API and transport", session => { session.emit("model.call_failure", { ...failure, failureKind: "api", statusCode: 401 }); fail(session); }],
  ["API failure in a prior dispatch", session => {
    session.emit("model.call_failure", { ...failure, failureKind: "api", statusCode: 400 });
    session.emit("assistant.turn_start", { turnId: "another" }); fail(session);
  }],
  ["unknown transport status", session => { session.emit("model.call_failure", { ...failure, statusCode: 0 }); session.emit("session.error", terminal); }],
  ["child failure", session => { session.emit("model.call_failure", failure, { agentId: "child" }); session.emit("session.error", terminal); }],
  ["sampling failure", session => { session.emit("model.call_failure", { ...failure, source: "mcp_sampling" }); session.emit("session.error", terminal); }],
  ["fusion failure", session => { session.emit("model.call_failure", { ...failure, fusion: { phaseId: "other" } }); session.emit("session.error", terminal); }],
  ["other model", session => { session.emit("model.call_failure", { ...failure, model: "gpt-6-sol" }); session.emit("session.error", terminal); }],
  ["stale failure", session => { session.emit("model.call_failure", failure); session.emit("assistant.turn_start", { turnId: "new" }); session.emit("session.error", terminal); }],
  ...["authentication", "authorization", "rate_limit", "quota", "context_limit"].map(errorType => [errorType, session => {
    session.emit("model.call_failure", failure); session.emit("session.error", { ...terminal, errorType });
  }]),
  ["coded query", session => { session.emit("model.call_failure", failure); session.emit("session.error", { ...terminal, errorCode: "content_filter" }); }],
  ["query HTTP status", session => { session.emit("model.call_failure", failure); session.emit("session.error", { ...terminal, statusCode: 403 }); }],
];
for (const [name, emit] of unclassified) test(`transport recovery never guesses safety from a query message (${name})`, async t => {
  const { manager, client, diagnostics } = await setup(t, {}, { onSend: session => { setImmediate(() => emit(session)); } });
  await assert.rejects(manager.execute(body()));
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].sent.length, 1);
  assert.ok(!diagnostics.some(row => row.event === "bridge.turn_recovering"));
});

for (const mode of ["text", "message", "reasoning", "tool-input", "bytes", "usage", "fusion", "pending", "unacknowledged", "filter", "late-filter"]) {
  test(`transport recovery blocks partial, ambiguous or filtered work (${mode})`, async t => {
    const request = body("use lookup", { tools: [tool] });
    const { manager, client, diagnostics } = await setup(t, {}, { onSend: session => {
      setImmediate(() => {
        if (mode === "text") session.emit("assistant.message_delta", { deltaContent: "partial" });
        if (mode === "message") session.emit("assistant.message", { content: "partial" });
        if (mode === "reasoning") session.emit("assistant.reasoning_delta", { deltaContent: "private thought" });
        if (mode === "tool-input") session.emit("assistant.tool_call_delta", { inputDelta: "{" });
        if (mode === "bytes") session.emit("assistant.streaming_delta", { totalResponseSizeBytes: 1 });
        if (mode === "usage") session.emit("assistant.usage", { model, inputTokens: 1, outputTokens: 0 });
        if (mode === "fusion") {
          const phase = { conversationScope: "root", fusionId: "one", phaseId: "phase" };
          session.emit("assistant.fusion_phase_started", phase);
          session.emit("assistant.fusion_phase_activity", { ...phase, activity: "model_output", totalResponseSizeBytes: 1 });
        }
        if (mode === "pending") session.emit("external_tool.requested", { sessionId: session.sessionId,
          requestId: "pending", toolCallId: "call", toolName: normalizeRequest(request).tools[0].name, arguments: {} });
        if (mode === "filter") session.emit("assistant.usage", { model, contentFilterTriggered: true });
        fail(session);
        if (mode === "late-filter") session.emit("assistant.usage", { model, contentFilterTriggered: true });
      });
      if (mode === "unacknowledged") return new Promise(() => {});
    } });
    await assert.rejects(manager.execute(request));
    assert.equal(client.sessions.length, 1);
    assert.equal(client.sessions[0].sent.length, 1);
    assert.ok(!diagnostics.some(row => row.event === "bridge.turn_recovering"));
  });
}

for (const mode of ["transport", "idle-first", "transport-first", "disabled"]) {
  test(`idle and transport failures share one finite attempt budget (${mode})`, async t => {
    let sends = 0;
    const { manager, client, diagnostics } = await setup(t, { turnFirstProgressTimeoutMs: 35,
      turnIdleRecoveryAttempts: mode === "disabled" ? 0 : 1 }, { onSend: session => {
      sends++;
      if (mode === "idle-first" && sends === 1 || mode === "transport-first" && sends === 2) return;
      setImmediate(() => fail(session));
    } });
    await assert.rejects(manager.execute(body()), error => {
      assert.match(error.message, mode === "disabled" ? /disabled/ : /exhausted after 1 attempt/);
      return true;
    });
    assert.equal(client.sessions.length, mode === "disabled" ? 1 : 2);
    assert.equal(sends, client.sessions.length);
    assert.ok(!diagnostics.some(row => row.event === "bridge.turn_recovered"));
  });
}

for (const mode of ["abort", "disconnect", "delete", "readiness", "cancel", "late-tool"]) {
  test(`transport recovery requires confirmed cleanup and current ownership (${mode})`, async t => {
    const controller = new AbortController(), request = body("use lookup", { tools: [tool] });
    const { manager, client, diagnostics } = await setup(t, {}, { onSend: session => {
      if (["abort", "disconnect"].includes(mode)) session[mode] = async () => { throw new Error("cleanup failed"); };
      if (mode === "delete") session.client.deleteSession = async () => { throw new Error("cleanup failed"); };
      if (mode === "readiness") session.client.ping = async () => { throw new Error("connection lost"); };
      if (mode === "cancel") session.abort = async () => controller.abort();
      setImmediate(() => {
        fail(session);
        if (mode === "late-tool") session.emit("external_tool.requested", { sessionId: session.sessionId,
          requestId: "pending", toolCallId: "call", toolName: normalizeRequest(request).tools[0].name, arguments: {} });
      });
    } });
    await assert.rejects(manager.execute(request, {}, { signal: controller.signal }));
    await manager.queue.drain();
    assert.equal(client.sessions.length, 1);
    assert.ok(!diagnostics.some(row => row.event === "bridge.turn_recovering"));
  });
}

for (const limit of ["turn", "request"]) test(`transport recovery cannot reset the absolute ${limit} deadline`, async t => {
  let sends = 0, timer;
  t.after(() => clearTimeout(timer));
  const { manager, client } = await setup(t, limit === "turn" ? { turnTimeoutMs: 120 } : { requestTimeoutMs: 120 }, {
    onSend: session => { if (++sends === 1) timer = setTimeout(() => fail(session), 75); },
  });
  const started = Date.now();
  await assert.rejects(manager.execute(body()), { code: limit === "turn" ? "copilot_timeout" : "request_timeout" });
  assert.ok(Date.now() - started < 220);
  assert.equal(client.sessions.length, 2);
  assert.equal(sends, 2);
});

test("transport recovery never resubmits an acknowledged tool-result RPC", async t => {
  const request = body("use lookup", { tools: [tool] });
  let sends = 0;
  const { manager, client } = await setup(t, {}, {
    onSend: session => {
      if (++sends === 1) session.toolCalls([{ toolCallId: "once", name: normalizeRequest(request).tools[0].name, arguments: {} }]);
      else session.reply("completed from saved result");
    },
    onSubmit: session => { setImmediate(() => fail(session)); },
  });
  await manager.execute(request, headers("tool"), { responseId: "resp_tool" });
  const next = body([{ type: "function_call_output", call_id: "once", output: "synthetic result" }], { previous_response_id: "resp_tool" });
  const result = await manager.execute(next, headers("tool"), { responseId: "resp_final" });
  assert.equal(result.messages[0].content, "completed from saved result");
  assert.deepEqual(client.sessions.map(session => session.submitted.length), [1, 0]);
  assert.match(client.sessions[1].sent[0].prompt, /synthetic result/);
  assert.deepEqual(await manager.execute(next, headers("tool")), result);
  assert.equal(sends, 2);
});

test("an unacknowledged tool-result delivery is never replayed after a transport error", async t => {
  const request = body("use lookup", { tools: [tool] });
  const { manager, client } = await setup(t, {}, {
    onSend: session => session.toolCalls([{ toolCallId: "uncertain", name: normalizeRequest(request).tools[0].name, arguments: {} }]),
    onSubmit: session => { setImmediate(() => fail(session)); return new Promise(() => {}); },
  });
  await manager.execute(request, headers("uncertain"));
  await assert.rejects(manager.execute(body([{ type: "function_call_output", call_id: "uncertain", output: "synthetic result" }]),
    headers("uncertain")), /input_unacknowledged|pending_tool_calls/);
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].submitted.length, 1);
});
