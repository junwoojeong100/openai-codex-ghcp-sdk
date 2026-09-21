import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { CATALOG, SCENARIOS, catalogHash } from "../scripts/stability/catalog.mjs";
import { DEFAULT_PROFILE, PROFILE_IDS, getProfile, profileForRecord } from "../scripts/stability/profiles.mjs";
import { parseArguments } from "../scripts/stability.mjs";
import { evaluate, metrics } from "../scripts/stability/oracles.mjs";
import { artifacts, readCase, verifyReport, implementationHash, newReport, summarize, matrix, markdown } from "../scripts/stability/report.mjs";
import { stabilityEvidence } from "./helpers/stability-evidence.mjs";
import { sha } from "../scripts/compatibility/util.mjs";

const alternate = "application-data-v1";
const identity = name => { const p = getProfile(name); return { profile: p.name, catalogId: p.catalog.id, catalogHash: p.catalogHash }; };
const temp = t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stability-profiles-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};
function saveCase(directory, config, evidence) {
  fs.mkdirSync(directory, { recursive: true });
  const scenario = SCENARIOS.find(s => s.id === config.scenarioId), checks = evaluate(scenario, evidence, config.profile);
  const manifest = { ...config, durationMs: 1, status: "passed", error: null, checks, metrics: metrics(evidence), files: {} };
  for (const [file, content] of Object.entries(artifacts(config, evidence, checks, "passed"))) {
    fs.writeFileSync(path.join(directory, file), content);
    manifest.files[file] = { sha256: sha(content), bytes: Buffer.byteLength(content) };
  }
  const file = path.join(directory, "result.json");
  fs.writeFileSync(file, JSON.stringify(manifest));
  return { manifest, resultHash: sha(fs.readFileSync(file)) };
}

test("the original v3 catalog remains the exact immutable default", () => {
  assert.equal(DEFAULT_PROFILE, "v3");
  assert.equal(getProfile().catalog, CATALOG);
  assert.equal(getProfile().catalogHash, catalogHash());
  assert.equal(catalogHash(), "bcb5958d066a1628552f059aecd6e4fb04808acab0d0443ec70075df6e1b23fd");
  assert.deepEqual(PROFILE_IDS, ["v3", alternate]);
  for (const name of PROFILE_IDS) {
    const p = getProfile(name);
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.catalog) && Object.isFrozen(p.catalog.prompts));
  }
  for (const invalid of [null, "", "latest", "opus", {}, "__proto__"]) assert.throws(() => getProfile(invalid));
});

test("the optional profile changes task wording and provenance, never models, faults, budgets or output checks", () => {
  const p = getProfile(alternate), c = p.catalog;
  const allowed = ["id", "prompts", "baseCatalogId", "baseCatalogHash", "changesFromV3"];
  for (const key of Object.keys(c).filter(key => !allowed.includes(key))) assert.deepEqual(c[key], CATALOG[key], key);
  assert.equal(c.baseCatalogId, CATALOG.id);
  assert.equal(c.baseCatalogHash, catalogHash());
  assert.notEqual(p.catalogHash, catalogHash());
  assert.equal(c.prompts.padding, CATALOG.prompts.padding);
  assert.equal(c.prompts.read, "Call read_fixture once. Display its returned application data as a fenced text block, preserving the two lines and their characters.");
  assert.match(c.prompts.remember, /once in this turn, including on repeated requests/);
  assert.match(c.prompts.recall, /Do not use tools\./);
  assert.deepEqual(matrix("live", alternate), matrix("live", "v3"));
  assert.equal(matrix("live", alternate).length, 77);
});

test("profile selection still requires live opt-in and cannot override a recorded verification contract", () => {
  assert.deepEqual(parseArguments(["--profile", alternate]), { mode: "plan", profile: alternate });
  assert.deepEqual(parseArguments(["--execute", "--profile", alternate]), { mode: "execute", profile: alternate });
  for (const args of [["--profile"], ["--profile", "other"], ["--profile", alternate, "--profile", "v3"],
    ["--verify", "report.json", "--profile", alternate], ["--models", "claude-opus-5"], ["--retry"]]) {
    assert.throws(() => parseArguments(args));
  }
  const plan = JSON.parse(execFileSync(process.execPath, ["scripts/stability.mjs", "--profile", alternate], { encoding: "utf8" }));
  assert.equal(plan.modelCalls, 0);
  assert.equal(plan.profile, alternate);
  assert.equal(plan.catalogHash, getProfile(alternate).catalogHash);
  assert.equal(plan.totalCases, 77);
});

