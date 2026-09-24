import assert from "node:assert/strict";
import test from "node:test";
import { newReport as compatibilityReport, markdownReport, summarize as summarizeCompatibility } from "../scripts/compatibility/report.mjs";
import { newReport as stabilityReport, markdown as stabilityMarkdown, summarize as summarizeStability } from "../scripts/stability/report.mjs";
import { tuiMatrix, markdown as tuiMarkdown, summarizeTui } from "../scripts/tui/runner.mjs";
import { TUI_CATALOG } from "../scripts/tui/catalog.mjs";
import { caseSections } from "../scripts/compatibility/report-format.mjs";

function finish(report, passed = report.cases.length) {
  Object.assign(report, { finishedAt: "2026-09-24T00:00:00.000Z", implementationUnchanged: true,
    frozenSourceUnchanged: true, userSettingsUnchanged: true });
  report.cases.forEach((row, index) => { row.status = index < passed ? "passed" : "failed"; });
  return report;
}

test("compatibility Markdown leads with the verdict and failures, not coverage targets", () => {
  const report = finish(compatibilityReport({ runId: "report-format" }), 107);
  Object.assign(report.cases.at(-1), { failedChecks: ["C18.1"], reason: "Missing retry evidence",
    artifactPath: "cases/gpt-6-luna/C18" });
  const before = structuredClone(report), summary = summarizeCompatibility(report), text = markdownReport(report);
  assert.match(text, /\*\*Result: NOT PASSED\.\*\* 107\/108 cases passed/);
  assert.ok(text.indexOf("## Cases needing attention") < text.indexOf("## Feature scope"));
  assert.match(text, /\[gpt-6-luna \/ C18\]\(\.\/cases\/gpt-6-luna\/C18\/\).*C18\.1.*Missing retry evidence/);
  assert.match(text, /Show all 108 case rows/);
  assert.match(text, /\| claude-opus-5\.5 \| 18\/18 \| passed \|/);
  assert.match(text, /\| gpt-6-luna \| 17\/18 \| not established \|/);
  assert.match(text, /\| Finished \| 2026-09-24T00:00:00\.000Z \|/);
  assert.match(text, /valid evidence can still describe a failed run/);
  assert.equal(summary.fullMatrixPassed, false);
  assert.deepEqual(summarizeCompatibility(report), summary);
  assert.deepEqual(report, before);
  report.cases.at(-1).status = "passed";
  assert.match(markdownReport(report), /\*\*Result: FULL PASS\./);
  report.executionKind = "offline-self-test";
  assert.match(markdownReport(report), /Result: OFFLINE ONLY - no live compatibility verdict/);
  assert.match(markdownReport(report), /\| Live verdict \|[\s\S]*\| not assessed \(offline\) \|/);
  assert.equal(summarizeCompatibility(report).fullMatrixPassed, false);
});

test("stability Markdown preserves a failing 65/66 verdict and separates offline passes", () => {
  const report = finish(stabilityReport({ runId: "report-format", executionKind: "live", profile: "application-data-v4" }), 65);
  Object.assign(report.cases.at(-1), { category: "upstream-content-filter", failedChecks: ["S11.1"] });
  const before = structuredClone(report), summary = summarizeStability(report), text = stabilityMarkdown(report);
  assert.match(text, /Result: NOT PASSED\.\*\* 65\/66/);
  assert.match(text, /Profile \| application-data-v4/);
  assert.match(text, /category: upstream-content-filter/);
  assert.match(text, /\| claude-opus-5\.5 \| 11\/11 \| passed \|/);
  assert.match(text, /\| gpt-6-luna \| 10\/11 \| not established \|/);
  assert.match(text, /95% reference does not change the verdict/);
  assert.equal(summary.fullMatrixPassed, false);
  assert.deepEqual(summarizeStability(report), summary);
  assert.deepEqual(report, before);
  report.cases.at(-1).status = "passed";
  assert.match(stabilityMarkdown(report), /Result: FULL PASS/);
  const offline = finish(stabilityReport({ runId: "report-format-offline", executionKind: "offline-self-test" }));
  assert.match(stabilityMarkdown(offline), /OFFLINE HARNESS PASSED - no live verdict\.\*\* 11\/11/);
  assert.match(stabilityMarkdown(offline), /\| not assessed \(offline\) \|/);
  assert.equal(summarizeStability(offline).fullMatrixPassed, false);
  assert.match(stabilityMarkdown({ ...offline, finishedAt: null }), /OFFLINE HARNESS IN PROGRESS - no live verdict/);
  offline.cases[0].status = "failed";
  assert.match(stabilityMarkdown(offline), /OFFLINE HARNESS NOT PASSED - no live verdict/);
});

