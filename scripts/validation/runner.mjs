import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { withinDeadline } from "../../src/copilot-session-rpc.mjs";
import { supportedNodeVersion } from "../../src/version.mjs";
import { CATALOG_ID, DIMENSIONS, EXCLUSIONS, MODELS, SCENARIOS, catalogHash, selectScenarios, validateModels } from "./catalog.mjs";
import { driverFor } from "./drivers.mjs";
import { ROOT, artifact, freshDirectory, implementationHash, redactor, verifyArtifact, writeJson } from "./evidence.mjs";
import { PrerequisiteError, ValidationFixture } from "./fixture.mjs";

import { CHECKS, evaluateValidationEvidence } from "./oracles.mjs";
const STATUSES = ["passed", "failed", "blocked", "interrupted", "not-run", "not-selected"];

export function prepareValidation({ models = MODELS, suite = "full", scenarios } = {}) {
  validateModels(models);
  const selected = selectScenarios({ suite, scenarios });
  const ids = SCENARIOS.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "Duplicate catalog scenario.");
  for (const scenario of SCENARIOS) {
    assert.deepEqual(Object.keys(scenario.assertions).sort(), [...CHECKS].sort());
    assert.ok(scenario.steps.length >= 3 && scenario.steps.every((step) => typeof step === "string" && step.length));
    assert.ok(scenario.evidence.length && scenario.evidence.every((name) => name.endsWith(".json")));
    assert.ok(typeof driverFor(scenario) === "function", `Missing driver: ${scenario.id}`);
    assert.deepEqual(SCENARIOS.filter(({ feature }) => feature === scenario.feature).map(({ dimension }) => dimension), [...DIMENSIONS]);
  }
  return {
    kind: "offline-preparation", catalogId: CATALOG_ID, catalogHash: catalogHash(), implementationHash: implementationHash(),
    modelCalls: 0, readyToExecute: true,
    note: "Ready means a procedure and driver exist, not that a model or feature passed live verification.",
    models: [...models], selectedScenarioIds: selected.map(({ id }) => id), selectedSlots: models.length * selected.length,
    completeMatrixSlots: MODELS.length * SCENARIOS.length, scopeExclusions: EXCLUSIONS,
    scenarios: selected.map((scenario) => ({ ...scenario, readiness: "driver-present" })),
  };
}

export function summarize(report) {
  const counts = (rows) => Object.fromEntries(STATUSES.map((status) => [status, rows.filter((row) => row.status === status).length]));
  const selected = report.cases.filter(({ selected }) => selected);
  return {
    selectedSlots: selected.length, fullMatrixSlots: MODELS.length * SCENARIOS.length,
    counts: counts(selected),
    selectedScopePassed: Boolean(report.finishedAt) && !report.interrupted && !report.runnerError && report.implementationUnchanged !== false && selected.length > 0 && selected.every(({ status }) => status === "passed"),
    fullMatrixPassed: Boolean(report.finishedAt) && !report.interrupted && !report.runnerError && report.implementationUnchanged !== false && report.executionKind === "live" && report.cases.length === MODELS.length * SCENARIOS.length && report.cases.every(({ status }) => status === "passed"),
    perModel: MODELS.map((model) => ({ model, totalCatalogScenarios: SCENARIOS.length,
      selectedScenarios: selected.filter((row) => row.model === model).length,
      counts: counts(report.cases.filter((row) => row.model === model)) })),
  };
}

function repositoryState() {
  const read = (args) => {
    const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", timeout: 5_000 });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  return { commit: read(["rev-parse", "HEAD"]), dirty: Boolean(read(["status", "--porcelain"])),
    note: "The implementation hash, not the commit alone, identifies the tested working tree." };
}

