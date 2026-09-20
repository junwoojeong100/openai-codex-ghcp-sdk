import assert from "node:assert/strict";
import { SUPPORTED_MODEL_IDS } from "../../src/model-map.mjs";
import { assertStream, inspectCodex, parseSse, RAW_TOOL_INPUT, textOf, UNSUPPORTED_REQUESTS } from "./drivers.mjs";
import { sha256 } from "./evidence.mjs";

export const CHECKS = Object.freeze(["behavior", "route", "isolation", "cleanup"]);
const submissions = new Set(["session.send.started", "session.send", "tool.submitted"]);
const events = (e, type) => e.sdk.filter((entry) => entry.type === type);
const clients = (e) => e.http.filter(({ layer }) => layer === "client");
const response = (row) => row.contentType?.includes("text/event-stream")
  ? parseSse(row.wire).at(-1)?.response : JSON.parse(row.wire);
const good = (e) => clients(e).filter((row) => row.route === "/v1/responses" && row.status === 200 && !row.streaming);
const inputMarker = (row) => {
  const match = /^Remember this marker: ("(?:[^"\\]|\\.)*")\. Reply/.exec(row.body?.input);
  assert.ok(match, "Missing retained random-marker stimulus.");
  return JSON.parse(match[1]);
};
const answer = (row, expected, model) => {
  assert.equal(row.status, 200);
  const value = response(row);
  assert.equal(value.status, "completed");
  assert.equal(value.model, model);
  assert.ok(value.id);
  assert.equal(textOf(value).trim(), expected);
  return value;
};
function trace(e, start, end) {
  assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start && end <= e.sdk.length, "Invalid SDK evidence range.");
  return e.sdk.slice(start, end);
}
function rejected(e, row, status, code) {
  assert.equal(row.status, status);
  assert.match(row.contentType, /application\/json/);
  const data = JSON.parse(row.wire);
  assert.ok(data.error?.message);
  if (code) assert.equal(data.error.code, code);
  assert.ok(!row.wire.includes("event: response."));
  assert.ok(!trace(e, row.sdkStart, row.sdkEnd).some(({ type }) => submissions.has(type)), "A rejected request submitted inference.");
}
function counts(e, sessions, prompts, results = 0) {
  assert.equal(events(e, "session.created").length, sessions);
  assert.equal(events(e, "session.send.started").length, prompts);
  assert.equal(events(e, "tool.submitted").length, results);
}
function fixtureMarker(e, value, index = 0) {
  assert.equal(sha256(`${value}\n`), e.state.workspaces[index].before["marker.txt"].sha256,
    "Tool output does not match the independently captured fixture hash.");
}

export function assertValidationRoute(e, scenario) {
  assert.ok(events(e, "client.listModels").length);
  const sessions = events(e, "session.created");
  const ids = new Set(sessions.map(({ sessionId }) => sessionId));
  assert.equal(ids.size, sessions.length);
  assert.ok(sessions.every(({ sessionId, model }) => sessionId && model === e.model));
  const usage = events(e, "usage");
  assert.ok(usage.every(({ sessionId, model }) => ids.has(sessionId) && model === e.model), "Unattributed/wrong-model usage.");
  for (const item of e.sdk) if (submissions.has(item.type)) assert.ok(ids.has(item.sessionId));
  if (scenario.inference === "none") assert.ok(!e.sdk.some(({ type }) => submissions.has(type)));
  else {
    assert.ok(sessions.length && events(e, "session.send.started").length && usage.length);
    assert.ok(sessions.every(({ sessionId }) => usage.some((row) => row.sessionId === sessionId) ||
      events(e, "session.abort").some((row) => row.sessionId === sessionId)), "A session has neither model usage nor an abort receipt.");
  }
  for (const row of e.http.filter(({ layer, result }) => layer === "bridge" && result)) {
    assert.equal(row.result.model, e.model);
    trace(e, row.sdkStart, row.sdkEnd);
    if (row.requestId) {
      const linked = clients(e).filter((request) => request.requestId === row.requestId);
      assert.equal(linked.length, 1, "Missing/ambiguous HTTP request correlation.");
      assert.deepEqual(linked[0].body, row.request);
      assert.equal(linked[0].status, 200);
      const actual = response(linked[0]);
      assert.equal(textOf(actual), row.result.messages.filter(({ content }) => content).map(({ content }) => content).join(""));
      assert.deepEqual(actual.usage, row.result.usage);
    }
  }
  if (scenario.surface === "codex-cli") {
    assert.ok(e.processes.length);
    for (const process of e.processes) {
      const start = process.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).find(({ type }) => type === "thread.started");
      assert.ok(start?.thread_id);
      assert.ok(e.http.some(({ layer, threadId, result }) => layer === "bridge" && threadId === start.thread_id && result?.model === e.model), "Native thread has no matching bridge exchange.");
    }
  }
}

