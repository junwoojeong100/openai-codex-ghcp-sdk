# Codex TUI to Copilot SDK connection verification, v2

[한국어](README_KO.md) · [Scenario contract](../../TUI_SCENARIOS.md) · [Verification index](../README.md)

## Results

The final independent live run passed **72/72 (100%)**, exceeding the **95% target (69/72)**. It exercised the actual Codex 0.154.0 TUI through `bin/codex-ghcp`, the production bridge, Copilot SDK 1.0.14 and all six exact models. Playwright drove a private PTY rendered by headless Chromium/xterm.js; model responses were not simulated.

| Run, KST on 2026-09-23 | Implementation | Passed | Outcome |
|---|---|---:|---|
| First, 14:34:08–14:45:21 | `e483271a` | 45/72 (62.50%) | 26 startup failures and one upstream connection failure |
| Final, 14:48:34–14:54:45 | `fe500d78` | 72/72 (100%) | All 12 scenarios passed for every model |

| Model | First run | Final run | Verified final SDK tier |
|---|---:|---:|---|
| `claude-opus-5.5` | 10/12 | 12/12 | `long_context` |
| `claude-sonnet-5` | 12/12 | 12/12 | `long_context` |
| `claude-haiku-4.5` | 11/12 | 12/12 | `default` |
| `gpt-6-astra` | 2/12 | 12/12 | `long_context` |
| `gpt-6-sol` | 4/12 | 12/12 | `long_context` |
| `gpt-6-luna` | 6/12 | 12/12 | `long_context` |

Both runs retain their complete 72-cell denominators and original failures. No case was replaced, retried automatically or combined with another run. Each run had unchanged development source, unchanged frozen source and unchanged user settings. The first run verifies with its frozen source but exits 1 because it missed the target. The final run verifies with both current and frozen source: `evidenceIntegrity=true`, `thresholdMet=true`, `fullMatrixPassed=true`, exit 0.

## What the repeated disconnect showed

During the first run, Haiku U12 recorded an actual SDK query failure: the connection to `api.enterprise.githubcopilot.com/v1/messages` timed out with `ETIMEDOUT` after the SDK's own five retries. Twenty-six other cells failed during startup in the same period. The earlier startup error did not identify which SDK operation failed, so their individual underlying causes are not established. These failures are not erased or reclassified as passes.

The user's separate conversation reported exhaustion of the bridge's one automatic recovery attempt. Its live `/health` confirmed the new recovery feature was enabled: 90-second idle limit, one recovery and a 15-second monitoring interval. The query failure above is evidence from the isolated test, not proof of the separate conversation's exact cause. A local SDK ping does not verify connectivity to the remote model service.

Before the second run, the Copilot endpoint again accepted an unauthenticated HTTPS connection. The second full run passed without relaxing the production watchdog, increasing case timeouts or changing the acceptance checks. This does **not** establish that code changes repaired the network or eliminated future upstream outages.

## Improvements and evidence

V2 adds authoritative `session.rpc.model.getCurrent()` snapshots, context-tier/catalog agreement, completed Responses SSE and actual watchdog settings to each case. U03 reads a hidden synthetic `sample_id`, not a credential-like `token` fixture. Unexpected completed answers fail promptly rather than being mislabelled as stream timeouts. Failure evidence retains partial scenario observations. Normal `/quit` cleanup replaces unnecessary process-group termination at an idle composer, and shutdown race timers are cleared.

The connection incident also prompted content-free startup diagnostics identifying `start`, `ping` or `listModels`, and idle errors now include the configured interval and last root progress event. These changes improve diagnosis; they do not fabricate progress, replay uncertain tool results or change the default deadlines. The optional longer-wait launch is documented in the [troubleshooting guide](../../USAGE.md#slow-or-disconnected-upstream), but was **not** used in either scored run.

The final run recorded **126 model-usage events, 126 completed response streams, 113 authoritative model snapshots and 828 process samples**. There were **zero failed streams, stalled turns, automatic turn recoveries, SDK-session cleanup errors, leftover processes or leftover private catalogs**. No MCP process appeared under the Copilot runtimes. All six U08 cases still explicitly tested Escape cancellation and same-process continuation.

Codex's optional automatic-title requests remain unsupported: **102 exact title-schema HTTP 400 rejections** were separately recorded. They were not counted as successful model responses. Other HTTP failures and failed streams still fail the checks.

Related unit/oracle checks passed, as did all **14 real-Codex runtime regressions using SDK doubles**, including idle recovery, byte-only progress, setup timeout, 120 tool calls, model/effort changes and fresh-thread cleanup. Those offline checks are not part of the live score.

## Evidence and limits

[First run](run1.json) · [Final run](run2.json) · [Machine-readable summary](summary.json) · [Final source manifest](source-manifest.json)

These JSON records contain sanitized reports and hashes, not raw transcripts or credentials. Full recomputable facts, HTTP/SDK records, screens and frozen sources remain locally in `.runtime/tui-connection-v2-run1` and `.runtime/tui-connection-v2-run2`. Existing user sessions were not restarted. Owned validation processes were reaped; local artifacts are preserved as evidence.

```sh
node .runtime/tui-connection-v2-run1/source-snapshot/scripts/tui.mjs --verify .runtime/tui-connection-v2-run1/report.json
node .runtime/tui-connection-v2-run2/source-snapshot/scripts/tui.mjs --verify .runtime/tui-connection-v2-run2/report.json
```

This is one successful bounded matrix, not a guarantee of 95% future availability, full-window inference or multi-hour endurance. Keep the failed first run in view when assessing intermittent network failures. Historical v1, stability and compatibility results are separate contracts and were not regraded.
