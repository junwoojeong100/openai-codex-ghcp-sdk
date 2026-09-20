import assert from "node:assert/strict";
import { NATIVE_SCENARIO_CATALOG as C, NATIVE_MODELS, catalogFingerprint } from "./catalog.mjs";

export function validateDesign(c = C) {
  assert.equal(c.scenarios.length, 10);
  assert.deepEqual(c.models, NATIVE_MODELS);
  assert.equal(new Set(c.models).size, 7);
  assert.equal(c.acceptance.perModelDenominator, 10);
  assert.equal(c.acceptance.minimumPassedPerModel, 10);
  assert.equal(c.acceptance.removeMissingFromDenominator, false);
  assert.equal(c.budget.globalDeadline, false);
  assert.equal(c.budget.automaticCaseRetries, 0);
  assert.ok(!Object.hasOwn(c, "baseline"));
  for (const key of ["targetSeconds", "preflightSeconds", "modelConcurrency", "caseCleanupReserveSeconds"])
    assert.ok(Number.isSafeInteger(c.budget[key]) && c.budget[key] > 0, key);
  assert.ok(c.budget.modelConcurrency <= c.models.length);
  const ids = c.scenarios.map(s => s.id);
  assert.deepEqual(ids, Array.from({ length: 10 }, (_, n) => `C${String(n + 1).padStart(2, "0")}`));
  const localized = x => assert.ok(x?.ko?.trim() && x?.en?.trim(), "Missing translation");
  const covered = new Set();
  for (const s of c.scenarios) {
    for (const value of [s.name, s.fixture, s.bridgeRisk, ...s.steps]) localized(value);
    assert.ok(s.prompt.length > 25 && s.steps.length && s.assertions.length >= 2);
    assert.ok(Number.isSafeInteger(s.timeoutSeconds) && s.timeoutSeconds > c.budget.caseCleanupReserveSeconds && s.timeoutSeconds <= 300);
    assert.ok(Number.isSafeInteger(s.maxToolCalls) && s.maxToolCalls > 0);
    assert.ok(Number.isSafeInteger(s.maxUserTurns) && s.maxUserTurns > 0);
    assert.ok(s.sources.length && s.sources.every(key => c.sources[key]));
    assert.equal(new Set(s.assertions.map(a => a.id)).size, s.assertions.length);
    s.assertions.forEach(a => { localized(a.description); assert.ok(a.id.startsWith(`${s.id}.`) && a.evidence); });
    assert.ok(s.coverage.length);
    s.coverage.forEach(id => covered.add(id));
  }
  assert.equal(c.coverage.targetPercent, 90);
  assert.equal(c.coverage.measuredPercent, null);
  assert.deepEqual([...covered].sort(), c.coverage.included.map(f => f.id).sort());
  for (const f of c.coverage.included) {
    localized(f.name);
    assert.deepEqual(f.scenarios, c.scenarios.filter(s => s.coverage.includes(f.id)).map(s => s.id));
    assert.ok(f.scenarios.length);
  }
  c.coverage.excluded.forEach(localized);
  const perModelSeconds = c.scenarios.reduce((n, s) => n + s.timeoutSeconds, 0);
  return { kind: "scenario-contract", catalogId: c.id, catalogHash: catalogFingerprint(c), scenarios: 10,
    models: 7, totalCases: 70, perModelSeconds,
    scheduledCeilingEstimateSeconds: c.budget.preflightSeconds + Math.ceil(c.models.length / c.budget.modelConcurrency) * perModelSeconds,
    timingNote: "Planning estimate excluding scheduling/report I/O overhead; no overall cutoff and no success guarantee.",
    budget: c.budget, coverage: { targetPercent: 90, measuredPercent: null, namedCapabilities: covered.size },
    modelCalls: 0, liveCompatibilityVerified: false, scope: c.acceptance.scope };
}
