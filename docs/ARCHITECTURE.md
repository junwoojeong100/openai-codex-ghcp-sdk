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
- `model-map.mjs`: the seven allowed IDs, default selection, OpenAI/Codex catalog metadata and reasoning-effort checks. Model context limits and supported efforts come from the SDK catalog; there is no automatic model fallback.
- `copilot-home.mjs` and `list-models.mjs`: existing Copilot home resolution and account-specific model listing.
- Launcher/daemon modules and `bin/`: start a project-owned bridge, pass per-process Codex configuration, and manage optional background operation.

## Tool handoff

1. Codex declares function tools or custom/freeform tools, including declarations nested in an `additional_tools` input item.
2. The bridge registers **handlerless** SDK tools and exposes only their `custom:<name>` entries. SDK built-in tools and tool search are not enabled.
3. An SDK assistant message supplies a tool call. `external_tool.requested` supplies its corresponding pending `requestId`.
4. The HTTP response returns a `function_call` or `custom_tool_call` to Codex. The bridge does not run it.
5. Codex applies its normal sandbox and approval policy, executes the tool, and sends its output in another Responses request.
6. The bridge submits that output with `session.rpc.tools.handlePendingToolCall({requestId, result})` and streams the resumed assistant response.

A function tool uses JSON arguments. A custom tool is represented to the SDK by an object containing one required `input` string. The string becomes `custom_tool_call.input` without newline normalization or an additional JSON encoding layer. A supplied grammar is explanatory context for the model, **not** grammar-constrained decoding in the SDK.

All pending results from a turn must be returned together. Unknown, duplicate, wrong-type and incomplete result batches fail before submission. Unexpected SDK permission requests are denied; `skipPermission` on a handlerless bridge tool only avoids a second SDK prompt and does not approve its execution in Codex.

## Conversation continuity

- Codex `session-id`/`thread-id` headers identify a conversation. With no headers, a known `previous_response_id` or live tool call can identify it; otherwise a new isolated conversation is created.
- Requests within a conversation are serialized. Independent conversations use independent SDK sessions.
- For full-history requests, a canonical prefix comparison removes already-processed items. Wire-only IDs/status/phase are not used for comparison; custom input bytes remain significant.
- `previous_response_id` supports process-local continuation, not a durable Responses store. Only the current conversation version can be continued.
- An exact retry of the most recent normalized request returns its cached result without resending the prompt or tool results.
- Model, tool, instruction or history changes cannot replace a session with unresolved calls. Codex's appended plugin-provenance sentence on a function tool is accepted as metadata only when its name, schema and original description still match. Once there are no pending calls, an incompatible full history can start a new SDK session.

The SDK's send interface is not a general Responses transcript-import API. Cold starts with historical messages serialize that history into context for a new user prompt. This is an approximation, not native role-preserving replay or a guarantee of identical answers. Ordinary matching live turns do not use that replay path.

## Lifetime and security boundaries

The HTTP listener is loopback-only and requires a bridge-specific credential except for `/health`. Launchers pass a generated local credential through child-process environment variables; they do not copy Copilot authentication into Codex configuration.

Session count, idle lifetime, body size, history size and turn duration are bounded. Client disconnect or a failed/timed-out turn evicts its bridge-owned SDK session. Cleanup attempts abort, disconnect and delete with deadlines. Shutdown stops this project's SDK client, with a forced stop fallback if graceful cleanup fails. TTL/capacity eviction can invalidate pending calls; clients receive an explicit error rather than a fabricated tool result.

Bridge correlation and retry state live in memory. `store:false` means there is no Responses retrieval store here; it does **not** promise that Copilot, Codex or the SDK never writes local session files or retains service-side data. The bridge avoids logging request bodies and credentials. SDK errors may still contain service diagnostics.

No sibling project's tests, validation runner or validation results are used. Offline tests exercise only this implementation with a fake SDK and local HTTP connections.

## Stability and recovery boundaries

- `request-queue.mjs` owns cancellable per-family FIFO admission, total request deadlines and bounds. Cancellation settles before cleanup, but the family lock is held until cleanup completes.
- `sdk-lifecycle.mjs` owns bounded ping checks, single-flight recovery and fresh client generations. Lost conversations fail explicitly; uncertain side effects are not automatically replayed.
- Tool-list ordering is metadata; real policy changes remain rejected. Conflict diagnostics contain field names, hashes and counts rather than raw text.
- Delta/final stream reconciliation happens before committing the success cache or pending-tool state.
- `/health` reports HTTP liveness and last-known readiness; authenticated `/readyz` probes the SDK. Catalog requests may trigger safe connection recovery.

Defaults, errors and the separate 77-cell contract are documented in the [stability guide](STABILITY_TESTING.md). Historical v4 evidence is verified with frozen source, never regraded.

- SDK-managed system/safety instructions are retained with append mode. Complete client instructions are appended unchanged; SDK built-in tools remain excluded and permission requests remain rejected.
