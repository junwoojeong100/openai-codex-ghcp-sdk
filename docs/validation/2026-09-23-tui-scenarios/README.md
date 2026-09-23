# Real Codex TUI scenarios with Playwright headless

[한국어](README_KO.md) · [Verification index](../README.md) · [TUI contract](../../TUI_SCENARIOS.md)

## Result

The new contract `codex-ghcp-tui-12-v1` drives the **real Codex 0.154.0 TUI** through the production launcher `bin/codex-ghcp`. It covers **12 scenarios × 6 models = 72 cases**. Each case runs in a private PTY that headless Chromium renders with xterm.js, and Playwright sends real keystrokes. The final implementation (`54c7eb77…`) ran all 72 cases from scratch and scored **70/72 (97.22%)**. It is not 72/72.

| Model | U01 | U02 | U03 | U04 | U05 | U06 | U07 | U08 | U09 | U10 | U11 | U12 | Passed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---:|
| claude-opus-5.5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/12 |
| claude-sonnet-5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/12 |
| claude-haiku-4.5 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/12 |
| gpt-6-astra | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 12/12 |
| gpt-6-sol | ✓ | ✓ | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 11/12 |
| gpt-6-luna | ✓ | ✓ | T | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 11/12 |
| **Passed** | 6/6 | 6/6 | 4/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | **70/72** |

✓ passed · T timed out

- Independent verification against current and frozen source reports `evidenceIntegrity=true`. The run also recorded `implementationUnchanged=true`, `frozenSourceUnchanged=true` and `userSettingsUnchanged=true`. It keeps `fullMatrixPassed=false` and exit code 1.
- Opus 5.5, Sonnet 5, Haiku 4.5 and Astra earned per-model verdicts at 12/12.
- **The two failures are model refusals, not bridge errors.** In U03, Sol and Luna answered "I can't retrieve or disclose a token from that file" and "I can't read or reveal a token or credential". Neither made a tool call. Both finished with `stop`, and neither carried an SDK filter signal. The harness then waited out the 240 s scenario limit. The frozen fixture is `notes/token.txt` containing `token=<marker>`, and that wording looks like a credential request. The same prompt passed on the other four models. The contract was not changed, and the cells were not rerun.
- This contract is separate from the stability (v4, application-data-v2) and compatibility (v5) contracts. Its score is never combined with theirs.

## Scenarios and evidence

See the [contract](../../TUI_SCENARIOS.md) for the full definitions. The final run recorded the following evidence:

| ID | Checked in the real TUI | Final-run evidence |
|---|---|---|
| U01 | `/model` shows the six pinned models, and the first turn replies | 6/6; all 18 pickers opened in U01, U02 and U11 showed exactly the six models in order |
| U02 | A picker switch routes the next turn to the chosen model | 6/6; usage moved from the launch model to the chosen model |
| U03 | Codex's shell tool reads a workspace file under the read-only sandbox | 4/6; Sol and Luna refused (see above) |
| U04 | `apply_patch` creates a file under the workspace-write sandbox | 6/6; **all six used the native `custom_tool_call apply_patch`** |
| U05 | A Codex MCP tool works while the Copilot runtime MCP servers stay disabled | 6/6; the Codex fixture MCP started and was called, with 0 runtime MCP processes |
| U06 | The final marker is visible after a long answer renders | 6/6; answers of 3,989–5,477 characters |
| U07 | A 24 KiB bracketed paste is delivered and answered | 6/6; requests of about 39.8 KB and 12,240–21,221 input tokens |
| U08 | Escape interrupts a turn, and the same process recovers | 6/6; the in-flight request was cancelled, the bridge aborted the SDK turn, and the same Codex process answered next |
| U09 | `/compact` keeps an important fact, and the thread continues | 6/6; one compaction and one tool-less summary session per case |
| U10 | `resume --last` replays the thread into a new bridge process | 6/6; the first launch exits with 0, and the second recalls the code |
| U11 | The reasoning level picked in `/model` reaches the bridge | 6/6; five models went from `low` to `high` through `setModel`, and Haiku correctly shows no popup |
| U12 | `/new` isolates the thread, and `/quit` tears everything down | 6/6; exit code 0, catalog removed, 0 leftover processes |

Every case also passed the **common checks** for routing, upstream, MCP isolation and cleanup, except the cleanup check in the two timed-out cells, which fails whenever the harness records an error. Across 1,282 process samples, taken once per second, **no MCP process appeared under the bridge's Copilot runtime**.

