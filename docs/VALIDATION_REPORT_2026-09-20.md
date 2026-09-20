# Codex × GitHub Copilot SDK validation report — 2026-09-20

[한국어](VALIDATION_REPORT_2026-09-20_KO.md) · [README](../README.md) · [Compatibility and limitations](COMPATIBILITY.md)

## 1. Conclusion

**The Codex → local bridge → GitHub Copilot SDK → `gpt-6-astra` connection worked in the tested environment and within the scope described below.**

| Category | Result |
| --- | --- |
| Repository automated tests (`npm test`) | **63 passed, 0 failed**, with 0 cancelled, skipped or TODO tests |
| Live integration validation | **12 checks passed, 0 failed** |
| Previously running bridge | Health and authenticated model-catalog requests succeeded |
| Actual Codex CLI E2E | One read-only command executed; tool result and final response verified; process exit code `0` |
| JavaScript/Bash syntax and `git diff --check` | Passed |

The automated tests use a fake SDK, so their results are reported separately from live service validation. The 12 integration checks also include readiness, authentication/request rejection and cleanup; they do not represent calls to 12 models.

This is a point-in-time record for a particular source revision, set of versions and account permissions. It does not guarantee support for every model, every Codex feature or future service availability.

## 2. Tested revision and environment

| Item | Value |
| --- | --- |
| Tested source commit | [`acefc14d722df787a14d4af5ca4efcaef4df2e4d`](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/commit/acefc14d722df787a14d4af5ca4efcaef4df2e4d) |
| Validation date | 2026-09-20, Asia/Seoul (UTC+09:00) |
| Live validation started | 2026-09-20 15:00:29.053 KST |
| Live validation completed | 2026-09-20 15:01:30.813 KST |
| Total live validation elapsed time | 61.760 seconds; a single-run observation, not a performance benchmark |
| Node.js | `v22.16.0` |
| npm | `10.9.2` |
| Codex CLI | `0.154.0` |
| Installed Copilot CLI | `1.0.87-0` |
| `@github/copilot-sdk` | `1.0.14` |
| `proper-lockfile` | `4.1.2` |
| Model used for live inference | `gpt-6-astra` |
| Reasoning effort for direct Responses API checks | `reasoning.effort = "max"` |
| Codex CLI E2E configuration | Existing user configuration, `--ephemeral`, `--sandbox read-only`; no additional reasoning-effort override |

Version and installation diagnostics from `./bin/ghcp-doctor` passed. That command does not inspect authentication, so authentication and service access were checked separately with `./bin/ghcp-models --json` and live integration validation.

`max` was specified in the direct API test requests. Validation did not change the user's persistent settings or the reasoning effort of the already-running conversation.

## 3. Repository automated tests

Command:

```bash
npm test
```

Node's built-in test runner executed tests from these seven files.

| Test file | Main coverage |
| --- | --- |
| `test/bridge-daemon.test.mjs` | Daemon state and registry, instance verification, authentication and protection against stopping unrelated processes |
| `test/launcher.test.mjs` | Model selection, Codex argument forwarding, provider/transport override rejection and credential separation |
| `test/model-map.test.mjs` | Allowed models, no silent fallback for unavailable models, catalog and reasoning effort |
| `test/request-policy.test.mjs` | Request normalization, tool namespaces, history/tool results and unsupported-input rejection |
| `test/responses.test.mjs` | Responses output and SSE event/lifecycle conversion |
| `test/server.test.mjs` | HTTP authentication, JSON/SSE responses, request errors, cancellation and server configuration |
| `test/session-manager.test.mjs` | Session isolation, continuity, retries, tool round trips, permission denial, cancellation, timeouts and cleanup |

### Initial failures and rerun

| Execution environment | Passed | Failed | Assessment |
| --- | ---: | ---: | --- |
| Execution sandbox with loopback port binding blocked | 54 | 9 | Tests opening local HTTP servers encountered `listen EPERM: operation not permitted 127.0.0.1` |
| Approved environment allowing loopback binding | 63 | 0 | All tests passed |

The initial nine failures were caused by the environment's port restrictions, not model, SDK or bridge-logic failures. All tests passed on rerun without source changes. Separately, tool execution in the actual Codex E2E retained the `read-only` sandbox.

Additional checks passed: `node --check` for `src/*.mjs` and `test/*.mjs`, `bash -n` for `bin/*`, and `git diff --check`.

## 4. Live SDK and model validation

Only read-only health and model-catalog requests were sent to the previously running bridge. Inference and tool round trips used a separate test bridge with the same repository implementation, installed versions and Copilot authentication, leaving the existing conversation undisturbed.

The durations below come from the original `report.json`. They are per-check elapsed times and depend on network and service conditions.

