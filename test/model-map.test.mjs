import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL, SUPPORTED_MODEL_IDS, modelCatalog, resolveCopilotModel, resolveReasoningEffort, supportedModels } from "../src/model-map.mjs";

const models = SUPPORTED_MODEL_IDS.map((id) => ({ id, policy: { state: "enabled" } }));

test("only the seven requested models are exposed in the requested order", () => {
  assert.equal(SUPPORTED_MODEL_IDS.length, 7);
  assert.equal(DEFAULT_MODEL, "gpt-6-astra");
  assert.deepEqual(supportedModels([...models].reverse().concat({ id: "unrelated-model" })).map((entry) => entry.id), SUPPORTED_MODEL_IDS);
  for (const requested of SUPPORTED_MODEL_IDS) assert.equal(resolveCopilotModel({ requested, models }), requested);
  assert.throws(() => resolveCopilotModel({ requested: "unrelated-model", models: [{ id: "unrelated-model" }] }), /Unsupported/);
});

test("unavailable or policy-disabled models never silently fall back", () => {
  assert.throws(() => resolveCopilotModel({ requested: "gpt-6-astra", models: [] }), /unavailable/);
  assert.throws(() => resolveCopilotModel({ requested: "gpt-6-astra", models: [{ id: "gpt-6-astra", policy: { state: "disabled" } }] }), /unavailable/);
});

test("catalog serves both OpenAI IDs and Codex model metadata from the live SDK catalog", () => {
  const catalog = modelCatalog([
    { id: "gpt-6-astra", name: "Test display name", supportedReasoningEfforts: ["low", "high"], capabilities: { limits: { max_context_window_tokens: 123_456 } } },
    { id: "claude-haiku-4.5", supportedReasoningEfforts: ["high"], capabilities: { supports: { reasoningEffort: false } } },
    { id: "gpt-5.6-sol", policy: { state: "disabled" } },
    { id: "unrelated-model" },
  ]);
  assert.deepEqual(catalog.data.map((entry) => entry.id), ["gpt-6-astra", "claude-haiku-4.5"]);
  assert.deepEqual(catalog.models.map((entry) => entry.slug), catalog.data.map((entry) => entry.id));
  const [reasoning, fixed] = catalog.models;
  assert.equal(reasoning.display_name, "Test display name");
  assert.deepEqual(reasoning.supported_reasoning_levels.map((entry) => entry.effort), ["low", "high"]);
  assert.equal(reasoning.default_reasoning_level, "low");
  assert.equal(reasoning.context_window, 123_456);
  assert.equal(reasoning.max_context_window, 123_456);
  assert.deepEqual(fixed.supported_reasoning_levels, []);
  assert.equal(fixed.default_reasoning_level, null);
  assert.equal(Object.hasOwn(fixed, "context_window"), false);
  for (const entry of catalog.models) {
    assert.equal(entry.shell_type, "unified_exec");
    assert.equal(entry.visibility, "list");
    assert.equal(entry.supported_in_api, true);
    assert.equal(entry.supports_reasoning_summary_parameter, false);
    assert.equal(entry.support_verbosity, false);
    assert.deepEqual(entry.input_modalities, ["text"]);
    assert.deepEqual(entry.experimental_supported_tools, []);
    assert.deepEqual(entry.truncation_policy, { mode: "bytes", limit: 10_000 });
    assert.ok(entry.base_instructions.length > 0);
  }
});

test("reasoning respects actual catalog support and diagnoses non-configurable models", () => {
  const model = { id: "gpt-6-astra", capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ["low", "high"] };
  assert.equal(resolveReasoningEffort({ requested: "high", model }), "high");
  assert.throws(() => resolveReasoningEffort({ requested: "max", model }), /supported: low, high/);
  const diagnostics = [];
  assert.equal(resolveReasoningEffort({ requested: "low", model: { id: "claude-haiku-4.5", capabilities: { supports: { reasoningEffort: false } } } }, (event) => diagnostics.push(event)), undefined);
  assert.equal(diagnostics[0].event, "bridge.reasoning_not_configurable");
});
