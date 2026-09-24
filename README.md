# OpenAI Codex × GitHub Copilot SDK

[한국어](README_KO.md) · [Usage and troubleshooting](docs/USAGE.md) · [Compatibility](docs/COMPATIBILITY.md) · [Verification records](docs/validation/README.md) · [Architecture](docs/ARCHITECTURE.md)

Run the official **Codex CLI** with models available through your **GitHub Copilot** account.

```text
Codex → local HTTP/SSE bridge → GitHub Copilot SDK → selected Copilot model
```

Codex still executes tools and enforces approvals and sandboxing. The bridge translates requests and responses; it does not execute shell or file tools. This is an **unofficial interoperability project**, not a vendor-supported Codex/Copilot integration. Prompts and tool output go to GitHub Copilot, and your account's usage limits and charges apply.

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

The version should be `codex-cli 0.154.0`. The launcher accepts newer releases, but this guide and recorded checks target **0.154.0**. The SDK is pinned to **1.0.14**; upgrades may require protocol changes.

### 3. Check installation and account access

```bash
./bin/ghcp-doctor
./bin/ghcp-models
```

The doctor should report every tool's `ok` and Codex's `supportedVersion` as `true`. It **does not check login**. The model command checks Copilot catalog access without sending a model prompt; confirm `gpt-6-astra` is neither `disabled` nor `not available`. If a check fails, use [troubleshooting](docs/USAGE.md#boundaries-and-troubleshooting) before continuing.

### 4. Start Codex

```bash
./bin/codex-ghcp
```

If Astra is unavailable, select an available model instead, for example `./bin/codex-ghcp --ghcp-model claude-sonnet-5`.

**Ready when:** Codex opens and answers your first prompt. For example, send `Reply with OK.`; this consumes Copilot usage. Type `/quit` to exit.

The launcher starts a bridge on a free loopback port, waits for readiness, runs Codex, and removes its bridge when Codex exits. **No `.env` file or shell configuration is required.** To work on a different repository, use [the launcher from that project](docs/USAGE.md#run-codex).

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

**Launcher options go before `--`; Codex commands and options go after it.** For example, `./bin/codex-ghcp --ghcp-model claude-sonnet-5 -- resume --last` resumes with Sonnet. Use `--ghcp-model`, not native `--model`/`-m`; provider and transport overrides are rejected. Outside a Git repository, `exec --skip-git-repo-check` skips only the Git-directory check, not the sandbox.

From another project, call this launcher's absolute path; it preserves your working directory. To use just `codex` from any directory, follow the **optional** [zsh setup and undo instructions](docs/USAGE.md#optional-zsh-integration). For a reusable background bridge, see [start/status/stop](docs/USAGE.md#optional-background-bridge).

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

- Supports text and Codex-executed function/custom tools, including native `apply_patch` and Codex MCP tools. Custom-tool grammar is guidance, not decoder enforcement.
- Does not support image/audio/video/file attachments as model input, provider-hosted tools, structured JSON output, WebSockets or remote Responses compaction. **Reading and editing local files through Codex tools still works.** Codex's optional task-title request is rejected; the conversation can continue without a generated title.
- Bridge conversation state is in memory. Close Codex sessions before stopping a background bridge; a restart loses pending calls. The launcher does not bypass approvals or sandboxing.

Read the [full compatibility boundaries](docs/COMPATIBILITY.md) before relying on advanced features. A model listing or passing TUI run does not certify all Codex features. [Recorded live runs](docs/validation/README.md) include unresolved upstream-filter failures; results from different contracts are not combined.

## Testing

Testing is **not required to use the launcher**. For measured results instead of commands, read the [recorded results and remaining gaps](docs/validation/README.md#recorded-results).

### Local development checks

After `npm ci`, choose the check that matches your change. These commands make **no model calls** and need **no Codex installation or Copilot login**.

| Change / goal | Command | Checks |
| --- | --- | --- |
| Documentation only | `npm run test:docs` | Local links and sections, npm examples and EN/KO parity, Bash/sh syntax and generated scenarios |
| Code or pre-PR check | `npm run test:ci` | Units, source coverage, scenario design and documentation |
| Unit/controller checks only | `npm test` | Unit suite without the coverage report |

`test:docs` parses examples; it does not run their install, server or live-test commands, or check external URLs. `coverage/lcov.info` measures observed source coverage, not product-feature support.

<details>
<summary>Broader offline check: real Codex, PTY and Chromium</summary>

Install Node 22.12+, Codex 0.154.0 and Python 3, then run:

```bash
npx --no-install playwright install chromium
env -u GHCP_LIVE_HANDOFF_OUTPUT npm run test:runtime
```

These suites drive real Codex/PTY/browser, workflow and stability paths with SDK doubles; no Copilot login is needed. `env -u` removes the live-handoff opt-in for this invocation, so an inherited `GHCP_LIVE_HANDOFF_OUTPUT` cannot enable model calls. CI runs these offline suites separately from unit coverage on Linux/macOS.

</details>

### Optional live checks

Choose **one** guide below; the rows are not a setup sequence. The plan commands describe the checks without running them and need only project dependencies. **Live `--execute` commands and soak `--smoke` runs consume Copilot usage.** The pass criteria are requirements, not achieved results:

| Goal and live pass criterion | Plan command (no model calls) | Guide |
| --- | --- | --- |
| Development workflows: **108/108** (18 × 6 models) | `npm run test:compatibility -- --plan` | [Run and interpret compatibility](docs/COMPATIBILITY_TESTING.md) · [Scenario reference](docs/NATIVE_SCENARIOS.md) |
| Bridge faults and recovery: **66/66** (11 × 6 models) | `npm run test:stability -- --plan` | [Stability](docs/STABILITY_TESTING.md) |
| Real interactive TUI: **69/72** target; **72/72** full pass | `npm run test:tui -- --plan` | [TUI scenarios](docs/TUI_SCENARIOS.md) |
| PTY/browser: declared workload completed without observed failures | `npm run test:terminal -- --plan` | [Terminal checks](docs/SOAK_TESTING.md#reproducible-terminal-checks) |
| Endurance: every lane ≥5 hours without observed failures | `npm run test:soak -- --plan` | [Endurance](docs/SOAK_TESTING.md#five-hour-live-run) |
| Opus filtering: diagnostic evidence, not a compatibility verdict | `npm run diagnose:opus` | [Diagnostics](docs/OPUS_DIAGNOSTICS.md) |

For saved reports, [evidence integrity and test success are separate](docs/validation/README.md#read-a-result). Published summaries are not complete `.runtime` evidence bundles.

**Editing scenario docs:** change [the template](scripts/compatibility/documentation.mjs) or [catalog](scripts/compatibility/catalog.mjs), run `npm run docs:scenarios`, then `npm run test:docs`. Do not edit generated files directly. `npm run docs:scenarios:check` checks generated content only, not the rest of the guides.

## Contributors and references

Maintained by [junwoojeong100](https://github.com/junwoojeong100), with AI-assisted implementation, testing and documentation contributions from [Codex](https://github.com/codex) and [GitHub Copilot](https://github.com/Copilot).

- [Official Codex CLI](https://github.com/openai/codex)
- [Codex advanced configuration](https://developers.openai.com/codex/config-advanced/)
- [Official GitHub Copilot SDK](https://github.com/github/copilot-sdk)
