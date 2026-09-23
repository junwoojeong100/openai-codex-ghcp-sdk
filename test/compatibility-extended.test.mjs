import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NATIVE_SCENARIOS, NATIVE_SCENARIO_CATALOG as C, TOTAL_CASES } from "../scripts/compatibility/catalog.mjs";
import { validateDesign } from "../scripts/compatibility/design.mjs";
import { evaluate, diagnosticMetrics, gitDiffCommand } from "../scripts/compatibility/oracles.mjs";
import { newReport, summarize, verifyReport } from "../scripts/compatibility/report.mjs";
import { syntheticEvidence } from "./helpers/core-evidence.mjs";
const scenario = id => NATIVE_SCENARIOS.find(s => s.id === id);
const failed = (id, evidence) => evaluate(scenario(id), evidence).filter(c => !c.passed);

const mutations = {
  C11: [e => { e.launcher.args.push('-c', 'model_catalog_json="injected"'); }, e => { e.launcher.bridgeGone = false; }, e => { e.launcher.metadata.executionKind = "live"; }],
  C12: [e => { e.native = e.native.filter(r => r.message?.method !== "review/start"); }, e => { e.native.find(r => r.message.params?.item?.type === "exitedReviewMode").message.params.item.review = '{"findings":[]}'; }],
  C13: [e => { e.clarifications[0].params.turnId = "wrong"; }, e => { e.native = e.native.filter(r => r.message.method !== "item/tool/requestUserInput"); }, e => { e.transport[0].request.input = []; }],
  C14: [e => { e.native = e.native.filter(r => r.message.params?.item?.type !== "contextCompaction"); }, e => { e.restart.sdkOffset = e.sdk.length; }, e => { e.native.find(r => r.message.params?.input?.[0]?.text?.length > 12000).message.params.input = []; }],
  C15: [e => { e.interruption.processGone = false; }, e => { delete e.interruption.hostPid; }, e => { e.interruption.hostPid = 1; }, e => { e.native.find(r => r.message.method === "turn/interrupt").message.params.turnId = "wrong"; }, e => { e.phases.find(p => p.label === "interrupt").result.status = "completed"; }],
  C16: [e => { e.mcp.unauthenticatedStatus = 200; }, e => { e.mcp.ledger.find(r => r.event === "request").authenticated = false; }, e => { e.mcp.ledger.find(r => r.event === "request").token = "must-not-record"; }],
  C17: [e => { e.native = e.native.filter(r => r.message.params?.item?.tool !== "closeAgent"); }, e => { e.native.find(r => r.message.params?.item?.tool === "wait").message.params.item.agentsStates.child.status = "running"; }],
  C18: [e => { e.transport[1].request.input.push({ type: "message", content: "changed retry" }); }, e => { e.sdk.push({ type: "session.send", sessionId: "s1" }); }, e => { e.retry.requestedFailures = 2; }],
};
for (const [id, changes] of Object.entries(mutations)) test(`${id}: removing native evidence or changing a critical receipt fails closed`, () => {
  assert.deepEqual(failed(id, syntheticEvidence(id)), []);
  for (const change of changes) { const e = syntheticEvidence(id); change(e); assert.ok(failed(id, e).length > 0, `${id}: ${change}`); }
});
test("C03 treats JSON fencing as presentation but still requires correct semantic types", () => {
  const e = syntheticEvidence("C03"), message = e.native.findLast(r => r.message.params?.item?.type === "agentMessage").message.params.item;
  message.text = `\`\`\`json\n${message.text}\n\`\`\``;
  assert.deepEqual(failed("C03", e), []); assert.equal(diagnosticMetrics(scenario("C03"), e).answerPresentation, "fenced-json");
  message.text = message.text.replace('"empty":true', '"empty":"empty.txt"'); assert.ok(failed("C03", e).some(c => c.id === "C03.1"));
});
test("Git diff evidence supports real global options without crediting echo or another command", () => {
  for (const cmd of ["git diff -- review.mjs", "git -c color.ui=false diff -- review.mjs", "git --no-pager -C '/owned repo' diff", "/bin/zsh -lc 'git -c color.ui=false diff -- review.mjs'", "cat x; git diff"]) assert.equal(gitDiffCommand(cmd), true, cmd);
  for (const cmd of ["echo git diff", "git status", "printf 'git diff'", "git -c color.ui=false status"]) assert.equal(gitDiffCommand(cmd), false, cmd);
});
test("tool efficiency targets are diagnostic; a separate hard safety limit still fails", () => {
  const e = syntheticEvidence("C04"), s = scenario("C04");
  const command = { direction: "receive", message: { method: "item/completed", params: { item: { type: "commandExecution", command: "true", exitCode: 0, status: "completed" } } } };
  for (let i=0; i<s.targetToolCalls; i++) e.native.push(structuredClone(command));
  assert.equal(diagnosticMetrics(s,e).efficiencyTargetExceeded, true); assert.deepEqual(failed("C04", e), []);
  for (let i=0; i<s.maxToolCalls; i++) e.native.push(structuredClone(command));
  assert.ok(failed("C04",e).some(c=>c.id==="tool-budget"));
});
test("unexpected HTTP failures are never excused by the dedicated retry scenario", () => {
  for (const id of ["C01", "C03", "C18"]) {
    const e=syntheticEvidence(id); e.transport.push({ ...e.transport.at(-1), status: 503, responseText: "unexpected" });
    assert.ok(failed(id,e).length > 0);
  }
});
test("checklist, model pass rate and measured product coverage remain separate", () => {
  const plan=validateDesign(); assert.equal(plan.coverage.checklist.total,20);
  assert.equal(plan.coverage.checklist.officialMetric,false); assert.equal(plan.coverage.checklist.usageWeighted,false);
  assert.equal(plan.coverage.checklist.designPercent,75); assert.equal(plan.coverage.measuredPercent,null);
  const copy=structuredClone(C); copy.coverage.checklist[0].scenarios.push("C99"); assert.throws(()=>validateDesign(copy));
  const report=newReport({runId:"unit",executionKind:"offline-self-test"});
  Object.assign(report,{finishedAt:new Date().toISOString(),implementationUnchanged:true,userSettingsUnchanged:true}); report.cases.forEach(c=>c.status="passed");
  assert.equal(summarize(report).fullMatrixPassed,false);
  assert.ok(summarize(report).featureVerdicts.every(f=>f.perModel.every(m=>m.outcome==="not-established")));
  report.executionKind="live"; report.cases.find(c=>c.scenarioId==="C12").status="unsupported";
  const summary=summarize(report); assert.equal(summary.totalCases,TOTAL_CASES); assert.equal(summary.fullMatrixPassed,false);
  assert.equal(summary.measuredCoveragePercent,null); assert.equal(summary.designChecklist.designPercent,75);
  assert.equal(summary.featureVerdicts.find(f=>f.id==="git-review").perModel[0].outcome,"not-established");
});
test("old reports cannot be silently regraded against the expanded contract", t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"historical-contract-")); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,"report.json"); fs.writeFileSync(file,JSON.stringify({schemaVersion:2,catalogId:"codex-ghcp-workflows-10-v2"}));
  assert.throws(()=>verifyReport(file),/Historical report/);
});

