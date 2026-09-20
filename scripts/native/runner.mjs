import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { supportedNodeVersion } from "../../src/version.mjs";
import { withinDeadline } from "../../src/copilot-session-rpc.mjs";
import { ROOT, freshDirectory, implementationHash, redactor, writeJson } from "../validation/evidence.mjs";
import { asError } from "../validation/process.mjs";
import { NATIVE_CATALOG, NATIVE_SCENARIOS } from "./catalog.mjs";
import { NativeFixture } from "./fixture.mjs";
import { driverFor } from "./registry.mjs";
import { assessScenarioDesign, runnerPlan, requireCompleteHarness, requirePreparedSelection } from "./plan.mjs";
import { createReport, saveAttempt, checkpoint } from "./report.mjs";
import { requirePreparationProof } from "./preparation.mjs";

const defaultFixtureFactory = (options) => new NativeFixture(options);
const errorRecord = (error) => ({ name: error.name, message: error.message, code: error.code ?? null });
export function validateExecutionOptions(options) {
  const timeoutMs = options.timeoutMs ?? 240_000;
  const concurrency = options.concurrency ?? 1;
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 900_000, "Timeout must be 1..900000 ms.");
  assert.ok(Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 3, "Concurrency must be 1..3.");
  assert.ok([undefined, "acceptance", "selected"].includes(options.scope), "Unknown execution scope.");
  return { timeoutMs, concurrency };
}
async function executeCase(root, report, record, scenario, settings, fixtureFactory) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const controller = new AbortController();
  const signal = AbortSignal.any([settings.signal, controller.signal].filter(Boolean));
  const timer = setTimeout(() => controller.abort(new Error(`Native case exceeded ${settings.timeoutMs} ms.`)), settings.timeoutMs);
  let fixture;
  let observation = null;
  let error = null;
  try {
    fixture = fixtureFactory({ directory: root, model: record.model, scenario, signal, timeoutMs: settings.timeoutMs, env: settings.env });
    assert.equal(Boolean(fixture.offline), report.executionKind === "offline-self-test", "Fixture provenance disagrees with evidence mode.");
    await withinDeadline(async () => {
      signal.throwIfAborted();
      await fixture.version(); // Runtime failure must not incur an SDK/model call.
      signal.throwIfAborted(); // A late preflight must not start resources after cleanup.
      await fixture.start();
      signal.throwIfAborted();
      observation = await driverFor(scenario).execute(fixture);
      signal.throwIfAborted();
    }, settings.timeoutMs, signal);
  } catch (reason) {
    error = errorRecord(asError(signal.aborted ? signal.reason : reason));
  } finally {
    clearTimeout(timer);
    // Cancel in-flight work before cleanup, even if a driver failed without
    // respecting its deadline. Never propagate this cleanup abort to the run.
    controller.abort(new Error("Native case finished; close owned resources."));
    if (fixture) {
      try { await fixture.close(); }
      catch (reason) {
        fixture.cleanupErrors ??= [];
        fixture.cleanupErrors.push(asError(reason).message);
        error ??= errorRecord(asError(reason));
      }
    }
  }
  const capture = (name, read, fallback) => {
    try { return read() ?? fallback; }
    catch (reason) {
      const failure = asError(reason);
      error ??= { ...errorRecord(failure), message: `${name} capture failed: ${failure.message}` };
      return { ...fallback, inspectionError: failure.message };
    }
  };
  const raw = { model: record.model,
    native: capture("Native", () => fixture?.nativeEvidence(), { hosts: [], phases: [] }),
    sdk: fixture?.sdk ?? [], http: fixture?.http ?? [], diagnostics: fixture?.diagnostics ?? [],
    state: capture("State", () => fixture?.state(), { fixtureNotCreated: !fixture }), processes: fixture?.processes ?? [] };
  const scrub = fixture?.scrub ?? redactor(settings.env);
  const sanitized = JSON.parse(scrub({ evidence: raw, observation, error }));
  return saveAttempt(root, report, record, { ...sanitized, interrupted: Boolean(settings.signal?.aborted),
    startedAt, durationMs: Math.round(performance.now() - started) });
}

export async function runNativeValidation(options = {}, { fixtureFactory = defaultFixtureFactory, onProgress = () => {} } = {}) {
  const { timeoutMs, concurrency } = validateExecutionOptions(options);
  assert.ok(supportedNodeVersion(process.version), "Node.js ^20.19.0 or >=22.12.0 is required.");
  const offline = fixtureFactory !== defaultFixtureFactory;
  const plan = runnerPlan(options);
  const scope = options.scope ?? "acceptance";
  if (scope === "acceptance") requireCompleteHarness(plan);
  else requirePreparedSelection(plan);
  if (!offline) {
    assert.notEqual((options.env ?? process.env).GHCP_HARNESS_OFFLINE, "1", "Live execution is disabled during offline preparation.");
    assert.ok(options.preparation, "A current offline preparation report is required before native execution.");
    requirePreparationProof(options.preparation, plan);
  }
  // All gates run before creating directories, processes, SDK clients or calls.
  const sourceHash = implementationHash();
  const root = freshDirectory(options.output || path.join(ROOT, ".runtime", "native-validation", `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`));
  const report = createReport({ executionKind: offline ? "offline-self-test" : "live", sourceHash });
  Object.assign(report, { executionScope: scope, selectedModels: plan.models, selectedScenarioIds: plan.selectedScenarioIds,
    previousEvidenceImported: false, interrupted: false, versions: { node: process.version, codex: NATIVE_CATALOG.sourceSnapshot.codex,
      sdk: JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/@github/copilot-sdk/package.json"), "utf8")).version } });
  writeJson(path.join(root, "catalogue.json"), NATIVE_CATALOG);
  writeJson(path.join(root, "design.json"), assessScenarioDesign());
  writeJson(path.join(root, "plan.json"), plan);
  checkpoint(root, report);
  const fatal = new AbortController();
  const signal = AbortSignal.any([options.signal, fatal.signal].filter(Boolean));
  const settings = { timeoutMs, signal, env: options.env ?? process.env };
  const chosen = NATIVE_SCENARIOS.filter(({ id }) => plan.selectedScenarioIds.includes(id));
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < plan.models.length) {
      const model = plan.models[next++];
      for (const scenario of chosen) {
        if (signal.aborted) break;
        const record = report.cases.find((row) => row.model === model && row.scenarioId === scenario.id);
        assert.equal(record.attempts.length, 0, "Refusing to overwrite an attempt.");
        try {
          const result = await executeCase(root, report, record, scenario, settings, fixtureFactory);
          checkpoint(root, report);
          onProgress({ model, scenarioId: scenario.id, status: result.status, durationMs: result.durationMs });
        } catch (reason) {
          report.runnerError = errorRecord(asError(reason));
          fatal.abort(asError(reason));
          break;
        }
      }
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(concurrency, plan.models.length) }, worker)); }
  finally {
    report.interrupted = Boolean(options.signal?.aborted);
    report.implementationUnchanged = implementationHash() === sourceHash;
    if (!report.implementationUnchanged) report.runnerError = { name: "Error", message: "Implementation changed during execution.", code: null };
    checkpoint(root, report, { final: true });
  }
  return { report, directory: root };
}
