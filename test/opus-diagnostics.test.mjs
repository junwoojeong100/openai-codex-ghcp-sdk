import assert from "node:assert/strict";
import test from "node:test";
import { CopilotWireObserver, requestEvidence, responseEvidence } from "../scripts/diagnostics/copilot-wire.mjs";
import { answerEvidence, parseArguments, PROBES } from "../scripts/diagnose-opus.mjs";

const model = "claude-opus-5.5";
const frame = data => `data: ${JSON.stringify(data)}\r\n\r\n`;
const evidence = (text, type = "text/event-stream") => responseEvidence(Buffer.from(text), type, model);
const context = () => ({ transport: "http", signal: new AbortController().signal, headers: { authorization: "private-auth" },
  url: "https://example.invalid/private-path?secret=private-query" });

test("request evidence records hashes and counts, not prompts, tools or credentials", () => {
  const result = requestEvidence(Buffer.from(JSON.stringify({ model, stream: true,
    messages: [{ role: "user", content: "private-prompt" }], tools: [{ name: "private-tool-name" }],
    api_key: "private-key" })), model);
  assert.equal(result.modelMatches, true);
  assert.equal(result.messageCount, 1);
  assert.equal(result.toolCount, 1);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(result).includes("private-"));
  assert.equal(requestEvidence(Buffer.from("{private-invalid-json"), model).parsed, false);
});

test("SSE filter evidence uses an explicit upstream finish reason, including zero output tokens", () => {
  const result = evidence(frame({ model, choices: [{ index: 0, finish_reason: "content_filter", delta: { content: null } }],
    usage: { prompt_tokens: 3768, completion_tokens: 0 } }) + "data: [DONE]\r\n\r\n");
  assert.equal(result.contentFilter, true);
  assert.deepEqual(result.finishReasons, ["content_filter"]);
  assert.equal(result.inputTokens, 3768);
  assert.equal(result.outputTokens, 0);
  assert.equal(result.done, true);
  assert.equal(result.modelMatches, true);
});

test("assistant prose that mentions content_filter is not filter evidence", () => {
  const result = evidence(frame({ model, choices: [{ delta: { content: "private-text: content_filter" } }] }) +
    frame({ choices: [{ finish_reason: "stop" }], usage: { completion_tokens: 8 } }));
  assert.equal(result.contentFilter, false);
  assert.deepEqual(result.finishReasons, ["stop"]);
  assert.ok(result.textBytes > 0);
  assert.ok(!JSON.stringify(result).includes("private-text"));
});

test("buffered JSON and SSE yield the same authoritative filter and token metadata", () => {
  const json = { model, choices: [{ finish_reason: "content_filter", message: { role: "assistant" } }],
    usage: { prompt_tokens: 100, completion_tokens: 0 } };
  const buffered = evidence(JSON.stringify(json), "application/json"), streaming = evidence(frame(json));
  for (const key of ["modelMatches", "inputTokens", "outputTokens", "contentFilter", "finishReasons"]) {
    assert.deepEqual(buffered[key], streaming[key]);
  }
});

test("unknown reasons, mismatched model names and malformed data never leak into evidence", () => {
  const result = evidence("data: private-invalid-json\n\n" + frame({ model: "private-other-model",
    choices: [null, { finish_reason: "private-reason", delta: { content: "private-response", tool_calls: [{ arguments: "private-args" }] } }],
    usage: { prompt_tokens: -1, completion_tokens: "private-tokens" } }));
  assert.equal(result.invalidChunks, 1);
  assert.equal(result.modelMatches, false);
  assert.equal(result.contentFilter, false);
  assert.equal(result.inputTokens, null);
  assert.equal(result.outputTokens, null);
  assert.equal(result.toolCallDeltas, 1);
  assert.ok(!JSON.stringify(result).includes("private-"));
});

test("wire observation forwards the exact original request and response without retries", async () => {
  const text = frame({ model, choices: [{ delta: { content: "private-한글" }, finish_reason: "stop" }] });
  const request = new Request("https://example.invalid", { method: "POST", headers: { authorization: "Bearer private-token" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "private-prompt" }] }) });
  const response = new Response(text, { headers: { "content-type": "text/event-stream", "private-header": "private-secret" } });
  const ctx = context(); let calls = 0;
  const observer = new CopilotWireObserver({ model, forward: async (sent, passedContext) => {
    calls++; assert.equal(sent, request); assert.equal(passedContext, ctx);
    assert.equal(sent.headers.get("authorization"), "Bearer private-token");
    return response;
  } });
  const returned = await observer.sendRequest(request, ctx);
  assert.equal(returned, response);
  assert.equal(await returned.text(), text);
  await observer.drain();
  assert.equal(calls, 1);
  assert.equal(observer.records[0].request.complete, true);
  assert.equal(observer.records[0].response.complete, true);
  assert.equal(observer.records[0].response.textBytes, Buffer.byteLength("private-한글"));
  assert.equal(observer.pending.size, 0);
  assert.ok(!JSON.stringify(observer.records).includes("private-"));
});

test("observation byte caps do not truncate the forwarded model response", async () => {
  const text = "x".repeat(1024), response = new Response(text);
  const observer = new CopilotWireObserver({ model, maxBytes: 16, forward: async () => response });
  const returned = await observer.sendRequest(new Request("https://example.invalid"), context());
  assert.equal(await returned.text(), text);
  await observer.drain();
  assert.equal(observer.records[0].response.complete, false);
  assert.equal(observer.records[0].response.limit, "bytes");
  assert.equal(observer.records[0].response.bytes, 16);
});

