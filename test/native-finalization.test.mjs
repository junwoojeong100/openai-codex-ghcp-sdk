import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { driverSelfTestSummary } from "../scripts/check-native-drivers.mjs";
import { createReport, assertMatrix, coverage, verifyNativeReport } from "../scripts/native/report.mjs";
import { runNativeValidation } from "../scripts/native/runner.mjs";
import { updateReadinessDocumentation, readinessTable } from "../scripts/native/documentation.mjs";
import { NATIVE_FEATURES } from "../scripts/native/catalog.mjs";
import { ROOT } from "../scripts/validation/evidence.mjs";
import { OfflineNativeFixture } from "./helpers/native-fixture.mjs";

const model = "gpt-6-astra";
const scenarioId = "model-routing.normal";
const assertionNames = ["primary", "secondary", "route", "isolation", "cleanup"];
function directory(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "native-finalization-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return path.join(parent, "run");
}
function summaryFixture({ status = "unsupported", id = "structured-output.normal", executionKind = "offline-self-test" } = {}) {
  // Structural unit fixture only; it is never used as actual execution evidence.
  const report = createReport({ executionKind });
  Object.assign(report, { executionScope: "selected", selectedModels: [model], selectedScenarioIds: [id],
    finishedAt: new Date().toISOString(), implementationUnchanged: true });
  const row = report.cases.find((entry) => entry.model === model && entry.scenarioId === id);
  row.status = status;
  row.attempts.push({ number: 1, status, checks: Object.fromEntries(assertionNames.map((name) => [name, { passed: true }])) });
  return report;
}
function checkedSummary(report) {
  return driverSelfTestSummary(report, { evidenceIntegrity: true, ...coverage(report) });
}

test("expected unsupported boundaries pass harness self-checks without changing compatibility results", () => {
  const report = summaryFixture();
  const before = structuredClone(report);
  const summary = checkedSummary(report);
  assert.equal(summary.harnessChecksPassed, true);
  assert.equal(summary.selectedCounts.unsupported, 1);
  assert.equal(summary.fullMatrixPassed, false);
  assert.equal(summary.liveCompatibilityCredit, false);
  assert.equal(coverage(report).selectedScopePassed, false);
  assert.ok(coverage(report).perModel.every(({ coveragePercent }) => coveragePercent === 0));
  assert.deepEqual(report, before);
});

test("self-check rejects incomplete evidence, unexpected outcomes, interruption and live reports", () => {
  for (const change of [
    (report) => { report.finishedAt = null; },
    (report) => { report.interrupted = true; },
    (report) => { report.runnerError = { message: "failed" }; },
    (report) => { report.implementationUnchanged = null; },
    (report) => { report.cases.find((row) => row.attempts.length).attempts[0].checks.cleanup.passed = false; },
  ]) {
    const report = summaryFixture(); change(report);
    assert.equal(checkedSummary(report).harnessChecksPassed, false);
  }
  assert.equal(checkedSummary(summaryFixture({ status: "passed" })).harnessChecksPassed, false);
  assert.equal(checkedSummary(summaryFixture({ id: "goals.normal", status: "partial" })).harnessChecksPassed, false);
  assert.throws(() => checkedSummary(summaryFixture({ executionKind: "live" })), /only offline/);
  assert.throws(() => driverSelfTestSummary(summaryFixture(), { executionKind: "offline-self-test", evidenceIntegrity: false }));
});

test("missing or relabelled report scope cannot masquerade as full acceptance", () => {
  for (const change of [
    (report) => { delete report.selectedModels; },
    (report) => { delete report.selectedScenarioIds; },
    (report) => { report.executionScope = "acceptance"; },
    (report) => { report.requiredRoute = "direct-http"; },
    (report) => { report.previousEvidenceImported = true; },
    (report) => { report.scopeExclusions = []; },
    (report) => { delete report.implementationUnchanged; },
    (report) => { report.interrupted = "false"; },
  ]) {
    const report = summaryFixture(); change(report);
    assert.throws(() => assertMatrix(report));
  }
});

