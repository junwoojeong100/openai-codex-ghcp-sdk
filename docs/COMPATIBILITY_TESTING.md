# Integrated development verification runner

[한국어](COMPATIBILITY_TESTING_KO.md) · [Ten scenarios and coverage](NATIVE_SCENARIOS.md) · [Usage](../README.md)

## Scope

**Exactly ten scenarios × seven GHCP models = 70 cases**, in one suite. There is no fast/full split, model subset or separate native OpenAI reference run. A case can contain multiple inference and tool calls.

90% is a design target for broad **everyday local coding** coverage, not measured whole-product coverage or native-GPT parity. See the explicit coverage/exclusion table in the scenarios. Only all assertions passing in all ten workflows earns `core-10-compatible` for one model; the whole matrix requires all seven models to pass 10/10.

Retired scenarios, runners and records are removed. Every run uses fresh output and synthetic fixtures, never imported or cherry-picked earlier results.

## Offline self-checks

```bash
npm test
npm run test:scenarios
npm run docs:scenarios:check
npm run test:compatibility -- --plan
npm run test:compatibility:runtime
```

These make no real model calls. Unit tests use synthetic evidence, process supervision and owned loopback HTTP. The runtime check uses **real Codex 0.154.0 + a scripted SDK double** for all ten native tool/MCP/skill/file workflows. It tests driver mechanics, not actual model instruction-following or reasoning, and requires a working OS sandbox.

## Live execution

Requires the repository's Node version/dependencies, original Codex **0.154.0**, Copilot SDK **1.0.14**, macOS/Linux POSIX process groups, Copilot authentication/model access and an enforceable workspace-write/network-off sandbox. Windows live supervision is not implemented. **No OpenAI API key is required.**

`.env` is not automatically loaded. Never put credentials in prompts, code or reports. The following commands consume actual Copilot usage:

```bash
# Always all 10 × 7 cases
npm run test:compatibility -- --execute

npm run test:compatibility -- --execute \
  --bin /absolute/path/to/codex --output .runtime/workflows-new-run
```

The default is offline `--plan`. `--models`, `--fast` and `--suite` are rejected. Existing output folders are not overwritten. Unavailable exact models retain ten blocked cells, without fallback. Shared authentication/version failure produces a blocked report with all 70 cells intact.

## Scheduling and failures

- Preflight: up to 90 seconds, catalog/version checks without inference.
- Up to four model lanes, sequential scenarios per model.
- Each 60–150 second case includes startup, fixtures, inference, tools and teardown; its last eight seconds are reserved for cleanup.
- One hour is a target, **not an overall cutoff**. A failed or timed-out case does not skip subsequent cases.
- No automatic case retries or selection of passing attempts. Failed/unsupported/blocked/timed-out/not-run cells stay in the denominator.
- Ctrl+C/SIGTERM stops new work, cleans up owned resources and records unfinished cells.

## Safety and evidence

Private HOME/CODEX_HOME and synthetic Git repositories isolate tests from the user's worktree. Production bridge/SessionManager code is exercised with an explicit native `unified_exec` + freeform `apply_patch` profile; the production launcher's default catalog advertisement is outside this test.

When a native command-completion event contains only a tail, only an actual outgoing tool result with the **same call ID** may supplement it. Generated assistant prose never substitutes for command evidence.

Approvals are limited to the exact fixture helper command with its original hash, or individual read-only calls to the owned local MCP fixture. There are no persistent or blanket grants. Native shell environments exclude SDK authentication. Immutable paths, user settings, Git index/HEAD, actual model routing and owned SDK/process cleanup are checked. Unsupported causes remain `undetermined` rather than being attributed to bridge/model/API behavior without evidence.

## Saved results and verification

Default output: `.runtime/compatibility-<run-id>/report.json` and `report.md`, plus per-case native/HTTP-SSE/SDK/filesystem/oracle/cleanup artifacts. Partial evidence from terminated cases is diagnostic only.

```bash
npm run test:compatibility -- --verify .runtime/compatibility-<run-id>/report.json
```

Offline verification checks catalog/implementation hashes, the exact 70-cell matrix, artifact ownership/hashes, recomputed assertions and cleanup receipts. Hashes detect changes; they are not third-party signatures or remote attestation. Changed code/contracts require new results.

Before publishing results, inspect summaries/evidence for credentials, account data and personal paths. Raw evidence may remain private under `.runtime`. Repository Git history is not a validation artifact and is not rewritten.

Exit codes: `0` valid plan or 70/70 pass; `1` failed/blocked/incomplete; `2` invalid arguments or evidence.
