# Real Codex TUI scenarios (Playwright headless)

[한국어](TUI_SCENARIOS_KO.md) · [Stability contract](STABILITY_TESTING.md) · [Terminal/endurance checks](SOAK_TESTING.md)

`codex-ghcp-tui-12-v3` verifies the **actual Codex TUI → production bridge → Copilot SDK → exact model** connection. It retains **12 scenarios × 6 models = 72 cases** and is never combined with stability, compatibility or earlier TUI results. The target is **at least 95%: 69/72 cases in one complete, unchanged live run**. V3 additionally requires separate first-progress and streaming watchdog settings; older results verify only with their frozen source.

The [historical v1 result](validation/2026-09-23-tui-scenarios/README.md), 70/72 on implementation `54c7eb77`, is not evidence for v3 or the newer context/recovery implementation.

**Historical v2 result (2026-09-23 KST): 72/72 (100%)** on implementation `fe500d78`, verified with its then-current and frozen source. The first independent run's 45/72, including a confirmed Copilot connection timeout, is preserved separately. These are not v3 scores. See the [v2 results and limits](validation/2026-09-23-tui-connection-v2/README.md).

## Execution path

**Latest v3 run (2026-09-23 KST): 72/72 (100%)**, all six models 12/12 on implementation `793e852c`. Current and frozen-source evidence verification passed. A separate actual-TUI regression held first progress for 95 measured seconds using an SDK double without restarting or replaying its prompt. The live matrix itself had no stalled turns and does not establish recovery from a real provider outage. See the [verification summary](validation/2026-09-23-first-progress.json).

Every case runs through the following path:
- the repository's real launcher, `bin/codex-ghcp`;
- the bridge it starts (`src/server.mjs`), the real Copilot SDK and the exact model;
- the real Codex 0.154.0 TUI in a private PTY, rendered by xterm.js in headless Chromium;
- input sent as Playwright keyboard events (`/model`, arrows, Enter, Escape) and pastes, with the screen read from the xterm.js buffer.

Each case uses its own `HOME`, `CODEX_HOME` and workspace; only Copilot authentication is real and shared. The approval policy is `never`, and each scenario pins its sandbox. Markers are random per case. There are no automatic case retries, output rewriting or cell substitution. The bridge's production bounded pre-output recovery remains enabled and observable; it is not a harness retry. Existing user bridges and settings are not restarted or changed.

## Scenarios

| ID | Scenario | Bridge behavior exercised |
|---|---|---|
| U01 | The `/model` picker shows the six models in pinned order, and the first turn replies | Launcher `model_catalog_json` pinning; routing to the launch model |
| U02 | Switching models in the picker routes the next turn to the selected model | Mid-conversation model change and bridge model resolution |
| U03 | The Codex shell tool reads a synthetic application sample in the read-only sandbox | Handlerless tool handoff, Codex execution, pending-result submission |
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

V2 changes U03's credential-like `notes/token.txt` / `token=` fixture to `notes/sample.txt` / `sample_id=`. The random sample value is still absent from the prompt and must be recovered through a real Codex tool. No safety filter or approval is bypassed. V1 refusals remain failures in the historical result.

Every case gets these **common checks**:
- **routing:** every SDK session, authoritative `session.rpc.model.getCurrent()` snapshot and usage record uses the expected model;
- **connection:** real SDK input, model output and a completed HTTP 200 Responses SSE stream are recorded; only U08 permits its deliberate in-flight cancellation;
- **context-tier:** model creation and effort changes retain the maximum advertised tier; the SDK snapshot and published catalog agree with its input budget and compaction threshold;
- **watchdog:** the new bridge's `/health` reports a 180-second first-progress allowance, 90-second streaming inactivity limit, one recovery attempt and 15-second monitoring interval;
- **upstream:** no filter, SDK error or failed stream;
- **mcp-isolation:** no MCP process ever appears under the bridge's Copilot runtime while samples are taken;
- **cleanup:** the PTY group, launcher, bridge, runtime and browser are gone, the private catalog is removed, and there is no harness or SDK-session cleanup error. An idle TUI exits through `/quit` before any bounded fallback termination.

Scenario checks combine this evidence:
- Codex's own rollout: tool calls, file changes, compaction, and per-turn model and effort;
- bridge SDK observations, HTTP records and the MCP fixture ledger;
- workspace files and screen snapshots.

Reports record the OS/kernel release, architecture, Node version, available CPUs, memory and whether a proxy/CI environment is configured. Proxy addresses, credentials and host/user identities are not recorded. The metadata describes the measured machine; it does not establish support for unmeasured environments.

Codex's optional automatic title generation still requests unsupported structured JSON output. Its exact title-only schema and explicit HTTP 400 rejection are separately counted as `auxiliaryTitleRejections`, not accepted as a successful model response. Other HTTP 4xx/5xx responses, title-shaped requests with a different error, and all failed streams fail the supported-turn checks. Generated titles remain unsupported; see [compatibility](COMPATIBILITY.md).

Checks are pure functions of the saved `facts.json`. `--verify` checks the actual frozen source, run/case identity, artifact hashes and process supervision, then recomputes every check. Failed, blocked, timed-out and unrun cells stay in the 72-cell denominator. An interrupted, modified or incomplete run cannot meet the target. `thresholdMet` requires 69/72; `fullMatrixPassed` still requires 72/72. Per-model and per-scenario failures remain visible.

A completed unexpected answer or an HTTP/stream failure fails promptly with its original evidence rather than waiting until a scenario deadline and being mislabelled as a timeout. Partial scenario observations survive failure. After fixing an issue, use a fresh output directory and rerun all 72 cells; do not merge passing cells from different implementations or overwrite earlier reports.

## Commands

```sh
npx --no-install playwright install chromium
npm run test:tui                    # print the contract only; no model calls
npm run test:tui:runtime            # real Codex TUI + Playwright + SDK double (U01, U02, U11, U12)
npm run test:tui -- --execute --output .runtime/tui-new   # consumes Copilot usage
npm run test:tui -- --verify .runtime/tui-new/report.json
```

After changing source, verify with the run folder's `source-snapshot/scripts/tui.mjs --verify`. Exit codes:

| Code | Meaning |
|---|---|
| 0 | Valid plan, or a complete live run met the 95% target |
| 1 | The run did not establish the 95% target |
| 2 | Argument or evidence error |

## Limits

- These are bounded runs, not multi-hour endurance certification.
- Desktop terminal applications themselves are not tested.
- Recall in U09 and U10 also depends on the model's summary and answer quality.
- Tier and watchdog configuration checks do not establish full-window inference capacity or fault-injected recovery. `npm run test:context:runtime` separately includes a real 95-second first-progress delay with production deadlines, root-phase private-byte progress, idle/setup/cancellation and repeated-tool regressions using an SDK double; they are not added to the live score.
- The offline runtime check has no Copilot runtime process, so runtime MCP isolation is established only by live runs.
