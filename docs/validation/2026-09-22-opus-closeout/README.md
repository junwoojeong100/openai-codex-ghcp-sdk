# Opus validation closeout — 2026-09-22

[한국어](README_KO.md) · [Verification index](../README.md) · [Stability contract](../../STABILITY_TESTING.md)

## Final status: unresolved; work closed at the user's request

The last live `application-data-v1` run scored **50/77 (64.94%)**, including **Opus 9/11**. **The ≥95% target and full-matrix pass were not achieved.** No further model experiments or retries were performed after this run. Final local checks consumed zero additional model calls.

This is a **separate contract with shorter application-data task wording**, not a regrade or fix of the original v3 refusal. The latest original-v3 result remains **66/77 (85.71%), Opus 0/11**. Successful cells are not combined across runs or profiles. The default remains `v3`.

## Last full live run

| Model | Passed |
|---|---:|
| gpt-5.6-sol | 11/11 |
| gpt-5.6-terra | 2/11 |
| gpt-5.6-luna | 5/11 |
| gpt-6-astra | 11/11 |
| claude-opus-5 | 9/11 |
| claude-sonnet-5 | 11/11 |
| claude-haiku-4.5 | 1/11 |

All 77 cells ran: 50 passed, 27 failed, with no not-run, blocked or timed-out cells. Opus failed **S10 on recall after fresh-process resume** and **S11 on repeat-2** with explicit SDK filter metadata. The other **25 failures were `final-values` mismatches**: nine on gpt-5.6-terra, six on gpt-5.6-luna and ten on claude-haiku-4.5. Literal-output failures were not waived as presentation differences.

Resource cleanup and supervisor process-group exit were confirmed for **77/77** cells. Source and user settings stayed unchanged during the run. This scored run did not capture native refusal categories: the earlier diagnostic `reasoning_extraction` category is not retroactively assigned to these failures. See [failure evidence](failure-analysis.json).

## Changes and boundaries

Earlier production fixes preserve client instructions and assistant phase, separate user context from tool output, validate pending-call identities, wait for idle, monitor late filtering and preserve the first error. SDK foundation, permission rejection and exact model routing remain intact.

The final stage adds an opt-in `application-data-v1` profile and verification guards against importing another profile's passing cases. The original catalog and v3 hash are unchanged. Models, fixture, fault schedule, budgets and literal-output checks are retained. Production `src/` is unchanged since the profile baseline, and the bridge never silently rewrites user requests.

A shorter standalone diagnostic succeeded, but that did not establish repeat/resume reliability or a universal alternative for all models. **The optional profile is not promoted as a solution or a default.**

## Final local checks

| Check | Result |
|---|---:|
| Unit/regression tests | **266/266** |
| Real Codex + mechanical SDK compatibility | **18/18** |
| Optional-profile real Codex + mechanical SDK stability | **11/11** |
| Scenario design and generated documentation | Passed |
| Offline stress | Passed |

Stress covered 100 tool-result cycles, 100 exact retries, 10 cancelled waiters and 10 recovered generations, ending with no queued requests, states or listeners. Offline results do not count as live successes. Current and frozen evidence verification agree.

## Explicit profile selection

These commands document reproduction; they were not run again during closeout. `--execute` consumes actual model usage.

```sh
npm run test:stability -- --plan
npm run test:stability -- --plan --profile application-data-v1
npm run test:stability -- --runtime --profile application-data-v1 --output .runtime/application-offline-new
npm run test:stability -- --execute --profile application-data-v1 --output .runtime/application-live-new
npm run test:stability -- --verify .runtime/application-live-new/report.json
```

Verification uses the recorded profile and catalog hash; `--profile` cannot override `--verify`. After source changes, use that run's frozen `source-snapshot` verifier. Evidence directories cannot be overwritten.

## Evidence

[All 77 cells](summary.json) · [Failures](failure-analysis.json) · [Profile definitions](profiles.json) · [Local checks](local-checks.json) · [Prior diagnostics](prior-diagnostics.json) · [Current/frozen verification](verification.json) · [Final audit](final-audit.json) · [Source hashes](source-manifest.json) · [Evidence hashes](evidence-manifest.json)

Previous records: [bridge repair](../2026-09-22-bridge-repair/README.md) and [Opus/Sonnet comparison](../2026-09-22-opus-analysis/README.md). Raw artifacts remain in ignored `.runtime/opus-resolution-20260922/` and are not committed or pushed. Published evidence contains summaries, allowlisted metadata and hashes rather than credentials or raw conversation logs. This is not a long-duration soak or whole-product reliability certification.

Run: `2ffc04e3-7d48-4c5a-9183-878092a56bf5`

Finished: `2026-09-21T23:34:30.349Z` (2026-09-22 08:34:30 KST)

Implementation: `74a337f0e2c388707393ba51da9b1c539d4bb37b0979395651e6e1760eff549f`

Optional-profile contract: `ae362ca209a9de118d4d6b74b6931c348ac0231e642023b1595e44766e37fc9a`
