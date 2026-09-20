import test from "node:test";
import assert from "node:assert/strict";

import { BridgeRequestError, normalizeRequest } from "../src/request-policy.mjs";
import { canonicalItem, outputItems } from "../src/responses.mjs";

const functionTool = {
  type: "function", name: "read_file", description: "Read a file.", strict: false,
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};
const customTool = {
  type: "custom", name: "exec", description: "Execute the supplied script.",
  format: { type: "grammar", syntax: "lark", definition: "start: /[\\s\\S]*/" },
};

function rejects(extra, pattern) {
  assert.throws(() => normalizeRequest({ input: "hello", ...extra }), (error) => {
    assert.ok(error instanceof BridgeRequestError);
    assert.equal(error.status, 400);
    assert.equal(error.code, "invalid_request_error");
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("normalization records omitted versus explicit instructions and tool declarations", () => {
  const request = normalizeRequest({ input: "hello" });
  assert.deepEqual(request.input, [{ type: "message", role: "user", content: "hello" }]);
  assert.equal(request.stream, false);
  assert.equal(request.toolChoice, "auto");
  assert.equal(request.toolsProvided, false);
  assert.equal(request.instructionsProvided, false);
  assert.equal(request.parallelToolCalls, true);
  assert.equal(normalizeRequest({ input: "hello", parallel_tool_calls: false }).parallelToolCalls, false);
  rejects({ parallel_tool_calls: "false" }, /must be a boolean/);
  assert.deepEqual(request.tools, []);
  const explicit = normalizeRequest({ input: "next", previous_response_id: "resp_prior", tools: [], instructions: null });
  assert.equal(explicit.toolsProvided, true);
  assert.equal(explicit.instructionsProvided, true);
  assert.equal(explicit.instructions, "");
  assert.equal(explicit.previousResponseId, "resp_prior");
  const disabled = normalizeRequest({ input: "next", previous_response_id: "resp_prior", tool_choice: "none" });
  assert.equal(disabled.toolsProvided, false);
  assert.equal(disabled.toolChoice, "none");
  assert.deepEqual(disabled.tools, []);
});

test("Codex additional_tools namespaces normalize with safe SDK names and diagnosed hints", () => {
  const diagnostics = [];
  const body = {
    model: "gpt-6-astra", stream: true, store: false, tool_choice: "auto", parallel_tool_calls: true,
    reasoning: { effort: "low", context: "all_turns" },
    include: ["reasoning.encrypted_content"], text: { verbosity: "low" },
    prompt_cache_key: "private-cache-key", client_metadata: { private: "metadata-value" },
    input: [
      { type: "additional_tools", id: "at_1", role: "developer", tools: [
        { type: "namespace", name: "functions", tools: [customTool, functionTool] },
      ] },
      { role: "developer", content: [{ type: "input_text", text: "one" }, { type: "input_text", text: "two" }] },
      { role: "user", content: [{ type: "input_text", text: "read it" }] },
    ],
  };
  const original = structuredClone(body);
  const request = normalizeRequest(body, (event) => diagnostics.push(event));
  assert.deepEqual(body, original);
  assert.equal(request.toolsProvided, true);
  assert.equal(request.reasoningEffort, "low");
  assert.equal(request.input.length, 2);
  assert.equal(request.input[0].content, "one\n\ntwo");
  assert.equal(request.tools[0].namespace, "functions");
  assert.equal(request.tools[0].originalName, "exec");
  assert.match(request.tools[0].name, /^[A-Za-z0-9_]{1,64}$/);
  assert.deepEqual(request.tools[0].parameters.required, ["input"]);
  assert.equal(request.tools[0].parameters.additionalProperties, false);
  assert.equal(request.tools[0].parameters.properties.input.type, "string");
  assert.match(request.tools[0].description, /advisory; not enforced/);
  assert.ok(diagnostics[0].fields.includes("reasoning.encrypted_content"));
  assert.ok(diagnostics[0].fields.includes("text.verbosity"));
  assert.ok(!JSON.stringify(diagnostics).includes("private-cache-key"));
  assert.ok(!JSON.stringify(diagnostics).includes("metadata-value"));
});

test("SDK tool identities are deterministic and do not collide across namespaces", () => {
  const tools = [
    functionTool,
    { type: "namespace", name: "functions", tools: [functionTool] },
    { type: "namespace", name: "other", tools: [functionTool] },
    { ...functionTool, name: "functions.read_file" },
  ];
  const first = normalizeRequest({ input: "hello", tools }).tools;
  const second = normalizeRequest({ input: "hello", tools: structuredClone(tools) }).tools;
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((tool) => tool.name)).size, 4);
});

test("equivalent repeated tool declarations deduplicate but conflicting ones fail", () => {
  const reordered = { ...functionTool, parameters: {
    required: ["path"], properties: { path: { type: "string" } }, type: "object",
  } };
  const input = [{ type: "additional_tools", role: "developer", tools: [reordered] }, { role: "user", content: "hello" }];
  assert.equal(normalizeRequest({ input, tools: [functionTool] }).tools.length, 1);
  assert.equal(normalizeRequest({ input, tools: [functionTool], tool_choice: "none" }).tools.length, 0);
  rejects({ tools: [functionTool, { ...functionTool, description: "different behavior" }] }, /Conflicting declarations/);
  rejects({ tools: [{ type: "namespace", name: "outer", tools: [{ type: "namespace", name: "inner", tools: [] }] }] }, /Nested/);
});

test("canonical history preserves tool namespace and raw custom input without wire metadata", () => {
  const patch = "*** Begin Patch\r\n+한글\\path\n*** End Patch\n";
  const tools = normalizeRequest({ input: "hello", tools: [{ type: "namespace", name: "functions", tools: [functionTool, customTool] }] }).tools;
  const messages = [{ messageId: "message_one", phase: "commentary", content: "Using tools", toolRequests: [
    { name: tools[0].name, toolCallId: "call_one", arguments: { path: "file.txt" } },
    { name: tools[1].name, toolCallId: "call_two", arguments: { input: patch } },
  ] }];
  const wire = outputItems(messages, tools);
  const canonical = wire.map(canonicalItem);
  assert.deepEqual(normalizeRequest({ input: wire }).input, canonical);
  assert.deepEqual(canonical[0], { type: "message", role: "assistant", content: "Using tools" });
  assert.deepEqual(canonical[1], { type: "function_call", name: "read_file", namespace: "functions", call_id: "call_one", arguments: { path: "file.txt" } });
  assert.equal(canonical[2].input, patch);
  assert.equal(canonical[2].namespace, "functions");
  assert.equal(canonical[2].call_id, "call_two");
  assert.deepEqual(canonicalItem({ ...wire[1], arguments: ' { "path" : "file.txt" } ' }), canonical[1]);
});

test("canonical tool results preserve text and accept text-only content parts", () => {
  assert.deepEqual(canonicalItem({ type: "custom_tool_call_output", id: "ignored", call_id: "call", output: "raw\r\ntext" }), {
    type: "custom_tool_call_output", call_id: "call", output: "raw\r\ntext",
  });
  assert.deepEqual(canonicalItem({ type: "function_call_output", call_id: "call", output: [{ type: "input_text", text: "result" }] }), {
    type: "function_call_output", call_id: "call", output: "result",
  });
});

test("unsupported semantics and unenforceable controls are rejected explicitly", () => {
  for (const extra of [
    { store: true }, { background: true },
    { tool_choice: "required" }, { tool_choice: { type: "function", name: "read_file" } },
    { tools: [{ ...functionTool, strict: true }] }, { tools: [{ type: "web_search", name: "web_search" }] },
    { text: { format: { type: "json_schema", name: "output", schema: {} } } },
    { reasoning: { summary: "auto" } }, { reasoning: { summary: "detailed" } },
    { max_output_tokens: 10 }, { max_tool_calls: 2 }, { temperature: 0 }, { top_p: 1 },
    { truncation: "auto" }, { service_tier: "priority" }, { include: ["output_text.logprobs"] },
    { unknown_semantic_field: true },
  ]) rejects(extra);
});

test("malformed input, non-text modalities, and unknown item fields fail before execution", () => {
  for (const extra of [
    { stream: "true" }, { tools: null }, { tools: {} }, { previous_response_id: 3 },
    { instructions: [] }, { input: {} }, { input: [null] },
    { input: [{ role: "tool", content: "unsupported role" }] },
    { input: [{ role: "user", content: [{ type: "input_image", image_url: "unused" }] }] },
    { input: [{ type: "reasoning", encrypted_content: "opaque" }] },
    { input: [{ type: "item_reference", id: "item" }] },
    { input: [{ type: "function_call", name: "tool", call_id: "call", arguments: "{" }] },
    { input: [{ type: "custom_tool_call", name: "tool", call_id: "call", input: {} }] },
    { input: [{ role: "user", content: "text", unsupported: true }] },
    { input: [{ type: "additional_tools", role: "user", tools: [] }] },
    { tools: [{ ...customTool, format: { type: "grammar", syntax: "unknown", definition: "x" } }] },
    { tools: [{ ...functionTool, parameters: [] }] },
  ]) rejects(extra);
  assert.throws(() => normalizeRequest(null), BridgeRequestError);
});
