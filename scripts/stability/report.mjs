import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { CATALOG, SCENARIOS } from "./catalog.mjs";
import { getProfile, profileForRecord, DEFAULT_PROFILE } from "./profiles.mjs";
import { evaluate, failureCategory, metrics } from "./oracles.mjs";
import { ROOT, sha, safeRead } from "../compatibility/util.mjs";
import { reportHeader, caseSections } from "../compatibility/report-format.mjs";

export function sourceManifest(root = ROOT) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}/${item.name}`, absolute = path.join(dir, item.name);
      if (item.isDirectory()) walk(absolute, relative);
      else if (item.isFile() && (/\.(mjs|html|py)$/.test(item.name) || prefix === "bin")) files.push(relative);
    }
  };
  for (const dir of ["src", "scripts", "test", "bin"]) walk(path.join(root, dir), dir);
  files.push("package.json", "package-lock.json");
  return Object.fromEntries(files.sort().map(file => {
    const bytes = fs.readFileSync(path.join(root, file));
    return [file, { sha256: sha(bytes), bytes: bytes.length }];
  }));
}
export const implementationHash = () => sha(JSON.stringify(sourceManifest()));
export const matrix = (kind, profile = DEFAULT_PROFILE) => (kind === "live" ? getProfile(profile).catalog.models : ["gpt-6-astra"])
  .flatMap(model => SCENARIOS.map(scenario => ({ model, scenarioId: scenario.id, status: "not-run" })));
export function newReport({ runId, executionKind, profile = DEFAULT_PROFILE }) {
  assert.ok(["live", "offline-self-test"].includes(executionKind));
  const selected = getProfile(profile);
  return { schemaVersion: selected.catalog.schemaVersion, profile: selected.name, catalogId: selected.catalog.id,
    catalogHash: selected.catalogHash, implementationHash: implementationHash(),
    runId, executionKind, startedAt: new Date().toISOString(), finishedAt: null, cases: matrix(executionKind, selected.name) };
}
export function summarize(report) {
  const selected = profileForRecord(report);
  const expected = matrix(report.executionKind, selected.name), keys = rows => rows.map(r => `${r.model}/${r.scenarioId}`);
  const completeMatrix = same(keys(report.cases ?? []), keys(expected));
  const counts = Object.fromEntries(CATALOG.statuses.map(s => [s, (report.cases ?? []).filter(c => c.status === s).length]));
  const eligible = completeMatrix && (report.cases ?? []).every(row => rowMatchesRun(report, row)) &&
    Boolean(report.finishedAt) && report.implementationUnchanged === true &&
    report.userSettingsUnchanged === true && !report.interrupted && !report.error;
  const allPassed = eligible && counts.passed === expected.length;
  return { profile: selected.name, catalogId: selected.catalog.id, totalCases: expected.length, counts, passed: counts.passed, percent: counts.passed / expected.length * 100,
    fullMatrixPassed: report.executionKind === "live" && allPassed,
    offlineHarnessPassed: report.executionKind === "offline-self-test" && allPassed,
    perModel: [...new Set(expected.map(r => r.model))].map(model => {
      const rows = (report.cases ?? []).filter(r => r.model === model), passed = rows.filter(r => r.status === "passed").length;
      return { model, passed, total: SCENARIOS.length,
        verdict: report.executionKind === "live" && eligible && passed === SCENARIOS.length ? `${selected.catalog.id}-passed` : "not-established" };
    }),
    realModelCalls: report.executionKind === "offline-self-test" ? 0 : null,
    faultInjectionLabelled: true, hoursLongSoakCertified: false, measuredProductCoverage: null,
    historicalV4Regraded: false };
}
const same = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
const runIdentityFields = ["profile", "catalogId", "catalogHash", "implementationHash", "runId", "executionKind", "schemaVersion"];
function rowMatchesRun(report, row) {
  return runIdentityFields.every(key => !Object.hasOwn(row, key) ||
    same(row[key], key === "profile" ? report.profile ?? DEFAULT_PROFILE : report[key]));
}
export function artifacts(config, observation, checks, status) {
  const json = value => JSON.stringify(value, null, 2) + "\n";
  const lines = value => (value ?? []).map(r => JSON.stringify(r)).join("\n") + "\n";
  return {
    "observation.json": json(observation),
    "case.json": json({ runId: config.runId, scenarioId: config.scenarioId, model: config.model,
      ...(config.profile !== undefined ? { profile: config.profile } : {}),
      ...(config.catalogId !== undefined ? { catalogId: config.catalogId } : {}),
      executionKind: config.executionKind, catalogHash: config.catalogHash, implementationHash: config.implementationHash }),
    "native.jsonl": lines(observation.native), "transport.jsonl": lines(observation.transport), "sdk.jsonl": lines(observation.sdk),
    "controls.json": json(observation.controls ?? []), "resources.json": json(observation.resources ?? {}),
    "oracle.json": json({ status, checks }),
  };
}
export function readCase(directory, config) {
  const selected = profileForRecord(config);
  const manifest = JSON.parse(safeRead(path.join(directory, "result.json"), 2 * 1024 * 1024));
  for (const key of ["runId", "scenarioId", "model", "executionKind", "catalogHash", "implementationHash"]) assert.equal(manifest[key], config[key], key);
  assert.equal(manifest.profile ?? DEFAULT_PROFILE, selected.name);
  if (config.catalogId !== undefined) assert.equal(manifest.catalogId, config.catalogId);
  if (manifest.catalogId !== undefined) assert.equal(manifest.catalogId, selected.catalog.id);
  assert.equal(manifest.catalogHash, selected.catalogHash); assert.equal(manifest.implementationHash, implementationHash());
  const scenario = SCENARIOS.find(s => s.id === config.scenarioId); assert.ok(scenario);
  assert.ok(CATALOG.statuses.includes(manifest.status));
  assert.ok(Number.isSafeInteger(manifest.durationMs) && manifest.durationMs >= 0 && manifest.durationMs < scenario.seconds * 1000);
  assert.ok(manifest.files && typeof manifest.files === "object");
  for (const [name, metadata] of Object.entries(manifest.files)) {
    assert.match(name, /^[a-z][a-z0-9.-]*$/);
    const bytes = safeRead(path.join(directory, name), 64 * 1024 * 1024);
    assert.equal(sha(bytes), metadata.sha256, name); assert.equal(bytes.length, metadata.bytes, name);
  }
  const evidence = JSON.parse(safeRead(path.join(directory, "observation.json"), 64 * 1024 * 1024));
  assert.equal(evidence.model, config.model); assert.equal(evidence.scenarioId, config.scenarioId);
  assert.equal(evidence.executionKind, config.executionKind);
  const checks = evaluate(scenario, evidence, selected.name), diagnostic = metrics(evidence);
  assert.deepEqual(manifest.checks, checks); assert.deepEqual(manifest.metrics, diagnostic);
  const category = failureCategory(evidence, checks);
  if (category) assert.equal(manifest.category, category, "Failure category differs from recorded evidence");
  const expected = artifacts(config, evidence, checks, manifest.status);
  assert.deepEqual(Object.keys(manifest.files).sort(), Object.keys(expected).sort());
  for (const [name, text] of Object.entries(expected)) assert.equal(safeRead(path.join(directory, name), 64 * 1024 * 1024).toString(), text, name);
  if (manifest.status === "passed") assert.ok(checks.every(c => c.passed) && !manifest.error);
  return { manifest, evidence };
}
export function verifyReport(file) {
  const directory = path.dirname(path.resolve(file)), report = JSON.parse(safeRead(file, 8 * 1024 * 1024));
  const selected = profileForRecord(report);
  assert.equal(report.schemaVersion, selected.catalog.schemaVersion); assert.equal(report.catalogId, selected.catalog.id);
  assert.equal(report.catalogHash, selected.catalogHash, "Use the saved original contract to verify historical results");
  assert.equal(report.implementationHash, implementationHash(), "Use the frozen source to verify after code changes");
  assert.ok(["live", "offline-self-test"].includes(report.executionKind));
  assert.deepEqual(report.cases.map(c => [c.model, c.scenarioId]), matrix(report.executionKind, selected.name).map(c => [c.model, c.scenarioId]));
  assert.ok(report.finishedAt && Number.isFinite(Date.parse(report.finishedAt)));
  for (const row of report.cases) {
    assert.ok(rowMatchesRun(report, row), "Case identity cannot override the run's profile, catalog or source identity");
    assert.ok(CATALOG.statuses.includes(row.status));
    if (!row.artifactPath) { assert.notEqual(row.status, "passed"); continue; }
    assert.equal(row.artifactPath, `cases/${row.model}/${row.scenarioId}`);
    const dir = path.join(directory, row.artifactPath);
    for (let p = dir; p !== directory; p = path.dirname(p)) assert.ok(!fs.lstatSync(p).isSymbolicLink());
    const { manifest } = readCase(dir, { ...report, model: row.model, scenarioId: row.scenarioId });
    assert.equal(row.resultHash, sha(safeRead(path.join(dir, "result.json"))));
    assert.equal(row.observedStatus, manifest.status);
    assert.deepEqual(row.failedChecks, manifest.checks.filter(c => !c.passed).map(c => c.id));
    assert.deepEqual(row.metrics, manifest.metrics);
    assert.equal(row.category, manifest.category, "Report failure category differs from case evidence");
    if (row.status === "passed") {
      assert.equal(manifest.status, "passed"); assert.equal(row.supervisor?.processGroupGone, true);
      assert.equal(row.supervisor.code, 0); assert.equal(row.supervisor.killed, false); assert.ok(!row.supervisor.error);
    }
  }
  assert.deepEqual(report.summary, summarize(report));
  return { evidenceIntegrity: true, ...report.summary };
}
export function markdown(report) {
  const summary = summarize(report);
  const result = report.executionKind === "offline-self-test"
    ? summary.offlineHarnessPassed ? "OFFLINE HARNESS PASSED - no live verdict"
      : !report.finishedAt && !report.interrupted ? "OFFLINE HARNESS IN PROGRESS - no live verdict" : "OFFLINE HARNESS NOT PASSED - no live verdict"
    : summary.fullMatrixPassed ? "FULL PASS" : !report.finishedAt && !report.interrupted ? "IN PROGRESS" : "NOT PASSED";
  return [...reportHeader(report, { result, passed: summary.passed, totalCases: summary.totalCases,
    passRule: `All ${summary.totalCases} cases and run-level checks must pass for this execution kind and profile. The 95% reference does not change the verdict.` }),
    "These are bounded native workflow/fault-injection results, not an hours-long soak or product support rate.", "",
    "## Per-model results", "",
    "| Model | Passed | Live verdict |", "|---|---:|---|",
    ...summary.perModel.map(m => `| ${m.model} | ${m.passed}/${m.total} | ${report.executionKind !== "live"
      ? "not assessed (offline)" : m.verdict === `${summary.catalogId}-passed` ? "passed" : "not established"} |`), "",
    ...caseSections(report.cases)].join("\n");
}
