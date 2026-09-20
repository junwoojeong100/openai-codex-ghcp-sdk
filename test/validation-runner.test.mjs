import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArgs } from "../scripts/validate.mjs";
import { MODELS, SCENARIOS } from "../scripts/validation/catalog.mjs";
import { prepareValidation, runValidation, verifyReport } from "../scripts/validation/runner.mjs";
import { ValidationFixture } from "../scripts/validation/fixture.mjs";
import { ValidationSdk } from "./helpers/validation-sdk.mjs";
const model = "gpt-6-astra";
function output(t) { const parent = fs.mkdtempSync(path.join(os.tmpdir(), "protocol-runner-test-")); t.after(() => fs.rmSync(parent, { recursive: true, force: true })); return path.join(parent, "run"); }
const fixtureFactory = (options) => new ValidationFixture({ ...options, clientFactory: () => new ValidationSdk() });
test("auxiliary HTTP protocol preparation stays separate from the native 207-scenario catalog", () => {
  const plan = prepareValidation();
  assert.equal(plan.modelCalls, 0); assert.equal(plan.completeMatrixSlots, 168);
  assert.equal(SCENARIOS.length, 24); assert.equal(MODELS.length, 7);
  assert.equal(plan.readyToExecute, true);
  assert.ok(plan.scopeExclusions.some((item) => item.includes("MCP")));
});
test("auxiliary CLI fails closed for ambiguous options and implicit live model selection", () => {
  assert.equal(parseArgs([]).mode, "prepare");
  for (const args of [["--execute"], ["--models", "unknown"], ["--timeout-ms", "0"], ["--suite", "unknown"],
    ["--suite", "smoke", "--scenarios", "gateway.normal"], ["--verify", "report.json", "--models", model], ["--execute", "--prepare"]]) {
    assert.throws(() => parseArgs(args));
  }
});
test("all 21 auxiliary protocol scenarios run against a real loopback bridge and fake SDK, with no live credit", async (t) => {
  const { report, directory } = await runValidation({ output: output(t), models: [model], suite: "protocol", timeoutMs: 3000 }, { fixtureFactory });
  const failures = report.cases.filter(({ selected, status }) => selected && status !== "passed");
  assert.deepEqual(failures.map(({ scenarioId, error }) => ({ scenarioId, error })), []);
  assert.equal(report.executionKind, "offline-self-test");
  assert.equal(report.summary.counts.passed, 21); assert.equal(report.summary.fullMatrixPassed, false);
  assert.equal(verifyReport(path.join(directory, "report.json"), { allowOffline: true }).evidenceIntegrity, true);
  assert.throws(() => verifyReport(path.join(directory, "report.json")), /Offline evidence/);
});
test("nonconfigurable reasoning models are diagnosed rather than credited with invented effort changes", async (t) => {
  const { report, directory } = await runValidation({ output: output(t), models: ["claude-haiku-4.5"], scenarios: ["reasoning.normal", "reasoning.lifecycle"], timeoutMs: 3000 }, { fixtureFactory });
  assert.equal(report.summary.counts.passed, 2, JSON.stringify(report.cases.filter(({ selected }) => selected)));
  verifyReport(path.join(directory, "report.json"), { allowOffline: true });
});
test("unavailable model preparation preserves blocked evidence and cleans up the owned SDK client", async (t) => {
  const { report, directory } = await runValidation({ output: output(t), models: [model], scenarios: ["gateway.normal"], timeoutMs: 3000 }, {
    fixtureFactory: (options) => new ValidationFixture({ ...options, clientFactory: () => new ValidationSdk({ models: [] }) }),
  });
  assert.equal(report.summary.counts.blocked, 1);
  verifyReport(path.join(directory, "report.json"), { allowOffline: true });
});
