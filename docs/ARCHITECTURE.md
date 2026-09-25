# Architecture

[한국어](ARCHITECTURE_KO.md) · [Quick start](../README.md) · [Usage](USAGE.md) · [Compatibility](COMPATIBILITY.md)

This is the implementation reference. For running, configuring or restarting the bridge, use the [usage guide](USAGE.md).

**Jump to:** [Source map](#modules) · [Tool ownership](#tool-handoff) · [Conversation state](#conversation-continuity) · [Timeouts and recovery](#model-progress-and-recovery) · [Data retention](#data-retention).

### Terms used here

| Term | Meaning |
| --- | --- |
| SDK session | One Copilot SDK conversation that the bridge creates and owns. |
| Conversation family | All requests that belong to one Codex conversation, identified by Codex's session or thread headers, a known response ID or a live tool call. They share one queue and one state. |
| Pending call | A tool call the model requested whose result Codex has not returned yet. |
| Handoff | Passing completed tool results back to the SDK, or replacing an SDK session while keeping the conversation. |
| Root and subordinate events | Events from the main conversation, and events from helper agents or reviews inside it. Only root events form the response. |
| Client generation | One started SDK client. Connection recovery always starts a new generation. |
| SDK double | A local stand-in for the Copilot SDK, used by offline tests. |

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
| [sdk-lifecycle.mjs](../src/sdk-lifecycle.mjs) | SDK readiness and connection/catalog recovery, separate from idle/transport turn recovery. |
| [copilot-session-rpc.mjs](../src/copilot-session-rpc.mjs) | Bounded abort/disconnect/delete and pending-tool-result RPCs. |
| [mcp-isolation.mjs](../src/mcp-isolation.mjs) | Read Copilot user/plugin MCP names and pass `disabledMcpServers` on every bridge session. |
| [model-map.mjs](../src/model-map.mjs) | Allowed IDs, default model, Codex catalog and SDK-derived context/effort limits; no fallback model. |
| [copilot-home.mjs](../src/copilot-home.mjs), [list-models.mjs](../src/list-models.mjs) | Resolve the existing Copilot home and list account models. |
| [launcher.mjs](../src/launcher.mjs), [bridge-daemon.mjs](../src/bridge-daemon.mjs), [bin/](../bin/) | Owned bridge lifecycle, per-process Codex configuration, private model catalog and optional background operation. |

The temporary catalog replaces bundled/cached picker entries and is removed on Codex exit. Entries declare `apply_patch_tool_type: "freeform"`, so Codex offers its native `apply_patch` tool.

### Verification harnesses

There is one [verification entry point](../scripts/verify.mjs) and one [essential contract](VERIFICATION.md): actual Codex → production bridge → real Copilot SDK → exact model. The [implementation](../scripts/verification/) runs six essential scenarios on all six models, automatically freezes source and recomputes saved facts. The shared PTY/browser code also supports offline safety regressions; these helpers are not separate live suites.

## Tool handoff

1. Codex declares function tools or custom/freeform tools, including declarations nested in an `additional_tools` input item.
2. The bridge registers SDK tools **without execution handlers** and exposes only their `custom:<name>` entries.
3. An SDK assistant message supplies a tool call. `external_tool.requested` supplies its corresponding pending `requestId`.
4. The HTTP response returns a `function_call` or `custom_tool_call` to Codex. The bridge does not run it.
5. Codex applies its normal sandbox and approval policy, executes the tool, and sends its output in another Responses request.
6. The bridge submits that output with `session.rpc.tools.handlePendingToolCall({requestId, result})` and streams the resumed assistant response.

- **SDK tool isolation:** SDK built-in tools and tool search are not enabled. The Copilot runtime's own user and plugin MCP servers are disabled at session creation, so they do not start. A bounded `session.mcp.list` check then stops any server from an unscanned source and disables it for later sessions. Codex's own MCP tools still work: Codex runs them and declares them like other tools.
- **Argument formats:** a function tool uses JSON arguments. A custom tool reaches the SDK as an object with one required `input` string, which becomes `custom_tool_call.input` with no newline normalization or extra JSON encoding. A supplied grammar is explanatory context for the model, **not** grammar-constrained decoding in the SDK.
- **Result batches:** all pending results from a turn must be returned together. Unknown, duplicate, wrong-type and incomplete result batches fail before submission.
- **Permissions:** unexpected SDK permission requests are denied. `skipPermission` on a handlerless bridge tool only avoids a second SDK prompt; it does not approve execution in Codex.

## Conversation continuity

- Codex `session-id`/`thread-id` headers identify a conversation. With no headers, a known `previous_response_id` or live tool call can identify it; otherwise a new isolated conversation is created.
- Requests within a conversation are serialized. Independent conversations use independent SDK sessions.
- For full-history requests, a canonical prefix comparison removes already-processed items. Wire-only IDs/status are ignored; assistant `phase` and custom input bytes remain significant. An omitted old phase reuses the known value, while an explicitly changed phase is a history change.
- `previous_response_id` supports process-local continuation, not a durable Responses store. Only the current conversation version can be continued.
- An exact retry of the most recent successful normalized request returns its cached result without resubmission while the session state remains live and valid. Failed requests and evicted sessions have no success cache.
- Once there are no pending calls, an incompatible full history can start a new SDK session. Changes while results are pending use the handoff below.

### Changing configuration with completed tools

A **completed-result handoff** replaces an SDK session when Codex returns all pending tool results together with changed settings. It supports full history, `previous_response_id` and inferred result-only continuation. Model, context tier, tools and trusted top-level instructions may change together.

1. Validate exactly one matching result for every outstanding call. Prior user/assistant content, phases, call identities/arguments and historical results must match. Reject invalid batches **before retiring the original session**.
2. Confirm abort/disconnect/delete of the old session and readiness of the same SDK client generation.
3. Create the requested configuration. Supply completed calls/results only as serialized history, **never as old result RPCs**. Keep top-level instructions in the instruction channel.

- **Metadata that is not a change:** Codex's appended plugin-provenance sentence on a function tool counts as metadata only while the tool's name, schema and original description still match. Tool-less local compaction uses the same handoff boundary.
- **What survives:** completed call identities and response versions. Exact retries use the new cache, and old response handles stay stale. This prevents duplicate result-RPC submission and completed-ID reuse; it cannot stop a model from proposing the same operation under a new call ID.
- **Failures:** unconfirmed cleanup or readiness returns `session_handoff_failed`. Cancellation or a failed replacement leaves the conversation family unavailable instead of silently replaying it on retry.
- **Diagnostics:** `bridge.session_handoff`, `bridge.session_handoff_failed` and `bridge.pending_session_changed` record request IDs and bounded field and count metadata, not conversation text.

### Resuming without a live SDK session

When a conversation has no live SDK session, for example after a bridge restart, the bridge rebuilds one from the history Codex sends:

- The SDK's send interface is not a general Responses transcript-import API, so a cold start serializes the non-instruction history into context, keeping assistant phases. If the final item is a user message, its exact text is sent once after that history as the **current request**, rather than hidden inside the historical JSON. This also applies to compaction, model changes and safe turn recovery.
- Delimiter characters inside the JSON are escaped without changing the decoded text.
- This is an approximation: it is not native role-preserving replay and does not guarantee identical answers.
- Ordinary live turns that match the known history do not use this replay path.

### Context budgets

- **Tier choice:** `model-map.mjs` selects the largest advertised context tier for each model: `long_context` when `billing.tokenPrices.longContext` or `supportedContextTiers` advertises support, otherwise `default`.
- **One selector for everything:** the same selector drives the catalog budgets and the SDK session configuration. The tier is part of the session signature, so it survives effort changes, history rebuilds and turn recovery. Changing the tier while calls are pending needs the complete-result handoff above, and an upstream rejection never silently falls back.
- **Budget:** catalog input budgets take the minimum valid advertised prompt/context limit and reserve maximum output space when valid context/output sizes are supplied. The launcher rejects an absent or invalid budget. Codex starts local automatic compaction at 80% of that budget; the SDK's own compaction stays disabled.
- **Overflow errors:** structured SDK context-limit failures keep the Responses `context_length_exceeded` code, so Codex can tell overflow apart from a retryable transport failure. The launcher disables automatic HTTP and stream retries; an exact client retry can still use the bridge's success cache.

## Lifetime and security boundaries

- **Access:** the HTTP listener is loopback-only and requires a bridge-specific credential on every route except `/health`. Launchers pass a generated local credential through child-process environment variables; they do not copy Copilot authentication into Codex configuration.
- **Bounds:** session count, idle lifetime, body size, history size and turn duration are all limited.
- **Eviction:** a client disconnect, or a failed or timed-out turn, evicts its bridge-owned SDK session. Cleanup attempts abort, disconnect and delete, each with a deadline. TTL or capacity eviction can invalidate pending calls; clients then get an explicit error, never a made-up tool result.
- **Shutdown:** stops this project's SDK client, with a forced stop if graceful cleanup fails.

### Model progress and recovery

The model-progress watchdog is separate from idle-session expiry. Its two inactivity limits run inside the five-minute absolute turn and six-minute request deadlines:

| `waitPhase` | Default limit | What refreshes it |
| --- | --- | --- |
| `first_progress` | `TURN_FIRST_PROGRESS_TIMEOUT_MS`: 180 seconds | Nothing. Each attempt gets one initial allowance. |
| `streaming` | `TURN_IDLE_TIMEOUT_MS`: 90 seconds | Real root progress, as defined below. |

- **What counts as progress:** root text, reasoning or tool-input fragments, and an increasing safe-integer `assistant.streaming_delta.totalResponseSizeBytes`. Each switches to the streaming limit and refreshes it. Byte counters reset on a distinct root turn ID, not on a duplicate start.
- **Fusion phases:** registered Fusion phases in the root conversation also count increasing private-output bytes and one successful completion per phase. At most 64 phase identities are tracked per root turn; private phase content is never read or forwarded.
- **What does not count:** `assistant.turn_start` is initialization, not inference progress. Phase starts alone, phase tools, review or subordinate events, and duplicate or invalid counters cannot extend the deadline. Root `model.call_failure` metadata is diagnostic only, limited to a bounded failure category and a numeric HTTP status.
- **Diagnostics:** `bridge.turn_watchdog` runs every `min(SDK_READINESS_INTERVAL_MS, TURN_IDLE_TIMEOUT_MS, TURN_FIRST_PROGRESS_TIMEOUT_MS)` and records `waitPhase`. `bridge.turn_stalled` records the limit that applied and the last real progress. Session creation and model-setting use the smaller of the SDK startup and turn deadlines.

#### Bounded turn recovery

A silent request whose input was acknowledged can recover on its original response stream by rebuilding only its SDK session. The same shared attempt budget also covers a terminal root `session.error` of type `query` preceded by structured, root-only `model.call_failure` transport metadata, with no API error codes/status or model progress. A query message or a connection-error string alone never authorizes a retry. Individual model-call failures remain diagnostic while the SDK performs its own recovery.

- **Preconditions:** the bridge first confirms abort, disconnect and delete of the old session and a healthy readiness check on the same client generation. `TURN_IDLE_RECOVERY_ATTEMPTS` defaults to 1 and is shared by idle and transport recovery (0 disables these turn retries; the maximum is 3). It does not control connection/catalog recovery or the SDK/provider's internal retries.
- **What is kept:** model, effort, instruction authority, the complete resolved history, completed-call identities, response-handle versions and reported usage. Completed tool results become context, **never another tool-result RPC**.
- **What forbids it:** partial output, unacknowledged input, pending calls, filtering, cancellation, failed cleanup and connection loss. Transport recovery additionally rejects any observed root reasoning/tool-input/stream bytes, usage or Fusion output, API failures, authentication/rate-limit/quota errors and uncertain delivery.
- **Deadlines:** all attempts and the replacement setup share the original turn and request deadlines; recovery does not reset them. Cancellation also interrupts the setup's MCP checks.
- **Diagnostics:** `bridge.turn_transport_failed`, `bridge.turn_recovering`, `bridge.turn_recovered` and `bridge.turn_recovery_skipped` report bounded details without conversation text. Recovery receipts identify the retired bridge-owned session, cause and original response ID.
- **Limits:** recovery may use extra inference. Completely silent reasoning cannot be told apart from a stall, and history replay is not exactly-once model execution.

### Data retention

Bridge correlation and retry state live in memory. `store:false` means there is no Responses retrieval store here; it does **not** promise that Copilot, Codex or the SDK never writes local session files or retains service-side data. The bridge avoids logging request bodies and credentials. SDK errors may still contain service diagnostics.

No sibling project's tests, validation runner or validation results are used. Offline tests exercise only this implementation with a fake SDK and local HTTP connections.

## Stability and recovery boundaries

- **Startup catalog recovery:** the first `listModels` call receives at most half of `SDK_STARTUP_TIMEOUT_MS` (15 seconds by default), capped by the remaining time. A deadline, recognized transport code, HTTP 500/502/503/504 or JSON-RPC internal/connection error can permit one fresh client after confirmed `forceStop`. Start, ping, both catalog attempts and the retry share the original 30-second default budget; cleanup retains its separate bound. Known authentication/authorization/quota/rate-limit rejection, invalid parameters, cancellation, unknown errors, failed cleanup and reused clients do not qualify. These rejection signals take precedence over a generic server/transport wrapper. Bounded `catalogFailure` metadata explains the decision without recording upstream messages. Late completion can clean only its retired client. This retry applies only to the read-only catalog, never inference or tool-result submission.

- **Queues:** `request-queue.mjs` owns cancellable per-family FIFO admission, total request deadlines and bounds. A cancelled waiter is removed at once and can never run later. Cancellation settles before cleanup, but the family lock is held until cleanup completes.
- **Connection recovery:** `sdk-lifecycle.mjs` owns bounded ping checks, single-flight connection recovery and fresh client generations. One shared recovery task, with bounded startup and backoff, serves concurrent requests instead of each starting a client. Connection loss invalidates and explicitly fails the affected conversations without replaying inference or uncertain tool results. This is separate from bounded turn recovery on a healthy SDK connection above.
- **Tool lists:** tools are compared by identity, so their order is metadata. Real policy changes while calls are pending require the complete-result handoff above. Conflict (409) diagnostics contain request IDs, field names, hashes and counts rather than raw text.
- **Commit order:** delta/final stream reconciliation happens before the success cache or pending-tool state is committed. A successful result can then serve an identical retry while the state remains valid; a stream protocol mismatch cannot cache an undelivered tool call as success. Network delivery and model generation are not one exactly-once transaction.
- **Health routes:** public `/health` reports HTTP-process liveness, the last-known `ready` and `upstreamState` fields and the running `turnWatchdog` settings; an older process without that field has not loaded this implementation. Authenticated `/readyz` runs a bounded SDK readiness probe (200 or 503) and does not reconnect by itself. Authenticated `/v1/models` may recover the SDK connection before answering. Readiness does not guarantee inference service health or quota.

Timeout defaults and error codes are in the [usage guide](USAGE.md#timeouts-and-recovery); current integration checks are in the [single verification guide](VERIFICATION.md). The retained final run includes its matching source snapshot.

### Instruction and response boundaries

- SDK-managed system/safety instructions are retained with append mode. All top-level client system/developer messages, including mid-history ones, are collected with request instructions; their text is appended unchanged. A changed instruction policy rebuilds an idle session or uses a validated complete-result handoff. SDK built-in tools remain excluded and permission requests remain rejected.
- New user messages accompanying tool results use SDK immediate steering before results are released, not text appended to a tool output. Tool-result text remains byte-exact and exact retries do not repeat either operation.
- Assistant tool calls must match their pending SDK request IDs, session ID, tool names and JSON arguments before handoff. Top-level `agentId` and legacy payload `agentId`/`parentToolCallId` exclude subordinate events from root responses.
- Text completion waits for root `session.idle`, not an intermediate `assistant.turn_end`. A tool handoff instead waits for the matching pending requests, since the SDK cannot become idle until Codex returns their results. An empty answer with no tool calls fails rather than entering the success cache.
