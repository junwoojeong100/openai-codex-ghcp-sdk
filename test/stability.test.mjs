import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CATALOG, SCENARIOS, FLOW, PROMPTS, catalogHash } from "../scripts/stability/catalog.mjs";
import { StabilityExecutor } from "../scripts/stability/execute.mjs";
import { evaluate, metrics } from "../scripts/stability/oracles.mjs";
import { parseArguments } from "../scripts/stability.mjs";
import { newReport, summarize, artifacts, readCase, implementationHash } from "../scripts/stability/report.mjs";
import { sha } from "../scripts/compatibility/util.mjs";
import { stabilityEvidence } from "./helpers/stability-evidence.mjs";

test("stability has a distinct fixed 11-by-6 contract and deliberate live opt-in", () => {
  assert.equal(SCENARIOS.length, 11); assert.equal(CATALOG.models.length, 6); assert.equal(CATALOG.totalCases, 66);
  assert.deepEqual(CATALOG.models, ["claude-opus-5.5", "claude-sonnet-5", "claude-haiku-4.5", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]);
  assert.ok(Object.isFrozen(CATALOG) && Object.isFrozen(CATALOG.scenarios));
  assert.equal(CATALOG.automaticCaseRetries, 0);
  for (const s of SCENARIOS) assert.equal(FLOW[s.id].length, s.turns);
  assert.equal(parseArguments([]).mode, "plan"); assert.equal(parseArguments(["--execute"]).mode, "execute");
  for (const args of [["--execute", "--runtime"], ["--plan", "--output", "x"], ["--models", "gpt-6-astra"], ["--retry"], ["--verify"], ["--execute", "--execute"]]) assert.throws(() => parseArguments(args));
});

test("S03 requires genuinely missing results, not the former complete-result rejection", () => {
  const scenario = SCENARIOS.find(item => item.id === "S03");
  for (const mutation of ["complete-results", "rewritten-history", "old-error-code"]) {
    const evidence = stabilityEvidence("S03");
    const probe = evidence.controls.find(item => item.action === "policy-rejection");
    const control = evidence.transport.find(item => item.origin === "control-policy");
    if (mutation === "complete-results") {
      probe.request.input.push(...evidence.transport.find(item => item.origin === "native").request.input.filter(item => item.type === "function_call_output"));
      control.request = structuredClone(probe.request);
    } else if (mutation === "rewritten-history") {
      probe.request.input[0].content = "unrelated history";
      control.request = structuredClone(probe.request);
    } else probe.response = JSON.stringify({ error: { code: "pending_session_changed" } });
    assert.equal(evaluate(scenario, evidence).find(check => check.id === "S03.reject").passed, false, mutation);
  }
});

test("native fixture metadata describes unchanged plain text for every model and profile", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stability-tool-text-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const content = "label:\uD55C\uAE00\nother:  exact  ";
  const file = path.join(directory, "fixture-data.txt");
  fs.writeFileSync(file, content);
  const descriptions = new Set();
  for (const profile of ["v5", "application-data-v3"]) for (const model of CATALOG.models) {
    const executor = new StabilityExecutor({ model, profile, scenario: SCENARIOS[0] });
    executor.fixture = { cwd: directory, workspace: directory };
    let declaration;
    executor.host = { child: { pid: 123 }, async request(method, params) {
      assert.equal(method, "thread/start"); declaration = params;
      return { model, modelProvider: "ghcp", thread: { id: `${profile}-${model}` } };
    } };
    const threadId = await executor.startThread();
    assert.deepEqual(declaration.dynamicTools.map(tool => tool.name), ["read_fixture", "unused_fixture"]);
    const tool = declaration.dynamicTools[0];
    descriptions.add(tool.description);
    assert.match(tool.description, /entire plain-text contents unchanged/);
    assert.match(tool.description, /not a record of extracted field values/);
    assert.match(tool.description, /labels and separators are part of the file content/);
    assert.deepEqual(tool.inputSchema, { type: "object", properties: {}, additionalProperties: false });
    assert.equal(tool.deferLoading, false);
    const result = await executor.callback({ id: 1, method: "item/tool/call",
      params: { tool: "read_fixture", arguments: {}, threadId, turnId: "turn", callId: "owned-call" } });
    assert.deepEqual(result, { success: true, contentItems: [{ type: "inputText", text: content }] });
    assert.equal(executor.observation.toolLedger.length, 1);
    assert.equal(executor.observation.toolLedger[0].result, content);
  }
  assert.equal(descriptions.size, 1);
  assert.equal(fs.readFileSync(file, "utf8"), content);
});

for (const scenario of SCENARIOS) test(`${scenario.id} requires genuine-shaped evidence and rejects altered identity, native flow, state, values and cleanup`, () => {
  const good = stabilityEvidence(scenario.id);
  assert.deepEqual(evaluate(scenario, good).filter(c => !c.passed), []);
  assert.ok(evaluate(scenario, {}).some(c => !c.passed));
  for (const mutate of [
    e => { e.sdk.find(r => r.type === "assistant.usage").data.model = "wrong"; },
    e => { e.native = []; }, e => { e.transport = []; },
    e => { e.after["user-dirty.txt"].base64 = Buffer.from("changed").toString("base64"); },
    e => { e.resources.backends[0].queued = 1; },
    e => { e.phases.find(p => p.kind === "turn").prompt = "substituted"; },
    e => { const row = e.native.findLast(r => r.message.params?.item?.type === "agentMessage"); row.message.params.item.text = "missing receipt"; },
    e => { e.toolLedger[0].callId = "unknown-call"; },
  ]) { const bad = structuredClone(good); mutate(bad); assert.ok(evaluate(scenario, bad).some(c => !c.passed), String(mutate)); }
});

