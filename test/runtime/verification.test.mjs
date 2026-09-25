import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "../../scripts/verification/catalog.mjs";
import { runCase } from "../../scripts/verification/worker.mjs";
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
