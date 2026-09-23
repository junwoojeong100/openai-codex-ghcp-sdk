# Six-model switch, bridge MCP isolation and live verification

[한국어](README_KO.md) · [Verification index](../README.md) · [Stability contract](../../STABILITY_TESTING.md)

## Result

The supported models are now **`claude-opus-5.5`, `claude-sonnet-5`, `claude-haiku-4.5`, `gpt-6-astra`, `gpt-6-sol` and `gpt-6-luna`**, and the model picker is pinned to that order. The final implementation (`68f92d74…`) ran both contracts' complete 66 cells from scratch. **Neither matrix is 66/66.**

| Model | Default v4 | Separate application-data-v2 |
|---|---:|---:|
| claude-opus-5.5 | 2/11 | 10/11 |
| claude-sonnet-5 | 11/11 | 11/11 |
| claude-haiku-4.5 | 11/11 | 10/11 |
| gpt-6-astra | 11/11 | 11/11 |
| gpt-6-sol | 11/11 | 11/11 |
| gpt-6-luna | 11/11 | 10/11 |
| **Total** | **57/66 (86.36%)** | **63/66 (95.45%)** |

- Independent verification against current and frozen source reports `evidenceIntegrity=true`, `implementationUnchanged=true` and `userSettingsUnchanged=true` for both runs. Both keep `fullMatrixPassed=false` and exit code 1.
- In v4, every model except Opus 5.5 scored 11/11 and earned a per-model verdict. All nine Opus 5.5 failures carry the SDK's explicit upstream-filter signal.
- application-data-v2 meets the earlier 95% reference (63 of 66). Only Sonnet, Astra and Sol earned per-model verdicts there.
- The seven-model v3/application-data-v1 results (66/77, 72/77) belong to the historical contracts. They are never combined with, or regraded into, these scores.
- **Later change:** the [real-TUI verification](../2026-09-23-tui-scenarios/README.md) found that Codex's native `apply_patch` tool was not offered, and the production catalog now declares it (implementation `54c7eb77`). These matrices were not rerun on that implementation.

## Changes

1. **Models and picker:** `SUPPORTED_MODEL_IDS` now holds the six IDs above; the default stays `gpt-6-astra`. The removed `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` and `claude-opus-5` are rejected by the launcher and bridge, with no substitution. The `/model` picker shows only these six through the private temporary `model_catalog_json`.
2. **Contracts:** because the model set changed, v3 was left untouched and new contracts were created:
   - stability: `codex-ghcp-stability-11-v4` and `…-application-data-v2`, 11 × 6 = 66 cells each;
   - compatibility: `codex-ghcp-workflows-18-v5`, 18 × 6 = 108 cells.

   Against the frozen v3 source, only `id`, `models`, `totalCases`, the `acceptance` wording and the change notes differ. Scenarios, prompts, fixtures, fault flows, budgets and oracles are identical.
3. **Bridge MCP isolation:** SDK sessions are created with `disabledMcpServers`, which disables every user and plugin MCP server of the Copilot runtime. See the section below.
4. **Two verification-runner fixes:**
   - Offline tests showed the compatibility preflight hard-coded seven models, which blocked every cell. Fixed.
   - Live runs showed a false failure. On macOS, `kill` returns `EPERM` for an exited process group that still holds only zombies, and the supervisor recorded that as a cleanup failure, turning a passing case into a failed one. A regression test was confirmed failing before the fix. After the fix, the supervisor still waits for `ESRCH` within the existing ≤2 s slot, and a group that remains still fails.
5. **Other:** the soak Luna lanes now use `gpt-6-luna`, and the Opus diagnostic targets `claude-opus-5.5`.

## Run history

Each stage has its own implementation hash, and every run is preserved. No cell was selectively rerun or combined across stages.

