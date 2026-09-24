# Integrated compatibility verification

[한국어](COMPATIBILITY_TESTING_KO.md) · [Guide map](../README.md#testing) · [Scenario reference](NATIVE_SCENARIOS.md) · [Product boundaries](COMPATIBILITY.md)

Test end-to-end development workflows with **18 scenarios × six models = 108 cases**. Each case is one scenario on one model. The **contract** (versioned scenarios and pass criteria) is `codex-ghcp-workflows-18-v6` (schemaVersion 6). This suite is separate from the 66-case stability and 72-case TUI suites; passing either of those does not pass this one.

## Prepare and run

Run from the repository root after `npm ci`. Pick the mode for your goal; each mode works on its own.

| Goal | Mode | Calls real models? |
| --- | --- | --- |
| Inspect the scenarios or check their design | [Plan and local checks](#plan-and-local-checks) | No |
| Check the runner with simulated SDK responses | [Offline runtime](#offline-runtime) | No |
| Measure all 108 cases against Copilot models | [Live matrix](#live-matrix) | **Yes** |
| Recompute an existing report from its evidence | [Verify a saved report](#verify-a-saved-report) | No |

### Plan and local checks

**No model calls, Codex installation or Copilot login.** The default mode prints the 108-case contract without executing any cases:

```bash
npm run test:compatibility -- --plan
```

Use `npm run test:scenarios` to check scenario design. For documentation-only changes, `npm run test:docs` is enough: it checks current guides, command examples and generated scenarios without running the examples.

### Runtime prerequisites

For offline or live execution, install Node 22.12+, Codex **0.154.0** and use a working OS sandbox. Follow the [CLI installation step](../README.md#2-install-dependencies). No browser is required. Only live execution needs a Copilot login.

### Offline runtime

**No model calls.** With the [runtime prerequisites](#runtime-prerequisites) installed, run:

```bash
npm run test:compatibility:runtime
```

This uses real Codex with an **SDK double** (local simulated responses instead of a model) and isolated credentials, including the actual launcher in C11. It checks the test runner, not live model compatibility. The stricter Node requirement applies to these runtime checks; normal launches use the [README requirements](../README.md#requirements).

### Live matrix

**Consumes Copilot usage.** Install the [runtime prerequisites](#runtime-prerequisites) and complete the [Copilot account check](../README.md#3-check-installation-and-account-access). No OpenAI API key is needed.

Running all 108 cases requires access to **all six [supported models](../README.md#models)**, not just the default model. Check them with `./bin/ghcp-models`; login alone does not establish model access.

Before running, retain a separate copy of the exact source and dependency lockfile; this runner does **not** save a source snapshot. Keep the source unchanged until you have verified the report. Choose a new output directory for each run:

```bash
npm run test:compatibility -- --execute --output .runtime/compatibility-new-run
```

Existing output folders are never overwritten. There is no model subset, automatic case rerun or native OpenAI baseline. An unavailable model retains 18 blocked cases; shared prerequisite failure retains all 108 cases. Case failures do not skip later cases. Interruption stops scheduling and preserves incomplete evidence.

Up to four models run concurrently, with each model's cases run in sequence. Each case includes an eight-second cleanup reserve. Exhausting every deadline gives 2,220 seconds/model and a **75.5-minute** scheduling estimate including preflight, excluding OS/I/O overhead. One hour is a target, not a global cutoff.

### Verify a saved report

**No model calls or case reruns.** Use the same source and dependencies as the run; if the source has changed since, follow [verify after source changes](#verify-after-source-changes) instead.

Verify every finished run, including one with failed cases. Run the command on its own: a run with failures exits nonzero, so chaining it after `--execute` with `&&` would skip verification. Use the run's output directory:

```bash
npm run test:compatibility -- --verify .runtime/compatibility-new-run/report.json
```

## Read the result

Open `.runtime/compatibility-new-run/report.md`: the verdict and per-model counts come first, followed by **Cases needing attention** with failed checks, recorded errors and links to case artifacts. **Complete matrix** retains all 108 rows; coverage commentary follows the results. `report.json` is the verification input, not the Markdown view.

**`evidenceIntegrity: true` does not mean 108/108 passed.** It means the verifier accepted the saved evidence and recomputed result. Check `fullMatrixPassed` separately; [report fields and examples](validation/README.md#read-a-result).

| Exit code | Meaning |
| --- | --- |
| 0 | Valid plan, passing runtime self-test, or **108/108** live cases passed |
| 1 | Failed, blocked, unsupported or incomplete execution |
| 2 | Invalid arguments or evidence |

Use the report's `executionKind` to distinguish offline from live.

### Verify after source changes

Retain the complete run directory and the [source and dependency lockfile saved before execution](#live-matrix).

From that preserved source tree, with the matching dependencies installed, replace the example path with the **absolute path to the original report**:

```bash
node scripts/compatibility.mjs --verify /absolute/path/to/compatibility-run/report.json
```

Unlike this runner, stability and TUI save a source snapshot automatically. The [verification index](validation/README.md) contains published summaries, not complete `.runtime` bundles; do not pass those summaries to `--verify`. Without the matching source and original artifacts, independent recomputation is unavailable. Older v5/v4 reports require their original runner, not v6.

## Three separate metrics

| Metric | Calculation / value | Meaning |
| --- | --- | --- |
| Live matrix pass rate | Passed / **108**; per model, passed / **18** | Observed results. Missing, unsupported, blocked and timed-out cases remain in the denominator; each model needs all 18 workflows for compatibility. |
| Checklist design scope | **75%**: 12 direct + six half-credit + two uncovered groups out of 20 | Reviewer-defined design breadth, not successful tests or exhaustive feature support. |
| Measured product coverage | **unknown/null**; 90% is a target | Not measured by either number above. The checklist is not an official or usage-weighted support metric. |

Reports also show feature-group evidence per model. Offline runs never establish live feature evidence. Partial scope remains partial even if its linked scenarios pass.

## Native paths covered

- **C11:** actual `bin/codex-ghcp`, production bridge lifecycle and default tool catalog; no injected `model_catalog_json`/patch profile. This does not certify interactive `/model` or every reasoning effort.
- **C12:** native `review/start` and reviewer lifecycle, not a review-like prompt. If the native reviewer requires structured output unsupported by the bridge, that is an **unsupported** case, not a pass.
- **C13:** native Plan collaboration mode and a correlated user-input callback. A hidden host answer must reach the final plan without edits.
- **C14:** ≥12 KiB of history, explicit native local compaction and fresh-process resume. Not maximum-context, automatic/remote compaction or soak certification.
- **C15:** interrupt an observed in-flight owned command, explicitly clean background terminals, prove its process exited and continue on the same thread.
- **C16:** owned Streamable HTTP MCP endpoint, temporary bearer authentication, unauthorized rejection, discovery/resources and error recovery. Not external OAuth or plugin installation.
- **C17:** native spawn/wait/close lifecycle for one read-only child, with distinct thread and SDK sessions.
- **C18:** one marked 503 before inference, one bounded native HTTP retry and no duplicate SDK prompt/tool execution. Not retrying a failed case or a mid-stream response.

C03 now explicitly specifies field types and distinguishes semantic JSON checks from presentation (bare JSON or one JSON fence). `git -c ... diff` is recognized. C05 requests standalone test commands so pipelines cannot mask the failing exit. Tool-call targets are **efficiency diagnostics**; a separate higher hard cap bounds runaway execution.

## Evidence interpretation (fixed before execution)

- C12 reads the native completed review's rendered findings or JSON. It still requires exactly one actionable finding at `review.mjs:3`, an actual diff read, the correlated reviewer lifecycle and unchanged files.
- C13 reads the authoritative completed native `plan` item, not an incidental assistant message. The hidden host answer must be correlated and appear in the final plan; only read-only exploration is allowed, with no edits, mutating commands or broad permission grant.
- Git-diff evidence recognizes grouped shell invocations and Git global options, but a quoted `git diff` string is not execution evidence. Negative tests reject wrong paths/turns, extra findings, missing diffs and uncorrelated or unsafe plans.
- These C12/C13 and Git rules were fixed for v4 and carry over unchanged to v6; they are not post-run exceptions. The C05 command and C15 host-PID evidence changes are described in [v6 runner changes](#v6-runner-changes). Freeze catalog and implementation hashes before live execution; preserve failures and do not rerun cases to improve the score.

## Isolation and evidence

All fixtures have private temporary homes, immutable user-dirty/Git state and explicit mutation allowlists. Native shell environments exclude upstream authentication. Unknown callbacks are denied. Only the exact owned approval helper and scoped fixture MCP operations can be consented. A request-user-input response is supplied only to the C13 fixture question. No blanket permission or external OAuth grant is made.

C11 instrumentation wraps the actual SDK and HTTP boundaries in live mode without changing production arguments or metadata. Only offline mode replaces the SDK, and that mode is checked when reading evidence. Temporary MCP credentials are not retained in headers/evidence. Owned processes, servers and SDK sessions must be cleaned.

Reports retain native JSONL, HTTP/SSE, SDK, state, assertion, cleanup and scenario-specific evidence. Verification checks contract and implementation hashes, every matrix slot, artifact ownership/hashes, recomputed assertions and metrics. Hashes are not third-party attestation. Inspect evidence for private information before publishing; raw evidence can stay under ignored `.runtime`.

## v6 runner changes

v6 corrects three Linux verification assumptions without relaxing the OS sandbox. C05 runs `node --test --experimental-test-isolation=none`: the same three immutable tests execute in one Node process, avoiding the pinned sandbox's loss of captured child-stdio ([upstream issue](https://github.com/openai/codex/issues/18473)). The oracle still requires the real failing and passing exits, all three tests and independent inputs. C08 writes its unchanged measurements directly to stdout's file descriptor instead of the affected Node stream. C15 maps the receipt's namespace PID to a unique descendant of the owned native host with the same working directory before checking that the host process exits; it never assumes a sandbox PID is global. Old failed runs remain unchanged.
