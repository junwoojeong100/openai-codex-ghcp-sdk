# Verification

[한국어](VERIFICATION_KO.md) · [Quick start](../README.md) · [Current result](validation/README.md)

**One contract: `codex-ghcp-essential-v1`. Six essential scenarios × six models = 36 cases. Only 36/36 passes.** There are no wording profiles, percentage targets or separate live matrices.

## Run

From the repository root, after `npm ci`, use Node 22.12+, Codex **0.154.0**, Python 3 and macOS/Linux. Install Chromium once:

```bash
npx --no-install playwright install chromium
```

On Linux, use `npx --no-install playwright install --with-deps chromium` if system libraries are missing. Complete the [Copilot account check](../README.md#3-check-installation-and-account-access); all six models must be available. No OpenAI key is needed.

**This calls real Copilot models and consumes usage:**

```bash
npm run verify -- --execute --output .runtime/verification-new
```

Use a new output directory; existing results are never overwritten. Omitting `--output` chooses a fresh directory automatically. `npm run verify` only shows the plan, without model calls.

The command runs the cases, saves the evidence, **automatically recomputes the result**, and prints the `report.md` path. Read its verdict and failed-case rows. Exit **0** means all 36 cases passed; **1** means a failed, blocked or incomplete run; **2** means an argument or evidence error. Failures remain failures even if all processes were cleaned up.

## What is necessary

| ID | Scenario | Required evidence |
| --- | --- | --- |
| V01 | CLI/TUI launch, Unicode chat, `/new` isolation | Actual `codex exec --json` response, six-model picker, Unicode reply and a fresh conversation without the earlier label |
| V02 | Read, patch and test code | Read-only baseline with actual failing tests and unchanged files; only then request native `apply_patch` and the same three passing tests in the same conversation |
| V03 | MCP error and result continuation | Codex-owned MCP lookup returns ENOENT, then a successful result and a correct follow-up |
| V04 | Model and reasoning-level switch | Picker selection reaches the next real model response, including High effort or its absence for Haiku |
| V05 | Interrupt and continue | After observing SDK submission, Escape aborts that session's in-flight turn; the same native process answers the next prompt |
| V06 | Compact and resume | Local `/compact`, recall, clean quit, new bridge via `resume --last`, fresh recall from saved history |

V02 uses two explicit turns for every model: **read-only diagnosis, then repair**. The runner records the native failing test and unchanged workspace before allowing the repair request. A skipped baseline, premature edit or masked exit fails immediately; it does not trigger a corrective prompt or case retry. The final evidence must contain that exact baseline as a prefix, followed by the same three passing tests. This verifies a staged coding workflow, not guaranteed adherence to a compound single-turn request.

"Read-only" describes the first turn's instruction, not a sandbox switch: V02 uses the same isolated `workspace-write` sandbox for both turns. The gate checks recorded tool activity and workspace snapshots; it is not a filesystem write-prevention mechanism or continuous file monitoring.

V02 checks actual failing/passing test summaries and native exit codes, not shell formatting. Read-only preparation (including `echo`/`printf` labels) may precede the test command when it remains the final command; pipes, exit masking and fake test output are not accepted. A completed tool-call response is a handoff, not a final answer: the runner waits for a completed text response before judging the turn.

Every live case follows **actual Codex → production bridge → real GitHub Copilot SDK → exact Copilot model**. Both non-interactive CLI and interactive TUI execution are covered. Every case also checks real HTTP/SSE and exact model routing, context/watchdog settings, workspace protection, Copilot-runtime MCP isolation and cleanup. The TUI uses a private PTY rendered by headless Chromium. Model output is never repaired or replaced; a refusal, missing tool action, cleanup fault or timeout still fails. Only the exact unsupported automatic-title rejection is counted separately, not excused as a successful response.

All cases use isolated Codex homes/workspaces and the production timeout defaults. Authentication still uses the existing Copilot home; this is not a zero-retention environment. The runner checks that user settings are unchanged and does not restart existing user bridges. Three model lanes run concurrently; each has bounded case deadlines. There are no automatic case retries, fallback models, subsets or mixed-run scores. `Ctrl+C` stops only owned work and preserves an incomplete report.

Production bridge recovery is not a case rerun. A recovered transport error remains in the raw evidence and is accepted only when the same session has abort/disconnect/delete receipts, a safe-recovery diagnostic, and a completed original response ID. Missing/mismatched receipts, filtering and failed streams still fail. Reports separately count transport and startup-catalog recoveries.

## Local regression tests

`npm test` checks production protocol, authentication, state, queues, no-replay, cancellation, filtering and evidence rules without model calls. `npm run test:runtime` runs the same six essential drivers with SDK doubles, plus the necessary native context/timeout/handoff regressions. It always stays offline, including the handoff test. These are regression tests, not another live-verification version or score.

CI is configured for unit/coverage and offline runtime checks on Linux and macOS; it does not run the live matrix. That configuration is not evidence of a successful remote CI run. `npm run test:docs` checks current guide links, commands and EN/KO command parity; `npm run test:ci` runs the unit suite with coverage. No generated scenario guide or extra scenario-design command is needed.

## Saved evidence

Each TUI launch records a real Chromium `terminal-browser.webm`, a closing screenshot and checkpoint PNGs at launch, answers, picker changes, interruption and compaction. Checkpoint transcripts and approximate video offsets identify the scenes; file hashes are rechecked with the result. Live recordings include actual waiting and outcomes, not simulated model output; offline runtime tests use the same recorder with SDK doubles. Raw videos/screenshots may contain local paths or error details: inspect them before sharing. A published highlight reel must be labeled as edited; it does not replace the full facts or the 36-case verdict.

The output contains `report.md`, `report.json`, `verification.json`, per-case facts/receipts and a `source-snapshot/`. Compaction summaries are retained locally alongside ordinary answers so recall failures can be inspected without mistaking an acknowledgment for remembered data. They are saved automatically; no extra command is required after execution. To inspect a retained run later, without model calls:

```bash
npm run verify -- --verify .runtime/verification-new/report.json
```

If the source has changed, use the run's own verifier and matching dependencies:

```bash
node .runtime/verification-new/source-snapshot/scripts/verify.mjs --verify .runtime/verification-new/report.json
```

`evidenceIntegrity: true` means the stored hashes match and the verdict was recomputed from the facts, not that behavior passed or that the evidence has an external signature. `fullMatrixPassed: true` separately requires all 36 cases and run-level checks. The implementation fingerprint covers runtime/verifier/test files and package manifests, not the prose guides. Raw evidence stays Git-ignored, so these recheck commands require the original local run; the published JSON and media in a fresh clone cannot substitute for it.

## Retention and scope

Keep the current contract and the latest complete run with its matching media. The retained result lives in `.runtime/verification-final/`, with a public summary and selected media in `docs/validation/`. The runner itself always creates a fresh directory; it does not automatically delete other runs or regenerate the edited public summary/video.

Passing this contract does not certify native review/Plan/subagents/skills, exhaustive fault combinations, large payloads, five-hour operation, maximum-context inference or [unsupported features](COMPATIBILITY.md). It is an essential-integration result, not a whole-product completeness percentage.