| Stage | Implementation | Time (KST) | v4 | application-data-v2 | Notes |
|---|---|---|---:|---:|---|
| Preliminary 1 | `1b7e0ec8` | 08:25–08:44 | 54/66 | 64/66 | Sol S08 EPERM false failure; the user's own Codex session edited `~/.codex/config.toml`, so v4 has `userSettingsUnchanged=false` |
| Preliminary 2 (EPERM fix) | `92f482db` | 08:51–09:08 | 57/66 | 60/66 | Before MCP isolation; 1-minute load up to about 18 |
| **Final (MCP isolation)** | `68f92d74` | 09:32–09:50 | **57/66** | **63/66** | Published result |

application-data-v2 varied from 64 to 60 to 63 across stages. That variation comes from run-to-run model output, tool-call behavior and upstream latency. The best value was not cherry-picked.

## Bridge MCP isolation

The Codex bridge has the same structure as the Claude Code bridge:
- Each bridge (`src/server.mjs`) starts one runtime through `new CopilotClient({ mode: "empty" })`.
- That runtime started the MCP servers from `~/.copilot/mcp-config.json` and installed plugins **for every SDK session**.
- Because the bridge restricts `availableTools` to `custom:*`, those servers were never exposed to the model. They were pure overhead.

| Check (no inference) | Result |
|---|---|
| Registered names (`session.rpc.mcp.list`) | `azure` (plugin), `microsoft-learn`, `playwright`, `playwright-headless`; they exactly match the config keys |
| Bridge-shaped session before the fix | 3 runtime children (1 azmcp, 2 Playwright MCP node processes), about 316 MB RSS, plus a `microsoft-learn` HTTP connection |
| `disabledMcpServers` with the exact names | All four `disabled`; 0 child processes |
| `mcpServers: {}` override | No effect; all four connected, 3 children |
| Post-create `mcp.disable` | Running children 3 → 0 |
| Warm-runtime session-creation median | 1,171 ms before, 1,127 ms after (4 each) |

**Implementation:**
- `src/mcp-isolation.mjs` collects names from the Copilot home's `mcp-config.json` and from `installed-plugins`. For plugins it reads the root `.mcp.json` and manifest `mcpServers`, whether declared as a path or inline.
- `session-manager` passes those names on every session creation.
- Right after creation, a bounded `mcp.list` check runs. A server from an unknown source is stopped and disabled for later sessions. A failed check never fails the request, and its diagnostics record counts only.
- Codex's own MCP tools are unaffected, because Codex runs them and declares them like other tools.

