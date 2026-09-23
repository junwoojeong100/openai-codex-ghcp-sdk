# Bridge stability and recovery verification

[한국어](STABILITY_TESTING_KO.md) · [Guide map](../README.md#testing) · [Architecture](ARCHITECTURE.md) · [Verification records](validation/README.md)

Test bridge faults, tool-result handoff and recovery through real Codex: **11 scenarios × 6 models = 66 cases**. The default contract is `codex-ghcp-stability-11-v5`. It is separate from workflow compatibility, TUI and endurance checks.

Only looking for normal-launch timeout settings? Go to [operational defaults](#operational-defaults); you do not need to run this matrix.

## Prepare and run

Run from the repository root after `npm ci`. A live matrix is optional, not a setup step.

**Plan and stress checks — no model calls, Codex or Copilot login:** plan is the default; stress tests use mechanical SDK cycles.

```bash
npm run test:stability -- --plan
npm run test:stability:stress
```

**Offline runtime — no model calls:** use Node 22.12+, Codex **0.154.0** and a working OS sandbox. This drives real Codex with an SDK double; no Copilot login or browser is required.

```bash
npm run test:stability:runtime
```

**Live — consumes Copilot usage:** use the runtime prerequisites above and complete the [Copilot account check](../README.md#quick-start). Choose a new output directory and execute one full matrix:

```bash
npm run test:stability -- --execute --output .runtime/stability-new-run
```

Then verify the saved report **without model calls**, even if cases failed. Use the same output directory:

```bash
npm run test:stability -- --verify .runtime/stability-new-run/report.json
```

Read `.runtime/stability-new-run/report.md` for the summary and retained failures; `report.json` is the evidence-verification input.

**A full pass requires 66/66.** The 95% reference (63/66) does not change that verdict or exit code. Recorded runs still include upstream-filter failures; see the [results and retained failures](validation/README.md), not a score combined from different runs.

## Choose a profile only if needed

| Profile | Selection | Model-visible task |
| --- | --- | --- |
| `v5` | Default | Standard synthetic-marker copy task |
| `application-data-v3` | `--profile application-data-v3` | Application-data read/remember/recall wording on the v5 base |
| `application-data-v4` | `--profile application-data-v4` | Explicit whole-file wording, including `value:`/`receipt:` labels, colons and whitespace |

For example, inspect an optional profile without model calls:

```sh
npm run test:stability -- --plan --profile application-data-v4
```

Add the same `--profile` option to a new `--runtime` or `--execute` run to select it. Each profile has a distinct catalog ID/hash but keeps the six models, 11 scenarios, fixtures, faults, budgets and literal-output/cleanup checks. Production requests and safety policies are not rewritten. A profile's result cannot replace another's; `--verify` uses the recorded profile and rejects a `--profile` override.

v5 changes S03 to reject a policy-change request with missing tool results while accepting a complete matching result handoff. Older `v4`/`application-data-v2` and 77-cell contracts are no longer selectable. Verify those records with their saved source; they are not regraded as v5.

## Scope and fixed criteria

The matrix uses Codex **0.154.0** and Copilot SDK **1.0.14**. There are no automatic case retries, model substitutions, subsets or native OpenAI baseline.

Each passing live case requires native Codex app-server → the production Responses bridge → the real SDK → the exact model, plus native fixture-tool callbacks, independent checks, and owned-resource cleanup. A labelled proxy/instrumentation layer injects the specific faults below. It does not fabricate model output or replace the SDK in live mode. Extra duplicate/rejected/cancelled HTTP control requests are not additional live matrix cells.

| ID | Scenario | Injected condition | Per-case limit |
|---|---|---|---:|
| S01 | Native read, Unicode SSE and readiness | None | 90s |
| S02 | Tool order changes while returning a pending result | Tool-list permutation only | 90s |
| S03 | Reject a tool policy change with missing results, then accept the complete original request | One control request omitting all tool results | 90s |
| S04 | Exact result-request retry without duplicate submission | One duplicate HTTP request | 90s |
| S05 | Cancel a queued duplicate while native work continues | Bounded SDK acknowledgement gate + disconnect | 120s |
| S06 | Total request deadline and fresh native recovery | 45s request deadline + bounded acknowledgement gate | 180s |
| S07 | Idle SDK loss and new-thread recovery | Force-stop only the test-owned SDK | 150s |
| S08 | SDK loss while a tool result is pending, without replay | Force-stop at the owned native callback | 150s |
| S09 | Stream mismatch rejected before state commitment | Corrupt one SDK delta message ID | 120s |
| S10 | Fresh-process native resume without repeated tool work | Planned owned host/bridge restart | 150s |
| S11 | Six native tool turns, long history and local compaction | ≥12 KiB padding + explicit native compaction | 240s |

Successful read/recall answers must contain both complete literal `value:` and `receipt:` tokens. Added prose or fences are **presentation diagnostics**, not a stability failure. This policy is explicit before execution, differs from the compatibility suite's exact-output checks, and cannot be used to revise compatibility scores. Missing prefixes/values, unwanted tools, uncorrelated evidence and failed recovery still fail. Expected fault turns must actually fail with the specified error; a successful-looking answer alone cannot pass them.

Every check and artifact is required. Failed, unsupported, blocked, timed-out and unrun cells remain in the **66** denominator. Maximum four model lanes, 30s cleanup reserve per case, and no global cutoff. Worst-case scheduling estimate: 90s preflight + two 1,470s waves (6 models, 4 lanes) = **50.5 minutes**, excluding OS/I/O overhead. A passing matrix is **not a multi-hour soak, a product support percentage, or proof that all historical freezes are resolved**.

## Fixture and instruction rules

`read_fixture` returns the **entire unchanged UTF-8 file**, including labels and separators, not extracted values. Every model and supported profile uses this same tool description. Tool-description changes are recorded by the implementation hash and frozen source, not just the catalog hash. A matching catalog hash alone therefore does not establish identical model-visible input; see the [historical metadata repair](validation/2026-09-22-runner-repair/README.md).

Within each profile, all six models receive the same synthetic-marker tasks. The default profile requests the original two tool-result lines in a text fence. Fences or added prose are allowed; altered literal prefixes or values are not. The production bridge does not rewrite callers' tool descriptions or repair model output.

Client instructions are appended unchanged to the SDK-managed system foundation. SDK built-in tools stay excluded and SDK permission requests are rejected. These rules apply to every model and profile; provider-filtered turns remain failures.

## Harness timing and iteration policy

The harness uses the following fixed bounds in addition to the per-case limits above:

- Read, remember and recall prompts all require verbatim two-line output; remember explicitly echoes now and requires a fresh read once **in this turn**. This aligns the instructions with the existing oracle rather than weakening the oracle.
- Case cleanup uses the production **5,000ms** per-operation default, with a **30s** cleanup reserve. Cleanup errors still fail; diagnostics distinguish abort/disconnect/delete and timeout/RPC failure without logging error text.
- ACK readiness allows **45s**; SDK client startup/catalog initialization has a **30s** bound. Session creation is additionally governed by the turn/request deadlines; reaching the ACK gate must still be proved, never assumed. S06 uses a **45s** total request deadline and a **60s** bounded ACK gate, keeping the request deadline as the intended fault source. S05/S06 case limits are 120s/180s.
- The supervisor waits for asynchronous owned-process-group exit only inside the remaining case slot (at most 2s). Groups that remain alive still fail.

Historical 77-cell targets and results remain in the [verification records](validation/README.md). Each score belongs to one complete run of one implementation and contract. Failed cells are not selectively rerun or replaced within a matrix.

## Explicit upstream filtering

Root SDK `assistant.usage` events with `contentFilterTriggered=true` or `finishReason="content_filter"` now fail the request with `upstream_content_filter`. JSON requests return HTTP **422**; an already-started SSE response keeps its HTTP 200 headers but terminates with **`response.failed`**, never `response.completed`. Any text already streamed remains incomplete and cannot be retracted.

The bridge uses structured SDK metadata, not matching refusal-like prose. It does not disable filters, retry inference, resubmit tool results, or cache the blocked turn as success. Failed session state and response handles are invalidated. This corrects error reporting; it does not make an upstream refusal a passing stability case or establish why the provider refused it. All 66 current cells and the acceptance oracle remain unchanged.

## Implemented recovery boundaries

- Tools are compared by identity, not array order. Configuration changes with pending calls require every matching result and unchanged non-instruction history. Confirmed abort/disconnect/delete and same-generation readiness precede replacement; completed results are serialized history, never repeated result RPCs. Incomplete, duplicate, mismatched or rewritten conversation input remains rejected. Completed IDs and response versions survive, but a model may still propose the same operation under a new ID. Conflict diagnostics record request IDs, field names, hashes and counts, not raw content.
- SDK control-plane `ping` detects loss. A single shared recovery task creates a **new client generation** with bounded startup and backoff; concurrent requests do not each spawn a client. Lost conversations are invalidated. No inference or uncertain tool result is automatically replayed after connection loss.
- With a healthy connection, the model-progress watchdog can recover a silent turn on its original response stream, once by default. Input must be acknowledged, no output or calls may be pending, and old-session cleanup must be confirmed. Resolved history is context only; completed tool-result RPCs are never repeated. Partial output, filtering, cancellation, uncertain submissions and cleanup failure are excluded. Diagnostics identify recovery attempts, success and specific skip reasons. This is bounded inference replay, not an exactly-once guarantee or an external process-restart watcher.
- `/health` is public **HTTP-process liveness**, with the last-known `ready`/`upstreamState` fields. Authenticated `/readyz` performs a bounded SDK readiness probe (200/503) and does not reconnect by itself. Authenticated `/v1/models` may recover the SDK before exposing the catalog. Readiness does not guarantee inference service health or quota.
- Per-conversation FIFO queues are cancellable and bounded. A cancelled waiter is removed immediately and can never run later. Active cancellation settles promptly, but its family lock remains held until bounded cleanup finishes.
- Responses are structurally reconciled **before** pending calls/history/retry state are committed. Normal identical request retries remain cached; a stream protocol mismatch cannot cache an undelivered tool call as success. Network delivery and model generation are not an exactly-once transaction.

### Operational defaults

| Setting | Default | Meaning |
|---|---:|---|
| `TURN_TIMEOUT_MS` | 300000 | Absolute model-turn budget shared across all recovery attempts and replacement setup |
| `TURN_FIRST_PROGRESS_TIMEOUT_MS` | 180000 | Initial wait per attempt; turn-start metadata, retry notices and keepalives do not restart it |
| `TURN_IDLE_TIMEOUT_MS` | 90000 | Inactivity after first real progress; root text, reasoning, tool-input and increasing SDK/root-phase bytes refresh it |
| `TURN_IDLE_RECOVERY_ATTEMPTS` | 1 | Maximum session recoveries per request; integer 0–3, 0 disables |
| `REQUEST_TIMEOUT_MS` | 360000 | Manager request, including queue wait, SDK work and recovery; not HTTP body reception |
| `MAX_REQUESTS_PER_SESSION` | 8 | Admitted active + queued requests per family |
| `MAX_REQUESTS` | 128 | Global admitted active + queued requests |
| `SDK_READINESS_TIMEOUT_MS` | 2000 | Local SDK ping deadline |
| `SDK_STARTUP_TIMEOUT_MS` | 30000 | SDK start, ping/catalog initialization, session creation and model-setting RPCs; session setup is also capped by the turn limit |
| `SDK_READINESS_INTERVAL_MS` | 15000 | Background connection checks and content-free turn watchdog diagnostics; watchdog interval is capped by the idle limit |
| `SDK_RECOVERY_BACKOFF_MS` | 5000 | Minimum interval between failed recovery attempts |

All are positive integers except `TURN_IDLE_RECOVERY_ATTEMPTS`, which accepts 0–3. Recovery resets neither the absolute turn deadline nor the total request deadline. Existing byte/session/cleanup limits remain. `copilot_idle_timeout`, `copilot_timeout` and `request_timeout` are 504 errors, `request_queue_full` is 429, and `upstream_session_lost` is 409 asking for a new conversation. Do not blindly replay tool side effects. To apply updated bridge code, first close its Codex sessions, then relaunch the project-owned bridge; the development/test runner never restarts a user's active bridge. `/health.turnWatchdog` reports runtime settings, not the current source file's defaults. Background status also exposes them, but does not discover foreground bridges.

## Focused handoff regression

The `pending-result-instruction-handoff-v2` regression drives the actual Codex TUI, launcher, fixture MCP server and headless Playwright. It injects a labelled top-level instruction update with a complete result batch. A pass requires one fixture execution, zero old result RPCs, the exact sample on a standalone line, and a successful next turn without `/new`. This is separate from the 66-cell stability matrix; [earlier probe failures](validation/2026-09-23-pending-handoff.json) remain recorded.

Both modes require the [TUI prerequisites](TUI_SCENARIOS.md#prepare-and-run). **Offline — no model calls:** explicitly remove the live-mode environment variable for this invocation.

```sh
env -u GHCP_LIVE_HANDOFF_OUTPUT node --test test/runtime/pending-handoff.test.mjs
```

**Live — consumes Copilot usage across all six models:** use a new output directory. `GHCP_LIVE_HANDOFF_OUTPUT` enables live mode even when this file is run through `npm run test:runtime`; do not export it for routine offline checks.

```sh
GHCP_LIVE_HANDOFF_OUTPUT=.runtime/pending-handoff-live-new \
  node --test --test-concurrency=1 test/runtime/pending-handoff.test.mjs
```

Unconfirmed handoff cleanup/readiness is `session_handoff_failed` (503). Cancellation, connection loss or replacement failure keeps that family unavailable rather than treating a result retry as a fresh conversation. Missing/mismatched pending results remain `tool_result_mismatch` (409); rewritten history remains `pending_session_changed` (409).

Failure reports now distinguish `upstream-content-filter`, `literal-output` and `cleanup` from undetermined failures. Filter classification requires an actual native Responses error code, not refusal-like prose, a control request or an SDK hint alone. Cleanup failures take precedence; category labels never alter failed checks, status, the denominator or exit codes. The verifier recomputes evidence-derived categories. Earlier reports still require their frozen verifier. CI runs the offline suites separately so one failed suite does not hide later results, and retains scrubbed failure diagnostics as artifacts.

## Evidence and exit codes

The offline stress run covers 100 tool round trips, 100 exact retries, ten queued cancellations, ten SDK recoveries, state capacity and final listener/queue cleanup. It accelerates transitions; it is not elapsed-time endurance certification. Offline passes never earn live compatibility credit.

Every run uses a new output directory and freezes source files, implementation/catalog hashes and the scenario contract before preflight. Evidence includes native events, actual SDK messages/usage, HTTP/SSE, labelled controls, independent assertions, per-case supervisor receipts and a complete matrix. The verifier recomputes checks, metrics and artifact projections rather than trusting stored pass flags. Raw logs stay under ignored `.runtime`; review/redact before sharing. Hashes are not third-party attestation.

After source changes, use the saved source to verify an old run (the same dependencies are required):

```bash
node .runtime/stability-new-run/source-snapshot/scripts/stability.mjs \
  --verify .runtime/stability-new-run/report.json
```

Exit codes: **0** = valid plan, passing offline harness, or all 66 live cells passed; **1** = valid evidence but non-passing/incomplete execution; **2** = invalid arguments/evidence. The report distinguishes offline from live and never calls an offline 11/11 a 66/66 live pass.

[Opus diagnostics](OPUS_DIAGNOSTICS.md) correlate native upstream refusal metadata without changing the fixture prompt or scored matrix. Diagnostic controls and incomplete observations must remain separate from matrix results.
