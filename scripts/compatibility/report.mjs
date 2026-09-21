import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { NATIVE_SCENARIO_CATALOG as C, NATIVE_SCENARIOS, NATIVE_MODELS, TOTAL_CASES, catalogFingerprint } from "./catalog.mjs";
import { evaluate, diagnosticMetrics } from "./oracles.mjs";
import { artifactContents } from "./artifacts.mjs";
import { sha, safeRead, implementationHash } from "./util.mjs";

import { checklistSummary, featureVerdicts } from "./capabilities.mjs";

export function newReport({ runId, executionKind = "live" }) {
  return { schemaVersion: C.schemaVersion, catalogId: C.id, catalogHash: catalogFingerprint(), implementationHash: implementationHash(),
    runId, executionKind, models: [...NATIVE_MODELS], scope: C.acceptance.scope,
    startedAt: new Date().toISOString(), finishedAt: null,
    cases: NATIVE_MODELS.flatMap(model => NATIVE_SCENARIOS.map(s => ({ scenarioId: s.id, provider: "ghcp", model, status: "not-run" }))) };
}
export function summarize(report) {
  const matrixValid = Array.isArray(report.cases) && report.cases.length === TOTAL_CASES &&
    NATIVE_MODELS.every(model => NATIVE_SCENARIOS.every(s => report.cases.filter(r => r.model === model && r.scenarioId === s.id && r.provider === "ghcp").length === 1));
  const eligible = matrixValid && report.executionKind === "live" && report.finishedAt && report.implementationUnchanged === true &&
    !report.interrupted && !report.error && report.userSettingsUnchanged === true;
  const perModel = NATIVE_MODELS.map(model => {
    const rows = report.cases.filter(r => r.model === model), passed = rows.filter(r => r.status === "passed").length;
    return { model, passed, total: NATIVE_SCENARIOS.length, percent: passed / NATIVE_SCENARIOS.length * 100,
      outcome: eligible && passed === NATIVE_SCENARIOS.length ? `${C.id}-compatible` : "not-established",
      counts: Object.fromEntries(C.acceptance.statuses.map(status => [status, rows.filter(r => r.status === status).length])) };
  });
  return { totalCases: TOTAL_CASES, passed: perModel.reduce((n, m) => n + m.passed, 0),
    fullMatrixPassed: Boolean(eligible && perModel.every(r => r.passed === NATIVE_SCENARIOS.length)), perModel,
    coverageTargetPercent: C.coverage.targetPercent, measuredCoveragePercent: null,
    designChecklist: checklistSummary(C.coverage.checklist), featureVerdicts: featureVerdicts(report, C.coverage.checklist, NATIVE_MODELS, matrixValid),
    wholeProductCoverageClaim: false, nativeProviderParityMeasured: false, scope: C.acceptance.scope };
}
export function readCase(directory, row, runId, expectedCatalogHash = catalogFingerprint(), executionKind = "live") {
  const manifest = JSON.parse(safeRead(path.join(directory, "result.json"), 1024 * 1024));
  assert.equal(manifest.runId, runId);
  assert.equal(manifest.catalogHash, expectedCatalogHash);
  for (const field of ["scenarioId", "model", "provider"]) assert.equal(manifest[field], row[field]);
  assert.equal(manifest.executionKind, executionKind);
  const scenario = NATIVE_SCENARIOS.find(s => s.id === row.scenarioId);
  assert.ok(scenario);
  assert.ok(C.acceptance.statuses.includes(manifest.status));
  assert.ok(Number.isSafeInteger(manifest.durationMs) && manifest.durationMs >= 0 && manifest.durationMs <= scenario.timeoutSeconds * 1000);
  const required = ["observation.json", "case.json", ...C.commonEvidence, "sdk.jsonl", ...scenario.assertions.map(a => a.evidence)];
  for (const name of new Set(required)) assert.ok(manifest.files[name], `Missing ${name}`);
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.match(name, /^[A-Za-z0-9_.-]+$/); assert.ok(!name.startsWith("."));
    const bytes = safeRead(path.join(directory, name));
    assert.equal(bytes.length, expected.bytes); assert.equal(sha(bytes), expected.sha256, `Changed artifact: ${name}`);
  }
  const evidence = JSON.parse(safeRead(path.join(directory, "observation.json")));
  assert.equal(evidence.provider, row.provider); assert.equal(evidence.model, row.model); assert.equal(evidence.scenarioId, row.scenarioId);
  const checks = evaluate(scenario, evidence);
  assert.deepEqual(manifest.metrics, diagnosticMetrics(scenario, evidence), "Metrics must be independently recalculated");
  if (scenario.id === "C11" && manifest.status === "passed") assert.equal(evidence.launcher?.executionKind, executionKind, "Offline launcher cannot certify live behavior");
  assert.deepEqual(manifest.checks, checks, "Checks must be independently recalculated");
  for (const [name, expected] of Object.entries(artifactContents(manifest, scenario, evidence, checks, manifest.status)))
    assert.equal(safeRead(path.join(directory, name)).toString("utf8"), expected, `Inconsistent evidence projection: ${name}`);
  if (manifest.status === "passed") assert.ok(checks.every(c => c.passed) && !manifest.error);
  return { manifest, evidence };
}
export function verifyReport(file) {
  const root = path.dirname(path.resolve(file));
  const report = JSON.parse(safeRead(path.resolve(file), 4 * 1024 * 1024));
  assert.equal(report.schemaVersion, C.schemaVersion, "Historical report: verify with its original runner revision; never regrade old evidence under a new contract");
  assert.equal(report.catalogId, C.id);
  assert.equal(report.catalogHash, catalogFingerprint(), "Scenario contract changed");
  assert.equal(report.implementationHash, implementationHash(), "Implementation changed since this run");
  assert.deepEqual(report.models, NATIVE_MODELS);
  assert.equal(Object.hasOwn(report, "baseline"), false);
  assert.deepEqual(report.cases.map(r => `${r.model}/${r.scenarioId}`), NATIVE_MODELS.flatMap(m => NATIVE_SCENARIOS.map(s => `${m}/${s.id}`)));
  assert.ok(["live", "offline-self-test"].includes(report.executionKind));
  assert.ok(report.finishedAt && Number.isFinite(Date.parse(report.finishedAt)));
  assert.ok(Number.isSafeInteger(report.durationMs) && report.durationMs >= 0);
  for (const row of report.cases) {
    assert.equal(row.provider, "ghcp"); assert.ok(C.acceptance.statuses.includes(row.status));
    if (!row.artifactPath) { assert.notEqual(row.status, "passed", "Passed case has no evidence"); continue; }
    const expectedPath = `cases/${row.model}/${row.scenarioId}`;
    assert.equal(row.artifactPath, expectedPath, "Evidence belongs to another matrix cell");
    const full = path.join(root, expectedPath);
    for (let p = full; p !== root; p = path.dirname(p)) assert.ok(!fs.lstatSync(p).isSymbolicLink(), "Symlink evidence directory");
    const { manifest } = readCase(full, row, report.runId, report.catalogHash, report.executionKind);
    assert.equal(row.resultHash, sha(safeRead(path.join(full, "result.json"))));
    assert.equal(row.observedStatus, manifest.status);
    assert.deepEqual(row.metrics, manifest.metrics, "Report metrics differ from verified case evidence");
    assert.deepEqual(row.failedChecks, manifest.checks.filter(c => !c.passed).map(c => c.id),
      "Report failed checks differ from verified case evidence");
    if (row.status === "passed") {
      assert.equal(row.observedStatus, "passed"); assert.equal(row.processGroupGone, true, "No supervisor cleanup receipt");
      assert.equal(row.supervisor?.code, 0); assert.equal(row.supervisor?.killed, false);
      assert.ok(!row.supervisor?.error);
    }
  }
  const summary = summarize(report);
  assert.deepEqual(report.summary, summary, "Saved score differs from recomputed score");
  return { evidenceIntegrity: true, ...summary };
}
export function markdownReport(report) {
  const summary = summarize(report);
  return [`# ${C.id} compatibility`, "", `Run: ${report.runId} · ${report.executionKind}`, "",
    `Passed: ${summary.passed}/${TOTAL_CASES}. Coverage target: 90% of everyday workflows; measured product coverage: **unknown**.`, "",
    `| Model | Passed / ${NATIVE_SCENARIOS.length} | Result |`, "|---|---:|---|",
    ...summary.perModel.map(r => `| ${r.model} | ${r.passed}/${NATIVE_SCENARIOS.length} | ${r.outcome} |`), "",
    `Reviewer checklist design score: ${summary.designChecklist.designPercent}%. This is not measured product coverage or a live support rate.`, "",
    "| Capability | Scope | Evidence scenarios | Models with passing linked cases |", "|---|---|---|---:|",
    ...summary.featureVerdicts.map(f => `| ${f.id} | ${f.level} | ${f.scenarios.join(", ") || "none"} | ${f.perModel.filter(m => m.outcome === "scenario-evidence-passed").length}/${NATIVE_MODELS.length} |`), "",
    "Timeouts, unavailable models, skipped cases and unsupported behavior remain in the denominator.", "",
    "| Provider/model | Case | Status | Detail |", "|---|---|---|---|",
    ...report.cases.map(r => `| ${r.provider}/${r.model} | ${r.scenarioId} | ${r.status} | ${(r.error || r.reason || "").replace(/[|\r\n]/g, " ")} |`), "",
  ].join("\n");
}
