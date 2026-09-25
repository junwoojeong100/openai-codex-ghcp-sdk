# OpenAI Codex × GitHub Copilot SDK

[한국어](README_KO.md)

Run the official **Codex CLI** with models available through your **GitHub Copilot** account.

```text
Codex → local HTTP/SSE bridge → GitHub Copilot SDK → selected Copilot model
```

The **bridge** is a local server that translates requests and responses between Codex and Copilot. Codex still executes shell and file tools and enforces approvals and sandboxing.

This is an **unofficial integration**, not a vendor-supported Codex/Copilot combination. Prompts and tool output go to GitHub Copilot; running the bridge locally does not make model inference local. Your account's usage limits and charges apply.

**Current assessment:** [implementation status and latest verification](docs/STATUS.md). The essential integration result is separate from unsupported or untested capabilities.

**v0.1.0:** [release notes](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/releases/tag/v0.1.0). The retained 36/36 live result predates the final tool-limit and shutdown fixes; it is not a live verification of this release.

| I want to | Start here |
| --- | --- |
| Install and try it | [Requirements](#requirements), then [Quick start](#quick-start) |
| Work in my own repository | [Use in another project](docs/USAGE.md#use-in-another-project) |
| Fix a launch or conversation error | [Troubleshooting](docs/USAGE.md#troubleshooting) |
| Check whether a feature works | [Supported features and limits](docs/COMPATIBILITY.md#can-i-use-this-feature) |
| Develop or evaluate the bridge | [Implementation status](docs/STATUS.md) · [Testing commands](#testing) · [Recorded results](docs/validation/README.md) |
| Understand the implementation | [Architecture](docs/ARCHITECTURE.md) |

## Requirements

- Node.js **22.12 or newer** (recommended, and required for the runtime test suites), npm, Git and Bash. The launcher also accepts Node **20.19+ in the 20.x line**. The examples use Bash/zsh; the CI workflow targets Linux and macOS. The [recorded live run](docs/validation/README.md) used macOS/arm64 and Node 22.16.0.
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

The last command should print `codex-cli 0.154.0`. The launcher accepts newer versions, but they are **not covered by the recorded checks**. Use **0.154.0** for the setup described here.

### 3. Check installation and account access

```bash
./bin/ghcp-doctor
./bin/ghcp-models
```

| Check | What to look for | What it does not prove |
| --- | --- | --- |
| `ghcp-doctor` | In its JSON output, every `ok` and Codex's `supportedVersion` is `true` | Login or model access. `supportedVersion` checks only the minimum CLI version, not full compatibility. |
| `ghcp-models` | Your chosen model is neither `disabled` nor `not available` | A successful model response. This command lists the account catalog without sending a prompt. |

Model lines contain the ID, name and status, for example `gpt-6-astra  GPT-6 Astra  enabled`. Step 4 uses `gpt-6-astra` unless you select another available model.

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

**Launcher options go before `--`; Codex commands and options go after it.** Choose a model with `--ghcp-model`, not Codex's `--model`/`-m`. A resumed conversation also uses the launcher's model selection, not the last `/model` choice; see [resume a conversation](docs/USAGE.md#resume-a-conversation) and [command layout](docs/USAGE.md#pass-codex-commands-and-options).

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
- **Pending calls are memory-only:** stop the bridge only after closing its Codex sessions. Codex's saved history can be [resumed](docs/USAGE.md#resume-a-conversation), but a restarted bridge cannot restore unresolved tool calls or old response IDs.

Before relying on advanced features, check the [full compatibility boundaries](docs/COMPATIBILITY.md). The [current live result and recordings](docs/validation/README.md) distinguish verified behavior from unsupported or untested capabilities.

## Testing

You do **not** need tests to use the launcher. There is **one live verification**: six essential scenarios on all six models, with one **36/36** pass rule.

```bash
npm run verify -- --execute
```

This consumes Copilot usage and automatically saves and rechecks its evidence. Read the reported `report.md` path. No profile choice, separate matrix or manual verification step is needed. Prerequisites and the six scenarios are in the [verification guide](docs/VERIFICATION.md); measured outcomes are in [current results](docs/validation/README.md).

For development, `npm test` runs unit, safety and documentation regressions without model calls. `npm run test:runtime` additionally uses real Codex/PTY/Chromium with SDK doubles, also without model calls. The CI workflow configures these as separate jobs; it does not run the live matrix. `npm run test:docs` is the documentation-only shortcut; `npm run test:ci` includes source coverage.

Only the essential v1 suite and its latest result and media are retained. Full raw evidence is local and Git-ignored; a fresh clone contains the published summary and media, not the complete run.

## Contributors and references

This project is licensed under the [MIT License](LICENSE). Dependencies retain their own licenses.

Maintained by [junwoojeong100](https://github.com/junwoojeong100), with AI-assisted implementation, testing and documentation contributions from [Codex](https://github.com/codex) and [GitHub Copilot](https://github.com/Copilot).

- [Official Codex CLI](https://github.com/openai/codex)
- [Codex advanced configuration](https://developers.openai.com/codex/config-advanced/)
- [Official GitHub Copilot SDK](https://github.com/github/copilot-sdk)