async function runCase(record, scenario, options, report, dependencies) {
  const directory = path.join(options.directory, "cases", record.model, scenario.id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)].filter(Boolean));
  const checks = Object.fromEntries(CHECKS.map((name) => [name, false]));
  let fixture;
  let observation;
  let route;
  let state;
  let failure;
  const started = performance.now();
  record.startedAt = new Date().toISOString();
  record.status = "failed";
  const scrub = redactor(options.env);
  try {
    fixture = dependencies.fixtureFactory({ directory, model: record.model, scenario, signal,
      timeoutMs: options.timeoutMs, env: options.env });
    // Injected clients must never produce a report that can be mistaken for live evidence.
    assert.equal(Boolean(fixture.offline), report.executionKind !== "live", "Fixture kind disagrees with evidence mode.");
    await fixture.start();
    observation = await withinDeadline(() => driverFor(scenario)(fixture, scenario.dimension), options.timeoutMs, signal);
    checks.behavior = true;
    route = fixture.assertRoute();
    checks.route = true;
    record.status = "passed";
  } catch (error) {
    failure = { name: error.name, message: error.message, code: error.code ?? null };
    record.status = options.signal?.aborted ? "interrupted" : error instanceof PrerequisiteError ? "blocked" : "failed";
  } finally {
    if (fixture) {
      try { await fixture.stop(); }
      catch (error) { fixture.cleanupErrors.push(error.message); }
      try {
        state = fixture.state();
        checks.isolation = state.workspaceUnchanged && state.configurationUnchanged;
        checks.cleanup = state.allListenersClosed && !state.cleanupErrors.length;
      } catch (error) {
        state = { inspectionError: error.message };
      }
    } else {
      state = { fixtureNotCreated: true };
      checks.isolation = checks.cleanup = true;
    }
    const evidence = { model: record.model, state, sdk: fixture?.sdk ?? [], http: fixture?.http ?? [],
      diagnostics: fixture?.diagnostics ?? [], processes: fixture?.processes ?? [] };
    const evaluated = evaluateValidationEvidence(evidence, scenario);
    for (const name of CHECKS) checks[name] = evaluated[name].passed;
    if (record.status === "passed" && !CHECKS.every((name) => checks[name])) {
      record.status = "failed";
      failure = { name: "EvidenceError", message: CHECKS.filter((name) => !checks[name]).map((name) => `${name}: ${evaluated[name].error.message}`).join("; "), code: null };
    }
    if ((!checks.isolation || !checks.cleanup) && record.status !== "interrupted") {
      record.status = "failed";
      failure = { ...failure, message: `${failure?.message ?? ""} Fixture isolation or resource cleanup failed.`.trim() };
    }
    record.checks = checks;
    record.finishedAt = new Date().toISOString();
    record.durationMs = Math.round(performance.now() - started);
    if (failure) record.error = failure;
    const observed = { scenarioId: scenario.id, model: record.model, executionKind: report.executionKind,
      checks: CHECKS.map((name) => ({ id: `${scenario.id}.${name}`, passed: checks[name], expected: scenario.assertions[name] })),
      observation, route, error: failure };
    const values = {
      "observations.json": observed, "http.json": fixture?.http ?? [], "sdk.json": fixture?.sdk ?? [],
      "diagnostics.json": fixture?.diagnostics ?? [], "state.json": state, "processes.json": fixture?.processes ?? [],
    };
    record.artifacts = Object.fromEntries(Object.entries(values).map(([name, value]) => {
      const item = artifact(directory, name, value, fixture?.scrub ?? scrub);
      item.path = path.relative(options.directory, path.join(directory, item.path)).split(path.sep).join("/");
      return [name, item];
    }));
  }
}

