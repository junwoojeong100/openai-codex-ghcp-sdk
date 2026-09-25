# Final verification result — 2026-09-25

[한국어](README_KO.md) · [Verification guide](../VERIFICATION.md) · [JSON](report.json)

## Recorded results

**codex-ghcp-essential-v1 · 36/36 · PASS** — **2026-09-25, 12:30–12:40 KST**.

All 36 cases passed in one new execution using actual Codex CLI/TUI → production bridge → real Copilot SDK → exact model. The six scenario IDs, models, deadlines and 36/36 pass rule remain. The prompt clarification and stricter evidence checks below are explicit changes, not an undisclosed regrade. No case retries, fallback models, corrective follow-up prompts or pooled scores were used.

**`fullMatrixPassed=true` · `evidenceIntegrity=true` · failed/blocked/timed-out/not-run: 0.**

| Model | Passed | Failed cases |
| --- | --- | --- |
| claude-opus-5.5 | 6/6 | — |
| claude-sonnet-5 | 6/6 | — |
| claude-haiku-4.5 | 6/6 | — |
| gpt-6-astra | 6/6 | — |
| gpt-6-sol | 6/6 | — |
| gpt-6-luna | 6/6 | — |

## Review of the earlier failures

| Area | Diagnosis and improvement |
| --- | --- |
| Opus V04 startup | The prior failure was in SDK `listModels`, before any inference or picker action. V04 starts with Astra before switching to Opus. The old diagnostic discarded the RPC code; six concurrent, read-only probes succeeded, so a specific network/authentication cause cannot be reconstructed. The bridge now records bounded error metadata and permits one fresh-client retry for recognized read-only catalog errors within the original budget, after confirmed cleanup. Known rejections and cancellations remain excluded; no inference retry was added. |
| Luna V02 answer | The prior SDK answer and terminal both contained source code instead of `sample.txt`, while the repair and tests succeeded. That failure was genuine. The repair request now explicitly asks for a fresh file read before testing, rather than relying on earlier memory. The file value uses a separate identifier from the visible acknowledgment. Exact output is still mandatory and scored separately as `V02.answer`. |
| Driver answer checks | An earlier matching message or a correct line surrounded by other prose could be accepted. The driver now compares the entire final HTTP text and the last fresh SDK answer, keeps failed answers in facts, and distinguishes delayed rendering from a wrong model answer. Corrected regressions reject stale/commentary-only matches. |
| Native output evidence | Actual Codex command-completion events can omit an already-streamed prefix. This was reproduced with the pinned CLI and caused a false failure in a newly added runtime assertion. File-read evidence now uses the correlated native call output; command events still prove command and exit status. No missing bytes are invented. |

Unrecovered catalog startup failures now also fail the upstream check. Recovery receipts must match process, generation and order; a cold-resume process cannot stand in for another process. Browser rendering errors fail immediately, and capture errors name the checkpoint. These changes strengthen the driver rather than excusing a failed case. The old failures were not converted into passes.

## Verified outcomes and limits

Every V02 recorded an unchanged read-only baseline, three tests with two failures and native exit 1, a native patch, a fresh sample read, and the same three passing tests with exit 0. Only `discount.mjs` changed; tests and user files were preserved. **Both the coding workflow and exact final answer passed 6/6.** Full checkpoints are in `.runtime/verification-final/v02-workflow.json` and per-case facts. Both turns use the same `workspace-write` sandbox; the baseline is checked from evidence, not enforced by a sandbox switch.

All six scenarios and all nine common checks passed. **45/45 tool-result submissions matched native output, HTTP input and SDK RPC bytes and call identities**, recorded in `.runtime/verification-final/tool-delivery.json`. This checks delivery, not the model's internal comprehension or universal instruction-following reliability.

This run needed **zero bridge catalog recoveries and zero model-transport recoveries**. Read-only recovery fault paths were exercised by deterministic regressions, not by reproducing the earlier live outage. The 66 exact unsupported automatic-title requests were counted separately, not credited as supported model responses.

## Recording and screenshots