test("C17 separates child reads from parent actions and requires both correlated results", () => {
  const changes = [
    e => { e.native.find(r => r.message.params?.item?.type === "commandExecution").message.params.threadId = "t1"; },
    e => { e.native = e.native.filter(r => r.message.params?.item?.type !== "commandExecution"); },
    e => { e.native = e.native.filter(r => !(r.message.params?.threadId === "t1" && r.message.params?.item?.type === "agentMessage")); },
    e => { e.transport[0].request.input[0].call_id = "unrelated-read"; },
    e => { e.transport[0].request.input[1].call_id = "unrelated-wait"; },
    e => { e.sdk.find(r => r.type === "assistant.message" && r.sessionId === "s2").sessionId = "s1"; },
    e => { e.native.find(r => r.message.params?.item?.tool === "wait").message.params.threadId = "other-parent"; },
  ];
  assert.deepEqual(failed("C17", syntheticEvidence("C17")), []);
  for (const change of changes) {
    const e = syntheticEvidence("C17"); change(e);
    assert.ok(failed("C17", e).length > 0, String(change));
  }
});

test("invalid matrices cannot establish per-feature evidence", () => {
  const report = newReport({ runId: "matrix-regression" });
  Object.assign(report, { finishedAt: new Date().toISOString(), implementationUnchanged: true, userSettingsUnchanged: true });
  report.cases.forEach(row => { row.status = "passed"; });
  assert.equal(summarize(report).fullMatrixPassed, true);
  assert.ok(summarize(report).featureVerdicts.some(feature => feature.perModel.some(row => row.outcome === "scenario-evidence-passed")));
  for (const mutate of [
    r => { r.cases.pop(); },
    r => { r.cases[r.cases.length - 1] = structuredClone(r.cases[0]); },
    r => { r.cases[0].provider = "other-provider"; },
    r => { r.interrupted = true; },
    r => { r.implementationUnchanged = false; },
  ]) {
    const invalid = structuredClone(report); mutate(invalid);
    const result = summarize(invalid);
    assert.equal(result.fullMatrixPassed, false);
    assert.ok(result.featureVerdicts.every(feature => feature.perModel.every(row => row.outcome === "not-established")));
  }
});