test("fault-specific evidence is required, not just a successful recovery answer", () => {
  const mutations = {
    S02: e => { e.controls.find(c => c.action === "tools-permuted").after = e.controls.find(c => c.action === "tools-permuted").before; },
    S03: e => { e.controls.find(c => c.action === "policy-rejection").status = 200; },
    S04: e => { e.controls.find(c => c.action === "exact-retry").after.submissions++; },
    S05: e => { e.controls.find(c => c.label === "duplicate-queued").queue = 1; },
    S06: e => { e.controls = e.controls.filter(c => c.action !== "sdk-ack-held"); },
    S07: e => { e.diagnostics = []; },
    S08: e => { const pending = e.sdk.find(s => s.type === "external_tool.requested"); e.sdk.push({ type: "tool.submit", sessionId: pending.sessionId, requestId: pending.data.requestId }); },
    S09: e => { e.controls = e.controls.filter(c => c.action !== "sdk-delta-id-corrupted"); },
    S10: e => { e.phases.find(p => p.kind === "resume").hostPid = 5001; },
    S11: e => { e.compaction.inputBytes = 5; },
  };
  for (const [id, mutate] of Object.entries(mutations)) {
    const e = stabilityEvidence(id); mutate(e);
    assert.ok(evaluate(SCENARIOS.find(s => s.id === id), e).some(c => c.id.startsWith(id + ".") && !c.passed), id);
  }
});

test("offline harness successes never certify live support or remove failing live cells", () => {
  const offline = newReport({ runId: "unit", executionKind: "offline-self-test" });
  Object.assign(offline, { finishedAt: new Date().toISOString(), implementationUnchanged: true, userSettingsUnchanged: true });
  offline.cases.forEach(c => c.status = "passed");
  assert.equal(summarize(offline).offlineHarnessPassed, true); assert.equal(summarize(offline).fullMatrixPassed, false);
  const live = newReport({ runId: "unit", executionKind: "live" });
  Object.assign(live, { finishedAt: new Date().toISOString(), implementationUnchanged: true, userSettingsUnchanged: true });
  live.cases.forEach(c => c.status = "passed"); assert.equal(summarize(live).fullMatrixPassed, true);
  for (const status of CATALOG.statuses.filter(s => s !== "passed")) {
    live.cases[0].status = status; const s = summarize(live); assert.equal(s.totalCases, 66); assert.equal(s.fullMatrixPassed, false);
  }
  live.cases[0].status = "passed"; live.cases.pop(); assert.equal(summarize(live).fullMatrixPassed, false);
});

test("case verifier recomputes checks, metrics and exact artifact projections", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stability-verifier-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const evidence = stabilityEvidence("S01"), scenario = SCENARIOS[0];
  const config = { runId: "synthetic", scenarioId: "S01", model: "gpt-6-astra", executionKind: "offline-self-test", catalogHash: catalogHash(), implementationHash: implementationHash() };
  const checks = evaluate(scenario, evidence), manifest = { ...config, durationMs: 1, status: "passed", error: null, checks, metrics: metrics(evidence), files: {} };
  for (const [name, text] of Object.entries(artifacts(config, evidence, checks, "passed"))) {
    fs.writeFileSync(path.join(directory, name), text); manifest.files[name] = { sha256: sha(text), bytes: Buffer.byteLength(text) };
  }
  const file = path.join(directory, "result.json"), save = () => fs.writeFileSync(file, JSON.stringify(manifest)); save();
  assert.equal(readCase(directory, config).manifest.status, "passed");
  manifest.metrics.sdkPrompts++; save(); assert.throws(() => readCase(directory, config)); manifest.metrics.sdkPrompts--; save();
  fs.appendFileSync(path.join(directory, "native.jsonl"), "{}\n"); assert.throws(() => readCase(directory, config));
});


test("v5 preserves prompts, literal output and budgets while versioning the incomplete S03 policy probe", () => {
  assert.equal(CATALOG.id, "codex-ghcp-stability-11-v5");
  assert.equal(SCENARIOS.find(scenario => scenario.id === "S03").fault, "incomplete-result-control-request");
  assert.match(CATALOG.changesFromV4, /tool_result_mismatch/);
  assert.match(CATALOG.changesFromV3, /Only the model set changes/);
  for (const kind of ["read", "remember", "recall"]) {
    assert.match(PROMPTS[kind], /fenced text code block containing the two original lines/);
    assert.match(PROMPTS[kind], /no added space after either colon/);
  }
  assert.match(PROMPTS.remember, /exactly once in THIS turn/);
  assert.match(PROMPTS.remember, /echo the original two lines NOW/);
  assert.ok(CATALOG.gateReadyTimeoutMs > CATALOG.startupTimeoutMs);
  assert.ok(CATALOG.injectedDeadlineMs > CATALOG.startupTimeoutMs);
  assert.ok(CATALOG.gateTimeoutMs > CATALOG.injectedDeadlineMs);
  assert.equal(CATALOG.cleanupTimeoutMs, 5000);
  assert.ok(CATALOG.cleanupReserveSeconds * 1000 >= 5 * CATALOG.cleanupTimeoutMs);
});


test("fenced presentation is allowed but changed literal prefixes still fail", () => {
  const e = stabilityEvidence("S01"), scenario = SCENARIOS.find(s => s.id === "S01");
  const item = e.native.findLast(r => r.message.params?.item?.type === "agentMessage").message.params.item;
  item.text = "```text\n" + item.text + "\n```";
  assert.equal(evaluate(scenario, e).find(c => c.id === "final-values").passed, true);
  item.text = item.text.replace("value:", "value: ");
  assert.equal(evaluate(scenario, e).find(c => c.id === "final-values").passed, false);
});
