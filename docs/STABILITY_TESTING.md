# Bridge stability and recovery verification

[한국어](STABILITY_TESTING_KO.md) · [Architecture](ARCHITECTURE.md) · [New verification records](validation/README.md)

## Fresh live verification

New full 11-scenario × 6-model (66-cell) runs use the v5 criteria frozen before each execution. Earlier reports, including failures, remain historical; no old scores or selective failed-cell reruns are reused. The [verification records](validation/README.md) distinguish each implementation and contract.

## Optional application-data profile and current status

`v5` is the default (`codex-ghcp-stability-11-v5`). `--profile application-data-v3` explicitly selects `codex-ghcp-stability-11-application-data-v3`: the existing application-data read/remember/recall wording on the v5 base under a distinct catalog ID and hash. Both profiles retain the same six models, 11 scenarios, fixtures, fault schedule, budgets, literal-output and cleanup checks. Production user requests are not rewritten. Reports, workers and artifacts carry profile identity; verification rejects cross-profile case substitution and cannot be overridden with `--profile`.

v5 changes only S03's rejection boundary: its policy-change control request deliberately omits tool results and must receive `tool_result_mismatch` without losing pending work. Complete matching results now permit a safe configuration handoff instead of the former blanket 409. `v4`/`application-data-v2` and earlier profiles are no longer selectable. Their 66-cell or older 77-cell records require each run's frozen `source-snapshot/scripts/stability.mjs`; they are never regraded or combined with v5.

The latest release check on implementation `320d502c` completed the full default **v5 matrix at 57/66 (86.36%)**, with nine explicit Opus 5.5 upstream-filter failures and exit code 1. The other five models passed 11/11 each. A separate actual-TUI matrix passed 72/72; these scores are not combined. Both reports were independently verified with current and frozen source. The requested no-problems commit/push condition was not met. [Evidence and release gate](validation/2026-09-23-pending-handoff.json).

The six-model implementation `68f92d74` was tested with two independent full matrices: **v4 57/66 (86.36%)** and **application-data-v2 63/66 (95.45%)**. Both retain failed cases, `fullMatrixPassed=false` and exit code 1. application-data-v2 meets the 95% reference (≥63/66); v4 does not, because every Opus 5.5 read turn was upstream-filtered. The later freeform `apply_patch` catalog change (`54c7eb77`) was verified by the separate [real-TUI matrix](validation/2026-09-23-tui-scenarios/README.md), not by rerunning these matrices. See [results, run history and MCP isolation](validation/2026-09-23-six-model-switch/README.md).

The previous terminal-integration implementation was tested under the historical 7-model v3/application-data-v1 contract with two independent full matrices: **v3 66/77 (85.71%)** and **application-data-v1 72/77 (93.51%)**. Both retain failed cases, `fullMatrixPassed=false` and exit code 1. The 95% target is not met by these runs. See [current results, diagnosis and additional live terminal checks](validation/2026-09-22-terminal-integration/README.md).

An earlier fixture-tool metadata repair under the historical 7-model v3 contract scored **74/77 (96.10%), Opus 9/11** and met that run's target. Its changed model-visible metadata and three failures remain documented; it is not the score of the current implementation. Earlier 50/77 and v3 66/77 historical records also remain separate. The default profile, fixed contracts and historical failures are not rewritten. [Historical target-meeting run](validation/2026-09-22-runner-repair/README.md) · [Earlier follow-up](validation/2026-09-22-fidelity-followup/README.md).

```sh
# Plan only; no model calls
npm run test:stability -- --plan --profile application-data-v3
# Mechanical SDK / explicit live opt-in; each needs a new directory
npm run test:stability -- --runtime --profile application-data-v3 --output .runtime/application-offline-new
npm run test:stability -- --execute --profile application-data-v3 --output .runtime/application-live-new
npm run test:stability -- --verify .runtime/application-live-new/report.json
```

## Scope and fixed criteria

`codex-ghcp-stability-11-v5` is a **separate 11-scenario × 6-model = 66-cell** matrix, using Codex **0.154.0** and Copilot SDK **1.0.14**. It does not replace, regrade, or enlarge the historical 18-workflow v4 compatibility result. No automatic case retries, model substitution, subset mode, or native OpenAI baseline.

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

