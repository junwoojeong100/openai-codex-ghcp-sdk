import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SCENARIOS, catalogHash } from "../scripts/stability/catalog.mjs";
import { evaluate, failureCategory, metrics } from "../scripts/stability/oracles.mjs";
import { artifacts, implementationHash, readCase } from "../scripts/stability/report.mjs";
import { sha } from "../scripts/compatibility/util.mjs";
import { stabilityEvidence } from "./helpers/stability-evidence.mjs";

const scenario = SCENARIOS[0];
function filtered({ stream = true, origin = "native", code = "upstream_content_filter" } = {}) {
  const evidence = stabilityEvidence("S01");
  const post = evidence.transport.find(row => row.origin === "native");
  Object.assign(post, { origin, status: stream ? 200 : 422,
    responseText: stream ? `event: response.failed\ndata: ${JSON.stringify({ type: "response.failed", response: { error: { code } } })}\n\n`
      : JSON.stringify({ error: { code } }) });
  return evidence;
}

for (const stream of [false, true]) test(`an explicit native filter is classified without changing its failed checks (stream=${stream})`, () => {
  const evidence = filtered({ stream }), checks = evaluate(scenario, evidence), before = structuredClone(checks);
  assert.equal(failureCategory(evidence, checks), "upstream-content-filter");
  assert.ok(checks.some(check => !check.passed));
  assert.deepEqual(checks, before);
});

test("expected injected failures and passing cases do not become upstream failures", () => {
  for (const scenario of SCENARIOS) {
    const evidence = stabilityEvidence(scenario.id), checks = evaluate(scenario, evidence);
    assert.equal(failureCategory(evidence, checks), null, scenario.id);
  }
});

test("filter-looking text, SDK hints and control requests cannot invent an upstream cause", () => {
  const checks = [{ id: "transport-outcomes", passed: false }];
  const evidence = stabilityEvidence("S01");
  evidence.diagnostics.push({ event: "bridge.upstream_content_filter" });
  evidence.transport[0].responseText = 'data: {"type":"response.output_text.delta","delta":"upstream_content_filter"}\n\n';
  assert.equal(failureCategory(evidence, checks), null);
  evidence.transport[0].responseText = JSON.stringify({ error: { code: "upstream_content_filter" } });
  assert.equal(failureCategory(evidence, checks), null, "a 200 JSON body is not a failed response");
  for (const origin of ["control-policy", "control-duplicate", "control-cancelled"]) {
    assert.equal(failureCategory(filtered({ origin }), checks), null);
  }
  assert.equal(failureCategory(filtered({ code: "private-provider-message" }), checks), null);
});

test("cleanup and literal-output failures remain distinct and fail closed", () => {
  const evidence = filtered();
  evidence.resources.cleaned = false;
  assert.equal(failureCategory(evidence, evaluate(scenario, evidence)), "cleanup");
  const literal = stabilityEvidence("S01");
  const answer = literal.native.findLast(row => row.message.params?.item?.type === "agentMessage");
  answer.message.params.item.text = "Missing the required literal labels";
  const checks = evaluate(scenario, literal);
  assert.deepEqual(checks.filter(check => !check.passed).map(check => check.id), ["final-values"]);
  assert.equal(failureCategory(literal, checks), "literal-output");
});

test("the case verifier checks the failure category against recorded evidence", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stability-category-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const evidence = filtered(), checks = evaluate(scenario, evidence);
  const config = { runId: "category-test", scenarioId: "S01", model: evidence.model, executionKind: "offline-self-test",
    catalogHash: catalogHash(), implementationHash: implementationHash() };
  const manifest = { ...config, durationMs: 1, status: "failed", error: "Native operation failed",
    category: "undetermined", checks, metrics: metrics(evidence), files: {} };
  for (const [name, text] of Object.entries(artifacts(config, evidence, checks, "failed"))) {
    fs.writeFileSync(path.join(directory, name), text);
    manifest.files[name] = { sha256: sha(text), bytes: Buffer.byteLength(text) };
  }
  const save = () => fs.writeFileSync(path.join(directory, "result.json"), JSON.stringify(manifest));
  save();
  assert.throws(() => readCase(directory, config), /category/i);
  manifest.category = "upstream-content-filter"; save();
  assert.equal(readCase(directory, config).manifest.status, "failed");
});
