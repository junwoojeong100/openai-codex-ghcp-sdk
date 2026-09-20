import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runNativeValidation } from "../scripts/native/runner.mjs";
import { checkpoint, saveAttempt, verifyNativeReport } from "../scripts/native/report.mjs";
import { artifact, freshDirectory, implementationHash, redactor, sha256, sourceManifest, treeState, verifyArtifact, writeJson } from "../scripts/validation/evidence.mjs";
import { NativeFixture, nativeEnvironment } from "../scripts/native/fixture.mjs";
import { ValidationSdk } from "./helpers/validation-sdk.mjs";
import { OfflineNativeFixture } from "./helpers/native-fixture.mjs";

const model = "gpt-6-astra", scenarioId = "model-routing.normal";
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-evidence-test-")); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
async function run(t) {
  return runNativeValidation({ output: path.join(temporary(t), "run"), models: [model], selected: [scenarioId], scope: "selected" }, {
    fixtureFactory: (settings) => new OfflineNativeFixture(settings),
  });
}
function selected(report) { return report.cases.find((row) => row.model === model && row.scenarioId === scenarioId); }
function replaceArtifact(root, item, change) {
  const file = path.join(root, item.path);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  change(value);
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  const bytes = fs.readFileSync(file); item.sha256 = sha256(bytes); item.bytes = bytes.length;
}
for (const [label, edit] of [
  ["removed matrix slot", (report) => report.cases.pop()],
  ["duplicate matrix slot", (report) => { report.cases[1] = structuredClone(report.cases[0]); }],
  ["unselected model result", (report) => { report.selectedModels = ["gpt-5.6-sol"]; }],
  ["fabricated summary", (report) => { report.summary.fullMatrixPassed = true; }],
  ["cross-case artifact", (report) => { selected(report).attempts[0].artifacts["native.json"].path = "cases/other/native.json"; }],
  ["stale implementation", (report) => { report.implementationHash = "0".repeat(64); }],
  ["non-contiguous retry", (report) => { selected(report).attempts[0].number = 2; }],
]) test(`native verification rejects ${label}`, async (t) => {
  const { report, directory } = await run(t);
  edit(report); writeJson(path.join(directory, "results.json"), report);
  assert.throws(() => verifyNativeReport(path.join(directory, "results.json"), { allowOffline: true }));
});
test("native verification independently rejects changed SDK evidence even after its digest is recomputed", async (t) => {
  const { report, directory } = await run(t);
  const attempt = selected(report).attempts[0];
  replaceArtifact(directory, attempt.artifacts["sdk.json"], (value) => { value.find(({ type }) => type === "usage").model = "wrong-model"; });
  writeJson(path.join(directory, "results.json"), report);
  assert.throws(() => verifyNativeReport(path.join(directory, "results.json"), { allowOffline: true }), /Re-evaluated route/);
});
test("native verification rejects forged behavior flags rather than trusting a success-shaped observation", async (t) => {
  const { report, directory } = await run(t);
  const attempt = selected(report).attempts[0];
  replaceArtifact(directory, attempt.artifacts["native.json"], (value) => {
    value.phases.find(({ kind }) => kind === "turn").transcript.find(({ message }) => message.params?.item?.type === "agentMessage").message.params.item.text = "invented";
  });
  writeJson(path.join(directory, "results.json"), report);
  assert.throws(() => verifyNativeReport(path.join(directory, "results.json"), { allowOffline: true }), /Re-evaluated/);
});
test("native verification detects tampered bytes, artifact ownership and symbolic-link substitution", async (t) => {
  const { report, directory } = await run(t);
  const item = selected(report).attempts[0].artifacts["sdk.json"];
  const file = path.join(directory, item.path), bytes = fs.readFileSync(file);
  fs.appendFileSync(file, " ");
  assert.throws(() => verifyArtifact(directory, item), /length/);
  fs.writeFileSync(file, bytes);
  const elsewhere = path.join(temporary(t), "sdk.json"); fs.writeFileSync(elsewhere, bytes);
  fs.unlinkSync(file); fs.symlinkSync(elsewhere, file);
  assert.throws(() => verifyArtifact(directory, item), /symlink/);
});
test("native retries append evidence and a later failure cannot be hidden by an earlier pass", async (t) => {
  const { report, directory } = await run(t);
  const row = selected(report), first = structuredClone(row.attempts[0]);
  const original = fs.readFileSync(path.join(directory, first.artifacts["native.json"].path), "utf8");
  const evidence = Object.fromEntries(["native", "sdk", "http", "diagnostics", "state", "processes"].map((name) => [name,
    JSON.parse(fs.readFileSync(path.join(directory, first.artifacts[`${name}.json`].path), "utf8"))]));
  const observation = JSON.parse(fs.readFileSync(path.join(directory, first.artifacts["observations.json"].path), "utf8")).observation;
  evidence.model = model;
  evidence.sdk.find(({ type }) => type === "usage").model = "wrong-model";
  report.finishedAt = null;
  saveAttempt(directory, report, row, { evidence, observation, startedAt: new Date().toISOString(), durationMs: 1 });
  checkpoint(directory, report, { final: true });
  assert.deepEqual(row.attempts[0], first);
  assert.equal(fs.readFileSync(path.join(directory, first.artifacts["native.json"].path), "utf8"), original);
  assert.equal(row.attempts.length, 2); assert.equal(row.status, "failed");
  assert.equal(report.summary.selectedScopePassed, false);
  verifyNativeReport(path.join(directory, "results.json"), { allowOffline: true });
});
test("private artifact helpers reject traversal, overwrite and directory symlinks", (t) => {
  const root = temporary(t), fresh = freshDirectory(path.join(root, "private"));
  assert.throws(() => freshDirectory(fresh), /EEXIST/);
  const item = artifact(fresh, "one.json", { ok: true }, redactor({}));
  assert.throws(() => artifact(fresh, "one.json", {}, redactor({})), /EEXIST/);
  assert.throws(() => artifact(fresh, "../escape.json", {}, redactor({})), /plain filenames/);
  for (const name of ["../one.json", "/tmp/one.json", "a/../one.json", "a\\one.json"]) assert.throws(() => verifyArtifact(fresh, { ...item, path: name }), /escapes/);
  fs.symlinkSync(fresh, path.join(root, "linked"));
  assert.throws(() => verifyArtifact(root, { ...item, path: "linked/one.json" }), /symlink/);
});
test("state hashes include empty directories and permissions; source hashes include executable bits", (t) => {
  const root = temporary(t);
  fs.writeFileSync(path.join(root, "value"), "same"); const before = treeState(root);
  fs.mkdirSync(path.join(root, "empty")); assert.notDeepEqual(treeState(root), before);
  fs.chmodSync(path.join(root, "value"), 0o700); assert.notDeepEqual(treeState(root).value, before.value);
  for (const name of ["src", "scripts", "test", "bin"]) fs.mkdirSync(path.join(root, name));
  for (const name of ["package.json", "package-lock.json", "scripts/runner.mjs"]) fs.writeFileSync(path.join(root, name), "{}");
  const hash = implementationHash(root);
  fs.chmodSync(path.join(root, "scripts/runner.mjs"), 0o700);
  assert.notEqual(implementationHash(root), hash);
  fs.symlinkSync(path.join(root, "value"), path.join(root, "src/link"));
  assert.throws(() => sourceManifest(root), /symlink/);
});
test("native child environments contain only fixture paths and the local bridge credential", () => {
  const env = nativeEnvironment({ PATH: "/bin", GH_TOKEN: "do-not-copy", OPENAI_API_KEY: "do-not-copy", HOME: "/real/home",
    NODE_OPTIONS: "--import=untrusted.mjs", HTTPS_PROXY: "https://credential.invalid", GHCP_HARNESS_OFFLINE: "1" }, {
    home: "/fixture/home", codexHome: "/fixture/home/.codex", temporary: "/fixture/tmp", token: "fixture-bridge-token",
  });
  assert.equal(env.HOME, "/fixture/home"); assert.equal(env.CODEX_GHCP_BRIDGE_TOKEN, "fixture-bridge-token");
  for (const key of ["GH_TOKEN", "OPENAI_API_KEY", "NODE_OPTIONS", "HTTPS_PROXY"]) assert.equal(env[key], undefined);
});
test("evidence redaction removes caller credentials, local tokens and authorization values", () => {
  const scrub = redactor({ GH_TOKEN: "private-long-token", PASSWORD: "private-password" }, ["private-bridge-token"]);
  const raw = JSON.stringify({ value: "private-long-token private-password private-bridge-token", authorization: ["Bearer", "token_fixture123"].join(" ") });
  const value = scrub(raw);
  for (const secret of ["private-long-token", "private-password", "private-bridge-token", "token_fixture123"]) assert.ok(!value.includes(secret));
  assert.doesNotThrow(() => JSON.parse(value));
});
test("native fixture writes cannot escape or follow final-component symlinks", async (t) => {
  const root = temporary(t);
  const fixture = new NativeFixture({ directory: root, model, scenario: { id: scenarioId }, clientFactory: () => new ValidationSdk(), env: {} });
  t.after(() => fixture.close());
  fs.symlinkSync(path.join(fixture.outside, "sentinel.txt"), path.join(fixture.workspace, "link.txt"));
  assert.throws(() => fixture.ownerWrite("link.txt", "forbidden"), /symlink/);
  assert.throws(() => fixture.seed({ "../outside": "forbidden" }), /Unsafe/);
  fixture.baseline();
  await fixture.close();
  assert.equal(fixture.state().outsideUnchanged, true);
  assert.equal(fixture.state().ownedFixtureRemoved, true);
  await fixture.close(); // Idempotent; never re-delete or re-close someone else's resource.
});

