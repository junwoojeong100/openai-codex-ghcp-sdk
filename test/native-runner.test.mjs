import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runNativeValidation } from "../scripts/native/runner.mjs";
import { verifyNativeReport } from "../scripts/native/report.mjs";
import { PrerequisiteError } from "../scripts/validation/fixture.mjs";
import { OfflineNativeFixture } from "./helpers/native-fixture.mjs";

const model = "gpt-6-astra";
const scenario = "model-routing.normal";
function output(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "native-runner-test-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return path.join(parent, "new-run");
}
async function execute(t, fixtureOptions, options = {}) {
  return runNativeValidation({ output: output(t), models: [model], selected: [scenario], scope: "selected", timeoutMs: 3000, ...options }, {
    fixtureFactory: (settings) => new OfflineNativeFixture(settings, fixtureOptions),
  });
}
test("native runner executes the actual registered driver and re-verifies every retained assertion offline", async (t) => {
  const { report, directory } = await execute(t);
  assert.equal(report.executionKind, "offline-self-test");
  assert.equal(report.cases.length, 1449);
  assert.equal(report.summary.selectedScopePassed, true);
  assert.equal(report.summary.fullMatrixPassed, false);
  assert.equal(report.summary.liveCompatibilityCredit, false);
  assert.equal(report.summary.counts.passed, 1); assert.equal(report.summary.counts["not-run"], 1448);
  const filename = path.join(directory, "results.json");
  assert.throws(() => verifyNativeReport(filename), /Offline evidence/);
  assert.equal(verifyNativeReport(filename, { allowOffline: true }).evidenceIntegrity, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "progress.json"))), report);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "coverage.json"))), report.summary);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
});
for (const [name, fixtureOptions, status] of [
  ["a fabricated answer", { wrongAnswer: true }, "failed"],
  ["wrong SDK model attribution", { wrongModel: true }, "failed"],
  ["a prerequisite failure", { startError: new PrerequisiteError("missing fixture runtime", "runtime") }, "blocked"],
  ["a cleanup failure", { cleanupError: true }, "failed"],
]) test(`native runner does not credit ${name}`, async (t) => {
  const { report, directory } = await execute(t, fixtureOptions);
  const row = report.cases.find((record) => record.model === model && record.scenarioId === scenario);
  assert.equal(row.status, status);
  assert.equal(report.summary.selectedScopePassed, false);
  assert.equal(verifyNativeReport(path.join(directory, "results.json"), { allowOffline: true }).evidenceIntegrity, true);
});
test("full acceptance and missing-driver gates run before any fixture or output directory exists", async (t) => {
  const target = output(t);
  let created = 0;
  await assert.rejects(runNativeValidation({ output: target }, { fixtureFactory: () => { created += 1; throw new Error("must not start"); } }), /incomplete/);
  assert.equal(created, 0); assert.equal(fs.existsSync(target), false);
  await assert.rejects(runNativeValidation({ output: target, models: [model], selected: ["goals.normal"], scope: "selected" }, {
    fixtureFactory: () => { created += 1; },
  }), /incomplete/);
  assert.equal(created, 0);
});
test("live native calls require a preparation proof before starting any process", async (t) => {
  const target = output(t);
  await assert.rejects(runNativeValidation({ output: target, models: [model], selected: [scenario], scope: "selected", env: {} }), /preparation report/);
  assert.equal(fs.existsSync(target), false);
  await assert.rejects(runNativeValidation({ output: target, models: [model], selected: [scenario], scope: "selected", env: { GHCP_HARNESS_OFFLINE: "1" } }), /disabled during offline/);
});
test("native case timeout cancels the driver, closes its fixture and preserves failure evidence", async (t) => {
  const { report, directory } = await execute(t, { hang: true }, { timeoutMs: 50 });
  const row = report.cases.find((record) => record.model === model && record.scenarioId === scenario);
  assert.equal(row.status, "failed");
  assert.match(row.attempts[0].error.message, /exceeded|deadline/);
  assert.equal(row.attempts[0].checks.cleanup.passed, true);
  assert.equal(verifyNativeReport(path.join(directory, "results.json"), { allowOffline: true }).evidenceIntegrity, true);
});
test("native interruption preserves the interrupted attempt and never executes pending slots", async (t) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("fixture SIGINT")), 50);
  t.after(() => clearTimeout(timer));
  const { report, directory } = await execute(t, { hang: true }, { signal: controller.signal, models: [model, "gpt-5.6-sol"] });
  assert.equal(report.interrupted, true);
  assert.equal(report.summary.counts.interrupted, 1);
  assert.equal(report.summary.counts["not-run"], 1448);
  assert.equal(report.summary.selectedScopePassed, false);
  verifyNativeReport(path.join(directory, "results.json"), { allowOffline: true });
});
test("a pre-aborted native run has a full not-run matrix and no fixture execution", async (t) => {
  const controller = new AbortController(); controller.abort();
  let started = 0;
  const { report } = await runNativeValidation({ output: output(t), models: [model], selected: [scenario], scope: "selected", signal: controller.signal }, {
    fixtureFactory: () => { started += 1; },
  });
  assert.equal(started, 0); assert.equal(report.summary.counts["not-run"], 1449);
  assert.equal(report.summary.selectedScopePassed, false);
});
test("native result directories cannot be overwritten and argument bounds are enforced", async (t) => {
  const { directory } = await execute(t);
  await assert.rejects(execute(t, {}, { output: directory }), /EEXIST/);
  for (const options of [{ concurrency: 0 }, { concurrency: 4 }, { timeoutMs: 0 }, { timeoutMs: 900001 }]) {
    await assert.rejects(execute(t, {}, options), /must be/);
  }
});
test("progress callback failure drains owned work, retains results, and prevents success", async (t) => {
  const { report, directory } = await runNativeValidation({ output: output(t), models: [model], selected: [scenario], scope: "selected" }, {
    fixtureFactory: (settings) => new OfflineNativeFixture(settings), onProgress: () => { throw new Error("progress consumer failed"); },
  });
  assert.match(report.runnerError.message, /progress consumer/);
  assert.equal(report.summary.selectedScopePassed, false);
  verifyNativeReport(path.join(directory, "results.json"), { allowOffline: true });
});
