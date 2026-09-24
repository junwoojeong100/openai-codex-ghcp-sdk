function cell(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]]/g, "\\$&").replace(/\|/g, "&#124;").replace(/[\r\n]+/g, " ");
}

export function reportHeader(report, { result, passed, totalCases, passRule }) {
  const state = report.interrupted ? "interrupted" : report.finishedAt ? "finished" : "in progress";
  const notes = [];
  if (report.error) notes.push(`Run error: ${cell(report.error)}`);
  for (const field of ["implementationUnchanged", "frozenSourceUnchanged", "userSettingsUnchanged"]) {
    if (report[field] === false) notes.push(`${field}: false`);
  }
  return [`# ${cell(report.catalogId)}`, "", `**Result: ${result}.** ${passed}/${totalCases} cases passed.`, "",
    `**Pass rule:** ${passRule}`, "",
    "| Run information | Recorded value |", "|---|---|",
    `| Run | ${cell(report.runId)} |`, `| Execution | ${cell(report.executionKind)} |`, `| State | ${state} |`,
    `| Started | ${cell(report.startedAt ?? "not recorded")} |`, `| Finished | ${cell(report.finishedAt ?? "not finished")} |`,
    ...(report.profile === undefined ? [] : [`| Profile | ${cell(report.profile)} |`]),
    `| Implementation hash | ${cell(report.implementationHash ?? "not recorded")} |`,
    `| Catalog hash | ${cell(report.catalogHash ?? "not recorded")} |`, "",
    ...notes.map(note => `- ${note}`), ...(notes.length ? [""] : []),
    "This is the runner's summary, not an integrity check. Verify [report.json](./report.json) with the matching `--verify` runner; valid evidence can still describe a failed run.", ""];
}

function caseRow(row) {
  const label = cell(`${row.model} / ${row.scenarioId}`);
  const link = row.artifactPath ? `[${label}](./${row.artifactPath.split("/").map(encodeURIComponent).join("/")}/)` : label;
  const detail = [];
  if (row.category) detail.push(`category: ${row.category}`);
  if (row.error) detail.push(row.error);
  if (row.reason) detail.push(row.reason);
  if (row.supervisor?.error?.message) detail.push(row.supervisor.error.message);
  if (row.supervisor?.code !== undefined && row.supervisor.code !== 0) detail.push(`worker exit: ${row.supervisor.code}`);
  if (row.supervisor?.killed) detail.push("worker terminated by supervisor");
  if (row.supervisor?.processGroupGone === false || row.processGroupGone === false) detail.push("process-group cleanup not confirmed");
  return `| ${link} | ${cell(row.status)} | ${cell((row.failedChecks ?? []).join(", ") || "none recorded")} | ${cell([...new Set(detail)].join("; ") || (row.status === "passed" ? "-" : "No detail recorded"))} |`;
}

export function caseSections(cases) {
  const attention = cases.filter(row => row.status !== "passed");
  const columns = ["| Model / scenario | Status | Failed checks | Recorded detail |", "|---|---|---|---|"];
  return ["## Cases needing attention", "",
    ...(attention.length ? [...columns, ...attention.map(caseRow)] : ["No non-passing case rows. The run-level verdict above still applies."]), "",
    "Case links open recorded artifact directories. No link means no case artifact path was recorded; failed-check IDs alone do not establish a root cause.", "",
    "## Complete matrix", "", "<details>", `<summary>Show all ${cases.length} case rows</summary>`, "",
    ...columns, ...cases.map(caseRow), "", "</details>", "",
    "Failed, blocked, unsupported, timed-out and not-run cases stay in the denominator.", ""];
}
