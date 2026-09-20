import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseTestSummary, assertPassingTests, testManifest, runtimeVersions, requirePreparationProof, requireTestGuard } from "../scripts/native/preparation.mjs";
import { runnerPlan } from "../scripts/native/plan.mjs";
import { ROOT, artifact, implementationHash, redactor, sha256, writeJson } from "../scripts/validation/evidence.mjs";
import { runProcess } from "../scripts/validation/process.mjs";

const tap = "TAP version 13\nok 1 - synthetic unit receipt\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-proof-test-")); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function structuralProof(t) {
  // Unit-test data only. This is not an executed preparation run and is never
  // supplied to a live runner; exercise integrity/schema validation separately.
  const root = temporary(t), plan = runnerPlan({ models: ["gpt-6-astra"], selected: ["model-routing.normal"] });
  const manifest = testManifest();
  fs.mkdirSync(path.join(root, "guards"));
  const guardReceipts = [], executions = manifest.files.map((file, index) => {
    const pid = index + 10000;
    const workerPid = index + 20000;
    const executionId = randomUUID();
    const receipt = artifact(path.join(root, "guards"), `${workerPid}.json`, {
      pid: workerPid, parentPid: pid, executionId, testFile: file.path,
      entrypoint: fs.realpathSync(path.join(ROOT, file.path)),
      guard: "production-sdk-and-non-loopback-disabled", modelCalls: 0,
    }, redactor({}));
    guardReceipts.push({ ...receipt, path: `guards/${receipt.path}` });
    return { ...file, executionId, passed: true, summary: parseTestSummary(tap),
      result: artifact(root, `${path.basename(file.path)}.json`, { code: 0, signal: null, stdout: tap, stderr: "", closed: true, terminated: false, pid }, redactor({})) };
  });
  const proof = { schemaVersion: 1, kind: "native-offline-preparation", executionKind: "offline-self-test", modelCalls: 0,
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), versions: runtimeVersions(), implementationHash: implementationHash(), catalogHash: plan.catalogHash,
    models: plan.models, selectedScenarioIds: plan.selectedScenarioIds, readiness: plan.counts, readyToExecute: true, checksPassed: true,
    testManifest: manifest, executions, guardReceipts };
  const filename = path.join(root, "preparation-checks.json"); writeJson(filename, proof);
  return { root, filename, proof, plan };
}
test("offline summary parser requires actual passing tests and rejects skipped/empty/ambiguous TAP totals", () => {
  assertPassingTests(parseTestSummary(tap));
  for (const value of [tap.replace("# tests 1", "# tests 0"), tap.replace("# skipped 0", "# skipped 1"),
    tap.replace("# cancelled 0", "# cancelled 1"), tap.replace("# todo 0", "# todo 1"), tap.replace("# fail 0", "# fail 1")]) {
    assert.throws(() => assertPassingTests(parseTestSummary(value)));
  }
  assert.throws(() => parseTestSummary(tap + "# tests 1\n"), /ambiguous/);
  assert.throws(() => parseTestSummary("exit code zero alone is not a test receipt"), /Missing/);
});
test("preparation test discovery is deterministic and hashes every top-level test file", () => {
  const manifest = testManifest();
  assert.ok(manifest.files.length >= 12);
  assert.equal(manifest.sha256, sha256(JSON.stringify(manifest.files)));
  assert.deepEqual(manifest.files.map(({ path }) => path), manifest.files.map(({ path }) => path).sort());
  assert.ok(manifest.files.some(({ path }) => path === "test/native-runner.test.mjs"));
  assert.ok(manifest.files.some(({ path }) => path === "test/session-manager.test.mjs"));
});
test("structural preparation proof validation requires exact source, scope, artifacts and guard receipts", (t) => {
  const { filename, plan } = structuralProof(t);
  assert.equal(requirePreparationProof(filename, plan).modelCalls, 0);
});
for (const [label, change] of [
  ["stale source", (p) => { p.implementationHash = "0".repeat(64); }],
  ["different selected model", (p) => { p.models = ["claude-opus-5"]; }],
  ["different scenario", (p) => { p.selectedScenarioIds = ["file-read.normal"]; }],
  ["missing discovered test", (p) => { p.executions.pop(); }],
  ["duplicate test receipt", (p) => { p.executions[1] = p.executions[0]; }],
  ["failed test receipt", (p) => { p.executions[0].passed = false; }],
  ["missing offline guard", (p) => { p.guardReceipts = []; }],
  ["different runtime", (p) => { p.versions.node = "v0.0.0"; }],
  ["harness gap", (p) => { p.readyToExecute = false; }],
]) test(`preparation proof rejects ${label}`, (t) => {
  const { filename, plan, proof } = structuralProof(t); change(proof); writeJson(filename, proof);
  assert.throws(() => requirePreparationProof(filename, plan));
});
test("a timed-out test process cannot receive credit even if it printed passing TAP totals", (t) => {
  const { filename, plan, proof, root } = structuralProof(t);
  const item = proof.executions[0].result, file = path.join(root, item.path);
  const result = JSON.parse(fs.readFileSync(file)); result.terminated = true;
  writeJson(file, result); const bytes = fs.readFileSync(file); item.sha256 = sha256(bytes); item.bytes = bytes.length;
  writeJson(filename, proof);
  assert.throws(() => requirePreparationProof(filename, plan));
});
test("offline guard rejects the real Copilot SDK before transport startup", async (t) => {
  const root = temporary(t);
  const guard = fileURLToPath(new URL("./fixtures/offline-native-guard.mjs", import.meta.url));
  const result = await runProcess(process.execPath, ["--import", guard, "--input-type=module", "-e",
    'import {CopilotClient} from "@github/copilot-sdk";await new CopilotClient({mode:"empty",baseDirectory:process.env.HOME}).start();'], {
    env: { PATH: process.env.PATH, HOME: root, GHCP_OFFLINE_RECEIPTS: path.join(root, "receipts") }, timeoutMs: 5000,
  });
  assert.notEqual(result.code, 0); assert.match(result.stderr, /Offline preparation forbids/);
  assert.ok(fs.existsSync(path.join(root, "receipts", `${result.pid}.json`)));
});
test("offline guard blocks non-loopback TCP connections before DNS/network access", async (t) => {
  const root = temporary(t);
  const guard = fileURLToPath(new URL("./fixtures/offline-native-guard.mjs", import.meta.url));
  const result = await runProcess(process.execPath, ["--import", guard, "--input-type=module", "-e",
    'import net from "node:net";net.connect({host:"203.0.113.1",port:443});'], {
    env: { PATH: process.env.PATH, HOME: root }, timeoutMs: 5000,
  });
  assert.notEqual(result.code, 0); assert.match(result.stderr, /only loopback/);
});

