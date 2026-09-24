# Usage and troubleshooting

[한국어](USAGE_KO.md) · [Quick start](../README.md) · [Compatibility](COMPATIBILITY.md) · [Architecture](ARCHITECTURE.md)

Start with the [quick start](../README.md#quick-start). This guide covers optional setup and operating details; no shell integration or `.env` file is needed for a normal launch. Run `./bin/...` commands from the repository root, or use the launcher's absolute path from your working project.

| Task | Section |
| --- | --- |
| Run or resume Codex | [Run Codex](#run-codex) |
| Work in another repository | [Use in another project](#use-in-another-project) |
| Pass a Codex command or option | [Command layout](#pass-codex-commands-and-options) |
| Keep a bridge running, check its status or stop it | [Optional background bridge](#optional-background-bridge) |
| Understand `/model` and context limits | [Model selection and context](#model-selection-and-context) |
| Set a model, port or executable path | [Launcher settings](#launcher-settings) |
| Manage the HTTP server without Codex | [Direct server (advanced)](#direct-server-advanced) |
| Resolve errors | [Startup and configuration](#startup-and-configuration) · [During a conversation](#during-a-conversation) · [404/409 codes](#conversation-state-errors-404-409) · [Feature limitations](#feature-limitations) |
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

The default launch starts a bridge on a free loopback port and cleans it up when Codex exits. Type `/quit` in an idle Codex session to exit normally; no separate stop command is needed.

### Use in another project

Open a terminal **in the project you want Codex to work on**, not in this bridge repository. Use the launcher's absolute path; it preserves your working directory. For a clone at `$HOME/GitHub/openai-codex-ghcp-sdk`:

```bash
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp"
```

Adjust the path if your clone is elsewhere. The same options work with this absolute path; no shell integration is needed.

### Pass Codex commands and options

To choose a model and make a non-interactive, read-only request:

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- exec --sandbox read-only \
  "Read README.md and summarize its purpose in one sentence."
```

| Input | Where to put it |
| --- | --- |
| Launcher options: `--ghcp-model`, `--bridge-background` | Before `--` in the shell command |
| Codex commands/options: `exec`, `resume`, `--sandbox` | After `--` in the shell command |
| Slash commands: `/model`, `/compact`, `/quit` | Inside the running Codex session, not in the shell |

Native `--model`/`-m` is rejected; use `--ghcp-model` instead. The launcher also rejects provider/transport overrides and does not add approval or sandbox bypasses.

Outside a Git repository, add `--skip-git-repo-check` after `exec`; it skips only the Git check.

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

To switch during a session, enter `/model` **inside Codex**. The picker shows only account-enabled models, in the documented order. Relaunch to refresh availability. Being listed does not guarantee every Codex feature works; see [compatibility](COMPATIBILITY.md).

In Codex 0.154.0, the picker labels mean:

| Label | Meaning |
| --- | --- |
| `(current)` | The active model in this session. |
| `(default)` | The first picker entry: `claude-opus-5.5` when all six are available. It is **not** the launcher's default model. |

**`/model` also saves `model` and `model_reasoning_effort` in `~/.codex/config.toml`.** What happens on the next launch depends on how you start Codex:

- **GHCP launcher:** still uses `--ghcp-model`, then `GHCP_MODEL`, then `gpt-6-astra`.
- **Official CLI directly:** `command codex` reads the saved selection; so does `codex-original` from the [optional zsh integration](#optional-zsh-integration). Reset the saved model first if needed.

The temporary picker catalog is removed when Codex exits, even with a background bridge. That does not undo the saved selection; see [catalog implementation](ARCHITECTURE.md#modules).

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

## What the launcher changes

For each launch:

- The launcher points Codex at its bridge with Codex `-c` arguments and passes a generated **local bridge token** through the Codex process environment. The token is not a GitHub or OpenAI credential.
- It turns off Codex features the bridge does not support: WebSockets, request compression, hosted web search, remote compaction and reasoning summaries.
- The bridge starts Copilot sessions with the Copilot runtime's own MCP servers disabled, including user and plugin servers. Codex's MCP servers still work because Codex runs them itself; see [tool handoff](ARCHITECTURE.md#tool-handoff).

The launcher does not edit `~/.codex/config.toml`, `auth.json`, shell startup files or another project's server, and it does not copy your Copilot/GitHub login into Codex. Your other Codex settings still apply; it is not a fresh Codex profile. Two exceptions are your own choices: Codex's `/model` can save your selection to `~/.codex/config.toml`, and the optional [zsh integration](#optional-zsh-integration) is an edit you make to `~/.zshrc`.

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

## Troubleshooting

Find the symptom below. For the full support boundary, see [Compatibility](COMPATIBILITY.md).

### Startup and configuration

| Symptom | Action |
| --- | --- |
| `./bin/...`: file not found | Run from this repository's root, or use [the absolute launcher path](#use-in-another-project) from your project. |
| Codex rejects `--ghcp-model` as an unexpected argument | Put launcher options **before** `--`, for example `./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- resume --last`. |
| Help/version unexpectedly starts a bridge | Use `./bin/codex-ghcp --help` for launcher help, or `command codex --help` / `command codex --version` for the official CLI. Arguments after `--` take the normal bridge startup path. |
| Doctor reports `ok: false` or `supportedVersion: false` | Read the failing field. Run `npm ci` for an SDK mismatch; install/fix the named CLI or Node version for a tool failure. Use the [pinned setup](../README.md#quick-start). |
| Copilot authentication error | Run `copilot login`, then `./bin/ghcp-models`. Do not paste credentials into a prompt or source file. |
| Model unavailable | Run `./bin/ghcp-models` and choose an ID that is neither `disabled` nor `not available` with `--ghcp-model`. If none qualify, check Copilot entitlement and organization policy. There is no fallback. |
| `.env` or source changes have no effect | `.env` is not loaded automatically. Use [launcher settings](#launcher-settings), then [restart safely](#load-updated-code); an existing bridge keeps its old settings and code. |
| Unsupported reasoning effort | Choose a catalog-supported level with `-c 'model_reasoning_effort="low"'` after `--`. Haiku 4.5 has no configurable effort; the bridge logs that limitation. |
| Port already used | Let the launcher choose a free port, or change `PORT` for a direct server. Do not stop another project's process. |

### During a conversation

| Symptom | Action |
| --- | --- |
| HTTP 404 or 409, for example `unknown_tool_call` or `tool_result_mismatch` | The bridge lost or cannot continue this conversation's state. Start a new conversation with `/new`; see [what each code means](#conversation-state-errors-404-409). |
| No response, timeout or `ETIMEDOUT` | Check network/proxy/service availability, then [the applicable deadline](#timeouts-and-recovery) and [slow-upstream guidance](#slow-or-disconnected-upstream). Local readiness does not prove model availability. |
| Long turn or context-limit error | Local auto-compaction also handles completed tool-result batches. Use `/compact` between turns or start a shorter conversation if the model still reports `context_length_exceeded`; increasing a byte limit does not increase model context. |
| History too large | Start a shorter conversation or explicitly raise `MAX_REPLAY_BYTES` with awareness of memory/context limits. |

Both the serialized-history limit (`MAX_REPLAY_BYTES`) and HTTP body limit (`MAX_BODY_BYTES`) default to **32 MiB (33,554,432 bytes)**. They are memory/request safeguards, not model token limits or measured capacity guarantees. Override them with positive integer environment variables and restart the bridge after closing its Codex sessions. The launcher does not load `.env` automatically.

### Feature limitations

| Symptom | Action |
| --- | --- |
| Task-title request gets HTTP 400 `Structured output is not supported` | The optional automatic title is unsupported; the conversation can continue. Other structured-output requests are also unsupported, not successful responses. See [compatibility](COMPATIBILITY.md#rejected-or-disabled). |
| Unsupported input or transport | Use the launcher defaults and text-only requests. Upgrading Codex can introduce new request forms. |
| Custom tool parse error | Grammar is advisory through the SDK, not native constrained decoding. Check whether the tool ran before retrying, or choose another allowed model. Raw tool text is never silently rewritten. |

### Timeouts and recovery

| Deadline | Default | Environment variable |
| --- | --- | --- |
| SDK setup | 30 seconds | `SDK_STARTUP_TIMEOUT_MS` |
| Wait for first model progress | 180 seconds | `TURN_FIRST_PROGRESS_TIMEOUT_MS` |
| Inactivity after progress begins | 90 seconds | `TURN_IDLE_TIMEOUT_MS` |
| Entire model turn, including recovery | 5 minutes | `TURN_TIMEOUT_MS` |
| Entire request, including queue wait | 6 minutes | `REQUEST_TIMEOUT_MS` |

These limits run at the same time; they do not add up. Values are in **milliseconds**, and a changed value applies only after you [restart the bridge](#load-updated-code). Keepalive messages do not count as model progress. For every setting and error code, see [operational defaults](STABILITY_TESTING.md#operational-defaults).

**Automatic recovery:** if a model turn stays silent, the bridge can replace its Copilot session **once per request** without closing Codex's response stream. It does so only when nothing can be lost or repeated: the SDK connection is healthy, the input was acknowledged, the model has produced no output or tool calls, and the old session was cleaned up. Recovery keeps the original turn and request deadlines, never resends completed tool results and can use extra Copilot usage. Set `TURN_IDLE_RECOVERY_ATTEMPTS=0` to turn it off. Codex's own automatic HTTP/stream retries stay disabled. See [recovery details](ARCHITECTURE.md#model-progress-and-recovery).

### Conversation-state errors (404, 409)

These errors mean the bridge no longer has, or cannot safely continue, the conversation state that Codex sent. Common causes are a bridge restart, session expiry or a lost Copilot connection. **Start a new conversation with `/new`**, or exit and relaunch. Do not rerun completed tools or type a made-up tool result to get past the error.

| Code | What happened |
| --- | --- |
| `response_not_found` (404), `unknown_tool_call` | The bridge no longer knows the response or tool call; it probably restarted or the session expired. |
| `upstream_session_lost`, `history_invalidated` | The Copilot session was lost or changed independently. Pending work was not replayed. |
| `tool_result_mismatch`, `pending_tool_results`, `unresolved_tool_calls` | The tool results do not match the calls the bridge is waiting for: some are missing, duplicated or unknown. |
| `pending_session_changed`, `stale_response`, `session_mismatch` | The history or response ID does not match the bridge's latest state for this conversation. |

Changing the model, tools or instructions while tools are pending works when every pending result arrives together; see the [handoff rules](ARCHITECTURE.md#changing-configuration-with-completed-tools). If an error also happens in a new conversation, note its code and message.

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

For `ETIMEDOUT` or connection failures, **check network, proxy/VPN and service availability before increasing timeouts**. `/health.ready` describes the local SDK connection, not the remote model service.

A `copilot_idle_timeout` after recovery means the replacement session was also silent until its deadline; that alone does not mean the bridge is stuck. The error message names the limit that expired: `phase: first_progress` (no progress yet) or `phase: streaming` (progress stopped). A replacement session does not get a new turn budget.

For slower workloads, use this **opt-in latency-tolerant launch** after normal exit and stopping any retained background bridge. Run from the original working project and adjust the clone path as above. It allows three minutes both before and after first progress, at most two safe recoveries, a ten-minute absolute turn limit and an eleven-minute total request limit:

```bash
TURN_FIRST_PROGRESS_TIMEOUT_MS=180000 TURN_IDLE_TIMEOUT_MS=180000 TURN_IDLE_RECOVERY_ATTEMPTS=2 \
TURN_TIMEOUT_MS=600000 REQUEST_TIMEOUT_MS=660000 \
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" -- \
  -c 'model_reasoning_effort="low"' resume --last
```

This is not the default or a guarantee against disconnection, and it can increase waiting time and inference usage. Raise the turn/request budgets together rather than only the idle timeout.

Use `/compact` between completed turns to reduce long-history latency; a larger maximum context does not make a large conversation faster. Never use keepalives as fabricated model progress or blindly rerun completed tools.

**If a long test was running, inspect its existing `.runtime` report before starting another run.** Test runners save progress independently; a chat failure does not mean the test process stopped.

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
