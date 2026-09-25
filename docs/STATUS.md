# Current implementation status — 2026-09-25

[한국어](STATUS_KO.md) · [Verification guide](VERIFICATION.md) · [Final result](validation/README.md)

**codex-ghcp-essential-v1: 36/36 — PASS.** Actual execution: **2026-09-25, 10:08–10:15 KST**.

| Model | Passed | Failed cases |
| --- | --- | --- |
| claude-opus-5.5 | 6/6 | — |
| claude-sonnet-5 | 6/6 | — |
| claude-haiku-4.5 | 6/6 | — |
| gpt-6-astra | 6/6 | — |
| gpt-6-sol | 6/6 | — |
| gpt-6-luna | 6/6 | — |

**All 36 model/scenario cases and all common bridge checks passed in one live run**, with `fullMatrixPassed=true` and `evidenceIntegrity=true`. Every model's V02 recorded a failing test run with exit 1 before any patch, then native `apply_patch` and the same three passing tests with exit 0. The baseline workspace snapshot matched the original; the final snapshot differed only in `discount.mjs`, with tests and existing user files preserved at both checkpoints.

## Verified procedure and limits

- **V02 is a staged workflow:** the same two turns apply to all six models. A read-only diagnosis must produce native failure evidence and an unchanged workspace before the runner sends a repair request. Missing evidence, premature edits or masked exits fail without a corrective prompt or case retry.
- **What did not change:** the six scenarios, exact models, case deadlines, 36/36 rule, failing/passing test requirements and faithful command/result transport. This demonstrates the gated two-turn workflow, not guaranteed adherence to a compound single-turn request.

The final review fixed two verification-driver defects: a cached update menu could be mistaken for a composer, and a completed SSE response could precede Codex's own task completion. Pinned verification now disables startup update checks, rejects update menus without input and waits for matching native task-completion receipts before continuing. Production bridge code and model/tool semantics are unchanged. A complete new live matrix was run on the corrected source; the 36/36 result is from that run, not a regrade or pooled score.

Local checks passed **386/386** and offline real-Codex runtime checks **22/22**, sequentially before the live run on the same source fingerprint. The latter includes a deliberately cached newer release and cold resume with the actual pinned CLI. The live run had no model transport/session errors; **three startup-catalog timeouts recovered within the existing startup budget**, with no case retry or model substitution. Transport-error recovery was not exercised live.

**Remote CI is separate:** this page retains the latest local live result. Check [GitHub Actions](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/actions) for a specific commit's CI status; it is not included in the 36-case score.

The [result and media](validation/README.md) retain a **103.08-second edited recording and eight current screenshots**, including both Sonnet V02 stages. Full recordings, baseline checkpoints, facts and frozen source remain in `.runtime/verification-final/`; the evidence was recomputed with integrity checks.

Coverage is limited to essential CLI/TUI, tool round trips, model switching, interruption recovery and compaction/resume. Protocol, authentication, queues, deadlines, handoff and no-replay regressions remain. Multimodal input, schema-enforced JSON, hosted tools, WebSockets and remote compaction remain unsupported; unattended endurance is unproved.

Only the current contract, latest run and its media are retained; no whole-product implementation percentage is assigned. The raw run is local and Git-ignored, not included in a fresh clone.
