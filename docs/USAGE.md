# Usage and troubleshooting

[한국어](USAGE_KO.md) · [Quick start](../README.md) · [Compatibility](COMPATIBILITY.md) · [Architecture](ARCHITECTURE.md)

Start with the [quick start](../README.md#quick-start). This guide covers optional setup and operating details; no shell integration or `.env` file is needed for a normal launch. Run `./bin/...` commands from the repository root, or use the launcher's absolute path from your working project.

| Task | Section |
| --- | --- |
| Run interactively, use a background bridge or stop it | [Run Codex](#run-codex) |
| Understand `/model` and context limits | [Model selection and context](#model-selection-and-context) |
| Set a model, port or executable path | [Launcher settings](#launcher-settings) |
| Manage the HTTP server without Codex | [Direct server (advanced)](#direct-server-advanced) |
| Resolve errors | [Troubleshooting](#boundaries-and-troubleshooting) |
| Adjust timeouts or apply source/configuration changes | [Timeouts](#timeouts-and-recovery) · [Restart safely](#load-updated-code) |
| Make `codex` use this launcher | [Optional zsh integration](#optional-zsh-integration) |

## Run Codex

Choose the launch that matches your task; these are alternatives, not a sequence to run together.

| Task | From the repository root |
| --- | --- |
| Interactive session | `./bin/codex-ghcp` |
| Resume the latest conversation in this directory | `./bin/codex-ghcp -- resume --last` |
| Launcher help without a bridge | `./bin/codex-ghcp --help` |
| Official Codex help without a bridge | `command codex --help` |

To choose a model and make a non-interactive, read-only request:

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- exec --sandbox read-only \
  "Read README.md and summarize its purpose in one sentence."
```

**Before `--`: launcher options**, such as `--ghcp-model` and `--bridge-background`. **After `--`: Codex commands and options**, such as `exec`, `resume` and `--sandbox`. Native `--model`/`-m` is rejected; use `--ghcp-model` instead. Enter slash commands such as `/model`, `/compact` and `/quit` **inside the running Codex session**, not in your shell.

Outside a Git repository, add `--skip-git-repo-check` after `exec`; it skips only the Git check. The launcher does not add approval or sandbox bypasses and rejects provider/transport overrides.

To work in another project, open a terminal **in that project** and use the launcher's absolute path. For a clone at `$HOME/GitHub/openai-codex-ghcp-sdk`:

```bash
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp"
```

Adjust the path if your clone is elsewhere. The launcher preserves the working directory, starts a bridge on a free loopback port, and cleans up that bridge when Codex exits. Type `/quit` in an idle Codex session to exit normally; no separate stop command is needed for this default foreground mode.

### Optional background bridge

Keep the bridge after Codex exits only if you want to reuse it:

```bash
./bin/codex-ghcp --bridge-background --ghcp-model gpt-6-astra
```

Check it with `./bin/codex-ghcp-status`. It reports **background bridges only**: `stopped` does not mean a foreground bridge is absent. These are project commands, not built-in Codex options. **Stop only after closing its Codex sessions:** stopping discards in-memory conversations, including pending tool calls.

```bash
./bin/codex-ghcp-stop
```

## Model selection and context

Only the [six supported model IDs](../README.md#models) are accepted. Initial selection is `--ghcp-model`, then `GHCP_MODEL`, otherwise `gpt-6-astra`. Native `--model`/`-m` overrides are rejected. An unavailable model fails rather than silently switching to another one.

Inspect your account's catalog:

```bash
./bin/ghcp-models --json
```

Then choose one available model, for example:

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5
```

The `/model` picker shows the account-enabled subset of the six supported models in the documented order. Relaunch to refresh availability. Being listed does not guarantee every Codex feature works; see [compatibility](COMPATIBILITY.md). The launcher's temporary catalog replaces bundled/cached entries and is removed on Codex exit, even with a background bridge; [implementation details](ARCHITECTURE.md#modules).

Codex 0.154.0 labels the first picker entry `(default)`. When all six models are available, that label appears on `claude-opus-5.5`; it does not change the launcher's default. The active model is marked `(current)`.

**`/model` can change your Codex configuration.** It switches the running session and saves `model`/`model_reasoning_effort` in `~/.codex/config.toml`. The next GHCP launch still uses `--ghcp-model`, `GHCP_MODEL` or the launcher default. Direct CLI runs through `command codex` read the saved value; so does `codex-original` if you add the [optional zsh integration](#optional-zsh-integration). Reset the saved model before a direct CLI run if needed.

### Context limits

The bridge uses **the largest context tier advertised by the SDK**, consistently across model changes and recovery. Missing context metadata or an upstream tier rejection is an error, not a silent fallback. See [tier selection and budget calculation](ARCHITECTURE.md#context-budgets) for the implementation.

Codex receives an **input budget** that reserves space for output, not the model's total input-plus-output window. Local auto-compaction starts at **80%** of that budget; the SDK's separate automatic compaction stays disabled.

Larger contexts can increase latency, memory and usage charges. Do not raise only Codex's `model_context_window` above the SDK budget. Exit Codex normally and relaunch to refresh the catalog and apply changed settings.

<details>
<summary>Historical account snapshot: 2026-09-23, not current limits</summary>

These values were derived from SDK metadata, not hard-coded. Check current account metadata before estimating capacity or cost.

| Model | Total context maximum | Codex input budget | Auto-compaction threshold |
|---|---:|---:|---:|
| `claude-opus-5.5` | 1,000,000 | 872,000 | 697,600 |
| `claude-sonnet-5` | 1,000,000 | 936,000 | 748,800 |
| `claude-haiku-4.5` | 200,000 | 136,000 | 108,800 |
| `gpt-6-astra` | 1,050,000 | 922,000 | 737,600 |
| `gpt-6-sol` | 1,000,000 | 872,000 | 697,600 |
| `gpt-6-luna` | 1,000,000 | 872,000 | 697,600 |

</details>

## Configuration stays local to the launch

The launcher passes Responses provider settings through Codex `-c` arguments and a generated **local bridge credential** through the child process environment. It disables unsupported WebSocket, request compression, hosted web search, remote compaction and reasoning summaries. The launcher itself does not edit `~/.codex/config.toml`, `auth.json`, shell startup files, or another project's server. Codex's `/model` command can save your selection; [zsh integration](#optional-zsh-integration) is a separate shell edit you make explicitly.

Copilot/GitHub authentication is not copied into Codex. The local bridge token is not a GitHub or OpenAI credential. Other Codex configuration can still affect a run; the wrapper is not a fresh Codex profile.

Bridge SDK sessions disable the Copilot runtime's own MCP servers, including user and plugin configuration. Codex's own MCP servers are unaffected: Codex runs them and declares their tools to the bridge like any other tool. See [tool handoff](ARCHITECTURE.md#tool-handoff) for the isolation mechanism.

### Launcher settings

All settings below are optional. Set environment variables in the invoking shell or prefix a command with them; the launcher does **not** read `.env`.

| What to change | Option or environment variable | Default |
| --- | --- | --- |
| Initial model | `--ghcp-model` overrides `GHCP_MODEL` | `gpt-6-astra` |
| Loopback port | `--bridge-port` overrides `GHCP_BRIDGE_PORT` | `0` (choose a free port); `PORT` is for direct-server runs |
| Official Codex executable | `CODEX_BIN` | `codex` on PATH |
| Existing Copilot login directory | `COPILOT_HOME` | `~/.copilot` |
| Turn/request limits | [Timeout environment variables](STABILITY_TESTING.md#operational-defaults) | [Default timeouts](#timeouts-and-recovery) |

A retained background bridge keeps the settings it started with. To change its environment or load edited source, [close its Codex sessions and restart it](#load-updated-code).

### Direct server (advanced)

Use this only if you need to manage the HTTP bridge yourself; it does not start Codex. Normal launcher runs already manage a bridge and select a free port.

`.env` is **not automatically loaded** by `npm run bridge` or the launcher. [`.env.example`](../.env.example) documents direct-server settings. From the repository root:

```bash
# Use an independently generated token, not your GitHub credential.
export BRIDGE_API_KEY="$(openssl rand -hex 32)"
HOST=127.0.0.1 PORT=4143 npm run bridge
```

Alternatively, create your own `.env` from `.env.example`, replace its token placeholder, and run `node --env-file=.env src/server.mjs`. The default direct-server port is `4143`; normal launcher runs select a free port instead.

In a second terminal, check that the HTTP listener responds:

```bash
curl --fail --silent --show-error http://127.0.0.1:4143/health
```

An HTTP 200 proves local liveness, not model-service availability. Stop this direct server with `Ctrl+C` in its terminal after closing any clients.

Routes:

- `GET /health`: HTTP liveness, last-known SDK readiness and instance information; no token required.
- `GET /readyz`: authenticated, bounded SDK readiness probe; not a model-service health guarantee.
- `GET /v1/models`: authenticated, permitted model IDs for this account.
- `POST /v1/responses`: authenticated text and tool requests; SSE or JSON.

Every route except health requires `Authorization: Bearer <bridge-token>` (or `x-api-key`). No public interface binding is supported.

## Boundaries and troubleshooting

See [Compatibility](COMPATIBILITY.md) before relying on advanced Codex features.

| Symptom | Action |
| --- | --- |
| `./bin/...`: file not found | Run from this repository's root, or use [the absolute launcher path](#run-codex) from your project. |
| Codex rejects `--ghcp-model` as an unexpected argument | Put launcher options **before** `--`, for example `./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- resume --last`. |
| Help/version unexpectedly starts a bridge | Use `./bin/codex-ghcp --help` for launcher help, or `command codex --help` / `command codex --version` for the official CLI. Arguments after `--` take the normal bridge startup path. |
| Doctor reports `ok: false` or `supportedVersion: false` | Read the failing field. Run `npm ci` for an SDK mismatch; install/fix the named CLI or Node version for a tool failure. Use the [pinned setup](../README.md#quick-start). |
| Copilot authentication error | Run `copilot login`, then `./bin/ghcp-models`. Do not paste credentials into a prompt or source file. |
| Model unavailable | Run `./bin/ghcp-models` and choose an ID that is neither `disabled` nor `not available` with `--ghcp-model`. If none qualify, check Copilot entitlement and organization policy. There is no fallback. |
| `.env` or source changes have no effect | `.env` is not loaded automatically. Use [launcher settings](#launcher-settings), then [restart safely](#load-updated-code); an existing bridge keeps its old settings and code. |
| Unsupported reasoning effort | Choose a catalog-supported level with `-c 'model_reasoning_effort="low"'` after `--`. Haiku 4.5 has no configurable effort; the bridge logs that limitation. |
| Port already used | Let the launcher choose a free port, or change `PORT` for a direct server. Do not stop another project's process. |
| Unknown response/tool call | The bridge may have restarted or expired the session. Start a new conversation; never fabricate a tool result. |
| Repeated 409 after tools finish | Check [tool-result conflicts](#tool-result-conflicts-409). Do not rerun completed tools to manufacture a replacement result. |
| No response, timeout or `ETIMEDOUT` | Check network/proxy/service availability, then [the applicable deadline](#timeouts-and-recovery) and [slow-upstream guidance](#slow-or-disconnected-upstream). Local readiness does not prove model availability. |
| Long turn or context-limit error | Local auto-compaction also handles completed tool-result batches. Use `/compact` between turns or start a shorter conversation if the model still reports `context_length_exceeded`; increasing a byte limit does not increase model context. |
| History too large | Start a shorter conversation or explicitly raise `MAX_REPLAY_BYTES` with awareness of memory/context limits. |
| Task-title request gets HTTP 400 `Structured output is not supported` | The optional automatic title is unsupported; the conversation can continue. Other structured-output requests are also unsupported, not successful responses. See [compatibility](COMPATIBILITY.md#rejected-or-disabled). |
| Unsupported input or transport | Use the launcher defaults and text-only requests. Upgrading Codex can introduce new request forms. |
| Custom tool parse error | Grammar is advisory through the SDK, not native constrained decoding. Check whether the tool ran before retrying, or choose another allowed model. Raw tool text is never silently rewritten. |

Both the serialized-history limit (`MAX_REPLAY_BYTES`) and HTTP body limit (`MAX_BODY_BYTES`) default to **32 MiB (33,554,432 bytes)**. They are memory/request safeguards, not model token limits or measured capacity guarantees. Override them with positive integer environment variables and restart the bridge after closing its Codex sessions. The launcher does not load `.env` automatically.

### Timeouts and recovery

| Deadline | Default |
| --- | --- |
| SDK setup | 30 seconds |
| Wait for first model progress | 180 seconds |
| Inactivity after progress begins | 90 seconds |
| Entire model turn, including recovery | 5 minutes |
| Entire request, including queue wait | 6 minutes |

These clocks overlap; they are not added together. A 15-second watchdog records content-free diagnostics; keepalives are not model progress. [All settings and error codes](STABILITY_TESTING.md#operational-defaults).

The bridge can rebuild a silent SDK session **once per request** while keeping the response stream open. This requires acknowledged input, no assistant output or pending calls, and confirmed cleanup of the old session. Completed tool results become history, **never duplicate result RPCs**. Partial output, uncertain submissions, filters, cancellation, cleanup failure and lost SDK connections prohibit replay. Recovery can consume extra inference usage and resets neither deadline; it is not an exactly-once guarantee. Set `TURN_IDLE_RECOVERY_ATTEMPTS=0` to disable it. Codex's automatic HTTP/stream retries remain disabled.

### Tool-result conflicts (409)

Configuration changes require every pending result exactly once and unchanged non-instruction history. Complete matching batches permit a session handoff; missing, duplicate or mismatched results remain errors. If 409 repeats after tools finish, check the error code and [handoff boundaries](ARCHITECTURE.md#conversation-continuity). Never fabricate results or blindly rerun completed tools.

### Load updated code

**Source or environment edits take effect only in a new bridge.** Keep the terminal in your **original working project**. The paths below assume a clone at `$HOME/GitHub/openai-codex-ghcp-sdk`; adjust them if needed.

1. **Inside Codex:** finish or cancel the current turn, then type `/quit`. For a background bridge, close every Codex session connected to it.
2. **In the shell, background mode only:** run `"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp-stop"`. Skip this step for the default foreground mode; its bridge exits with Codex.
3. **From the same working project:** resume with the command below. Do not change directories just to reach the launcher.

```bash
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" -- resume --last
```

If this repository is your working project, `./bin/codex-ghcp -- resume --last` is equivalent. The command starts a fresh foreground bridge; add `--bridge-background` before `--` to retain it again.

Do not kill the bridge beneath an active Codex session: restarting discards in-memory state, including unresolved tool calls. `/health.turnWatchdog` and background status show the running timeout/recovery settings, not the current source defaults.

### Slow or disconnected upstream

If recovery is exhausted, the replacement session also made no observable progress before its deadline. This does not prove a deadlock: `/health.ready` describes the local SDK connection, not the remote model service. For `ETIMEDOUT` or connection failures, check network, proxy/VPN and service availability before increasing timeouts. Diagnostics distinguish `first_progress` from `streaming`; a replacement session does not get a new absolute turn budget.

For slower workloads, use this **opt-in latency-tolerant launch** after normal exit and stopping any retained background bridge. Run from the original working project and adjust the clone path as above. It allows three minutes both before and after first progress, at most two safe recoveries, a ten-minute absolute turn limit and an eleven-minute total request limit:

```bash
TURN_FIRST_PROGRESS_TIMEOUT_MS=180000 TURN_IDLE_TIMEOUT_MS=180000 TURN_IDLE_RECOVERY_ATTEMPTS=2 \
TURN_TIMEOUT_MS=600000 REQUEST_TIMEOUT_MS=660000 \
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" -- \
  -c 'model_reasoning_effort="low"' resume --last
```

This is not the default or a guarantee against disconnection, and it can increase waiting time and inference usage. Raise the turn/request budgets together rather than only the idle timeout. Use `/compact` between completed turns to reduce long-history latency; a larger maximum context does not make a large conversation faster. Never use keepalives as fabricated model progress or blindly rerun completed tools. Long test runners save progress independently under `.runtime`, so a chat failure does not mean the test process stopped; inspect its existing report before starting another run.

For commands and measured results, use the [testing guide map](../README.md#testing) and [verification records](validation/README.md). Those records preserve failures and distinguish offline checks, live matrices and historical implementations.

## Optional zsh integration

Use this only if you want `codex` to invoke the GHCP launcher from any directory. `codex-original` will still invoke the official CLI directly. No shell changes are needed for the launch examples above.

Back up existing settings first:

```zsh
if [[ -f ~/.zshrc ]]; then
  cp -p ~/.zshrc ~/.zshrc.codex-ghcp.bak.$(date +%Y%m%d-%H%M%S)
fi
```

Add the block below **once** to `~/.zshrc`. Adjust the launcher path if your clone is elsewhere. Preserve existing PATH and unrelated settings; reconcile any existing `codex` or `codex-original` alias/function before adding these definitions.

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

Open a new terminal, or activate the block in the current one:

```zsh
source ~/.zshrc
whence -v codex codex-original
codex --help               # Launcher help; no bridge started
codex-original --version   # Official CLI version; no bridge started
```

Use `codex` for a default launch or `codex --ghcp-model gpt-6-sol` to choose a model. Use `codex-original --help` or `codex-original --version` for the official CLI, not `codex --version`.

`whence -p` finds the official executable while ignoring functions and aliases. Keep that executable on PATH; do not add a `codex` shim pointing back to this launcher. `CODEX_BIN` applies only to the invocation, and shells that do not load this block remain unchanged.

**Undo:** remove only the marked block, then open a new terminal or run `unfunction codex codex-original` in the current one. Restoring the entire backup would also discard unrelated edits made since the backup.
