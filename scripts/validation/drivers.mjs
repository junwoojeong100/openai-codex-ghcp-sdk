import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SUPPORTED_MODEL_IDS } from "../../src/model-map.mjs";
import { PrerequisiteError } from "./fixture.mjs";

export const textOf = (response) => (response.output || []).filter(({ type }) => type === "message")
  .flatMap(({ content }) => content || []).filter(({ type }) => type === "output_text").map(({ text }) => text).join("");
const marker = () => `validation-${randomUUID()}-한글`;
export const remember = (value) => `Remember this marker: ${JSON.stringify(value)}. Reply with exactly that marker and nothing else.`;
const recall = "Repeat the marker from my earlier message exactly, without other text or tools.";
const answerIs = (response, expected) => assert.equal(textOf(response).trim(), expected);

function errorIs(result, status, code) {
  assert.equal(result.status, status, result.wire);
  assert.match(result.contentType, /application\/json/);
  assert.ok(result.data?.error?.message);
  if (code) assert.equal(result.data.error.code, code);
  assert.ok(!result.wire.includes("event: response."), "An invalid request opened an SSE stream.");
}

export function parseSse(wire) {
  return wire.replaceAll("\r\n", "\n").split("\n\n").flatMap((frame) => {
    const lines = frame.split("\n");
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return [];
    assert.notEqual(data, "[DONE]", "The bridge contract ends with response.completed, not a sentinel.");
    const value = JSON.parse(data);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    if (event) assert.equal(event, value.type);
    return [value];
  });
}

export function assertStream(wire, model, expected) {
  const events = parseSse(wire);
  assert.equal(events[0]?.type, "response.created");
  assert.equal(events.at(-1)?.type, "response.completed");
  assert.equal(events.filter(({ type }) => type === "response.created").length, 1);
  assert.equal(events.filter(({ type }) => type === "response.completed").length, 1);
  assert.ok(!events.some(({ type }) => ["error", "response.failed", "response.incomplete"].includes(type)));
  for (let index = 0; index < events.length; index += 1) {
    assert.ok(Number.isSafeInteger(events[index].sequence_number));
    if (index) assert.ok(events[index].sequence_number > events[index - 1].sequence_number);
  }
  const deltas = events.filter(({ type }) => type === "response.output_text.delta");
  assert.ok(deltas.length > 0, "No text delta was streamed.");
  const response = events.at(-1).response;
  assert.equal(response.model, model);
  assert.equal(response.status, "completed");
  assert.equal(deltas.map(({ delta }) => delta).join(""), textOf(response));
  answerIs(response, expected);
  return { events: events.length, deltas: deltas.length, finalResponseId: response.id };
}

async function gateway(f, dimension) {
  if (dimension === "normal") {
    const health = await f.request("/health", { auth: "none" });
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);
    assert.equal(health.data.protocol, "responses");
    assert.equal(health.data.instanceId, f.instanceId);
    assert.equal(health.data.pid, process.pid);
    assert.ok(!health.wire.includes(f.token));
    const catalog = await f.request("/v1/models?client_version=0.154.0");
    assert.equal(catalog.status, 200);
    const expected = f.manager.listModels().filter(({ policy }) => policy?.state !== "disabled").map(({ id }) => id);
    assert.deepEqual(catalog.data.data.map(({ id }) => id), expected);
    assert.deepEqual(catalog.data.models.map(({ slug }) => slug), expected);
    assert.ok(expected.includes(f.model) && expected.every((id) => SUPPORTED_MODEL_IDS.includes(id)));
    return { modelIds: expected, healthIdentityChecked: true };
  }
  if (dimension === "failure") {
    errorIs(await f.request("/v1/models", { auth: "none" }), 401, "invalid_api_key");
    errorIs(await f.request("/v1/models", { auth: "invalid" }), 401, "invalid_api_key");
    errorIs(await f.request("/v1/responses", { body: "{" }), 400);
    errorIs(await f.post({ input: "No inference should run." }, { headers: { "content-encoding": "zstd" } }), 415, "unsupported_content_encoding");
    errorIs(await f.request("/v1/unknown"), 404, "not_found");
    errorIs(await f.request("/v1/responses/compact", { method: "POST" }), 400, "unsupported_compaction");
    return { rejectedRequests: 6 };
  }
  const value = marker();
  const session = randomUUID();
  const first = await f.response({ input: remember(value) }, { session });
  answerIs(first, value);
  const oldUrl = f.url;
  await f.stop();
  await assert.rejects(fetch(`${oldUrl}/health`, { signal: AbortSignal.timeout(1_000) }));
  f.http.push({ layer: "retired-bridge", url: oldUrl, refused: true });
  await f.start();
  errorIs(await f.post({ previous_response_id: first.id, input: recall }, { session }), 404, "response_not_found");
  answerIs(await f.response({ input: remember(value) }, { session }), value);
  assert.equal(f.counts().sessions, 2);
  return { restartedOwnedBridge: true, oldIdRejected: true };
}