export async function runValidation(options = {}, { fixtureFactory = DEFAULT_FIXTURE_FACTORY, onProgress = () => {} } = {}) {
  const injected = fixtureFactory !== DEFAULT_FIXTURE_FACTORY;
  const plan = prepareValidation(options);
  assert.ok(supportedNodeVersion(process.version), "Node.js ^20.19.0 or >=22.12.0 is required.");
  assert.ok(Number.isSafeInteger(options.timeoutMs ?? 240_000) && (options.timeoutMs ?? 240_000) > 0 && (options.timeoutMs ?? 240_000) <= 900_000);
  const directory = freshDirectory(options.output || path.join(ROOT, ".runtime", "validation", `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`));
  const settings = { ...options, directory, timeoutMs: options.timeoutMs ?? 240_000, env: options.env ?? process.env };
  const report = {
    schemaVersion: 1, catalogId: CATALOG_ID, catalogHash: plan.catalogHash, implementationHash: plan.implementationHash,
    executionKind: injected ? "offline-self-test" : "live", startedAt: new Date().toISOString(),
    repository: repositoryState(), versions: { node: process.version,
      sdk: JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/@github/copilot-sdk/package.json"), "utf8")).version },
    selectedModels: plan.models, selectedScenarioIds: plan.selectedScenarioIds, scopeExclusions: EXCLUSIONS,
    cases: MODELS.flatMap((model) => SCENARIOS.map(({ id }) => {
      const selected = plan.models.includes(model) && plan.selectedScenarioIds.includes(id);
      return { model, scenarioId: id, selected, status: selected ? "not-run" : "not-selected" };
    })),
  };
  const save = () => { report.summary = summarize(report); writeJson(path.join(directory, "report.json"), report, redactor(settings.env)); };
  save();
  try {
    for (const record of report.cases.filter(({ selected }) => selected)) {
      if (options.signal?.aborted) break;
      const scenario = SCENARIOS.find(({ id }) => id === record.scenarioId);
      await runCase(record, scenario, settings, report, { fixtureFactory });
      save();
      onProgress({ model: record.model, scenarioId: record.scenarioId, status: record.status, durationMs: record.durationMs });
    }
  } catch (error) {
    report.runnerError = { name: error.name, message: error.message };
  } finally {
    if (options.signal?.aborted) report.interrupted = true;
    report.implementationUnchanged = implementationHash() === plan.implementationHash;
    report.finishedAt = new Date().toISOString();
    save();
  }
  return { report, directory };
}
const DEFAULT_FIXTURE_FACTORY = (settings) => new ValidationFixture(settings);

export function verifyReport(file, { allowOffline = false } = {}) {
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  const root = path.dirname(path.resolve(file));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.catalogId, CATALOG_ID);
  assert.equal(report.catalogHash, catalogHash(), "The scenario catalog has changed since this run.");
  assert.equal(report.implementationHash, implementationHash(), "The implementation has changed since this run.");
  assert.ok(report.executionKind === "live" || allowOffline && report.executionKind === "offline-self-test", "Offline evidence cannot certify live model compatibility.");
  validateModels(report.selectedModels);
  selectScenarios({ scenarios: report.selectedScenarioIds });
  assert.equal(report.cases.length, MODELS.length * SCENARIOS.length, "The matrix denominator was changed.");
  const keys = new Set();
  const usedArtifacts = new Set();
  for (const record of report.cases) {
    const scenario = SCENARIOS.find(({ id }) => id === record.scenarioId);
    assert.ok(scenario && MODELS.includes(record.model));
    const key = `${record.model}/${record.scenarioId}`;
    assert.ok(!keys.has(key), "Duplicate result slot.");
    keys.add(key);
    const selected = report.selectedModels.includes(record.model) && report.selectedScenarioIds.includes(record.scenarioId);
    assert.equal(record.selected, selected);
    assert.ok(STATUSES.includes(record.status));
    if (!selected) { assert.equal(record.status, "not-selected"); continue; }
    if (record.status === "not-run") continue;
    assert.ok(record.status !== "not-selected");
    assert.deepEqual(Object.keys(record.artifacts).sort(), [...scenario.evidence].sort());
    const contents = Object.fromEntries(scenario.evidence.map((name) => {
      const item = record.artifacts[name];
      assert.equal(item.path, `cases/${record.model}/${scenario.id}/${name}`, "Evidence belongs to another case.");
      assert.ok(!usedArtifacts.has(item.path), "Evidence reused across cases.");
      usedArtifacts.add(item.path);
      return [name, JSON.parse(verifyArtifact(root, item).toString("utf8"))];
    }));
    const evaluated = evaluateValidationEvidence({ model: record.model, state: contents["state.json"], sdk: contents["sdk.json"],
      http: contents["http.json"], diagnostics: contents["diagnostics.json"], processes: contents["processes.json"] }, scenario);
    const observation = contents["observations.json"];
    assert.equal(observation.model, record.model);
    assert.equal(observation.scenarioId, record.scenarioId);
    assert.equal(observation.executionKind, report.executionKind);
    assert.deepEqual(observation.checks.map(({ id }) => id).sort(), CHECKS.map((name) => `${scenario.id}.${name}`).sort());
    assert.equal(new Set(observation.checks.map(({ id }) => id)).size, CHECKS.length);
    assert.deepEqual(Object.keys(record.checks).sort(), [...CHECKS].sort());
    for (const check of observation.checks) {
      const name = check.id.slice(scenario.id.length + 1);
      assert.equal(typeof check.passed, "boolean");
      assert.equal(check.passed, record.checks[name]);
      assert.equal(check.passed, evaluated[name].passed, `Re-evaluated ${name} disagrees with the stored assertion.`);
      assert.equal(check.expected, scenario.assertions[name]);
      if (record.status === "passed") assert.equal(check.passed, true, "A passed result is missing a required assertion.");
    }
    if (record.status === "passed") assert.ok(CHECKS.every((name) => evaluated[name].passed));
    assert.ok(Number.isFinite(Date.parse(record.startedAt)) && Date.parse(record.finishedAt) >= Date.parse(record.startedAt));
    assert.ok(Number.isSafeInteger(record.durationMs) && record.durationMs >= 0);
  }
  const summary = summarize(report);
  assert.deepEqual(report.summary, summary, "Stored summary disagrees with the complete result matrix.");
  return { evidenceIntegrity: true, executionKind: report.executionKind, ...summary };
}
