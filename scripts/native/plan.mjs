import assert from "node:assert/strict";
import { NATIVE_CATALOG, NATIVE_FEATURES, NATIVE_SCENARIOS, NATIVE_MODELS, DIMENSIONS, catalogFingerprint } from "./catalog.mjs";
import { driverFor } from "./registry.mjs";

export function assessScenarioDesign() {
  const problems = [];
  const check = (condition, message) => { if (!condition) problems.push(message); };
  const ids = new Set();
  for (const feature of NATIVE_FEATURES) {
    check(!ids.has(feature.id), `Duplicate feature: ${feature.id}`);
    ids.add(feature.id);
    check(feature.siblingId === feature.id, `Missing sibling crosswalk: ${feature.id}`);
    check(feature.sources.length > 0 && feature.sources.every((key) => NATIVE_CATALOG.sourceSnapshot.sources[key]), `Unknown source for ${feature.id}`);
    check(feature.prerequisite.length > 0 && feature.adaptation.length > 0, `Missing scope/prerequisite for ${feature.id}`);
    check(JSON.stringify(feature.scenarios.map(({ dimension }) => dimension)) === JSON.stringify(DIMENSIONS), `Missing normal/failure/lifecycle: ${feature.id}`);
    for (const scenario of feature.scenarios) {
      check(scenario.id === `${feature.id}.${scenario.dimension}`, `Unstable scenario ID: ${scenario.id}`);
      check(scenario.steps.length >= 4 && scenario.steps.every((step) => step.length > 10), `Incomplete steps: ${scenario.id}`);
      check(scenario.assertions.length === 5 && new Set(scenario.assertions.map(({ id }) => id)).size === 5, `Incomplete assertions: ${scenario.id}`);
      check(scenario.assertions.every(({ expected, evidence }) => expected && scenario.evidence.includes(evidence)), `Missing evidence contract: ${scenario.id}`);
    }
  }
  return { kind: "scenario-design", catalogId: NATIVE_CATALOG.id, catalogHash: catalogFingerprint(), modelCalls: 0,
    features: NATIVE_FEATURES.length, scenarios: NATIVE_SCENARIOS.length, modelCaseSlots: NATIVE_SCENARIOS.length * NATIVE_MODELS.length,
    complete: problems.length === 0, problems,
    note: "Design completeness is not driver readiness, a live pass, or a compatibility percentage." };
}

export function runnerPlan({ models = NATIVE_MODELS, selected, resolveDriver = driverFor } = {}) {
  assert.ok(models.length > 0 && new Set(models).size === models.length && models.every((id) => NATIVE_MODELS.includes(id)), "Select distinct allowlisted models.");
  if (selected) assert.ok(selected.length && new Set(selected).size === selected.length && selected.every((id) => NATIVE_SCENARIOS.some((scenario) => scenario.id === id)), "Select distinct catalog scenario IDs.");
  const design = assessScenarioDesign();
  assert.equal(design.complete, true, design.problems.join("\n"));
  const rows = NATIVE_SCENARIOS.filter(({ id }) => !selected || selected.includes(id)).map((scenario) => {
    const registration = resolveDriver(scenario);
    const feature = NATIVE_FEATURES.find(({ id }) => id === scenario.featureId);
    const hasDriver = typeof registration?.execute === "function";
    const hasOracle = typeof registration?.evaluate === "function";
    const covered = registration?.covers ?? [];
    const gaps = [
      ...(!hasDriver ? ["Native execution driver is not implemented."] : []),
      ...(!hasOracle ? ["Independent artifact evaluator is not implemented."] : []),
      ...["primary", "secondary"].filter((name) => !covered.includes(name)).map((name) => `${name}: ${scenario.predicates[name]}`),
      ...(registration?.gaps ?? []),
    ];
    const hasCompleteOracle = hasDriver && hasOracle && covered.length === 2 && new Set(covered).size === 2 && gaps.length === 0;
    return { scenarioId: scenario.id, featureId: scenario.featureId, dimension: scenario.dimension,
      status: !hasDriver ? "not-implemented" : hasCompleteOracle ? "ready" : "partial",
      hasDriver, hasCompleteOracle, gaps, expectedOutcome: registration?.outcome ?? "unverified",
      requiredSurface: scenario.surface, prerequisite: feature.prerequisite, mapping: feature.mapping,
      reason: hasCompleteOracle ? "Execution and both behavior predicates have evaluators. Offline proof and live runtime behavior are separate gates."
        : "A harness gap; not a product failure, environment block, unsupported verdict or completed test." };
  });
  const counts = Object.fromEntries(["ready", "partial", "not-implemented"].map((status) => [status, rows.filter((row) => row.status === status).length]));
  return { kind: "offline-execution-preparation", catalogId: NATIVE_CATALOG.id, catalogHash: catalogFingerprint(), modelCalls: 0,
    models: [...models], selectedScenarioIds: rows.map(({ scenarioId }) => scenarioId), scenarios: rows, counts,
    totalCatalogFeatures: NATIVE_FEATURES.length, totalCatalogScenarios: NATIVE_SCENARIOS.length,
    selectedScenarios: rows.length, selectedModelCaseSlots: models.length * rows.length,
    fullMatrixSlots: NATIVE_MODELS.length * NATIVE_SCENARIOS.length,
    readyToExecute: rows.every(({ status }) => status === "ready"),
    scopeExclusions: NATIVE_CATALOG.scopeExclusions, verificationController: NATIVE_CATALOG.verificationController };
}