export const UNSUPPORTED_REQUESTS = [
  { input: [{ role: "user", content: [{ type: "input_image", image_url: "fixture-only" }] }] },
  { input: [{ role: "user", content: [{ type: "input_audio", data: "fixture-only" }] }] },
  { input: [{ role: "user", content: [{ type: "input_file", file_id: "fixture-only" }] }] },
  { tools: [{ type: "web_search" }] }, { tools: [{ type: "code_interpreter" }] }, { tools: [{ type: "file_search" }] },
  { tools: [{ type: "function", name: "strict_probe", parameters: { type: "object" }, strict: true }] },
  { text: { format: { type: "json_schema", name: "probe", schema: { type: "object" } } } },
  { temperature: 0 }, { top_p: 1 }, { max_output_tokens: 8 }, { max_tool_calls: 1 },
  { background: true }, { store: true }, { truncation: "auto" }, { service_tier: "priority" },
  { tool_choice: "required" }, { reasoning: { summary: "auto" } },
];

async function responses(f, dimension) {
  if (dimension === "failure") {
    for (const request of UNSUPPORTED_REQUESTS) {
      errorIs(await f.post({ input: "Must fail before inference.", stream: true, ...request }), 400);
    }
    assert.equal(f.counts().sessions, 0);
    return { unsupportedRequests: UNSUPPORTED_REQUESTS.length };
  }
  const value = marker();
  if (dimension === "normal") {
    const response = await f.response({ input: remember(value) });
    answerIs(response, value);
    assert.ok(response.usage === null || Number.isFinite(response.usage.total_tokens));
    return { responseId: response.id, usage: response.usage };
  }
  const response = await f.post({ input: remember(value), stream: true });
  assert.equal(response.status, 200);
  assert.match(response.contentType, /text\/event-stream/);
  return assertStream(response.wire, f.model, value);
}

async function history(f, dimension) {
  const session = randomUUID();
  const value = marker();
  const firstBody = { input: remember(value) };
  if (dimension === "failure") {
    errorIs(await f.post({ previous_response_id: "resp_unknown_fixture", input: recall }, { session }), 404, "response_not_found");
  }
  const first = await f.response(firstBody, { session });
  answerIs(first, value);
  if (dimension === "lifecycle") {
    const before = f.counts();
    const retry = await f.response(firstBody, { session });
    assert.deepEqual(retry.output, first.output);
    assert.deepEqual(retry.usage, first.usage);
    assert.deepEqual(f.counts(), before);
    return { identicalRetryDidNotSubmit: true };
  }
  if (dimension === "failure") {
    const before = f.counts();
    errorIs(await f.post({ previous_response_id: first.id, input: recall }, { session: randomUUID() }), 409, "session_mismatch");
    assert.deepEqual(f.counts(), before);
  }
  const next = await f.response({ previous_response_id: first.id, input: recall }, { session });
  answerIs(next, value);
  assert.equal(f.counts().sessions, 1);
  assert.equal(f.counts().prompts, 2);
  if (dimension === "failure") {
    const before = f.counts();
    // Not an identical retry: use a different input to attempt a historical branch.
    errorIs(await f.post({ previous_response_id: first.id, input: "Branch from this old response." }, { session }), 409, "stale_response");
    assert.deepEqual(f.counts(), before);
  }
  return { sameSessionContinuation: true, rejectedCrossSessionAndStaleIds: dimension === "failure" };
}

