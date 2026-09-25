import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CATALOG as C, SCENARIOS, catalogHash } from "./catalog.mjs";
import { implementationHash, verifyFrozenSources } from "./source.mjs";
import { evaluate, recoveredTransportErrors } from "./scenarios.mjs";
import { isExpectedTitleRejection } from "./session.mjs";
import { reportHeader, caseSections } from "./report-format.mjs";
import { safeRead, sha } from "./util.mjs";

export const matrix = () => C.models.flatMap(model => SCENARIOS.map(scenario => ({ model, scenarioId: scenario.id, status: "not-run" })));
const statuses = new Set(["passed", "failed", "blocked", "timed-out", "not-run"]);
const identities = rows => rows.map(row => `${row.model}/${row.scenarioId}`);

export function summarize(report) {
  const rows = report.cases ?? [];
  const complete = JSON.stringify(identities(rows)) === JSON.stringify(identities(matrix()));
  const eligible = report.executionKind === "live" && complete && Boolean(report.finishedAt)
    && report.implementationUnchanged === true && report.frozenSourceUnchanged === true && report.userSettingsUnchanged === true
    && !report.interrupted && !report.error && rows.every(row => statuses.has(row.status) && row.status !== "not-run");
  const passed = rows.filter(row => row.status === "passed").length;
  return { totalCases: C.totalCases, passed, fullMatrixPassed: eligible && passed === C.totalCases,
    counts: Object.fromEntries([...statuses].map(status => [status, rows.filter(row => row.status === status).length])),
    perModel: C.models.map(model => ({ model, passed: rows.filter(row => row.model === model && row.status === "passed").length, total: SCENARIOS.length })),
    auxiliaryTitleRejections: rows.reduce((sum, row) => sum + (row.auxiliaryTitleRejections ?? 0), 0),
    recoveredTransportErrors: rows.reduce((sum, row) => sum + (row.recoveredTransportErrors ?? 0), 0),
    catalogRecoveries: rows.reduce((sum, row) => sum + (row.catalogRecoveries ?? 0), 0),
    hoursLongSoakCertified: false };
}

export function markdown(report) {
  const summary = summarize(report);
  const result = !report.finishedAt ? "IN PROGRESS" : summary.fullMatrixPassed ? "PASS" : "NOT PASSED";
  return [...reportHeader(report, { result, passed: summary.passed, totalCases: C.totalCases,
    passRule: `All ${C.totalCases}/${C.totalCases} cases and run-level checks must pass. There is no percentage target or alternative profile.` }),
    "## Per-model results", "", "| Model | Passed |", "|---|---:|",
    ...summary.perModel.map(row => `| ${row.model} | ${row.passed}/${row.total} |`), "",
    `Recorded bridge recoveries: ${summary.recoveredTransportErrors} transport errors, ${summary.catalogRecoveries} startup catalogs. These are not case reruns.`, "",
    ...caseSections(report.cases),
    "Scope: essential local text/tool use through the real launcher, private PTY and browser. Not full-product or endurance certification.", ""].join("\n");
}

