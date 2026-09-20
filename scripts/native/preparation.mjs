import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, artifact, freshDirectory, implementationHash, sha256, verifyArtifact, writeJson } from "../validation/evidence.mjs";
import { runProcess } from "../validation/process.mjs";
import { runnerPlan } from "./plan.mjs";
import { NATIVE_CATALOG } from "./catalog.mjs";

export const runtimeVersions = () => ({ node: process.version, codex: NATIVE_CATALOG.sourceSnapshot.codex,
  sdk: JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/@github/copilot-sdk/package.json"), "utf8")).version });

export function testManifest(root = ROOT) {
  const files = fs.readdirSync(path.join(root, "test")).filter((name) => name.endsWith(".test.mjs")).sort()
    .map((name) => ({ path: `test/${name}`, sha256: sha256(fs.readFileSync(path.join(root, "test", name))) }));
  assert.ok(files.length, "No offline tests found.");
  return { files, sha256: sha256(JSON.stringify(files)) };
}
export function parseTestSummary(stdout) {
  const keys = { tests: "tests", pass: "passed", fail: "failed", cancelled: "cancelled", skipped: "skipped", todo: "todo" };
  const result = {};
  for (const [label, field] of Object.entries(keys)) {
    const matches = [...stdout.matchAll(new RegExp(`^# ${label} (\\d+)\\r?$`, "gm"))];
    assert.equal(matches.length, 1, `Missing/ambiguous TAP ${label} summary.`);
    result[field] = Number(matches[0][1]);
  }
  return result;
}
export function assertPassingTests(summary) {
  for (const value of Object.values(summary)) assert.ok(Number.isSafeInteger(value) && value >= 0);
  assert.ok(summary.tests > 0 && summary.passed === summary.tests && summary.failed === 0 &&
    summary.cancelled === 0 && summary.skipped === 0 && summary.todo === 0, "Offline tests did not all pass without skips.");
}
function environment(home, receipts, inherited) {
  const env = Object.fromEntries(Object.entries(inherited).filter(([name]) => /^(PATH|SHELL|LANG|LC_ALL|SystemRoot|WINDIR)$/i.test(name)));
  const codexHome = path.join(home, ".codex");
  const copilotHome = path.join(home, ".copilot");
  for (const directory of [codexHome, copilotHome]) fs.mkdirSync(directory, { mode: 0o700 });
  return { ...env, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome, COPILOT_HOME: copilotHome,
    GHCP_HARNESS_OFFLINE: "1", GHCP_OFFLINE_RECEIPTS: receipts,
    NODE_OPTIONS: `--import=${pathToFileURL(path.join(ROOT, "test/fixtures/offline-native-guard.mjs")).href}` };
}
export async function checkNativeRunner({ output, models, selected, signal, timeoutMs = 180_000, env = process.env } = {}) {
  assert.ok(output, "--output must name a new private preparation directory.");
  const plan = runnerPlan({ models, selected });
  const sourceHash = implementationHash();
  const manifest = testManifest();
  const directory = freshDirectory(output);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-ghcp-offline-"));
  const receipts = path.join(directory, "guards");
  const proof = { schemaVersion: 1, kind: "native-offline-preparation", executionKind: "offline-self-test", modelCalls: 0,
    startedAt: new Date().toISOString(), finishedAt: null, versions: runtimeVersions(), implementationHash: sourceHash, catalogHash: plan.catalogHash,
    models: plan.models, selectedScenarioIds: plan.selectedScenarioIds, testManifest: manifest,
    readiness: plan.counts, readyToExecute: plan.readyToExecute, checksPassed: false, executions: [] };
  try {
    const childEnv = environment(home, receipts, env);
    for (const entry of manifest.files) {
      if (signal?.aborted) break;
      const executionId = randomUUID();
      let result;
      try { result = await runProcess(process.execPath, ["--test", "--test-reporter=tap", entry.path], {
        cwd: ROOT, env: { ...childEnv, GHCP_OFFLINE_EXECUTION_ID: executionId, GHCP_OFFLINE_TEST_FILE: entry.path }, signal, timeoutMs,
      }); } catch (error) { result = { ...error.processResult, error: error.message }; }
      const record = { ...entry, executionId, result: artifact(directory, `${path.basename(entry.path)}.json`, result, (value) => JSON.stringify(value, null, 2)) };
      try {
        assert.equal(result.code, 0);
        assert.equal(result.signal, null);
        assert.equal(result.terminated, false);
        assert.equal(result.error, undefined);
        record.summary = parseTestSummary(result.stdout);
        assertPassingTests(record.summary);
        record.passed = true;
      } catch (error) { record.passed = false; record.error = error.message; }
      proof.executions.push(record);
      writeJson(path.join(directory, "preparation-checks.json"), proof);
    }
    proof.guardReceipts = fs.existsSync(receipts) ? fs.readdirSync(receipts).sort().map((name) => {
      const bytes = fs.readFileSync(path.join(receipts, name));
      return { path: `guards/${name}`, sha256: sha256(bytes), bytes: bytes.length };
    }) : [];
    try {
      assert.ok(!signal?.aborted, "Preparation was interrupted.");
      assert.equal(implementationHash(), sourceHash, "Implementation changed during preparation.");
      validatePreparationExecutions(directory, proof, manifest);
      proof.checksPassed = true;
    } catch (error) {
      proof.checksPassed = false;
      proof.verificationError = error.message;
    }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    proof.finishedAt = new Date().toISOString();
    writeJson(path.join(directory, "preparation-checks.json"), proof);
  }
  return { proof, directory };
}
export function requirePreparationProof(filename, plan, expectedSourceHash = implementationHash()) {
  const proof = JSON.parse(fs.readFileSync(filename, "utf8"));
  const root = path.dirname(path.resolve(filename));
  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.kind, "native-offline-preparation");
  assert.equal(proof.executionKind, "offline-self-test");
  assert.equal(proof.modelCalls, 0);
  assert.deepEqual(proof.versions, runtimeVersions(), "Runtime/dependency versions changed since preparation.");
  assert.equal(proof.implementationHash, expectedSourceHash, "Offline preparation is stale; source or dependencies changed.");
  assert.equal(proof.catalogHash, plan.catalogHash);
  assert.deepEqual(proof.models, plan.models, "Prepared models differ from the requested run.");
  assert.deepEqual(proof.selectedScenarioIds, plan.selectedScenarioIds, "Prepared scenarios differ from the requested run.");
  assert.equal(proof.readyToExecute, true, "The selected preparation has harness gaps.");
  assert.deepEqual(proof.readiness, plan.counts);
  assert.equal(proof.checksPassed, true);
  assert.ok(Number.isFinite(Date.parse(proof.startedAt)) && Date.parse(proof.finishedAt) >= Date.parse(proof.startedAt));
  const manifest = testManifest();
  assert.deepEqual(proof.testManifest, manifest, "Preparation did not discover the current complete test manifest.");
  validatePreparationExecutions(root, proof, manifest);
  return proof;
}


export function requireTestGuard(receipts, execution, result) {
  assert.match(execution.executionId ?? "", /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.ok(Number.isSafeInteger(result.pid) && result.pid > 0, "Missing test coordinator process ID.");
  const expectedEntrypoint = fs.realpathSync(path.join(ROOT, execution.path));
  const matches = receipts.filter((receipt) => receipt.executionId === execution.executionId &&
    receipt.testFile === execution.path && receipt.entrypoint === expectedEntrypoint &&
    (receipt.pid === result.pid || receipt.parentPid === result.pid));
  assert.equal(matches.length, 1, `Missing/ambiguous offline guard for the actual test worker: ${execution.path}`);
  return matches[0];
}

// Used both by the producer and the verifier: a zero test exit code alone must
// never yield a checksPassed proof that a later live-run gate would reject.
function validatePreparationExecutions(root, proof, manifest) {
  assert.ok(Array.isArray(proof.guardReceipts) && proof.guardReceipts.length, "No offline guard receipt.");
  const unique = new Set();
  const receipts = proof.guardReceipts.map((item) => {
    assert.match(item.path, /^guards\/[0-9]+\.json$/);
    assert.ok(!unique.has(item.path), "Duplicate offline guard receipt.");
    unique.add(item.path);
    const receipt = JSON.parse(verifyArtifact(root, item).toString("utf8"));
    assert.ok(Number.isSafeInteger(receipt.pid) && receipt.pid > 0);
    assert.equal(item.path, `guards/${receipt.pid}.json`, "Guard filename and process identity disagree.");
    assert.ok(Number.isSafeInteger(receipt.parentPid) && receipt.parentPid > 0);
    assert.equal(receipt.guard, "production-sdk-and-non-loopback-disabled");
    assert.equal(receipt.modelCalls, 0);
    return receipt;
  });
  assert.equal(proof.executions.length, manifest.files.length);
  const executionIds = new Set();
  proof.executions.forEach((execution, index) => {
    assert.equal(execution.path, manifest.files[index].path);
    assert.equal(execution.sha256, manifest.files[index].sha256);
    assert.equal(execution.passed, true);
    assert.ok(!executionIds.has(execution.executionId), "Reused test execution identity.");
    executionIds.add(execution.executionId);
    assert.equal(execution.result.path, `${path.basename(execution.path)}.json`);
    const result = JSON.parse(verifyArtifact(root, execution.result).toString("utf8"));
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.closed, true);
    assert.equal(result.terminated, false);
    assert.equal(result.error, undefined);
    requireTestGuard(receipts, execution, result);
    assertPassingTests(parseTestSummary(result.stdout));
    assert.deepEqual(execution.summary, parseTestSummary(result.stdout));
  });
}