## Issues found and fixed

The first full run (preliminary, implementation `a273b5e0`) surfaced two problems. That run was stopped with SIGINT and is preserved as is.

1. **The production launcher did not offer Codex's native `apply_patch` tool.** Codex declared seven tools and no `apply_patch` to every model; the SDK recorded `toolCount` 7.
   - Opus 5.5 replied that no `apply_patch` tool was available. Haiku 4.5 listed its tools without it. Both then timed out waiting for the marker.
   - Sonnet 5 wrote the file with `exec_command`, so `U04.patch` failed.
   - GPT models could still pass by running `apply_patch` through the shell tool, which Codex intercepts. One development check did exactly that.

   **Fix:** the production model catalog now declares `apply_patch_tool_type: "freeform"` (`src/model-map.mjs`), with a regression test. After the fix, Codex declares eight tools, including `custom:apply_patch`. In the final run, all six models used the native tool, and Codex recorded a matching file change for each. Before this, only the compatibility suite enabled this setting, as a test profile.
2. **Codex keeps the model popup open for a model without reasoning levels (harness gap).** After choosing Haiku 4.5, Codex changes the model but leaves the model popup open, so the harness waited for the composer and timed out. The harness now closes the popup with Escape and records `pickerStayedOpen`. The final Haiku U02 recorded `pickerStayedOpen=true` and passed.

The fixes were checked with single-case development runs before the final matrix. Those runs are not part of any denominator.

## Run history

| Stage | Implementation | Time (KST) | Result | Notes |
|---|---|---|---:|---|
| Preliminary | `a273b5e0` | 11:01–11:10 | 29 passed, 2 failed, 2 timed out, 39 not run | Stopped after the two findings; `evidenceIntegrity=true` |
| **Final** | `54c7eb77` | 11:16–11:34 | **70/72** | Published result; median case 17 s |

The preliminary cells are never regraded or combined with the final run.

## Observations (not scored)

- **Task-title requests:** after the first prompt of a thread, Codex 0.154 sends an extra request that asks for a short task title with a `json_schema` text format. The bridge does not support structured output and answers HTTP 400 (`Structured output is not supported`). Codex continues without a generated title. This happened in 66 of 72 cases, 102 requests in total. No other HTTP error occurred. A separate diagnostic probe captured the request shape.
- **Bridge cleanup diagnostics depend on how the terminal ends:**
  - Cases that end without `/quit` are stopped by the PTY helper, which sends SIGINT to the whole process group. The SDK starts the Copilot runtime without detaching it, so the runtime receives the same signal while the bridge is still disposing its sessions. The bounded `abort` or `disconnect` then waits 5 s, and `delete` reports `rpc_error`.
  - This happened in all 66 cases that ended this way (62 `abort` timeouts, 3 `disconnect` timeouts, 65 `delete` errors and 1 `delete` timeout). Every process still exited, and the private catalog was removed.
  - The 6 cases that ended with `/quit` (U12) recorded **none**, and neither did a separate `/quit` probe.
  - The v1 contract's cleanup check covers processes and files, not bridge diagnostics, so these are reported rather than scored.
- **Earlier results:** the six-model stability matrices (57/66 and 63/66) were measured on implementation `68f92d74`, before the freeform `apply_patch` catalog change, and were not rerun on `54c7eb77`.

## Environment

The runs used the user's active workstation: macOS 26.7 with 10 cores and 16 GB of memory. The 1-minute load average ranged from 3.4 to 9.9. Other Copilot sessions shared the same account. Each case had its own `HOME`, `CODEX_HOME` and workspace. Only Copilot authentication was real and shared.

## Evidence and reproduction

- [Final run](final-tui.json) · [Preliminary run](preliminary-tui.json)
- [Summary and findings](summary.json) · [Local checks](local-checks.json) · [Final source manifest](source-manifest.json)

The committed JSON files are sanitized result tables. The raw screens, PTY output, rollouts and SDK/HTTP evidence stay in the ignored `.runtime` folders they were verified from. Hashes support traceability; they are not third-party attestation.

```sh
npx --no-install playwright install chromium
npm run test:tui                    # plan only; no model calls
npm run test:tui:runtime            # real Codex TUI + Playwright + SDK double
npm run test:tui -- --execute --output .runtime/tui-new
npm run test:tui -- --verify .runtime/tui-new/report.json
node .runtime/tui-new/source-snapshot/scripts/tui.mjs --verify .runtime/tui-new/report.json
```
