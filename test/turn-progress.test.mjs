import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "../src/session-manager.mjs";
import { normalizeRequest } from "../src/request-policy.mjs";
import { FakeClient, headers, model } from "./helpers/stability-sdk.mjs";

async function setup(t, options = {}, clientOptions = {}) {
  const diagnostics = [], client = new FakeClient(clientOptions);
  const manager = new SessionManager({ client, turnTimeoutMs: 1000, requestTimeoutMs: 1500,
    turnFirstProgressTimeoutMs: 300, turnIdleTimeoutMs: 80, readinessIntervalMs: 20, cleanupTimeoutMs: 50,
    onDiagnostic: event => diagnostics.push(event), ...options });
  await manager.start();
  t.after(() => manager.stop());
  return { manager, client, diagnostics };
}
const body = input => ({ model, input });
const rootPhase = { conversationScope: "root", fusionId: "private-fusion-id", phaseId: "private-phase-id" };

test("production first-progress and streaming limits are independent and finite", () => {
  const manager = new SessionManager({ client: new FakeClient() });
  assert.equal(manager.turnFirstProgressTimeoutMs, 180_000);
  assert.equal(manager.turnIdleTimeoutMs, 90_000);
  assert.equal(manager.turnTimeoutMs, 300_000);
  assert.equal(manager.requestTimeoutMs, 360_000);
  for (const value of [0, -1, 0.5, NaN, Infinity, 2_147_483_648, "180000", null]) {
    assert.throws(() => new SessionManager({ client: new FakeClient(), turnFirstProgressTimeoutMs: value }), /turnFirstProgressTimeoutMs/);
  }
});

test("slow first progress completes on the original session instead of restarting prefill", async t => {
  let timer;
  t.after(() => clearTimeout(timer));
  const { manager, client, diagnostics } = await setup(t, {}, { onSend: session => {
    session.emit("assistant.turn_start", { turnId: "first" });
    timer = setTimeout(() => session.reply("delayed answer"), 180);
  } });
  assert.equal((await manager.execute(body("synthetic input"))).messages[0].content, "delayed answer");
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].sent.length, 1);
  assert.equal(client.sessions[0].aborted, 0);
  assert.ok(diagnostics.some(event => event.event === "bridge.turn_watchdog"
    && event.waitPhase === "first_progress" && event.idleMs >= 80 && event.timeoutMs === 300));
  assert.ok(!diagnostics.some(event => /turn_stalled|turn_recovering/.test(event.event)));
});

test("repeated turn-start metadata, heartbeats and model failures cannot extend the first-progress deadline", async t => {
  let timer;
  t.after(() => clearInterval(timer));
  const { manager, client, diagnostics } = await setup(t, {
    turnFirstProgressTimeoutMs: 100, turnIdleTimeoutMs: 30, turnIdleRecoveryAttempts: 0,
  }, { onSend: session => {
    session.emit("assistant.turn_start", { turnId: "initial" });
    timer = setInterval(() => {
      session.emit("assistant.turn_start", { turnId: "initial" });
      session.emit("session.usage_info", { currentTokens: 10 });
      session.emit("session.info", { infoType: "model", message: "private-retry-details" });
      session.emit("model.call_failure", { source: "top_level", failureKind: "transport", errorMessage: "private-error" });
    }, 15);
  } });
  await assert.rejects(manager.execute(body("private-input")), error => {
    assert.equal(error.code, "copilot_idle_timeout");
    assert.match(error.message, /after 100 ms/);
    assert.match(error.message, /phase: first_progress/);
    assert.match(error.message, /Last upstream failure: transport/);
    assert.doesNotMatch(error.message, /private-/);
    return true;
  });
  const stalled = diagnostics.find(event => event.event === "bridge.turn_stalled");
  assert.equal(stalled.waitPhase, "first_progress");
  assert.equal(stalled.lastActivity, "assistant.turn_start");
  assert.equal(client.sessions.length, 1);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-/);
});

