# Workflow compatibility tests

[한국어](COMPATIBILITY_TESTING_KO.md) · [Guide map](../README.md#testing) · [Scenario reference](NATIVE_SCENARIOS.md) · [Product boundaries](COMPATIBILITY.md)

This suite runs real development workflows through Codex and the bridge: **18 scenarios × 6 models = 108 cases**. A live run passes only at **108/108**; stability and TUI results do not count toward it. You do not need this suite to use the launcher.

The current contract (the versioned scenarios and pass rules) is `codex-ghcp-workflows-18-v6`, with report `schemaVersion` 6. Each case is one scenario on one model; the [scenario reference](NATIVE_SCENARIOS.md#scenario-index) lists them all.

**Jump to:** [Run](#run-the-suite) · [Read the result](#read-the-result) · [Pass rules](#pass-rules) · [Metrics](#three-separate-metrics) · [Covered paths](#native-paths-covered) · [Evidence rules](#evidence-rules) · [v6 changes](#v6-runner-changes)

## Run the suite

Run every command from the repository root after `npm ci`. Each mode works on its own; pick the one for your goal.

| Goal | Mode | Model calls |
| --- | --- | --- |
| See the contract or check the scenario design | [Plan](#plan) | No |
| Check the runner with real Codex | [Offline runtime](#offline-runtime) | No |
| Measure all 108 cases | [Live matrix](#live-matrix) | **Yes** |
| Recheck a finished run | [Verify a report](#verify-a-report) | No |

### Plan

Needs no Codex installation or Copilot login. Prints the 108-case contract without running any case:

```bash
npm run test:compatibility -- --plan
```

To check the scenario design, run `npm run test:scenarios`. For documentation-only changes, `npm run test:docs` is enough: it checks the guides, command examples and generated scenario docs without running the examples.

### Runtime prerequisites

The offline runtime and the live matrix need Node 22.12+, Codex **0.154.0** ([install step](../README.md#2-install-dependencies)) and a working OS sandbox. No browser is needed. Only the live matrix needs a Copilot login. Normal launches have [looser requirements](../README.md#requirements).

### Offline runtime

Runs real Codex against an SDK double (a local stand-in for the Copilot SDK) with isolated credentials, including the actual launcher in C11. No model calls:

```bash
npm run test:compatibility:runtime
```

It checks the runner, not live compatibility.

### Live matrix

**Consumes Copilot usage.** No OpenAI API key is needed.

1. Install the [runtime prerequisites](#runtime-prerequisites) and complete the [Copilot account check](../README.md#3-check-installation-and-account-access).
2. Run `./bin/ghcp-models` and confirm that **all six [supported models](../README.md#models)** are available. A login alone does not prove model access.
3. **Save a copy of the exact source and `package-lock.json`.** Unlike the stability and TUI runners, this runner does not save its own source. Keep the source unchanged until you have verified the report.
4. Run the matrix into a new output directory:

```bash
npm run test:compatibility -- --execute --output .runtime/compatibility-new-run
```

The runner never overwrites an existing output directory. The worst case takes about **75.5 minutes** ([timing](#timing)).

### Verify a report

Verification recomputes every check from the saved evidence. It makes no model calls and reruns no cases. Verify every finished run, including one with failures:

```bash
npm run test:compatibility -- --verify .runtime/compatibility-new-run/report.json
```

Run it as a separate command. A run with failures exits with code 1, so chaining `--verify` after `--execute` with `&&` would skip it.

**If the source has changed since the run,** use the copy you saved in step 3. Keep the complete run directory. From the root of the saved copy, with its dependencies installed, run the saved runner with the **absolute path** to the original report:

```bash
node scripts/compatibility.mjs --verify /absolute/path/to/compatibility-run/report.json
```

Without the matching source and the original artifacts, the result cannot be recomputed. The summaries published in the [verification records](validation/README.md) are not complete reports; do not pass them to `--verify`. Older v5 and v4 reports need their original runner, not v6.

## Read the result

Open `report.md` in the output directory, for example `.runtime/compatibility-new-run/report.md`. It is ordered for reading:

1. **Result:** the verdict and per-model counts.
2. **Cases needing attention:** failed checks, recorded errors and links to case artifacts.
3. **Complete matrix:** all 108 cases.
4. **Coverage commentary**, after the results.

`report.md` is only a view. `--verify` checks `report.json`. The report's `executionKind` tells you whether the run was offline or live.

| Exit code | Meaning |
| --- | --- |
| 0 | Valid plan, passing offline self-test, or all 108 live cases passed |
| 1 | Failed, blocked, unsupported or incomplete execution |
| 2 | Invalid arguments or evidence |

**`evidenceIntegrity: true` does not mean 108/108 passed.** It means the verifier accepted the saved evidence and recomputed the result. Check `fullMatrixPassed` for the verdict; see [how to read report fields](validation/README.md#read-a-result).

## Pass rules

- **All 108 cases must pass.** Missing, unsupported, blocked and timed-out cases stay in the denominator. An unavailable model keeps its 18 cases as blocked; a failed shared prerequisite keeps all 108.
- **Each model needs all 18 workflows** to count as compatible.
- **No second chances:** no model subset, automatic case rerun or native OpenAI baseline. A failed case does not skip later cases, and failures are preserved rather than rerun to improve the score.
- **One run, one implementation:** freeze the catalog and implementation hashes before a live run. Interrupting a run stops scheduling but keeps the incomplete evidence.
- **Offline is not live:** offline runs never establish live feature evidence.

## Three separate metrics

Do not mix these numbers; each answers a different question.

| Metric | Calculation / value | Meaning |
| --- | --- | --- |
| Live matrix pass rate | Passed / **108**; per model, passed / **18** | Observed results. Missing, unsupported, blocked and timed-out cases stay in the denominator. |
| Checklist design scope | **75%**: 12 direct + six half-credit + two uncovered groups out of 20 | How broad the reviewer-defined design is. Not a test result or a measure of full feature support. |
| Measured product coverage | **unknown/null**; 90% is a target | Not measured by either number above. The checklist is not an official or usage-weighted support metric. |

Reports also show feature-group evidence for each model. A partially covered group stays partial even if its linked scenarios pass.

## Native paths covered

- **C11:** the actual `bin/codex-ghcp`, production bridge lifecycle and default tool catalog, with no injected `model_catalog_json` or patch profile. It does not certify interactive `/model` or every reasoning effort.
- **C12:** native `review/start` and the reviewer lifecycle, not a review-like prompt. If the native reviewer needs structured output the bridge does not support, the case is **unsupported**, not a pass.
- **C13:** native Plan collaboration mode and a correlated user-input callback. A hidden host answer must reach the final plan without edits.
- **C14:** at least 12 KiB of history, explicit native local compaction and fresh-process resume. Not maximum-context, automatic or remote compaction, or soak certification.
- **C15:** interrupts an observed in-flight owned command, explicitly cleans background terminals, proves the process exited and continues on the same thread.
- **C16:** an owned Streamable HTTP MCP endpoint, temporary bearer authentication, unauthorized rejection, discovery and resources, and error recovery. Not external OAuth or plugin installation.
- **C17:** the native spawn, wait and close lifecycle for one read-only child, with separate thread and SDK sessions.
- **C18:** one marked 503 before inference, one bounded native HTTP retry and no duplicate SDK prompt or tool execution. This is not a rerun of a failed case or a mid-stream retry.

Scenario-specific rules:

- **C03** specifies field types and checks JSON meaning separately from presentation: bare JSON or one JSON fence. `git -c ... diff` counts as a diff.
- **C05** asks for standalone test commands, so a pipeline cannot hide a failing exit code.
- **Tool-call targets** are efficiency diagnostics. A separate, higher hard cap stops runaway execution and fails the case.

## Evidence rules

### Interpretation fixed before execution

- **C12** reads the completed native review's rendered findings or JSON. It still requires exactly one actionable finding at `review.mjs:3`, an actual diff read, the correlated reviewer lifecycle and unchanged files.
- **C13** reads the authoritative completed native `plan` item, not an incidental assistant message. The hidden host answer must be correlated and appear in the final plan. Only read-only exploration is allowed: no edits, mutating commands or broad permission grants.
- **Git-diff evidence** recognizes grouped shell invocations and Git global options, but a quoted `git diff` string is not evidence of execution. Negative tests reject wrong paths or turns, extra findings, missing diffs and uncorrelated or unsafe plans.

These C12, C13 and Git rules were fixed for v4 and carry over unchanged to v6; they are not exceptions added after a run. The C05 command and C15 host-PID changes are described in [v6 runner changes](#v6-runner-changes).

### Isolation

- Every fixture has private temporary homes, protected user-dirty and Git state, and an explicit list of files it may change.
- Native shell environments exclude upstream authentication.
- Unknown callbacks are denied. Only the exact owned approval helper and scoped fixture MCP operations can be approved. A user-input answer is given only to the C13 fixture question. No blanket permission or external OAuth grant is made.
- In live mode, C11 instrumentation wraps the actual SDK and HTTP boundaries without changing production arguments or metadata. Only offline mode replaces the SDK, and the verifier checks which mode was used.
- Temporary MCP credentials are not kept in headers or evidence. Owned processes, servers and SDK sessions must be cleaned up.

### Saved evidence

Reports keep native JSONL, HTTP/SSE, SDK, state, check, cleanup and scenario-specific evidence. Verification checks the contract and implementation hashes, every matrix slot, artifact ownership and hashes, and recomputes the checks and metrics. Hashes identify files; they are not third-party attestation. Raw evidence can stay in the Git-ignored `.runtime` directory; review it for private information before publishing.

## Timing

- Up to four models run at the same time; each model's cases run in sequence.
- Each case limit includes an eight-second cleanup reserve.
- If every case uses its full limit, one model takes 2,220 seconds and the whole run about **75.5 minutes**, including preflight but excluding OS and I/O overhead.
- One hour is a target, not a global cutoff.

## v6 runner changes

v6 fixes three Linux verification assumptions without relaxing the OS sandbox:

- **C05** runs `node --test --experimental-test-isolation=none`, so the same three immutable tests run in one Node process. This avoids the pinned sandbox's loss of captured child stdio ([upstream issue](https://github.com/openai/codex/issues/18473)). The check still requires the real failing and passing exits, all three tests and independent inputs.
- **C08** writes its unchanged measurements directly to stdout's file descriptor instead of the affected Node stream.
- **C15** maps the receipt's namespace PID to a unique descendant of the owned native host with the same working directory, then checks that the host process exited. It never assumes a sandbox PID is global.

Old failed runs remain unchanged.
