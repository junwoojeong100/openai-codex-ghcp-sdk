# Verification records

[한국어](README_KO.md) · [Stability contract](../STABILITY_TESTING.md)

## Latest: bridge and terminal-runner integration — 2026-09-23 KST

[Implementation, full matrices, additional live tests and retained failures](2026-09-22-terminal-integration/README.md)

- Final independent matrices: default **v3 66/77 (85.71%)**, separate **application-data-v1 72/77 (93.51%)**. Neither is 77/77 or meets the previously recorded 95% target.
- PTY and Playwright paths are now repository-owned commands. Extra live testing exposed and fixed ANSI scroll-region handling; the failed run and preliminary matrix remain separate.
- Remaining outcomes are explicit upstream filtering, literal-label omission and missing repeated tool calls. No oracle weakening, automatic retry, output rewriting or cross-profile score combination.
- The final matrices were independently verified against current/frozen source. [Full results and source hashes](2026-09-22-terminal-integration/summary.json) · [Additional real-terminal checks](2026-09-22-terminal-integration/additional-live.json).

## Earlier: tool return-type metadata repair meets the ≥95% target — 2026-09-22

[Change scope, fresh full run and original evidence](2026-09-22-runner-repair/README.md)

- A new independent full `application-data-v1` run scored **74/77 (96.10%)**, meeting the target. It is not 77/77; three failures and exit code 1 remain.
- All four GPT models and Haiku passed **11/11** each; Opus **9/11**, Sonnet **10/11**. Opus S10/S11 filtering and Sonnet S05 label omission remain unresolved.
- The change is one fixture-tool description plus a regression. It declares the actual full UTF-8 text result; user prompts, fixtures, oracles and the production bridge are unchanged. The changed model-visible metadata is explicit.
- Seven pre-matrix diagnostic cases and mechanical checks remain separate. Final checks: **267/267**, mechanical compatibility **18/18**, both mechanical stability profiles **11/11** each.
- Neither earlier 50/77 run nor v3's 66/77 was regraded or combined. [Current/frozen verification](2026-09-22-runner-repair/verification.json) · [Change audit](2026-09-22-runner-repair/change-audit.json).

## Earlier: further live validation and failure-boundary investigation — 2026-09-22

[Fresh full run, separate diagnostics and unresolved findings](2026-09-22-fidelity-followup/README.md)

- Fresh full `application-data-v1`: **50/77 (64.94%), Opus 9/11**. Its total matches the earlier result, but individual cells differ.
- All 24 literal-output failures, two Opus filters and three cleanup RPC timeouts remain failures (two cases overlap output and cleanup).
- Four agents worked in parallel, with 21 separate real native diagnostic cases. A Haiku wire sample retained the exact provider-bound tool text despite labels missing from its answer.
- Three shared-instruction candidates were rolled back. Final production sources/contracts are unchanged and **the ≥95% target is unmet**.
- Final directly recorded checks: **266/266**, mechanical compatibility **18/18**, mechanical stability **11/11**. [Current/frozen verification](2026-09-22-fidelity-followup/verification.json) · [Final audit](2026-09-22-fidelity-followup/final-audit.json).

## Earlier: optional-profile validation and closeout — 2026-09-22

[Final report, remaining failures and evidence](2026-09-22-opus-closeout/README.md)

- Last full live run, separate `application-data-v1` profile: **50/77 (64.94%)**, **Opus 9/11**.
- **Unresolved.** Opus S10/S11 retained explicit SDK filtering; 25 other cases failed literal-output checks. No failure was waived or replaced.
- Final checks: **266/266** unit/regression, **18/18** real Codex + mechanical SDK compatibility, **11/11** optional-profile mechanical stability.
- Original/default v3 remains **66/77 (85.71%), Opus 0/11**. Prompt profiles and their evidence are separate; the optional profile is not a fix for the original refusal.
- Further live experiments stopped at the user's request. [Final audit](2026-09-22-opus-closeout/final-audit.json) · [Profile definitions](2026-09-22-opus-closeout/profiles.json).

## Earlier: Opus/Sonnet comparison, source fixes and revalidation — 2026-09-22

[Multidirectional analysis and complete evidence](2026-09-22-opus-analysis/README.md)

- Repeated direct-SDK/production-manager comparisons: **Sonnet 4/4 exact-copy successes, Opus 4/4 refusals**.
- Native upstream `refusal` / `reasoning_extraction` metadata observed, including an unchanged captured S01 body. The exact classifier trigger remains unconfirmed; model-specific SDK foundation differences are documented.
- Fixed filtering missed after handoff/idle, response-commit races and first-error overwrite. Six new regressions were first demonstrated failing.
- Final tests **248/248**; real Codex + mechanical SDK compatibility **18/18**, stability **11/11**.
- Fresh unchanged full live matrix: **66/77 (85.71%)**. **The ≥95% target is not met.** No successful cells were imported from earlier runs or unscored diagnostics.
- [Current/frozen verification](2026-09-22-opus-analysis/verification.json) · [Final audit](2026-09-22-opus-analysis/final-audit.json) · [Reusable diagnostic](../OPUS_DIAGNOSTICS.md)

## Earlier: bridge implementation repair — 2026-09-22

[Implementation changes, results and remaining failures](2026-09-22-bridge-repair/README.md)

| Verification | Result | Scope |
|---|---:|---|
| Unit/controller regressions | 223/223 | No model calls |
| Native compatibility runtime | 18/18 | Real Codex + scripted SDK; no model calls |
| Native stability runtime | 11/11 | Real Codex + scripted SDK; no model calls |
| Full live stability matrix | **66/77 (85.71%)** | All seven exact models × 11 unchanged v3 scenarios |

**The ≥95% target is not met:** at least 74/77 is required. Six models passed 11/11; `claude-opus-5` failed 11/11 with explicit SDK filter metadata. The failures remain in the denominator. This does not establish the filter's root cause or prove that the bridge has no remaining defects.

The [report](2026-09-22-bridge-repair/README.md) links the complete matrix, current/frozen verification, source hashes and local evidence. It also records the earlier complete 65/77 run, including its unresolved process-exit timeout; that timeout was not regraded. The final run is a separate full matrix, not a combination of selected cells.

Archived verification documents were removed before this repair at the user's request and have not been restored. Git history was not rewritten. These results are not a 126-cell live compatibility certification, a multi-hour soak, or a whole-product support percentage.
