# Bridge implementation repair and fresh validation — 2026-09-22

[한국어](README_KO.md) · [Validation index](../README.md) · [Stability contract](../../STABILITY_TESTING.md)

## Result

**66/77 (85.71%)** on the unchanged 11-scenario × 7-model v3 matrix. The ≥95% target requires 74/77 and is **not met**. No model was removed, substituted, or regraded; failed cells were not selectively replaced. Full-matrix pass: **false**.

| Model | Passed |
|---|---:|
| gpt-5.6-sol | 11/11 |
| gpt-5.6-terra | 11/11 |
| gpt-5.6-luna | 11/11 |
| gpt-6-astra | 11/11 |
| claude-opus-5 | 0/11 |
| claude-sonnet-5 | 11/11 |
| claude-haiku-4.5 | 11/11 |

Case-level artifacts report cleanup in 77/77 cases; supervisor timeouts still count as failures even when a case artifact reports cleanup. Source and user settings unchanged during execution: true / true. Current and frozen verifiers both confirm evidence integrity. This is a bounded regression/fault-injection run, not a multi-hour soak or a product support percentage.

## Verified implementation defects and repairs

| Before | Repair |
|---|---|
| Mid-history system/developer messages were demoted to serialized user context | Collect all top-level instructions in the SDK append channel; reject policy changes while tools are pending |
| Assistant phase was dropped and data could close the history delimiter | Preserve commentary/final_answer and escape delimiter characters losslessly |
| New client messages were appended to tool-result text | Send separate immediate user messages before returning byte-exact tool results |
| Text completion could commit on an intermediate turn_end | Wait for session.idle; retain late usage/errors/corrections; reject empty answers |
| Legacy subordinate events and mismatched pending calls could contaminate root state | Filter both subordinate event shapes and correlate SDK request/session/name/arguments |
| S05 could hide upstream errors behind its ACK gate; teardown ignored the declared reserve | Relay the original stream while probing, clean up cancelled copies, and use the existing bounded reserve |

The mechanical SDK peer now also buffers immediate messages until pending results arrive, as verified against the real SDK; C15/C17 acceptance rules are unchanged. The SDK system/safety foundation, permission denials, selected models, requested effort and explicit filter-error behavior are retained. Reasoning summaries remain disabled consistently. Historical role import is still approximate; see [compatibility](../../COMPATIBILITY.md).

## Regression evidence

- Baseline: 195/202; the seven pre-existing runner regressions failed.
- Nineteen newly added regressions failed before the implementation repair; two more reproduced the mechanical peer's premature steering execution.
- After repair: **223/223** tests, with no skipped or cancelled tests.
- Real Codex + scripted SDK: **18/18** compatibility workflows and **11/11** stability scenarios (zero model calls).
- Offline stress: 100 tool-result cycles, 100 exact retries, 10 cancelled waiters, 10 recovered generations; zero final states/queue/listeners.
- Unscored real-SDK context probe: separate SDK user message, original tool-result text, one result submission across an exact retry, and both generated markers in the response. Not counted in the 77-cell score.

## Remaining failures

11 cells failed; 11 contain explicit root SDK filter metadata. These failures remain failures. This observation neither establishes the upstream filter's root cause nor proves that the bridge has no remaining defects. The implementation fixes above are independently reproduced and tested; they are not presented as a demonstrated fix for the upstream filtering.

| Model | Scenario | Status | Observed evidence |
|---|---|---|---|
| claude-opus-5 | S01 | failed | explicit SDK content_filter |
| claude-opus-5 | S02 | failed | explicit SDK content_filter |
| claude-opus-5 | S03 | failed | explicit SDK content_filter |
| claude-opus-5 | S04 | failed | explicit SDK content_filter |
| claude-opus-5 | S05 | failed | explicit SDK content_filter |
| claude-opus-5 | S06 | failed | explicit SDK content_filter |
| claude-opus-5 | S07 | failed | explicit SDK content_filter |
| claude-opus-5 | S08 | failed | explicit SDK content_filter |
| claude-opus-5 | S09 | failed | explicit SDK content_filter |
| claude-opus-5 | S10 | failed | explicit SDK content_filter |
| claude-opus-5 | S11 | failed | explicit SDK content_filter |

## Earlier complete run and bounded diagnostics

The first full run scored **65/77**: Opus failed 11 cells, and gpt-5.6-luna/S07 timed out at the supervisor despite its case artifact passing in 26 seconds. It remains **timed-out**, not regraded. The late process-exit cause is unresolved; a separate three-cycle, zero-inference SDK loss/recovery probe did not reproduce retained Node handles. This earlier run is retained and frozen-verified in summary.json. The final full run follows a mechanical-peer correction and two regression tests, not a failed-cell-only retry. Production source and acceptance rules were identical between the two live runs.

Opus arithmetic succeeded through both the direct SDK and the production manager. Arithmetic also succeeded with the complete client instructions alone and with the full seven-tool catalog alone. The unchanged fixture task with only its declared fixture tool still produced explicit filtering, even with a single plain user message and no transcript replay. This narrows the reproduction but does not isolate the exact task/tool-call trigger or prove the bridge fault-free. These simplified probes are diagnostic only and never count toward the 77 cells. SDK foundation, filter policy and permission denials were preserved.

## Reproducible evidence

- [Summary and all 77 statuses](summary.json)
- [Current/frozen verification](verification.json)
- [Failure facts without score changes](failure-analysis.json)
- [Local checks and unscored protocol probe](local-checks.json)
- [Frozen source hashes](source-manifest.json) · [Raw-evidence hashes](evidence-manifest.json)

Raw local evidence: `.runtime/bridge-repair-20260922/`. The historical deleted validation documents were not restored. The catalog hash remains `bcb5958d066a1628552f059aecd6e4fb04808acab0d0443ec70075df6e1b23fd`; implementation hash is `9d261cf6bef109968c8c72586b421fbd964f785c24eeef85af8af7389bbb1379`.