test("after output begins the shorter streaming deadline still applies and never replays partial text", async t => {
  const { manager, client, diagnostics } = await setup(t, { turnIdleRecoveryAttempts: 3 }, { onSend: session => {
    session.emit("assistant.turn_start", {});
    session.emit("assistant.message_delta", { messageId: "partial", deltaContent: "already delivered" });
  } });
  await assert.rejects(manager.execute(body("partial turn")), { code: "copilot_idle_timeout" });
  const stalled = diagnostics.find(event => event.event === "bridge.turn_stalled");
  assert.equal(stalled.waitPhase, "streaming");
  assert.equal(stalled.timeoutMs, 80);
  assert.equal(diagnostics.find(event => event.event === "bridge.turn_recovery_skipped").reason, "output_started");
  assert.equal(client.sessions.length, 1);
});

test("root fusion phase byte progress is counted without forwarding private output", async t => {
  let timer;
  t.after(() => clearInterval(timer));
  const forwarded = [];
  const { manager, client, diagnostics } = await setup(t, { turnIdleTimeoutMs: 60 }, { onSend: session => {
    session.emit("assistant.turn_start", { turnId: "one" });
    session.emit("assistant.fusion_phase_started", rootPhase);
    let ticks = 0;
    timer = setInterval(() => {
      session.emit("assistant.fusion_phase_activity", { ...rootPhase, activity: "model_output", totalResponseSizeBytes: ++ticks * 100 });
      if (ticks === 6) {
        clearInterval(timer);
        session.emit("assistant.fusion_phase_completed", { ...rootPhase, status: "succeeded", content: "private-reasoning" });
        session.reply("public answer");
      }
    }, 25);
  } });
  assert.equal((await manager.execute(body("input"), {}, { onEvent: event => forwarded.push(event) })).messages[0].content, "public answer");
  assert.equal(client.sessions.length, 1);
  assert.ok(diagnostics.some(event => event.lastActivity === "assistant.fusion_phase_activity"));
  assert.ok(forwarded.every(event => event.type === "assistant.message_delta"));
  assert.doesNotMatch(JSON.stringify({ diagnostics, forwarded }), /private-/);
});

test("unregistered, subordinate, review, repeated and invalid phase bytes cannot conceal a stalled root", async t => {
  let timer;
  t.after(() => clearInterval(timer));
  const { manager, diagnostics } = await setup(t, { turnIdleRecoveryAttempts: 0 }, { onSend: session => {
    session.emit("assistant.turn_start", { turnId: "same-turn" });
    session.emit("assistant.fusion_phase_started", rootPhase);
    session.emit("assistant.fusion_phase_activity", { ...rootPhase, activity: "model_output", totalResponseSizeBytes: 100 });
    let bytes = 100;
    timer = setInterval(() => {
      session.emit("assistant.turn_start", { turnId: "same-turn" });
      session.emit("assistant.fusion_phase_started", rootPhase);
      for (const count of [100, 99, 0, -1, NaN, Infinity, "200", 100.5]) {
        session.emit("assistant.fusion_phase_activity", { ...rootPhase, activity: "model_output", totalResponseSizeBytes: count });
      }
      for (const [data, extra] of [
        [{ phaseId: "unregistered" }, {}], [{ conversationScope: "review" }, {}],
        [{ agentId: "child" }, {}], [{ parentToolCallId: "child" }, {}], [{}, { agentId: "child" }],
        [{ activity: "tool_started" }, {}], [{ activity: "tool_completed" }, {}],
      ]) session.emit("assistant.fusion_phase_activity", {
        ...rootPhase, activity: "model_output", totalResponseSizeBytes: ++bytes, ...data,
      }, extra);
    }, 15);
  } });
  await assert.rejects(manager.execute(body("input")), { code: "copilot_idle_timeout" });
  const stalled = diagnostics.find(event => event.event === "bridge.turn_stalled");
  assert.equal(stalled.waitPhase, "streaming");
  assert.equal(stalled.lastActivity, "assistant.fusion_phase_activity");
});

