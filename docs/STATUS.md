# Current implementation status — 2026-09-25

[한국어](STATUS_KO.md) · [Verification guide](VERIFICATION.md) · [Final result](validation/README.md)

**codex-ghcp-essential-v1: 36/36 — PASS.** Actual execution: **2026-09-25, 08:19–08:25 KST**.

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

The final closeout corrected documentation and rechecked this run's evidence and media references. Runtime code, tests and the verifier still match the recorded source fingerprint; no new live run or model calls were needed for this documentation audit. The 36/36 result refers to the execution time above.

Local checks passed **376/376** and offline real-Codex runtime checks **21/21**, sequentially before the live run on the same source fingerprint. The live run had no transport or session errors; transport and startup-catalog recovery counts were zero. Recovery safety remains covered by deterministic regressions, not by live fault injection in this run.

The [result and media](validation/README.md) retain a **101.76-second edited recording and eight current screenshots**, including both Sonnet V02 stages. Full recordings, baseline checkpoints, facts and frozen source remain in `.runtime/verification-final/`; the evidence was recomputed with integrity checks.

Coverage is limited to essential CLI/TUI, tool round trips, model switching, interruption recovery and compaction/resume. Protocol, authentication, queues, deadlines, handoff and no-replay regressions remain. Multimodal input, schema-enforced JSON, hosted tools, WebSockets and remote compaction remain unsupported; unattended endurance is unproved.

Only the current contract, latest run and its media are retained; no whole-product implementation percentage is assigned. The raw run is local and Git-ignored, not included in a fresh clone.
