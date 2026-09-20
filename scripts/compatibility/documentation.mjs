import fs from "node:fs";
import path from "node:path";
import { NATIVE_SCENARIO_CATALOG as C, NATIVE_SCENARIOS, NATIVE_MODELS } from "./catalog.mjs";
import { ROOT } from "./util.mjs";
import { validateDesign } from "./design.mjs";

export function scenarioDocument(language = "ko") {
  if (!["ko", "en"].includes(language)) throw new Error("Unknown documentation language");
  const ko = language === "ko", l = value => value[language], design = validateDesign();
  const lines = [ko ? "# Codex 통합 개발 검증 시나리오 10개" : "# Ten integrated Codex development scenarios", "",
    ko ? "[English](NATIVE_SCENARIOS.md) · [실행 안내](COMPATIBILITY_TESTING_KO.md) · [제품 경계](COMPATIBILITY_KO.md)"
      : "[한국어](NATIVE_SCENARIOS_KO.md) · [Runner guide](COMPATIBILITY_TESTING.md) · [Product boundaries](COMPATIBILITY.md)", "",
    ko ? "**단일 검증 구성: 시나리오 10개 × GHCP 모델 7개 = 총 70건.** 별도 기준선 실행·빠른 모드·부분 모델 선택은 없습니다. 실제 Codex의 개발 작업이 bridge/Copilot SDK 경로에서도 작동하는지 독립적인 파일·도구·이벤트 증거로 판정합니다."
      : "**One verification suite: ten scenarios × seven GHCP models = exactly 70 cases.** No separate reference-provider run, fast suite or model subset. Independent file/tool/event evidence establishes whether real Codex development tasks work through the bridge and Copilot SDK.", "",
    ko ? "## 90% 목표의 의미" : "## What the 90% target means", "",
    ko ? "**90%는 일상적인 로컬 개발 작업을 넓게 다루려는 설계 목표이며, 실측 커버리지가 아닙니다.** 아래 기능을 통합 시나리오에 묶었습니다. 사용 빈도 조사나 Codex 전체 기능의 공인 분모가 없으므로 전체 제품 기능의 90% 지원, native GPT와의 동등성 또는 결함 부재를 보장하지 않습니다. 모델별 10/10은 이 시험의 통과율일 뿐 제품 커버리지 수치가 아닙니다."
      : "**90% is a design target for broad everyday local coding coverage, not a measured coverage figure.** The capabilities below are combined into integrated workflows. Without usage-frequency data or an authoritative whole-product denominator, this cannot certify 90% of all Codex features, native-GPT equivalence or absence of defects. A 10/10 score is this suite's pass rate, not product coverage.", "",
    ko ? "| 실제 검증 범위 | 연결 시나리오 |" : "| Capability exercised | Scenarios |", "|---|---|",
    ...C.coverage.included.map(f => `| ${l(f.name)} | ${f.scenarios.map(id => `\`${id}\``).join(", ")} |`), "",
    ko ? "### 이 시험에서 검증하지 않는 기능" : "### Not verified by this suite", "",
    ...C.coverage.excluded.map(x => `- ${l(x)}`), "",
    ko ? "## 실행 조건과 합격 기준" : "## Execution conditions and acceptance", "",
    `- Codex **${C.versions.codex}** · \`@github/copilot-sdk\` **${C.versions.copilotSdk}**.`,
    ko ? "- 같은 실행의 동일한 합성 fixture·지시문을 7모델에 사용합니다. 프롬프트에 없는 nonce를 실제 파일/도구에서 얻어야 합니다. 임시 절대 경로와 수신 포트는 케이스마다 다를 수 있습니다."
      : "- Use the same synthetic fixtures/instructions across the seven models within a run. Hidden nonces must be obtained from actual files/tools, not prompts. Disposable absolute paths and listener ports differ between cases.",
    ko ? "- 모델별 모든 시나리오의 모든 조건을 통과한 **10/10**에만 `core-10-compatible`을 부여합니다. 7모델 각각 10/10이어야 전체 70건 통과입니다."
      : "- Only **10/10 per model**, satisfying every assertion in every workflow, earns `core-10-compatible`. All seven models must individually pass for a 70-case pass.",
    ko ? "- `failed`, `unsupported`, `blocked`, `timed-out`, `not-run`은 통과가 아니며 분모에서 제외하지 않습니다. 사용할 수 없는 모델을 다른 모델로 대체하지 않습니다."
      : "- `failed`, `unsupported`, `blocked`, `timed-out` and `not-run` are not passes and stay in the denominator. An unavailable model is never substituted.",
    ko ? "- 한 케이스의 실패/시간 초과는 다른 케이스 실행을 막지 않습니다. 공통 사전 조건 실패나 사용 불가 모델은 해당 슬롯을 blocked로 기록하고, 사용자 중단 시 미완료 슬롯을 남깁니다."
      : "- A failed/timed-out case does not stop later cases. Failed shared prerequisites or unavailable models produce blocked slots; user cancellation retains unfinished slots.",
    ko ? "- 실패를 모두 bridge 버그로 단정하지 않습니다. 증거로 분류할 수 없으면 `undetermined`입니다. 실모델 검증 결과와 실행기 자체의 테스트 대역 결과를 엄격히 분리합니다."
      : "- Do not label every failure a bridge defect. Retain `undetermined` without causal evidence. Live-model results and scripted runner self-tests remain strictly separate.", "",
    ko ? "## 대상 모델" : "## Models", "", ...NATIVE_MODELS.map(m => `- \`${m}\``), "",
    ko ? "## 빠르게 실행하는 방법과 시간 제한" : "## Scheduling and time limits", "",
    ko ? `전체 1시간 이내는 **목표일 뿐 강제 종료 조건이 아닙니다**. 최대 ${C.budget.modelConcurrency}개 모델을 병렬 처리하고 모델 안에서는 케이스를 순차 실행합니다. 케이스 자동 재시도는 없습니다.`
      : `One hour is a **target, not an overall cutoff**. Run up to ${C.budget.modelConcurrency} models concurrently, with sequential cases per model. No automatic case retries.`, "",
    ko ? `개별 케이스는 60~150초로 제한되며 준비·추론·모든 도구·정리가 포함됩니다. 마지막 ${C.budget.caseCleanupReserveSeconds}초는 정리용입니다. 모델당 합은 ${design.perModelSeconds}초이고, 모든 슬롯이 제한 시간을 사용할 때 사전 점검을 포함한 배정 시간 계산은 약 ${(design.scheduledCeilingEstimateSeconds / 60).toFixed(1)}분입니다. 스케줄링/리포트 I/O·OS 지연은 별도이므로 실제 소요나 성공을 보장하지 않습니다.`
      : `Each 60–150 s case includes setup, inference, all tools and teardown, reserving ${C.budget.caseCleanupReserveSeconds} s for cleanup. Slots total ${design.perModelSeconds} s/model. If every slot consumes its limit, the scheduling estimate including preflight is about ${(design.scheduledCeilingEstimateSeconds / 60).toFixed(1)} minutes, excluding scheduling/report I/O and OS delays. This is not a duration or success guarantee.`, "",
    ko ? "## 시나리오 목록" : "## Scenario index", "",
    ko ? "| ID | 통합 작업 | 개별 제한 | 사용자 턴/도구 상한 |" : "| ID | Integrated workflow | Case limit | Turns/tools |", "|---|---|---:|---:|",
    ...NATIVE_SCENARIOS.map(s => `| ${s.id} | ${l(s.name)} | ${s.timeoutSeconds}s | ${s.maxUserTurns}/${s.maxToolCalls} |`), "",
    ko ? "## 공통 필수 조건" : "## Mandatory common gates", "", ...C.commonGates.map(g => `- ${l(g)}`), "",
    ko ? "## 상세 검증 계약" : "## Detailed verification contracts", "",
  ];
  for (const s of NATIVE_SCENARIOS) lines.push(`### ${s.id} — ${l(s.name)}`, "",
    `**${ko ? "제한/표면" : "Limit/surface"}:** ${s.timeoutSeconds}s · ${s.surface}`, "",
    `**${ko ? "준비/입력" : "Fixture/input"}:** ${l(s.fixture)}`, "",
    `**${ko ? "프롬프트/작업" : "Prompt/task"}:**`, "", "```text", s.prompt, "```", "",
    `**${ko ? "절차" : "Procedure"}:**`, ...s.steps.map((step, i) => `${i + 1}. ${l(step)}`), "",
    `**${ko ? "합격 조건(전부 필수)" : "Pass conditions (all required)"}:**`,
    ...s.assertions.map(a => `- \`${a.id}\`: ${l(a.description)} — \`${a.evidence}\``), "",
    `**${ko ? "발견할 문제" : "Bridge risk"}:** ${l(s.bridgeRisk)}`, "");
  lines.push(ko ? "## 근거와 사양 원본" : "## Sources and source of truth", "",
    ko ? "OpenAI 공식 문서와 고정 버전 app-server schema를 기준으로 작성했습니다. 이 문서는 실모델 통과를 미리 선언하지 않습니다."
      : "Based on official OpenAI documentation and the pinned app-server schema. This specification does not pre-credit live passes.", "",
    ...Object.entries(C.sources).map(([key, url]) => `- [${key}](${url})`), "",
    "[scripts/compatibility/catalog.mjs](../scripts/compatibility/catalog.mjs)", "",
    ko ? "`npm run docs:scenarios`로 생성합니다. 상세 실행 방법은 [실행 안내](COMPATIBILITY_TESTING_KO.md)를 참고하세요."
      : "Generated by `npm run docs:scenarios`. See the [runner guide](COMPATIBILITY_TESTING.md) for execution and evidence verification.", "");
  return lines.join("\n");
}
export function updateDocumentation({ check = false } = {}) {
  for (const language of ["ko", "en"]) {
    const file = path.join(ROOT, "docs", language === "ko" ? "NATIVE_SCENARIOS_KO.md" : "NATIVE_SCENARIOS.md"), expected = scenarioDocument(language);
    if (check) { if (fs.readFileSync(file, "utf8") !== expected) throw new Error(`Stale scenario document: ${path.basename(file)}`); }
    else fs.writeFileSync(file, expected);
  }
}
