import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRequest } from "../src/request-policy.mjs";
import { ResponsesStream, createResponse, outputItems } from "../src/responses.mjs";

const meta = { id: "resp_test", model: "gpt-6-astra", createdAt: 12345 };

function sink() {
  return {
    chunks: [], writableEnded: false, destroyed: false, endCount: 0,
    write(chunk) { this.chunks.push(chunk); return true; },
    end() { this.writableEnded = true; this.endCount += 1; },
    events() {
      return this.chunks.map((chunk) => {
        const [header, data] = chunk.trimEnd().split("\n");
        const event = JSON.parse(data.slice("data: ".length));
        assert.equal(header, `event: ${event.type}`);
        return event;
      });
    },
  };
}

function delta(stream, text, messageId = "m1", extra = {}) {
  stream.handleSdkEvent({ type: "assistant.message_delta", data: { deltaContent: text, ...(messageId ? { messageId } : {}) }, ...extra });
}

function toolFixture() {
  const tools = normalizeRequest({ input: "hello", tools: [
    { type: "namespace", name: "functions", tools: [
      { type: "function", name: "read_file", parameters: { type: "object", properties: {} } },
      { type: "custom", name: "apply_patch", format: { type: "text" } },
    ] },
  ] }).tools;
  const raw = "*** Begin Patch\r\n*** Add File: a\n+한글\\path\n*** End Patch\n";
  const messages = [{ messageId: "m1", content: "I will use the tools.", toolRequests: [
    { name: tools[0].name, toolCallId: "call_function", arguments: { path: "a", offset: 2 } },
    { name: tools[1].name, toolCallId: "call_custom", arguments: { input: raw } },
  ] }];
  return { tools, messages, raw };
}

test("text SSE lifecycle uses monotonic sequences, stable IDs, and no duplicated suffix", () => {
  const res = sink();
  const stream = new ResponsesStream(res, meta);
  stream.start();
  stream.start();
  delta(stream, "he");
  delta(stream, "ll");
  const messages = [{ messageId: "m1", content: "hello" }];
  const usage = { input_tokens: 5, output_tokens: 2, total_tokens: 7 };
  const response = stream.finish({ messages, tools: [], usage });
  assert.deepEqual(response, createResponse({ ...meta, messages, usage }));
  const events = res.events();
  assert.deepEqual(events.map((event) => event.sequence_number), events.map((_, index) => index));
  assert.deepEqual(events.map((event) => event.type), [
    "response.created", "response.in_progress", "response.output_item.added", "response.content_part.added",
    "response.output_text.delta", "response.output_text.delta", "response.output_text.delta",
    "response.output_text.done", "response.content_part.done", "response.output_item.done", "response.completed",
  ]);
  assert.equal(events.filter((event) => event.type === "response.output_text.delta").map((event) => event.delta).join(""), "hello");
  assert.equal(events.at(-1).response.id, meta.id);
  assert.equal(response.output[0].phase, "final_answer");
  assert.ok(events.filter((event) => event.item_id).every((event) => event.item_id === response.output[0].id));
  assert.equal(events.find((event) => event.type === "response.output_item.added").item.id, response.output[0].id);
  assert.equal(res.endCount, 1);
  assert.deepEqual(stream.finish({ messages }), response);
  assert.deepEqual(stream.fail(new Error("too late")), response);
  assert.equal(res.events().length, events.length);
});

test("buffered function and custom tool events retain raw input, namespaces, IDs, and order", () => {
  const { tools, messages, raw } = toolFixture();
  const res = sink();
  const stream = new ResponsesStream(res, meta);
  delta(stream, "I will ");
  const response = stream.finish({ tools, messages });
  assert.deepEqual(response, createResponse({ ...meta, tools, messages }));
  assert.deepEqual(response.output.map((item) => item.type), ["message", "function_call", "custom_tool_call"]);
  assert.equal(response.output[0].phase, "commentary");
  assert.equal(response.output[1].name, "read_file");
  assert.equal(response.output[1].namespace, "functions");
  assert.equal(response.output[2].name, "apply_patch");
  assert.equal(response.output[2].namespace, "functions");
  assert.equal(response.output[2].input, raw);
  assert.equal(response.usage, null);
  const events = res.events();
  for (const [index, item] of response.output.entries()) {
    const added = events.find((event) => event.type === "response.output_item.added" && event.output_index === index);
    const done = events.find((event) => event.type === "response.output_item.done" && event.output_index === index);
    assert.equal(added.item.id, item.id);
    assert.deepEqual(done.item, item);
  }
  const functionDelta = events.find((event) => event.type === "response.function_call_arguments.delta");
  assert.deepEqual(JSON.parse(functionDelta.delta), { path: "a", offset: 2 });
  assert.equal(events.find((event) => event.type === "response.function_call_arguments.done").arguments, functionDelta.delta);
  assert.equal(events.find((event) => event.type === "response.custom_tool_call_input.delta").delta, raw);
  assert.equal(events.find((event) => event.type === "response.custom_tool_call_input.done").input, raw);
  assert.equal(events.at(-1).type, "response.completed");
  assert.equal(new Set(response.output.map((item) => item.id)).size, 3);
});

test("multiple text messages keep output indexes and phases consistent", () => {
  const res = sink();
  const stream = new ResponsesStream(res, meta);
  delta(stream, "First", "one");
  delta(stream, "Last", "two");
  const messages = [
    { messageId: "one", content: "First", phase: "commentary" },
    { messageId: "two", content: "Last", phase: "final_answer" },
  ];
  const response = stream.finish({ messages });
  assert.deepEqual(response.output, outputItems(messages));
  assert.deepEqual(res.events().filter((event) => event.type === "response.output_item.done").map((event) => event.output_index), [0, 1]);
});