test("observation timeouts cancel only their tee branch and preserve the upstream stream", async () => {
  let controller;
  const response = new Response(new ReadableStream({ start(c) { controller = c; c.enqueue(new TextEncoder().encode("original-한글")); } }));
  const observer = new CopilotWireObserver({ model, timeoutMs: 10, forward: async () => response });
  const returned = await observer.sendRequest(new Request("https://example.invalid"), context());
  await observer.drain();
  assert.equal(observer.records[0].response.limit, "time");
  assert.equal(observer.records[0].response.complete, false);
  controller.close();
  assert.equal(await returned.text(), "original-한글");
  assert.equal(observer.pending.size, 0);
});

test("network errors are forwarded once rather than retried or turned into filter evidence", async () => {
  let calls = 0; const failure = new Error("private-network-detail");
  const observer = new CopilotWireObserver({ model, forward: async () => { calls++; throw failure; } });
  await assert.rejects(observer.sendRequest(new Request("https://example.invalid"), context()), error => error === failure);
  await observer.drain();
  assert.equal(calls, 1);
  assert.equal(observer.records[0].response, undefined);
  assert.ok(!JSON.stringify(observer.records).includes("private-"));
});

test("the diagnostic requires explicit execution and cannot change model, prompt or filter policy", () => {
  assert.deepEqual(parseArguments([]), { execute: false });
  assert.deepEqual(parseArguments(["--execute", "--output", "/tmp/owned-probe"]), { execute: true, output: "/tmp/owned-probe" });
  for (const args of [["--output", "somewhere"], ["--execute", "--execute"], ["--model", "other"], ["--prompt", "other"], ["--execute", "--output"]]) {
    assert.throws(() => parseArguments(args));
  }
  assert.equal(PROBES.length, 7);
  assert.equal(PROBES.filter(p => p.prompt === "exact").length, 4);
  assert.ok(Object.isFrozen(PROBES) && PROBES.every(Object.isFrozen));
});

test("Anthropic refusal metadata survives SDK content_filter normalization in diagnostic evidence", () => {
  const result = evidence(frame({ type: "message_start", message: { model, usage: {
    input_tokens: 41, output_tokens: 0, cache_read_input_tokens: 3462, cache_creation_input_tokens: 270 } } }) +
    frame({ type: "message_delta", delta: { stop_reason: "refusal", stop_details: {
      type: "refusal", category: "reasoning_extraction", explanation: "private-provider-explanation" } },
    usage: { input_tokens: 41, output_tokens: 0, cache_read_input_tokens: 3462, cache_creation_input_tokens: 270 } }) +
    frame({ type: "message_stop" }));
  assert.equal(result.nativeRefusal, true);
  assert.equal(result.contentFilter, false, "do not relabel the raw native stop reason");
  assert.equal(result.explicitBlock, true);
  assert.deepEqual(result.stopReasons, ["refusal"]);
  assert.deepEqual(result.refusalCategories, ["reasoning_extraction"]);
  assert.deepEqual(result.protocols, ["anthropic-messages"]);
  assert.equal(result.inputTokens, 3773, "native uncached input is not the total input");
  assert.equal(result.outputTokens, 0);
  assert.equal(result.done, true);
  assert.ok(!JSON.stringify(result).includes("private-"));
});

test("Anthropic tool and text controls are counted without retaining tool data", () => {
  const result = evidence(frame({ type: "message_start", message: { model } }) +
    frame({ type: "content_block_start", content_block: { type: "tool_use", name: "private-tool", input: { secret: "private-input" } } }) +
    frame({ type: "content_block_delta", delta: { type: "text_delta", text: "한글" } }) +
    frame({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 38 } }));
  assert.equal(result.explicitBlock, false);
  assert.equal(result.toolCallDeltas, 1);
  assert.equal(result.textBytes, Buffer.byteLength("한글"));
  assert.equal(result.outputTokens, 38);
  assert.ok(!JSON.stringify(result).includes("private-"));
});

test("buffered native refusals whitelist categories and omit arbitrary refusal detail", () => {
  const result = evidence(JSON.stringify({ type: "message", model, stop_reason: "refusal",
    stop_details: { category: "private-category", explanation: "private-explanation" }, content: [] }), "application/json");
  assert.equal(result.explicitBlock, true);
  assert.deepEqual(result.refusalCategories, ["other"]);
  assert.ok(!JSON.stringify(result).includes("private-"));
});

test("catalog and unknown protocol responses mean no block evidence, not an unfiltered inference", () => {
  const result = evidence(JSON.stringify({ data: [{ id: model, private: "private-metadata" }] }), "application/json");
  assert.equal(result.explicitBlock, null);
  assert.equal(result.modelMatches, null);
  assert.deepEqual(result.protocols, []);
  assert.ok(!JSON.stringify(result).includes("private-"));
});


test("diagnostic marker preservation is not confused with an exact-copy pass", () => {
  const fixture = "value:N_one_한글\nreceipt:N_two_한글";
  const reformatted = answerEvidence("- **value:** `N_one_한글`\n- **receipt:** `N_two_한글`", fixture);
  assert.equal(reformatted.fixtureValuesPreserved, true);
  assert.equal(reformatted.exactFixture, false);
  assert.equal(answerEvidence(fixture, fixture).exactFixture, true);
  assert.ok(!JSON.stringify(reformatted).includes("N_one"));
});