export function assertValidationIsolation(e) {
  const state = e.state;
  assert.equal(state.configurationUnchanged, true);
  assert.equal(state.workspaceUnchanged, true);
  assert.deepEqual(state.configurationBefore, state.configurationAfter);
  assert.ok(state.workspaces.length);
  for (const workspace of state.workspaces) assert.deepEqual(workspace.before, workspace.after);
}
export function assertValidationCleanup(e) {
  assert.equal(e.state.allListenersClosed, true);
  assert.equal(e.state.processesClosed, true);
  assert.deepEqual(e.state.cleanupErrors, []);
  assert.ok(e.processes.every(({ closed }) => closed === true));
  const deleted = new Set(events(e, "client.deleteSession").map(({ sessionId }) => sessionId));
  assert.ok(events(e, "session.created").every(({ sessionId }) => deleted.has(sessionId)), "Missing SDK deletion receipt.");
  assert.equal(events(e, "client.created").length, events(e, "client.stop").length + events(e, "client.forceStop").length,
    "Missing SDK client shutdown receipt.");
  assert.ok(events(e, "client.stop").every(({ errors }) => errors.length === 0));
}

function gateway(e, dimension) {
  const rows = clients(e);
  if (dimension === "normal") {
    assert.equal(rows.length, 2);
    const [health, catalog] = rows.map(response);
    assert.equal(rows[0].status, 200);
    assert.equal(rows[0].authentication, "none");
    assert.equal(health.ok, true);
    assert.equal(health.protocol, "responses");
    assert.ok(Number.isInteger(health.pid) && health.instanceId);
    const models = events(e, "client.listModels")[0].models;
    const expected = SUPPORTED_MODEL_IDS.filter((id) => models.some((entry) => entry.id === id && entry.policy?.state !== "disabled"));
    assert.deepEqual(catalog.data.map(({ id }) => id), expected);
    assert.deepEqual(catalog.models.map(({ slug }) => slug), expected);
    assert.ok(expected.includes(e.model));
  } else if (dimension === "failure") {
    assert.equal(rows.length, 6);
    [[401, "invalid_api_key"], [401, "invalid_api_key"], [400], [415, "unsupported_content_encoding"], [404, "not_found"], [400, "unsupported_compaction"]]
      .forEach(([status, code], index) => rejected(e, rows[index], status, code));
  } else {
    assert.equal(rows.length, 3);
    const value = inputMarker(rows[0]);
    const first = answer(rows[0], value, e.model);
    rejected(e, rows[1], 404, "response_not_found");
    assert.equal(rows[1].body.previous_response_id, first.id);
    answer(rows[2], value, e.model);
    assert.ok(e.http.some(({ layer, refused }) => layer === "retired-bridge" && refused === true));
    assert.equal(events(e, "client.created").length, 2);
    counts(e, 2, 2);
  }
}
function responses(e, dimension) {
  const rows = clients(e);
  if (dimension === "failure") {
    assert.equal(rows.length, UNSUPPORTED_REQUESTS.length);
    rows.forEach((row, index) => {
      for (const [key, value] of Object.entries(UNSUPPORTED_REQUESTS[index])) assert.deepEqual(row.body[key], value);
      assert.equal(row.body.stream, true);
      rejected(e, row, 400);
    });
    counts(e, 0, 0);
  } else {
    assert.equal(rows.length, 1);
    const value = inputMarker(rows[0]);
    answer(rows[0], value, e.model);
    if (dimension === "lifecycle") assertStream(rows[0].wire, e.model, value);
    counts(e, 1, 1);
  }
}
function history(e, dimension) {
  const rows = good(e);
  assert.equal(rows.length, 2);
  const value = inputMarker(rows[0]);
  const first = answer(rows[0], value, e.model);
  const second = answer(rows[1], value, e.model);
  assert.equal(rows[0].sessionId, rows[1].sessionId);
  assert.ok(rows[0].sessionId);
  if (dimension === "lifecycle") {
    assert.deepEqual(rows[0].body, rows[1].body);
    assert.deepEqual(first.output, second.output);
    assert.deepEqual(first.usage, second.usage);
    counts(e, 1, 1);
  } else {
    assert.equal(rows[1].body.previous_response_id, first.id);
    assert.ok(!JSON.stringify(rows[1].body).includes(value));
    counts(e, 1, 2);
  }
  const bad = clients(e).filter(({ status }) => status !== 200);
  assert.equal(bad.length, dimension === "failure" ? 3 : 0);
  if (bad.length) {
    [[404, "response_not_found"], [409, "session_mismatch"], [409, "stale_response"]]
      .forEach(([status, code], index) => rejected(e, bad[index], status, code));
    assert.notEqual(bad[1].sessionId, rows[0].sessionId);
    assert.equal(bad[2].body.previous_response_id, first.id);
  }
}
function tools(e, dimension, custom) {
  const rows = good(e);
  assert.equal(rows.length, !custom && dimension === "lifecycle" ? 4 : 2);
  const first = response(rows[0]);
  const calls = first.output.filter(({ type }) => ["function_call", "custom_tool_call"].includes(type));
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.type, custom ? "custom_tool_call" : "function_call");
  assert.equal(call.namespace, "probe");
  assert.equal(call.name, "read_fixture");
  if (custom) assert.equal(call.input, RAW_TOOL_INPUT);
  else assert.deepEqual(JSON.parse(call.arguments), { key: "integration" });
  const results = rows.filter(({ body }) => Array.isArray(body.input));
  assert.equal(results.length, !custom && dimension === "lifecycle" ? 2 : 1);
  const submitted = results[0].body.input.filter(({ type }) => type === `${call.type}_output`);
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].call_id, call.call_id);
  const value = submitted[0].output;
  fixtureMarker(e, value);
  assert.ok(!JSON.stringify(rows[0].body).includes(value));
  for (const row of results) answer(row, value, e.model);
  counts(e, 1, 1, 1);
  const toolResult = events(e, "tool.submitted")[0];
  assert.equal(toolResult.result.textResultForLlm, value);
  assert.ok(events(e, "sdk.external_tool.requested").some(({ sessionId, data }) =>
    sessionId === toolResult.sessionId && data.requestId === toolResult.requestId && data.toolCallId === call.call_id));
  if (dimension === "lifecycle" && custom) {
    assert.equal(results[0].body.previous_response_id, undefined);
    const historical = results[0].body.input.find(({ type }) => type === "custom_tool_call");
    assert.deepEqual(historical, call);
  } else assert.equal(results[0].body.previous_response_id, first.id);
  if (dimension === "lifecycle" && !custom) {
    assert.deepEqual(response(rows[1]).output, first.output);
    assert.deepEqual(response(rows[3]).output, response(rows[2]).output);
    assert.deepEqual(response(rows[3]).usage, response(rows[2]).usage);
  }
  const bad = clients(e).filter(({ status }) => status !== 200);
  assert.equal(bad.length, dimension === "failure" ? custom ? 1 : 3 : 0);
  bad.forEach((row, index) => rejected(e, row, index === 1 ? 400 : 409, index === 1 ? undefined : "tool_result_mismatch"));
}
function reasoning(e, dimension) {
  const rows = clients(e);
  if (dimension === "failure") {
    assert.equal(rows.length, 2);
    rows.forEach((row) => rejected(e, row, 400, "model_unavailable"));
    counts(e, 0, 0);
    return;
  }
  assert.equal(rows.length, dimension === "lifecycle" ? 2 : 1);
  const value = inputMarker(rows[0]);
  rows.forEach((row) => answer(row, value, e.model));
  const modelInfo = events(e, "client.listModels")[0].models.find(({ id }) => id === e.model);
  const configurable = modelInfo.capabilities?.supports?.reasoningEffort !== false;
  const levels = [...(modelInfo.supportedReasoningEfforts || []), ...(modelInfo.capabilities?.supportedReasoningEfforts || [])];
  const requested = rows.map(({ body }) => body.reasoning.effort);
  if (configurable) assert.ok(requested.every((effort) => levels.includes(effort)));
  assert.equal(events(e, "session.created")[0].effort, configurable ? requested[0] : null);
  const changes = events(e, "session.setModel");
  if (dimension === "lifecycle") {
    assert.notEqual(requested[0], requested[1]);
    assert.equal(rows[1].body.previous_response_id, response(rows[0]).id);
    if (configurable) assert.deepEqual(changes.map(({ model, effort }) => ({ model, effort })), [{ model: e.model, effort: requested[1] }]);
  }
  if (!configurable) {
    assert.equal(changes.length, 0);
    const diagnostics = e.diagnostics.filter(({ event }) => event === "bridge.reasoning_not_configurable");
    assert.deepEqual(diagnostics.map(({ requested }) => requested), requested);
  }
  counts(e, 1, rows.length);
}
function resources(e, dimension) {
  const rows = clients(e);
  if (dimension === "normal") {
    assert.equal(rows.length, 4);
    const families = new Map();
    for (const row of rows) {
      const prior = families.get(row.sessionId);
      if (!prior) {
        const value = inputMarker(row);
        families.set(row.sessionId, { value, response: answer(row, value, e.model), turns: 1 });
      } else {
        assert.equal(row.body.previous_response_id, prior.response.id);
        answer(row, prior.value, e.model);
        prior.turns += 1;
      }
    }
    assert.equal(families.size, 2);
    assert.equal(new Set([...families.values()].map(({ value }) => value)).size, 2);
    assert.ok([...families.values()].every(({ turns }) => turns === 2));
    counts(e, 2, 4);
  } else if (dimension === "failure") {
    assert.equal(rows.length, 2);
    rejected(e, rows[0], 413, "body_too_large");
    rejected(e, rows[1], 413, "history_too_large");
    assert.ok(rows[1].body.input.length < 256 && Buffer.byteLength(rows[1].body.input) > 256);
    counts(e, 0, 0);
  } else {
    const partial = e.http.filter(({ layer }) => layer === "interrupted-stream");
    assert.equal(partial.length, 1);
    assert.equal(partial[0].clientAborted, true);
    assert.match(partial[0].wire, /response\.created/);
    assert.ok(!partial[0].wire.includes("response.completed"));
    const created = events(e, "session.created");
    assert.equal(created.length, 2);
    assert.ok(events(e, "session.abort").some(({ sessionId }) => sessionId === created[0].sessionId));
    const recovery = good(e);
    assert.equal(recovery.length, 1);
    answer(recovery[0], inputMarker(recovery[0]), e.model);
    assert.ok(trace(e, recovery[0].sdkStart, recovery[0].sdkEnd).some(({ type, sessionId }) => type === "usage" && sessionId === created[1].sessionId));
  }
}
function codex(e, dimension) {
  assert.equal(e.processes.length, dimension === "lifecycle" ? 2 : 1);
  const threads = new Set();
  e.processes.forEach((result, index) => {
    assert.equal(result.sandbox, "read-only");
    assert.equal(result.isolatedCodexHome, true);
    assert.equal(result.args[result.args.indexOf("--sandbox") + 1], "read-only");
    assert.ok(result.args.includes("--ephemeral") && result.args.includes("--ignore-user-config"));
    const entries = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const command = entries.find(({ type, item }) => type === "item.completed" && item.type === "command_execution")?.item;
    assert.ok(command);
    const value = dimension === "failure" ? "MISSING" : command.aggregated_output.trim();
    if (dimension !== "failure") {
      fixtureMarker(e, value, index);
      assert.ok(!result.args.at(-1).includes(value), "Hidden fixture value leaked to the prompt.");
    }
    threads.add(inspectCodex(result, value, dimension === "failure").threadId);
  });
  assert.equal(threads.size, e.processes.length);
  assert.equal(events(e, "session.created").length, e.processes.length);
}
const behaviors = {
  gateway, responses, history, reasoning, resources, "codex-cli": codex,
  "function-tools": (e, dimension) => tools(e, dimension, false),
  "custom-tools": (e, dimension) => tools(e, dimension, true),
};
export function assertValidationBehavior(evidence, scenario) {
  assert.ok(behaviors[scenario.feature], `Missing evaluator: ${scenario.id}`);
  behaviors[scenario.feature](evidence, scenario.dimension);
}
export function evaluateValidationEvidence(evidence, scenario) {
  const evaluators = { behavior: assertValidationBehavior, route: assertValidationRoute, isolation: assertValidationIsolation, cleanup: assertValidationCleanup };
  return Object.fromEntries(CHECKS.map((name) => {
    try { evaluators[name](evidence, scenario); return [name, { passed: true }]; }
    catch (error) { return [name, { passed: false, error: { name: error.name, message: error.message } }]; }
  }));
}