test("profile identity cannot be switched, inferred from success, or supplied with another catalog hash", () => {
  assert.equal(profileForRecord(identity(alternate)).name, alternate);
  assert.equal(profileForRecord({ catalogHash: catalogHash() }).name, "v3");
  for (const record of [
    { ...identity(alternate), profile: "v3" }, { ...identity(alternate), profile: undefined },
    { ...identity(alternate), catalogId: CATALOG.id }, { ...identity(alternate), catalogHash: catalogHash() },
  ]) assert.throws(() => profileForRecord(record));
});

for (const scenario of SCENARIOS) test(`${scenario.id}: alternate-profile evidence retains every acceptance check and rejects original-profile evidence`, () => {
  const old = stabilityEvidence(scenario.id), current = stabilityEvidence(scenario.id, alternate);
  const expected = evaluate(scenario, old), observed = evaluate(scenario, current, alternate);
  assert.deepEqual(observed, expected);
  assert.ok(observed.every(c => c.passed));
  assert.ok(evaluate(scenario, old, alternate).some(c => !c.passed));
  assert.ok(evaluate(scenario, current).some(c => !c.passed));
  for (const mutate of [
    e => { e.profile = "v3"; },
    e => { e.sdk.find(r => r.type === "assistant.usage").data.model = "claude-sonnet-5"; },
    e => { e.native = []; }, e => { e.transport = []; },
    e => { e.resources.backends[0].queued = 1; },
    e => { e.toolLedger[0].callId = "unknown-call"; },
    e => { e.phases.find(p => p.kind === "turn").prompt = "substituted prompt"; },
    e => { e.native.findLast(r => r.message.params?.item?.type === "agentMessage").message.params.item.text = "missing receipt"; },
  ]) {
    const bad = structuredClone(current); mutate(bad);
    assert.ok(evaluate(scenario, bad, alternate).some(c => !c.passed), String(mutate));
  }
});

test("alternate-profile literal-prefix failures and incomplete matrices remain failures", () => {
  const e = stabilityEvidence("S01", alternate), item = e.native.findLast(r => r.message.params?.item?.type === "agentMessage").message.params.item;
  item.text = "```text\n" + item.text + "\n```";
  assert.equal(evaluate(SCENARIOS[0], e, alternate).find(c => c.id === "final-values").passed, true);
  item.text = item.text.replace("value:", "value: ");
  assert.equal(evaluate(SCENARIOS[0], e, alternate).find(c => c.id === "final-values").passed, false);
  const report = newReport({ runId: "unit", executionKind: "live", profile: alternate });
  Object.assign(report, { finishedAt: new Date().toISOString(), implementationUnchanged: true, userSettingsUnchanged: true });
  report.cases.forEach(c => c.status = "passed");
  assert.equal(summarize(report).fullMatrixPassed, true);
  assert.equal(summarize(report).catalogId, getProfile(alternate).catalog.id);
  assert.match(markdown(report), /application-data-v1/);
  for (const status of CATALOG.statuses.filter(s => s !== "passed")) {
    report.cases[0].status = status;
    assert.equal(summarize(report).fullMatrixPassed, false);
    assert.equal(summarize(report).totalCases, 77);
  }
  report.cases.pop(); assert.equal(summarize(report).fullMatrixPassed, false);
});

test("alternate case artifacts require matching profile at config, manifest and observation boundaries", t => {
  const directory = temp(t), evidence = stabilityEvidence("S01", alternate);
  const config = { ...identity(alternate), runId: "unit", scenarioId: "S01", model: "gpt-6-astra",
    executionKind: "offline-self-test", implementationHash: implementationHash() };
  const { manifest } = saveCase(directory, config, evidence);
  assert.equal(readCase(directory, config).manifest.status, "passed");
  assert.throws(() => readCase(directory, { ...config, ...identity("v3") }));
  manifest.profile = "v3";
  fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(manifest));
  assert.throws(() => readCase(directory, config));
  evidence.profile = "v3";
  saveCase(directory, config, evidence);
  assert.throws(() => readCase(directory, config));
});

test("a report row cannot override its run's profile to import another profile's passing case", t => {
  const directory = temp(t);
  const report = newReport({ runId: "unit", executionKind: "offline-self-test", profile: alternate });
  const row = report.cases[0], relative = `cases/${row.model}/${row.scenarioId}`;
  const config = { ...report, ...row, ...identity("v3") };
  const { manifest, resultHash } = saveCase(path.join(directory, relative), config, stabilityEvidence(row.scenarioId));
  Object.assign(row, identity("v3"), { status: "passed", observedStatus: "passed", artifactPath: relative,
    failedChecks: [], metrics: manifest.metrics, resultHash, supervisor: { processGroupGone: true, code: 0, killed: false } });
  Object.assign(report, { finishedAt: new Date().toISOString(), implementationUnchanged: true, userSettingsUnchanged: true });
  report.summary = summarize(report);
  const file = path.join(directory, "report.json"); fs.writeFileSync(file, JSON.stringify(report));
  assert.throws(() => verifyReport(file), /profile|catalog|identity/i);
});