export const RAW_TOOL_INPUT = "첫째 줄\n  second line\n";
async function toolRoundtrip(f, dimension, custom) {
  const session = randomUUID();
  const type = custom ? "custom" : "function";
  const tool = custom
    ? { type, name: "read_fixture", description: "Read the hidden fixture marker using the exact raw input requested.", format: { type: "text" } }
    : { type, name: "read_fixture", description: "Read the hidden fixture marker by key.",
      parameters: { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false } };
  const tools = [{ type: "namespace", name: "probe", tools: [tool] }];
  const prompt = (custom
    ? `Call probe.read_fixture exactly once. The raw input's JSON string representation is ${JSON.stringify(RAW_TOOL_INPUT)}. Decode escapes and preserve indentation and the trailing newline.`
    : 'Call probe.read_fixture exactly once with key="integration".') +
    " The marker is unknown until the tool returns it. After receiving the result, reply with exactly that marker and nothing else.";
  assert.ok(!prompt.includes(f.markers[0]), "The supposedly hidden marker leaked into the prompt.");
  const initial = { input: prompt, tools, parallel_tool_calls: false };
  const first = await f.response(initial, { session });
  const calls = first.output.filter(({ type: itemType }) => ["function_call", "custom_tool_call"].includes(itemType));
  assert.equal(calls.length, 1, f.scrub(first));
  const call = calls[0];
  assert.equal(call.type, custom ? "custom_tool_call" : "function_call");
  assert.equal(call.name, "read_fixture");
  assert.equal(call.namespace, "probe");
  if (custom) assert.equal(call.input, RAW_TOOL_INPUT);
  else assert.deepEqual(JSON.parse(call.arguments), { key: "integration" });
  const output = fs.readFileSync(path.join(f.workspaces[0].path, "marker.txt"), "utf8").trim();
  const result = { type: `${call.type}_output`, call_id: call.call_id, output };
  if (dimension === "failure") {
    const before = f.counts();
    const wrongType = { ...result, type: custom ? "function_call_output" : "custom_tool_call_output" };
    errorIs(await f.post({ previous_response_id: first.id, input: [wrongType] }, { session }), 409, "tool_result_mismatch");
    if (!custom) {
      errorIs(await f.post({ previous_response_id: first.id, input: [result, result] }, { session }), 400);
      errorIs(await f.post({ previous_response_id: first.id, input: [{ ...result, call_id: "unknown-call" }] }, { session }), 409, "tool_result_mismatch");
    }
    assert.deepEqual(f.counts(), before, "Invalid output was submitted to the SDK.");
  }
  if (dimension === "lifecycle" && !custom) {
    const before = f.counts();
    const retry = await f.response(initial, { session });
    assert.deepEqual(retry.output, first.output);
    assert.deepEqual(f.counts(), before);
  }
  const followup = dimension === "lifecycle" && custom
    ? { input: [{ role: "user", content: prompt }, ...first.output, result], tools, parallel_tool_calls: false }
    : { previous_response_id: first.id, input: [result], parallel_tool_calls: false };
  const final = await f.response(followup, { session });
  answerIs(final, output);
  assert.equal(f.counts().sessions, 1);
  assert.equal(f.counts().prompts, 1);
  assert.equal(f.counts().results, 1);
  if (dimension === "lifecycle" && !custom) {
    const before = f.counts();
    const retry = await f.response(followup, { session });
    assert.deepEqual(retry.output, final.output);
    assert.deepEqual(retry.usage, final.usage);
    assert.deepEqual(f.counts(), before);
  }
  return { toolType: type, namespace: call.namespace, callId: call.call_id, rawInputPreserved: custom, hiddenMarkerReturned: true };
}

