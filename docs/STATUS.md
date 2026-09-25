# Current implementation status — 2026-09-25

[한국어](STATUS_KO.md) · [Verification guide](VERIFICATION.md) · [Final result](validation/README.md)

## v0.1.0 closeout

The release freezes the documented text/client-tool bridge scope with two final safeguards:

- Returned function/custom calls and their results share `MAX_TOOL_RESULTS` (default 32). Oversized batches fail before any call is delivered to Codex, rather than creating a continuation that cannot accept its results.
- SDK shutdown diagnoses graceful failures, attempts force-stop, and reports unconfirmed cleanup after trying every owned client. The server and foreground launcher exit nonzero on final cleanup failure. The verification driver also rejects shutdown-failure diagnostics.

These changes have offline boundary, HTTP/SSE, lifecycle and subprocess regressions. **No new live matrix was run for v0.1.0.** The 36/36 result below belongs to the pre-closeout source at `4c7fea2`, not to the release source. Release CI and the historical live result are separate evidence.

The release source passed **449/449 unit/integration/documentation checks** and **22/22 real-Codex offline runtime checks**, sequentially on the unchanged implementation fingerprint `a893f3bde92f92bfdebb7b816359047971f337dc43e9a4c03a85f0ac006a5258`. Both suites use SDK doubles, not real model inference.

The [MIT License](../LICENSE) defines reuse terms. The original run and frozen verifier also have a private, byte-identical backup outside this checkout; raw evidence is not a public release asset. The [v0.1.0 release](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/releases/tag/v0.1.0) is the maintenance baseline; unsupported features and endurance work are deferred.

## Retained live result (before closeout)

**codex-ghcp-essential-v1: 36/36 — PASS.** Actual execution: **2026-09-25, 12:30–12:40 KST**.

A complete live matrix passed on that pre-closeout source, with `fullMatrixPassed=true` and `evidenceIntegrity=true`. All six models ran all six scenarios once; no case retries, fallback models or pooled results were used. The earlier failures were investigated, not regraded into successes.

| Model | Passed | Failed cases |
| --- | --- | --- |
| claude-opus-5.5 | 6/6 | — |
| claude-sonnet-5 | 6/6 | — |
| claude-haiku-4.5 | 6/6 | — |
| gpt-6-astra | 6/6 | — |
| gpt-6-sol | 6/6 | — |
| gpt-6-luna | 6/6 | — |

## Failure review and improvements

| Area | Finding and change |
| --- | --- |
| Catalog startup | The earlier Opus V04 case failed in `listModels` before inference. Its old diagnostic discarded the upstream code, so the underlying network/authentication cause remains unconfirmed; six read-only probes did not reproduce it. Bounded error metadata is now retained, and recognized read-only catalog failures can use one fresh client within the original startup budget. Authentication, rate-limit and cancellation rejections are not retried. |
| V02 task | Luna returned source code instead of the requested file value, despite passing the code tests. The repair prompt now explicitly requests a fresh file read; the hidden value no longer shares the acknowledgment's counter pattern. `V02.answer` independently requires the exact final answer. A wrong answer still fails. |
| Verification driver | Earlier commentary or an expected line with extra prose could falsely pass. Failed answers could disappear from facts, and command-completion summaries could omit already-streamed output. The driver now checks final HTTP/SDK text, retains failed answers, reads native call results by ID, and correlates catalog recovery within one process. Renderer failures are explicit. |

Local unit/integration/documentation checks passed **423/423** and real-Codex offline runtime checks **22/22**, sequentially before this live matrix on the same source fingerprint. The partial command-output behavior was reproduced with the actual pinned CLI, not assumed from a test double alone.

All 36 cases passed the common checks, and all six V02 cases recorded real failing tests, a patch, a fresh read, passing tests and the exact requested answer. **45/45 tool-result submissions matched native output, HTTP input and SDK submission bytes and identities.** This run needed no bridge catalog or model-transport recovery; recovery fault paths remain covered by deterministic tests, not a reproduced live outage.

The six scenario IDs, exact models, deadlines and 36/36 rule remain. The V02 wording and stricter answer/evidence checks are disclosed in the [final result](validation/README.md), not presented as an unchanged prompt. Only the latest run, its edited recording and eight matching screenshots are retained. Raw evidence and frozen source remain local in `.runtime/verification-final/` and are Git-ignored.

This is an essential-integration result, not whole-product or endurance certification. Unsupported features remain unchanged. A commit's [remote CI status](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/actions) is separate from this live score.
