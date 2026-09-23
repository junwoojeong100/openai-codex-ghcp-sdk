# OpenAI Codex × GitHub Copilot SDK

[한국어](README_KO.md) · [Architecture](docs/ARCHITECTURE.md) · [Compatibility](docs/COMPATIBILITY.md) · [Native validation](docs/NATIVE_SCENARIOS.md)

Run the official **Codex CLI** against models available through your **GitHub Copilot** account, using a local Responses API adapter.

```text
Codex → local HTTP/SSE bridge → GitHub Copilot SDK → selected Copilot model
```

Codex retains responsibility for tool execution, approvals and sandboxing. The bridge translates messages and tool calls; it does not execute Codex's shell or file tools itself. This is an **unofficial interoperability project**, not a claim of vendor support for the Codex/Copilot combination. Inference still sends prompts and tool output to GitHub Copilot and consumes your account's entitlement or usage.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`, npm and Bash.
- A GitHub Copilot account with access to Copilot CLI and the desired models.
- An existing authenticated Copilot CLI installation. Check `copilot --version`; use `copilot login` if needed.
- Official Codex CLI. The protocol target for this implementation is **`0.154.0`**.

The SDK uses the existing Copilot login. Do not copy GitHub tokens into this project or provide an OpenAI API key. `COPILOT_HOME`, when set, selects an existing Copilot home directory; otherwise the bridge uses `~/.copilot`.

## Install

From this directory:

```bash
npm install -g @openai/codex@0.154.0
npm ci
command codex --version
./bin/ghcp-doctor
./bin/ghcp-models
```

Dependencies are pinned to `@github/copilot-sdk@1.0.14` and `proper-lockfile@4.1.2`. They are installed in this project, independently of any neighboring project. A newer Codex/SDK version may require protocol changes; do not assume that upgrading preserves compatibility.

## Make `codex` use GitHub Copilot (zsh)

After installing, add the following block **once** to `~/.zshrc`. It makes `codex` use this project's GHCP launcher in interactive zsh terminals, from any working directory. `codex-original` keeps direct access to the official CLI without the bridge.

Back up your shell settings first:

```zsh
cp -p ~/.zshrc ~/.zshrc.codex-ghcp.bak.$(date +%Y%m%d-%H%M%S)
```

The block assumes this clone is at `$HOME/GitHub/openai-codex-ghcp-sdk`; adjust the launcher path if yours is elsewhere. Preserve your existing PATH and Claude integration. If you already have a `codex` or `codex-original` alias/function, reconcile that definition before adding this block.

```zsh
# >>> openai-codex-ghcp-sdk >>>
codex() {
  local codex_bin
  codex_bin="$(builtin whence -p codex)" || {
    builtin print -u2 -- 'Official Codex CLI not found on PATH. Install: npm install -g @openai/codex@0.154.0'
    return 127
  }
  CODEX_BIN="$codex_bin" "$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" "$@"
}

codex-original() {
  local codex_bin
  codex_bin="$(builtin whence -p codex)" || {
    builtin print -u2 -- 'Official Codex CLI not found on PATH. Install: npm install -g @openai/codex@0.154.0'
    return 127
  }
  "$codex_bin" "$@"
}
# <<< openai-codex-ghcp-sdk <<<
```

Open a new terminal, or activate it in your current terminal:

```zsh
source ~/.zshrc
whence -v codex codex-original
codex --help                # GHCP launcher help; does not start a bridge
codex-original --version   # Official Codex version; does not start a bridge
```

Then use:

```zsh
codex
codex --ghcp-model gpt-6-sol
codex -- exec --skip-git-repo-check --sandbox read-only \
  "Read README.md and summarize its purpose in one sentence."
