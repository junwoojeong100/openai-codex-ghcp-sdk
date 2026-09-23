import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SUPPORTED_MODEL_IDS } from "../src/model-map.mjs";
import { parseArguments } from "../scripts/tui.mjs";
import { TUI_CATALOG, TUI_SCENARIOS, tuiCatalogHash } from "../scripts/tui/catalog.mjs";
import { evaluate, marker, sessionOptions, switchSource } from "../scripts/tui/scenarios.mjs";
import { TuiSession, pickerRows, readRollouts } from "../scripts/tui/session.mjs";
import { summarizeTui, tuiMatrix, verifyTuiReport } from "../scripts/tui/runner.mjs";
import { sha } from "../scripts/compatibility/util.mjs";

const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tui-test-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const scenario = id => TUI_SCENARIOS.find(s => s.id === id);
const seed = "0a1b2c3d";
function passingFacts(id, model = "gpt-6-astra") {
  const m = n => marker(seed, n), at = 1000;
  const launches = [{ cleanup: { childReaped: true, processGroupGone: true }, childExit: { code: 0 } }];
  const facts = { seed, launchModel: model, seen: [m(1)], error: null, mcpLedger: [],
    observer: { sdk: [{ type: "session.created", model, effort: "low", toolCount: 11, at }, { type: "assistant.usage", model, inputTokens: 100, at: at + 1 }],
      http: [{ method: "POST", requestBytes: 1000, terminal: "response.completed", startedAt: at }], answers: [{ content: m(1), at: at + 2 }] },
    evidence: { samples: { count: 5, maxRuntimes: 1, maxRuntimeMcp: 0, maxCodexMcpFixture: 0 }, launches, leftovers: [], catalogLeft: [],
      rollout: { toolCalls: [], turnContexts: [{ model, effort: "low" }], compactions: 0, patchApplies: 0 } } };
  if (id === "U01") facts.picker = { rows: SUPPORTED_MODEL_IDS.map((model_, i) => ({ number: i + 1, id: model_, selected: model_ === model, isCurrent: model_ === model, isDefault: i === 0 })), forbidden: 0 };
  return facts;
}

test("the TUI contract is a fixed 12-by-6 Playwright matrix with no subset or retry option", () => {
  assert.equal(TUI_CATALOG.id, "codex-ghcp-tui-12-v1");
  assert.equal(TUI_SCENARIOS.length, 12);
  assert.deepEqual(TUI_SCENARIOS.map(s => s.id), Array.from({ length: 12 }, (_, i) => `U${String(i + 1).padStart(2, "0")}`));
  assert.deepEqual(TUI_CATALOG.models, SUPPORTED_MODEL_IDS);
  assert.equal(TUI_CATALOG.totalCases, 72);
  assert.equal(TUI_CATALOG.automaticCaseRetries, 0);
  assert.equal(TUI_CATALOG.driver, "playwright-headless-xterm");
  assert.ok(Object.isFrozen(TUI_CATALOG) && Object.isFrozen(TUI_SCENARIOS[0]));
  assert.match(tuiCatalogHash(), /^[0-9a-f]{64}$/);
  assert.equal(tuiMatrix().length, 72);
  assert.deepEqual(parseArguments([]), { mode: "plan" });
  assert.deepEqual(parseArguments(["--execute", "--output", "x"]), { mode: "execute", output: "x" });
  assert.deepEqual(parseArguments(["--verify", "r.json"]), { mode: "verify", file: "r.json" });
  for (const args of [["--models", "gpt-6-luna"], ["--retry"], ["--plan", "--execute"], ["--output", "x"], ["--execute", "--execute"], ["--verify"]]) {
    assert.throws(() => parseArguments(args));
  }
});

test("scenario options pin sandboxes, the switch source model and an approved Codex-side MCP fixture", t => {
  const root = temp(t);
  assert.equal(sessionOptions(scenario("U04"), "gpt-6-sol", { ownedRoot: root, seed }).sandbox, "workspace-write");
  assert.equal(sessionOptions(scenario("U02"), "gpt-6-sol", { ownedRoot: root, seed }).model, "gpt-6-astra");
  assert.equal(switchSource("gpt-6-astra"), "gpt-6-luna");
  const mcp = sessionOptions(scenario("U05"), "claude-sonnet-5", { ownedRoot: root, seed });
  assert.equal(mcp.mcpFixture.nonce, marker(seed, 1));
  assert.match(mcp.codexArgs[1], /^mcp_servers\.fixture=\{.*default_tools_approval_mode="approve" \}$/);
  assert.equal(marker(seed, 12), "TUI_0a1b2c3d_000012");
});

