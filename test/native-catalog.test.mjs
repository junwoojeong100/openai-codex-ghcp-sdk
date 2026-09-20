import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_CATALOG, NATIVE_FEATURES, NATIVE_SCENARIOS, NATIVE_MODELS, EVIDENCE_NAMES, REQUIRED_ROUTE } from "../scripts/native/catalog.mjs";
import { assessScenarioDesign, runnerPlan, requireCompleteHarness, requirePreparedSelection } from "../scripts/native/plan.mjs";
import { NATIVE_DRIVERS, driverFor } from "../scripts/native/registry.mjs";
import { parseRunnerArguments } from "../scripts/e2e-native-v2.mjs";

const model = "gpt-6-astra";
test("native catalog preserves the sibling's 69 feature / 207 scenario / seven model crosswalk", () => {
  const design = assessScenarioDesign();
  assert.equal(design.complete, true);
  assert.equal(design.features, 69); assert.equal(design.scenarios, 207); assert.equal(design.modelCaseSlots, 1449);
  assert.equal(NATIVE_CATALOG.sourceSnapshot.sibling.features, 69);
  assert.equal(new Set(NATIVE_MODELS).size, 7);
  for (const feature of NATIVE_FEATURES) {
    assert.equal(feature.siblingId, feature.id);
    assert.deepEqual(feature.scenarios.map(({ dimension }) => dimension), ["normal", "failure", "lifecycle"]);
    for (const scenario of feature.scenarios) {
      assert.equal(scenario.route, REQUIRED_ROUTE);
      assert.deepEqual(scenario.evidence, EVIDENCE_NAMES);
      assert.equal(scenario.assertions.length, 5);
    }
  }
});
test("catalog design, driver readiness and actual compatibility are separate gates", () => {
  const plan = runnerPlan();
  assert.equal(plan.modelCalls, 0);
  assert.equal(plan.fullMatrixSlots, 1449);
  assert.equal(plan.counts.ready + plan.counts.partial + plan.counts["not-implemented"], 207);
  assert.ok(plan.counts.ready > 21, "Additional native executors must be registered, not only documented.");
  assert.ok(plan.counts["not-implemented"] > 0);
  assert.equal(plan.readyToExecute, false);
  assert.throws(() => requireCompleteHarness(plan), /incomplete/);
});
test("every registered native evaluator rejects empty evidence instead of blessing a driver flag", () => {
  for (const [id, entry] of Object.entries(NATIVE_DRIVERS)) {
    assert.ok(NATIVE_SCENARIOS.some((scenario) => scenario.id === id));
    assert.equal(typeof entry.execute, "function");
    assert.equal(typeof entry.evaluate, "function");
    assert.throws(() => entry.evaluate({}, {}), undefined, id);
  }
});
test("selection is exact; partial and missing scenarios cannot be executed as ready", () => {
  const selected = runnerPlan({ models: [model], selected: ["file-read.normal"] });
  requirePreparedSelection(selected);
  assert.throws(() => requireCompleteHarness(selected), /seven pinned models|every catalog scenario/);
  for (const selectedIds of [["terminal-interaction.normal"], ["goals.normal"]]) {
    assert.throws(() => requirePreparedSelection(runnerPlan({ models: [model], selected: selectedIds })), /incomplete/);
  }
  for (const selectedIds of [[], ["bad.normal"], ["file-read.normal", "file-read.normal"]]) {
    assert.throws(() => runnerPlan({ selected: selectedIds }));
  }
});
test("forged readiness cannot bypass the full or selected gate", () => {
  const plan = structuredClone(runnerPlan());
  plan.readyToExecute = true;
  plan.counts = { ready: 207, partial: 0, "not-implemented": 0 };
  for (const row of plan.scenarios) Object.assign(row, { status: "ready", hasDriver: true, hasCompleteOracle: true, gaps: [] });
  assert.throws(() => requireCompleteHarness(plan), /registry/);
  assert.throws(() => requirePreparedSelection(plan), /current driver registry/);
});
test("native CLI defaults to offline preparation and requires deliberate live selection", () => {
  assert.equal(parseRunnerArguments([]).mode, "prepare");
  assert.throws(() => parseRunnerArguments(["--execute"]), /explicit --models/);
  assert.throws(() => parseRunnerArguments(["--run-selected", "--models", model]), /exact/);
  const options = parseRunnerArguments(["--run-selected", "--models", model, "--feature", "file-read"]);
  assert.equal(options.scope, "selected");
  assert.deepEqual(options.selected, ["file-read.normal", "file-read.failure", "file-read.lifecycle"]);
  assert.equal(parseRunnerArguments(["--execute", "--models", "all"]).models.length, 7);
  assert.equal(parseRunnerArguments(["--execute", "--help"]).help, true);
});
test("native arguments reject ambiguous modes, duplicate IDs, probe bypasses and invalid budgets", () => {
  for (const args of [
    ["--prepare", "--execute"], ["--models", model, "--models", model], ["--models", "unknown"],
    ["--scenarios", "file-read.normal,file-read.normal"], ["--feature", "absent"],
    ["--feature", "file-read", "--scenarios", "file-read.normal"], ["--allow-probes"],
    ["--timeout-ms", "0"], ["--timeout-ms", "900001"], ["--timeout-ms", "2.5"],
    ["--concurrency", "4"], ["--output"], ["--verify", "results.json", "--models", model],
  ]) assert.throws(() => parseRunnerArguments(args), undefined, args.join(" "));
});
test("sibling-style environment selection remains explicit and full scenario IDs stay native", () => {
  const options = parseRunnerArguments(["--run-selected"], { GHCP_E2E_MODELS: model, GHCP_E2E_SCENARIOS: "model-routing.normal", GHCP_E2E_CONCURRENCY: "2" });
  assert.equal(options.concurrency, 2);
  assert.deepEqual(options.selected, ["model-routing.normal"]);
  assert.equal(driverFor("model-routing.normal").outcome, "supported");
  assert.equal(driverFor("structured-output.normal").outcome, "unsupported");
});