test("offline guard receipts identify the test worker, not merely a coordinator or unrelated descendant", () => {
  const execution = { path: "test/model-map.test.mjs", executionId: randomUUID() };
  const result = { pid: 31000 };
  const worker = { pid: 31001, parentPid: result.pid, executionId: execution.executionId,
    testFile: execution.path, entrypoint: fs.realpathSync(path.join(ROOT, execution.path)) };
  assert.equal(requireTestGuard([worker], execution, result), worker);
  for (const change of [
    { parentPid: 99999 }, { executionId: randomUUID() }, { testFile: "test/server.test.mjs" },
    { entrypoint: fs.realpathSync(path.join(ROOT, "test/server.test.mjs")) },
  ]) assert.throws(() => requireTestGuard([{ ...worker, ...change }], execution, result), /actual test worker/);
  assert.throws(() => requireTestGuard([worker, { ...worker, pid: 31002 }], execution, result), /ambiguous/);
  assert.throws(() => requireTestGuard([], execution, result), /actual test worker/);
});

test("the actual Node test worker loads the guard and correlates to its coordinator with a per-execution nonce", async (t) => {
  const root = temporary(t);
  const receipts = path.join(root, "receipts");
  const execution = { path: "test/model-map.test.mjs", executionId: randomUUID() };
  const guard = new URL("./fixtures/offline-native-guard.mjs", import.meta.url).href;
  const result = await runProcess(process.execPath, ["--test", "--test-reporter=tap", execution.path], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: root, GHCP_HARNESS_OFFLINE: "1", GHCP_OFFLINE_RECEIPTS: receipts,
      GHCP_OFFLINE_TEST_FILE: execution.path, GHCP_OFFLINE_EXECUTION_ID: execution.executionId,
      NODE_OPTIONS: `--import=${guard}` },
    timeoutMs: 10000,
  });
  assert.equal(result.code, 0, result.stderr);
  assertPassingTests(parseTestSummary(result.stdout));
  const loaded = fs.readdirSync(receipts).map((name) => JSON.parse(fs.readFileSync(path.join(receipts, name), "utf8")));
  const worker = requireTestGuard(loaded, execution, result);
  assert.equal(worker.guard, "production-sdk-and-non-loopback-disabled");
  assert.equal(worker.modelCalls, 0);
  assert.equal(worker.parentPid, result.pid);
  assert.notEqual(worker.pid, result.pid);
});