Successful read/recall answers must contain both complete literal `value:` and `receipt:` tokens. Added prose or fences are **presentation diagnostics**, not a stability failure. This policy is explicit before execution, differs from the compatibility suite's exact-output checks (historical v4, current v5), and cannot be used to revise compatibility scores. Missing prefixes/values, unwanted tools, uncorrelated evidence and failed recovery still fail. Expected fault turns must actually fail with the specified error; a successful-looking answer alone cannot pass them.

Every check and artifact is required. Failed, unsupported, blocked, timed-out and unrun cells remain in the **66** denominator. Maximum four model lanes, 30s cleanup reserve per case, and no global cutoff. Worst-case scheduling estimate: 90s preflight + two 1,470s waves (6 models, 4 lanes) = **50.5 minutes**, excluding OS/I/O overhead. A passing matrix is **not a multi-hour soak, a product support percentage, or proof that all historical freezes are resolved**.

## Fixture tool return-type metadata

The native `read_fixture` description identifies its actual return type: the entire unchanged UTF-8 file contents as plain text, not extracted field values. Labels and separators are part of those contents. Every model and both profiles receive this same tool metadata; the callback still returns the original file bytes as a native text result.

This changes model-visible **tool-description text**, not the user prompts, fixture values, schemas, fault flows, budgets, acceptance checks or production bridge. The profile hashes remain unchanged, while the implementation hash and frozen source identify the revised description. Equal profile hashes therefore do not imply that all model-visible implementation metadata is identical. Only a fresh full run can measure the change; earlier cases retain their original descriptions and results in their source snapshots. The production bridge does not rewrite callers' tool descriptions or repair model output.

## SDK foundation preservation

The bridge now appends complete client instructions to the SDK-managed system foundation instead of replacing it. The installed SDK documents replacement as removing its guardrails; protocol adaptation must preserve them. No client instruction is stripped, and SDK built-in tools remain excluded with permission requests rejected. This production fix applies to every model. The prompts (identical in v3 and v4) and the acceptance oracle are unchanged; only a fresh full live run can establish the result.

## Historical v3 prompt clarification

The common prompt now describes the actual benign task: copying generated, non-sensitive Unicode test markers. It asks for the unchanged two tool-result lines in a fenced text block rather than using imperative plain-text-only wording. The existing oracle already allowed fences and is **unchanged**: inserting a space into a literal prefix still fails. All six current models receive the same prompts; historical v3 used seven models. Fixtures, tool requirements, safety settings and failure accounting are unchanged; provider-filtered responses remain failures, never bypassed or rewritten.

The earlier v2 operational corrections below remain in effect.

## v2 corrections and iteration policy

The 66-cell denominator, exact model routing, literal value/receipt checks, required tool work, fault evidence and cleanup requirements remain unchanged for v4. No response rewriting, removed failures or offline credit is allowed. v2 changes are explicit before running:

- Read, remember and recall prompts all require verbatim two-line output; remember explicitly echoes now and requires a fresh read once **in this turn**. This aligns the instructions with the existing oracle rather than weakening the oracle.
- Case cleanup uses the production **5,000ms** per-operation default, with a **30s** cleanup reserve. Cleanup errors still fail; diagnostics now distinguish abort/disconnect/delete and timeout/RPC failure without logging error text.
- ACK readiness allows **45s**; SDK client startup/catalog initialization has a **30s** bound. Session creation is additionally governed by the turn/request deadlines; reaching the ACK gate must still be proved, never assumed. S06 uses a **45s** total request deadline and a **60s** bounded ACK gate, keeping the request deadline as the intended fault source. S05/S06 case limits are 120s/180s.
- The supervisor waits for asynchronous owned-process-group exit only inside the remaining case slot (at most 2s). Groups that remain alive still fail.