test("picker parsing reads only numbered supported rows and the bottom helper skips blank terminal rows", () => {
  const text = ["│ model:     gpt-6-astra   /model to change │", "  Select Model and Effort", "  1. claude-opus-5.5 (default)", "  2. claude-sonnet-5",
    "  3. claude-haiku-4.5", "› 4. gpt-6-astra (current)", "  5. gpt-6-sol", "  6. gpt-6-luna", "  7. gpt-5.6-sol", "", "", ""].join("\n");
  const rows = pickerRows(text, SUPPORTED_MODEL_IDS);
  assert.deepEqual(rows.map(r => r.id), SUPPORTED_MODEL_IDS);
  assert.equal(rows.find(r => r.selected).id, "gpt-6-astra");
  assert.equal(rows.find(r => r.isCurrent).id, "gpt-6-astra");
  assert.equal(rows.find(r => r.isDefault).id, "claude-opus-5.5");
  assert.equal(TuiSession.bottom("a\nb\nc\n\n\n", 2), "b\nc");
});

test("rollout evidence records tool names, shell-intercepted apply_patch, file changes, compaction and turn context only", t => {
  const home = temp(t), dir = path.join(home, "sessions", "2026", "09", "23");
  fs.mkdirSync(dir, { recursive: true });
  const rows = [
    { type: "turn_context", payload: { model: "gpt-6-sol", effort: "high" } },
    { type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "cat notes/token.txt" }) } },
    { type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: JSON.stringify({ cmd: "apply_patch <<'EOF'\n*** Begin Patch" }) } },
    { type: "event_msg", payload: { type: "item_completed", item: { type: "FileChange", status: "completed" } } },
    { type: "compacted", payload: {} },
    { type: "event_msg", payload: { type: "mcp_tool_call_end", invocation: { server: "fixture", tool: "lookup" } } },
  ];
  fs.writeFileSync(path.join(dir, "rollout-test.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\nnot json\n");
  const summary = readRollouts(home);
  assert.deepEqual(summary.toolCalls.map(c => c.name), ["exec_command", "apply_patch", "fixture.lookup"]);
  assert.equal(summary.patchApplies, 1);
  assert.equal(summary.compactions, 1);
  assert.deepEqual(summary.turnContexts, [{ model: "gpt-6-sol", effort: "high" }]);
  assert.ok(!JSON.stringify(summary).includes("notes/token.txt"));
});

test("common checks fail on wrong routing, upstream filters, runtime MCP processes or incomplete cleanup", () => {
  const passing = evaluate(scenario("U01"), "gpt-6-astra", passingFacts("U01"));
  assert.ok(passing.every(c => c.passed), JSON.stringify(passing.filter(c => !c.passed)));
  for (const [mutate, id] of [
    [f => { f.observer.sdk[1].model = "gpt-6-luna"; }, "routing"],
    [f => { f.observer.sdk[1].finishReason = "content_filter"; }, "upstream"],
    [f => { f.observer.http[0].terminal = "response.failed"; }, "upstream"],
    [f => { f.evidence.samples.maxRuntimeMcp = 3; }, "mcp-isolation"],
    [f => { f.evidence.samples.count = 0; }, "mcp-isolation"],
    [f => { f.evidence.launches[0].cleanup.processGroupGone = false; }, "cleanup"],
    [f => { f.evidence.catalogLeft = ["codex-ghcp-models-x"]; }, "cleanup"],
    [f => { f.evidence.leftovers = [123]; }, "cleanup"],
    [f => { f.picker.rows.push({ number: 7, id: "gpt-6-luna" }); }, "U01.picker"],
    [f => { f.picker.forbidden = 1; }, "U01.picker"],
    [f => { f.seen = []; }, "U01.reply"],
  ]) {
    const facts = structuredClone(passingFacts("U01")); mutate(facts);
    assert.equal(evaluate(scenario("U01"), "gpt-6-astra", facts).find(c => c.id === id).passed, false, id);
  }
});

