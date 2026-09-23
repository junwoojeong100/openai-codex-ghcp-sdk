import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL, SUPPORTED_MODEL_IDS, modelCatalog, resolveContextTier, resolveCopilotModel, resolveReasoningEffort, supportedModels } from "../src/model-map.mjs";

const models = SUPPORTED_MODEL_IDS.map((id) => ({ id, policy: { state: "enabled" } }));

test("only the six requested models are exposed in the requested picker order", () => {
  assert.deepEqual(SUPPORTED_MODEL_IDS, ["claude-opus-5.5", "claude-sonnet-5", "claude-haiku-4.5", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]);
  assert.equal(DEFAULT_MODEL, "gpt-6-astra");
  assert.deepEqual(supportedModels([...models].reverse().concat({ id: "unrelated-model" })).map((entry) => entry.id), SUPPORTED_MODEL_IDS);
  for (const requested of SUPPORTED_MODEL_IDS) assert.equal(resolveCopilotModel({ requested, models }), requested);
  assert.throws(() => resolveCopilotModel({ requested: "unrelated-model", models: [{ id: "unrelated-model" }] }), /Unsupported/);
  for (const removed of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "claude-opus-5"]) {
    assert.throws(() => resolveCopilotModel({ requested: removed, models: [{ id: removed }] }), /Unsupported/);
    assert.deepEqual(supportedModels([{ id: removed }]), []);
  }
});

test("unavailable or policy-disabled models never silently fall back", () => {
  assert.throws(() => resolveCopilotModel({ requested: "gpt-6-astra", models: [] }), /unavailable/);
  assert.throws(() => resolveCopilotModel({ requested: "gpt-6-astra", models: [{ id: "gpt-6-astra", policy: { state: "disabled" } }] }), /unavailable/);
});