test("missing SDK message IDs retain one consistent ID through the stream", () => {
  for (const [deltaId, finalId] of [[undefined, undefined], ["present", undefined], [undefined, "present"]]) {
    const res = sink();
    const stream = new ResponsesStream(res, meta);
    delta(stream, "he", deltaId ?? null);
    delta(stream, "llo", deltaId ?? null);
    const response = stream.finish({ messages: [{ ...(finalId ? { messageId: finalId } : {}), content: "hello" }] });
    const ids = res.events().flatMap((event) => [event.item_id, event.item?.id].filter(Boolean));
    assert.ok(ids.every((id) => id === response.output[0].id));
    assert.equal(response.output.length, 1);
    assert.equal(response.output[0].content[0].text, "hello");
  }
});

test("final-only text and empty responses still have exactly one completed lifecycle", () => {
  for (const messages of [[], [{ content: "non-streamed" }]]) {
    const res = sink();
    const stream = new ResponsesStream(res, meta);
    const response = stream.finish({ messages });
    assert.deepEqual(response, createResponse({ ...meta, messages }));
    assert.equal(res.events()[0].type, "response.created");
    assert.equal(res.events().at(-1).type, "response.completed");
    assert.equal(res.endCount, 1);
  }
});

test("subagent text and reasoning events never leak into root response text", () => {
  const res = sink();
  const stream = new ResponsesStream(res, meta);
  delta(stream, "nested", "sub", { agentId: "subagent" });
  stream.handleSdkEvent({ type: "assistant.message_delta", data: { messageId: "sub", deltaContent: "nested", parentToolCallId: "parent" } });
  stream.handleSdkEvent({ type: "assistant.reasoning_delta", data: { deltaContent: "not user-visible" } });
  stream.handleSdkEvent({ type: "assistant.message", data: { content: "ignored event" } });
  assert.equal(res.chunks.length, 0);
  const response = stream.finish({ messages: [{ messageId: "root", content: "answer", reasoningText: "not user-visible" }] });
  assert.equal(response.output[0].content[0].text, "answer");
  assert.ok(!JSON.stringify(response).includes("not user-visible"));
});

test("contradictory final text or message order fails without publishing a completion", () => {
  for (const messages of [
    [{ messageId: "m1", content: "different" }],
    [{ messageId: "other", content: "hello" }],
    [],
  ]) {
    const res = sink();
    const stream = new ResponsesStream(res, meta);
    delta(stream, "hello");
    let failure;
    assert.throws(() => stream.finish({ messages }), (error) => {
      failure = error;
      return error.status === 502 && error.code === "invalid_upstream_response";
    });
    const response = stream.fail(failure);
    assert.equal(response.status, "failed");
    assert.equal(response.output[0].content[0].text, "hello");
    assert.equal(response.output[0].status, "incomplete");
    assert.equal(res.events().at(-1).type, "response.failed");
    assert.ok(!res.events().some((event) => event.type === "response.completed" || event.type === "response.output_item.done"));
    stream.finish({ messages: [{ messageId: "m1", content: "hello" }] });
    assert.equal(res.endCount, 1);
  }
});

test("upstream failure before content uses a failed response and closes once", () => {
  const res = sink();
  const stream = new ResponsesStream(res, meta);
  const response = stream.fail(Object.assign(new Error("upstream unavailable"), { code: "unavailable" }));
  assert.equal(response.error.message, "upstream unavailable");
  assert.equal(response.error.code, "unavailable");
  assert.deepEqual(res.events().map((event) => event.type), ["response.created", "response.in_progress", "response.failed"]);
  assert.equal(response.usage, null);
  stream.fail(new Error("again"));
  assert.equal(res.endCount, 1);
});

test("closed clients abort writes and do not receive false completion", () => {
  const res = sink();
  const stream = new ResponsesStream(res, meta);
  stream.start();
  res.destroyed = true;
  assert.throws(() => delta(stream, "hello"), { name: "AbortError" });
  assert.equal(stream.fail(new Error("closed")), null);
  assert.ok(!res.events().some((event) => event.type === "response.completed"));
});

test("unknown tools, invalid arguments, and duplicate tool IDs fail closed", () => {
  const { tools, messages } = toolFixture();
  const first = messages[0].toolRequests[0];
  const second = messages[0].toolRequests[1];
  for (const requests of [
    [{ ...first, name: "undeclared_builtin" }],
    [{ ...first, toolCallId: "" }],
    [{ ...first, arguments: "{" }],
    [{ ...first, arguments: [] }],
    [{ ...second, arguments: { input: 5 } }],
    [{ ...second, arguments: { input: "raw", extra: true } }],
    [first, first],
  ]) {
    assert.throws(() => outputItems([{ content: "", toolRequests: requests }], tools), {
      status: 502, code: "invalid_upstream_response",
    });
  }
  assert.throws(() => outputItems([{ messageId: "same", content: "one" }, { messageId: "same", content: "two" }]), /duplicate message ID/);
  const parsed = outputItems([{ toolRequests: [{ ...first, arguments: '{"path":"a"}' }] }], tools);
  assert.equal(parsed[0].arguments, '{"path":"a"}');
  const res = sink();
  const stream = new ResponsesStream(res, meta);
  assert.throws(() => stream.handleSdkEvent({ type: "assistant.message_delta", data: { deltaContent: 5 } }), /invalid message delta/);
  assert.equal(res.chunks.length, 0);
});
