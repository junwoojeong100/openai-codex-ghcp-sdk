import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { CATALOG, SCENARIOS } from "../../scripts/verification/catalog.mjs";
import { runCase } from "../../scripts/verification/worker.mjs";
import { TuiSession } from "../../scripts/verification/session.mjs";
import { evaluate, runScenario } from "../../scripts/verification/scenarios.mjs";
import { sha } from "../../scripts/verification/util.mjs";

const cases = SCENARIOS.flatMap(scenario => (scenario.id === "V04" ? ["claude-haiku-4.5", "gpt-6-sol"] : ["gpt-6-astra"]).map(model => ({ scenario, model })));
for (const { scenario, model } of cases) test(`${scenario.id}/${model}: essential workflow through the real launcher and PTY with an SDK double`, { timeout: scenario.seconds * 1000 }, async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "essential-runtime-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "evidence");
  const result = await runCase({ directory, workRoot: path.join(root, "work"),
    model, scenarioId: scenario.id, seed: "0a1b2c3d",
    executionKind: "offline-self-test", runId: "runtime", catalogHash: "runtime", implementationHash: "runtime",
    preload: fileURLToPath(new URL("../fixtures/tui-sdk.mjs", import.meta.url)) });
  const facts = JSON.parse(fs.readFileSync(path.join(directory, "facts.json"), "utf8"));
  assert.deepEqual(result.checks.filter(check => !check.passed).map(check => check.id), ["mcp-isolation"], JSON.stringify({ result, facts }));
  assert.equal(facts.evidence.samples.maxRuntimes, 0);
  assert.deepEqual(facts.evidence.leftovers, []);
  assert.deepEqual(facts.evidence.catalogLeft, []);
  if (scenario.id === "V02") {
    assert.deepEqual(facts.baseline.workspace, facts.before);
    assert.equal(facts.baseline.rollout.patchApplies, 0);
    assert.ok(facts.baseline.rollout.commands.some(command => command.exitCode === 1 && /# fail 2\b/.test(command.output)));
    assert.equal(facts.answers.length, 2);
    assert.deepEqual(facts.evidence.rollout.commands.slice(0, facts.baseline.rollout.commands.length), facts.baseline.rollout.commands);
    const repairCommands = facts.evidence.rollout.commands.slice(facts.baseline.rollout.commands.length);
    assert.ok(repairCommands.some(command => /cat sample\.txt/.test(command.command) && facts.evidence.rollout.toolResults.some(result =>
      result.callId === command.callId && result.output.includes(facts.answers[1].expected))),
      JSON.stringify({ expectedSample: facts.answers[1].expected, repairCommands }));
    assert.equal(facts.answers[1].observed.at(-1), facts.answers[1].expected);
    const received = facts.observer.http.flatMap(row => row.toolResults ?? []);
    const requests = facts.observer.sdk.filter(row => row.type === "external_tool.requested");
    const submissions = facts.observer.sdk.filter(row => row.type === "tool.submit");
    assert.ok(submissions.length > 0);
    for (const submission of submissions) {
      const pending = requests.find(row => row.sessionId === submission.sessionId && row.requestId === submission.requestId);
      assert.ok(pending);
      assert.ok(received.some(row => row.callId === pending.callId && row.resultHash === submission.resultHash && row.resultBytes === submission.resultBytes));
      assert.ok(facts.evidence.rollout.toolResults.some(row => row.callId === pending.callId
        && sha(row.output) === submission.resultHash && Buffer.byteLength(row.output) === submission.resultBytes));
    }
  }
  for (const launch of facts.evidence.launches) {
    const dir = path.join(directory, launch.label);
    assert.ok(launch.screenshots.some(image => image.label.startsWith("answer-")));
    assert.ok(launch.media.video.bytes > 1000);
    for (const artifact of [launch.media.video, launch.media.screenshot, ...launch.screenshots]) {
      const bytes = fs.readFileSync(path.join(dir, artifact.file));
      assert.equal(bytes.length, artifact.bytes);
      assert.equal(sha(bytes), artifact.sha256);
      if (artifact.file.endsWith(".png")) assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      else assert.equal(bytes.subarray(0, 4).toString("hex"), "1a45dfa3");
    }
  }
  assert.equal(fs.existsSync(path.join(root, "work", "owned")), false);
});

test("a cached newer Codex release cannot trigger an update during pinned startup or cold resume", { timeout: 120000 }, async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pinned-update-runtime-")));
  const directory = path.join(root, "evidence"), model = "gpt-6-astra", seed = "0a1b2c3d";
  const session = new TuiSession({ directory, model, ownedRoot: path.join(root, "owned"), executionKind: "offline-self-test",
    preload: fileURLToPath(new URL("../fixtures/tui-sdk.mjs", import.meta.url)) });
  t.after(async () => {
    try { await session.closeLaunch(); await session.close(); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  const versionFile = path.join(session.codexHome, "version.json");
  const cached = JSON.stringify({ latest_version: "999.0.0", last_checked_at: new Date().toISOString(), dismissed_version: null }) + "\n";
  fs.writeFileSync(versionFile, cached);
  const submit = session.submit.bind(session);
  session.submit = async prompt => {
    assert.doesNotMatch(session.screen(), /Update available!/, "Never send Enter to an updater, even when testing a regression");
    await submit(prompt);
  };
  const scenario = SCENARIOS.find(row => row.id === "V06"), facts = { answers: [] };
  await runScenario(scenario, session, { model, seed, facts });
  assert.equal(fs.readFileSync(versionFile, "utf8"), cached);
  const evidence = await session.close();
  const checks = evaluate(scenario, model, { ...facts, seed, observer: session.observer(), evidence });
  assert.deepEqual(checks.filter(check => !check.passed).map(check => check.id), ["mcp-isolation"]);
  assert.equal(evidence.launches.length, 2);
  for (const launch of evidence.launches) {
    const ready = launch.screenshots.find(image => image.label === "ready");
    const text = fs.readFileSync(path.join(directory, launch.label, ready.textFile), "utf8");
    const raw = stripVTControlCharacters(fs.readFileSync(path.join(directory, `${launch.label}.raw`), "utf8"));
    assert.ok(raw.includes(`OpenAI Codex (v${CATALOG.versions.codex})`), `${launch.label}: the pinned CLI header must appear in the native output`);
    assert.doesNotMatch(text, /Update available!/);
  }
});
