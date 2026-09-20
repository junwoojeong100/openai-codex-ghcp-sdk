import { createHash } from "node:crypto";
import { SUPPORTED_MODEL_IDS } from "../../src/model-map.mjs";

export const MODELS = SUPPORTED_MODEL_IDS;
export const DIMENSIONS = Object.freeze(["normal", "failure", "lifecycle"]);
export const CATALOG_ID = "codex-ghcp-validation-v1";
export const EXCLUSIONS = Object.freeze([
  "Interactive TUI, /model picker, desktop/IDE UI and accessibility",
  "MCP/plugin integrations, subagents, web search and remote services",
  "Workspace edits, approval dialogs, resume across processes and worktrees",
  "Load/soak tests, billing equivalence and durable Responses persistence",
  "Production launcher daemon ownership (covered separately by existing unit tests)",
]);

function feature(id, name, cases, surface = "responses-http") {
  return cases.map(([stimulus, expected, inference], index) => Object.freeze({
    id: `${id}.${DIMENSIONS[index]}`, feature: id, name, dimension: DIMENSIONS[index], surface,
    inference, steps: [
      "Create a private fixture, an owned loopback bridge and a fresh SDK client; retain redacted evidence.",
      stimulus,
      "Check routing and fixture/configuration hashes; close owned processes and sessions even on failure.",
    ],
    assertions: Object.freeze({
      behavior: expected,
      route: inference === "none"
        ? "The real SDK catalog was read, and no prompt or tool result was submitted."
        : "The selected model is used by SDK session configuration and root usage events; native cases also use real Codex JSONL.",
      isolation: "Read-only workspace files and observed user configuration files are unchanged.",
      cleanup: "Owned HTTP listeners, SDK sessions and Codex child processes were closed without cleanup errors.",
    }),
    evidence: Object.freeze(["observations.json", "http.json", "sdk.json", "diagnostics.json", "state.json", "processes.json"]),
  }));
}

