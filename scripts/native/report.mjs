import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NATIVE_CATALOG, NATIVE_SCENARIOS, NATIVE_FEATURES, NATIVE_MODELS, EVIDENCE_NAMES, REQUIRED_ROUTE, catalogFingerprint } from "./catalog.mjs";
import { driverFor } from "./registry.mjs";
import { runnerPlan } from "./plan.mjs";
import { assertNativeRoute, assertIsolation, assertCleanup } from "./oracles.mjs";
import { artifact, implementationHash, redactor, verifyArtifact, writeJson } from "../validation/evidence.mjs";

export const REPORT_VERSION = 1;
export const RESULT_STATUSES = Object.freeze(["not-run", "passed", "failed", "blocked", "unsupported", "partial", "interrupted"]);
const assertionNames = ["primary", "secondary", "route", "isolation", "cleanup"];
const serializableError = (error) => ({ name: error?.name || "Error", message: String(error?.message || error), code: error?.code ?? null });

export function createReport({ executionKind = "live", sourceHash = implementationHash() } = {}) {
  assert.ok(["live", "offline-self-test"].includes(executionKind));
  return {
    schemaVersion: REPORT_VERSION, kind: "native-scenario-evidence", runId: randomUUID(), executionKind,
    catalogId: NATIVE_CATALOG.id, catalogHash: catalogFingerprint(), implementationHash: sourceHash,
    startedAt: new Date().toISOString(), finishedAt: null, scopeExclusions: NATIVE_CATALOG.scopeExclusions,
    requiredRoute: REQUIRED_ROUTE, executionScope: "acceptance", selectedModels: [...NATIVE_MODELS],
    selectedScenarioIds: NATIVE_SCENARIOS.map(({ id }) => id), previousEvidenceImported: false,
    interrupted: false, implementationUnchanged: null,
    cases: NATIVE_MODELS.flatMap((model) => NATIVE_SCENARIOS.map((scenario) => ({
      model, scenarioId: scenario.id, status: "not-run", attempts: [],
    }))),
  };
}