export function verifyReport(file) {
  file = path.resolve(file);
  const directory = path.dirname(file), report = JSON.parse(safeRead(file));
  assert.equal(report.schemaVersion, C.schemaVersion, "Use the matching saved verifier for historical reports");
  assert.equal(report.catalogId, C.id, "Historical or foreign verification contract");
  assert.equal(report.catalogHash, catalogHash(), "Verification contract changed");
  assert.equal(report.executionKind, "live", "SDK doubles cannot establish a live result");
  assert.equal(report.implementationHash, implementationHash(), "Source changed: use this run's source-snapshot/scripts/verify.mjs");
  const frozen = JSON.parse(safeRead(path.join(directory, "freeze.json")));
  assert.equal(frozen.runId, report.runId);
  assert.equal(frozen.catalogHash, report.catalogHash);
  assert.deepEqual(frozen.catalog, C);
  assert.equal(sha(JSON.stringify(frozen.sources)), report.implementationHash);
  assert.ok(verifyFrozenSources(directory, frozen.sources), "Frozen source integrity mismatch");
  assert.deepEqual(identities(report.cases), identities(matrix()), "Incomplete or duplicate matrix");
  for (const row of report.cases) {
    assert.ok(statuses.has(row.status), "Unknown case status");
    if (!row.artifactPath) {
      assert.notEqual(row.status, "passed", "Passing case has no evidence");
      continue;
    }
    assert.equal(row.artifactPath, `cases/${row.model}/${row.scenarioId}`, "Invalid case artifact path");
    const dir = path.join(directory, row.artifactPath);
    for (let parent = dir; parent !== directory; parent = path.dirname(parent)) {
      assert.ok(!fs.lstatSync(parent).isSymbolicLink(), "Symlink evidence directory");
    }
    if (row.supervisor) assert.deepEqual(JSON.parse(safeRead(path.join(dir, "supervisor.json"))), row.supervisor);
    const resultFile = path.join(dir, "result.json");
    if (!fs.existsSync(resultFile)) {
      assert.ok(row.status !== "passed" && !row.resultHash, "Recorded case result is missing");
      continue;
    }
    const bytes = safeRead(resultFile), result = JSON.parse(bytes), factsBytes = safeRead(path.join(dir, "facts.json"));
    assert.equal(sha(bytes), row.resultHash, "Result hash mismatch");
    assert.equal(sha(factsBytes), result.factsHash, "Facts hash mismatch");
    for (const key of ["runId", "catalogHash", "implementationHash", "executionKind"]) assert.equal(result[key], report[key], key);
    for (const key of ["model", "scenarioId", "seed"]) assert.equal(result[key], row[key], key);
    const facts = JSON.parse(factsBytes), scenario = SCENARIOS.find(item => item.id === row.scenarioId);
    assert.equal(facts.seed, row.seed);
    assert.equal(facts.launchModel, row.scenarioId === "V04" ? (row.model === "gpt-6-astra" ? "gpt-6-luna" : "gpt-6-astra") : row.model);
    const checks = evaluate(scenario, row.model, facts), failedChecks = checks.filter(check => !check.passed).map(check => check.id);
    assert.deepEqual(result.checks, checks, "Recomputed checks differ");
    assert.deepEqual(row.failedChecks, failedChecks, "Report hides or invents failed checks");
    assert.equal(result.status, failedChecks.length ? "failed" : "passed");
    assert.equal(row.observedStatus, result.status);
    assert.deepEqual(row.error, result.error);
    const titles = facts.observer.http.filter(isExpectedTitleRejection).length;
    assert.equal(result.auxiliaryTitleRejections, titles);
    assert.equal(row.auxiliaryTitleRejections, titles);
    for (const [key, count] of Object.entries({ recoveredTransportErrors: recoveredTransportErrors(facts),
      catalogRecoveries: facts.observer.diagnostics.filter(event => event.event === "bridge.upstream_catalog_recovered").length })) {
      assert.equal(result[key], count);
      assert.equal(row[key], count);
    }
    for (const launch of facts.evidence?.launches ?? []) {
      if (!launch.media) continue;
      assert.match(launch.label, /^launch-\d+$/);
      const mediaDir = path.join(dir, launch.label);
      assert.ok(!fs.lstatSync(mediaDir).isSymbolicLink(), "Symlink media directory");
      const artifacts = [launch.media.screenshot, launch.media.video, ...(launch.screenshots ?? [])];
      for (const artifact of artifacts) {
        assert.match(artifact.file, /^(?:terminal-browser\.(?:png|webm)|checkpoint-\d+\.png)$/);
        const bytes = safeRead(path.join(mediaDir, artifact.file), 256 * 1024 * 1024);
        assert.equal(bytes.length, artifact.bytes, "Media size mismatch");
        assert.equal(sha(bytes), artifact.sha256, "Media hash mismatch");
        if (artifact.textFile) {
          assert.equal(artifact.textFile, artifact.file.replace(/\.png$/, ".txt"));
          assert.equal(sha(safeRead(path.join(mediaDir, artifact.textFile))), artifact.textHash, "Media transcript hash mismatch");
        }
      }
    }
    if (row.status === "passed") {
      assert.equal(result.status, "passed");
      assert.equal(row.supervisor?.code, 0);
      assert.equal(row.supervisor?.processGroupGone, true);
      assert.equal(row.supervisor?.killed, false);
      assert.ok(!row.supervisor?.error && !row.cleanupError);
    }
  }
  const summary = summarize(report);
  assert.deepEqual(report.summary, summary, "Saved verdict differs from recomputed result");
  return { evidenceIntegrity: true, catalogId: C.id, ...summary };
}
