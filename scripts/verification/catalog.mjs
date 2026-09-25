import { SUPPORTED_MODEL_IDS } from "../../src/model-map.mjs";
import { sha } from "./util.mjs";

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const SCENARIOS = freeze([
  { id: "V01", name: "CLI/TUI launch, Unicode chat and /new isolation", ko: "CLI/TUI 실행·유니코드 대화·새 대화 격리", seconds: 240, sandbox: "read-only" },
  { id: "V02", name: "Read, patch and run regression tests", ko: "파일 읽기·코드 수정·회귀 테스트", seconds: 300, sandbox: "workspace-write" },
  { id: "V03", name: "Codex MCP error and tool-result recovery", ko: "Codex MCP 오류·도구 결과 복구", seconds: 240, sandbox: "read-only" },
  { id: "V04", name: "Model and reasoning-level switch", ko: "모델·추론 수준 전환", seconds: 240, sandbox: "read-only" },
  { id: "V05", name: "Interrupt and continue the same process", ko: "중단 후 같은 프로세스에서 계속", seconds: 240, sandbox: "read-only" },
  { id: "V06", name: "Compact, quit and resume saved history", ko: "대화 압축·종료·저장 이력 재개", seconds: 420, sandbox: "read-only" },
]);

export const CATALOG = freeze({
  id: "codex-ghcp-essential-v1", schemaVersion: 1,
  versions: { codex: "0.154.0", copilotSdk: "1.0.14", playwright: "1.63.0", xterm: "6.0.0" },
  models: [...SUPPORTED_MODEL_IDS], scenarios: SCENARIOS, totalCases: SCENARIOS.length * SUPPORTED_MODEL_IDS.length,
  concurrency: 3, preflightSeconds: 60, automaticCaseRetries: 0,
  driver: "production-launcher-playwright-pty",
  watchdog: { firstProgressTimeoutMs: 180000, idleTimeoutMs: 90000, recoveryAttempts: 1, intervalMs: 15000 },
  commonChecks: ["routing", "connection", "context-tier", "watchdog", "upstream", "mcp-isolation", "workspace", "cleanup", "execution"],
  acceptance: "All 36 cases and run-level integrity, isolation and cleanup checks must pass in one complete live run. No percentage target, profile, subset, automatic case retry or pooled score.",
  excluded: ["Native review/Plan/subagents/skills", "Exhaustive fault matrices", "Large-payload benchmarks", "Soak/endurance", "Maximum-context inference", "Unsupported Responses capabilities"],
});
export const catalogHash = () => sha(JSON.stringify(CATALOG));