codex-original --help       # Official CLI help, bypassing GHCP
```

The default remains `gpt-6-astra`. Use `--ghcp-model` to select a Copilot model; the GHCP launcher rejects native `--model`/`-m` overrides. Other Codex arguments follow `--`. For a native version check, use `codex-original --version`, not `codex --version`.

`whence -p` ignores shell functions and aliases and finds the executable on PATH each time, so there is no pinned nvm version path or recursion through the `codex` function. Keep the official `codex` executable on PATH; do not add a separate `codex` shim that points back to this launcher. `CODEX_BIN` is set only for the launcher invocation; arguments, working directory and exit status are preserved. Shells or programs that do not load this block still resolve the official executable. `./bin/codex-ghcp` remains available without shell integration.

To undo, remove only the marked block from `~/.zshrc`, then open a new terminal or run `unfunction codex codex-original` in the current one. Restoring the entire backup also discards any unrelated shell edits made since that backup.

## Choose a model

Only these six Copilot catalog IDs are supported, in picker order:

| Order | Display name | Model ID |
| ---: | --- | --- |
| 1 | Claude Opus 5.5 | `claude-opus-5.5` |
| 2 | Claude Sonnet 5 | `claude-sonnet-5` |
| 3 | Claude Haiku 4.5 | `claude-haiku-4.5` |
| 4 | GPT-6 Astra | `gpt-6-astra` |
| 5 | GPT-6 Sol | `gpt-6-sol` |
| 6 | GPT-6 Luna | `gpt-6-luna` |

The default is **`gpt-6-astra`**. Availability is checked against your account's catalog and policy; an unavailable model fails rather than silently switching to another one. Removed IDs (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `claude-opus-5`) are rejected by the launcher and bridge with no substitution.

```bash
./bin/ghcp-models --json
./bin/codex-ghcp --ghcp-model claude-opus-5.5
./bin/codex-ghcp --ghcp-model claude-sonnet-5
```

A catalog entry is not a guarantee that every Codex feature works with that model. At launch, the authenticated `/v1/models` catalog is written to a private, temporary `model_catalog_json` file. Codex's `/model` picker uses only the account-enabled subset of the six models above, including Claude, in the order shown rather than bundled OpenAI models or an unrelated cached catalog. Use `--ghcp-model` to choose the initial model; relaunch to refresh account availability. The catalog is removed when that Codex process exits, including when using a background bridge.

Codex 0.154.0 sorts the picker by catalog priority and labels the first entry `(default)`, so `claude-opus-5.5` carries that label; the launcher still starts on `gpt-6-astra`, shown as `(current)`, unless `--ghcp-model` selects another model. Choosing a model in `/model` switches the running session. Codex also saves that choice as `model`/`model_reasoning_effort` in `~/.codex/config.toml` and warns that a higher-priority layer overrides it: the next GHCP launch still uses `--ghcp-model` or the default, but native `codex-original` runs read the saved value, so reset it there if needed.

All six models use **their largest SDK-advertised context tier**: `contextTier: "long_context"` when Copilot advertises long-context pricing or explicitly supports that tier, otherwise `"default"`. The same selection governs the Codex catalog, session creation, model/effort changes, history rebuilds and idle recovery. An upstream tier rejection is an error, not a silent fallback. SDK-side automatic compaction remains disabled so Codex owns the conversation history.

The catalog supplies an **input budget**, not the total input-plus-output window: it takes the smallest applicable model/tier prompt limit and reserves the model's maximum output space within its total window. Codex's local automatic compaction starts at **80%** of that budget. Missing context metadata fails at launch instead of inventing a limit. Current account metadata (2026-09-23) produces these token budgets; values are derived from the SDK, not hard-coded:

| Model | Total context maximum | Codex input budget | Auto-compaction threshold |
|---|---:|---:|---:|
| `claude-opus-5.5` | 1,000,000 | 872,000 | 697,600 |
| `claude-sonnet-5` | 1,000,000 | 936,000 | 748,800 |
| `claude-haiku-4.5` | 200,000 | 136,000 | 108,800 |
| `gpt-6-astra` | 1,050,000 | 922,000 | 737,600 |
| `gpt-6-sol` | 1,000,000 | 872,000 | 697,600 |
| `gpt-6-luna` | 1,000,000 | 872,000 | 697,600 |

Haiku stays on its default tier; the other five currently advertise long context. Larger contexts can increase latency, memory and usage charges. Current GPT long-tier pricing is 2x input and 1.5x output; Claude Opus/Sonnet currently list the same tier rates. Account metadata can change. Do not override only Codex's `model_context_window` to exceed the SDK budget. Existing processes retain their old settings: exit Codex normally and relaunch to apply this change.

Each catalog entry also declares `apply_patch_tool_type: "freeform"`, so Codex offers its native `apply_patch` editing tool to Copilot models, as it does for bundled OpenAI models. Before this, the real TUI offered only the shell tool; models either wrote files through shell commands or reported that `apply_patch` was unavailable. The bridge forwards the freeform patch text byte-exact, and Codex still applies it under its own sandbox and approval policy.

## Run Codex

Interactive:

```bash
./bin/codex-ghcp
```

Non-interactive, with a read-only sandbox:

```bash
./bin/codex-ghcp --ghcp-model gpt-6-astra -- \
  exec --skip-git-repo-check --sandbox read-only \
  "Read README.md and summarize its purpose in one sentence."
