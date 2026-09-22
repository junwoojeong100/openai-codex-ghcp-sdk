# Further live validation and failure-boundary investigation — 2026-09-22

[한국어](README_KO.md) · [Verification index](../README.md) · [Stability contract](../../STABILITY_TESTING.md)

## Result: below 95%, no validated production change

A fresh full `application-data-v1` run on this laptop's real Codex environment scored **50/77 (64.94%), Opus 9/11**. The target requires at least **74/77** and remains unmet. All 77 cases ran: 27 failed, with zero blocked, unsupported, timed-out or unrun cases.

| Run | Overall | Opus |
|---|---:|---:|
| This fresh `application-data-v1` run | **50/77 (64.94%)** | **9/11** |
| Previous closeout `application-data-v1`, preserved separately | 50/77 (64.94%) | 9/11 |
| Original/default v3, preserved separately; not rerun here | 66/77 (85.71%) | 0/11 |

The totals match, but the passing and failing cells differ. This result does not combine cells from previous runs or diagnostics, and no failure was regraded. `v3` remains the default profile.

| Model | Passed in this run |
|---|---:|
| gpt-5.6-sol | 10/11 |
| gpt-5.6-terra | 4/11 |
| gpt-5.6-luna | 5/11 |
| gpt-6-astra | 11/11 |
| claude-opus-5 | 9/11 |
| claude-sonnet-5 | 11/11 |
| claude-haiku-4.5 | 0/11 |

## Observed failure boundaries

**24 literal-output failures:** 22 cases omitted the `value:`/`receipt:` labels; two omitted the entire receipt line. Two of these cases also failed cleanup. Every failing native data-turn answer matched an actual SDK assistant message: the response adapter did not remove the labels. Terra S07's `before-loss` answer and Luna S03's answer already lacked the second line at the SDK output boundary.

A separate Haiku wire observation confirmed that the **73-byte tool result reached the actual provider request byte-for-byte**, and the common literal-copy guidance reached its system context. Labels were nevertheless absent from the model's answer, without a filter signal. Only hashes and equality flags are published in [diagnostics](diagnostics.json). This sample is not a claim to have directly observed the provider payload for every other request.

**Two Opus filters:** S10's `recall` after a fresh-process resume and S11's same-session `repeat-2` again produced explicit SDK filter signals. S11 failed without historical replay. No observed text/history/phase mismatch or safely correctable session defect was established. Native refusal categories were not collected in this full matrix; earlier `reasoning_extraction` findings are not retroactively assigned to these cases.

**Three cleanup RPC deadline failures:** final resource cleanup and supervisor process-group disappearance were confirmed for all 77 cases, but these five-second RPC violations remain failures. The cleanup contract itself passed **74/77**, a different measure from the overall score.

| Case | Limit | Observed timeout reporting | Other failure |
|---|---:|---|---|
| Sol S06 | 5,000ms per operation | disconnect at 6,604ms; delete at 5,002ms | None |
| Terra S06 | 5,000ms per operation | disconnect at 5,036ms; delete at 5,017ms | final-values |
| Luna S09 | 5,000ms per operation | disconnect at 5,016ms | final-values |

Terra S06's ACK gate was released 22ms before disconnect began. In Luna S09, fault-session cleanup completed normally; the timeout affected the **second session during normal shutdown**, after recovery completed with pending=0 and queue=0. Thus a held ACK or unfinished tool is not established as a common cause. SDK cleanup RPC latency is observed, but its root cause and a safe bridge sequencing correction remain unconfirmed. Deadlines were not increased and errors were not hidden.

## Actual improvement attempts and rollback

Four agents investigated output conversion, session lifecycle, installed SDK contracts and regressions. Separately from the matrix, **21 real native diagnostic cases** ran: five original-source cases, nine common-guidance cases, six additional-candidate cases and one wire observation. This is not a count of model HTTP requests, and none earns credit in the 77-cell score.

Three **general shared instruction candidates** asked for complete character/label preservation only when exact reproduction was requested. They contained no model-specific or fixture-specific special cases, and did not rewrite user requests, tool results or model output. All three failed to resolve Haiku's core failure. The two additional candidates have a saved prospective declaration, frozen sources, exactly six executions and no retries.

The ineffective guidance and its temporary test were rolled back. **Final production code, tests, runners, oracles and dependencies are byte-identical to the previous closeout.** The fresh matrix also used that restored source. Its score is not presented as a code-improvement result.

No further safely adoptable production correction was established from this evidence. Model omissions, upstream filters and unexplained cleanup latency leave the 95% target blocked. Models were not excluded, filters were not disabled, output was not repaired, inference was not automatically retried, and another profile's score was not substituted.

## Final local checks

| Check | Result |
|---|---:|
| Existing unit/regression suite | **266/266**, no failures, skips or cancellations |
| Real Codex + mechanical SDK compatibility | **18/18** |
| Real Codex + mechanical SDK `application-data-v1` stability | **11/11** |
| Scenario design and generated documentation | Passed |
| Offline stress | Passed |

Stress covered 100 tool results, 100 identical-result retries, ten waiter cancellations and ten generation recoveries, with zero remaining queue/state/listeners. Final command logs, exit codes and elapsed times were saved directly to files. These checks made zero real model calls and are not added to the live score.

## Evidence and reproduction

[All 77 cases](summary.json) · [Failure analysis](failure-analysis.json) · [Separate diagnostics](diagnostics.json) · [Local checks](local-checks.json) · [Current/frozen verification](verification.json) · [Final audit](final-audit.json) · [Source hashes](source-manifest.json) · [Raw-evidence hashes](evidence-manifest.json)

Raw evidence and one-off diagnostic drivers remain in ignored `.runtime/validation-improve-20260922/`. Published artifacts contain no account credentials, raw conversations or provider system prompts. Source/settings invariance, current/frozen verifier agreement and the original 50/77 report's integrity were confirmed. Hashes are not third-party attestation; this is not a multi-hour soak or whole-product reliability certification.

```sh
# Verify this run using its original frozen source. Valid non-passing evidence exits 1.
node .runtime/validation-improve-20260922/live-confirmation/source-snapshot/scripts/stability.mjs \
  --verify .runtime/validation-improve-20260922/live-confirmation/report.json

# A new live run needs a fresh directory and consumes Copilot usage.
npm run test:stability -- --execute --profile application-data-v1 --output .runtime/application-followup-new
```

Run ID: `c8f92af1-b96b-4e3b-8e5f-fd56270f40b7`

Execution: **2026-09-22 09:30:45–09:42:29 KST**, approximately 11m 45s.

Implementation hash: `74a337f0e2c388707393ba51da9b1c539d4bb37b0979395651e6e1760eff549f`

Profile contract hash: `ae362ca209a9de118d4d6b74b6931c348ac0231e642023b1595e44766e37fc9a`

Previous record: [Opus closeout](../2026-09-22-opus-closeout/README.md).