test("catalog serves both OpenAI IDs and Codex model metadata from the live SDK catalog", () => {
  const catalog = modelCatalog([
    { id: "gpt-6-astra", name: "Test display name", supportedReasoningEfforts: ["low", "high"], capabilities: { limits: { max_context_window_tokens: 123_456 } } },
    { id: "claude-haiku-4.5", supportedReasoningEfforts: ["high"], capabilities: { supports: { reasoningEffort: false } } },
    { id: "gpt-6-sol", policy: { state: "disabled" } },
    { id: "unrelated-model" },
  ]);
  assert.deepEqual(catalog.data.map((entry) => entry.id), ["claude-haiku-4.5", "gpt-6-astra"]);
  assert.deepEqual(catalog.models.map((entry) => entry.slug), catalog.data.map((entry) => entry.id));
  const [fixed, reasoning] = catalog.models;
  assert.equal(reasoning.display_name, "Test display name");
  assert.deepEqual(reasoning.supported_reasoning_levels.map((entry) => entry.effort), ["low", "high"]);
  assert.equal(reasoning.default_reasoning_level, "low");
  assert.equal(reasoning.context_window, 123_456);
  assert.equal(reasoning.max_context_window, 123_456);
  assert.equal(reasoning.auto_compact_token_limit, 98_764);
  assert.deepEqual(fixed.supported_reasoning_levels, []);
  assert.equal(fixed.default_reasoning_level, null);
  assert.equal(Object.hasOwn(fixed, "context_window"), false);
  for (const entry of catalog.models) {
    assert.equal(entry.shell_type, "unified_exec");
    assert.equal(entry.apply_patch_tool_type, "freeform");
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

test("context budgets use the largest advertised tier and reserve output space before automatic compaction", () => {
  const catalog = modelCatalog([
    { id: "gpt-6-astra", capabilities: { limits: {
      max_context_window_tokens: 1_178_000, max_prompt_tokens: 1_050_000, max_output_tokens: 128_000,
    } }, billing: { tokenPrices: {
      contextMax: 272_000, maxPromptTokens: 272_000, longContext: { maxPromptTokens: 872_000 },
    } } },
    { id: "claude-haiku-4.5", capabilities: { limits: {
      max_context_window_tokens: 200_000, max_prompt_tokens: 136_000, max_output_tokens: 64_000,
    } } },
    { id: "claude-sonnet-5", capabilities: { limits: {
      max_context_window_tokens: 32_768, max_output_tokens: 8192,
    } } },
  ]);
  const byId = new Map(catalog.models.map(entry => [entry.slug, entry]));
  for (const [id, window, threshold] of [
    ["gpt-6-astra", 872_000, 697_600],
    ["claude-haiku-4.5", 136_000, 108_800],
    ["claude-sonnet-5", 24_576, 19_660],
  ]) {
    const entry = byId.get(id);
    assert.equal(entry.context_window, window);
    assert.equal(entry.max_context_window, window);
    assert.equal(entry.auto_compact_token_limit, threshold);
  }
});

test("all six models expose their maximum tier input budgets, not a forced one-million-token input limit", () => {
  for (const [id, total, output, prompt, standard, extended, budget, threshold] of [
    ["claude-opus-5.5", 1_000_000, 128_000, 872_000, 200_000, 872_000, 872_000, 697_600],
    ["claude-sonnet-5", 1_000_000, 64_000, 936_000, 200_000, 936_000, 936_000, 748_800],
    ["claude-haiku-4.5", 200_000, 64_000, 136_000, undefined, undefined, 136_000, 108_800],
    ["gpt-6-astra", 1_050_000, 128_000, 1_050_000, 272_000, 1_050_000, 922_000, 737_600],
    ["gpt-6-sol", 1_000_000, 128_000, 872_000, 272_000, 872_000, 872_000, 697_600],
    ["gpt-6-luna", 1_000_000, 128_000, 872_000, 272_000, 872_000, 872_000, 697_600],
  ]) {
    const entry = { id, capabilities: { limits: {
      max_context_window_tokens: total, max_prompt_tokens: prompt, max_output_tokens: output,
    } }, billing: { tokenPrices: {
      maxPromptTokens: standard, contextMax: standard,
      ...(extended ? { longContext: { maxPromptTokens: extended, contextMax: extended } } : {}),
    } } };
    assert.equal(resolveContextTier(entry), extended ? "long_context" : "default", id);
    const [actual] = modelCatalog([entry]).models;
    assert.equal(actual.context_window, budget, id);
    assert.equal(actual.max_context_window, budget, id);
    assert.equal(actual.auto_compact_token_limit, threshold, id);
  }
});

test("context tiers follow provider support, including legacy budgets and unpriced tiers", () => {
  const entry = { id: DEFAULT_MODEL, capabilities: { limits: {
    max_context_window_tokens: 1_000_000, max_output_tokens: 128_000,
  } } };
  for (const longContext of [undefined, null, false, true, "long_context", []]) {
    const candidate = { ...entry, billing: { tokenPrices: { maxPromptTokens: 200_000, longContext } } };
    assert.equal(resolveContextTier(candidate), "default");
    assert.equal(modelCatalog([candidate]).models[0].context_window, 200_000);
  }
  const legacy = { ...entry, billing: { tokenPrices: {
    contextMax: 200_000, longContext: { contextMax: 800_000 },
  } } };
  assert.equal(resolveContextTier(legacy), "long_context");
  assert.equal(modelCatalog([legacy]).models[0].context_window, 800_000);
  const unpriced = { ...entry, supportedContextTiers: ["default", "long_context"] };
  assert.equal(resolveContextTier(unpriced), "long_context");
  assert.equal(modelCatalog([unpriced]).models[0].context_window, 872_000);
  assert.equal(resolveContextTier({ ...entry, supportedContextTiers: ["default"] }), "default");
  assert.equal(resolveContextTier({ ...entry, supportedContextTiers: "long_context" }), "default");
  assert.equal(resolveContextTier({ ...entry, billing: { tokenPrices: { longContext: {} } } }), "long_context");
});

test("missing or invalid token limits are not replaced with Codex's unrelated fallback window", () => {
  for (const limit of [undefined, 0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "200000"]) {
    const [entry] = modelCatalog([{ id: DEFAULT_MODEL, capabilities: { limits: { max_context_window_tokens: limit } } }]).models;
    assert.equal(Object.hasOwn(entry, "context_window"), false);
    assert.equal(Object.hasOwn(entry, "auto_compact_token_limit"), false);
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