test("duplicate turn-start events cannot reset cumulative root byte counts", async t => {
  let timer;
  t.after(() => clearInterval(timer));
  const { manager } = await setup(t, { turnIdleRecoveryAttempts: 0 }, { onSend: session => {
    session.emit("assistant.turn_start", { turnId: "same" });
    session.emit("assistant.streaming_delta", { totalResponseSizeBytes: 100 });
    timer = setInterval(() => {
      session.emit("assistant.turn_start", { turnId: "same" });
      session.emit("assistant.streaming_delta", { totalResponseSizeBytes: 100 });
    }, 15);
  } });
  await assert.rejects(manager.execute(body("input")), { code: "copilot_idle_timeout" });
});

test("upstream failure diagnostics are root-only, content-free and do not fabricate progress", async t => {
  const { manager, diagnostics } = await setup(t, { turnFirstProgressTimeoutMs: 80, turnIdleRecoveryAttempts: 0 }, { onSend: session => {
    session.emit("assistant.turn_start", {});
    session.emit("model.call_failure", { source: "top_level", failureKind: "api", statusCode: 429,
      errorMessage: "private-provider-details", providerCallId: "private-correlation", model: "private-model" });
    for (const [data, extra] of [[{ source: "subagent" }, {}], [{ source: "mcp_sampling" }, {}],
      [{ agentId: "child" }, {}], [{ parentToolCallId: "child" }, {}], [{}, { agentId: "child" }],
      [{ interactionType: "conversation-subagent" }, {}], [{ fusion: rootPhase }, {}], [{ initiator: "mcp-sampling" }, {}]]) {
      session.emit("model.call_failure", { source: "top_level", failureKind: "transport", ...data }, extra);
    }
  } });
  await assert.rejects(manager.execute(body("input")), /Last upstream failure: api \(HTTP 429\)/);
  const failures = diagnostics.filter(event => event.event === "bridge.model_call_failed");
  assert.deepEqual(failures, [{ event: "bridge.model_call_failed", model, phase: "prompt", kind: "api", statusCode: 429 }]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-/);
});

test("the absolute turn deadline caps a longer initial wait without starting a recovery", async t => {
  const { manager, client } = await setup(t, { turnTimeoutMs: 70, turnFirstProgressTimeoutMs: 500 }, { onSend: session => {
    session.emit("assistant.turn_start", {});
  } });
  await assert.rejects(manager.execute(body("input")), error => {
    assert.equal(error.code, "copilot_timeout");
    assert.match(error.message, /70 ms turn deadline expired after 0 recovery attempt/);
    return true;
  });
  assert.equal(client.sessions.length, 1);
});

test("first-progress recovery consumes the original turn budget rather than resetting it", async t => {
  const { manager, client, diagnostics } = await setup(t, {
    turnTimeoutMs: 190, turnFirstProgressTimeoutMs: 120, turnIdleTimeoutMs: 50,
  }, { onSend: session => session.emit("assistant.turn_start", {}) });
  await assert.rejects(manager.execute(body("input")), error => {
    assert.equal(error.code, "copilot_timeout");
    assert.match(error.message, /190 ms turn deadline expired after 1 recovery attempt/);
    return true;
  });
  assert.equal(client.sessions.length, 2);
  assert.ok(client.sessions.every(session => session.sent.length === 1));
  assert.equal(diagnostics.filter(event => event.event === "bridge.turn_stalled").length, 1);
  assert.ok(!diagnostics.some(event => event.event === "bridge.turn_recovered"));
});

test("the total request deadline still caps an extended first-progress wait", async t => {
  const { manager, client } = await setup(t, { requestTimeoutMs: 70 }, {
    onSend: session => session.emit("assistant.turn_start", {}),
  });
  await assert.rejects(manager.execute(body("input")), { code: "request_timeout" });
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].sent.length, 1);
});

