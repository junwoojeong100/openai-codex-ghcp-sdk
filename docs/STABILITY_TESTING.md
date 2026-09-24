# Bridge stability and recovery tests

[한국어](STABILITY_TESTING_KO.md) · [Guide map](../README.md#testing) · [Architecture](ARCHITECTURE.md) · [Verification records](validation/README.md)

This suite injects faults into real Codex sessions and checks that the bridge fails safely and recovers: **11 scenarios × 6 models = 66 cases**. A live run passes only at **66/66**. It is separate from the workflow, TUI and endurance suites.

You do not need this suite to use the launcher. Production timeout settings and error codes are in the [usage guide](USAGE.md#timeouts-and-recovery). Recorded results, including the remaining upstream-filter failures, are in the [verification records](validation/README.md#recorded-results).

**Jump to:** [Run](#run-the-suite) · [Read the result](#read-the-result) · [Scenarios](#scenarios) · [Pass rules](#pass-rules) · [Wording profiles](#optional-wording-profiles) · [Handoff regression](#focused-handoff-regression) · [Reference](#reference)

## Run the suite

Run every command from the repository root after `npm ci`. Each mode works on its own; pick the one for your goal.

| Goal | Mode | Model calls |
| --- | --- | --- |
| See what the matrix checks | [Plan](#plan) | No |
| Stress local state handling | [Stress check](#stress-check) | No |
| Check the runner with real Codex | [Offline runtime](#offline-runtime) | No |
| Measure all 66 cases | [Live matrix](#live-matrix) | **Yes** |
| Recheck a finished run | [Verify a report](#verify-a-report) | No |

### Plan

Needs no Codex installation or Copilot login:

```bash
npm run test:stability -- --plan
```

### Stress check

Needs no Codex installation or Copilot login:

```bash
npm run test:stability:stress
```

An SDK double (a local stand-in for the Copilot SDK) runs 100 tool round trips, 100 exact retries, 10 queued cancellations, 10 SDK recoveries and a state-capacity check, then confirms that listeners and queues were cleaned up. It tests repeated state changes, not real models or long-running endurance.

### Runtime prerequisites

The offline runtime and the live matrix need Node 22.12+, Codex **0.154.0** ([install step](../README.md#2-install-dependencies)) and a working OS sandbox. No browser is needed. Only the live matrix needs a Copilot login.

### Offline runtime

Runs real Codex against an SDK double, with no model calls:

```bash
npm run test:stability:runtime
```

A pass is reported as an **offline harness pass (11/11)**. It checks the runner, not live compatibility.

### Live matrix

**Consumes Copilot usage.**

1. Install the [runtime prerequisites](#runtime-prerequisites) and complete the [Copilot account check](../README.md#3-check-installation-and-account-access).
2. Run `./bin/ghcp-models` and confirm that **all six [supported models](../README.md#models)** are available, not only the default model.
3. Run the matrix into a new output directory:

```bash
npm run test:stability -- --execute --output .runtime/stability-new-run
```

Before it starts, the runner saves a copy of its source in the output directory. The worst case takes about **50.5 minutes** ([timing](#timing-and-bounds)).

### Verify a report

Verification recomputes every check from the saved evidence. It makes no model calls and reruns no cases. Verify every finished run, including one with failures:

```bash
npm run test:stability -- --verify .runtime/stability-new-run/report.json
```

Run it as a separate command. A run with failures exits with code 1, so chaining `--verify` after `--execute` with `&&` would skip it.

**If the source has changed since the run,** verify with the source the run saved. Keep the complete output directory and install the same dependencies:

```bash
node .runtime/stability-new-run/source-snapshot/scripts/stability.mjs \
  --verify .runtime/stability-new-run/report.json
```

The summaries published in `docs/validation` are not complete reports and cannot be verified this way.

## Read the result

Open `report.md` in the output directory, for example `.runtime/stability-new-run/report.md`. It is ordered for reading:

1. **Result:** the verdict and pass count.
2. **Per-model results:** counts for each model.
3. **Cases needing attention:** failed checks, failure category, recorded error and a link to the case artifacts.
4. **Complete matrix:** every case.

`report.md` is only a view. `--verify` checks `report.json`.

| Exit code | Meaning |
| --- | --- |
| 0 | Valid plan, passing offline harness, or all 66 live cases and run-level checks passed |
| 1 | The run did not pass or is incomplete. `--verify` also returns 1 for valid evidence of a run that did not pass. |
| 2 | Invalid arguments or evidence |

**Only 66/66 is a pass.** The report also shows the 95% reference (63/66), which changes neither the verdict nor the exit code. For example, a live **65/66** run with `evidenceIntegrity: true` is valid evidence of a run that did not pass; see [how to read report fields](validation/README.md#read-a-result).

Each failed case gets a category: `cleanup` (takes precedence), `upstream-content-filter`, `literal-output` or undetermined. The filter category requires an actual native Responses error code; refusal-like text, a control request or an SDK hint alone is not enough. Categories explain failures; they never change checks, status, the denominator or the exit code. `--verify` recomputes them.

Raw logs stay in the Git-ignored `.runtime` directory. Review and redact them before sharing.

## Scenarios

The default contract (the versioned scenarios and pass rules) is `codex-ghcp-stability-11-v5`. Each case is one scenario on one model, run with Codex **0.154.0** and Copilot SDK **1.0.14**.

| ID | Scenario | Injected fault | Case limit |
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

A labelled test proxy injects each fault. In live mode it never fabricates model output or replaces the SDK. Its control requests (duplicate, rejected or cancelled HTTP requests) are not extra cases.

## Pass rules

- **Every check in all 66 cases must pass.** Failed, unsupported, blocked, timed-out and not-run cases stay in the denominator.
- **Live cases use the real path:** native Codex app-server → production bridge → real SDK → exact model, with native fixture-tool callbacks, independent checks and cleanup of every test-owned resource.
- **Answers must keep the literal tokens.** Read and recall answers must contain the complete `value:` and `receipt:` tokens. Extra prose or code fences are recorded as presentation diagnostics, not failures. Missing prefixes or values, unexpected tools, uncorrelated evidence and failed recovery do fail. This rule differs from the workflow suite's exact-output checks and cannot change its scores.
- **Expected faults must actually fail** with the specified error. A successful-looking answer does not pass a fault turn.
- **No second chances:** no automatic case retries, model substitutions, subsets or native OpenAI baseline. Failed cases are not rerun or replaced; each score belongs to one complete run of one implementation and contract.
- **What a pass does not mean:** 66/66 is not a multi-hour soak, a product support percentage or proof that every historical freeze is fixed.

## Optional wording profiles

The default profile is `v5`. The two opt-in profiles change only the wording that models see:

| Profile | Select with | Model-visible task |
| --- | --- | --- |
| `v5` | Default | Standard synthetic-marker copy task |
| `application-data-v3` | `--profile application-data-v3` | Application-data read/remember/recall wording on the v5 base |
| `application-data-v4` | `--profile application-data-v4` | Explicit whole-file wording, including the `value:`/`receipt:` labels, colons and whitespace |

Inspect a profile without model calls:

```sh
npm run test:stability -- --plan --profile application-data-v4
```

To run a profile, add the same `--profile` option to a new `--runtime` or `--execute` run.

- Every profile keeps the six models, 11 scenarios, fixtures, faults, budgets, and literal-output and cleanup checks, and has its own catalog ID and hash.
- Profiles do not rewrite production requests or safety policies.
- One profile's result cannot stand in for another's. `--verify` uses the recorded profile and rejects a `--profile` override.

## Focused handoff regression

`pending-result-instruction-handoff-v2` is a separate test, not one of the 66 cases. It drives the actual Codex TUI, launcher, a fixture MCP server and headless Playwright, then sends a labelled instruction update together with a complete tool-result batch.

A pass requires one fixture execution, zero old result RPCs, the exact sample on its own line and a successful next turn without `/new`. [Earlier probe failures](validation/2026-09-23-pending-handoff.json) remain recorded. Both modes need the [TUI prerequisites](TUI_SCENARIOS.md#runtime-prerequisites).

**Offline (no model calls):** unset the live-mode variable for this command:

```sh
env -u GHCP_LIVE_HANDOFF_OUTPUT node --test test/runtime/pending-handoff.test.mjs
```

**Live (consumes Copilot usage on all six models):** set the variable to a new output directory:

```sh
GHCP_LIVE_HANDOFF_OUTPUT=.runtime/pending-handoff-live-new \
  node --test --test-concurrency=1 test/runtime/pending-handoff.test.mjs
```

Do not export `GHCP_LIVE_HANDOFF_OUTPUT` in your shell. It switches this test to live mode even when it runs inside `npm run test:runtime`.

Expected errors: if cleanup or readiness cannot be confirmed during the handoff, the bridge returns `session_handoff_failed` (503). After cancellation, connection loss or a failed replacement, that conversation stays unavailable instead of restarting as a new one. Missing or mismatched results return `tool_result_mismatch` (409), and rewritten history returns `pending_session_changed` (409).

## Reference

### Timing and bounds

Up to four model lanes run in parallel; each lane runs one model's cases in sequence. There is no global cutoff. Worst case: 90s preflight + two 1,470s waves = **50.5 minutes**, excluding OS and I/O overhead.

| Bound | Value |
| --- | --- |
| Cleanup reserve per case | 30s |
| Per-operation cleanup | 5,000ms (production default) |
| Acknowledgement (ACK) readiness | 45s |
| SDK client startup and catalog load | 30s |
| S06 fault | 45s total request deadline, 60s ACK gate, so the request deadline expires first |
| Wait for owned process groups to exit | Up to 2s, within the remaining case time |

Session creation is also bounded by the turn and request deadlines, and each case must prove it reached its ACK gate. Cleanup errors fail the case; diagnostics name the failed step (abort, disconnect or delete) and whether it timed out or the RPC failed, without logging error text. A process group still alive after the wait fails the case.

### Fixture and prompt rules

- `read_fixture` returns the **entire unchanged UTF-8 file**, including labels and separators. Every model and profile gets the same tool description.
- The implementation hash and saved source record tool-description changes; the catalog hash alone does not prove identical model input ([historical repair](validation/2026-09-22-runner-repair/README.md)).
- Within a profile, all six models get the same synthetic-marker tasks. Read, remember and recall prompts ask for the two lines verbatim; the remember turn echoes them and must read the file once more in that turn. This wording matches the existing checks; the checks were not relaxed. The default profile asks for the two tool-result lines in a text fence.
- Client instructions are appended unchanged to the SDK's system instructions. SDK built-in tools stay excluded and SDK permission requests are rejected. The bridge never rewrites tool descriptions or repairs model output, and provider-filtered turns remain failures.

### Behavior under test

The scenarios exercise production behavior documented elsewhere: [timeouts and automatic recovery](USAGE.md#timeouts-and-recovery), [upstream filter errors](COMPATIBILITY.md#upstream-filtered-responses) and the [recovery design](ARCHITECTURE.md#stability-and-recovery-boundaries). The suite never restarts a user's active bridge.

### Saved evidence

Before preflight, every run freezes its source files, implementation and catalog hashes and the scenario contract. Evidence includes native events, SDK messages and usage, HTTP/SSE traffic, labelled control requests, independent checks, per-case supervisor receipts and the complete matrix. The verifier recomputes checks, metrics and artifact projections instead of trusting stored pass flags. Hashes identify files; they are not third-party attestation.

CI runs each offline suite separately, so one failure does not hide later results, and keeps scrubbed failure diagnostics as artifacts.

[Opus diagnostics](OPUS_DIAGNOSTICS.md) collect native refusal metadata without changing the fixture prompt or the scored matrix. Keep their results separate from matrix results.

### Contract history

- `v5` changed S03: a policy-change request with missing tool results is rejected, and the complete matching handoff is accepted.
- Older `v4`, `application-data-v2` and seven-model 77-case contracts can no longer be selected. Verify their records with the saved source; they are not regraded as v5. Historical results are in the [verification records](validation/README.md).