async function reasoning(f, dimension) {
  if (dimension === "failure") {
    errorIs(await f.post({ model: "not-an-allowed-model", input: "Do not substitute another model." }), 400, "model_unavailable");
    errorIs(await f.post({ reasoning: { effort: "not-a-valid-effort" }, input: "Do not silently map the effort." }), 400, "model_unavailable");
    assert.equal(f.counts().sessions, 0);
    return { invalidModelAndEffortRejected: true };
  }
  const configurable = f.modelInfo.capabilities?.supports?.reasoningEffort !== false;
  const levels = [...new Set([...(f.modelInfo.supportedReasoningEfforts || []), ...(f.modelInfo.capabilities?.supportedReasoningEfforts || [])])];
  if (configurable && (!levels.length || dimension === "lifecycle" && levels.length < 2)) {
    throw new PrerequisiteError("The live catalog does not advertise enough effort levels for this scenario.", "reasoning-catalog");
  }
  const low = configurable ? levels.includes("low") ? "low" : levels[0] : "low";
  const high = configurable ? [...levels].reverse().find((level) => level !== low) : "high";
  const session = randomUUID();
  const value = marker();
  const first = await f.response({ input: remember(value), reasoning: { effort: low } }, { session });
  answerIs(first, value);
  assert.equal(f.sdk.find(({ type }) => type === "session.created").effort, configurable ? low : null);
  if (dimension === "lifecycle") {
    answerIs(await f.response({ previous_response_id: first.id, input: recall, reasoning: { effort: high } }, { session }), value);
    assert.equal(f.counts().sessions, 1);
    const changes = f.sdk.filter(({ type }) => type === "session.setModel");
    if (configurable) assert.deepEqual(changes.map(({ model, effort }) => ({ model, effort })), [{ model: f.model, effort: high }]);
    else assert.equal(changes.length, 0);
  }
  if (!configurable) {
    assert.equal(f.diagnostics.filter(({ event }) => event === "bridge.reasoning_not_configurable").length, dimension === "lifecycle" ? 2 : 1);
  }
  return { configurable, requested: dimension === "lifecycle" ? [low, high] : [low] };
}

async function waitUntil(predicate, signal, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    signal?.throwIfAborted();
    assert.ok(Date.now() < deadline, "Timed out waiting for owned-session cleanup.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function resources(f, dimension) {
  if (dimension === "normal") {
    const values = [marker(), marker()];
    const sessions = [randomUUID(), randomUUID()];
    const initial = await Promise.all(values.map((value, index) => f.response({ input: remember(value) }, { session: sessions[index] })));
    initial.forEach((response, index) => answerIs(response, values[index]));
    const final = await Promise.all(initial.map(({ id }, index) => f.response({ previous_response_id: id, input: recall }, { session: sessions[index] })));
    final.forEach((response, index) => answerIs(response, values[index]));
    assert.equal(f.counts().sessions, 2);
    assert.equal(f.counts().prompts, 4);
    return { isolatedConcurrentConversations: 2 };
  }
  if (dimension === "failure") {
    errorIs(await f.post({ input: "x".repeat(1_100) }), 413, "body_too_large");
    const input = "한".repeat(100);
    assert.ok(input.length < 256 && Buffer.byteLength(input) > 256);
    errorIs(await f.post({ input }), 413, "history_too_large");
    assert.equal(f.counts().sessions, 0);
    return { bodyLimit: 1_024, historyLimit: 256, overridesAreFixtureOnly: true };
  }
  const controller = new AbortController();
  let partial = "";
  let reader;
  try {
    const stream = await f.post({ input: "Cancellation probe: write a long sequence of integers starting at 1, one per line.", stream: true },
      { stream: true, signal: controller.signal, session: randomUUID() });
    assert.equal(stream.status, 200);
    reader = stream.body.getReader();
    const decoder = new TextDecoder();
    while (!partial.includes("response.created")) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, "Stream closed before response.created.");
      partial += decoder.decode(chunk.value, { stream: true });
    }
    assert.ok(!partial.includes("response.completed"), "The response finished before cancellation; no cancellation evidence.");
  } finally {
    controller.abort();
    await reader?.cancel().catch(() => {});
    f.http.push({ layer: "interrupted-stream", wire: partial, clientAborted: true });
  }
  await waitUntil(() => f.manager.states.size === 0 && f.sdk.some(({ type }) => type === "session.abort"), f.signal);
  const value = marker();
  answerIs(await f.response({ input: remember(value) }), value);
  assert.equal(f.counts().sessions, 2);
  return { abortedSessionRemoved: true, freshRequestSucceeded: true };
}

