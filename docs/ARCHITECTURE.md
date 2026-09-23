# Architecture

[한국어](ARCHITECTURE_KO.md) · [Usage](../README.md) · [Compatibility](COMPATIBILITY.md)

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

- `server.mjs`: loopback HTTP server, local credential checks, request limits, JSON/SSE responses, disconnect cancellation.
- `request-policy.mjs`: supported request semantics, Codex `additional_tools` and namespaces, deterministic SDK-safe tool names.
- `responses.mjs`: Responses output items and streaming events; preserves tool `call_id`, namespace, and custom input strings.
- `session-manager.mjs`: per-conversation queues, history matching, cached retries, pending tool results, deadlines, expiry and cleanup.
- `copilot-session-rpc.mjs`: narrow wrappers over SDK abort/disconnect/delete and pending-tool-result RPCs.
- `mcp-isolation.mjs`: exact MCP server names configured for the Copilot runtime (user `mcp-config.json` and installed plugins), passed as `disabledMcpServers` on every bridge SDK session.
- `model-map.mjs`: the six allowed IDs, default selection, OpenAI/Codex catalog metadata and reasoning-effort checks. Model context limits and supported efforts come from the SDK catalog; there is no automatic model fallback.
- `copilot-home.mjs` and `list-models.mjs`: existing Copilot home resolution and account-specific model listing.
- Launcher/daemon modules and `bin/`: start a project-owned bridge, pass per-process Codex configuration and a private temporary model catalog, and manage optional background operation. Catalog entries declare `apply_patch_tool_type: "freeform"`, so Codex offers its native `apply_patch` tool. The catalog replaces bundled/cached picker entries and is removed on Codex exit.
- `scripts/terminal.mjs` and `scripts/soak/terminal-lane.mjs`: explicit live terminal validation, frozen-source workers, isolated environments and SDK-correlated outcome checks. The soak worker uses the same terminal lane.
- `scripts/tui.mjs` and `scripts/tui/`: the `codex-ghcp-tui-12-v1` real-TUI matrix. Each case runs `bin/codex-ghcp` in a private PTY rendered and driven by headless Playwright/xterm.js, samples processes under the bridge's Copilot runtime, reads Codex's own rollout, and recomputes checks from saved facts.
- `scripts/soak/terminal.mjs` and `browser.mjs`: one owned PTY lifecycle with either the independent parser or a Playwright/xterm renderer. Browser input and output use the real PTY, not a simulated assistant; cancellation reaps both the terminal group and owned browser.

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
- Model, tool, instruction or history changes cannot replace a session with unresolved calls. Codex's appended plugin-provenance sentence on a function tool is accepted as metadata only when its name, schema and original description still match. Once there are no pending calls, an incompatible full history can start a new SDK session.

Local compaction has one explicit handoff boundary: a tool-less, full-history request may resolve all outstanding calls in its new suffix while retaining the exact prior history, model and instructions. The bridge validates every result, aborts the old SDK session without resubmitting those results, and replays the completed transcript into a tool-less summarization session. Missing, duplicate, wrong-type or rewritten results still fail before retiring the original session. This lets Codex compact immediately after executing tools without either a `pending_session_changed` loop or duplicate execution.

The SDK's send interface is not a general Responses transcript-import API. Cold starts with historical messages serialize non-instruction history into context for a new user prompt, preserving assistant phases. Delimiter characters inside the JSON are escaped without changing the decoded text. This is an approximation, not native role-preserving replay or a guarantee of identical answers. Ordinary matching live turns do not use that replay path.

`model-map.mjs` selects the largest advertised context tier for each model: `long_context` when `billing.tokenPrices.longContext` or `supportedContextTiers` advertises support, otherwise `default`. The shared selector drives both catalog budgets and SDK session configuration; tier identity is part of the session signature and survives effort changes, history rebuilds and idle recovery. Tier changes cannot replace a session with pending calls, and an upstream rejection never silently falls back. Catalog input budgets respect the selected tier's prompt limits and reserve maximum output space within the model's total context window; Codex starts local automatic compaction at 80% of that budget. Independent SDK compaction remains disabled. Structured SDK context-limit failures retain the Responses `context_length_exceeded` code, allowing Codex to distinguish overflow from retryable transport failure. The launcher disables automatic HTTP/stream retries; exact client retries can still use the bridge's existing success cache.

## Lifetime and security boundaries

The HTTP listener is loopback-only and requires a bridge-specific credential except for `/health`. Launchers pass a generated local credential through child-process environment variables; they do not copy Copilot authentication into Codex configuration.

