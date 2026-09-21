// Reviewer-defined, equal-weight checklist. This is neither an OpenAI feature
// denominator nor a usage-frequency/product-support measurement.
const feature = (id, ko, en, level, scenarios, limitation = "") => ({ id, name: { ko, en }, level, scenarios, limitation });
export const CORE_CAPABILITIES = [
  feature("exploration", "저장소 탐색·코드 이해", "Repository exploration and understanding", "direct", ["C03"]),
  feature("editing", "파일 편집·다중 파일 리팩터링", "File editing and multi-file refactoring", "direct", ["C04"]),
  feature("shell", "셸 명령·출력·종료 코드", "Shell execution, output and exit status", "direct", ["C01", "C05"]),
  feature("debugging", "디버깅·회귀 테스트", "Debugging and regression testing", "direct", ["C05"]),
  feature("instructions", "지시 계층·비신뢰 입력", "Instruction hierarchy and untrusted input", "direct", ["C02"]),
  feature("skills", "로컬 Skill 발견·실행", "Local skill discovery and execution", "direct", ["C02"]),
  feature("tools", "도구 호출·오류 복구", "Function/freeform tools and error recovery", "direct", ["C04", "C06"]),
  feature("history", "대화 이력·thread 격리", "Conversation history and thread isolation", "direct", ["C09"]),
  feature("resume", "프로세스 재개·재실행 방지", "Cross-process resume and no replay", "direct", ["C10"]),
  feature("safety", "승인·파일/네트워크 샌드박스", "Approvals and filesystem/network sandbox", "direct", ["C07", "C08"]),
  feature("launcher", "생산 launcher·모델 설정", "Production launcher and model configuration", "partial", ["C11"], "Default launcher is exercised; interactive model switching and a reasoning-effort sweep remain untested."),
  feature("automation", "비대화형 자동화·구조화 출력", "Noninteractive automation and structured output", "partial", ["C01", "C11"], "JSONL only; enforced JSON Schema remains unsupported."),
  feature("git-review", "Git 작업·네이티브 리뷰", "Git workflows and native review", "partial", ["C03", "C04", "C12"], "No commit/push/merge-conflict workflow. Native review can expose unsupported structured output."),
  feature("integrations", "MCP·플러그인·인증", "MCP, plugins and authentication", "partial", ["C06", "C16"], "Owned STDIO/HTTP bearer fixtures, not external OAuth or plugin installation."),
  feature("planning", "Plan·사용자 확인", "Plan mode and clarification", "direct", ["C13"], "Interactive TUI rendering and active-turn steering are not certified."),
  feature("subagents", "네이티브 서브에이전트", "Native subagents", "direct", ["C17"], "One read-only child; not arbitrary role/model/concurrency combinations."),
  feature("compaction", "장문 문맥·네이티브 압축", "Longer context and native compaction", "partial", ["C14"], "Manual local compaction and fresh resume, not maximum-token/automatic/remote compaction or soak coverage."),
  feature("recovery", "중단·재시도·복구", "Interruption, retry and recovery", "partial", ["C15", "C18"], "Active command interruption and one pre-inference 503; mid-SSE retries and unresolved-call restart remain untested."),
  feature("web", "네이티브 웹 검색", "Native web search", "none", [], "Unsupported by this adapter."),
  feature("images", "이미지 입력", "Image input", "none", [], "Unsupported by this adapter."),
];
export function checklistSummary(features = CORE_CAPABILITIES) {
  const count = level => features.filter(f => f.level === level).length;
  const direct = count("direct"), partial = count("partial"), uncovered = count("none");
  return { id: "reviewer-core-20-v1", total: features.length, direct, partial, uncovered,
    points: direct + partial * 0.5, designPercent: 100 * (direct + partial * 0.5) / features.length,
    method: "Equal-weight reviewer checklist: direct=1, partial=0.5, none=0; scenario existence, not successful support.",
    usageWeighted: false, officialMetric: false, measuredProductCoveragePercent: null };
}
export function featureVerdicts(report, features, models, matrixValid = false) {
  return features.map(feature => ({ id: feature.id, level: feature.level, scenarios: feature.scenarios,
    perModel: models.map(model => {
      const rows = feature.scenarios.map(id => report.cases.filter(c => c.provider === "ghcp" && c.model === model && c.scenarioId === id));
      const established = matrixValid && report.executionKind === "live" && report.finishedAt && report.implementationUnchanged === true &&
        report.userSettingsUnchanged === true && !report.interrupted && !report.error && rows.length > 0 && rows.every(matches => matches.length === 1 && matches[0].status === "passed");
      return { model, outcome: established ? "scenario-evidence-passed" : "not-established" };
    }) }));
}
