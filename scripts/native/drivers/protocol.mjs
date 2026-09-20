import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registration, controlTurn, openThread, assertPhaseAnswer, commandResult,
  phaseById, controlMarker, completedItems } from "../oracles.mjs";

const noInference = (e, phase) => assert.ok(!e.sdk.slice(phase.sdkStart, phase.sdkEnd).some(({ type }) =>
  ["session.created", "session.send.started", "tool.submitted", "usage"].includes(type)), "Rejected native request performed inference.");
async function rejectedTurn(f, c, input, options = {}) {
  try {
    const phase = await f.turn(c.host, c.threadId, input, options);
    assert.equal(phase.turn.status, "failed", "Unsupported request unexpectedly completed.");
    return phase.id;
  } catch (error) {
    if (error.name !== "RpcError") throw error;
    return f.phases.at(-1).id;
  }
}
function assertRejectedTurn(e, id, { bridge = true } = {}) {
  const phase = phaseById(e, id);
  assert.ok(phase.turn?.status === "failed" || phase.error?.name === "RpcError");
  noInference(e, phase);
  if (bridge) {
    const requests = e.http.slice(phase.httpStart, phase.httpEnd).filter(({ layer }) => layer === "bridge");
    assert.ok(requests.some(({ error }) => error?.code === "invalid_request_error"), "Missing explicit bridge semantic rejection.");
    assert.ok(requests.every(({ result }) => !result));
  }
  return phase;
}
function structured(dimension) {
  return registration(async (f) => {
    const c = await controlTurn(f);
    const schemas = dimension === "failure" ? [{ type: 17 }, { type: "object", properties: { value: { type: "string", enum: [] } }, required: ["value"], additionalProperties: false }]
      : [{ type: "object", properties: { answer: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } }, required: ["answer"], additionalProperties: false }];
    const rejected = [];
    for (const outputSchema of schemas) rejected.push(await rejectedTurn(f, c, "Return the requested JSON object without tools.", { outputSchema }));
    const recovered = dimension === "lifecycle" ? await f.turn(c.host, c.threadId,
      "Without tools, repeat exactly the file marker you read earlier, without formatting.", { outputSchema: null }) : null;
    return { control: c.phase.id, rejected, recovered: recovered?.id, schemas };
  }, (e, data) => {
    assertPhaseAnswer(e, data.control, controlMarker(e));
    assert.equal(data.rejected.length, dimension === "failure" ? 2 : 1);
    data.rejected.forEach((id, index) => {
      const phase = assertRejectedTurn(e, id, { bridge: dimension !== "failure" });
      assert.deepEqual(phase.options.outputSchema, data.schemas[index]);
      if (!phase.error) assert.ok(phase.turn.error, "Native failure is missing its error details.");
    });
    if (dimension === "lifecycle") {
      const recovered = assertPhaseAnswer(e, data.recovered, controlMarker(e), { tool: false });
      assert.equal(recovered.options.outputSchema, null);
      assert.equal(recovered.threadId, phaseById(e, data.control).threadId);
      assert.ok(!completedItems(recovered).some(({ type }) => type === "commandExecution"));
    }
  }, { outcome: "unsupported" });
}

function gateway(dimension) {
  return registration(async (f) => {
    let rejected;
    if (dimension === "failure") {
      const host = await f.host({ token: `invalid-fixture-${randomUUID()}` });
      const start = await f.thread(host);
      const id = await rejectedTurn(f, { host, threadId: start.thread.id }, "Reply AUTHENTICATED without tools.");
      rejected = id;
      await host.stop();
    }
    const c = await controlTurn(f);
    const continued = dimension === "lifecycle" ? await f.turn(c.host, c.threadId,
      "Without tools, repeat exactly the file value you read in the first turn. No additional text.") : null;
    return { control: c.phase.id, continued: continued?.id, rejected };
  }, (e, data) => {
    const control = assertPhaseAnswer(e, data.control, controlMarker(e));
    const requests = e.http.slice(control.httpStart, control.httpEnd).filter(({ layer }) => layer === "bridge");
    assert.ok(requests.length >= 2, "Native tool round trip lacks request/result continuation.");
    assert.ok(requests.every(({ request }) => request.model === e.model));
    const declarations = requests.flatMap(({ result }) => result?.tools || []);
    const calls = requests.flatMap(({ result }) => result?.messages?.flatMap(({ toolRequests }) => toolRequests || []) || []);
    const outputs = requests.flatMap(({ request }) => Array.isArray(request.input) ? request.input.filter(({ type }) => ["function_call_output", "custom_tool_call_output"].includes(type)) : []);
    assert.ok(calls.length && outputs.length);
    for (const call of calls) {
      assert.ok(declarations.some(({ name }) => name === call.name));
      assert.ok(outputs.some(({ call_id }) => call_id === call.toolCallId));
      assert.ok(e.sdk.some(({ type, data }) => type === "sdk.external_tool.requested" && data.toolCallId === call.toolCallId));
    }
    // Codex can send instructions as leading developer/system input messages,
    // interleaved with additional_tools, instead of top-level instructions.
    const firstRequest = requests[0].request;
    const instructions = firstRequest.instructions ? [firstRequest.instructions] : [];
    for (const item of firstRequest.input || []) {
      if (item.type === "additional_tools") continue;
      if (!["developer", "system"].includes(item.role)) break;
      const text = typeof item.content === "string" ? item.content
        : item.content.map((part) => { assert.ok(["input_text", "output_text", "text"].includes(part.type)); return part.text; }).join("\n\n");
      if (text) instructions.push(text);
    }
    assert.ok(instructions.length && instructions.every((text) => typeof text === "string") &&
      instructions.join("\n\n").length > 10, "Meaningful native instructions were not retained.");
    assert.ok(e.sdk.slice(control.sdkStart, control.sdkEnd).some(({ type, systemMessage }) => type === "session.created" &&
      systemMessage?.content === instructions.join("\n\n")), "Native instruction bytes differ from the SDK system message.");
    commandResult(control);
    if (dimension === "failure") {
      const rejected = phaseById(e, data.rejected);
      assert.ok(rejected.turn?.status === "failed" || rejected.error?.name === "RpcError");
      noInference(e, rejected);
      const transport = e.http.slice(rejected.httpStart, rejected.httpEnd).filter(({ layer }) => layer === "transport");
      assert.ok(transport.some(({ status }) => status === 401), "Missing native authentication rejection.");
      assert.ok(!e.http.slice(rejected.httpStart, rejected.httpEnd).some(({ layer }) => layer === "bridge"));
    } else if (dimension === "lifecycle") {
      const next = assertPhaseAnswer(e, data.continued, controlMarker(e), { tool: false });
      assert.equal(next.threadId, control.threadId); assert.notEqual(next.turnId, control.turnId);
      assert.ok(!completedItems(next).some(({ type }) => type === "commandExecution"));
      assert.equal(e.sdk.filter(({ type }) => type === "session.created").length, 1);
      assert.equal(e.sdk.filter(({ type }) => type === "tool.submitted").length, calls.length);
      const continuation = e.http.slice(next.httpStart, next.httpEnd).filter(({ layer }) => layer === "bridge");
      assert.ok(continuation.some(({ request }) => Array.isArray(request.input) && request.input.some(({ type }) => ["function_call_output", "custom_tool_call_output"].includes(type))));
    }
  });
}
export const PROTOCOL_DRIVERS = Object.freeze(Object.fromEntries(["normal", "failure", "lifecycle"].flatMap((dimension) => [
  [`gateway-protocol.${dimension}`, gateway(dimension)], [`structured-output.${dimension}`, structured(dimension)],
])));
