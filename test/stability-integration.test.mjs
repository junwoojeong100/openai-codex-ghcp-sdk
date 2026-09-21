import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SessionManager } from "../src/session-manager.mjs";
import { createBridgeServer } from "../src/server.mjs";
import { normalizeRequest } from "../src/request-policy.mjs";
import { FakeClient, deferred, headers, model } from "./helpers/stability-sdk.mjs";

const tool = { type: "function", name: "lookup", parameters: { type: "object", properties: {} } };
const token = "owned-offline-integration-credential";
const parseEvents = text => text.split("\n").filter(l => l.startsWith("data: ")).map(l => JSON.parse(l.slice(6)));
async function waitUntil(predicate) {
  const end = Date.now() + 1500;
  while (!predicate()) { if (Date.now() > end) throw new Error("condition deadline"); await delay(2); }
}
async function setup(t, { client = new FakeClient(), managerOptions = {} } = {}) {
  const diagnostics = [];
  const manager = new SessionManager({ client, turnTimeoutMs: 1000, requestTimeoutMs: 1500,
    readinessTimeoutMs: 100, startupTimeoutMs: 500, readinessIntervalMs: 60_000, cleanupTimeoutMs: 50,
    onDiagnostic: event => diagnostics.push(event), ...managerOptions });
  await manager.start();
  const server = createBridgeServer({ manager, apiKey: token, onDiagnostic: e => diagnostics.push(e) });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(async () => {
    server.abortActiveRequests(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); await manager.stop();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, options = {}) => fetch(base + route, { ...options, signal: options.signal ?? AbortSignal.timeout(2500),
    headers: { authorization: `Bearer ${token}`, ...options.headers } });
  const post = (body, family = "owned", options = {}) => request("/v1/responses", {
    method: "POST", body: JSON.stringify(body), ...options, headers: { ...headers(family), ...options.headers },
  });
  return { manager, client, server, request, post, base, diagnostics };
}

test("live health differs from authenticated SDK readiness and catalog recovery", async t => {
  const first = new FakeClient(), second = new FakeClient(); let factories = 0;
  const { request, base, manager } = await setup(t, { client: first, managerOptions: { clientFactory: () => { factories++; return second; } } });
  assert.equal((await request("/readyz")).status, 200);
  assert.equal((await fetch(base + "/readyz")).status, 401);
  first.ping = async () => { throw new Error("owned disconnect"); };
  const ready = await request("/readyz"); assert.equal(ready.status, 503);
  assert.equal((await ready.json()).ready, false); assert.equal(factories, 0);
  const health = await (await fetch(base + "/health")).json();
  assert.equal(health.ok, true); assert.equal(health.ready, false);
  const catalog = await request("/v1/models"); assert.equal(catalog.status, 200);
  assert.ok((await catalog.json()).data.some(m => m.id === model));
  assert.equal(manager.client, second); assert.equal(factories, 1);
  assert.equal((await request("/readyz")).status, 200);
});

test("an SDK loss fails the active conversation and never replays its pending tool result", async t => {
  const initial = { model, input: "Use lookup", tools: [tool] };
  const callName = normalizeRequest(initial).tools[0].name;
  const first = new FakeClient({ onSend: s => s.toolCalls([{ toolCallId: "pending-owned", name: callName, arguments: {} }]) });
  const second = new FakeClient();
  const { post, request, manager } = await setup(t, { client: first, managerOptions: { clientFactory: () => second } });
  const result = await (await post(initial)).json(); assert.equal(result.output[0].call_id, "pending-owned");
  first.ping = async () => { throw new Error("closed"); };
  assert.equal((await request("/readyz")).status, 503);
  const old = await post({ ...initial, input: [{ type: "function_call_output", call_id: "pending-owned", output: "side effect already happened" }] });
  assert.equal(old.status, 409); assert.equal((await old.json()).error.code, "upstream_session_lost");
  assert.equal(first.sessions[0].submitted.length, 0); assert.equal(second.sessions.length, 0);
  const fresh = await post({ model, input: "new work" }, "new-family"); assert.equal(fresh.status, 200);
  assert.equal(second.sessions.length, 1); assert.equal(manager.callStates.size, 0);
  assert.equal(first.deleted.length, 0, "retired client must not be auto-started by deleteSession");
});

test("a connection loss during inference terminates SSE and a new family uses a fresh client", async t => {
  const entered = deferred();
  const first = new FakeClient({ onSend: () => { entered.resolve(); } }), second = new FakeClient();
  const { post, request, manager } = await setup(t, { client: first, managerOptions: { clientFactory: () => second } });
  const response = await post({ model, input: "hang", stream: true }); const text = response.text();
  await entered.promise; first.ping = async () => { throw new Error("closed"); };
  assert.equal((await request("/readyz")).status, 503);
  const events = parseEvents(await text); assert.equal(events.at(-1).type, "response.failed");
  assert.equal(events.at(-1).response.error.code, "upstream_session_lost");
  await manager.queue.drain();
  assert.equal((await post({ model, input: "healthy" }, "new")).status, 200);
  assert.equal(first.sessions[0].sent.length, 1); assert.equal(second.sessions[0].sent.length, 1);
});

test("cancelled queued HTTP work is removed before predecessor completion and never sends", async t => {
  const gate = deferred(), entered = deferred(); let active = false;
  const client = new FakeClient({ onSend: async (s, { prompt }) => {
    if (prompt === "hold") { entered.resolve(); await gate.promise; } s.reply(prompt); active = false;
  } });
  const { post, manager } = await setup(t, { client });
  const first = post({ model, input: "hold", stream: true }); await entered.promise; active = true;
  const c = new AbortController(); const waiting = post({ model, input: "must-not-run" }, "owned", { signal: c.signal });
  const rejected = assert.rejects(waiting, { name: "AbortError" });
  await waitUntil(() => manager.queue.total === 2); c.abort(); await rejected;
  await waitUntil(() => manager.queue.total === 1); assert.equal(active, true);
  assert.equal((await post({ model, input: "independent" }, "other")).status, 200);
  gate.resolve(); await (await first).text(); await manager.queue.drain();
  assert.ok(!client.sessions.flatMap(s => s.sent).some(s => s.prompt === "must-not-run"));
});

test("request timeout ends SSE promptly and holds serialization until bounded cleanup", async t => {
  const client = new FakeClient({ onSend: () => {} });
  const { post, manager } = await setup(t, { client, managerOptions: { requestTimeoutMs: 40, turnTimeoutMs: 1000 } });
  const response = await post({ model, input: "timeout", stream: true });
  const events = parseEvents(await response.text());
  assert.equal(events.at(-1).type, "response.failed"); assert.equal(events.at(-1).response.error.code, "request_timeout");
  await manager.queue.drain(); assert.equal(manager.states.size, 0); assert.equal(client.deleted.length, 1);
  client.onSend = s => s.reply("healthy");
  assert.equal((await post({ model, input: "new" }, "new")).status, 200);
});

test("stream mismatch is rejected before caching or exposing undelivered calls", async t => {
  let firstCall = true;
  const input = { model, input: "read", tools: [tool], stream: true }, name = normalizeRequest(input).tools[0].name;
  const client = new FakeClient({ onSend: s => {
    if (!firstCall) { s.reply("healthy"); return; }
    firstCall = false;
    s.emit("assistant.message_delta", { messageId: "wrong-id", deltaContent: "read" });
    s.emit("assistant.message", { messageId: "correct-id", content: "read", toolRequests: [{ toolCallId: "not-delivered", name, arguments: {} }] });
    s.emit("external_tool.requested", { toolCallId: "not-delivered", requestId: "rpc-owned", toolName: name });
  } });
  const { post, manager } = await setup(t, { client });
  const events = parseEvents(await (await post(input)).text());
  assert.equal(events.at(-1).type, "response.failed"); assert.equal(events.at(-1).response.error.code, "invalid_upstream_response");
  assert.ok(!events.some(e => e.item?.type === "function_call"));
  assert.equal(manager.states.size, 0); assert.equal(manager.responses.size, 0); assert.equal(manager.callStates.size, 0);
  assert.equal(client.deleted.length, 1);
  const next = parseEvents(await (await post({ model, input: "next", stream: true })).text());
  assert.equal(next.at(-1).type, "response.completed"); assert.equal(client.sessions.length, 2);
});

test("valid SSE retries use the cache and submit a pending result only once", async t => {
  const body = { model, input: "read", tools: [tool], stream: true }, name = normalizeRequest(body).tools[0].name;
  const client = new FakeClient({ onSend: s => s.toolCalls([{ toolCallId: "once", name, arguments: {} }]), onSubmit: s => s.reply("done") });
  const { post } = await setup(t, { client });
  const first = parseEvents(await (await post(body)).text()).at(-1).response;
  const retry = parseEvents(await (await post(body)).text()).at(-1).response;
  assert.deepEqual(retry.output, first.output); assert.equal(client.sessions[0].sent.length, 1);
  const result = { model, stream: true, previous_response_id: first.id, input: [{ type: "function_call_output", call_id: "once", output: "original" }] };
  const second = parseEvents(await (await post(result)).text()).at(-1).response;
  const retry2 = parseEvents(await (await post(result)).text()).at(-1).response;
  assert.deepEqual(second.output, retry2.output); assert.equal(client.sessions[0].submitted.length, 1);
});


for (const mode of ["json", "sse", "partial-sse"]) test(`explicit SDK content filtering never becomes HTTP success (${mode})`, async t => {
  const input = { model, input: "owned filter test", tools: [tool], stream: mode !== "json" };
  const name = normalizeRequest(input).tools[0].name;
  const client = new FakeClient({ onSend: session => {
    session.emit("assistant.turn_start", {});
    if (mode === "partial-sse") session.emit("assistant.message_delta", { messageId: "partial", deltaContent: "partial text" });
    session.emit("assistant.usage", { model, inputTokens: 1, outputTokens: 0, contentFilterTriggered: true });
    session.toolCalls([{ toolCallId: "blocked-call", name, arguments: {} }]);
    session.reply("must not be reported as completed");
  } });
  const { post, manager, diagnostics } = await setup(t, { client });
  const response = await post(input);
  const text = await response.text();
  if (mode === "json") {
    assert.equal(response.status, 422);
    assert.equal(JSON.parse(text).error.code, "upstream_content_filter");
    assert.equal(JSON.parse(text).object, undefined);
  } else {
    assert.equal(response.status, 200); // Headers were already sent; SSE carries the failure.
    const events = parseEvents(text);
    assert.equal(events.at(-1).type, "response.failed");
    assert.equal(events.at(-1).response.status, "failed");
    assert.equal(events.at(-1).response.error.code, "upstream_content_filter");
    assert.equal(events.filter(e => e.type === "response.failed").length, 1);
    assert.ok(!events.some(e => e.type === "response.completed"));
    assert.ok(!events.some(e => ["function_call", "custom_tool_call"].includes(e.item?.type)));
    const output = events.at(-1).response.output;
    assert.equal(output.length, mode === "partial-sse" ? 1 : 0);
    if (mode === "partial-sse") {
      assert.equal(output[0].status, "incomplete");
      assert.equal(output[0].content[0].text, "partial text");
    }
  }
  await manager.queue.drain();
  assert.equal(manager.states.size, 0);
  assert.equal(manager.responses.size, 0);
  assert.equal(manager.callStates.size, 0);
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].sent.length, 1);
  assert.equal(client.sessions[0].submitted.length, 0);
  assert.equal(client.deleted.length, 1);
  assert.equal(diagnostics.filter(d => d.event === "bridge.upstream_content_filter").length, 1);
  assert.ok(!text.includes("must not be reported as completed"));
});