```

`--skip-git-repo-check` is useful when this directory is not a Git repository. It does not disable sandboxing. The launcher does not add approval-bypass or sandbox-bypass options.

By default, the launcher starts a bridge on a free loopback port, waits for readiness, runs Codex, and cleans up the bridge it owns. Ordinary Codex arguments follow `--`. Provider/transport settings are reserved to keep requests on this bridge; conflicting arguments fail with guidance.

Optional background bridge:

```bash
./bin/codex-ghcp --bridge-background --ghcp-model gpt-6-astra
./bin/codex-ghcp-status
./bin/codex-ghcp-stop
```

These are project launcher commands, not built-in Codex options. Stopping a background bridge ends its in-memory conversations, including pending tool calls. Use stop only when those conversations are no longer needed.

## Configuration stays local to the launch

The launcher passes Responses provider settings through Codex `-c` arguments and a generated **local bridge credential** through the child process environment. It disables unsupported WebSocket, request compression, hosted web search, remote compaction and reasoning summaries. The launcher itself does not edit `~/.codex/config.toml`, `auth.json`, shell startup files, or another project's server. The optional zsh integration above is a separate, explicit edit to `~/.zshrc`; it does not replace the official CLI or change Codex authentication.

Copilot/GitHub authentication is not copied into Codex. The local bridge token is not a GitHub or OpenAI credential. Other Codex configuration can still affect a run; the wrapper is not a fresh Codex profile.

Bridge SDK sessions disable every MCP server configured for the Copilot runtime itself (`~/.copilot/mcp-config.json` and installed plugins). Those servers were never exposed to the model, because sessions allow only Codex-declared tools, yet the runtime previously started a fresh set for each session (here azmcp and two Playwright processes, about 300 MB RSS). Names are read from those files at session creation; a bounded post-creation check stops any server from another source and disables it for later sessions. Codex's own MCP servers are unaffected: Codex runs them and declares their tools to the bridge like any other tool.

`.env` is **not automatically loaded** by `npm run bridge` or the launcher. `.env.example` documents direct-server settings. For an explicitly configured server:

```bash
# Use an independently generated token, not your GitHub credential.
export BRIDGE_API_KEY="$(openssl rand -hex 32)"
HOST=127.0.0.1 PORT=4143 npm run bridge
```

Alternatively, create your own `.env` from `.env.example`, replace its token placeholder, and run `node --env-file=.env src/server.mjs`. The default direct-server port is `4143`; normal launcher runs select a free port instead.

Routes:

- `GET /health`: non-secret readiness/instance information, no token required.
- `GET /v1/models`: authenticated, permitted model IDs for this account.
- `POST /v1/responses`: authenticated text and tool requests; SSE or JSON.

Every route except health requires `Authorization: Bearer <bridge-token>` (or `x-api-key`). No public interface binding is supported.

## Boundaries and troubleshooting

See [Compatibility](docs/COMPATIBILITY.md) before relying on advanced Codex features.

| Symptom | Action |
| --- | --- |
| Copilot authentication error | Run `copilot login`, then `./bin/ghcp-models`. Do not paste credentials into a prompt or source file. |
| Model unavailable | Confirm the exact ID, Copilot entitlement and organization policy. There is no fallback model. |
| Unsupported reasoning effort | Choose a catalog-supported level with `-c 'model_reasoning_effort="low"'` after `--`. Haiku 4.5 has no configurable effort; the bridge logs that limitation. |
| Port already used | Let the launcher choose a free port, or change `PORT` for a direct server. Do not stop another project's process. |
| Unknown response/tool call | The bridge may have restarted or expired the session. Start a new conversation; never fabricate a tool result. |
| Long turn or context-limit error | Local auto-compaction also handles completed tool-result batches. Use `/compact` between turns or start a shorter conversation if the model still reports `context_length_exceeded`; increasing a byte limit does not increase model context. |
| History too large | Start a shorter conversation or explicitly raise `MAX_REPLAY_BYTES` with awareness of memory/context limits. |
| Unsupported input or transport | Use the launcher defaults and text-only requests. Upgrading Codex can introduce new request forms. |
| Custom tool parse error | Grammar is advisory through the SDK, not native constrained decoding. Try again or choose another allowed model; raw tool text is never silently rewritten. |

Both the serialized conversation-history limit (`MAX_REPLAY_BYTES`) and HTTP request-body limit (`MAX_BODY_BYTES`) default to **33,554,432 bytes (32 MiB)**. These are operational starting points, not benchmarked capacity guarantees or model context-window limits; very large conversations can still exceed available memory or the upstream model's context. Override either limit with a positive integer environment variable when needed, and restart the bridge to apply changes. The launcher does not automatically load `.env`. Stop a background bridge only after closing its Codex sessions, because restarting discards its in-memory conversation state.

The launcher keeps Codex's automatic HTTP/stream retries disabled. The bridge checks SDK readiness and records content-free turn watchdog diagnostics every **15 seconds** (`SDK_READINESS_INTERVAL_MS`). Root text, reasoning, tool-input streaming and **increasing** `assistant.streaming_delta` byte counts refresh the **90-second** inactivity deadline (`TURN_IDLE_TIMEOUT_MS=90000`); unchanged/invalid counters, HTTP keepalives and subordinate-agent traffic do not. Hidden progress is never exposed as answer text. A completely silent upstream still cannot be distinguished from long, unobservable reasoning by a local health check.

On inactivity, the bridge can rebuild the affected SDK session **once per request** (`TURN_IDLE_RECOVERY_ATTEMPTS=1`, range 0–3; 0 restores fail-fast behavior) while keeping the original response stream open. Recovery requires acknowledged input, no assistant output or pending calls, and successful abort/disconnect/delete of the old session. Completed tool results are supplied only as conversation history, **never resubmitted through the tool-result RPC**. Model, effort and instructions are preserved; other conversations are not restarted. Partial output, uncertain tool submissions, filtering, cancellation, failed cleanup and lost SDK connections are not automatically replayed. A repeated stall returns `copilot_idle_timeout`, rather than looping forever. Recovery can consume additional inference usage and does not guarantee identical output or exactly-once model behavior.

Session creation and model-setting RPCs use the **30-second SDK startup bound** (`SDK_STARTUP_TIMEOUT_MS=30000`, capped by the turn deadline), returning `copilot_setup_timeout` instead of waiting for a full model turn. The absolute turn deadline remains five minutes (`TURN_TIMEOUT_MS=300000`), shared across recovery attempts, with a six-minute total manager request deadline including queue wait (`REQUEST_TIMEOUT_MS=360000`); cleanup has separate bounds. Neither deadline resets on recovery. These changes apply to newly launched processes. If using an existing background bridge, first close its Codex sessions, run `./bin/codex-ghcp-stop`, and relaunch.

**Source edits do not update an already-running bridge.** With the default foreground launcher, exit Codex normally and run `./bin/codex-ghcp -- resume --last` from the same directory to load the fix and resume the latest conversation. Do not kill the bridge beneath an active Codex session. `codex-ghcp-status` reports background bridges only; `stopped` does not mean that a foreground bridge is absent. A running bridge's `/health` exposes `turnWatchdog` (`idleTimeoutMs`, `recoveryAttempts`, `intervalMs`), also included in background status. Missing watchdog fields indicate an older process, not that the new defaults are active. Recovery skips report a specific reason instead of an ambiguous claim that no request was retried.

**If automatic recovery is exhausted:** the replacement session also made no observable progress before the idle limit. This does not prove a deadlock: `/health.ready` only checks the local SDK connection, not reachability of the Copilot model service. Connection errors such as `Connect: ... ETIMEDOUT` require checking the network, proxy/VPN and service availability; increasing retries cannot repair an outage. Startup failures now identify the SDK operation (`start`, `ping` or `listModels`) and record content-free timeout diagnostics. Idle errors include the configured interval and last observed root event.

For legitimate slow or silent reasoning, an **opt-in latency-tolerant launch** is available after normal exit. This raises the idle limit to three minutes, allows at most two safe recoveries, and keeps a ten-minute absolute turn limit and eleven-minute total request limit:

```bash
TURN_IDLE_TIMEOUT_MS=180000 TURN_IDLE_RECOVERY_ATTEMPTS=2 \
TURN_TIMEOUT_MS=600000 REQUEST_TIMEOUT_MS=660000 \
./bin/codex-ghcp -- -c 'model_reasoning_effort="low"' resume --last
```

This is not the default or a guarantee against disconnection, and it can increase waiting time and inference usage. Raise the turn/request budgets together rather than only the idle timeout. Use `/compact` between completed turns to reduce long-history latency; a larger maximum context does not make a large conversation faster. Never use keepalives as fabricated model progress or blindly rerun completed tools. Long test runners save progress independently under `.runtime`, so a chat failure does not mean the test process stopped; inspect its existing report before starting another run.

## Local checks and integrated compatibility

```bash
npm test                              # Unit/controller checks, no model calls
npm run test:context:runtime           # Actual Codex/PTY: compaction, 120 tools, idle/setup/Esc recovery; fake SDK
npm run test:terminal:runtime          # Integrated PTY/Playwright lanes, cancellation and cleanup; fake SDK
npm run test:scenarios                 # 18 versioned scenario contracts
npm run docs:scenarios:check           # Generated document consistency
npm run test:compatibility -- --plan   # Offline execution plan
npm run test:compatibility:runtime     # Real Codex + SDK double, no model calls
```

The context runtime checks use the installed Codex CLI with an isolated profile and a mechanical SDK peer. The actual-terminal cases also require Python 3 for a private PTY. They verify same-terminal recovery after inactivity, stuck session creation and Escape, plus 120 sequential native tool calls across repeated compaction. They do not make model calls or certify maximum-context or long-duration reliability.

Actual bounded terminal checks are reproducible with `npm run test:terminal -- --execute --driver playwright --model gpt-6-astra --duration-seconds 120`; `pty` is also supported. Install Chromium first with `npx --no-install playwright install chromium`. For workload sizing, cancellation, source-frozen evidence and the integrated `test:soak -- --terminal` path, see [terminal/endurance testing](docs/SOAK_TESTING.md). Live commands consume Copilot usage; the default `--plan` does not.

The separate `codex-ghcp-tui-12-v2` contract drives the **real TUI → bridge → Copilot SDK → exact model** path with headless Playwright/xterm.js: **12 scenarios × 6 models = 72 cases**, targeting **95% (69/72)** in one complete live run. It covers picker switching, shell and `apply_patch` tools, Codex MCP isolation, long output, large pastes, Escape recovery, `/compact`, resume, effort changes and cleanup. Common checks also require authoritative SDK model/context-tier snapshots, successful Responses SSE, production watchdog settings and clean shutdown. Run `npm run test:tui` (plan), `npm run test:tui:runtime` (offline) or `npm run test:tui -- --execute`. See [real TUI scenarios](docs/TUI_SCENARIOS.md).

**Latest real-TUI verification (2026-09-23 KST): v2 72/72 (100%)**, all six models 12/12, on implementation `fe500d78`; current and frozen-source verification passed. The first run's **45/72** remains recorded, including an actual Copilot API connection timeout. The final run used the unchanged production watchdog defaults and had no failed streams, stalled turns or SDK cleanup errors. It does not guarantee future network availability. See the [v2 evidence and limitations](docs/validation/2026-09-23-tui-connection-v2/README.md). [Historical v1 70/72](docs/validation/2026-09-23-tui-scenarios/README.md) is a separate contract, not regraded or combined.

The 18-scenario compatibility contract is separate from the 11-scenario stability contract; stability results do not certify this larger live matrix.
**18 scenarios × six GHCP models = 108 cases**, with no reference-provider run, fast suite or model subset.
Up to four model lanes, individual deadlines and continuation after failure keep the run short. One hour is a target, not an overall cutoff.

Live execution requires Copilot authentication and consumes usage. No OpenAI API key is required.

```bash
npm run test:compatibility -- --execute
npm run test:compatibility -- --verify .runtime/compatibility-<run-id>/report.json
```

See [integrated scenarios and coverage](docs/NATIVE_SCENARIOS.md) and the [runner/evidence guide](docs/COMPATIBILITY_TESTING.md).
**90% is an everyday-workflow coverage target, not a measured product-feature support rate.** The reviewer-defined 20-group checklist has a **75% design score**, not a live support rate.

## Bridge stability and recovery checks

The separate `codex-ghcp-stability-11-v4` contract has **11 scenarios × 6 models = 66 cases**. It exercises tool reordering, pending-policy rejection, HTTP duplication/cancellation, SDK loss, stream mismatch, resume and compaction through real Codex. Fault injections and actual model results are distinguished. See the [scope, acceptance, settings and commands](docs/STABILITY_TESTING.md).

```bash
npm run test:stability:stress
npm run test:stability:runtime
npm run test:stability -- --plan
npm run test:stability -- --execute  # Consumes Copilot usage
```

**Latest full real-Codex verification (six-model contracts, 2026-09-23 KST): default v4 57/66 (86.36%); separate `application-data-v2` 63/66 (95.45%).** Both entire matrices ran on implementation `68f92d74` and were verified against current/frozen source; they predate the freeform `apply_patch` catalog change and were not rerun on `54c7eb77`. In v4, every model except `claude-opus-5.5` passed 11/11; all nine Opus 5.5 failures are explicit upstream filters. The remaining application-data-v2 failures are one Opus filter, one SDK `disconnect` cleanup timeout and one model tool-repetition miss. The bridge now disables the Copilot runtime's unused MCP servers (0 MCP processes across the final matrices). Live runs also found and fixed a macOS `EPERM` supervisor false failure. See the [changes, run history and evidence](docs/validation/2026-09-23-six-model-switch/README.md).

**Previous full real-Codex verification (historical 7-model v3/application-data-v1 contract, 2026-09-23 KST): default v3 66/77 (85.71%); separate `application-data-v1` 72/77 (93.51%).** Both entire matrices were executed after terminal-runner integration and verified against current/frozen source. Upstream filtering, literal-label omissions and missing repeated tool calls remain failures; neither run is 77/77 or meets the earlier 95% target. Extra real PTY/Playwright checks found and fixed a scrolling-region observer bug. Earlier 74/77 and other results remain independent historical records, never combined. See the [implementation, full results and evidence](docs/validation/2026-09-22-terminal-integration/README.md) and [verification index](docs/validation/README.md).

Archived verification documents were removed before this repair at the user’s request and have not been restored. Complete runs during this repair are recorded separately, including failures and timeouts; old cells are not reused as new scores. This is not hours-long or whole-product certification.

## References

- [Official Codex CLI](https://github.com/openai/codex)
- [Codex advanced configuration](https://developers.openai.com/codex/config-advanced/)
- [Official GitHub Copilot SDK](https://github.com/github/copilot-sdk)
