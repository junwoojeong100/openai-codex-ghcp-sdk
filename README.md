# OpenAI Codex × GitHub Copilot SDK

[한국어](README_KO.md)

Run the official **Codex CLI** with models available through your **GitHub Copilot** account.

```text
Codex → local HTTP/SSE bridge → GitHub Copilot SDK → selected Copilot model
```

The **bridge** is a local server that translates requests and responses between Codex and Copilot. Codex still executes shell and file tools and enforces approvals and sandboxing.

This is an **unofficial integration**, not a vendor-supported Codex/Copilot combination. Prompts and tool output go to GitHub Copilot; running the bridge locally does not make model inference local. Your account's usage limits and charges apply.

| I want to | Start here |
| --- | --- |
| Install and try it | [Requirements](#requirements), then [Quick start](#quick-start) |
| Work in my own repository | [Use in another project](docs/USAGE.md#use-in-another-project) |
| Fix a launch or conversation error | [Troubleshooting](docs/USAGE.md#troubleshooting) |
| Check whether a feature works | [Supported features and limits](docs/COMPATIBILITY.md#can-i-use-this-feature) |
| Develop or evaluate the bridge | [Testing commands](#testing) · [Recorded results](docs/validation/README.md) |
| Understand the implementation | [Architecture](docs/ARCHITECTURE.md) |

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`, npm, Git and Bash. The examples use Bash/zsh; CI covers Linux and macOS.
- [Copilot CLI](https://github.com/github/copilot-cli) installed and authenticated: check `copilot --version`, then use `copilot login` if needed.
- A GitHub Copilot account with access to the desired model.
- Official Codex CLI **0.154.0**; installation is shown below.

The bridge uses your existing Copilot login. **No OpenAI API key or copied GitHub token is needed.** `COPILOT_HOME` selects an existing Copilot home; the default is `~/.copilot`.

## Quick start

### 1. Get the repository

Already cloned it? Open that repository and continue at step 2.

```bash
git clone https://github.com/junwoojeong100/openai-codex-ghcp-sdk.git
cd openai-codex-ghcp-sdk
```

### 2. Install dependencies

Run from the repository root. Skip the global install if Codex 0.154.0 is already installed.

```bash
npm install -g @openai/codex@0.154.0
npm ci
command codex --version
```

The last command should print `codex-cli 0.154.0`. Newer Codex releases also start, but this guide and the recorded checks use **0.154.0**.

### 3. Check installation and account access

```bash
./bin/ghcp-doctor
./bin/ghcp-models
```

- **`ghcp-doctor`** prints your installation as JSON. Every `ok` and Codex's `supportedVersion` should be `true`. It does not check login.
- **`ghcp-models`** shows each supported model's status on your Copilot account without sending a prompt. Each line is the ID, name and status, for example `gpt-6-astra  GPT-6 Astra  enabled`. Pick a model whose status is not `disabled` or `not available`; step 4 uses `gpt-6-astra` unless you choose another.

If either check fails, see [startup troubleshooting](docs/USAGE.md#startup-and-configuration).

### 4. Start Codex

```bash
./bin/codex-ghcp
```

To start with another model, add `--ghcp-model`, for example `./bin/codex-ghcp --ghcp-model claude-sonnet-5`.

**Ready when:** Codex opens and answers your first prompt. For example, send `Reply with OK.`; this consumes Copilot usage. Type `/quit` to exit.

The launcher starts a bridge on a free loopback port, waits for readiness, runs Codex, and removes its bridge when Codex exits. **Setup is complete; no `.env` file or shell configuration is required.** To work on a different repository, use [the launcher from that project](docs/USAGE.md#use-in-another-project).

## Everyday use

| Task | Command |
| --- | --- |
| Choose an initial model | `./bin/codex-ghcp --ghcp-model claude-sonnet-5` |
| Resume the latest conversation in this directory | `./bin/codex-ghcp -- resume --last` |
| Show launcher help without starting a bridge | `./bin/codex-ghcp --help` |
| Show official Codex options without a bridge | `command codex --help` |
| Check the official CLI version without the bridge | `command codex --version` |

For a non-interactive, read-only request:

```bash
./bin/codex-ghcp -- exec --sandbox read-only \
  "Read README.md and summarize its purpose in one sentence."
```

**Launcher options go before `--`; Codex commands and options go after it.** For example, `./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- resume --last` resumes with Sonnet. To choose a model, use `--ghcp-model`; Codex's own `--model`/`-m` is rejected. See [where each option goes](docs/USAGE.md#pass-codex-commands-and-options).

Optional: [make `codex` run this launcher from any directory](docs/USAGE.md#optional-zsh-integration) (zsh, with undo steps), or [keep a background bridge](docs/USAGE.md#optional-background-bridge).

## Models

These six IDs are supported, in picker order. Your account and organization policy determine which are available.

| Display name | Model ID |
| --- | --- |
| Claude Opus 5.5 | `claude-opus-5.5` |
| Claude Sonnet 5 | `claude-sonnet-5` |
| Claude Haiku 4.5 | `claude-haiku-4.5` |
| GPT-6 Astra | `gpt-6-astra` |
| GPT-6 Sol | `gpt-6-sol` |
| GPT-6 Luna | `gpt-6-luna` |

Initial selection is `--ghcp-model`, then `GHCP_MODEL`, otherwise **`gpt-6-astra`**. An unavailable or unsupported ID fails; there is no fallback model. Use `./bin/ghcp-models --json` to inspect your account's catalog.

`/model` switches the running session. Its `(default)` picker label is not the launcher's default, and Codex can save the selection in `~/.codex/config.toml`. See [picker behavior, context budgets and compaction](docs/USAGE.md#model-selection-and-context).

## Limits to know before use

- **Works:** text chat and the tools Codex runs itself: shell commands, reading and editing local files, native `apply_patch` and Codex MCP tools. Codex keeps its approvals and sandbox.
- **Not supported:** images, audio, video or files attached as model input; provider-hosted tools such as web search; schema-constrained JSON output; WebSockets; remote Responses compaction. Codex's automatic task title needs structured output, so that request is rejected and the conversation continues without a title.
- **Approximate:** custom-tool grammars, such as `apply_patch`'s, reach the model as guidance; generation does not enforce them.
- **Memory only:** the bridge keeps conversation state in memory. Stopping or restarting it loses pending tool calls, so close Codex sessions first.

Before relying on advanced features, check the [full compatibility boundaries](docs/COMPATIBILITY.md). [Recorded live runs](docs/validation/README.md) show what has been measured, including unresolved upstream-filter failures.

## Testing

You do **not** need to run tests to use the launcher. For results that were already measured, see the [recorded results and remaining gaps](docs/validation/README.md#recorded-results).

### Local development checks

After `npm ci`, choose the check that matches your change. These commands make **no model calls** and need **no Codex installation or Copilot login**.

| Change / goal | Command | Checks |
| --- | --- | --- |
| Documentation only | `npm run test:docs` | Local links and sections, npm examples and EN/KO parity, Bash/sh syntax and generated scenarios |
| Code or pre-PR check | `npm run test:ci` | Units, source coverage, scenario design and documentation |
| Unit/controller checks only | `npm test` | Unit suite without the coverage report |

`test:docs` checks the examples without running them and does not visit external URLs. `coverage/lcov.info` shows which source lines ran, not which product features are supported.

<details>
<summary>Broader offline check: real Codex, PTY and Chromium</summary>

Install Node 22.12+, Codex 0.154.0 and Python 3, then run:

```bash
npx --no-install playwright install chromium
env -u GHCP_LIVE_HANDOFF_OUTPUT npm run test:runtime
```

These suites run real Codex, a PTY and a browser against **SDK doubles**: local stand-ins for the Copilot SDK that make no model calls, so no Copilot login is needed. `env -u GHCP_LIVE_HANDOFF_OUTPUT` ensures an exported live-mode variable cannot turn on model calls. CI runs these suites on Linux and macOS, separately from unit coverage.

</details>

### Optional live checks

Each suite is independent; none has to run before another. A plan command only prints what the suite would check. **Live runs (`--execute`, and soak `--smoke`) call real models and consume Copilot usage.**

| Suite | What it checks | Plan command (no model calls) | Live pass criterion |
| --- | --- | --- | --- |
| [Workflow compatibility](docs/COMPATIBILITY_TESTING.md) | 18 development workflows on each of the six models | `npm run test:compatibility -- --plan` | **108/108** cases pass |
| [Stability](docs/STABILITY_TESTING.md) | 11 bridge fault and recovery scenarios per model | `npm run test:stability -- --plan` | **66/66** cases pass |
| [TUI](docs/TUI_SCENARIOS.md) | 12 interactive terminal scenarios per model | `npm run test:tui -- --plan` | **72/72** cases pass (**69/72** meets only the 95% target) |
| [Terminal](docs/SOAK_TESTING.md#reproducible-terminal-checks) | One model under a timed PTY or browser workload | `npm run test:terminal -- --plan` | The workload completes with no observed failure |
| [Endurance](docs/SOAK_TESTING.md#five-hour-live-run) | Long-running conversations | `npm run test:soak -- --plan` | Every lane (monitored conversation) runs ≥5 hours with no observed failure |
| [Opus diagnostics](docs/OPUS_DIAGNOSTICS.md) | Evidence about Opus upstream filtering | `npm run diagnose:opus` | None; it collects evidence, not a compatibility verdict |

To read a saved report, see [how to read a result](docs/validation/README.md#read-a-result). The workflow suite's cases are listed in the [scenario reference](docs/NATIVE_SCENARIOS.md).

**Editing scenario docs:** change [the template](scripts/compatibility/documentation.mjs) or [catalog](scripts/compatibility/catalog.mjs), run `npm run docs:scenarios`, then `npm run test:docs`. Do not edit generated files directly. `npm run docs:scenarios:check` checks generated content only, not the rest of the guides.

## Contributors and references

Maintained by [junwoojeong100](https://github.com/junwoojeong100), with AI-assisted implementation, testing and documentation contributions from [Codex](https://github.com/codex) and [GitHub Copilot](https://github.com/Copilot).

- [Official Codex CLI](https://github.com/openai/codex)
- [Codex advanced configuration](https://developers.openai.com/codex/config-advanced/)
- [Official GitHub Copilot SDK](https://github.com/github/copilot-sdk)
