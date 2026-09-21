import { createHash } from "node:crypto";
import { SUPPORTED_MODEL_IDS } from "../../src/model-map.mjs";

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const literalAnswer = "Please return a fenced text code block containing the two original lines from read_fixture. Copy the full lines exactly, including lowercase value: and receipt:, with no added space after either colon. Preserve the generated values and Korean text. This is an exact-copy test, not a request to rename or reformat fields.";
export const PROMPTS = freeze({
  read: "Use the read_fixture client tool exactly once in this turn for an owned Unicode transport test. It returns two randomly generated test markers, not credentials, personal information or external data. No shell, other tools or file changes are needed. " + literalAnswer,
  remember: "Use the read_fixture client tool exactly once in THIS turn, even if earlier turns already called it. Each request in this transport test needs a fresh read of its generated, non-sensitive test markers. Remember the complete returned value and receipt for later, and also echo the original two lines NOW. No other tools or file changes are needed. " + literalAnswer,
  recall: "Without using any tools, recall the exact two text lines from the earlier read_fixture result. " + literalAnswer,
  padding: "Keep the previously remembered fixture value and receipt. Do not use tools. Acknowledge this irrelevant data with ACK.\n" + "Non-instruction context padding: abcdefghijklmnopqrstuvwxyz0123456789\n".repeat(200),
});
export const FLOW = freeze({
  S01: [["read", "read", "completed"]], S02: [["read", "read", "completed"]],
  S03: [["read", "read", "completed"]], S04: [["read", "read", "completed"]], S05: [["read", "read", "completed"]],
  S06: [["fault", "read", "failed"], ["recovery", "read", "completed"]],
  S07: [["before-loss", "read", "completed"], ["lost-conversation", "recall", "failed"], ["recovery", "read", "completed"]],
  S08: [["fault", "read", "failed"], ["recovery", "read", "completed"]],
  S09: [["fault", "read", "failed"], ["recovery", "read", "completed"]],
  S10: [["remember", "remember", "completed"], ["recall", "recall", "completed"]],
  S11: [...Array.from({ length: 6 }, (_, i) => [`repeat-${i + 1}`, "remember", "completed"]), ["padding", "padding", "completed"], ["recall", "recall", "completed"]],
});
export const SCENARIOS = freeze([
  { id: "S01", name: "Native read, Unicode SSE and readiness", seconds: 90, fault: "none", turns: 1 },
  { id: "S02", name: "Reordered tools while returning a pending result", seconds: 90, fault: "request-tool-permutation", turns: 1 },
  { id: "S03", name: "Reject changed tool policy, then accept the unchanged result", seconds: 90, fault: "rejected-control-request", turns: 1 },
  { id: "S04", name: "Duplicate pending-result HTTP request without duplicate submission", seconds: 90, fault: "exact-control-duplicate", turns: 1 },
  { id: "S05", name: "Cancel a queued HTTP duplicate while native inference continues", seconds: 120, fault: "bounded-sdk-ack-gate-and-queued-disconnect", turns: 1 },
  { id: "S06", name: "Total request deadline followed by a fresh native turn", seconds: 180, fault: "bounded-sdk-ack-gate-and-request-deadline", turns: 2 },
  { id: "S07", name: "Idle SDK loss, truthful readiness and new-thread recovery", seconds: 150, fault: "owned-sdk-force-stop", turns: 3 },
  { id: "S08", name: "SDK loss with a native tool result pending, no replay", seconds: 150, fault: "owned-sdk-force-stop-at-tool-result", turns: 2 },
  { id: "S09", name: "Reject mismatched stream before committing pending state", seconds: 120, fault: "one-sdk-delta-id-corruption", turns: 2 },
  { id: "S10", name: "Fresh-process native resume without replaying a tool receipt", seconds: 150, fault: "planned-owned-host-and-bridge-restart", turns: 2 },
  { id: "S11", name: "Repeated native tool turns, long history and local compaction", seconds: 240, fault: "explicit-native-compaction", turns: 8 },
]);
export const CATALOG = freeze({
  id: "codex-ghcp-stability-11-v3", schemaVersion: 1,
  versions: { codex: "0.154.0", copilotSdk: "1.0.14" }, models: [...SUPPORTED_MODEL_IDS], scenarios: SCENARIOS, prompts: PROMPTS, flow: FLOW,
  totalCases: SCENARIOS.length * SUPPORTED_MODEL_IDS.length, concurrency: 4, automaticCaseRetries: 0,
  cleanupReserveSeconds: 30, preflightSeconds: 90, maxNativeToolCalls: 20,
  injectedDeadlineMs: 45_000, gateTimeoutMs: 60_000, gateReadyTimeoutMs: 45_000, faultControlTimeoutMs: 8000,
  cleanupTimeoutMs: 5000, startupTimeoutMs: 30_000,
  changesFromV1: "Acceptance checks and the 77-cell denominator are unchanged. Prompts now explicitly require exact immediate echo and one read per turn; cleanup uses the production 5s default; gate/deadline budgets allow bounded SDK startup. No output rewriting or case substitution.",
  changesFromV2: "Common benign transport-test context and fenced exact-copy requests replace imperative plain-text-only wording. Existing oracles already allow surrounding fences and still require every literal character. Safety settings, models, fixtures, fault checks and all 77 cells are unchanged.",
  outputPolicy: "Every successful read/remember/recall must preserve both complete literal value: and receipt: tokens in its final native answer. Surrounding prose/fences are recorded as presentation diagnostics, not a liveness failure. Padding must acknowledge ACK without tools. This is a new stability contract, not regrading v4 exact-output assertions.",
  acceptance: "All declared checks and cleanup receipts required. Failed, blocked, unsupported, timed-out and not-run cells remain in the 77-cell denominator. Live inference is required in every passing live cell. Fault injection is explicitly labelled; no whole-product or hours-long reliability claim.",
  isolation: "Owned temporary HOME/CODEX_HOME, read-only native threads, no shell execution, fixture-only native dynamic tool, no user bridge discovery/restart, and no automatic inference replay after loss.",
  statuses: ["passed", "failed", "blocked", "unsupported", "timed-out", "not-run"],
});
export const catalogHash = () => createHash("sha256").update(JSON.stringify(CATALOG)).digest("hex");
