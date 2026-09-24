import fs from "node:fs";
import path from "node:path";
import { NATIVE_SCENARIO_CATALOG as C, NATIVE_SCENARIOS, NATIVE_MODELS, TOTAL_CASES } from "./catalog.mjs";
import { ROOT } from "./util.mjs";
import { validateDesign } from "./design.mjs";

export function scenarioDocument(language = "ko") {
  if (!["ko", "en"].includes(language)) throw new Error("Unknown documentation language");
  const ko = language === "ko", l = value => value[language], design = validateDesign(), count = NATIVE_SCENARIOS.length;
  const choose = (koText, enText) => ko ? koText : enText;
  const scenarioLinks = ids => ids.map(id => `[${id}](#${id.toLowerCase()})`).join(", ") || "—";
  const englishOnly = NATIVE_SCENARIOS.filter(s => s.fixture.ko === s.fixture.en).map(s => s.id);
  const idNumber = id => Number(id.slice(1));
  const englishOnlyIds = englishOnly.length > 2 && idNumber(englishOnly.at(-1)) - idNumber(englishOnly[0]) + 1 === englishOnly.length
    ? `${englishOnly[0]}–${englishOnly.at(-1)}` : englishOnly.join(", ");
  const lines = [choose(`# Codex 통합 개발 검증 시나리오 ${count}개`, `# ${count} integrated Codex development scenarios`), "",
    choose("[English](NATIVE_SCENARIOS.md) · [실행 안내](COMPATIBILITY_TESTING_KO.md) · [제품 경계](COMPATIBILITY_KO.md)",
      "[한국어](NATIVE_SCENARIOS_KO.md) · [Runner guide](COMPATIBILITY_TESTING.md) · [Product boundaries](COMPATIBILITY.md)"), "",
    choose(`**현재 계약: ${C.id}. 시나리오 ${count}개 × 모델 ${NATIVE_MODELS.length}개 = ${TOTAL_CASES}건.** 전체 행렬을 실행하며 빠른/부분 모델 모드는 없습니다.`,
      `**Current contract: ${C.id}. ${count} scenarios × ${NATIVE_MODELS.length} models = ${TOTAL_CASES} cases.** One full matrix, no fast or model-subset mode.`), "",
    choose("이 문서는 시나리오 사양입니다. 준비 사항·명령·결과 해석은 [실행 안내](COMPATIBILITY_TESTING_KO.md)를 참고하세요. 다른 계약의 결과를 현재 계약의 통과 증거로 사용하지 않습니다.",
      "This is the scenario reference. For prerequisites, commands and result interpretation, use the [runner guide](COMPATIBILITY_TESTING.md). Results from other contracts are not evidence that this contract passes."), "",
    choose("**바로 가기:** [목록](#시나리오-목록) · [상세 계약](#상세-계약) · [기능 범위와 통과율](#기능-커버리지와-통과율을-분리).",
      "**Jump to:** [Scenario index](#scenario-index) · [Detailed contracts](#detailed-contracts) · [Feature scope and pass rate](#separate-feature-scope-from-pass-rate)."), "",
    choose("생성 문서이므로 직접 수정하지 마세요. [템플릿](../scripts/compatibility/documentation.mjs)이나 [catalog](../scripts/compatibility/catalog.mjs)를 수정하고 `npm run docs:scenarios`, `npm run test:docs` 순서로 실행하세요.",
      "Do not edit this generated file directly. Edit [the template](../scripts/compatibility/documentation.mjs) or [catalog](../scripts/compatibility/catalog.mjs), then run `npm run docs:scenarios` followed by `npm run test:docs`."), "",
    choose("## 시나리오 목록", "## Scenario index"), "",
    choose("| ID | 작업 | 제한 | 턴 | 도구 목표/상한 |", "| ID | Workflow | Deadline | Turns | Tool target/hard cap |"), "|---|---|---:|---:|---:|",
    ...NATIVE_SCENARIOS.map(s => `| [${s.id}](#${s.id.toLowerCase()}) | ${l(s.name)} | ${s.timeoutSeconds}s | ${s.maxUserTurns} | ${s.targetToolCalls}/${s.maxToolCalls} |`), "",
    choose(`**읽는 방법:** 시나리오 ${count}개를 모델 ${NATIVE_MODELS.length}개에서 각각 실행하여 ${TOTAL_CASES}건을 검사합니다. 아래 프롬프트는 모든 모델에 그대로 전달하는 입력이며, 독자가 셸에 붙여 넣거나 수동으로 수행할 설치 절차가 아닙니다. 모델 입력을 동일하게 유지하기 위해 번역하지 않습니다.`,
      `**How to read a case:** ${count} scenarios run on ${NATIVE_MODELS.length} models give ${TOTAL_CASES} cases. The prompts below are exact model inputs, not shell commands or setup steps to perform manually. They are deliberately not translated so every model receives the same input.`), "",
    ...(ko && englishOnly.length ? [`${englishOnlyIds}의 준비 상태·절차·필수 조건 설명은 catalog의 영어 원문을 그대로 표시합니다.`, ""] : []),
    choose("검사 러너가 각 절차를 수행하고, 명시된 증거 파일로 필수 조건(assertion)을 판정합니다. 해당 시나리오의 필수 조건과 [공통 필수 조건](#공통-필수-조건)이 모두 맞아야 통과합니다. 준비 상태(fixture)는 테스트 전용 데이터·환경이며 사용자의 작업 저장소가 아닙니다.",
      "The test runner performs each procedure and evaluates its required checks (assertions) from the named evidence files. A case must pass both its own checks and the [common gates](#mandatory-common-gates). The setup (fixture) is test-owned data and environment, not your working repository."), "",
    choose("도구 목표 횟수는 효율 진단이고 상한은 실패를 결정하는 안전 제한입니다. 증거 파일은 조건을 다시 계산하는 입력이지, 파일이 있다는 사실만으로 통과를 인정하는 표식이 아닙니다.",
      "The tool target is an efficiency diagnostic; the hard cap is a pass/fail limit. Evidence files are inputs to recomputed checks, not proof of success merely because the files exist."), "",
    choose("## 상세 계약", "## Detailed contracts"), "",
  ];
  for (const s of NATIVE_SCENARIOS) lines.push(`<a id="${s.id.toLowerCase()}"></a>`, "", `### ${s.id} — ${l(s.name)}`, "",
    `**${choose("제한 시간 / 실행 경로", "Deadline / execution path")}:** ${s.timeoutSeconds}s · ${s.surface}`, "",
    `**${choose("준비 상태", "Test setup")}:** ${l(s.fixture)}`, "", `**${choose("모델 프롬프트(전달 원문)", "Model prompt (sent unchanged)")}:**`, "", "```text", s.prompt, "```", "",
    `**${choose("검사 러너의 절차", "Runner procedure")}:**`, ...s.steps.map((x, i) => `${i + 1}. ${l(x)}`), "",
    `**${choose("필수 조건", "Required checks")}:**`, ...s.assertions.map(a => `- \`${a.id}\`: ${l(a.description)} — \`${a.evidence}\``), "",
    `**${choose("bridge 실패 위험", "Bridge behavior at risk")}:** ${l(s.bridgeRisk)}`, "");
  lines.push(
    choose("## 기능 커버리지와 통과율을 분리", "## Separate feature scope from pass rate"), "",
    choose("실측 제품 기능 커버리지는 **미확인(`null`)**입니다. 90%는 일상 개발 작업의 목표이지 달성한 점수가 아닙니다. 같은 시나리오를 여러 모델에서 반복해도 검사하는 기능 종류가 늘어나지는 않습니다.",
      "Measured product-feature coverage is **unknown (`null`)**. The 90% figure is an everyday-workflow target, not an achieved score. Repeating the same scenarios across models does not increase the number of features tested."), "",
    choose(`고정된 검토자 체크리스트 20개: 직접 ${design.coverage.checklist.direct}, 부분 ${design.coverage.checklist.partial}, 미검증 ${design.coverage.checklist.uncovered}. 직접=1·부분=0.5·미검증=0으로 계산한 **설계 점수 ${design.coverage.checklist.designPercent}%**입니다. 공식 지표·사용 빈도 가중치·지원율이 아닙니다. 직접 검증은 구현된 시험이 있다는 뜻이지 통과나 예외 전수 검증을 뜻하지 않습니다.`,
      `Fixed reviewer checklist of 20 groups: ${design.coverage.checklist.direct} direct, ${design.coverage.checklist.partial} partial, ${design.coverage.checklist.uncovered} uncovered. Direct=1, partial=0.5, none=0 gives a **design score of ${design.coverage.checklist.designPercent}%**. It is not an official, usage-weighted or support metric. Direct means an implemented probe, not a passed or exhaustive feature.`), "",
    choose("| 핵심 기능군 | 범위 | 연결 시나리오 | 남은 한계 |", "| Core group | Scope | Scenarios | Remaining limits |"), "|---|---|---|---|",
    ...C.coverage.checklist.map(f => `| ${l(f.name)} | ${f.level} | ${scenarioLinks(f.scenarios)} | ${f.limitation || "Representative fixture only."} |`), "",
    choose("### 세부 검증 태그", "### Detailed capability tags"), "",
    choose("| 검증 범위 | 시나리오 |", "| Capability | Scenarios |"), "|---|---|",
    ...C.coverage.included.map(f => `| ${l(f.name)} | ${scenarioLinks(f.scenarios)} |`), "",
    choose("### 검증하지 않는 기능", "### Not verified by this suite"), "", ...C.coverage.excluded.map(x => `- ${l(x)}`), "",
    choose("## 실행 조건과 합격 기준", "## Execution conditions and acceptance"), "",
    `- Codex **${C.versions.codex}** · \`@github/copilot-sdk\` **${C.versions.copilotSdk}**.`,
    choose(`- 모델별 모든 ${count}개 시나리오의 필수 조건이 맞아야 통과입니다. unsupported/blocked/timed-out/not-run도 분모에 남습니다.`,
      `- All required assertions in all ${count} scenarios must pass per model. Unsupported, blocked, timed-out and not-run cases remain in the denominator.`),
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
    choose("## 공통 필수 조건", "## Mandatory common gates"), "", ...C.commonGates.map(g => `- ${l(g)}`), "");
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
