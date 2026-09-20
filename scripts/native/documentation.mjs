import fs from "node:fs";
import path from "node:path";
import { NATIVE_FEATURES } from "./catalog.mjs";
import { runnerPlan } from "./plan.mjs";
import { ROOT } from "../validation/evidence.mjs";

const start = "<!-- BEGIN GENERATED READINESS -->";
const end = "<!-- END GENERATED READINESS -->";
export function readinessTable(language = "en") {
  const plan = runnerPlan();
  const ko = language === "ko";
  const lines = [
    ko ? `현재 **ready ${plan.counts.ready} / partial ${plan.counts.partial} / not-implemented ${plan.counts["not-implemented"]}**. 이 수치는 실모델 실행 결과가 아닙니다.`
      : `Currently **ready ${plan.counts.ready} / partial ${plan.counts.partial} / not-implemented ${plan.counts["not-implemented"]}**. These are implementation states, not live results.`,
    "",
    ko ? "| 기능 ID (옆 저장소 대응) | 정상 | 실패 | 상태 전이 | 네이티브 surface |" : "| Feature ID (sibling crosswalk) | Normal | Failure | Lifecycle | Native surface |",
    "|---|---|---|---|---|",
  ];
  for (const feature of NATIVE_FEATURES) {
    const rows = feature.scenarios.map(({ id }) => plan.scenarios.find((row) => row.scenarioId === id));
    const statuses = rows.map((row) => `\`${row.status}\`${row.expectedOutcome === "unsupported" ? " †" : ""}`);
    lines.push(`| \`${feature.id}\` | ${statuses.join(" | ")} | \`${feature.surface}\` |`);
  }
  lines.push("", ko ? "† 예상 결과가 `unsupported`인 경계 검사입니다. 드라이버가 준비되어도 해당 기능 지원으로 계산하지 않습니다."
    : "† Boundary check with an expected `unsupported` result. Driver readiness does not imply feature support.");
  return lines.join("\n");
}
export function updateReadinessDocumentation({ check = false } = {}) {
  for (const [filename, language] of [["NATIVE_SCENARIOS.md", "en"], ["NATIVE_SCENARIOS_KO.md", "ko"]]) {
    const file = path.join(ROOT, "docs", filename);
    const current = fs.readFileSync(file, "utf8");
    const from = current.indexOf(start), to = current.indexOf(end);
    if (from < 0 || to <= from || current.indexOf(start, from + 1) !== -1 || current.indexOf(end, to + 1) !== -1) {
      throw new Error(`Missing/ambiguous readiness markers: ${filename}`);
    }
    const next = current.slice(0, from + start.length) + `\n${readinessTable(language)}\n` + current.slice(to);
    if (check && current !== next) throw new Error(`Stale native readiness table: docs/${filename}; run npm run docs:scenarios.`);
    if (!check && current !== next) fs.writeFileSync(file, next);
  }
}
