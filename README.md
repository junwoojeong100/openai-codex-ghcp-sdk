# OpenAI Codex × GitHub Copilot SDK

[한국어](README_KO.md) · [Usage and troubleshooting](docs/USAGE.md) · [Compatibility](docs/COMPATIBILITY.md) · [Architecture](docs/ARCHITECTURE.md)

Run the official **Codex CLI** with models available through your **GitHub Copilot** account.

```text
Codex → local HTTP/SSE bridge → GitHub Copilot SDK → selected Copilot model
```

Codex still executes tools and enforces approvals and sandboxing. The bridge translates requests and responses; it does not execute shell or file tools. This is an **unofficial interoperability project**, not a vendor-supported Codex/Copilot integration. Prompts and tool output go to GitHub Copilot, and your account's usage limits and charges apply.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`, npm and Bash.
- Copilot CLI installed and authenticated: check `copilot --version`, then use `copilot login` if needed.
- A GitHub Copilot account with access to the desired model.
- Official Codex CLI **0.154.0**; installation is shown below.

The bridge uses your existing Copilot login. **No OpenAI API key or copied GitHub token is needed.** `COPILOT_HOME` selects an existing Copilot home; the default is `~/.copilot`.

## Quick start

Run from the cloned repository root. Skip the global install if Codex 0.154.0 is already installed.

```bash
npm install -g @openai/codex@0.154.0
npm ci
command codex --version
./bin/ghcp-doctor
./bin/ghcp-models
```

Resolve any doctor errors, then start Codex:

```bash
./bin/codex-ghcp
```

The launcher starts a bridge on a free loopback port, waits for readiness, runs Codex, and removes its bridge when Codex exits. **No `.env` file or shell configuration is required.** The default model is `gpt-6-astra`; choose another available model with `--ghcp-model`.

Dependencies are pinned to `@github/copilot-sdk@1.0.14` and `proper-lockfile@4.1.2` in this project. Upgrading Codex or the SDK may require protocol changes.

## Everyday use

| Task | Command |
| --- | --- |
| Choose an initial model | `./bin/codex-ghcp --ghcp-model claude-sonnet-5` |
| Resume the latest conversation in this directory | `./bin/codex-ghcp -- resume --last` |
| Show launcher help without starting a bridge | `./bin/codex-ghcp --help` |
| Check the official CLI version without the bridge | `command codex --version` |

For a non-interactive, read-only request:

```bash
./bin/codex-ghcp -- exec --sandbox read-only \
  "Read README.md and summarize its purpose in one sentence."
```

Put ordinary Codex arguments after `--`. Use **`--ghcp-model`**, not native `--model`/`-m`; provider and transport overrides are rejected. Outside a Git repository, `exec --skip-git-repo-check` skips only the Git-directory check, not the sandbox.

From another project, call this launcher's absolute path; it preserves your working directory. To use just `codex` from any directory, follow the **optional** [zsh setup and undo instructions](docs/USAGE.md#optional-zsh-integration). For a reusable background bridge, see [start/status/stop](docs/USAGE.md#run-codex).

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
- Does not support image/audio/video/file inputs, provider-hosted tools, structured JSON output, WebSockets or remote Responses compaction. Codex's optional task-title request is rejected; the conversation can continue without a generated title.
- Bridge conversation state is in memory. Close Codex sessions before stopping a background bridge; a restart loses pending calls. The launcher does not bypass approvals or sandboxing.

Read the [full compatibility boundaries](docs/COMPATIBILITY.md) before relying on advanced features. A model listing or passing TUI run does not certify all Codex features. [Recorded live runs](docs/validation/README.md) include unresolved upstream-filter failures; results from different contracts are not combined.

## Testing

For unit checks, source coverage and scenario/document consistency, with **no model calls**:

```bash
npm run test:ci
```

Use `npm test` for unit/controller checks only, or `npm run docs:scenarios:check` for generated-document consistency. `coverage/lcov.info` measures observed source coverage, not product-feature support.

`npm run test:runtime` runs the Codex/PTY/browser, workflow and stability suites with SDK doubles by default. It needs Node 22.12+, Codex 0.154.0, Python 3 and Chromium installed with `npx --no-install playwright install chromium`. **Leave `GHCP_LIVE_HANDOFF_OUTPUT` unset for offline checks**; setting it opts the handoff suite into real-model calls. CI runs the offline suites separately from unit coverage on Linux/macOS.

Choose the guide matching what you want to measure. **The plan commands below make no model calls. Live `--execute` commands and soak `--smoke` runs consume Copilot usage.** Each guide separates those steps and explains its own pass criteria.

| Goal | Plan command | Guide |
| --- | --- | --- |
| Development workflows: 18 × 6 models | `npm run test:compatibility -- --plan` | [Run and interpret compatibility](docs/COMPATIBILITY_TESTING.md) · [Scenario reference](docs/NATIVE_SCENARIOS.md) |
| Bridge faults and recovery: 11 × 6 models | `npm run test:stability -- --plan` | [Stability](docs/STABILITY_TESTING.md) |
| Real interactive TUI: 12 × 6 models | `npm run test:tui -- --plan` | [TUI scenarios](docs/TUI_SCENARIOS.md) |
| Bounded PTY/browser workload | `npm run test:terminal -- --plan` | [Terminal checks](docs/SOAK_TESTING.md) |
| Long-lived conversations | `npm run test:soak -- --plan` | [Endurance](docs/SOAK_TESTING.md#combined-soak-runner) |
| Investigate Opus upstream filtering | `npm run diagnose:opus` | [Diagnostics](docs/OPUS_DIAGNOSTICS.md) |

Historical scores, implementation hashes and retained failures live in the [verification index](docs/validation/README.md), not in the setup steps. Generated scenario documents come from `scripts/compatibility/documentation.mjs` and the catalog; update them with `npm run docs:scenarios` rather than editing the generated files.

## Contributors and references

Maintained by [junwoojeong100](https://github.com/junwoojeong100), with AI-assisted implementation, testing and documentation contributions from [Codex](https://github.com/codex) and [GitHub Copilot](https://github.com/Copilot).

- [Official Codex CLI](https://github.com/openai/codex)
- [Codex advanced configuration](https://developers.openai.com/codex/config-advanced/)
- [Official GitHub Copilot SDK](https://github.com/github/copilot-sdk)
