# Codex native validation scenarios

[한국어](NATIVE_SCENARIOS_KO.md) · [Execution guide (한국어)](EXHAUSTIVE_TESTING_KO.md) · [README](../README.md)

## Scope

This harness adapts the neighboring `claude-code-ghcp-sdk` catalog's **69 feature groups,
207 normal/failure/lifecycle scenarios, and seven-model matrix (1,449 slots)** to Codex.
It is not the separate 24-scenario HTTP bridge suite. Feature and scenario IDs retain an
explicit sibling crosswalk; execution uses Codex-native APIs rather than Claude tool names.
The sibling repository is a read-only design reference, not a runtime dependency or a source
of reusable test results.

Required live route:

```text
Codex CLI / app-server → this repository's Responses bridge → GitHub Copilot SDK → selected model
```

The native protocol is pinned to **Codex CLI 0.154.0**, the SDK to **1.0.14**, and the seven
exact model IDs to `src/model-map.mjs`. Unknown/unavailable models must not silently fall back.
The [machine-readable catalog](../scripts/native/catalog.mjs) contains the setup, prerequisites,
stimulus, both behavior predicates, native surface and evidence contract for every scenario.
The [registry](../scripts/native/registry.mjs) declares actual executors and independent evaluators.

**Design completeness, driver readiness, offline harness checks and live compatibility are
separate measurements.** Missing local drivers remain in the denominator. The historical dated
live validation report is a different scope and is not imported into this matrix.

## Commands

```bash
# No model calls or native processes: validate all scenario contracts.
npm run test:scenarios

# Readiness only; exits 1 while any driver/oracle is missing or partial.
npm run test:runner:prepare

# Inspect one feature's full normal/failure/lifecycle procedures and gaps.
npm run test:e2e:native-coverage -- --feature file-edit

# Offline unit tests and guarded, source-bound preparation receipts.
npm test
npm run test:runner:check -- --models gpt-6-astra --feature file-read \
  --output .runtime/preparation-file-read-001

# Real pinned Codex, synthetic SDK/catalog: zero real model calls.
npm run test:runner:runtime
npm run test:runner:drivers -- --output .runtime/native-driver-check-001
npm run test:runner:drivers -- --verify .runtime/native-driver-check-001/results.json
```

Results directories must be new. Set `CODEX_BIN` to the real native executable if your
interactive `codex` command is a shell wrapper. The driver self-test defaults to all `ready`
scenarios on the **synthetic** `gpt-6-astra` identity. It exercises real Codex tools and protocol,
not actual model behavior. `--models` on this command selects synthetic identities only.
An expected unsupported boundary may satisfy `harnessChecksPassed` but retains its
`unsupported` matrix status; it earns no compatibility credit.

### Deliberate live diagnostic run

The following command **uses existing Copilot authentication and consumes account usage**.
Run it only when you intend to make real model calls. Preparation must match the exact model
selection, scenario selection, implementation and runtime versions.

```bash
npm run test:e2e:native-v2 -- \
  --run-selected --models gpt-6-astra --feature file-read \
  --preparation .runtime/preparation-file-read-001/preparation-checks.json \
  --output .runtime/native-file-read-001

npm run test:e2e:native-v2 -- --verify .runtime/native-file-read-001/results.json
```

`--run-selected` requires complete executors/evaluators for every selected scenario. It is
explicitly diagnostic, leaves unselected matrix slots as `not-run`, and can never set
`fullMatrixPassed`. Partial/missing drivers cannot run through this mode.

### Full acceptance

`test:e2e:native-v2` defaults to offline preparation. Its separate `--execute --models all`
mode requires **all 207 drivers and evaluators** plus a current passing offline preparation
proof. The full gate runs before creating fixtures, SDK clients or result directories. It
cannot be bypassed by selecting a subset or passing `--allow-probes`.

**The full harness is not yet ready.** The table below names the remaining gaps; full acceptance
therefore refuses execution. Even once all drivers exist, unsupported feature boundaries do
not become compatibility passes. A complete supported feature requires all three dimensions
to pass on the same model. `fullMatrixPassed` requires every slot to pass in a finished live
acceptance run.

## Readiness crosswalk

`ready` means an executor and both behavior evaluators exist, **not that a model passed**.
`partial` means a known predicate gap; `not-implemented` means no executor. Neither is
relabelled as an environment block or product non-support.

<!-- BEGIN GENERATED READINESS -->
Currently **ready 39 / partial 6 / not-implemented 162**. These are implementation states, not live results.

