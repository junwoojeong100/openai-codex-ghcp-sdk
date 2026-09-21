import fs from "node:fs";
import path from "node:path";
import { NATIVE_SCENARIO_CATALOG as C, NATIVE_SCENARIOS, NATIVE_MODELS, TOTAL_CASES } from "./catalog.mjs";
import { ROOT } from "./util.mjs";
import { validateDesign } from "./design.mjs";

export function scenarioDocument(language = "ko") {
  if (!["ko", "en"].includes(language)) throw new Error("Unknown documentation language");
  const ko = language === "ko", l = value => value[language], design = validateDesign(), count = NATIVE_SCENARIOS.length;
  const choose = (koText, enText) => ko ? koText : enText;
  const lines = [choose(`# Codex 통합 개발 검증 시나리오 ${count}개`, `# ${count} integrated Codex development scenarios`), "",
    choose("[English](NATIVE_SCENARIOS.md) · [실행 안내](COMPATIBILITY_TESTING_KO.md) · [제품 경계](COMPATIBILITY_KO.md)",
      "[한국어](NATIVE_SCENARIOS_KO.md) · [Runner guide](COMPATIBILITY_TESTING.md) · [Product boundaries](COMPATIBILITY.md)"), "",
    choose(`**현재 계약: ${C.id}. 시나리오 ${count}개 × 모델 ${NATIVE_MODELS.length}개 = ${TOTAL_CASES}건.** 전체 행렬을 실행하며 빠른/부분 모델 모드는 없습니다.`,
      `**Current contract: ${C.id}. ${count} scenarios × ${NATIVE_MODELS.length} models = ${TOTAL_CASES} cases.** One full matrix, no fast or model-subset mode.`), "",
    choose("실모델 결과와 증거는 실행 안내를 참고하세요. 다른 계약이나 삭제된 과거 실행의 결과를 현재 계약의 결과로 재사용하거나 재채점하지 않습니다.",
      "See the runner guide for live results and evidence. Results from other contracts or deleted past runs must not be reused or regraded as current-contract results."), "",
    choose("## 기능 커버리지와 통과율을 분리", "## Separate feature scope from pass rate"), "",
    choose("90%는 여전히 일상 개발 작업의 목표이며 실측 제품 기능 커버리지는 null입니다. 7개 모델을 반복한다고 기능 종류가 7배가 되지 않습니다.",
      "90% remains an everyday-workflow target; measured product-feature coverage is null. Repeating scenarios across seven models does not multiply feature breadth."), "",
    choose(`고정된 검토자 체크리스트 20개: 직접 ${design.coverage.checklist.direct}, 부분 ${design.coverage.checklist.partial}, 미검증 ${design.coverage.checklist.uncovered}. 직접=1·부분=0.5·미검증=0으로 계산한 **설계 점수 ${design.coverage.checklist.designPercent}%**입니다. 공식 지표·사용 빈도 가중치·지원율이 아닙니다. 직접 검증은 구현된 시험이 있다는 뜻이지 통과나 예외 전수 검증을 뜻하지 않습니다.`,
      `Fixed reviewer checklist of 20 groups: ${design.coverage.checklist.direct} direct, ${design.coverage.checklist.partial} partial, ${design.coverage.checklist.uncovered} uncovered. Direct=1, partial=0.5, none=0 gives a **design score of ${design.coverage.checklist.designPercent}%**. It is not an official, usage-weighted or support metric. Direct means an implemented probe, not a passed or exhaustive feature.`), "",
    choose("| 핵심 기능군 | 범위 | 연결 시나리오 | 남은 한계 |", "| Core group | Scope | Scenarios | Remaining limits |"), "|---|---|---|---|",
    ...C.coverage.checklist.map(f => `| ${l(f.name)} | ${f.level} | ${f.scenarios.join(", ") || "—"} | ${f.limitation || "Representative fixture only."} |`), "",
    choose("### 세부 검증 태그", "### Detailed capability tags"), "",
    choose("| 검증 범위 | 시나리오 |", "| Capability | Scenarios |"), "|---|---|",
    ...C.coverage.included.map(f => `| ${l(f.name)} | ${f.scenarios.join(", ")} |`), "",
    choose("### 검증하지 않는 기능", "### Not verified by this suite"), "", ...C.coverage.excluded.map(x => `- ${l(x)}`), "",
    choose("## 실행 조건과 합격 기준", "## Execution conditions and acceptance"), "",
    `- Codex **${C.versions.codex}** · \`@github/copilot-sdk\` **${C.versions.copilotSdk}**.`,
    choose(`- 모델별 모든 ${count}개 시나리오의 필수 조건이 맞아야 통과입니다. unsupported/blocked/timed-out/not-run도 분모에 남습니다.`,
      `- All required assertions in all ${count} scenarios must pass per model. Unsupported, blocked, timed-out and not-run cells remain in the denominator.`),
    choose("- 오프라인 대역·정직한 미지원 거절·일부 성공을 실모델 호환성 통과로 계산하지 않습니다. 원인 근거가 없으면 undetermined로 유지합니다.",
      "- Doubles, honest unsupported rejections and partial success never earn live compatibility credit. Keep causes undetermined without evidence."),
    choose("- 기본 도구 프로파일은 C11에서 실제 launcher로 검사합니다. 다른 케이스의 명시적 도구 노출과 혼동하지 않습니다.",
      "- C11 exercises the actual launcher/default tool profile; other cases use an explicit test tool profile."), "",
    choose("## 모델", "## Models"), "", ...NATIVE_MODELS.map(m => `- \`${m}\``), "",
    choose("## 시간·도구 예산", "## Time and tool budgets"), "",
    choose(`최대 ${C.budget.modelConcurrency}개 모델을 병렬 실행하고 각 모델 안에서는 순차 실행합니다. 1시간은 목표이지 전체 강제 종료가 아닙니다. 자동 케이스 재실행은 없으며 C18의 명시적인 단일 HTTP 재시도와 구별합니다.`,
      `Up to ${C.budget.modelConcurrency} model lanes, sequential scenarios within a lane. One hour is a target, not a global cutoff. No automatic case reruns; C18 deliberately tests one native HTTP retry.`), "",
    choose(`모든 개별 제한을 소진할 때 모델당 ${design.perModelSeconds}초, 사전 점검을 포함한 배정 추정치는 ${(design.scheduledCeilingEstimateSeconds / 60).toFixed(1)}분입니다. 정리 예비 시간 ${C.budget.caseCleanupReserveSeconds}초가 각 제한에 포함됩니다. 실제 수행 시간을 보장하지 않습니다.`,
      `If every case exhausts its deadline, slots total ${design.perModelSeconds}s/model and the preflight-inclusive scheduling estimate is ${(design.scheduledCeilingEstimateSeconds / 60).toFixed(1)} minutes. Each limit includes ${C.budget.caseCleanupReserveSeconds}s cleanup reserve. This is not a wall-clock guarantee.`), "",
    choose("도구 목표 횟수 초과는 효율 진단입니다. 별도의 높은 안전 상한을 넘은 경우에만 필수 예산 검사가 실패합니다. C03은 bare JSON 또는 단일 JSON fence의 의미를 검사하며 형식은 별도 진단합니다. C05는 파이프 없는 테스트 실행을 요청하여 종료 코드 가림을 방지합니다.",
      "Exceeding the tool target is an efficiency diagnostic. Only the separate hard safety cap fails the budget gate. C03 accepts bare JSON or one JSON fence and records presentation separately. C05 requests standalone test commands to avoid masked pipeline exits."), "",
    choose("## 시나리오 목록", "## Scenario index"), "",
    choose("| ID | 작업 | 제한 | 턴 | 도구 목표/상한 |", "| ID | Workflow | Deadline | Turns | Tool target/hard cap |"), "|---|---|---:|---:|---:|",
    ...NATIVE_SCENARIOS.map(s => `| ${s.id} | ${l(s.name)} | ${s.timeoutSeconds}s | ${s.maxUserTurns} | ${s.targetToolCalls}/${s.maxToolCalls} |`), "",
    choose("## 공통 필수 조건", "## Mandatory common gates"), "", ...C.commonGates.map(g => `- ${l(g)}`), "",
    choose("## 상세 계약", "## Detailed contracts"), "",
  ];
  for (const s of NATIVE_SCENARIOS) lines.push(`### ${s.id} — ${l(s.name)}`, "",
    `**${choose("제한/표면", "Limit/surface")}:** ${s.timeoutSeconds}s · ${s.surface}`, "",
    `**${choose("준비", "Fixture")}:** ${l(s.fixture)}`, "", `**${choose("작업", "Task")}:**`, "", "```text", s.prompt, "```", "",
    `**${choose("절차", "Procedure")}:**`, ...s.steps.map((x, i) => `${i + 1}. ${l(x)}`), "",
    `**${choose("필수 조건", "Required assertions")}:**`, ...s.assertions.map(a => `- \`${a.id}\`: ${l(a.description)} — \`${a.evidence}\``), "",
    `**${choose("위험", "Risk")}:** ${l(s.bridgeRisk)}`, "");
  lines.push(choose("## 근거와 사양 원본", "## Sources and source of truth"), "",
    ...Object.entries(C.sources).map(([key, url]) => `- [${key}](${url})`), "",
    "[scripts/compatibility/catalog.mjs](../scripts/compatibility/catalog.mjs)", "",
    choose("`npm run docs:scenarios`로 생성합니다. 실모델 통과를 미리 선언하지 않습니다.", "Generated by `npm run docs:scenarios`; no advance claim of live compatibility."), "");
  return lines.join("\n");
}
export function updateDocumentation({ check = false } = {}) {
  for (const language of ["ko", "en"]) {
    const file = path.join(ROOT, "docs", language === "ko" ? "NATIVE_SCENARIOS_KO.md" : "NATIVE_SCENARIOS.md"), expected = scenarioDocument(language);
    if (check) { if (fs.readFileSync(file, "utf8") !== expected) throw new Error(`Stale scenario document: ${path.basename(file)}`); }
    else fs.writeFileSync(file, expected);
  }
}