test("cancellation interrupts the longer first-progress wait without replaying input", async t => {
  const controller = new AbortController();
  let timer;
  t.after(() => clearTimeout(timer));
  const { manager, client, diagnostics } = await setup(t, {}, { onSend: session => {
    session.emit("assistant.turn_start", {});
    timer = setTimeout(() => controller.abort(), 60);
  } });
  await assert.rejects(manager.execute(body("input"), {}, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].sent.length, 1);
  assert.ok(!diagnostics.some(event => /turn_stalled|turn_recovering/.test(event.event)));
});

test("a retriable SDK call failure is diagnostic until the SDK finishes the turn", async t => {
  const { manager, client, diagnostics } = await setup(t, {}, { onSend: session => {
    session.emit("assistant.turn_start", {});
    session.emit("model.call_failure", { source: "top_level", failureKind: "transport" });
    session.reply("SDK recovered internally");
  } });
  assert.equal((await manager.execute(body("input"))).messages[0].content, "SDK recovered internally");
  assert.equal(client.sessions.length, 1);
  assert.equal(diagnostics.filter(event => event.event === "bridge.model_call_failed").length, 1);
  assert.ok(!diagnostics.some(event => /turn_stalled|turn_recovering/.test(event.event)));
});

test("completed phase receipts are counted once and phase bookkeeping stays bounded", async t => {
  let timer;
  t.after(() => clearInterval(timer));
  const { manager, diagnostics } = await setup(t, { turnIdleRecoveryAttempts: 0 }, { onSend: session => {
    session.emit("assistant.turn_start", { turnId: "phase-turn" });
    session.emit("assistant.fusion_phase_started", rootPhase);
    session.emit("assistant.fusion_phase_completed", { ...rootPhase, status: "succeeded", content: "private-content" });
    timer = setInterval(() => {
      session.emit("assistant.fusion_phase_started", rootPhase);
      session.emit("assistant.fusion_phase_completed", { ...rootPhase, status: "succeeded", content: "private-content" });
      session.emit("assistant.fusion_phase_activity", { ...rootPhase, activity: "model_output", totalResponseSizeBytes: 1000 });
    }, 15);
  } });
  await assert.rejects(manager.execute(body("input")), { code: "copilot_idle_timeout" });
  assert.equal(diagnostics.find(event => event.event === "bridge.turn_stalled").lastActivity, "assistant.fusion_phase_completed");
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-/);
  clearInterval(timer);
  const bounded = await setup(t, {}, { onSend: session => {
    session.emit("assistant.turn_start", { turnId: "many-phases" });
    for (let i = 0; i <= 64; i++) session.emit("assistant.fusion_phase_started", { ...rootPhase, phaseId: `phase-${i}` });
  } });
  await assert.rejects(bounded.manager.execute(body("input")), { code: "invalid_upstream_response" });
  assert.equal(bounded.client.sessions.length, 1);
});

test("a slow response after acknowledged tool output does not submit the tool result twice", async t => {
  let timer;
  t.after(() => clearTimeout(timer));
  const tool = { type: "function", name: "read_fixture", parameters: { type: "object", properties: {} } };
  const request = { ...body("read fixture"), tools: [tool] };
  const name = normalizeRequest(request).tools[0].name;
  const { manager, client } = await setup(t, {}, {
    onSend: session => session.toolCalls([{ toolCallId: "read-once", name, arguments: {} }]),
    onSubmit: session => {
      session.emit("assistant.turn_start", {});
      timer = setTimeout(() => session.reply("finished"), 180);
    },
  });
  await manager.execute(request, headers("slow-tool"));
  const next = body([{ type: "function_call_output", call_id: "read-once", output: "synthetic sample" }]);
  assert.equal((await manager.execute(next, headers("slow-tool"))).messages[0].content, "finished");
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].submitted.length, 1);
  assert.equal(client.sessions[0].sent.length, 1);
});
