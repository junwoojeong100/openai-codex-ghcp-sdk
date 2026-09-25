# Usage and troubleshooting

[한국어](USAGE_KO.md) · [Quick start](../README.md) · [Compatibility](COMPATIBILITY.md) · [Architecture](ARCHITECTURE.md)

Finish the [quick start](../README.md#quick-start) once, then jump to the section for your task. Normal launches need no `.env` file or shell setup. Run `./bin/...` commands from this repository's root; from another project, use the launcher's absolute path.

| Task | Section |
| --- | --- |
| Start or resume Codex, or pass Codex options | [Run Codex](#run-codex) · [Resume](#resume-a-conversation) · [Command layout](#pass-codex-commands-and-options) |
| Work in another repository | [Use in another project](#use-in-another-project) |
| Keep one bridge running between sessions | [Optional background bridge](#optional-background-bridge) |
| Switch models or understand context limits | [Model selection and context](#model-selection-and-context) |
| Change the model, port, timeouts or other limits | [Launcher settings](#launcher-settings) · [Timeouts and recovery](#timeouts-and-recovery) |
| Apply changed settings or code | [Restart the bridge safely](#restart-the-bridge-safely) |
| Fix an error | [Troubleshooting](#troubleshooting) |
| Run the HTTP server without Codex | [Direct server (advanced)](#direct-server-advanced) |
| Make `codex` use this launcher | [Optional zsh integration](#optional-zsh-integration) |

## Run Codex

| Task | Command (from the repository root) |
| --- | --- |
| Interactive session | `./bin/codex-ghcp` |
| Resume the latest conversation in this directory | `./bin/codex-ghcp -- resume --last` |
| Launcher help, without starting a bridge | `./bin/codex-ghcp --help` |
| Official Codex help, without a bridge | `command codex --help` |

Each launch starts its own bridge on a free loopback port and removes it when Codex exits. To exit, type `/quit` in an idle Codex session; no separate stop command is needed.

### Use in another project

Open a terminal **in the project you want Codex to work on**, not in this repository, and run the launcher by its absolute path. It keeps your current directory. For a clone at `$HOME/GitHub/openai-codex-ghcp-sdk`:

```bash
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp"
```

Adjust the path if your clone is elsewhere. Every launcher option works the same way with the absolute path.

### Resume a conversation

Run this **from the same working project**, using the launcher's absolute path if that project is not this repository:

```bash
./bin/codex-ghcp -- resume --last
```

Codex opens its latest saved conversation for that directory.

**Resume restores the history, not the model.** The launcher chooses the model again: `--ghcp-model`, then `GHCP_MODEL`, then `gpt-6-astra`. To resume with Sonnet:

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- resume --last
```

- **Before you exit,** let the current turn finish or press Esc to cancel it. A new bridge rebuilds the conversation from Codex's saved history, but it cannot recover tool calls that were still waiting in the old bridge.
- **If resume reports a [conversation-state error](#conversation-state-errors-404-409),** start a new conversation with `/new`. Do not rerun tools that already ran.
- **Expect small differences.** The rebuilt conversation [approximates](ARCHITECTURE.md#resuming-without-a-live-sdk-session) the original session.

### Pass Codex commands and options

Put launcher options before `--`, and Codex's own commands and options after it. The brackets mark optional parts; do not type them:

```text
./bin/codex-ghcp [launcher options] -- [Codex command/options] [prompt]
```

For example, to choose a model and make a non-interactive, read-only request:

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- exec --sandbox read-only \
  "Read README.md and summarize its purpose in one sentence."
```

| Input | Where it goes |
| --- | --- |
| Launcher options: `--ghcp-model`, `--bridge-port`, `--bridge-background` | Before `--` |
| Codex commands and options: `exec`, `resume`, `--sandbox`, `-c` | After `--` |
| Slash commands: `/model`, `/compact`, `/new`, `/quit` | Inside the running Codex session, not in the shell |

**Rejected options.** The launcher rejects Codex options that would replace the bridge's routing or need features it lacks:

- `--model`/`-m`: use `--ghcp-model` instead.
- `--profile`/`-p`, `--oss`, `--local-provider`, `--remote`, `--remote-auth-token-env` and `--search`.
- `-c` or `--enable` settings for the model, provider, model catalog, profiles, web search or the features the launcher turns off.

Other options are passed through for Codex to validate. Approval and sandbox options keep their normal meaning; accepting an option does not establish support for every requested feature. In particular, `exec --json` emits Codex's event log, not [schema-constrained model output](COMPATIBILITY.md#can-i-use-this-feature).

Outside a Git repository, add `--skip-git-repo-check` after `exec`; it skips only the Git check.

### Optional background bridge

By default each Codex process gets its own bridge. Use background mode only if you want one bridge to keep running after Codex exits and serve later sessions.

**Start or reuse it** by passing `--bridge-background` on **every** launch that should use it:

```bash
./bin/codex-ghcp --bridge-background --ghcp-model gpt-6-astra
```

A launch without the flag starts a separate foreground bridge and leaves the background bridge running.

**Check it** with `./bin/codex-ghcp-status`. It prints JSON about the background bridge only; foreground bridges are not listed.

| `state` | Meaning and action |
| --- | --- |
| `running` | The registered bridge responded and authenticated catalog access succeeded. This does not test a model response. |
| `stopped` | No background bridge is registered. A foreground bridge may still be running. |
| `stale` | The registered process has exited. The next background launch replaces the registry entry. |
| `unverified` | A process exists, but its identity or catalog access could not be confirmed. Read the reported `log` file; do not kill a PID based only on the registry. |

**Stop it** only after closing **every** Codex session that uses it, including sessions in other projects:

```bash
./bin/codex-ghcp-stop
```

Stopping discards the bridge's in-memory conversations and pending tool calls. Codex's saved history is kept, so you can [resume](#resume-a-conversation) later. Status and stop are this repository's commands, not Codex options.

The background registry is shared by all your working projects and belongs to the bridge checkout that started it; other checkouts are refused. To use a second checkout, give it its own `GHCP_DAEMON_DIR` and use **the same value for launch, status and stop**.

## Model selection and context

Only the [six supported model IDs](../README.md#models) are accepted. The launcher picks the starting model from `--ghcp-model`, then `GHCP_MODEL`, then `gpt-6-astra`. An unavailable model fails; the bridge never switches to another model on its own.

To see which models your account can use:

```bash
./bin/ghcp-models --json
```

Then start with one of them, for example:

```bash
./bin/codex-ghcp --ghcp-model claude-sonnet-5
```

**To switch during a session,** type `/model` inside Codex. The picker lists only the models your account can use, in the documented order; relaunch to refresh the list. A listed model can still lack some Codex features; see [compatibility](COMPATIBILITY.md).

In Codex 0.154.0 the picker labels mean:

| Label | Meaning |
| --- | --- |
| `(current)` | The model in use in this session. |
| `(default)` | The first picker entry: `claude-opus-5.5` when all six are available. It is **not** the launcher's default. |

**`/model` also saves `model` and `model_reasoning_effort` to `~/.codex/config.toml`.** What the next launch uses depends on how you start Codex:

- **This launcher** still chooses the model from `--ghcp-model`, then `GHCP_MODEL`, then `gpt-6-astra`.
- **The official CLI** (`command codex`, or `codex-original` from the [zsh integration](#optional-zsh-integration)) uses the saved selection. Reset it there if needed.

The launcher's temporary model list is deleted when Codex exits, even in background mode. That does not undo the saved selection; see [catalog implementation](ARCHITECTURE.md#modules).

### Context limits

- The bridge selects **`long_context` when the SDK advertises it, otherwise `default`**, including after model changes and recovery. The launcher rejects missing or invalid context budgets instead of using Codex fallback limits; an upstream tier rejection is not silently retried at another tier.
- Codex receives an **input budget** based on the advertised prompt/context limits, with output space reserved when a valid maximum output size is supplied. This budget is not necessarily the provider's total context window.
- Codex compacts the conversation automatically at **80%** of that budget. The SDK's own automatic compaction stays off. You can also run `/compact` between turns.
- Larger contexts can add latency, memory use and usage charges. Do not raise only Codex's `model_context_window` above the SDK budget.
- To pick up new catalog limits or changed settings, exit Codex normally and relaunch.

Implementation details: [tier selection and budget calculation](ARCHITECTURE.md#context-budgets).

## Settings

### What the launcher changes

On each launch, the launcher:

- points Codex at its bridge with `-c` arguments and passes a generated **local bridge token** through the Codex process environment. The token is not a GitHub or OpenAI credential;
- turns off Codex features the bridge does not support: WebSockets, request compression, hosted web search, remote compaction and reasoning summaries;
- starts Copilot sessions with the Copilot runtime's own MCP servers disabled, including user and plugin servers. Codex's MCP servers still work because Codex runs them itself; see [tool handoff](ARCHITECTURE.md#tool-handoff).

The launcher does **not** edit `~/.codex/config.toml`, `auth.json`, shell startup files or another project's server, and it does not copy your Copilot or GitHub login into Codex. Your other Codex settings still apply; this is not a fresh Codex profile. Codex and the SDK can still write session data, and Codex tools can change project files with your configured permissions. `/model` can save a selection to Codex's configuration, and the optional [zsh integration](#optional-zsh-integration) edits `~/.zshrc`; these are separate from the launcher's temporary routing settings.

### Launcher settings

All settings are optional. Set environment variables in your shell or put them before the command; the launcher does **not** read `.env`.

| What to change | Option or environment variable | Default |
| --- | --- | --- |
| Starting model | `--ghcp-model` (overrides `GHCP_MODEL`) | `gpt-6-astra` |
| Loopback port | `--bridge-port` (overrides `GHCP_BRIDGE_PORT`) | `0`: choose a free port |
| Official Codex executable | `CODEX_BIN` | `codex` on `PATH` |
| Existing Copilot login directory | `COPILOT_HOME` | `~/.copilot` |
| Background registry and log directory | `GHCP_DAEMON_DIR` | Per-user OS cache directory; use the same value for launch, status and stop |
| Timeouts, queue and size limits | [Timeouts and recovery](#timeouts-and-recovery) | See that table |

`PORT` applies only to [direct-server](#direct-server-advanced) runs. A background bridge keeps the settings it started with; to change them, [restart it](#restart-the-bridge-safely).

### Timeouts and recovery

Settings ending in `_MS` use **milliseconds**, `_BYTES` use **bytes**, and attempt/request limits are **counts**. Turn and request deadlines are not reset by recovery; cleanup has separate per-operation limits. A new value takes effect only after you [restart the bridge](#restart-the-bridge-safely).

| Setting | Default | What it limits |
| --- | --- | --- |
| `SDK_STARTUP_TIMEOUT_MS` | 30000 (30 seconds) | SDK start, readiness ping and catalog load, plus session creation and model changes. Session setup is also capped by the turn limit. |
| `TURN_FIRST_PROGRESS_TIMEOUT_MS` | 180000 (3 minutes) | Waiting for the model's first progress, per attempt. Turn-start metadata, retry notices and keepalives do not reset it. |
| `TURN_IDLE_TIMEOUT_MS` | 90000 (90 seconds) | Silence after progress begins. Text, reasoning, tool input and growing SDK or phase byte counts reset it. |
| `TURN_TIMEOUT_MS` | 300000 (5 minutes) | The whole model turn, including recovery attempts. |
| `REQUEST_TIMEOUT_MS` | 360000 (6 minutes) | The whole request, including queue wait, SDK work and recovery, but not receiving the HTTP body. |
| `TURN_IDLE_RECOVERY_ATTEMPTS` | 1 | Shared idle/transport session-recovery budget per request: 0–3; 0 disables these retries, not SDK connection/catalog recovery. |
| `MAX_REQUESTS_PER_SESSION` | 8 | Running plus queued requests per conversation. |
| `MAX_REQUESTS` | 128 | Running plus queued requests in total. |
| `SDK_READINESS_TIMEOUT_MS` | 2000 | Local SDK ping deadline. |
| `SDK_READINESS_INTERVAL_MS` | 15000 | Background connection-check interval. Turn-watchdog diagnostics use the minimum of this, the first-progress limit and the idle limit. |
| `SDK_RECOVERY_BACKOFF_MS` | 5000 | Minimum gap between failed connection-recovery attempts. |
| `CLEANUP_TIMEOUT_MS` | 5000 | Each owned SDK cleanup operation, such as abort, disconnect, delete or force-stop. |
| `MAX_REPLAY_BYTES`, `MAX_BODY_BYTES` | 33554432 (32 MiB) | Serialized history and HTTP request body size. These are memory safeguards, not model token limits. |

In this table, every value except `TURN_IDLE_RECOVERY_ATTEMPTS` must be a positive integer. The turn/request limits apply to one bridge Responses request, not an entire multi-tool Codex task. The request deadline includes queue wait and setup; the turn deadline starts after initial session setup. [`.env.example`](../.env.example) lists the remaining limits with their defaults.

**Automatic recovery.** If a model turn goes silent past its limit or ends with a confirmed pre-output transport failure, the bridge can replace the Copilot session and retry the turn on the same response stream. Both causes share **one attempt per request** by default; query errors without matching structured transport evidence are not retried.

- **When:** input was acknowledged, the current attempt has produced no assistant text/message, no tool calls are pending, and cleanup and readiness on the same client generation are confirmed. Transport-error recovery additionally requires no observed model progress in that attempt, including reasoning, tool-input or stream bytes.
- **What stays the same:** the original turn and request deadlines. Completed tool-result RPCs are never resubmitted; their contents may be included as history when rebuilding a session. This is not an exactly-once inference guarantee.
- **Cost:** a retry can use extra Copilot usage.
- **To disable session-recovery retries:** set `TURN_IDLE_RECOVERY_ATTEMPTS=0`. The launcher disables Codex's automatic HTTP and stream retries. Read-only SDK connection/catalog recovery and retries internal to the SDK/provider are separate.

See [recovery details](ARCHITECTURE.md#model-progress-and-recovery).

| Error code | HTTP | Meaning |
| --- | --- | --- |
| `copilot_idle_timeout` | 504 | No model progress within the first-progress or idle limit. The message names the `phase`. |
| `copilot_transport_error` | 502 | Structured model-transport failure; safe recovery was unavailable, blocked or exhausted. |
| `copilot_setup_timeout` | 504 | An SDK session-setup or model-setting operation exceeded its deadline. |
| `copilot_timeout` | 504 | The whole-turn limit expired, including any recovery. |
| `request_timeout` | 504 | The whole-request limit expired, including queue wait. |
| `request_queue_full` | 429 | Too many running and queued requests. Nothing was submitted. |
| `upstream_unavailable` | 503 | The SDK connection could not become ready; this connection-recovery path does not retry inference. |
| `upstream_session_lost` | 409 | The Copilot connection was lost. Start a new conversation. |

These HTTP statuses apply before streaming starts. An already-started SSE response keeps HTTP 200 and reports the error in `response.failed`. For timeout handling, see [slow or disconnected upstream](#slow-or-disconnected-upstream).

A startup `listModels` timeout can replace the SDK client once after confirmed cleanup, within the same `SDK_STARTUP_TIMEOUT_MS` budget (30 seconds by default). The first catalog attempt gets at most half that budget (15 seconds by default), also capped by the remaining startup time. Cleanup retains its separate bound. This read-only recovery makes no inference calls and does not retry authentication or arbitrary RPC errors.

### Restart the bridge safely

**A bridge keeps the code and settings it started with.** To apply edited source files or changed environment variables, restart it. Keep the terminal in your **original working project**. The paths below assume a clone at `$HOME/GitHub/openai-codex-ghcp-sdk`; adjust them if needed.

1. **In Codex:** let the current turn finish or cancel it, then type `/quit`. For a background bridge, close every Codex session that uses it.
2. **Background mode only:** run `"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp-stop"`. A default foreground bridge has already exited with Codex.
3. **From the same working project,** resume:

```bash
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" -- resume --last
```

If this repository is your working project, `./bin/codex-ghcp -- resume --last` does the same. The command starts a new foreground bridge; add `--bridge-background` before `--` to keep the new bridge running.

Never stop a bridge while a Codex session is using it: that discards its in-memory state, including tool calls still waiting for results. To see the settings a running bridge uses, check `/health.turnWatchdog` or the background status. They show the running values, not the current source defaults.

## Troubleshooting

Find your symptom below. For what the bridge supports at all, see [compatibility](COMPATIBILITY.md).

### Startup and configuration

| Symptom or message | What to do |
| --- | --- |
| `./bin/...`: file not found | Run from this repository's root, or use [the launcher's absolute path](#use-in-another-project) from your project. |
| Doctor shows `ok: false` or `supportedVersion: false` | Read the failing field. For an SDK mismatch, run `npm ci`; for a tool failure, install or fix the named CLI or Node version. Follow the [pinned setup](../README.md#quick-start). |
| `Cannot run Codex` or `requires Codex CLI 0.154.0 or newer` | Install the pinned CLI with `npm install -g @openai/codex@0.154.0`, or set `CODEX_BIN` to the official executable. |
| `Cannot list Copilot models` or another authentication error | Run `copilot login`, then `./bin/ghcp-models`. Never paste credentials into a prompt or source file. |
| `GitHub Copilot model is unavailable` or `Unsupported model` | Run `./bin/ghcp-models` and pass an ID that is neither `disabled` nor `not available` to `--ghcp-model`. If none qualify, check your Copilot entitlement and organization policy; there is no fallback model. |
| Codex rejects `--ghcp-model` as an unexpected argument | Put launcher options **before** `--`, for example `./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- resume --last`. |
| `conflicts with GHCP routing` or `conflicts with the GHCP bridge` | That Codex option would bypass the bridge ([rejected options](#pass-codex-commands-and-options)). Choose the model with `--ghcp-model`. Instead of a named `--profile`, pass individual settings after `--`, such as `-c 'model_reasoning_effort="low"'`. |
| `Reasoning effort ... is unavailable` | Choose a level the message lists, after `--`: `-c 'model_reasoning_effort="low"'`. Haiku 4.5 has no configurable effort; the bridge logs that instead of failing. |
| `--help` or `--version` started a bridge | Use `./bin/codex-ghcp --help` for launcher help, and `command codex --help` or `command codex --version` for the official CLI. Anything after `--` starts a bridge as usual. |
| `.env` changes have no effect | The launcher does not load `.env`. Set [environment variables](#launcher-settings) in your shell, then [restart the bridge](#restart-the-bridge-safely). |
| `Bridge files or settings changed` | A background bridge is still running older code or settings. Close all its Codex sessions, stop it, then launch again ([restart safely](#restart-the-bridge-safely)). |
| `This bridge belongs to another checkout` | Use the checkout that started it, or give this checkout its own `GHCP_DAEMON_DIR` for launch, status and stop. Do not delete another checkout's registry ([background mode](#optional-background-bridge)). |
| Port already in use | Let the launcher choose a free port (the default), or change `PORT` for a direct server. Do not stop another project's process. |

### During a conversation

| Symptom or code | What to do |
| --- | --- |
| HTTP 404 or 409, for example `unknown_tool_call` or `tool_result_mismatch` | The bridge lost or cannot continue this conversation's state. Start a new conversation with `/new`; see [what each code means](#conversation-state-errors-404-409). |
| `copilot_idle_timeout`, `copilot_timeout`, `copilot_transport_error`, `copilot_setup_timeout`, `upstream_unavailable`, `request_timeout` or `ETIMEDOUT` | Check network, proxy and service availability first, then see [slow or disconnected upstream](#slow-or-disconnected-upstream) and the [limits](#timeouts-and-recovery). A healthy local bridge does not prove the model service is available. |
| `request_queue_full` (429) | Too many requests are running or queued. Wait for running turns to finish, then send the prompt again. |
| `context_length_exceeded` | Codex compacts automatically, including in tool-heavy turns. If the error persists, run `/compact` between turns or start a shorter conversation. Raising a byte limit does not add model context. |
| `history_too_large` or `body_too_large` (413) | Start a shorter conversation, or raise `MAX_REPLAY_BYTES` or `MAX_BODY_BYTES` if you have memory to spare and [restart the bridge](#restart-the-bridge-safely). These limits do not add model context. |

### Conversation-state errors (404, 409)

These errors mean the bridge no longer has, or cannot safely continue, the conversation state that Codex sent. Common causes are a bridge restart, session expiry or a lost Copilot connection. **Start a new conversation with `/new`**, or exit and relaunch. Do not rerun completed tools or type a made-up tool result to get past the error.

| Code | What happened |
| --- | --- |
| `response_not_found` (404), `unknown_tool_call` | The bridge no longer knows the response or tool call; it probably restarted or the session expired. |
| `upstream_session_lost`, `history_invalidated` | The Copilot session was lost or changed independently. Pending work was not replayed. |
| `tool_result_mismatch`, `pending_tool_results`, `unresolved_tool_calls` | The tool results do not match the calls the bridge is waiting for: some are missing, duplicated or unknown. |
| `pending_session_changed`, `stale_response`, `session_mismatch` | The history or response ID does not match the bridge's latest state for this conversation. |

Changing the model, tools or instructions while tools are pending works when every pending result arrives together; see the [handoff rules](ARCHITECTURE.md#changing-configuration-with-completed-tools). If the error also happens in a new conversation, note its code and message.

### Feature limitations

| Symptom | What to do |
| --- | --- |
| The task-title request fails with HTTP 400 `Structured output is not supported` | Nothing; this is expected. Codex's optional automatic title needs structured output, so the conversation continues without a title. Other structured-output requests also fail rather than succeed. See [compatibility](COMPATIBILITY.md#rejected-or-disabled). |
| Unsupported input or transport | Keep the launcher defaults and send text only. A newer Codex release can introduce request forms the bridge does not support yet. |
| Custom tool parse error | The tool's grammar is guidance for the model, not enforced during generation. Check whether the tool already ran before retrying, or choose another supported model. The bridge never rewrites raw tool text. |

### Slow or disconnected upstream

1. **Check the network first.** For `ETIMEDOUT` or connection failures, check your network, proxy or VPN and the Copilot service before changing timeouts. `/health.ready` describes only the local SDK connection, not the remote model service.
2. **Read which limit expired.** A `copilot_idle_timeout` message names its phase: `phase: first_progress` (no progress yet) or `phase: streaming` (progress stopped). After an automatic recovery, it means the replacement session was also silent; that alone does not mean the bridge is stuck. A replacement session does not get a new turn budget.
3. **For slow workloads, opt in to longer limits.** Exit Codex normally and stop any background bridge first. Then run this from your original working project, adjusting the clone path:

```bash
TURN_FIRST_PROGRESS_TIMEOUT_MS=180000 TURN_IDLE_TIMEOUT_MS=180000 TURN_IDLE_RECOVERY_ATTEMPTS=2 \
TURN_TIMEOUT_MS=600000 REQUEST_TIMEOUT_MS=660000 \
"$HOME/GitHub/openai-codex-ghcp-sdk/bin/codex-ghcp" -- \
  -c 'model_reasoning_effort="low"' resume --last
```

These values allow three minutes both before and after first progress, up to two safe recoveries, a ten-minute turn and an eleven-minute request, and they lower the reasoning effort. They are not the defaults and cannot prevent disconnections; they can also increase waiting time and usage. Raise the turn and request limits together, not only the idle limit.

- Use `/compact` between completed turns to reduce latency in long conversations; a larger maximum context does not make a large conversation faster.
- Never treat keepalives as model progress or blindly rerun completed tools.
- **If a long test was running,** read its existing `.runtime` report before starting another run. Test runners save progress on their own; a chat failure does not mean the test stopped.

For test commands and the final recorded result, see the [testing guide map](../README.md#testing) and [verification result](validation/README.md). Failed cases and offline regressions stay separate from the live verdict.

## Direct server (advanced)

Use this only to run the HTTP bridge yourself; it does not start Codex, and normal launches already manage their own bridge. `npm run bridge` does not load `.env` either.

**1. Start the server** from the repository root with a new local token:

```bash
# Use an independently generated token, not your GitHub credential.
export BRIDGE_API_KEY="$(openssl rand -hex 32)"
HOST=127.0.0.1 PORT=4143 npm run bridge
```

Alternatively, copy [`.env.example`](../.env.example) to `.env`, replace its token placeholder and run `node --env-file=.env src/server.mjs`. The default direct-server port is `4143`. `HOST` accepts only `127.0.0.1`, `::1` or `localhost`.

**2. Check it** from a second terminal:

```bash
curl --fail --silent --show-error http://127.0.0.1:4143/health
```

HTTP 200 shows that the local server is alive, not that the model service is available.

**3. Stop it** with `Ctrl+C` in its terminal after closing any clients.

| Route | Token | Purpose |
| --- | --- | --- |
| `GET /health` | Not required | HTTP liveness, last-known SDK readiness and instance information |
| `GET /readyz` | Required | Bounded SDK readiness probe; not a model-service health guarantee |
| `GET /v1/models` | Required | Model IDs this account may use |
| `POST /v1/responses` | Required | Text and tool requests, answered as SSE or JSON |

Send the token as `Authorization: Bearer <bridge-token>` or in the `x-api-key` header.

## Optional zsh integration

Use this only if you want `codex` to run the GHCP launcher from any directory. `codex-original` will still run the official CLI directly. The launch examples above need no shell changes.

**1. Back up** your current settings:

```zsh
if [[ -f ~/.zshrc ]]; then
  cp -p ~/.zshrc ~/.zshrc.codex-ghcp.bak.$(date +%Y%m%d-%H%M%S)
fi
```

**2. Add this block once** to `~/.zshrc`. Adjust the launcher path if your clone is elsewhere. Keep your existing `PATH` and other settings, and first remove or rename any existing `codex` or `codex-original` alias or function.

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

**3. Activate and check it** in a new terminal, or in the current one:

```zsh
source ~/.zshrc
whence -v codex codex-original
codex --help               # Launcher help; no bridge started
codex-original --version   # Official CLI version; no bridge started
```

Now `codex` starts a default launch, and `codex --ghcp-model gpt-6-sol` chooses a model. For the official CLI's help or version, use `codex-original --help` or `codex-original --version`, not `codex --version`.

`whence -p` finds the official executable while ignoring functions and aliases. Keep that executable on `PATH`, and do not add a `codex` shim that points back to this launcher. `CODEX_BIN` applies only to that invocation, and shells that do not load this block are unchanged.

**Undo:** remove only the marked block, then open a new terminal or run `unfunction codex codex-original` in the current one. Restoring the whole backup would also discard unrelated edits made since the backup.