export function assertMatrix(report) {
  assert.equal(report.schemaVersion, REPORT_VERSION);
  assert.equal(report.kind, "native-scenario-evidence");
  assert.ok(["live", "offline-self-test"].includes(report.executionKind));
  assert.equal(report.catalogId, NATIVE_CATALOG.id);
  assert.equal(report.catalogHash, catalogFingerprint(), "Scenario catalog is stale.");
  assert.match(report.runId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(report.requiredRoute, REQUIRED_ROUTE);
  assert.deepEqual(report.scopeExclusions, NATIVE_CATALOG.scopeExclusions);
  assert.equal(report.previousEvidenceImported, false, "Imported results cannot certify a fresh native run.");
  assert.equal(typeof report.interrupted, "boolean");
  assert.ok(report.implementationUnchanged === null || typeof report.implementationUnchanged === "boolean");
  assert.ok(Array.isArray(report.selectedModels) && Array.isArray(report.selectedScenarioIds), "Explicit execution scope is required.");
  const selected = runnerPlan({ models: report.selectedModels, selected: report.selectedScenarioIds });
  assert.deepEqual(selected.models, report.selectedModels);
  assert.deepEqual(selected.selectedScenarioIds, report.selectedScenarioIds);
  assert.ok(["acceptance", "selected"].includes(report.executionScope));
  if (report.executionScope === "acceptance") {
    assert.deepEqual([...report.selectedModels].sort(), [...NATIVE_MODELS].sort(), "Acceptance requires all seven models.");
    assert.deepEqual(report.selectedScenarioIds, NATIVE_SCENARIOS.map(({ id }) => id), "Acceptance requires the complete catalog.");
  }
  assert.equal(report.cases.length, NATIVE_MODELS.length * NATIVE_SCENARIOS.length, "The matrix denominator changed.");
  const keys = new Set();
  for (const record of report.cases) {
    assert.ok(NATIVE_MODELS.includes(record.model));
    assert.ok(NATIVE_SCENARIOS.some(({ id }) => id === record.scenarioId));
    const key = `${record.model}/${record.scenarioId}`;
    assert.ok(!keys.has(key), `Duplicate matrix slot: ${key}`);
    keys.add(key);
    assert.ok(RESULT_STATUSES.includes(record.status));
    assert.ok(Array.isArray(record.attempts));
    if (!report.selectedModels.includes(record.model) || !report.selectedScenarioIds.includes(record.scenarioId)) {
      assert.equal(record.attempts.length, 0, "Evidence exists outside the selected execution scope.");
    }
    if (!record.attempts.length) assert.equal(record.status, "not-run");
    else {
      assert.equal(record.status, record.attempts.at(-1).status);
      record.attempts.forEach((attempt, index) => {
        assert.equal(attempt.number, index + 1, "Attempts must be contiguous and append-only.");
        assert.ok(RESULT_STATUSES.includes(attempt.status) && attempt.status !== "not-run");
      });
    }
  }
}

export function coverage(report) {
  assertMatrix(report);
  const count = (rows) => Object.fromEntries(RESULT_STATUSES.map((status) => [status, rows.filter((row) => row.status === status).length]));
  const finished = Boolean(report.finishedAt) && !report.interrupted && !report.runnerError && report.implementationUnchanged === true;
  const liveCredit = finished && report.executionKind === "live";
  const perModel = NATIVE_MODELS.map((model) => {
    const rows = report.cases.filter((row) => row.model === model);
    const completeFeatures = NATIVE_FEATURES.filter((feature) => feature.scenarios.every((scenario) =>
      rows.some((row) => row.scenarioId === scenario.id && row.status === "passed"))).length;
    return { model, counts: count(rows), completeFeatures, totalFeatures: NATIVE_FEATURES.length,
      coveragePercent: liveCredit ? completeFeatures / NATIVE_FEATURES.length * 100 : 0 };
  });
  const selected = report.cases.filter((row) => report.selectedModels.includes(row.model) && report.selectedScenarioIds.includes(row.scenarioId));
  return { executionKind: report.executionKind, totalSlots: report.cases.length, counts: count(report.cases), perModel,
    selectedSlots: selected.length, selectedCounts: count(selected),
    selectedScopePassed: finished && selected.length > 0 && selected.every(({ status }) => status === "passed"),
    liveCompatibilityCredit: liveCredit && report.cases.some(({ status }) => status === "passed"),
    fullMatrixPassed: liveCredit && report.executionScope === "acceptance" && report.cases.every(({ status }) => status === "passed"),
    note: "Offline self-tests, partial probes, unsupported boundaries and missing evidence earn no live compatibility credit." };
}

// Evaluators read retained observations; no driver is re-executed during verification.
export function evaluateEvidence(scenario, evidence, observation, { offline = false, registration = driverFor(scenario) } = {}) {
  const checks = Object.fromEntries(assertionNames.map((name) => [name, { passed: false }]));
  const attempt = (names, fn) => {
    try { fn(); for (const name of names) checks[name] = { passed: true }; }
    catch (error) { for (const name of names) checks[name] = { passed: false, error: serializableError(error) }; }
  };
  attempt(["primary", "secondary"], () => {
    assert.ok(registration && typeof registration.evaluate === "function", "No independent behavior evaluator.");
    const value = registration.evaluate(evidence, observation);
    assert.ok(!value || typeof value.then !== "function", "Artifact evaluators must be synchronous and side-effect free.");
    assert.notEqual(value, false, "Behavior evaluator rejected evidence.");
  });
  for (const name of ["primary", "secondary"]) {
    if (!registration?.covers?.includes(name)) checks[name] = { passed: false, error: { name: "IncompleteOracle", message: `Missing ${name} predicate.`, code: null } };
  }
  attempt(["route"], () => assertNativeRoute(evidence, evidence.model, { offline }));
  attempt(["isolation"], () => assertIsolation(evidence));
  attempt(["cleanup"], () => assertCleanup(evidence));
  return checks;
}

export function classifyAttempt({ checks, registration, error, interrupted = false }) {
  if (interrupted) return "interrupted";
  if (!checks.isolation.passed || !checks.cleanup.passed) return "failed";
  if (error) return error.name === "PrerequisiteError" ? "blocked" : "failed";
  const complete = registration?.covers?.length === 2 && ["primary", "secondary"].every((name) => registration.covers.includes(name)) && !registration.gaps?.length;
  if (!complete) return "partial";
  if (!Object.values(checks).every(({ passed }) => passed)) return "failed";
  return registration.outcome === "unsupported" ? "unsupported" : "passed";
}

export function saveAttempt(root, report, record, { evidence, observation = null, error = null, interrupted = false, startedAt, durationMs }) {
  assertMatrix(report);
  assert.ok(report.cases.includes(record), "Result slot does not belong to this report.");
  const scenario = NATIVE_SCENARIOS.find(({ id }) => id === record.scenarioId);
  const registration = driverFor(scenario);
  assert.equal(evidence.model, record.model);
  const number = record.attempts.length + 1;
  const relative = `cases/${record.model}/${record.scenarioId}/attempt-${String(number).padStart(3, "0")}`;
  const directory = path.join(root, relative);
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  fs.mkdirSync(directory, { mode: 0o700 }); // Never overwrite an earlier attempt.
  const checks = evaluateEvidence(scenario, evidence, observation, { offline: report.executionKind !== "live", registration });
  const outcome = { checks, registration, error, interrupted };
  const status = classifyAttempt(outcome);
  const observations = { runId: report.runId, model: record.model, scenarioId: scenario.id,
    executionKind: report.executionKind, observation, error, interrupted, checks };
  const values = { "native.json": evidence.native, "sdk.json": evidence.sdk, "http.json": evidence.http,
    "diagnostics.json": evidence.diagnostics, "observations.json": observations, "state.json": evidence.state, "processes.json": evidence.processes };
  const scrub = redactor({}); // Callers sanitize secrets before evaluating and saving.
  const artifacts = Object.fromEntries(EVIDENCE_NAMES.map((name) => {
    const item = artifact(directory, name, values[name], scrub);
    return [name, { ...item, path: `${relative}/${name}` }];
  }));
  const result = { number, status, startedAt, finishedAt: new Date().toISOString(), durationMs,
    checks, artifacts, ...(error ? { error } : {}), interrupted };
  record.attempts.push(result);
  record.status = status;
  return result;
}

export function checkpoint(root, report, { final = false } = {}) {
  if (final) report.finishedAt = new Date().toISOString();
  const summary = coverage(report);
  report.summary = summary;
  writeJson(path.join(root, "progress.json"), report);
  if (final) {
    writeJson(path.join(root, "results.json"), report);
    writeJson(path.join(root, "coverage.json"), summary);
  }
  return summary;
}

export function verifyNativeReport(filename, { allowOffline = false, expectedSourceHash = implementationHash() } = {}) {
  const root = path.dirname(path.resolve(filename));
  const report = JSON.parse(fs.readFileSync(filename, "utf8"));
  assertMatrix(report);
  assert.equal(report.implementationHash, expectedSourceHash, "Implementation changed since this run.");
  assert.ok(report.executionKind === "live" || allowOffline, "Offline evidence cannot certify live model compatibility.");
  assert.ok(Number.isFinite(Date.parse(report.startedAt)), "Missing run start time.");
  if (report.finishedAt) assert.ok(Date.parse(report.finishedAt) >= Date.parse(report.startedAt));
  const usedArtifacts = new Set();
  for (const record of report.cases) {
    const scenario = NATIVE_SCENARIOS.find(({ id }) => id === record.scenarioId);
    for (const attempt of record.attempts) {
      const prefix = `cases/${record.model}/${record.scenarioId}/attempt-${String(attempt.number).padStart(3, "0")}/`;
      assert.deepEqual(Object.keys(attempt.artifacts).sort(), [...EVIDENCE_NAMES].sort());
      const data = Object.fromEntries(EVIDENCE_NAMES.map((name) => {
        const item = attempt.artifacts[name];
        assert.equal(item.path, `${prefix}${name}`, "Evidence belongs to another case or attempt.");
        assert.ok(!usedArtifacts.has(item.path), "Artifact reused across attempts.");
        usedArtifacts.add(item.path);
        return [name, JSON.parse(verifyArtifact(root, item).toString("utf8"))];
      }));
      const observation = data["observations.json"];
      assert.equal(observation.runId, report.runId);
      assert.equal(observation.scenarioId, record.scenarioId);
      assert.equal(observation.model, record.model);
      assert.equal(observation.executionKind, report.executionKind);
      const evidence = { model: record.model, native: data["native.json"], sdk: data["sdk.json"], http: data["http.json"],
        diagnostics: data["diagnostics.json"], state: data["state.json"], processes: data["processes.json"] };
      const checks = evaluateEvidence(scenario, evidence, observation.observation, { offline: report.executionKind !== "live" });
      // Error text can vary across Node releases; assertion identities and truth values may not.
      for (const stored of [attempt.checks, observation.checks]) {
        assert.deepEqual(Object.keys(stored).sort(), [...assertionNames].sort());
        for (const name of assertionNames) assert.equal(stored[name].passed, checks[name].passed, `Re-evaluated ${name} disagrees with stored result.`);
      }
      assert.equal(attempt.interrupted, observation.interrupted);
      assert.deepEqual(attempt.error ?? null, observation.error);
      assert.equal(attempt.status, classifyAttempt({ checks, registration: driverFor(scenario), error: observation.error, interrupted: observation.interrupted }),
        "Stored status is not justified by independently re-evaluated artifacts.");
      assert.ok(Number.isFinite(Date.parse(attempt.startedAt)) && Date.parse(attempt.finishedAt) >= Date.parse(attempt.startedAt));
      assert.ok(Number.isFinite(attempt.durationMs) && attempt.durationMs >= 0);
      assert.ok(Date.parse(attempt.startedAt) >= Date.parse(report.startedAt), "Attempt predates this run.");
      if (report.finishedAt) assert.ok(Date.parse(attempt.finishedAt) <= Date.parse(report.finishedAt), "Attempt is outside this run.");
    }
  }
  const summary = coverage(report);
  assert.deepEqual(report.summary, summary, "Stored coverage disagrees with the full matrix.");
  return { evidenceIntegrity: true, ...summary };
}