| # | Original check identifier | Verified behavior | Result | Time (ms) |
| ---: | --- | --- | --- | ---: |
| 1 | `current_connection_read_only_probe` | Existing bridge: Responses protocol, `gpt-6-astra`, successful health and authenticated requests | PASS | 18 |
| 2 | `isolated_real_sdk_bridge_start` | Separate bridge started with the real SDK; health and seven models verified | PASS | 1,807 |
| 3 | `authenticated_live_model_catalog` | Authenticated `/v1/models`; seven entries in both OpenAI-format `data` and Codex-format `models` | PASS | 2 |
| 4 | `live_authentication_and_request_policy` | Explicit rejection of invalid authentication, input, transport and unsupported features | PASS | 6 |
| 5 | `real_model_json_response_at_max_effort` | Real model returned the requested marker in a JSON response at `max`; `status=completed` | PASS | 5,140 |
| 6 | `real_model_previous_response_id_continuity` | A `previous_response_id` follow-up retained the marker from the previous user message | PASS | 2,632 |
| 7 | `identical_retry_preserves_cached_result` | Identical follow-up retry returned output and usage equal to the preceding response | PASS | 2 |
| 8 | `real_model_sse_lifecycle_and_text` | Streamed text matched final output; event ordering and terminal state verified | PASS | 7,305 |
| 9 | `real_model_function_tool_roundtrip` | `probe.read_fixture` function call: JSON arguments, namespace, actual tool result and final answer verified | PASS | 11,058 |
| 10 | `real_model_custom_tool_roundtrip` | Custom tool input preserved spaces, line breaks and its trailing newline; result round trip verified | PASS | 9,343 |
| 11 | `actual_codex_launcher_read_only_tool_e2e` | Actual launcher and Codex CLI executed a read-only command and returned a previously unknown file marker | PASS | 23,714 |
| 12 | `owned_test_bridge_cleanup` | Owned test bridge stopped and no longer answered health requests; no stop operation targeted the existing bridge | PASS | 716 |

### Authentication and error handling

| Input/condition | Observed HTTP status |
| --- | ---: |
| Missing bridge credential | `401` |
| Incorrect bridge credential | `401` |
| Invalid JSON | `400` |
| Request with `content-encoding: zstd` | `415` |
| Request to `/v1/responses/compact` | `400` |
| Image input with `stream: true` | `400`, JSON error before SSE started |

The `bridge.request_failed` diagnostic entries produced by these negative checks were expected rejections, not failures of live model responses.

### Streaming details

- Observed **33 SSE events**, including **25 `response.output_text.delta` events**.
- The first event was `response.created`; the last was `response.completed`.
- Exactly one `response.completed` event was emitted, with monotonically increasing sequence numbers throughout the stream.
- Concatenated text deltas matched the final response marker.
- No `response.failed` or `error` events occurred.

## 5. Actual Codex CLI E2E

The E2E invoked the repository's `bin/codex-ghcp` launcher. Neither Codex nor the SDK was replaced with a fake implementation.

Procedure:

1. Generated a random marker in a temporary file. The marker value itself was not included in the model prompt.
2. Asked Codex to execute a specified read-only shell command exactly once.
3. The command read the package name and SDK dependency version from the repository's `package.json`, then read the temporary marker file.
4. Checked JSONL events for completed `command_execution`, command exit code `0` and actual output matching the expected value.
5. Checked that the final assistant response matched the tool output and that `turn.completed` occurred.
6. Verified that the Codex launcher process exited with code `0`.

The output had this shape. `<random marker>` is an explanatory placeholder, not the original marker.

```text
PACKAGE=openai-codex-ghcp-sdk;SDK=1.0.14;MARKER=<random marker>
```

A file value not supplied to the model appeared in both the tool output and final answer. This distinguishes an actual tool round trip from a successful text-only response.

## 6. Rechecking and evidence scope

Installation, automated tests and authenticated model access can be rechecked from the repository with:

```bash
npm test
./bin/ghcp-doctor
./bin/ghcp-models --json
```

The actual CLI E2E used this invocation shape. Replace `<read-only validation prompt>` with a generated prompt following the E2E procedure above.

```bash
./bin/codex-ghcp --ghcp-model gpt-6-astra -- \
  exec --ephemeral --sandbox read-only --json --color never \
  '<read-only validation prompt>'
```

- Live validation used `TURN_TIMEOUT_MS=90000`; the outer CLI E2E timeout was 240 seconds.
- All 12 checks were executed by a one-off `live-check.mjs` outside the repository. **Adding this report does not add live model tests to `npm test`, and the commands above alone do not automatically reproduce all 12 checks.**
- Check identifiers, durations and results were cross-checked against local `report.json`; Codex tool execution against `codex-events.jsonl`; streaming against `sse-events.json`; and expected rejections against `bridge-diagnostics.jsonl`.
- The original script and logs are local temporary artifacts. This document records summarized results only; those files and their local absolute paths are not included in the repository.
- Live SDK/model validation requires existing Copilot authentication, network and loopback access, and consumes account usage.

## 7. Limitations and changes

- Live inference validation covered **`gpt-6-astra` only**. All seven models below appeared in the authenticated catalog, but inference and tool calls were not executed on the other six.
  - `gpt-5.6-sol`
  - `gpt-5.6-terra`
  - `gpt-5.6-luna`
  - `gpt-6-astra`
  - `claude-opus-5`
  - `claude-sonnet-5`
  - `claude-haiku-4.5`
- Successful short text and tool round trips do not guarantee long-running conversations, large-scale concurrency, failure recovery or compatibility with every Codex feature. No separate load or long-duration reliability testing was performed.
- Passing automated cancellation, timeout and capacity-cleanup tests is distinct from reproducing real service outages. No live fault-injection testing was performed.
- Intentional unsupported behavior, such as rejecting image input, was tested as a success condition. Supported behavior remains bounded by the [compatibility document](COMPATIBILITY.md).
- Validation did not modify repository source/test files or persistent user settings. The existing connection was preserved, and the test bridge was cleaned up.
- Changes publishing this report are documentation-only. Authentication tokens, user account information and raw conversation logs are not committed.
