import assert from "node:assert/strict";
import test from "node:test";

import { createBridgeServer, bridgeConfig } from "../src/server.mjs";
import { BridgeRequestError, normalizeRequest } from "../src/request-policy.mjs";

const model = "gpt-6-astra";
const token = "local-test-token-not-a-github-credential";

async function setup(t, overrides = {}, serverOptions = {}) {
  const manager = {
    preferredModel: model,
    async readiness() { return { ready: true, state: "ready" }; },
    async ensureReady() {},
    listModels: () => [{ id: model }, { id: "claude-haiku-4.5", policy: { state: "disabled" } }],
    async execute(body, _headers, options) {
      const request = normalizeRequest(body);
      options.onReady({ model: request.model || model });
      options.onEvent({ type: "assistant.message_delta", data: { messageId: "message_one", deltaContent: "hello" } });
      return { model, messages: [{ messageId: "message_one", content: "hello" }], tools: [], usage: null };
    },
    ...overrides,
  };
  const server = createBridgeServer({ manager, apiKey: token, instanceId: "test-instance", maxBodyBytes: 1024, ...serverOptions });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.abortActiveRequests();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
  const post = (body, init = {}) => request("/v1/responses", { method: "POST", body: JSON.stringify(body), ...init });
  return { base, request, post, server };
}

test("health is public, model catalog requires the bridge credential and excludes disabled models", async (t) => {
  const { base, request } = await setup(t);
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.protocol, "responses");
  assert.equal(health.instanceId, "test-instance");
  assert.equal(JSON.stringify(health).includes(token), false);
  assert.equal((await fetch(`${base}/v1/models`)).status, 401);
  assert.equal((await request("/v1/models", { headers: { authorization: "Bearer wrong" } })).status, 401);
  const catalog = await (await request("/v1/models?client_version=0.154.0")).json();
  assert.deepEqual(catalog.data.map((entry) => entry.id), [model]);
  assert.ok(Array.isArray(catalog.models), "Codex requires a models array, not only the OpenAI data array.");
  assert.equal(catalog.models.length, 1);
});

test("non-streaming and streaming responses share final output shape", async (t) => {
  const { post } = await setup(t);
  const plain = await post({ model, input: "hello", stream: false });
  assert.equal(plain.status, 200);
  const response = await plain.json();
  assert.equal(response.status, "completed");
  assert.equal(response.output[0].content[0].text, "hello");
  assert.equal(response.usage, null);
  const streaming = await post({ model, input: "hello", stream: true });
  assert.match(streaming.headers.get("content-type"), /text\/event-stream/);
  const wire = await streaming.text();
  const events = wire.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
  assert.equal(events[0].type, "response.created");
  assert.equal(events.at(-1).type, "response.completed");
  assert.deepEqual(events.at(-1).response.output, response.output);
  assert.equal(events.filter((event) => event.type === "response.completed").length, 1);
});

test("invalid JSON, oversized bodies, compression and unsupported routes fail before model execution", async (t) => {
  const { request, post } = await setup(t, { execute: () => { throw new Error("must not be reached"); } });
  assert.equal((await request("/v1/responses", { method: "POST", body: "{" })).status, 400);
  assert.equal((await post({ input: "x".repeat(1100) })).status, 413);
  assert.equal((await post({ input: "hello" }, { headers: { "content-encoding": "zstd" } })).status, 415);
  assert.equal((await request("/v1/responses/compact", { method: "POST" })).status, 400);
  assert.equal((await request("/v1/unknown")).status, 404);
});

test("default body limit accepts requests above the former 25 MiB cap", async (t) => {
  const { post } = await setup(t, {}, { maxBodyBytes: undefined });
  const response = await post({ model, input: "x".repeat(25 * 1024 * 1024 + 1), stream: false });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "completed");
});

test("request policy failures return JSON before SSE headers are sent", async (t) => {
  const { post } = await setup(t);
  const response = await post({ model, input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: "unneeded" }] }], stream: true });
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type"), /application\/json/);
  const error = await response.json();
  assert.ok(error.error.message);
});

test("upstream failures become response.failed rather than a false completion", async (t) => {
  const { post } = await setup(t, {
    async execute(_body, _headers, options) {
      options.onReady({ model });
      throw new BridgeRequestError("Upstream unavailable.", { status: 502, code: "upstream_error" });
    },
  });
  const result = await post({ model, input: "hello", stream: true });
  const wire = await result.text();
  assert.match(wire, /response.failed/);
  assert.doesNotMatch(wire, /response.completed/);
});

