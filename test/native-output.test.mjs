import assert from "node:assert/strict";
import test from "node:test";
import { reviewFindings, gitDiffCommand } from "../scripts/compatibility/native-output.mjs";
import { NATIVE_SCENARIOS } from "../scripts/compatibility/catalog.mjs";
import { evaluate } from "../scripts/compatibility/oracles.mjs";
import { syntheticEvidence } from "./helpers/core-evidence.mjs";

const scenario = id => NATIVE_SCENARIOS.find(s => s.id === id);
const failures = (id, evidence) => evaluate(scenario(id), evidence).filter(c => !c.passed);
const itemRow = (e, type) => e.native.find(r => r.message?.method === "item/completed" && r.message.params?.item?.type === type);
const renderedReview = (file = "/owned/review.mjs", range = "3-3") =>
  `The loop has an off-by-one error.\n\nReview comment:\n\n- [P1] Stop at the last array element — ${file}:${range}\n  The <= comparison reads items[items.length], which is undefined and makes the sum NaN.`;

function insertBeforePlan(e, record) {
  const index = e.native.indexOf(itemRow(e, "plan"));
  e.native.splice(index, 0, record);
  e.phases.find(p => p.label === "plan").end++;
}

test("review parser accepts native rendered findings and JSON without inventing findings", () => {
  const text = renderedReview("/owned repo/한글/review.mjs");
  const findings = reviewFindings(text);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, "/owned repo/한글/review.mjs");
  assert.equal(findings[0].start, 3);
  assert.equal(findings[0].end, 3);
  assert.match(findings[0].text, /undefined/);
  const json = JSON.stringify({ findings: [{ title: "Bounds error", body: "Reads undefined.", code_location: {
    absolute_file_path: "/owned/review.mjs", line_range: { start: 3, end: 3 },
  } }] });
  assert.equal(reviewFindings(json).length, 1);
  assert.deepEqual(reviewFindings(`\`\`\`json\n${json}\n\`\`\``), reviewFindings(json));
  for (const invalid of [undefined, null, {}, "", "No findings.", "review.mjs:3-3 has a bounds error",
    '{"findings":[]}', '{"findings":null}', '[{"path":"review.mjs"}]', '{broken JSON}',
    text.replace("[P1]", "[P99]"), text.replace(":3-3", ":unknown")]) {
    assert.deepEqual(reviewFindings(invalid), [], String(invalid));
  }
});

test("C12 credits a native text review, not only a model JSON string", () => {
  const e = syntheticEvidence("C12");
  itemRow(e, "exitedReviewMode").message.params.item.review = renderedReview();
  assert.deepEqual(failures("C12", e), []);
});

test("C12 rejects wrong locations, extra findings, unrelated turns and missing diff evidence", () => {
  const mutations = [
    e => { itemRow(e, "exitedReviewMode").message.params.item.review = renderedReview("/other/review.mjs"); },
    e => { itemRow(e, "exitedReviewMode").message.params.item.review = renderedReview("/owned/review.mjs", "1-1"); },
    e => { itemRow(e, "exitedReviewMode").message.params.item.review = `${renderedReview()}\n\n${renderedReview("/owned/innocent.mjs")}`; },
    e => { itemRow(e, "exitedReviewMode").message.params.threadId = "other-thread"; },
    e => { itemRow(e, "exitedReviewMode").message.params.turnId = "other-turn"; },
    e => { itemRow(e, "commandExecution").message.params.item.command = "printf 'git diff'"; },
    e => { itemRow(e, "commandExecution").message.params.item.aggregatedOutput = "no actual diff"; },
    e => { itemRow(e, "commandExecution").message.params.threadId = "other-thread"; },
    e => { e.native.find(r => r.message.params?.item?.type === "enteredReviewMode").message.method = "unrelated"; },
  ];
  for (const mutate of mutations) {
    const e = syntheticEvidence("C12");
    itemRow(e, "exitedReviewMode").message.params.item.review = renderedReview();
    mutate(e);
    assert.ok(failures("C12", e).length > 0, String(mutate));
  }
});

test("C13 consumes the authoritative completed Plan even without an agentMessage", () => {
  const e = syntheticEvidence("C13");
  assert.ok(!e.native.some(r => r.message.params?.item?.type === "agentMessage"));
  assert.deepEqual(failures("C13", e), []);
  insertBeforePlan(e, { direction: "receive", message: { method: "item/completed", params: {
    threadId: "t1", turnId: "turn-1", item: { type: "agentMessage", text: "Preparing the plan." },
  } } });
  assert.deepEqual(failures("C13", e), []);
});

test("C13 permits read-only exploration, not writes or broad permission grants", () => {
  const e = syntheticEvidence("C13");
  insertBeforePlan(e, { direction: "receive", message: { method: "item/completed", params: {
    threadId: "t1", turnId: "turn-1", item: { type: "commandExecution", id: "inspect", command: "git status --short", exitCode: 0, aggregatedOutput: " M user-dirty.txt", status: "completed" },
  } } });
  assert.deepEqual(failures("C13", e), []);
  e.phases[0].result.sandbox.type = "workspaceWrite";
  assert.ok(failures("C13", e).some(c => c.id === "C13.2"));
});

test("C13 cannot pass using a wrong Plan event, uncorrelated answer, or unsafe policy", () => {
  const mutations = [
    e => { itemRow(e, "plan").message.params.item.type = "agentMessage"; },
    e => { itemRow(e, "plan").message.method = "item/started"; },
    e => { itemRow(e, "plan").message.params.threadId = "other-thread"; },
    e => { itemRow(e, "plan").message.params.turnId = "other-turn"; },
    e => { itemRow(e, "plan").message.params.item.text = "Plan without the actual user answer"; },
    e => { e.transport[0].request.input[0].call_id = "unrelated-tool"; },
    e => { e.phases[0].result.sandbox.networkAccess = true; },
    e => { e.approvals.push({ decision: "accept" }); },
    e => { e.logicalPrompts.push(e.fixture.secrets.guide); },
    e => { insertBeforePlan(e, { direction: "receive", message: { method: "item/completed", params: { threadId: "t1", turnId: "turn-1", item: { type: "fileChange", status: "completed" } } } }); },
    e => { const p = itemRow(e, "plan"); e.native.splice(e.native.indexOf(p), 1); e.native.unshift(p); },
    e => { const p = structuredClone(itemRow(e, "plan")); p.message.params.item.text = "Later plan lost the answer"; e.native.splice(e.native.length - 1, 0, p); e.phases.find(p => p.label === "plan").end++; },
  ];
  for (const mutate of mutations) {
    const e = syntheticEvidence("C13"); mutate(e);
    assert.ok(failures("C13", e).length > 0, String(mutate));
  }
});

test("Git evidence recognizes grouped shell invocations but not quoted command text", () => {
  for (const command of [
    'git diff;', 'pwd;git diff;rg --files', 'git -c color.ui=false diff -- review.mjs',
    '/bin/zsh -lc "pwd; git diff; rg -n targetPrice src"',
    "/bin/bash -c 'git --no-pager -C \"/owned repo\" diff -- review.mjs'",
    "GIT_PAGER=cat git diff", "git -c alias.note='echo x; git status' diff", "git diff\nwc -c empty.txt",
  ]) assert.equal(gitDiffCommand(command), true, command);
  for (const command of [
    "echo 'git diff'", "printf '%s' 'x; git diff'", '/bin/zsh -lc "echo git diff"',
    "git status -- 'git diff'", "git -c alias.note='git diff' status", "notgit diff", "git -c", "git 'diff",
  ]) assert.equal(gitDiffCommand(command), false, command);
});
