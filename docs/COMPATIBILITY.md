# Compatibility

[한국어](COMPATIBILITY_KO.md) · [Usage](../README.md) · [Architecture](ARCHITECTURE.md)

## Scope

The target is Codex CLI **0.154.0** with `@github/copilot-sdk` **1.0.14**. This is a text-and-client-tools adapter, not a complete OpenAI Responses implementation. A model being enabled in Copilot does not certify every Codex feature. Offline test results and authenticated model runs are distinct checks.

Only `claude-opus-5.5`, `claude-sonnet-5`, `claude-haiku-4.5`, `gpt-6-astra`, `gpt-6-sol` and `gpt-6-luna` are allowed, in that picker order. Account policy still controls availability. Removed IDs (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `claude-opus-5`) are rejected by the launcher and bridge. Model IDs are passed to the SDK without cross-provider renaming or fallback.

## Implemented behavior

- `POST /v1/responses`, with either JSON or HTTP/SSE text output; authenticated `GET /v1/models` and public `GET /health`.
- Text messages, system/developer instructions throughout the supplied transcript, client function tools, and custom/freeform tools.
- Codex tool namespaces and `additional_tools` declarations. Function arguments retain JSON meaning; custom tool input retains the original string.
- Multiple pending calls and a following batch containing all corresponding outputs.
- `parallel_tool_calls=false`: at most one call is forwarded per response. If the SDK emits multiple calls, none are forwarded and the turn fails with `parallel_tool_calls_violation`; this validates the output, not the model's decoding behavior.
- Live full-history prefix matching, per-conversation serialization, and process-local `previous_response_id` continuation.
- Exact retries of the latest request without duplicate prompt/result submission.
- Client cancellation, SDK deadlines, bounded in-memory state and idle/capacity eviction.
- Reasoning effort only when supported by the selected model's catalog. Haiku 4.5 is not effort-configurable.
- A launch-owned main-model picker catalog, maximum-advertised-tier input budgets, and native local auto-compaction after complete tool-result handoffs. `npm run test:context:runtime` covers these with the actual Codex CLI and a fake SDK, not maximum-context or endurance inference.

## Important approximations

**Custom grammar:** a custom tool becomes an SDK JSON-schema tool with a required `input` string. Grammar is included as model guidance, not enforced by the decoder. Codex remains responsible for parsing and executing the returned raw input.

**Historical replay:** a fresh SDK session cannot import an arbitrary Responses transcript with native roles. Completed historical turns are serialized into prompt context. Live matching conversations preserve the SDK session and submit real pending tool results instead.

**Instruction boundaries:** request instructions and all top-level system/developer messages are preserved verbatim and appended to the SDK-managed system foundation, even when an instruction occurs mid-history. The bridge uses `systemMessage.mode="append"`, never `replace`, so SDK safety instructions remain in place. Both instruction roles share this SDK field; arbitrary historical user/assistant roles still require serialized replay, not a general-purpose role-equivalent transcript import. On unchanged live sessions, new user messages accompanying pending results use separate SDK immediate steering. A trusted instruction update with all pending results instead rebuilds the session after confirmed cleanup, keeping instructions authoritative and tool outputs byte-exact in serialized history. Incomplete or rewritten conversation input still fails before retirement. SDK built-in tools remain unavailable, and only Codex performs client tools under its sandbox and approval policy.

**Assistant phases and completion:** `commentary` and `final_answer` survive canonicalization and replay, following the [Responses phase semantics](https://developers.openai.com/api/docs/guides/reasoning#phase-parameter). Omitted old phases reuse known values; explicit phase changes invalidate the live prefix. Text responses finish at root `session.idle`, allowing intervening corrections, usage and errors to arrive. Tool responses instead require fully correlated pending external calls. Empty, tool-less responses and mismatched pending calls fail before success commitment.

**Usage:** actual SDK token counts are returned when available. Missing usage is `null`, not estimated. Usage, caching and billing belong to Copilot and need not match OpenAI billing semantics.

**Persistence:** response correlation is memory-only. Restart, TTL or capacity eviction invalidates response IDs and unresolved calls. `store:false` does not disable Codex/SDK local files or promise zero retention by Copilot.

**Reasoning summary policy:** SDK session creation and model-setting updates explicitly use `reasoningSummary: "none"`, matching the launcher’s disabled-summary policy. Requested reasoning effort is preserved independently. This is configuration consistency, not an established cause or fix for upstream refusals.

## Rejected or disabled

- WebSocket transport, compressed requests and remote Responses compaction.
- Images, audio, video, files as model input, and non-text tool outputs.
- Provider-hosted web search, code interpreter, file search and other server-side built-in tools.
- Strict tool-schema enforcement, structured JSON output and required/named tool choice.
- Temperature, top-p, explicit output-token/tool-call limits and automatic request truncation.
- Reasoning summaries/encrypted reasoning replay, durable response retrieval, stored/background Responses jobs and custom service tiers.

The launcher disables incompatible transport/search features. Other unsupported semantics fail explicitly instead of being advertised as implemented. Informational Codex hints such as cache keys, metadata, text verbosity or encrypted-reasoning inclusion can be diagnosed as ignored; they do not add the corresponding service capability.

Codex 0.154 sends one extra request after the first prompt of a thread to generate a short task title, and that request uses a JSON schema. The bridge rejects it with HTTP 400 (`Structured output is not supported`). Codex continues normally without a generated title.

## Upstream-filtered responses

Explicit root SDK content-filter metadata is reported as `upstream_content_filter` (HTTP 422 for JSON, or a terminal `response.failed` event after SSE has begun). No success cache or pending call is committed for that turn, and there is no automatic replay. Already-delivered partial text is marked incomplete. Refusal-like text without structured filter metadata is preserved as ordinary model output; subordinate-agent metadata does not replace the root response.

## Operational notes

- Choose the initial model with `--ghcp-model`; `/model` uses the launch's account-enabled subset of the six allowed models in pinned order. The launch-owned catalog is temporary and does not change the user's Codex configuration files.
- A result batch must include every outstanding call exactly once. Configuration changes, including tool-less compaction, require a complete-result handoff with unchanged non-instruction history and confirmed cleanup/readiness. Completed IDs and stale response versions survive; old result RPCs are never resubmitted. Serialized history cannot guarantee that a model will not request the same operation under a new ID.
- SDK sessions select the maximum advertised context tier (`long_context` where available, otherwise `default`); Codex compacts at 80% of the catalog's effective input budget. Context overflow keeps the `context_length_exceeded` error code, and the launcher disables automatic HTTP/stream inference retries. First progress has a separate 180-second allowance, followed by the 90-second streaming inactivity limit; both remain capped by the absolute turn/request deadlines.
- The most recent result is retryable, but arbitrary historical response branches are not. Start a new full-history conversation to branch.
- Codex retains its normal sandbox and approval behavior. The bridge never substitutes an approval-bypass option.
- Background-daemon state is specific to this project. Status/stop must verify the owned instance before reuse or termination.
- Newer CLI releases may add fields or tools that require changes to this adapter. Pin versions until you have checked the new protocol.

Filter monitoring remains active after tool handoff and idle. A late root signal invalidates the next cached retry or pending-result continuation; already-delivered output cannot be retracted. The first observed fault is retained if later SDK shutdown errors occur. See [Opus upstream diagnostics](OPUS_DIAGNOSTICS.md) for opt-in, privacy-bounded native refusal evidence.
