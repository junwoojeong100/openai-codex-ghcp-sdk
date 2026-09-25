# Final verification result — 2026-09-25

[한국어](README_KO.md) · [Verification guide](../VERIFICATION.md) · [JSON](report.json)

## Recorded results

**codex-ghcp-essential-v1 · 36/36 · PASS** — **2026-09-25, 10:08–10:15 KST**.

All 36 cases passed using actual Codex CLI/TUI → production bridge → real Copilot SDK → exact Copilot model. The six scenario IDs, exact models, deadlines and 36/36 rule were retained, without automatic case retries, fallback models or pooled scores. V02 uses the explicit, evidence-gated two-turn procedure below.

**`fullMatrixPassed=true` · `evidenceIntegrity=true` · failed/blocked/timed-out/not-run: 0.**

| Model | Passed | Failed cases |
| --- | --- | --- |
| claude-opus-5.5 | 6/6 | — |
| claude-sonnet-5 | 6/6 | — |
| claude-haiku-4.5 | 6/6 | — |
| gpt-6-astra | 6/6 | — |
| gpt-6-sol | 6/6 | — |
| gpt-6-luna | 6/6 | — |

**Every model completed V02 with real failure-before/repair/pass-after evidence.** Each read-only baseline ran all three tests, recorded two failures with native exit 1 and had an unchanged workspace snapshot. Only then did the runner request a repair. Native `apply_patch` changed `discount.mjs`, the final snapshot showed no other file changes, and the exact same test command passed all three tests with native exit 0 in the same process. Sonnet's baseline and repair are both shown in the media below.

All nine common checks also passed **36/36**, including routing, HTTP/SSE, context/watchdog settings, upstream outcome, MCP isolation, workspace protection, cleanup and execution. The 66 exact unsupported automatic-title requests were counted separately, not credited as successful supported requests.

## V02 procedure and evidence

- **Read-only diagnosis:** request file reads and the exact failing test command, explicitly without edits. Retain the native transcript and workspace snapshot.
- **Evidence gate:** require an unmasked nonzero exit, the three-test failure summary, unchanged files and no patch attempts. Missing evidence fails the case; the runner does not send a corrective prompt, synthesize a baseline or retry the case.
- **Repair:** only after the gate, request native `apply_patch` and the identical test command. Recompute the result from the unchanged baseline prefix and the final transcript, including all three passing tests, immutable tests/user files and the hidden sample answer.

The two turns apply equally to all six models within the existing case deadline and `workspace-write` sandbox. The first turn's read-only instruction is checked at the checkpoint, not enforced by switching the sandbox. Production bridge commands and results are not rewritten. **This verifies a staged coding workflow, not guaranteed adherence to a compound single-turn request.** The JSON includes each model's baseline and final native exits; full checkpoints are in `.runtime/verification-final/v02-workflow.json` and per-case facts.

The live run recorded zero model transport/session errors and zero transport-error recoveries. Startup `listModels` timed out once in each Claude model's V05 launch; all three recovered with a fresh client within the original 30-second startup budget and the cases passed. These are bridge catalog recoveries, not case reruns. Transport-recovery safety remains covered by deterministic regressions, not a live transport fault in this run.

## Final driver corrections

- Pinned verification passes `check_for_update_on_startup=false`. A real cached-update popup was reproduced and shown to match the old composer detector; numbered menu choices now fail readiness, and an unexpected update popup receives no input. This changes only the verification environment, not normal launcher settings or global installations.
- An answer and `response.completed` are not enough to continue. The driver also requires fresh matching native `task_started`/`task_complete` receipts and a ready composer, so it does not request `/compact` while Codex still considers the task active. A rejected compact command fails immediately without retrying it.
- The duration regression now measures elapsed coverage and completed responses rather than assuming two turns fit in 450 ms. A controlled slow-response test confirms that reaching the duration alone cannot finish an unanswered turn.

After these corrections, the full local suites and a fresh 36-case live matrix ran sequentially. Production bridge code, scenario IDs, model IDs, case deadlines and required outcomes were not changed.

## Recording and screenshots

This run saved **42 full TUI recordings, 150 checkpoint screenshots and 42 closing screenshots** locally. All published media below comes from this run.

**[Watch the approximately 103-second summary](media/verification-summary.mp4)** · [Media provenance and hashes](media/manifest.json)

The 103.08-second summary contains eight real-speed excerpts of up to 11 seconds, each followed by a labeled two-second still of its actual checkpoint. Title bars sit outside the original frame; audio is absent. It displays the recorded overall result, **36/36 — PASS**. These are representative scenes, not recordings of all 36 cases; full evidence remains authoritative. The failing tests in the first V02 scene are the required baseline, not a failed verification case.

| Summary start | Screenshot | Recorded outcome |
| --- | --- | --- |
| 00:00 | [V01 · Opus Unicode reply](media/01-v01-claude-opus-5.5.png) | Passed |
| 00:13 | [V02 · Sonnet read-only baseline](media/02-v02-baseline-claude-sonnet-5.png) | Required test failures, native exit 1 |
| 00:26 | [V02 · Sonnet repair and tests](media/03-v02-repair-claude-sonnet-5.png) | Three passing tests, native exit 0; case passed |
| 00:39 | [V03 · Haiku MCP](media/04-v03-claude-haiku-4.5.png) | Passed |
| 00:52 | [V04 · Astra model/effort switch](media/05-v04-gpt-6-astra.png) | Passed |
| 01:05 | [V05 · Sol interruption/continuation](media/06-v05-gpt-6-sol.png) | Passed |
| 01:18 | [V06 · Sol compaction/recall](media/07-v06-compact-gpt-6-sol.png) | Passed |
| 01:31 | [V06 · Luna cold-resume recall](media/08-v06-resume-gpt-6-luna.png) | Passed |

Media checks include full video decoding, file hashes and OCR of selected frames and screenshots; no manual visual review was performed. Captures contain isolated synthetic workspaces; raw recordings can still show local temporary paths. The media manifest links each published asset to its original run and checkpoint.

## Local regressions and evidence

Unit/integration/documentation **386/386**; real-Codex runtime with SDK doubles **22/22**. They ran sequentially before the live matrix on the same source fingerprint. The native suite includes startup and cold resume with a cached synthetic newer version, without selecting or installing an update. Offline results are not added to the live score.

Codex 0.154.0 · Copilot SDK 1.0.14 · darwin/arm64 · Node v22.16.0

Evidence was automatically recomputed: `evidenceIntegrity=true`. Raw facts and frozen source: `.runtime/verification-final/`. Implementation fingerprint: `d604fdeda3c6643ab2264aa14231de44a059385c70cfb12e5d8386b1ac6105d9`, not a Git commit ID. Source and user settings were unchanged during execution; all 36 owned worker groups were cleaned up. Public JSON is not a replacement for raw evidence.

This record retains only the latest local verification. A specific commit's remote CI status is available in [GitHub Actions](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/actions), separately from this live score.

## Recheck evidence

This command needs the original local `.runtime/verification-final/` directory; Git does not include it. It recomputes the saved result without calling a model. A fresh clone's public summary and media are not enough to reproduce the integrity check.

```bash
npm run verify -- --verify .runtime/verification-final/report.json
```

The retained raw run and public media both come from the corrected driver and the execution time above. Rechecking them makes no model calls and does not alter the recorded outcome.

## Cleanup and limits

Only the current suite, latest live evidence and matching media remain. Earlier CI snapshots and preparation diagnostics have been removed from this repository's records. This is one successful essential-integration run, not a guarantee of future model behavior, summary accuracy, five-hour endurance or whole-product completeness. Existing user bridges were not restarted.
