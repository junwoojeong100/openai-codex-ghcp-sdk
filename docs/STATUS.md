# Current implementation status — 2026-09-25

[한국어](STATUS_KO.md) · [Verification guide](VERIFICATION.md) · [Final result](validation/README.md)

**codex-ghcp-essential-v1: 34/36 — NOT PASSED.** Actual execution: **2026-09-25, 10:58–11:06 KST**.

All 36 cases were executed once on the updated source. The pass rule remains 36/36; failures were not retried, replaced with earlier successes or removed from the score. `evidenceIntegrity=true` verifies the records; `fullMatrixPassed=false` records the failed outcome.

| Model | Passed | Failed cases |
| --- | --- | --- |
| claude-opus-5.5 | 5/6 | V04 |
| claude-sonnet-5 | 6/6 | — |
| claude-haiku-4.5 | 6/6 | — |
| gpt-6-astra | 6/6 | — |
| gpt-6-sol | 6/6 | — |
| gpt-6-luna | 5/6 | V02 |

## Failures

| Case | Observed failure |
| --- | --- |
| Opus V04 | The initial SDK `listModels` RPC failed after 10,570 ms, before any model call or picker interaction. This switch scenario starts with Astra; it did not reach the Opus switch. The retained diagnostic identifies an RPC error, not its underlying network/authentication cause. |
| Luna V02 | The native patch and all three regression tests succeeded, but the final reply contained the original `discount.mjs` source instead of the requested `sample.txt` value. The required output check failed; successful tests alone do not pass the case. |

Local unit/integration/documentation checks passed **392/392**, and real-Codex offline runtime checks passed **22/22**, sequentially before this live matrix on the same source fingerprint. The source includes the daemon status/stop separation from SDK availability and the cleanup-error reporting fix.

Two separate startup-catalog timeouts recovered within the original budget. The Opus V04 RPC error did not qualify for that timeout-only recovery. No model-transport recovery occurred. Workspace protection, MCP isolation and owned-process cleanup passed for all 36 cases; these do not erase the two workflow failures.

The [final result and media](validation/README.md) include both failures, ten screenshots and an edited recording. Only this final run remains in `.runtime/verification-final/`; earlier raw results and published media were replaced. Current and frozen-source verifiers independently reproduce **34/36, not passed**, with intact evidence. Raw artifacts are local and Git-ignored.

This is an essential-integration result, not whole-product or endurance certification. Unsupported features remain unchanged. A commit's [remote CI status](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/actions) is separate from this live score.