test("TUI Markdown distinguishes 68, 69 and 72 passes without changing the threshold", () => {
  const report = finish({ catalogId: TUI_CATALOG.id, runId: "report-format", executionKind: "live", cases: tuiMatrix() }, 69);
  const before = structuredClone(report), summary = summarizeTui(report), text = tuiMarkdown(report);
  assert.match(text, /Result: TARGET MET - NOT A FULL PASS\.\*\* 69\/72/);
  assert.match(text, /69\/72 meets the 95% target; 72\/72 is a full pass/);
  assert.match(text, /Show all 72 case rows/);
  assert.match(text, /\| claude-opus-5\.5 \| 12\/12 \| passed \|/);
  assert.match(text, /\| gpt-6-luna \| 9\/12 \| not established \|/);
  assert.equal(summary.thresholdMet, true);
  assert.equal(summary.fullMatrixPassed, false);
  assert.deepEqual(summarizeTui(report), summary);
  assert.deepEqual(report, before);
  finish(report, 68);
  assert.match(tuiMarkdown(report), /Result: TARGET NOT MET\.\*\* 68\/72/);
  finish(report);
  assert.match(tuiMarkdown(report), /Result: FULL PASS\.\*\* 72\/72/);
  report.executionKind = "offline-self-test";
  assert.match(tuiMarkdown(report), /OFFLINE ONLY - no live TUI verdict/);
  assert.match(tuiMarkdown(report), /\| not assessed \(offline\) \|/);
});

test("run-level failures and unfinished runs cannot look like complete passes", () => {
  const reports = [
    [finish(compatibilityReport({ runId: "report-format" })), markdownReport],
    [finish(stabilityReport({ runId: "report-format", executionKind: "live" })), stabilityMarkdown],
    [finish({ catalogId: TUI_CATALOG.id, runId: "report-format", executionKind: "live", cases: tuiMatrix() }), tuiMarkdown],
  ];
  for (const [report, render] of reports) {
    const pending = render({ ...report, finishedAt: null });
    assert.match(pending, /Result: IN PROGRESS/);
    assert.doesNotMatch(pending, /Result: FULL PASS/);
    for (const change of [{ interrupted: true }, { implementationUnchanged: false }, { userSettingsUnchanged: false }, { error: "Final cleanup failed" }]) {
      const text = render({ ...report, ...change });
      assert.doesNotMatch(text, /Result: FULL PASS|Result: TARGET MET/);
      assert.match(text, /No non-passing case rows\. The run-level verdict above still applies/);
    }
    assert.match(render({ ...report, error: "Final cleanup failed" }), /Run error: Final cleanup failed/);
    assert.match(render({ ...report, implementationUnchanged: false }), /implementationUnchanged: false/);
  }
  assert.doesNotMatch(tuiMarkdown({ ...reports[2][0], frozenSourceUnchanged: false }), /Result: FULL PASS/);
});

test("case tables retain every status and recorded failure without inventing evidence links", () => {
  const statuses = ["passed", "failed", "blocked", "unsupported", "timed-out", "not-run"];
  const rows = statuses.map((status, index) => ({ model: "gpt-6-astra", scenarioId: `C0${index + 1}`, status }));
  rows[1].supervisor = { code: 1, killed: true, processGroupGone: false, error: { message: "worker failed | inspect\n<log>" } };
  rows[2].reason = "Model unavailable";
  const before = structuredClone(rows), text = caseSections(rows).join("\n");
  const attention = text.split("## Complete matrix")[0], full = text.split("## Complete matrix")[1];
  assert.doesNotMatch(attention, /gpt-6-astra \/ C01/);
  assert.doesNotMatch(text, /\]\(\.\/cases\//);
  for (const row of rows) assert.ok(full.includes(`gpt-6-astra / ${row.scenarioId} | ${row.status}`));
  assert.match(text, /worker failed &#124; inspect &lt;log&gt;/);
  assert.match(text, /worker exit: 1; worker terminated by supervisor; process-group cleanup not confirmed/);
  assert.match(text, /Model unavailable/);
  assert.match(text, /No detail recorded/);
  assert.deepEqual(rows, before);
});