**Measurements:**
- One `gpt-6-luna` call through the production `SessionManager` showed 0 runtime children in all 17 samples.
- Across the final matrices (533 samples at 2 s, up to four of this repository's runtimes at once), **0 MCP processes** appeared. The only children seen were the runtime's transient `git` probes.
- Measured from matrix evidence, SDK `disconnect` latency changed as below. Load differed between runs, so no session-setup improvement is claimed.

  | Condition | Median | p90 |
  |---|---:|---:|
  | Quiet seven-model run the previous night | 312 ms | 401 ms |
  | This morning, before MCP isolation | 481–565 ms | 0.8–1.9 s |
  | This morning, after MCP isolation | **49–51 ms** | 259–412 ms |

## Live model-picker checks

The real `bin/codex-ghcp` TUI ran in a PTY with isolated `HOME`/`CODEX_HOME`, and `/model` was opened.

- `Select Model and Effort` listed exactly the six models, numbered 1–6 in the order above. No bundled or legacy models appeared.
- The launch model `gpt-6-astra` was marked `(current)`.
- Codex 0.154.0 sorts by catalog priority and labels the first entry `(default)`, so `claude-opus-5.5` carries that label. The earlier seven-model setup behaved the same way.
- After switching models in the picker, the next prompt's SDK session and usage model matched the selection, with 0 mismatches and the process group cleaned up:
  - `claude-opus-5.5` on the preliminary implementation;
  - `gpt-6-luna` on the EPERM-fix implementation;
  - `gpt-6-sol` on the final implementation.
- The first probe failed because it counted the header line as a picker row and mistook the reasoning popup for the composer. The picker display itself was correct, and that failed probe is preserved.
- Codex saves a picker selection in `~/.codex/config.toml`. The next GHCP launch still uses `--ghcp-model` or the default, but `codex-original` reads the saved value.

## Remaining final failures

- **Upstream filter:** Opus 5.5 S01–S09 in v4 and Opus S11 in application-data-v2. All carry explicit SDK filter signals, and the bridge failed them without retry.
- **SDK cleanup timeout:** Haiku S09 in application-data-v2. After the intentional stream rejection, `disconnect` took 5,004 ms, over the 5 s production bound. The recovery turn's `disconnect` took 24 ms, and all resources were cleaned. It remains a failure under the contract, and the bound was not relaxed.
- **Model tool behavior:** Luna S11 in application-data-v2 did not meet the six-read and recall conditions.

The preliminary stages also recorded the following; each stage's JSON preserves them:
- Luna and Opus `disconnect` timeouts;
- Astra S09, whose turn timed out after 60 s with no SDK progress;
- Sonnet and Haiku literal-label omissions, and Sonnet and Luna misses on the repeated-tool condition.

## Additional live terminal checks

| Check | Preliminary 2 (`92f482db`) | Final (`68f92d74`) |
|---|---|---|
| PTY `gpt-6-sol`, 120 s | 9/9 turns, 31,118 response chars, pass | 11/11 turns, 40,263 chars, pass |
| Playwright `claude-opus-5.5`, 24 KiB input / 1,000 words | 4/4 turns, max input 110,013 tokens, pass | 4/4 turns, max input 109,716 tokens, pass |
| Soak smoke + PTY lane | Parallel: native Luna 14/15 (double read), Sonnet 6/6, terminal Luna 0/1 (30 s session-setup timeout) | Sequential: native Luna 15/17 (2 double reads), Sonnet 9/9 with 3 compactions, terminal Luna 16/16 |
| Soak smoke + Playwright lane | Parallel: native Luna 14/15 (double read), Sonnet 3/4 (setup 504), terminal Luna 9/9 | Sequential: native Luna 14/16 (2 double reads), Sonnet 8/8 with 2 compactions, terminal Luna 16/16 |

Every standalone check recorded zero filters, model mismatches and stream failures, and cleaned up its process group. The soak failures have two causes:
- **Model behavior:** `gpt-6-luna` read the sample twice in one turn. The two calls have distinct call IDs from separate model messages, so this is not a bridge replay.
- **Setup timeouts:** these occurred in the preliminary stage, when both soaks ran in parallel.

The final soaks ran one at a time with no setup timeouts, and the terminal lanes passed 32/32 turns. These are bounded checks, **not hours-long or five-hour certification**.

## Environment

Verification ran on the user's active workstation:
- A separate `claude-code-ghcp-sdk` verification and interactive sessions shared the same Copilot account.
- macOS `mediaanalysisd` and Microsoft Defender added CPU load; the 1-minute load average ranged from about 3.6 to 17.8 on 10 cores.
- During preliminary 1, the user changed models in a new Codex session through the picker, which edited `~/.codex/config.toml`. The runner cannot attribute such edits, so it recorded `userSettingsUnchanged=false` for that run.

## Evidence and reproduction

- [Final v4](final-v4.json) · [Final application-data-v2](final-application-data-v2.json)
- [Post-EPERM v4](post-eperm-v4.json) · [Post-EPERM application-data-v2](post-eperm-application-data-v2.json)
- [Preliminary v4](preliminary-v4.json) · [Preliminary application-data-v2](preliminary-application-data-v2.json)
- [Summary, environment and latency](summary.json) · [Additional live, picker and MCP checks](additional-live.json)
- [Local checks](local-checks.json) · [Final source manifest](source-manifest.json)

The committed JSON files are sanitized result tables. The raw SDK, native and HTTP evidence stays in the ignored `.runtime` folders it was verified from. Hashes support traceability; they are not third-party attestation.

```sh
npm test
npm run test:stability -- --execute --output .runtime/new-v4
npm run test:stability -- --execute --profile application-data-v2 --output .runtime/new-application-data-v2
npm run test:stability -- --verify .runtime/new-v4/report.json
npm run test:terminal -- --execute --driver pty --model gpt-6-sol --duration-seconds 120 --output .runtime/new-pty
```