test("tool, compaction, effort and isolation scenarios require their own recorded evidence", () => {
  const m = n => marker(seed, n);
  const u04 = passingFacts("U04"); u04.seen = [m(2)]; u04.fileContent = `${m(1)}\n`;
  u04.observer.sdk.push({ type: "external_tool.requested", toolName: "ghcp_x", at: 1001 });
  u04.evidence.rollout.patchApplies = 1;
  assert.ok(evaluate(scenario("U04"), "gpt-6-astra", u04).every(c => c.passed));
  u04.evidence.rollout.patchApplies = 0;
  assert.equal(evaluate(scenario("U04"), "gpt-6-astra", u04).find(c => c.id === "U04.patch").passed, false);

  const u11 = passingFacts("U11"); u11.seen = [m(1), m(2)]; u11.effortPopup = true; u11.effortOptions = ["Low", "Medium", "High"];
  u11.evidence.rollout.turnContexts.push({ model: "gpt-6-astra", effort: "high" });
  u11.observer.sdk.push({ type: "session.setModel", model: "gpt-6-astra", effort: "high", at: 1003 });
  assert.ok(evaluate(scenario("U11"), "gpt-6-astra", u11).every(c => c.passed));
  u11.observer.sdk.pop();
  assert.equal(evaluate(scenario("U11"), "gpt-6-astra", u11).find(c => c.id === "U11.effort").passed, false);
  const haiku = passingFacts("U11", "claude-haiku-4.5"); haiku.seen = [m(1), m(2)]; haiku.effortPopup = false; haiku.modelChangedLine = "• Model changed to claude-haiku-4.5";
  haiku.evidence.rollout.turnContexts = [{ model: "claude-haiku-4.5", effort: null }];
  assert.ok(evaluate(scenario("U11"), "claude-haiku-4.5", haiku).every(c => c.passed));

  const u12 = passingFacts("U12"); u12.seen = [m(2), m(3)]; u12.newThread = true; u12.newAt = 2000; u12.quitExited = true;
  u12.observer.sdk.push({ type: "session.created", model: "gpt-6-astra", toolCount: 11, at: 2001 });
  u12.observer.answers.push({ content: m(3), at: 2002 });
  assert.ok(evaluate(scenario("U12"), "gpt-6-astra", u12).every(c => c.passed));
  u12.observer.answers.push({ content: `The code was ${m(1)}`, at: 2003 });
  assert.equal(evaluate(scenario("U12"), "gpt-6-astra", u12).find(c => c.id === "U12.isolation").passed, false);
});

test("the verifier recomputes checks from saved facts and rejects tampered evidence or foreign contracts", t => {
  const dir = temp(t), report = { catalogId: TUI_CATALOG.id, catalogHash: tuiCatalogHash(), runId: "run", executionKind: "live",
    finishedAt: "x", implementationUnchanged: true, frozenSourceUnchanged: true, userSettingsUnchanged: true, cases: tuiMatrix() };
  const row = report.cases.find(r => r.scenarioId === "U01" && r.model === "gpt-6-astra"), facts = passingFacts("U01", row.model), relative = `cases/${row.model}/${row.scenarioId}`;
  fs.mkdirSync(path.join(dir, relative), { recursive: true });
  const factsText = JSON.stringify(facts), checks = evaluate(scenario("U01"), row.model, facts);
  const result = { runId: "run", model: row.model, scenarioId: "U01", seed, status: "passed", checks, factsHash: sha(factsText) };
  fs.writeFileSync(path.join(dir, relative, "facts.json"), factsText);
  fs.writeFileSync(path.join(dir, relative, "result.json"), JSON.stringify(result));
  Object.assign(row, { status: "passed", seed, artifactPath: relative, resultHash: sha(fs.readFileSync(path.join(dir, relative, "result.json"))) });
  const file = path.join(dir, "report.json");
  fs.writeFileSync(file, JSON.stringify(report));
  const verified = verifyTuiReport(file);
  assert.equal(verified.evidenceIntegrity, true);
  assert.equal(verified.passed, 1);
  assert.equal(verified.fullMatrixPassed, false);
  facts.evidence.samples.maxRuntimeMcp = 2;
  fs.writeFileSync(path.join(dir, relative, "facts.json"), JSON.stringify(facts));
  assert.throws(() => verifyTuiReport(file), /hash mismatch/);
  fs.writeFileSync(file, JSON.stringify({ ...report, catalogHash: "0".repeat(64) }));
  assert.throws(() => verifyTuiReport(file), /frozen source/);
  const summary = summarizeTui({ ...report, cases: report.cases.map(r => ({ ...r, status: "passed" })) });
  assert.equal(summary.fullMatrixPassed, true);
  assert.equal(summarizeTui({ ...report, userSettingsUnchanged: false, cases: report.cases.map(r => ({ ...r, status: "passed" })) }).fullMatrixPassed, false);
});
