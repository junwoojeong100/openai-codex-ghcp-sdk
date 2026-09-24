# Compatibility

[한국어](COMPATIBILITY_KO.md) · [Quick start](../README.md) · [Usage](USAGE.md) · [Architecture](ARCHITECTURE.md)

**Text chat and the tools Codex runs itself are supported; the full OpenAI Responses API is not.** The table below is the practical boundary for Codex CLI **0.154.0** with Copilot SDK **1.0.14**. A model being available does not mean every feature works with it.

## Can I use this feature?

| Task | Status | Details |
| --- | --- | --- |
| Chat, read and edit local files, run shell commands | **Supported** | Through Codex's own tools, with Codex's approvals and sandbox. Tools read the files; files are not attached to the model. |
| Use Codex MCP tools | **Supported** | The Copilot runtime's separate MCP servers stay disabled. |
| Switch models or compact locally | **Supported** | Within the [context limits](USAGE.md#model-selection-and-context). |
| Resume a saved conversation | **Supported** | From Codex's saved history. A restarted bridge cannot restore unresolved tool calls; see [resume behavior and model selection](USAGE.md#resume-a-conversation). |
| Use `apply_patch` or another custom tool | **Approximate** | Works, but the grammar is guidance for the model, not enforced during generation. |
| Attach images, audio, video or files directly | **Unsupported** | Model input and tool results must be text. |
| Require schema-constrained JSON | **Unsupported** | You can ask for JSON in a prompt, but no schema is guaranteed. Automatic titles are unavailable, and native review requests fail when they need this format. |
| Use provider-hosted web search | **Unsupported** | Separate from client-side Codex MCP tools, which work. |
| Use WebSockets or remote Responses compaction | **Unsupported** | Keep the launcher's HTTP/SSE and local-compaction defaults. |

For launch errors, see [troubleshooting](USAGE.md#troubleshooting). The rest of this page is protocol reference for developers; it adds no setup steps.

## Scope

- **Versions:** checked with Codex CLI **0.154.0** and `@github/copilot-sdk` **1.0.14**. Newer releases can add fields or tools that need adapter changes; keep the pinned versions until you have checked the new protocol.
- **Evidence:** offline tests check the bridge against simulated SDK responses. Only [recorded live runs](validation/README.md#recorded-results) show how real models behaved.
- **Models:** only the [six supported model IDs](../README.md#models) are allowed, in the documented picker order, and account policy still controls availability. Other IDs, including retired models, are rejected. IDs reach the SDK unchanged, with no cross-provider renaming or fallback.

## Implemented behavior

- **Routes:** `POST /v1/responses` with JSON or HTTP/SSE text output; authenticated `GET /v1/models` and `GET /readyz`; public `GET /health`.
- **Input:** text messages, system and developer instructions anywhere in the supplied transcript, client function tools and custom (freeform) tools.
- **Tool declarations:** Codex tool namespaces and `additional_tools`. Function arguments keep their JSON meaning; custom tool input keeps the original string.
- **Tool results:** several pending calls at once, answered by one following batch that contains every output.
- **`parallel_tool_calls=false`:** at most one call is forwarded per response. If the SDK emits several calls, none are forwarded and the turn fails with `parallel_tool_calls_violation`. This checks the output; it does not change how the model decodes.
- **Conversation state:** live full-history prefix matching, one request at a time per conversation, and `previous_response_id` continuation within the running process.
- **Retries:** an exact retry of the latest request does not resubmit the prompt or tool results.
- **Limits:** client cancellation, SDK deadlines, bounded in-memory state and eviction of idle or excess conversations.
- **Reasoning effort:** only when the selected model's catalog supports it. Haiku 4.5 has no configurable effort.
- **Model catalog and context:** a launch-owned picker catalog, input budgets from the largest advertised tier, and native local auto-compaction after complete tool-result handoffs. `npm run test:context:runtime` covers these with the actual Codex CLI and a fake SDK; it does not test maximum-context or endurance inference.

## Important approximations

Each item below works, but not exactly like the native OpenAI Responses API.

- **Custom grammar:** a custom tool becomes an SDK JSON-schema tool with one required `input` string. The grammar is sent as guidance for the model; the decoder does not enforce it. Codex still parses and runs the returned raw input.
- **History replay:** a new SDK session cannot import an arbitrary Responses transcript with native roles, so completed earlier turns are serialized into the prompt context. While a conversation stays live and matching, the bridge keeps its SDK session and submits real pending tool results instead.
- **Instructions:** the SDK's own system and safety instructions stay in place. Request instructions and every top-level system or developer message, including ones in mid-history, are appended unchanged (`systemMessage.mode="append"`, never `replace`). Both roles share that SDK field. Earlier user and assistant messages still need serialized replay, because there is no general role-preserving transcript import.
  - On an unchanged live session, new user messages sent with pending results use the SDK's separate immediate steering; they are not added to tool output.
  - A trusted instruction update sent with all pending results rebuilds the session after cleanup is confirmed. Instructions stay authoritative, and tool outputs stay byte-exact in serialized history. Incomplete or rewritten conversation input fails before the old session is retired.
  - SDK built-in tools stay unavailable. Only Codex runs client tools, under its own sandbox and approval policy. See the [handoff procedure](ARCHITECTURE.md#changing-configuration-with-completed-tools).
- **Assistant phases:** `commentary` and `final_answer` survive normalization and replay, following the [Responses phase semantics](https://developers.openai.com/api/docs/guides/reasoning#phase-parameter). An omitted old phase reuses the known value; an explicit phase change invalidates the live prefix.
- **Completion:** a text response finishes at root `session.idle`, so late corrections, usage and errors can still arrive. A tool response instead finishes when every pending external call is correlated. Empty responses without tool calls, and mismatched pending calls, fail before anything is saved as a success.
- **Usage:** actual SDK token counts are returned when available; missing usage is `null`, not an estimate. Usage, caching and billing follow Copilot's rules, which need not match OpenAI's.
- **Persistence:** response tracking lives only in memory. A restart, TTL expiry or capacity eviction invalidates response IDs and unresolved calls. `store:false` does not stop Codex or the SDK from writing local files and does not promise zero retention by Copilot.
- **Reasoning summaries:** SDK session creation and model-setting updates explicitly set `reasoningSummary: "none"`, matching the launcher, which disables summaries. The requested reasoning effort is kept separately. This keeps the configuration consistent; it is not a known cause of, or fix for, upstream refusals.

## Rejected or disabled

- WebSocket transport, compressed requests and remote Responses compaction.
- Images, audio, video, files as model input, and non-text tool outputs.
- Provider-hosted web search, code interpreter, file search and other server-side built-in tools.
- Strict tool-schema enforcement, structured JSON output and required or named tool choice.
- Temperature, top-p, explicit output-token or tool-call limits, and automatic request truncation.
- Reasoning summaries, encrypted reasoning replay, durable response retrieval, stored or background Responses jobs and custom service tiers.

The launcher turns off the incompatible transport and search features. Other unsupported features fail with an explicit error instead of pretending to work. Informational Codex hints, such as cache keys, metadata, text verbosity or requests to include encrypted reasoning, may be logged as ignored; they do not add the matching capability.

Codex 0.154 sends one extra request after the first prompt of a thread to generate a short task title, and that request uses a JSON schema. The bridge rejects it with HTTP 400 (`Structured output is not supported`). Codex continues normally without a generated title.

## Upstream-filtered responses

When root SDK `assistant.usage` events report `contentFilterTriggered=true` or `finishReason="content_filter"`, the bridge fails the request with `upstream_content_filter`. It relies on this structured metadata, never on matching refusal-like text.

- JSON requests get HTTP 422. An SSE stream that has already started keeps its HTTP 200 headers but ends with `response.failed`, never `response.completed`.
- Nothing from that turn is saved as a success or a pending call, and the failed session state and response handles are invalidated. The bridge does not disable filters, retry inference or resubmit tool results. Partial text already delivered is marked incomplete; it cannot be retracted.
- Refusal-like text without structured filter metadata stays ordinary model output. Metadata from subordinate agents does not replace the root response.
- Filter monitoring continues after tool handoff and while idle. A late root signal invalidates the next cached retry or pending-result continuation, but output already delivered cannot be taken back. If SDK shutdown errors follow, the first observed fault is kept.

This makes the error explicit; it does not explain why the provider refused, and a filtered turn still counts as a failure, for example in the stability matrix. For opt-in, privacy-bounded evidence about native refusals, see [Opus upstream diagnostics](OPUS_DIAGNOSTICS.md).

## Operational notes

- **Models:** choose the starting model with `--ghcp-model`. `/model` offers the account-enabled subset of the six allowed models, in pinned order. The temporary catalog does not edit Codex's configuration, but Codex can save a `/model` selection to `~/.codex/config.toml`; see [selection and persistence](USAGE.md#model-selection-and-context).
- **Tool results:** a result batch must include every outstanding call exactly once. Completed call IDs and stale response versions are remembered, and old result RPCs are never resubmitted. Serialized history cannot stop a model from requesting the same operation again under a new ID.
- **Configuration changes:** a change while calls are pending, including tool-less compaction, needs a complete-result handoff with unchanged non-instruction history and confirmed cleanup and readiness.
- **Context:** SDK sessions use the largest advertised context tier (`long_context` where available, otherwise `default`), and Codex compacts at 80% of the catalog's input budget. Context overflow keeps the `context_length_exceeded` error code.
- **Timeouts and retries:** the first progress gets its own 180-second allowance, and then the 90-second streaming inactivity limit applies; both stay within the whole-turn and whole-request deadlines. The launcher turns off automatic HTTP and stream retries.
- **Branching:** the latest result can be retried, but arbitrary earlier response branches cannot. To branch, start a new full-history conversation.
- **Approvals:** Codex keeps its normal sandbox and approval behavior; the bridge never substitutes an approval-bypass option.
- **Background bridge:** the default registry is shared across working projects and tied to the checkout that started it. Status and stop verify the bridge instance they own; see [reuse and isolation](USAGE.md#optional-background-bridge).