This run saved **42 full TUI recordings, 150 checkpoint screenshots and 42 closing screenshots** locally. All eight published screenshots and the edited summary come from this run.

**[Play the edited summary](https://cdn.jsdelivr.net/gh/junwoojeong100/openai-codex-ghcp-sdk@4c7fea28077fa23742d59685b65e2ab7936be68a/docs/validation/media/verification-summary.mp4)** · [Repository MP4](media/verification-summary.mp4) · [Media provenance, clip offsets and hashes](media/manifest.json)

The playback link opens the browser's video player via jsDelivr and is pinned to the existing MP4's repository commit.

Each real-speed excerpt is followed by a clearly labeled two-second still of its actual checkpoint. Title bars sit outside the complete source frame; audio is absent. The overall label is **36/36 — PASS**, with each case's own status. These are representative scenes, not all 36 case recordings. Sonnet's baseline test failure is required evidence, not a failed case.

| Scene | Screenshot | Recorded outcome |
| --- | --- | --- |
| 1 | [V01 · Opus Unicode reply](media/01-v01-claude-opus-5.5.png) | Passed |
| 2 | [V02 · Sonnet read-only baseline](media/02-v02-baseline-claude-sonnet-5.png) | Required test failures, native exit 1 |
| 3 | [V02 · Sonnet repair and tests](media/03-v02-repair-claude-sonnet-5.png) | Three passing tests, native exit 0; case passed |
| 4 | [V03 · Haiku MCP](media/04-v03-claude-haiku-4.5.png) | Passed |
| 5 | [V04 · Astra model/effort switch](media/05-v04-gpt-6-astra.png) | Passed |
| 6 | [V05 · Sol interruption/continuation](media/06-v05-gpt-6-sol.png) | Passed |
| 7 | [V06 · Sol compaction/recall](media/07-v06-compact-gpt-6-sol.png) | Passed |
| 8 | [V06 · Luna cold-resume recall](media/08-v06-resume-gpt-6-luna.png) | Passed |

Media checks include full decoding of all raw recordings and the summary, source-file hashes, and OCR of eight screenshots and sixteen representative summary frames. No manual visual review is claimed. Captures contain isolated synthetic workspaces; local temporary paths remain visible. The manifest links each asset to this run and its actual checkpoint.

## Local regressions and evidence

Unit/integration/documentation **423/423**; real-Codex runtime with SDK doubles **22/22**. These final suites ran sequentially before the live matrix on the same source fingerprint. Offline tests also cover wrong-answer rejection, partial native output, byte-preserving result delivery, catalog retry exclusions and cached-update startup/resume. Offline successes are not added to the live score.

Codex 0.154.0 · Copilot SDK 1.0.14 · darwin/arm64 · Node v22.16.0

Evidence was automatically recomputed: `evidenceIntegrity=true`, `fullMatrixPassed=true`. Raw facts, diagnosis and frozen source: `.runtime/verification-final/`. Implementation fingerprint: `8911f4768cae37f7184a9099b994d3deeca1ce15bde70c048106aa1d506397f7`, not a Git commit ID. Source and user settings were unchanged during execution; all 36 owned worker groups were cleaned up. Public JSON is not a replacement for raw evidence.

This record retains only the latest local verification. A specific commit's remote CI status is available in [GitHub Actions](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/actions), separately from this live score.

## Recheck evidence

This command needs the original local `.runtime/verification-final/` directory; Git does not include it. It recomputes the saved result without calling a model. A fresh clone's public summary and media are not enough to reproduce the integrity check.

```bash
npm run verify -- --verify .runtime/verification-final/report.json
```

Current and frozen-source verifiers reproduce the same passing result. This command returns **exit 0** for the retained run, without calling models or regrading an earlier run.

## Cleanup and limits

Only the current suite, latest live run and matching media remain; the diagnosis explains the reviewed failure mechanisms without preserving another scored run. Earlier raw results, outdated media and temporary publication files were removed without rewriting Git history. Existing user bridges were not restarted. This is essential-integration evidence, not whole-product, universal model correctness or endurance certification; unsupported capabilities remain unchanged.