The historical user-requested v3 iteration target was **at least 74/77 (96.1%)**; 73/77 was below 95%. On the current 66-cell v4 matrix, the same 95% reference corresponds to at least 63/66 (95.45%). This reference does not change `fullMatrixPassed`, which requires 66/66. Archived verification records were removed before the current repair at the user’s request. The [repair record](validation/2026-09-22-bridge-repair/README.md) retains its preliminary and final full runs separately, including failures and timeouts; the latest score is not assembled from earlier cells. No individual failed cell is selectively rerun or replaced within a matrix.

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

## Commands and evidence

The dedicated pending-handoff regression uses the actual Codex TUI, launcher, fixture MCP server and headless Playwright. It injects a labelled top-level instruction update on a complete result batch, requires one fixture execution, zero old result RPCs, exact result retention, and a second successful turn in the same TUI without `/new`. The normal runtime suite uses an SDK double. Live opt-in runs all six models and preserves each case's evidence in a new directory; this focused regression is not a rerun of the 66-cell stability matrix.

Its `pending-result-instruction-handoff-v2` prompts explicitly request the sample on a standalone line, matching the existing strict TUI marker oracle. The initial probe omitted that formatting requirement: all six handoffs were accepted, but two correct inline answers failed the screen check and prevented their follow-up turns, leaving that run at 4/6. Those failed records are preserved, not regraded. The revised probe requires a fresh six-model run; production prompts and output are not rewritten.

```sh
node --test test/runtime/pending-handoff.test.mjs
GHCP_LIVE_HANDOFF_OUTPUT=.runtime/pending-handoff-live-new \
  node --test --test-concurrency=1 test/runtime/pending-handoff.test.mjs
```

Unconfirmed handoff cleanup/readiness is `session_handoff_failed` (503). Cancellation, connection loss or replacement failure keeps that family unavailable rather than treating a result retry as a fresh conversation. Missing/mismatched pending results remain `tool_result_mismatch` (409); rewritten history remains `pending_session_changed` (409).

Failure reports now distinguish `upstream-content-filter`, `literal-output` and `cleanup` from undetermined failures. Filter classification requires an actual native Responses error code, not refusal-like prose, a control request or an SDK hint alone. Cleanup failures take precedence; category labels never alter failed checks, status, the denominator or exit codes. The verifier recomputes evidence-derived categories. Earlier reports still require their frozen verifier. CI runs the offline suites separately so one failed suite does not hide later results, and retains scrubbed failure diagnostics as artifacts.

```bash
npm test
npm run test:stability:stress       # 100 mechanical cycles, no model calls
npm run test:compatibility:runtime # existing 18 workflows, real Codex + SDK double
npm run test:stability:runtime     # 11 scenarios, real Codex + SDK double
npm run test:stability -- --plan   # offline catalog, no credential access

# Explicit opt-in: Copilot authentication required; consumes model usage.
npm run test:stability -- --execute --output .runtime/stability-new-run
npm run test:stability -- --verify .runtime/stability-new-run/report.json
```

The offline stress run covers 100 tool round trips, 100 exact retries, ten queued cancellations, ten SDK recoveries, state capacity and final listener/queue cleanup. It accelerates transitions; it is not elapsed-time endurance certification. Offline passes never earn live compatibility credit.

Every run uses a new output directory and freezes source files, implementation/catalog hashes and the scenario contract before preflight. Evidence includes native events, actual SDK messages/usage, HTTP/SSE, labelled controls, independent assertions, per-case supervisor receipts and a complete matrix. The verifier recomputes checks, metrics and artifact projections rather than trusting stored pass flags. Raw logs stay under ignored `.runtime`; review/redact before sharing. Hashes are not third-party attestation.

After source changes, use the saved source to verify an old run (the same dependencies are required):

```bash
node .runtime/stability-new-run/source-snapshot/scripts/stability.mjs \
  --verify .runtime/stability-new-run/report.json
```

Exit codes: **0** = valid plan, passing offline harness, or all 66 live cells passed; **1** = valid evidence but non-passing/incomplete execution; **2** = invalid arguments/evidence. The report distinguishes offline from live and never calls an offline 11/11 a 66/66 live pass.

[Opus diagnostics](OPUS_DIAGNOSTICS.md) correlate native upstream refusal metadata without changing the fixture prompt or scored matrix. Diagnostic controls and incomplete observations must remain separate from matrix results.