test("client disconnect cancels the corresponding SDK operation", async (t) => {
  let observeAbort;
  const aborted = new Promise((resolve) => { observeAbort = resolve; });
  const { post } = await setup(t, {
    async execute(_body, _headers, options) {
      options.onReady({ model });
      await new Promise((_, reject) => options.signal.addEventListener("abort", () => {
        observeAbort();
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true }));
    },
  });
  const controller = new AbortController();
  const response = await post({ input: "hello", stream: true }, { signal: controller.signal });
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  let timer;
  await Promise.race([aborted, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("abort was not observed")), 1000); })]);
  clearTimeout(timer);
});

test("direct-server configuration requires auth, loopback, valid limits and one of seven models", () => {
  assert.throws(() => bridgeConfig({}), /BRIDGE_API_KEY/);
  assert.throws(() => bridgeConfig({ BRIDGE_API_KEY: token, HOST: "0.0.0.0" }), /loopback/);
  assert.throws(() => bridgeConfig({ BRIDGE_API_KEY: token, PORT: "65536" }), /PORT/);
  assert.throws(() => bridgeConfig({ BRIDGE_API_KEY: token, MAX_STATES: "0" }), /MAX_STATES/);
  assert.throws(() => bridgeConfig({ BRIDGE_API_KEY: token, GHCP_MODEL: "other" }), /Unsupported/);
  const config = bridgeConfig({ BRIDGE_API_KEY: token, PORT: "0" });
  assert.equal(config.port, 0);
  assert.equal(config.preferredModel, model);
});

test("body and replay limits default to 32 MiB and honor explicit overrides", () => {
  const defaults = bridgeConfig({ BRIDGE_API_KEY: token });
  assert.equal(defaults.maxBodyBytes, 32 * 1024 * 1024);
  assert.equal(defaults.managerOptions.maxReplayBytes, 32 * 1024 * 1024);

  const overrides = bridgeConfig({ BRIDGE_API_KEY: token, MAX_BODY_BYTES: "2048", MAX_REPLAY_BYTES: "512" });
  assert.equal(overrides.maxBodyBytes, 2048);
  assert.equal(overrides.managerOptions.maxReplayBytes, 512);
});

test("byte limit overrides must remain positive safe integers", () => {
  for (const name of ["MAX_BODY_BYTES", "MAX_REPLAY_BYTES"]) {
    for (const value of ["0", "-1", "1.5", "Infinity", String(Number.MAX_SAFE_INTEGER + 1)]) {
      assert.throws(() => bridgeConfig({ BRIDGE_API_KEY: token, [name]: value }), new RegExp(name));
    }
  }
});

test("request, queue and SDK lifecycle bounds validate independently of turn duration", () => {
  const config = bridgeConfig({ BRIDGE_API_KEY: token, TURN_TIMEOUT_MS: "9000", REQUEST_TIMEOUT_MS: "15000",
    MAX_REQUESTS_PER_SESSION: "3", MAX_REQUESTS: "9", SDK_READINESS_TIMEOUT_MS: "500", SDK_STARTUP_TIMEOUT_MS: "8000",
    SDK_READINESS_INTERVAL_MS: "4000", SDK_RECOVERY_BACKOFF_MS: "2000" });
  assert.equal(config.managerOptions.requestTimeoutMs, 15000);
  assert.equal(config.managerOptions.maxRequestsPerFamily, 3); assert.equal(config.managerOptions.maxRequests, 9);
  assert.equal(config.managerOptions.readinessTimeoutMs, 500); assert.equal(config.managerOptions.startupTimeoutMs, 8000);
  for (const name of ["REQUEST_TIMEOUT_MS", "MAX_REQUESTS_PER_SESSION", "MAX_REQUESTS", "SDK_READINESS_TIMEOUT_MS", "SDK_STARTUP_TIMEOUT_MS", "SDK_READINESS_INTERVAL_MS", "SDK_RECOVERY_BACKOFF_MS"]) {
    for (const value of ["0", "-1", "0.5", "Infinity"]) assert.throws(() => bridgeConfig({ BRIDGE_API_KEY: token, [name]: value }), new RegExp(name));
  }
});
