# Real Codex TUI scenarios (Playwright headless)

[한국어](TUI_SCENARIOS_KO.md) · [Guide map](../README.md#testing) · [Stability contract](STABILITY_TESTING.md) · [Terminal/endurance checks](SOAK_TESTING.md)

This suite tests Codex's interactive terminal interface (TUI) through the bridge: model switching, tools, interruption, compaction and resume. Live cases use the **actual Codex TUI → production bridge → Copilot SDK → exact model** path.

The current contract (the versioned scenarios and pass rules) is `codex-ghcp-tui-12-v3`: **12 scenarios × 6 models = 72 cases**. Each case is one scenario on one model. In one complete, unchanged live run, **72/72** is a full pass and **69/72** meets the 95% target. Do not combine these results with stability, compatibility or earlier TUI runs.

**Jump to:** [Run](#run-the-suite) · [Read the result](#read-the-result) · [Scenarios](#scenarios) · [Pass rules](#pass-rules) · [Execution path](#execution-path) · [Limits](#limits)

## Run the suite

Run every command from the repository root after `npm ci`. Each mode works on its own; pick the one for your goal.

| Goal | Mode | Model calls |
| --- | --- | --- |
| See what the matrix checks | [Plan](#plan) | No |
| Check the TUI runner with real Codex | [Offline runtime](#offline-runtime) | No |
| Measure all 72 cases | [Live matrix](#live-matrix) | **Yes** |
| Recheck a finished run | [Verify a report](#verify-a-report) | No |

### Plan

Needs no Codex installation, browser or Copilot login:

```sh
npm run test:tui -- --plan
```

### Runtime prerequisites

The offline runtime and the live matrix need **Node 22.12+, Codex 0.154.0, Python 3 and headless Chromium**. Install Codex with the [install step](../README.md#2-install-dependencies), then install the browser once:

```sh
npx --no-install playwright install chromium
```

On Linux, if Chromium reports missing system libraries, run `npx --no-install playwright install --with-deps chromium` instead; installing OS packages may need administrator rights. Only the live matrix needs a Copilot login.

### Offline runtime

Runs U01, U02, U11 and U12 with real Codex against an SDK double (a local stand-in for the Copilot SDK). No model calls:

```sh
npm run test:tui:runtime
```

### Live matrix

**Consumes Copilot usage.**

1. Install the [runtime prerequisites](#runtime-prerequisites) and complete the [Copilot account check](../README.md#3-check-installation-and-account-access).
2. Run `./bin/ghcp-models` and confirm that **all six [supported models](../README.md#models)** are available, not only the default model.
3. Run all 72 cases into a new output directory:

```sh
npm run test:tui -- --execute --output .runtime/tui-new
```

Before it starts, the runner saves a copy of its source in the output directory.

### Verify a report

Verification recomputes every check from the saved evidence. It makes no model calls and reruns no cases. Verify every finished run, including one with failures:

```sh
npm run test:tui -- --verify .runtime/tui-new/report.json
```

Run it as a separate command. A run that misses the 95% target exits with code 1, so chaining `--verify` after `--execute` with `&&` would skip it.

**If the source has changed since the run,** verify with the source the run saved:

```sh
node .runtime/tui-new/source-snapshot/scripts/tui.mjs \
  --verify .runtime/tui-new/report.json
```

Keep the complete original run directory, including `cases/`, `freeze.json` and `source-snapshot/`, and install the same dependencies. Published summaries cannot replace these artifacts.

## Read the result

Open `report.md` in the output directory, for example `.runtime/tui-new/report.md`. It shows the verdict, per-model counts and **Cases needing attention**, with recorded errors and links to case artifacts. Expand **Complete matrix** for all 72 rows.

| Exit code | Meaning |
|---|---|
| 0 | Valid plan, or a complete live run met the 95% target |
| 1 | The run did not reach the 95% target |
| 2 | Argument or evidence error |

**Exit code 0 does not mean 72/72.** **TARGET MET - NOT A FULL PASS** means at least 69/72 cases passed, but not all of them. Check `fullMatrixPassed` for a full pass. `thresholdMet` shows only the 95% target, and `evidenceIntegrity` says whether the evidence is valid, not whether the tests passed. See [field meanings](validation/README.md#read-a-result).

Dated v3 results and preserved v1/v2 runs are in the [verification records](validation/README.md). A past 72/72 result does not guarantee future service availability and is not evidence for a different implementation.

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

**U04 needs Codex's native `apply_patch` tool.**

- **Why:** the first live run of this contract found that the production launcher did not offer the tool. Models reported it was missing, and one wrote the file through the shell instead. The production catalog now declares `apply_patch_tool_type: "freeform"`.
- **Pass condition:** Codex's rollout shows a patch applied after a bridge tool handoff, through either the `apply_patch` tool or Codex's own interception of an `apply_patch` shell command. The file must then hold exactly the requested line. A plain shell write does not count.

## Pass rules

Every case must pass these **common checks**:

- **routing:** every SDK session, authoritative `session.rpc.model.getCurrent()` snapshot and usage record uses the expected model;
- **connection:** real SDK input, model output and a completed HTTP 200 Responses SSE stream are recorded; only U08 permits its deliberate in-flight cancellation;
- **context-tier:** model creation and effort changes keep the maximum advertised tier, and the SDK snapshot and published catalog agree on its input budget and compaction threshold;
- **watchdog:** the new bridge's `/health` reports a 180-second first-progress allowance, 90-second streaming inactivity limit, one recovery attempt and 15-second monitoring interval;
- **upstream:** no filter, SDK error or failed stream;
- **mcp-isolation:** no MCP process ever appears under the bridge's Copilot runtime while samples are taken;
- **cleanup:** the PTY group, launcher, bridge, runtime and browser are gone, the private catalog is removed, and there is no harness or SDK-session cleanup error. An idle TUI exits through `/quit` before any bounded fallback termination.

Scenario checks combine this evidence:

- Codex's own rollout: tool calls, file changes, compaction, and per-turn model and effort;
- bridge SDK observations, HTTP records and the MCP fixture ledger;
- workspace files and screen snapshots.

How cases are scored:

- **Checks are recomputed from saved facts.** Every check is a pure function of the saved `facts.json`. `--verify` checks the actual frozen source, run and case identity, artifact hashes and process supervision, then recomputes every check.
- **Every case counts.** Failed, blocked, timed-out and unrun cases stay in the 72-case denominator. An interrupted, modified or incomplete run cannot meet the target. `thresholdMet` requires 69/72 and `fullMatrixPassed` requires 72/72. Per-model and per-scenario failures stay visible.
- **Failures are reported promptly.** A completed unexpected answer or an HTTP or stream failure fails the case at once with its original evidence, instead of waiting for the deadline and being mislabelled as a timeout. Partial observations are kept.
- **Reruns are complete.** After fixing an issue, rerun all 72 cases into a new output directory. Do not merge passing cases from different implementations or overwrite earlier reports.
- **Automatic titles are counted separately.** Codex's optional automatic title request still asks for unsupported structured JSON output. Only that exact title-only schema with the explicit HTTP 400 rejection is counted, as `auxiliaryTitleRejections`, and it is not a successful model response. Any other HTTP 4xx/5xx, a title-shaped request with a different error, and any failed stream fail the supported-turn checks. Generated titles remain unsupported; see [compatibility](COMPATIBILITY.md).

Reports also record the OS and kernel release, architecture, Node version, available CPUs, memory, and whether a proxy or CI environment is configured. Proxy addresses, credentials and host or user identities are not recorded. This metadata describes the measured machine; it does not establish support for other environments.

## Execution path

Every case runs through:

- the repository's real launcher, `bin/codex-ghcp`;
- the bridge it starts (`src/server.mjs`), the real Copilot SDK and the exact model;
- the real Codex 0.154.0 TUI in a private PTY, rendered by xterm.js in headless Chromium;
- input sent as Playwright keyboard events (`/model`, arrows, Enter, Escape) and pastes, with the screen read from the xterm.js buffer.

Isolation:

- Each case uses its own `HOME`, `CODEX_HOME` and workspace; only the Copilot authentication is real and shared.
- The approval policy is `never`, and each scenario pins its sandbox. Markers are random per case.
- There are no automatic case retries, output rewriting or case substitution. The bridge's production recovery before output stays enabled and observable; it is not a harness retry.
- Existing user bridges and settings are not restarted or changed.

## Contract history

- **v3** requires separate first-progress and streaming watchdog settings. Older results verify only with their saved source.
- **v2** changed U03's credential-like `notes/token.txt` / `token=` fixture to `notes/sample.txt` / `sample_id=`. The random sample value is still absent from the prompt and must be read through a real Codex tool. No safety filter or approval is bypassed. v1 refusals remain failures in that historical result.

## Limits

- These are bounded runs, not multi-hour endurance certification.
- Desktop terminal applications themselves are not tested.
- Recall in U09 and U10 also depends on the model's summary and answer quality.
- Tier and watchdog configuration checks do not establish full-window inference capacity or fault-injected recovery. `npm run test:context:runtime` separately covers a real 95-second first-progress delay with production deadlines, root-phase private-byte progress, and idle, setup, cancellation and repeated-tool regressions, using an SDK double. Those results are not added to the live score.
- The offline runtime has no Copilot runtime process, so runtime MCP isolation is established only by live runs.