| Feature ID (sibling crosswalk) | Normal | Failure | Lifecycle | Native surface |
|---|---|---|---|---|
| `cli-runtime` | `ready` | `ready` | `ready` | `codex-cli` |
| `terminal-interaction` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-pty` |
| `accessibility` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-pty` |
| `statusline` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-pty` |
| `settings` | `ready` | `ready` | `ready` | `codex-app-server` |
| `model-routing` | `ready` | `ready` | `ready` | `codex-app-server` |
| `reasoning-effort` | `ready` | `ready` | `ready` | `codex-app-server` |
| `gateway-protocol` | `ready` | `ready` | `ready` | `codex-app-server` |
| `streaming` | `ready` | `partial` | `partial` | `codex-app-server` |
| `structured-output` | `ready` † | `ready` † | `ready` † | `codex-app-server` |
| `file-read` | `ready` | `ready` | `ready` | `codex-app-server` |
| `file-search` | `ready` | `ready` | `ready` | `codex-app-server` |
| `file-edit` | `ready` | `ready` | `ready` | `codex-app-server` |
| `notebooks` | `ready` | `ready` | `ready` | `codex-app-server` |
| `shell-execution` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `code-intelligence` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `web-fetch` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `permission-modes` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `planning` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `sandboxing` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `user-input` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `project-instructions` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `auto-memory` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `skills` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `hook-lifecycle` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `hook-transports` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `plugin-lifecycle` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `plugin-distribution` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-plugin-cli` |
| `plugin-evaluations` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `mcp-transports` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `mcp-authentication` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `mcp-resources` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `mcp-tool-search` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `subagents` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `agent-continuation` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `agent-teams` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `dynamic-workflows` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `background-agents` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `local-session-messaging` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `worktrees` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-cli` |
| `task-tracking` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `monitoring-tools` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `scheduling` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `goals` | `partial` | `partial` | `partial` | `codex-app-server` |
| `session-resume` | `ready` | `ready` | `partial` | `codex-app-server` |
| `checkpoint-rewind` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `context-compaction` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `crash-recovery` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `output-styles` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `image-input` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `pdf-input` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `binary-tool-results` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `tool-choice` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `usage-context` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `prompt-cache` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `desktop-gateway` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-desktop` |
| `ci-integrations` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-cli` |
| `agent-sdk-host` | `ready` | `ready` | `ready` | `codex-app-server` |
| `external-session-storage` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `managed-local-policy` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-isolated-os-user` |
| `network-containers` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-container` |
| `launchers` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-launcher` |
| `telemetry` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `diagnostics` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `local-notifications` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-desktop-notifications` |
| `local-code-review` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `local-retention` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `auto-permission-policy` | `not-implemented` | `not-implemented` | `not-implemented` | `codex-app-server` |
| `provider-controls` | `ready` | `ready` | `ready` | `codex-launcher` |

† Boundary check with an expected `unsupported` result. Driver readiness does not imply feature support.
<!-- END GENERATED READINESS -->

## Evidence and examples

Each attempted scenario checks **primary**, **secondary**, **route**, **isolation**, and
**cleanup**, preserving seven private artifacts:

```text
NEW_DIR/
  catalogue.json, design.json, plan.json
  progress.json, results.json, coverage.json
  cases/MODEL/SCENARIO/attempt-001/
    native.json, sdk.json, http.json, diagnostics.json
    observations.json, state.json, processes.json
```

- **File read:** Unicode/CRLF/empty/space-containing paths; missing file and dangling symlink;
  same-thread reread after an owned-file change. Compare real command output to fixture bytes.
- **File edit:** real native `apply_patch`, a stale-patch failure, then a second patch. Check
  `fileChange` events, stage snapshots, exact content and preservation of unrelated files.
- **Model routing:** hidden marker absent from prompts, exact SDK model attribution, no fallback,
  separate native threads/workspaces, and no duplicate tool effects on continuation.
- **Gateway protocol:** native tool call/result IDs, additional-tools declarations, leading
  developer instructions, invalid local credentials and full-history continuation.
- **Structured output:** send native `turn/start.outputSchema`, retain explicit rejection and
  no inference for the invalid request, then recover with text. Result: `unsupported`, not a
  schema-constrained generation pass.

The verifier hashes every artifact and reruns synchronous behavior/route/isolation/cleanup
oracles on retained data without executing models or drivers. Wrong paths, symlinks,
duplicate slots, missing receipts, stale source hashes and unjustified success flags fail.
Hashes detect corruption and mixing; they are not signatures or remote attestations against
an adversarial local report author.

SIGINT/SIGTERM retain completed and interrupted attempts plus the remaining `not-run` rows.
SIGKILL/power loss can only preserve the last checkpoint. CLI reruns require new directories;
there is no automatic retry or append/resume CLI. The underlying storage API supports separate,
append-only attempt directories without overwriting earlier evidence.

## Safety and limitations

Use a new private output directory (`0700`; artifact files `0600`). Codex runs in isolated
HOME/CODEX_HOME/workspaces with read-only or explicitly scoped workspace-write permissions.
Only owned resources are stopped. No user daemon stop command, authentication change, sibling
repository write, or replacement of user configuration is performed. Credentials and code-loading
environment variables are not inherited by model-run shell tools. Observed configuration files
are hashed, not copied into reports. Redaction is not a guarantee to detect every kind of sensitive
content; keep evidence private.

UI/accessibility/Desktop/container/MCP/agent areas without complete drivers remain explicit
gaps, not generic-prompt substitutes. Cloud/account services and external IDE extension hosts
are outside this local harness's attestation; see `scopeExclusions` in the catalog.

- Official protocol: [Codex App Server](https://learn.chatgpt.com/docs/app-server).
- Version-specific fields: `codex app-server generate-json-schema --experimental` from 0.154.0.
- Detailed commands, exit codes and extension points: [execution guide](EXHAUSTIVE_TESTING_KO.md).
