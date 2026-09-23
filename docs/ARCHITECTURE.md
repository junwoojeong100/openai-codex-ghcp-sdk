# Architecture

[한국어](ARCHITECTURE_KO.md) · [Quick start](../README.md) · [Usage](USAGE.md) · [Compatibility](COMPATIBILITY.md)

This is the implementation reference. For running, configuring or restarting the bridge, use the [usage guide](USAGE.md).

**Jump to:** [Source map](#modules) · [Tool ownership](#tool-handoff) · [Conversation state](#conversation-continuity) · [Timeouts and recovery](#model-progress-and-recovery) · [Data retention](#data-retention).

## Request path

```text
Codex CLI (owns approvals, sandbox and tools)
  → authenticated HTTP/SSE on loopback: POST /v1/responses
  → request-policy.mjs: text input + function/custom tool normalization
  → session-manager.mjs: conversation identity, SDK events, pending calls
  → GitHub Copilot SDK 1.0.14, using existing Copilot authentication
  → the explicitly selected Copilot model
```

The bridge adapts protocols. It does not replace Codex's tool executor with Copilot's executor and does not contact the OpenAI or Anthropic API directly. Model inference goes to GitHub Copilot; running the bridge locally does not make inference local.

## Modules

| Source | Responsibility |
| --- | --- |
| [server.mjs](../src/server.mjs) | Loopback HTTP, local credentials, request limits, JSON/SSE and disconnect cancellation. |
| [request-policy.mjs](../src/request-policy.mjs) | Request validation, `additional_tools`, namespaces and SDK-safe tool names. |
| [responses.mjs](../src/responses.mjs) | Response items/events; preserve `call_id`, namespace and custom input bytes. |
| [session-manager.mjs](../src/session-manager.mjs) | Conversation identity, history, retries, pending results, deadlines and cleanup. |
| [request-queue.mjs](../src/request-queue.mjs) | Bounded, cancellable per-conversation FIFO queues and total request deadlines. |
| [sdk-lifecycle.mjs](../src/sdk-lifecycle.mjs) | SDK readiness and connection recovery, distinct from silent-turn recovery. |
| [copilot-session-rpc.mjs](../src/copilot-session-rpc.mjs) | Bounded abort/disconnect/delete and pending-tool-result RPCs. |
| [mcp-isolation.mjs](../src/mcp-isolation.mjs) | Read Copilot user/plugin MCP names and pass `disabledMcpServers` on every bridge session. |
| [model-map.mjs](../src/model-map.mjs) | Allowed IDs, default model, Codex catalog and SDK-derived context/effort limits; no fallback model. |
| [copilot-home.mjs](../src/copilot-home.mjs), [list-models.mjs](../src/list-models.mjs) | Resolve the existing Copilot home and list account models. |
| [launcher.mjs](../src/launcher.mjs), [bridge-daemon.mjs](../src/bridge-daemon.mjs), [bin/](../bin/) | Owned bridge lifecycle, per-process Codex configuration, private model catalog and optional background operation. |

The temporary catalog replaces bundled/cached picker entries and is removed on Codex exit. Entries declare `apply_patch_tool_type: "freeform"`, so Codex offers its native `apply_patch` tool.

### Verification harnesses

These are test entry points, not extra production services:

- [Terminal runner](../scripts/terminal.mjs) and [shared terminal lane](../scripts/soak/terminal-lane.mjs): frozen-source workers, isolated environments and SDK-correlated outcomes. The soak worker reuses this lane; see [terminal/endurance checks](SOAK_TESTING.md).
- [TUI runner](../scripts/tui.mjs) and [implementation](../scripts/tui/): each [TUI case](TUI_SCENARIOS.md) runs the launcher in a private PTY with headless Playwright/xterm.js, samples runtime MCP processes, reads Codex's rollout and recomputes checks from saved facts.
- [PTY lifecycle](../scripts/soak/terminal.mjs) and [browser driver](../scripts/soak/browser.mjs): one real PTY with an independent parser or Playwright/xterm renderer. Cancellation reaps both the terminal group and owned browser.

## Tool handoff

1. Codex declares function tools or custom/freeform tools, including declarations nested in an `additional_tools` input item.
2. The bridge registers **handlerless** SDK tools and exposes only their `custom:<name>` entries. SDK built-in tools and tool search are not enabled. The Copilot runtime's own user/plugin MCP servers are disabled at session creation, so none start; a bounded `session.mcp.list` check then stops any server from an unscanned source and disables it for later sessions. Codex's own MCP tools still work because Codex runs them and declares them like other tools.
3. An SDK assistant message supplies a tool call. `external_tool.requested` supplies its corresponding pending `requestId`.
4. The HTTP response returns a `function_call` or `custom_tool_call` to Codex. The bridge does not run it.
5. Codex applies its normal sandbox and approval policy, executes the tool, and sends its output in another Responses request.
6. The bridge submits that output with `session.rpc.tools.handlePendingToolCall({requestId, result})` and streams the resumed assistant response.

A function tool uses JSON arguments. A custom tool is represented to the SDK by an object containing one required `input` string. The string becomes `custom_tool_call.input` without newline normalization or an additional JSON encoding layer. A supplied grammar is explanatory context for the model, **not** grammar-constrained decoding in the SDK.

All pending results from a turn must be returned together. Unknown, duplicate, wrong-type and incomplete result batches fail before submission. Unexpected SDK permission requests are denied; `skipPermission` on a handlerless bridge tool only avoids a second SDK prompt and does not approve its execution in Codex.

## Conversation continuity

- Codex `session-id`/`thread-id` headers identify a conversation. With no headers, a known `previous_response_id` or live tool call can identify it; otherwise a new isolated conversation is created.
- Requests within a conversation are serialized. Independent conversations use independent SDK sessions.
- For full-history requests, a canonical prefix comparison removes already-processed items. Wire-only IDs/status are ignored; assistant `phase` and custom input bytes remain significant. An omitted old phase reuses the known value, while an explicitly changed phase is a history change.
- `previous_response_id` supports process-local continuation, not a durable Responses store. Only the current conversation version can be continued.
- An exact retry of the most recent normalized request returns its cached result without resending the prompt or tool results.
- Configuration changes cannot replace a session unless every outstanding call has exactly one matching result and the non-instruction conversation prefix is unchanged. Codex's appended plugin-provenance sentence on a function tool is metadata only when its name, schema and original description still match. Once there are no pending calls, an incompatible full history can start a new SDK session.

Completed-result handoff supports full history, `previous_response_id` and inferred result-only continuation. Model, context tier, tools and trusted top-level instructions may change together with a complete result batch. Prior user/assistant content, phases, call identities/arguments and historical results must still match. The bridge confirms abort/disconnect/delete of the old session and readiness of the same SDK generation, then creates the requested configuration and supplies completed calls/results only as serialized history, never as old result RPCs. Top-level instructions remain in the instruction channel. Tool-less local compaction uses the same boundary.

Completed call identities and response versions survive the handoff: exact retries use the new cache, and old response handles remain stale. Invalid batches fail before retiring the original session. Unconfirmed cleanup/readiness returns `session_handoff_failed`; cancellation or failed replacement leaves the family unavailable rather than silently replaying it on retry. `bridge.session_handoff`, `bridge.session_handoff_failed` and `bridge.pending_session_changed` record request IDs and bounded field/count metadata, not conversation text. This prevents duplicate result-RPC submission and completed-ID reuse, not a model proposing the same operation under a new call ID.

The SDK's send interface is not a general Responses transcript-import API. Cold starts with historical messages serialize non-instruction history into context for a new user prompt, preserving assistant phases. Delimiter characters inside the JSON are escaped without changing the decoded text. This is an approximation, not native role-preserving replay or a guarantee of identical answers. Ordinary matching live turns do not use that replay path.

### Context budgets

`model-map.mjs` selects the largest advertised context tier for each model: `long_context` when `billing.tokenPrices.longContext` or `supportedContextTiers` advertises support, otherwise `default`. The shared selector drives both catalog budgets and SDK session configuration; tier identity is part of the session signature and survives effort changes, history rebuilds and idle recovery. Tier changes with pending calls require the complete-result handoff above; an upstream rejection never silently falls back.

Catalog input budgets respect the selected tier's prompt limits and reserve maximum output space within the model's total context window; Codex starts local automatic compaction at 80% of that budget. Independent SDK compaction remains disabled. Structured SDK context-limit failures retain the Responses `context_length_exceeded` code, allowing Codex to distinguish overflow from retryable transport failure. The launcher disables automatic HTTP/stream retries; exact client retries can still use the bridge's existing success cache.

## Lifetime and security boundaries

The HTTP listener is loopback-only and requires a bridge-specific credential except for `/health`. Launchers pass a generated local credential through child-process environment variables; they do not copy Copilot authentication into Codex configuration.

Session count, idle lifetime, body size, history size and turn duration are bounded. Client disconnect or a failed/timed-out turn evicts its bridge-owned SDK session. Cleanup attempts abort, disconnect and delete with deadlines. Shutdown stops this project's SDK client, with a forced stop fallback if graceful cleanup fails. TTL/capacity eviction can invalidate pending calls; clients receive an explicit error rather than a fabricated tool result.

### Model progress and recovery

The model-progress watchdog is separate from idle-session expiry and the absolute turn deadline. Each attempt starts with a non-refreshing `TURN_FIRST_PROGRESS_TIMEOUT_MS` allowance (180 seconds). `assistant.turn_start` is initialization, not inference progress. Real root text, reasoning/tool-input fragments and increasing safe-integer `assistant.streaming_delta.totalResponseSizeBytes` switch to and refresh `TURN_IDLE_TIMEOUT_MS` (90 seconds). Byte counters reset on distinct root turn IDs, not duplicate starts. Registered Fusion phases in the root conversation additionally count increasing private-output bytes and one successful completion; phase starts alone, phase tools, review/subordinate events and duplicate/invalid counters cannot extend the deadline. At most 64 phase identities are tracked per root turn; private phase content is never read or forwarded. `bridge.turn_watchdog` runs every `min(SDK_READINESS_INTERVAL_MS, TURN_IDLE_TIMEOUT_MS, TURN_FIRST_PROGRESS_TIMEOUT_MS)` and records `waitPhase` (`first_progress` or `streaming`); `bridge.turn_stalled` records the applicable limit and last real progress. Root `model.call_failure` metadata is diagnostic only, restricted to a bounded failure category and numeric HTTP status. Session creation and model-setting retain the smaller of the SDK startup and turn deadlines; recovery does not reset the five-minute absolute turn or six-minute request budget.

A silent, acknowledged request can recover on the original response stream by rebuilding only its SDK session after confirmed abort/disconnect/delete and a healthy same-generation readiness check. `TURN_IDLE_RECOVERY_ATTEMPTS` defaults to 1 (0 disables; maximum 3). Recovery preserves model, effort, instruction authority, complete resolved history, completed-call identities, response-handle versions and reported usage. Completed tool results are context, never another tool-result RPC. Partial output, unacknowledged input, pending calls, filtering, cancellation, failed cleanup and connection loss forbid replay. The original absolute turn/request deadlines cover all recovery attempts, including replacement setup; cancellation also interrupts setup's MCP checks. `bridge.turn_recovering`, `bridge.turn_recovered` and `bridge.turn_recovery_skipped` expose bounded diagnostics without conversation text. Recovery may consume additional inference usage; completely silent reasoning remains indistinguishable from a stall, and history replay is not exactly-once model execution.

### Data retention

Bridge correlation and retry state live in memory. `store:false` means there is no Responses retrieval store here; it does **not** promise that Copilot, Codex or the SDK never writes local session files or retains service-side data. The bridge avoids logging request bodies and credentials. SDK errors may still contain service diagnostics.

No sibling project's tests, validation runner or validation results are used. Offline tests exercise only this implementation with a fake SDK and local HTTP connections.

## Stability and recovery boundaries

- `request-queue.mjs` owns cancellable per-family FIFO admission, total request deadlines and bounds. Cancellation settles before cleanup, but the family lock is held until cleanup completes.
- `sdk-lifecycle.mjs` owns bounded ping checks, single-flight connection recovery and fresh client generations. Connection loss fails affected conversations explicitly without inference or tool-result replay; it is distinct from the bounded idle recovery on a healthy connection above.
- Tool-list ordering is metadata; real policy changes require the complete-result handoff above while calls are pending. Conflict diagnostics contain field names, hashes and counts rather than raw text.
- Delta/final stream reconciliation happens before committing the success cache or pending-tool state.
- `/health` reports HTTP liveness, last-known readiness and the running `turnWatchdog` settings; an older process without that field has not loaded this implementation. Authenticated `/readyz` probes the SDK. Catalog requests may trigger safe connection recovery.

Defaults, errors and the separate 66-cell stability contract are documented in the [stability guide](STABILITY_TESTING.md). Historical v3 stability and v4 compatibility evidence is verified with frozen source, never regraded.

### Instruction and response boundaries

- SDK-managed system/safety instructions are retained with append mode. All top-level client system/developer messages, including mid-history ones, are collected with request instructions; their text is appended unchanged. A changed instruction policy rebuilds an idle session or uses a validated complete-result handoff. SDK built-in tools remain excluded and permission requests remain rejected.
- New user messages accompanying tool results use SDK immediate steering before results are released, not text appended to a tool output. Tool-result text remains byte-exact and exact retries do not repeat either operation.
- Assistant tool calls must match their pending SDK request IDs, session ID, tool names and JSON arguments before handoff. Top-level `agentId` and legacy payload `agentId`/`parentToolCallId` exclude subordinate events from root responses.
- Text completion waits for root `session.idle`, not an intermediate `assistant.turn_end`. A tool handoff instead waits for the matching pending requests, since the SDK cannot become idle until Codex returns their results. An empty answer with no tool calls fails rather than entering the success cache.
