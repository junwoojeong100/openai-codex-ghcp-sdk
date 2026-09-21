# Verification records

[한국어](README_KO.md) · [Stability contract](../STABILITY_TESTING.md)

## Final: optional-profile validation and closeout — 2026-09-22

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