function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
export function fixtureReadCommand(missing = false) {
  const code = `const fs=require("node:fs");process.stdout.write(fs.readFileSync(${JSON.stringify(missing ? "absent-file.txt" : "marker.txt")},"utf8"));`;
  return `${shellQuote(process.execPath)} -e ${shellQuote(code)}`;
}

export function inspectCodex(result, expected, missing = false) {
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  const events = result.stdout.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  assert.ok(!events.some(({ type }) => ["turn.failed", "error"].includes(type)), "Codex emitted an error/failed event.");
  assert.equal(events.filter(({ type }) => type === "turn.completed").length, 1);
  const threads = events.filter(({ type }) => type === "thread.started");
  assert.equal(threads.length, 1);
  assert.ok(threads[0].thread_id);
  const items = events.filter(({ type }) => type === "item.completed").map(({ item }) => item);
  const commands = items.filter(({ type }) => type === "command_execution");
  assert.equal(commands.length, 1, "Exactly one completed native command is required.");
  assert.ok(!items.some(({ type }) => ["file_change", "mcp_tool_call", "web_search"].includes(type)), "Unexpected side-effecting/external tool.");
  if (missing) {
    assert.ok(Number.isInteger(commands[0].exit_code) && commands[0].exit_code !== 0);
    assert.match(commands[0].aggregated_output, /ENOENT/);
  } else {
    assert.equal(commands[0].exit_code, 0);
    assert.equal(commands[0].aggregated_output.trim(), expected);
  }
  assert.equal(items.filter(({ type }) => type === "agent_message").at(-1)?.text?.trim(), expected);
  return { threadId: threads[0].thread_id, commandExitCode: commands[0].exit_code, events: events.length };
}

async function nativeCodex(f, dimension) {
  const run = async (index, missing = false) => {
    const command = fixtureReadCommand(missing);
    const prompt = `Bounded read-only validation. Use your shell tool exactly once to run this exact command from the current working directory:\n${command}\n` +
      "Do not read other files, modify files, use network, or invoke any other tools. " +
      (missing ? 'The file is deliberately absent. After observing the command failure, reply with exactly MISSING.'
        : "Reply with exactly the file's value, without preamble or formatting. The value is not supplied in this prompt.");
    assert.ok(!prompt.includes(f.markers[index]));
    const result = await f.codex(prompt, index);
    return inspectCodex(result, missing ? "MISSING" : f.markers[index], missing);
  };
  const first = await run(0, dimension === "failure");
  if (dimension !== "lifecycle") return first;
  f.addWorkspace();
  const second = await run(1);
  assert.notEqual(first.threadId, second.threadId);
  assert.equal(f.counts().sessions, 2);
  return { isolatedEphemeralThreads: [first.threadId, second.threadId] };
}

export const DRIVERS = Object.freeze({
  gateway, responses, history,
  "function-tools": (fixture, dimension) => toolRoundtrip(fixture, dimension, false),
  "custom-tools": (fixture, dimension) => toolRoundtrip(fixture, dimension, true),
  reasoning, resources, "codex-cli": nativeCodex,
});

export function driverFor(scenario) { return DRIVERS[scenario.feature]; }
