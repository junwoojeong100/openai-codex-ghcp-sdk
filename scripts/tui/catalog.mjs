// Versioned real-TUI contract: bin/codex-ghcp in a private PTY, driven by headless Playwright + xterm.js.
import { createHash } from "node:crypto";
import { SUPPORTED_MODEL_IDS } from "../../src/model-map.mjs";

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const TUI_SCENARIOS = freeze([
  { id: "U01", name: "Pinned six-model /model picker and first reply", seconds: 180, sandbox: "read-only",
    covers: "launcher model_catalog_json pinning; exact routing to the launch model" },
  { id: "U02", name: "Picker switch routes the next turn to the selected model", seconds: 240, sandbox: "read-only",
    covers: "mid-thread model change through /model; bridge model resolution" },
  { id: "U03", name: "Codex shell tool reads synthetic application data in the read-only sandbox", seconds: 240, sandbox: "read-only",
    covers: "handlerless tool handoff, Codex-owned execution and pending result submission" },
  { id: "U04", name: "apply_patch creates a workspace file in the workspace-write sandbox", seconds: 240, sandbox: "workspace-write",
    covers: "freeform custom tool input preserved byte-exact through the bridge" },
  { id: "U05", name: "Codex MCP tool works while Copilot runtime MCP servers stay disabled", seconds: 240, sandbox: "read-only",
    covers: "disabledMcpServers isolation; Codex-side MCP tools unaffected" },
  { id: "U06", name: "Long answer rendering keeps the final marker visible", seconds: 360, sandbox: "read-only",
    covers: "long SSE streams, delta/final reconciliation and TUI scroll regions" },
  { id: "U07", name: "Large pasted input is delivered and answered", seconds: 240, sandbox: "read-only",
    covers: "32 MiB body limits and history handling for a 24 KiB bracketed paste" },
  { id: "U08", name: "Escape interrupts a running turn and the same process recovers", seconds: 300, sandbox: "read-only",
    covers: "client disconnect cancellation, SDK abort and same-process recovery" },
  { id: "U09", name: "/compact keeps an explicitly important fact and the thread continues", seconds: 360, sandbox: "read-only",
    covers: "local compaction handoff into a tool-less summarization session" },
  { id: "U10", name: "resume --last replays the conversation into a new bridge process", seconds: 360, sandbox: "read-only",
    covers: "cold-start history replay after launcher, bridge and runtime restart" },
  { id: "U11", name: "Reasoning level chosen in /model reaches the bridge", seconds: 240, sandbox: "read-only",
    covers: "reasoning-effort change on a live conversation or its correct absence" },
  { id: "U12", name: "/new isolates the conversation and /quit tears everything down", seconds: 300, sandbox: "read-only",
    covers: "conversation identity, launcher shutdown, child bridge/runtime exit and private catalog removal" },
]);
export const TUI_CATALOG = freeze({
  id: "codex-ghcp-tui-12-v2", schemaVersion: 2, driver: "playwright-headless-xterm",
  versions: { codex: "0.154.0", copilotSdk: "1.0.14", playwright: "1.63.0", xterm: "6.0.0" },
  models: [...SUPPORTED_MODEL_IDS], scenarios: TUI_SCENARIOS, totalCases: TUI_SCENARIOS.length * SUPPORTED_MODEL_IDS.length,
  concurrency: 3, automaticCaseRetries: 0, preflightSeconds: 60, rows: 45, columns: 140,
  commonChecks: ["routing", "connection", "context-tier", "watchdog", "upstream", "mcp-isolation", "cleanup"],
  thresholdPercent: 95,
  watchdog: { idleTimeoutMs: 90000, recoveryAttempts: 1, intervalMs: 15000 },
  acceptance: "A case passes only when every scenario and common check passes from recorded evidence. The target is at least 95% (69/72) in one complete live run of an unchanged implementation. Failed, blocked, timed-out and not-run cells stay in the denominator; unrun or interrupted matrices cannot meet the target. No automatic case retries, output rewriting, combining runs or cell substitution. fullMatrixPassed still requires 72/72.",
  isolation: "Owned HOME/CODEX_HOME/workspace per case, real Copilot authentication only, approval policy never, no user Codex configuration, plugins or MCP servers.",
  statuses: ["passed", "failed", "blocked", "timed-out", "not-run"],
});
export const tuiCatalogHash = () => createHash("sha256").update(JSON.stringify(TUI_CATALOG)).digest("hex");