export const SCENARIOS = Object.freeze([
  ...feature("gateway", "Gateway discovery and transport boundaries", [
    ["Read public health and the authenticated model catalog.", "Health identity matches the owned bridge; only enabled allowlisted models appear in both catalog formats.", "none"],
    ["Send missing/invalid credentials, malformed JSON, compressed input, unknown routes and remote compaction.", "Each request has the expected JSON error/status before any SDK inference.", "none"],
    ["Create a response, restart only the owned bridge, reuse the old response ID, then start a fresh turn.", "The old port closes and response ID is rejected; a new SDK session completes normally.", "required"],
  ]),
  ...feature("responses", "Text, unsupported semantics and SSE", [
    ["Request an exact random Unicode marker as plain text.", "Completed response, model, text and actual SDK usage are consistent.", "required"],
    ["Request unsupported modalities, hosted/strict tools, structured output, sampling, background jobs and required tool choice.", "Every unsupported request fails explicitly with JSON, including stream=true, and no SDK inference.", "none"],
    ["Stream an exact random marker and retain every SSE frame.", "Sequence numbers increase; created/completed occur once; text deltas equal final text; no error/failed event occurs.", "required"],
  ]),
  ...feature("history", "Continuation, isolation and retry", [
    ["Store a random marker and ask for it using previous_response_id without repeating the value.", "The same SDK session recalls the marker and receives exactly two prompt submissions.", "required"],
    ["Use an unknown ID, another session's ID and an old branch after a valid continuation.", "404/409 errors are exact and cause no additional SDK submission.", "required"],
    ["Retry an identical latest request under the same conversation identity.", "Output and usage are identical and the SDK receives no additional prompt or tool result.", "required"],
  ]),
  ...feature("function-tools", "Namespaced function tool round trips", [
    ["Ask probe.read_fixture for a marker absent from the prompt and submit its real file contents.", "Exactly one declared function call has the correct namespace/JSON arguments; final text matches the unknown file value.", "required"],
    ["With a live pending function call, send duplicate, wrong-ID and wrong-type results, then a correct result.", "Invalid batches are rejected without submissions; the original pending call remains recoverable.", "required"],
    ["Retry both the pending-call request and the completed result request.", "Call identity and final output are stable; exactly one prompt and one tool result are submitted.", "required"],
  ]),
  ...feature("custom-tools", "Raw custom tool input and history", [
    ["Ask a namespaced custom tool to receive Unicode, indentation and a trailing newline, then return a hidden file marker.", "Raw input bytes are preserved and the final response uses the actual tool result, not a prompted marker.", "required"],
    ["Return a function output for a pending custom call, then return the matching custom output.", "Wrong-type output fails before submission and the original custom call can still complete.", "required"],
    ["Continue a custom call with the complete Responses transcript instead of previous_response_id.", "Namespace/raw input survive prefix matching; the existing SDK session accepts the result without replaying the prompt.", "required"],
  ]),
  ...feature("reasoning", "Advertised reasoning capabilities", [
    ["Choose a catalog-advertised effort, or explicitly exercise a model with no configurable effort.", "SDK configuration matches the chosen effort; nonconfigurable models diagnose and omit it rather than invent support.", "required"],
    ["Request an unknown model and an invalid effort value.", "Both fail without fallback or any SDK inference.", "none"],
    ["Change between advertised effort levels while continuing a remembered marker.", "History survives and SDK setModel receives the exact new effort; a nonconfigurable model remains unconfigured with a diagnostic.", "required"],
  ]),
  ...feature("resources", "Concurrent isolation and bounded lifecycle", [
    ["Make two concurrent conversations with distinct markers and continue each.", "Each marker stays in its own SDK session and both conversations complete.", "required"],
    ["Use small explicit body/history limits and submit oversized UTF-8 requests.", "Both limits return 413 before creating a session or submitting inference; production defaults are not changed.", "none"],
    ["Abort a streaming request immediately after response.created, then run a fresh request.", "The interrupted session is removed and aborted; no completed stream is credited; a fresh request succeeds.", "required"],
  ]),
  ...feature("codex-cli", "Native Codex read-only execution", [
    ["Run the real Codex executable with the production provider arguments, isolated CODEX_HOME, JSONL and a read-only hidden-file task.", "A successful command_execution reads a marker absent from the prompt; agent_message/turn.completed and SDK usage agree.", "required"],
    ["Ask Codex to run one read of an absent fixture file and report the failure.", "A nonzero command_execution with a real ENOENT result is observed; no successful file read is fabricated.", "required"],
    ["Launch two ephemeral Codex processes with separate CODEX_HOME directories and different hidden markers.", "Distinct native thread IDs and SDK sessions return only their own fixture values, without changing either workspace.", "required"],
  ], "codex-cli"),
]);

export const SUITES = Object.freeze({
  full: SCENARIOS.map(({ id }) => id),
  smoke: ["gateway.normal", "responses.normal", "responses.lifecycle", "function-tools.normal", "codex-cli.normal"],
  protocol: SCENARIOS.filter(({ surface }) => surface === "responses-http").map(({ id }) => id),
  cli: SCENARIOS.filter(({ surface }) => surface === "codex-cli").map(({ id }) => id),
});

export function catalogHash() {
  return createHash("sha256").update(JSON.stringify({ id: CATALOG_ID, models: MODELS, scenarios: SCENARIOS, exclusions: EXCLUSIONS })).digest("hex");
}

export function selectScenarios({ suite = "full", scenarios } = {}) {
  if (!Object.hasOwn(SUITES, suite)) throw new Error(`Unknown suite: ${suite}`);
  const ids = scenarios ?? SUITES[suite];
  if (!ids.length || new Set(ids).size !== ids.length || ids.some((id) => !SCENARIOS.some((scenario) => scenario.id === id))) {
    throw new Error("Scenario selection must contain distinct, known IDs.");
  }
  return SCENARIOS.filter(({ id }) => ids.includes(id));
}

export function validateModels(models) {
  if (!models.length || new Set(models).size !== models.length || models.some((model) => !MODELS.includes(model))) {
    throw new Error(`Choose distinct models from: ${MODELS.join(", ")}`);
  }
  return models;
}
