# Final verification result — 2026-09-25

[한국어](README_KO.md) · [Verification guide](../VERIFICATION.md) · [JSON](report.json)

## Recorded results

**codex-ghcp-essential-v1 · 34/36 · NOT PASSED** — **2026-09-25, 10:58–11:06 KST**.

All 36 cases were executed once using actual Codex CLI/TUI → production bridge → real Copilot SDK, with exact model selection. The updated source was tested without changing the six scenarios, deadlines or 36/36 pass rule. There were no automatic case retries, fallback models, corrective prompts or pooled scores. Both failures remain in the final result.

**`fullMatrixPassed=false` · `evidenceIntegrity=true` · failed: 2 · blocked/timed-out/not-run: 0.**

| Model | Passed | Failed cases |
| --- | --- | --- |
| claude-opus-5.5 | 5/6 | V04 |
| claude-sonnet-5 | 6/6 | — |
| claude-haiku-4.5 | 6/6 | — |
| gpt-6-astra | 6/6 | — |
| gpt-6-sol | 6/6 | — |
| gpt-6-luna | 5/6 | V02 |

## Failures

| Case | Recorded outcome and boundary |
| --- | --- |
| Opus V04 | Initial SDK `listModels` failed with `rpc_error` after 10,570 ms. The launcher exited before the composer, any model call or the picker. V04 starts with Astra before switching to Opus, so the Opus switch was not exercised. The diagnostic does not establish a more specific network or authentication cause. |
| Luna V02 | The baseline failed as required, native `apply_patch` fixed the code, and all three tests then passed. The model nevertheless returned the original `discount.mjs` source instead of the requested `sample.txt` value, despite that value appearing in the native read result. `execution` and `V02.edit` failed; the runner did not correct or retry the answer. |

The JSON retains failed-check IDs, startup diagnostics and Luna's expected/observed answer. The failure screenshots and video excerpts below come from this same run, not a reconstruction.

## Verified outcomes and limits

Every model's V02 recorded an unchanged read-only baseline, three tests with two failures and native exit 1, then a native patch and the same three passing tests with exit 0. Only `discount.mjs` changed; tests and user files were preserved. **The full V02 workflow passed 5/6**, because the required final answer also matters. Full checkpoints are in `.runtime/verification-final/v02-workflow.json` and per-case facts. The two-turn procedure verifies a staged workflow, not general instruction-following reliability.

V01, V03, V05 and V06 passed on all six models. Routing, HTTP/SSE, context-tier and watchdog checks passed 35/36; execution passed 34/36. Workspace protection, MCP isolation and cleanup passed 36/36. A successful cleanup or narrower check does not override a failed case.

Two startup-catalog timeouts, in Sonnet V04 and Haiku V04, recovered within the original 30-second budget. The separate Opus V04 RPC error was not eligible for timeout-only recovery. No model transport/session error or model-transport recovery occurred; the catalog startup failure is still a failure. The 64 exact unsupported automatic-title requests were counted separately, not credited as supported responses.

## Recording and screenshots

This run saved **42 full TUI recordings, 144 checkpoint screenshots and 42 closing screenshots** locally. All ten published screenshots and the edited summary come from this run, including both failed cases.

**[Watch the edited summary](media/verification-summary.mp4)** · [Media provenance, clip offsets and hashes](media/manifest.json)

Each real-speed excerpt is followed by a clearly labeled two-second still of its actual checkpoint or failure screen. Title bars sit outside the complete source frame; audio is absent. The overall label is **34/36 — NOT PASSED**, with each case's own status. These are representative scenes, not all 36 case recordings. Sonnet's baseline test failure is required evidence; the final two scenes are actual case failures.

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
| 9 | [V04 · Opus startup failure](media/09-v04-failure-claude-opus-5.5.png) | Failed before inference: SDK catalog RPC |
| 10 | [V02 · Luna final-answer mismatch](media/10-v02-failure-gpt-6-luna.png) | Tests passed; required answer failed |

Media checks include full decoding of all raw recordings and the summary, source-file hashes, and OCR of the ten screenshots and twenty representative summary frames. Direct image inspection was unavailable, so no manual visual review is claimed. Captures contain isolated synthetic workspaces; local temporary paths remain visible. The manifest links each published asset to its original run and checkpoint or closing failure screen.

## Local regressions and evidence

Unit/integration/documentation **392/392**; real-Codex runtime with SDK doubles **22/22**. They ran sequentially before the live matrix on the same source fingerprint, including the daemon-control and cleanup-reporting changes. Offline successes are not added to the live score or used to erase either failure.

Codex 0.154.0 · Copilot SDK 1.0.14 · darwin/arm64 · Node v22.16.0

Evidence was automatically recomputed: `evidenceIntegrity=true`, `fullMatrixPassed=false`. Raw facts and frozen source: `.runtime/verification-final/`. Implementation fingerprint: `b4e39c1ca3cd6cedfd18e2d03871a7a14c19733f52b56db6a6209da9f542fa88`, not a Git commit ID. Source and user settings were unchanged during execution; all 36 owned worker groups were cleaned up. Public JSON is not a replacement for raw evidence.

This record retains only the latest local verification. A specific commit's remote CI status is available in [GitHub Actions](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/actions), separately from this live score.

## Recheck evidence

This command needs the original local `.runtime/verification-final/` directory; Git does not include it. It recomputes the saved result without calling a model. A fresh clone's public summary and media are not enough to reproduce the integrity check.

```bash
npm run verify -- --verify .runtime/verification-final/report.json
```

Current and frozen-source verifiers reproduce the same result. This command returns **exit 1** for this run: the evidence is intact, but 34/36 is not a pass. Rechecking makes no model calls and does not alter either failure.

## Cleanup and limits

Only the current suite, this final live run and its matching media remain. Earlier raw results, outdated public media and temporary publication files were removed without rewriting Git history. Existing user bridges were not restarted. This is a failed essential-integration assessment, not whole-product or endurance certification; unsupported capabilities remain unchanged.