test("unfinished, interrupted or stale live runs cannot receive live compatibility credit", () => {
  const report = summaryFixture({ id: scenarioId, status: "passed", executionKind: "live" });
  assert.equal(coverage(report).liveCompatibilityCredit, true);
  assert.equal(coverage(report).fullMatrixPassed, false);
  for (const change of [
    (r) => { r.finishedAt = null; }, (r) => { r.interrupted = true; },
    (r) => { r.implementationUnchanged = false; }, (r) => { r.implementationUnchanged = null; },
    (r) => { r.runnerError = { message: "checkpoint failed" }; },
  ]) {
    const altered = structuredClone(report); change(altered);
    assert.equal(coverage(altered).liveCompatibilityCredit, false);
    assert.equal(coverage(altered).selectedScopePassed, false);
    assert.ok(coverage(altered).perModel.every(({ coveragePercent }) => coveragePercent === 0));
  }
});

test("a late version preflight cannot start SDK resources after the native case was cancelled", async (t) => {
  let release;
  let starts = 0;
  let closed = 0;
  const preflight = new Promise((resolve) => { release = resolve; });
  const { report } = await runNativeValidation({ output: directory(t), scope: "selected", models: [model],
    selected: [scenarioId], timeoutMs: 30 }, {
    fixtureFactory: (settings) => {
      const fixture = new OfflineNativeFixture(settings);
      fixture.version = () => preflight;
      fixture.start = async () => { starts += 1; };
      const close = fixture.close.bind(fixture);
      fixture.close = async () => { closed += 1; await close(); };
      return fixture;
    },
  });
  release("codex-cli 0.154.0");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 0);
  assert.equal(closed, 1);
  assert.equal(report.summary.selectedCounts.failed, 1);
});

for (const method of ["state", "nativeEvidence"]) {
  test(`a ${method} capture failure preserves an attempted failed record instead of losing the case`, async (t) => {
    const { report, directory: root } = await runNativeValidation({ output: directory(t), scope: "selected", models: [model],
      selected: [scenarioId], timeoutMs: 3000 }, {
      fixtureFactory: (settings) => {
        const fixture = new OfflineNativeFixture(settings);
        fixture[method] = () => { throw new Error(`injected ${method} capture error`); };
        return fixture;
      },
    });
    const row = report.cases.find((entry) => entry.model === model && entry.scenarioId === scenarioId);
    assert.equal(row.status, "failed");
    assert.equal(row.attempts.length, 1);
    assert.match(row.attempts[0].error.message, /capture failed/);
    assert.equal(report.runnerError, undefined);
    assert.equal(verifyNativeReport(path.join(root, "results.json"), { allowOffline: true }).evidenceIntegrity, true);
  });
}

test("native documentation crosswalk is current, complete and linked to real files", () => {
  updateReadinessDocumentation({ check: true });
  for (const language of ["en", "ko"]) {
    const table = readinessTable(language);
    assert.equal(table.split("\n").filter((line) => /^\| `/.test(line)).length, NATIVE_FEATURES.length);
    for (const { id } of NATIVE_FEATURES) assert.ok(table.includes(`| \`${id}\` |`));
  }
  for (const relative of ["README.md", "README_KO.md", "docs/NATIVE_SCENARIOS.md", "docs/NATIVE_SCENARIOS_KO.md", "docs/EXHAUSTIVE_TESTING_KO.md"]) {
    const absolute = path.join(ROOT, relative);
    for (const match of fs.readFileSync(absolute, "utf8").matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(absolute), target)), `${relative} has a broken link: ${target}`);
    }
  }
});

test("npm commands distinguish native 207-scenario verification from auxiliary protocol testing", () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(scripts["test:scenarios"], "node scripts/native-coverage.mjs --design");
  assert.equal(scripts["test:e2e:native-v2"], "node scripts/e2e-native-v2.mjs");
  assert.equal(scripts["test:e2e:protocol"], "node scripts/validate.mjs");
  assert.equal(scripts["test:runner:drivers"], "node scripts/check-native-drivers.mjs");
});