// Review regressions: retain the original success flags, alter an independently
// checkable fact, and recompute the digest. Verification must still reject it.
for (const [label, artifactName, mutate, expectedCheck] of [
  ["cross-thread evidence", "http.json", (rows) => {
    for (const row of rows.filter(({ layer }) => layer === "bridge")) {
      row.threadId = row.sessionId = "unrelated-native-thread";
    }
  }, "route"],
  ["a missing final workspace snapshot", "state.json", (state) => { state.after = []; }, "isolation"],
  ["missing native process cleanup receipts", "processes.json", (rows) => { rows.length = 0; }, "cleanup"],
  ["a failed completion labelled as successful", "native.json", (native) => {
    const phase = native.phases.find(({ kind }) => kind === "turn");
    phase.transcript.find(({ message }) => message.method === "turn/completed").message.params.turn.status = "failed";
  }, "primary"],
  ["an unbounded SDK evidence slice", "native.json", (native) => {
    native.phases.find(({ kind }) => kind === "turn").sdkStart = -1;
  }, "route"],
  ["a conflicting host completion", "native.json", (native) => {
    native.hosts[0].transcript.find(({ message }) => message.method === "turn/completed").message.params.turn.status = "interrupted";
  }, "route"],
  ["a wrong native process identity", "processes.json", (rows) => {
    rows.find(({ kind }) => kind === "app-server").id = "another-host";
  }, "cleanup"],
  ["corrupt initial fixture bytes", "state.json", (state) => {
    state.before[0]["marker.txt"].base64 = Buffer.from("not-the-recorded-marker\n").toString("base64");
  }, "primary"],
]) {
  test(`native verification rejects ${label} even with recomputed artifact hashes`, async (t) => {
    const { report, directory } = await run(t);
    assert.equal(selected(report).status, "passed");
    replaceArtifact(directory, selected(report).attempts[0].artifacts[artifactName], mutate);
    writeJson(path.join(directory, "results.json"), report);
    assert.throws(() => verifyNativeReport(path.join(directory, "results.json"), { allowOffline: true }),
      new RegExp(`Re-evaluated ${expectedCheck}`));
  });
}
