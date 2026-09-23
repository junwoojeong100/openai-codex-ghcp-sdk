# Real Codex TUI scenarios (Playwright headless)

[한국어](TUI_SCENARIOS_KO.md) · [Stability contract](STABILITY_TESTING.md) · [Terminal/endurance checks](SOAK_TESTING.md)

`codex-ghcp-tui-12-v1` is a separate contract that checks recent bridge improvements in the **actual Codex TUI**. It covers **12 scenarios × 6 models = 72 cases** and is never combined with the stability (v4) or compatibility (v5) results.

**Latest result (2026-09-23 KST): 70/72 (97.22%)** on implementation `54c7eb77`; see the [validation record](validation/2026-09-23-tui-scenarios/README.md).

## Execution path

Every case runs through the following path:
- the repository's real launcher, `bin/codex-ghcp`;
- the bridge it starts (`src/server.mjs`), the real Copilot SDK and the exact model;
- the real Codex 0.154.0 TUI in a private PTY, rendered by xterm.js in headless Chromium;
- input sent as Playwright keyboard events (`/model`, arrows, Enter, Escape) and pastes, with the screen read from the xterm.js buffer.

Each case uses its own `HOME`, `CODEX_HOME` and workspace; only Copilot authentication is real and shared. The approval policy is `never`, and each scenario pins its sandbox. Markers are random per case. There are no automatic retries, output rewriting or cell substitution.

## Scenarios

| ID | Scenario | Bridge behavior exercised |
|---|---|---|
| U01 | The `/model` picker shows the six models in pinned order, and the first turn replies | Launcher `model_catalog_json` pinning; routing to the launch model |
| U02 | Switching models in the picker routes the next turn to the selected model | Mid-conversation model change and bridge model resolution |
| U03 | The Codex shell tool reads a workspace file in the read-only sandbox | Handlerless tool handoff, Codex execution, pending-result submission |
| U04 | `apply_patch` creates a file in the workspace-write sandbox | Byte-exact freeform tool input |
| U05 | A Codex MCP tool works while the Copilot runtime's MCP servers stay disabled | `disabledMcpServers` isolation; Codex MCP unaffected |
| U06 | The final marker stays visible after a long (~700-word) answer renders | Long SSE, delta/final reconciliation, TUI scroll regions |
| U07 | A 24 KiB pasted input is delivered and answered | Request-size limits and history handling |
| U08 | Escape interrupts a running turn, and the same process recovers | Disconnect cancellation, SDK abort, same-process recovery |
| U09 | After `/compact`, an important fact survives and the thread continues | Local compaction handoff into a tool-less summarization session |
| U10 | `resume --last` resumes the conversation in a new bridge process | Cold-start history replay after launcher, bridge and runtime restart |
| U11 | The reasoning level chosen in `/model` reaches the bridge | Mid-conversation reasoning-effort change, or no popup for models without it |
| U12 | `/new` isolates the conversation, and `/quit` shuts everything down | Conversation identity, launcher shutdown, child bridge/runtime exit, private catalog removal |

U04 needs Codex's native `apply_patch` tool. The first live run of this contract found that the production launcher did not offer it: models reported having no such tool, and one wrote the file through the shell instead. The production catalog now declares `apply_patch_tool_type: "freeform"`, U04 requires Codex's rollout to show a patch applied after a bridge tool handoff, either through the `apply_patch` tool or through Codex's own interception of an `apply_patch` shell command. A plain shell write does not count. The file must then hold exactly the requested line.

## Acceptance

Every case gets these **common checks**:
- **routing:** every SDK session and usage record uses the expected model;
- **upstream:** no filter, SDK error or failed stream;
- **mcp-isolation:** no MCP process ever appears under the bridge's Copilot runtime while samples are taken;
- **cleanup:** the PTY group, launcher, bridge, runtime and browser are gone, the private catalog is removed, and there is no harness error.

Scenario checks combine this evidence:
- Codex's own rollout: tool calls, file changes, compaction, and per-turn model and effort;
- bridge SDK observations, HTTP records and the MCP fixture ledger;
- workspace files and screen snapshots.

Checks are pure functions of the saved `facts.json`. `--verify` does not trust stored pass flags: it compares hashes, then recomputes every check. Failed, blocked, timed-out and unrun cells stay in the 72-cell denominator.

## Commands

```sh
npx --no-install playwright install chromium
npm run test:tui                    # print the contract only; no model calls
npm run test:tui:runtime            # real Codex TUI + Playwright + SDK double (U01, U12)
npm run test:tui -- --execute --output .runtime/tui-new   # consumes Copilot usage
npm run test:tui -- --verify .runtime/tui-new/report.json
```

After changing source, verify with the run folder's `source-snapshot/scripts/tui.mjs --verify`. Exit codes:

| Code | Meaning |
|---|---|
| 0 | Valid plan, or all 72 of 72 passed |
| 1 | Valid evidence, but the run did not fully pass |
| 2 | Argument or evidence error |

## Limits

- These are bounded runs, not multi-hour endurance certification.
- Desktop terminal applications themselves are not tested.
- Recall in U09 and U10 also depends on the model's summary and answer quality.
- The offline runtime check has no Copilot runtime process, so runtime MCP isolation is established only by live runs.