export function requireCompleteHarness(plan) {
  const current = runnerPlan({ models: plan.models, selected: plan.selectedScenarioIds });
  assert.deepEqual(plan.scenarios, current.scenarios, "Readiness rows must match the current driver registry.");
  assert.deepEqual(plan.counts, current.counts, "Readiness counts cannot be supplied by the caller.");
  assert.equal(plan.catalogId, NATIVE_CATALOG.id);
  assert.equal(plan.catalogHash, catalogFingerprint(), "Catalog changed since preparation.");
  assert.equal(plan.totalCatalogScenarios, NATIVE_SCENARIOS.length);
  assert.equal(plan.totalCatalogFeatures, NATIVE_FEATURES.length);
  assert.deepEqual([...plan.models].sort(), [...NATIVE_MODELS].sort(), "Live verification requires all seven pinned models; subsets do not bypass the gate.");
  assert.deepEqual([...plan.selectedScenarioIds].sort(), NATIVE_SCENARIOS.map(({ id }) => id).sort(), "Live verification requires every catalog scenario.");
  assert.equal(plan.selectedScenarios, NATIVE_SCENARIOS.length);
  assert.equal(plan.selectedModelCaseSlots, NATIVE_SCENARIOS.length * NATIVE_MODELS.length);
  assert.equal(plan.fullMatrixSlots, NATIVE_SCENARIOS.length * NATIVE_MODELS.length);
  assert.deepEqual(plan.scenarios.map(({ scenarioId }) => scenarioId).sort(), NATIVE_SCENARIOS.map(({ id }) => id).sort());
  assert.ok(plan.readyToExecute && plan.scenarios.every((row) => row.status === "ready" && row.hasDriver && row.hasCompleteOracle && row.gaps.length === 0),
    `Native harness incomplete: ${plan.counts.ready} ready, ${plan.counts.partial} partial, ${plan.counts["not-implemented"]} not implemented. No model call was started.`);
  assert.deepEqual(plan.counts, { ready: NATIVE_SCENARIOS.length, partial: 0, "not-implemented": 0 });
}

// A selected diagnostic run is explicit and never changes the full acceptance
// denominator. Missing or partial drivers cannot be selected for execution.
export function requirePreparedSelection(plan) {
  const current = runnerPlan({ models: plan.models, selected: plan.selectedScenarioIds });
  assert.equal(plan.catalogHash, current.catalogHash, "Scenario catalog changed since preparation.");
  assert.deepEqual(plan, current, "Readiness must be derived from the current driver registry.");
  assert.ok(current.readyToExecute, `Selected native harness is incomplete: ${current.counts.ready} ready, ${current.counts.partial} partial, ${current.counts["not-implemented"]} not implemented.`);
}
