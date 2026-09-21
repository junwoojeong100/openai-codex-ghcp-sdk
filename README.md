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
codex --ghcp-model gpt-5.6-sol
codex -- exec --skip-git-repo-check --sandbox read-only \
  "Read README.md and summarize its purpose in one sentence."
codex-original --help       # Official CLI help, bypassing GHCP
```

The default remains `gpt-6-astra`. Use `--ghcp-model` to select a Copilot model; the GHCP launcher rejects native `--model`/`-m` overrides. Other Codex arguments follow `--`. For a native version check, use `codex-original --version`, not `codex --version`.

`whence -p` ignores shell functions and aliases and finds the executable on PATH each time, so there is no pinned nvm version path or recursion through the `codex` function. Keep the official `codex` executable on PATH; do not add a separate `codex` shim that points back to this launcher. `CODEX_BIN` is set only for the launcher invocation; arguments, working directory and exit status are preserved. Shells or programs that do not load this block still resolve the official executable. `./bin/codex-ghcp` remains available without shell integration.

To undo, remove only the marked block from `~/.zshrc`, then open a new terminal or run `unfunction codex codex-original` in the current one. Restoring the entire backup also discards any unrelated shell edits made since that backup.

## Choose a model

Only these seven Copilot catalog IDs are supported:

| Family | Model IDs |
| --- | --- |
| GPT | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra` |
| Claude | `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4.5` |

The default is **`gpt-6-astra`**. Availability is checked against your account's catalog and policy; an unavailable model fails rather than silently switching to another one.

```bash
./bin/ghcp-models --json
./bin/codex-ghcp --ghcp-model gpt-5.6-terra
./bin/codex-ghcp --ghcp-model claude-sonnet-5
```

A catalog entry is not a guarantee that every Codex feature works with that model. `/v1/models` returns both OpenAI-style IDs and Codex catalog metadata, using the account's SDK model information. Use `--ghcp-model` for a reproducible launch; interactive `/model` menu behavior has not been verified.

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
| History too large | Start a shorter conversation or explicitly raise `MAX_REPLAY_BYTES` with awareness of memory/context limits. |
| Unsupported input or transport | Use the launcher defaults and text-only requests. Upgrading Codex can introduce new request forms. |
| Custom tool parse error | Grammar is advisory through the SDK, not native constrained decoding. Try again or choose another allowed model; raw tool text is never silently rewritten. |

Both the serialized conversation-history limit (`MAX_REPLAY_BYTES`) and HTTP request-body limit (`MAX_BODY_BYTES`) default to **33,554,432 bytes (32 MiB)**. These are operational starting points, not benchmarked capacity guarantees or model context-window limits; very large conversations can still exceed available memory or the upstream model's context. Override either limit with a positive integer environment variable when needed, and restart the bridge to apply changes. The launcher does not automatically load `.env`. Stop a background bridge only after closing its Codex sessions, because restarting discards its in-memory conversation state.

## Local checks and integrated compatibility

```bash
npm test                              # Unit/controller checks, no model calls
npm run test:scenarios                 # 18 versioned scenario contracts
npm run docs:scenarios:check           # Generated document consistency
npm run test:compatibility -- --plan   # Offline execution plan
npm run test:compatibility:runtime     # Real Codex + SDK double, no model calls
```

The scenarios and runner have been expanded. Existing run results remain historical records of their original contract.
**18 scenarios × seven GHCP models = 126 cases**, with no reference-provider run, fast suite or model subset.
Up to four model lanes, individual deadlines and continuation after failure keep the run short. One hour is a target, not an overall cutoff.

Live execution requires Copilot authentication and consumes usage. No OpenAI API key is required.

```bash
npm run test:compatibility -- --execute
npm run test:compatibility -- --verify .runtime/compatibility-<run-id>/report.json
```

See [integrated scenarios and coverage](docs/NATIVE_SCENARIOS.md) and the [runner/evidence guide](docs/COMPATIBILITY_TESTING.md).
**90% is an everyday-workflow coverage target, not a measured product-feature support rate.** The reviewer-defined 20-group checklist has a **75% design score**, not a live support rate.

## Bridge stability and recovery checks

The separate `codex-ghcp-stability-11-v3` contract has **11 scenarios × 7 models = 77 cases**. It exercises tool reordering, pending-policy rejection, HTTP duplication/cancellation, SDK loss, stream mismatch, resume and compaction through real Codex. Fault injections and actual model results are distinguished. See the [scope, acceptance, settings and commands](docs/STABILITY_TESTING.md).

```bash
npm run test:stability:stress
npm run test:stability:runtime
npm run test:stability -- --plan
npm run test:stability -- --execute  # Consumes Copilot usage
```

[Fresh 77-cell live verification](docs/validation/2026-09-21-stability-rerun/README.md): **66 passed (85.7%), 11 failed**, 0 not run. New evidence integrity was verified without changed criteria or selective retries.

Previous verification data and reports were removed from the working tree at the user’s request. Only the [new verification records](docs/validation/README.md) are evidence for the current run. Old results are not reused as new scores; this is not hours-long or whole-product certification.

## References

- [Official Codex CLI](https://github.com/openai/codex)
- [Codex advanced configuration](https://developers.openai.com/codex/config-advanced/)
- [Official GitHub Copilot SDK](https://github.com/github/copilot-sdk)
