# Validation-runner tool metadata repair and real Codex revalidation — 2026-09-22

[한국어](README_KO.md) · [Verification index](../README.md) · [Stability contract](../../STABILITY_TESTING.md)

## Result: 74/77 (96.10%), meeting the 95% target

A **fresh complete 77-case** `application-data-v1` run used this laptop's **official Codex CLI 0.154.0 app-server → production bridge → real Copilot SDK 1.0.14 → exact selected model**. **74 passed and three failed**, meeting the required minimum of 74/77. No cases were blocked, unsupported, timed out or unrun.

**This is not a 77/77 pass.** `fullMatrixPassed=false` and execution/verification exit code **1** remain unchanged. The user's 95% target is distinct from the runner's all-cells-passed condition. Failed cells were neither retried nor replaced with earlier successes.

| Run | Overall | Opus |
|---|---:|---:|
| This repaired-metadata `application-data-v1` run | **74/77 (96.10%)** | **9/11** |
| Previous follow-up, preserved separately | 50/77 (64.94%) | 9/11 |
| Earlier closeout, preserved separately | 50/77 (64.94%) | 9/11 |
| Original v3, preserved separately; not rerun live here | 66/77 (85.71%) | 0/11 |

`v3` remains the default; this result is not substituted as a new v3 measurement. Mechanical SDK checks and separate diagnostics do not earn credit in the 77-cell score.

| Model | Passed |
|---|---:|
| gpt-5.6-sol | 11/11 |
| gpt-5.6-terra | 11/11 |
| gpt-5.6-luna | 11/11 |
| gpt-6-astra | 11/11 |
| claude-opus-5 | 9/11 |
| claude-sonnet-5 | 10/11 |
| claude-haiku-4.5 | 11/11 |

## Change and preserved boundaries

The runtime change is **one fixture-tool description** in `scripts/stability/execute.mjs`. The original description requested a “complete literal value and receipt” without clearly distinguishing the full source text from extracted field values. The actual callback returns the entire UTF-8 file, so its metadata now says so:

```text
Read the owned UTF-8 fixture file once and return its entire plain-text contents unchanged. The result is text, not a record of extracted field values; labels and separators are part of the file content.
```

This **changes model-visible tool metadata**; the complete model input is not claimed to be identical. Profile hashes stay the same, while the implementation hash and frozen source identify the changed description. Unlike the earlier common-system-instruction candidates, this description was followed by improved preservation in the diagnostic and full run. The model's internal interpretation mechanism is not established.

User prompts, tool names/input schemas, fixture generation and returned strings, seven models, 11 scenarios, fault flows, deadlines and literal-output oracles are unchanged. **Production `src/` bridge code and dependencies are unchanged.** The bridge does not repair caller descriptions or model output; SDK foundation instructions, permission denials and filter-error propagation remain intact.

The new regression exercises both profiles × all seven model declarations and verifies unchanged Unicode/whitespace text from the callback. Before/after logs retain the failing and passing regression. The [change audit](change-audit.json) confirms that the sole runtime edit is exactly this description replacement.

## Verification sequence

First, an isolated candidate was declared and frozen before running **S01 once for each of the seven real models**. Every case passed all original 13 checks, with no filters, retries or resource leaks. This diagnostic is not a full-matrix score.

The description and regression were then adopted. The following local checks completed before the new live matrix began; owned native mechanical tests did not overlap it. Matrix concurrency remained the original maximum of four model lanes.

| Check | Result |
|---|---:|
| Targeted regressions | **44/44** |
| Full unit/regression suite | **267/267**, no failures, skips or cancellations |
| Real Codex + mechanical SDK compatibility | **18/18** |
| Real Codex + mechanical SDK `application-data-v1` stability | **11/11** |
| Real Codex + mechanical SDK default v3 stability | **11/11** |
| Scenario design, generated docs and offline stress | Passed |

These local checks made zero real model calls. Stress covered 100 tool results, 100 identical-result retries, ten waiter cancellations and ten generation recoveries, ending with zero queue/state/listeners. The seven real-model diagnostics and full 77-case live run have separate evidence.

## Three remaining failures

| Model/case | Observation |
|---|---|
| Opus S10 | `remember` preserved the source, but `recall` after fresh-process resume triggered explicit SDK filtering |
| Opus S11 | This run filtered **the first `repeat-1`, after tool-result submission**. With no successful data turn, `final-values` also failed; repetition/compaction did not complete |
| Sonnet S05 | Cancellation, tool handoff and cleanup passed, but the SDK answer already omitted `value:`/`receipt:` labels. Preserved payloads alone do not pass the literal oracle |

All three remain failed. Native refusal categories were not collected in this matrix, and earlier categories are not retroactively assigned. **The overall Opus filtering issue is not resolved.**

Cleanup-contract checks, final resource cleanup and supervisor process-group disappearance each passed **77/77**. The three earlier cleanup RPC timeouts did not recur here; cleanup code and limits were not changed. This does not establish an independent causal link between load separation and SDK latency or erase earlier failures.

## Evidence and reproduction

[All 77 cases](summary.json) · [Remaining failures](failure-analysis.json) · [Change audit](change-audit.json) · [Seven diagnostics](diagnostics.json) · [Local checks](local-checks.json) · [Current/frozen and historical verification](verification.json) · [Final audit](final-audit.json) · [Source hashes](source-manifest.json) · [Raw-evidence hashes](evidence-manifest.json)

Raw evidence remains in ignored `.runtime/runner-repair-20260922/`. Published artifacts contain no raw conversations, provider system prompts or credentials. Current and frozen verifiers independently recomputed the same result, and both earlier 50/77 runs were verified with their own frozen sources. Source and user-settings invariance during execution was confirmed.

```sh
# Verify this original evidence: 74/77 is valid but not 77/77, so the exit code is 1.
node .runtime/runner-repair-20260922/live-01/source-snapshot/scripts/stability.mjs \
  --verify .runtime/runner-repair-20260922/live-01/report.json

# A new live run needs a fresh directory and consumes Copilot usage.
npm run test:stability -- --execute --profile application-data-v1 --output .runtime/application-repaired-new
```

Run ID: `dc9d9eda-70d8-4a47-93ba-9172dce7377b`

Execution: **2026-09-22 10:27:56–10:35:24 KST**, approximately 7m 28s.

Implementation hash: `58405707a80c24da513f3db492ccdec845aecf81f3ed9f0c7374a713dd5f8384`

Profile contract hash: `ae362ca209a9de118d4d6b74b6931c348ac0231e642023b1595e44766e37fc9a`

This is one complete run of 11 specific native scenarios, not a multi-hour soak, a 126-case live compatibility certification, whole-product coverage or a guarantee of 95% in every future execution.

Earlier records: [Failure-boundary follow-up](../2026-09-22-fidelity-followup/README.md) · [Opus closeout](../2026-09-22-opus-closeout/README.md).
