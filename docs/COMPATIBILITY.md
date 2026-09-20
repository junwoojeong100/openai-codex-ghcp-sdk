# Compatibility

[한국어](COMPATIBILITY_KO.md) · [Usage](../README.md) · [Architecture](ARCHITECTURE.md)

## Scope

The target is Codex CLI **0.154.0** with `@github/copilot-sdk` **1.0.14**. This is a text-and-client-tools adapter, not a complete OpenAI Responses implementation. A model being enabled in Copilot does not certify every Codex feature. Offline test results and authenticated model runs are distinct checks.

Only `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra`, `claude-opus-5`, `claude-sonnet-5` and `claude-haiku-4.5` are allowed. Account policy still controls availability. Model IDs are passed to the SDK without cross-provider renaming or fallback.

## Implemented behavior

- `POST /v1/responses`, with either JSON or HTTP/SSE text output; authenticated `GET /v1/models` and public `GET /health`.
- Text messages, leading system/developer instructions, client function tools, and custom/freeform tools.
- Codex tool namespaces and `additional_tools` declarations. Function arguments retain JSON meaning; custom tool input retains the original string.
- Multiple pending calls and a following batch containing all corresponding outputs.
- `parallel_tool_calls=false`: at most one call is forwarded per response. If the SDK emits multiple calls, none are forwarded and the turn fails with `parallel_tool_calls_violation`; this validates the output, not the model's decoding behavior.
- Live full-history prefix matching, per-conversation serialization, and process-local `previous_response_id` continuation.
- Exact retries of the latest request without duplicate prompt/result submission.
- Client cancellation, SDK deadlines, bounded in-memory state and idle/capacity eviction.
- Reasoning effort only when supported by the selected model's catalog. Haiku 4.5 is not effort-configurable.

## Important approximations

**Custom grammar:** a custom tool becomes an SDK JSON-schema tool with a required `input` string. Grammar is included as model guidance, not enforced by the decoder. Codex remains responsible for parsing and executing the returned raw input.

**Historical replay:** a fresh SDK session cannot import an arbitrary Responses transcript with native roles. Completed historical turns are serialized into prompt context. Live matching conversations preserve the SDK session and submit real pending tool results instead.

**Instruction boundaries:** leading system/developer messages join the SDK replacement system prompt. Later context travels in a prompt or alongside a tool result; this is not a general-purpose role-equivalent transcript adapter.

**Usage:** actual SDK token counts are returned when available. Missing usage is `null`, not estimated. Usage, caching and billing belong to Copilot and need not match OpenAI billing semantics.

**Persistence:** response correlation is memory-only. Restart, TTL or capacity eviction invalidates response IDs and unresolved calls. `store:false` does not disable Codex/SDK local files or promise zero retention by Copilot.

## Rejected or disabled

- WebSocket transport, compressed requests and remote Responses compaction.
- Images, audio, video, files as model input, and non-text tool outputs.
- Provider-hosted web search, code interpreter, file search and other server-side built-in tools.
- Strict tool-schema enforcement, structured JSON output and required/named tool choice.
- Temperature, top-p, explicit output-token/tool-call limits and automatic request truncation.
- Reasoning summaries/encrypted reasoning replay, durable response retrieval, stored/background Responses jobs and custom service tiers.

The launcher disables incompatible transport/search features. Other unsupported semantics fail explicitly instead of being advertised as implemented. Informational Codex hints such as cache keys, metadata, text verbosity or encrypted-reasoning inclusion can be diagnosed as ignored; they do not add the corresponding service capability.

## Operational notes

- Choose a model with `--ghcp-model`; the bridge catalog is not integrated into Codex's `/model` picker.
- A result batch must include every currently outstanding call exactly once. Changing model, instructions or tools while calls are pending is rejected.
- The most recent result is retryable, but arbitrary historical response branches are not. Start a new full-history conversation to branch.
- Codex retains its normal sandbox and approval behavior. The bridge never substitutes an approval-bypass option.
- Background-daemon state is specific to this project. Status/stop must verify the owned instance before reuse or termination.
- Newer CLI releases may add fields or tools that require changes to this adapter. Pin versions until you have checked the new protocol.