Session count, idle lifetime, body size, history size and turn duration are bounded. Client disconnect or a failed/timed-out turn evicts its bridge-owned SDK session. Cleanup attempts abort, disconnect and delete with deadlines. Shutdown stops this project's SDK client, with a forced stop fallback if graceful cleanup fails. TTL/capacity eviction can invalidate pending calls; clients receive an explicit error rather than a fabricated tool result.

The model-progress watchdog is separate from idle-session expiry and the absolute turn deadline. Root text, reasoning/tool-input fragments and increasing safe-integer `assistant.streaming_delta.totalResponseSizeBytes` counters refresh it; hidden progress is never forwarded as answer text. The byte counter resets at root turn boundaries. Invalid/unchanged counters, heartbeats and subordinate activity cannot mask a stalled root response. `bridge.turn_watchdog` records content-free timing every `min(SDK_READINESS_INTERVAL_MS, TURN_IDLE_TIMEOUT_MS)`; `bridge.turn_stalled` records the model, phase, bounded event name and timing on expiry. Session creation and model-setting use the smaller of the SDK startup and turn deadlines; a hung control RPC cannot consume the whole default five-minute turn budget.

A silent, acknowledged request can recover on the original response stream by rebuilding only its SDK session after confirmed abort/disconnect/delete and a healthy same-generation readiness check. `TURN_IDLE_RECOVERY_ATTEMPTS` defaults to 1 (0 disables; maximum 3). Recovery preserves model, effort, instruction authority, complete resolved history, completed-call identities, response-handle versions and reported usage. Completed tool results are context, never another tool-result RPC. Partial output, unacknowledged input, pending calls, filtering, cancellation, failed cleanup and connection loss forbid replay. The original absolute turn/request deadlines cover all recovery attempts, including replacement setup; cancellation also interrupts setup's MCP checks. `bridge.turn_recovering`, `bridge.turn_recovered` and `bridge.turn_recovery_skipped` expose bounded diagnostics without conversation text. Recovery may consume additional inference usage; completely silent reasoning remains indistinguishable from a stall, and history replay is not exactly-once model execution.

Bridge correlation and retry state live in memory. `store:false` means there is no Responses retrieval store here; it does **not** promise that Copilot, Codex or the SDK never writes local session files or retains service-side data. The bridge avoids logging request bodies and credentials. SDK errors may still contain service diagnostics.

No sibling project's tests, validation runner or validation results are used. Offline tests exercise only this implementation with a fake SDK and local HTTP connections.

## Stability and recovery boundaries

- `request-queue.mjs` owns cancellable per-family FIFO admission, total request deadlines and bounds. Cancellation settles before cleanup, but the family lock is held until cleanup completes.
- `sdk-lifecycle.mjs` owns bounded ping checks, single-flight connection recovery and fresh client generations. Connection loss fails affected conversations explicitly without inference or tool-result replay; it is distinct from the bounded idle recovery on a healthy connection above.
- Tool-list ordering is metadata; real policy changes remain rejected. Conflict diagnostics contain field names, hashes and counts rather than raw text.
- Delta/final stream reconciliation happens before committing the success cache or pending-tool state.
- `/health` reports HTTP liveness, last-known readiness and the running `turnWatchdog` settings; an older process without that field has not loaded this implementation. Authenticated `/readyz` probes the SDK. Catalog requests may trigger safe connection recovery.

Defaults, errors and the separate 66-cell stability contract are documented in the [stability guide](STABILITY_TESTING.md). Historical v3 stability and v4 compatibility evidence is verified with frozen source, never regraded.

- SDK-managed system/safety instructions are retained with append mode. All top-level client system/developer messages, including mid-history ones, are collected with request instructions; their text is appended unchanged. A changed instruction policy rebuilds an idle session and is rejected while tools are pending. SDK built-in tools remain excluded and permission requests remain rejected.
- New user messages accompanying tool results use SDK immediate steering before results are released, not text appended to a tool output. Tool-result text remains byte-exact and exact retries do not repeat either operation.
- Assistant tool calls must match their pending SDK request IDs, session ID, tool names and JSON arguments before handoff. Top-level `agentId` and legacy payload `agentId`/`parentToolCallId` exclude subordinate events from root responses.
- Text completion waits for root `session.idle`, not an intermediate `assistant.turn_end`. A tool handoff instead waits for the matching pending requests, since the SDK cannot become idle until Codex returns their results. An empty answer with no tool calls fails rather than entering the success cache.
