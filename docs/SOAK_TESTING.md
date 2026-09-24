# Real Codex long-conversation endurance

[한국어](SOAK_TESTING_KO.md) · [Guide map](../README.md#testing) · [TUI scenarios](TUI_SCENARIOS.md) · [Verification records](validation/README.md)

Two runners check behavior over time:

- **`test:terminal`** runs one model under a bounded workload in a real pseudoterminal (PTY), read either by an independent parser or by a browser that renders it with xterm.js. Desktop terminal applications are not tested.
- **`test:soak`** runs long-lived native conversations, optionally with a terminal lane.

Neither replaces the 66-case stability matrix. Recorded outcomes are in the [verification records](validation/README.md#recorded-results).

| Goal | Start here | Model calls |
| --- | --- | --- |
| Inspect the workload without running it | [Plan](#plan) | No |
| Check both terminal drivers with an SDK double | [Offline runtime](#offline-runtime) | No |
| Run one model for a bounded interval | [Terminal checks](#reproducible-terminal-checks) | **Yes** |
| Try a short multi-model workload | [Live smoke](#short-live-smoke) | **Yes**, even with `--smoke` |
| Run each lane for at least five hours | [Five-hour live run](#five-hour-live-run) | **Yes**, sustained usage |

Each mode works on its own; the offline check and the smoke run are optional. After any run, [read its report](#read-the-result).

## Prerequisites and offline checks

### Plan

Needs no Codex, Python, Chromium or Copilot login. From the repository root after `npm ci`:

```sh
npm run test:terminal -- --plan --driver playwright
npm run test:soak -- --plan
```

### Runtime prerequisites

Execution and runtime checks need **Node 22.12+ and Codex 0.154.0** ([install step](../README.md#2-install-dependencies)); terminal paths also need **Python 3**. Only the Playwright driver and the terminal runtime suite need Chromium:

```sh
npx --no-install playwright install chromium
```

For Linux library errors, see the [Chromium setup note](TUI_SCENARIOS.md#runtime-prerequisites). Offline checks need no Copilot login.

### Offline runtime

Checks both terminal drivers with real Codex and an SDK double (a local stand-in for the Copilot SDK). No model calls:

```sh
npm run test:terminal:runtime
```

## Reproducible terminal checks

**Consumes Copilot usage.** Install the [runtime prerequisites](#runtime-prerequisites) and complete the [Copilot account check](../README.md#3-check-installation-and-account-access). Pick **one** driver below and use a new output directory for each run.

`test:terminal` selects its model with `--model`; the launcher's `--ghcp-model` does not apply here.

**PTY driver**, 120 seconds of measured traffic:

```sh
npm run test:terminal -- --execute --driver pty --model gpt-6-astra \
  --duration-seconds 120 --output .runtime/terminal-pty-new
```

**Or the Playwright driver**, with larger input and output:

```sh
npm run test:terminal -- --execute --driver playwright --model claude-sonnet-5 \
  --duration-seconds 120 --payload-bytes 24576 --response-words 1000 \
  --output .runtime/terminal-browser-new
```

- `--duration-seconds 120` means at least 120 seconds of measured traffic **after readiness**, not a limit on the whole command. Setup, the final in-flight turn and cleanup add time.
- `Ctrl+C` or `SIGTERM` cancels the work and leaves the partial run incomplete.
- For option ranges and pass criteria, see [terminal workload and evidence](#terminal-workload-and-evidence).

## Combined soak runner

Both modes start two **lanes** (independently monitored conversations): GPT-6 Luna and Claude Sonnet 5. Run `./bin/ghcp-models` and confirm that `gpt-6-luna` and `claude-sonnet-5` are available; access to the launcher's default Astra model is not enough. `--terminal` adds a separate Luna TUI lane.

Pick the short smoke or the five-hour run; the smoke run is not a prerequisite.

### Short live smoke

**Consumes Copilot usage; it is not offline.** It calls the real GPT-6 Luna and Claude Sonnet 5 models. Complete the [runtime prerequisites](#runtime-prerequisites) and [Copilot account check](../README.md#3-check-installation-and-account-access), then use a new output directory:

```sh
npm run test:soak -- --smoke --duration-seconds 60 --output .runtime/soak-smoke-new
```

Smoke duration accepts 1–600 seconds and never counts as endurance. To add a terminal lane to a new run, add `--terminal` for a PTY lane, or `--terminal --terminal-driver playwright` for a browser-rendered lane.

### Five-hour live run

**Sustained Copilot usage.** Every declared lane must run for at least 18,000 measured seconds after readiness; preparation and cleanup add time. Complete the [runtime prerequisites](#runtime-prerequisites) and [Copilot account check](../README.md#3-check-installation-and-account-access) first:

```sh
npm run test:soak -- --execute --output .runtime/soak-five-hours-new
```

- Each output directory must be new.
- Before execution, the runner saves a frozen copy of its source and runs its workers from that copy. Editing a development file does not change a running worker.
- `frozenSourceUnchanged` checks the code that actually ran; `implementationUnchanged` separately reports whether the development worktree changed.
- No result adds to, or regrades, the 66-case matrix.

## Read the result

Read `report.json` in the output directory, for example `.runtime/soak-smoke-new/report.json`. These two runners have no `--verify` command.

| Run | Fields to check | What a pass establishes |
| --- | --- | --- |
| `test:terminal -- --execute` | `passed: true` | The declared bounded workload, duration, evidence and cleanup checks passed; not five-hour endurance |
| `test:soak -- --smoke` | `allLanesCompleted`, `noObservedFailures` and `frozenSourceUnchanged` are all `true` | The short workload passed; top-level `durationMet` remains `false` by design |
| `test:soak -- --execute` | The same three fields, plus `durationMet: true` | Every declared lane reached at least five hours without observed failures; not maximum-context certification |

| Exit code | Meaning |
| --- | --- |
| 0 | Valid plan, or a passing run of the selected mode |
| 1 | Failed or incomplete execution |
| 2 | Argument or runner error |

A passing smoke run is still not an endurance pass. After an interruption, read the existing report before starting another run.

## Terminal workload and evidence

These details explain the terminal checks above; they are not extra commands to run.

| Option | Accepted range | Meaning |
| --- | --- | --- |
| `--duration-seconds` | 1–86,400 seconds | Minimum measured traffic interval for `test:terminal`, not five-hour certification. The final in-flight turn has a bounded completion allowance. |
| `--payload-bytes` | 128–65,536 bytes | Generated input size. |
| `--response-words` | 0–3,000 words | Requested output length; 0 requests only the completion marker. Actual output must meet the declared minimum character workload. |
| `--model` | [Six supported IDs](../README.md#models) | Must be available to the account; no fallback. |

- Both drivers share the same private PTY lifecycle, workload and success criteria. Playwright submits prompts and Escape through the browser, and xterm.js handles terminal rendering and query responses.
- Unique completion markers must also appear in observed root SDK responses with the exact model identity; visible terminal text alone is not enough.
- Filter signals, SDK errors, failed SSE, short or missing responses, timeouts and cleanup failures remain failures.
- The output directory keeps reports, heartbeats, SDK and HTTP summaries and terminal receipts, plus a screenshot for the browser driver. Source snapshots include the HTML and Python files.
- Only generated, non-sensitive data is sent. Each run owns its `HOME`, `CODEX_HOME`, working directory and bridge; the sandbox stays read-only and tool approval is never bypassed. Live child environments keep only the authentication and proxy settings the SDK needs. The browser binds no public service and uses an owned, empty profile.
- On cancellation, the supervisor gives terminal workers bounded time to reap the PTY and browser before escalating.
- Payloads are generated only for the next turn, instead of allocating a whole day of large prompts at startup. The terminal parser honors Codex's scrolling regions, so long answers keep their final marker during composer redraws. Late browser input callbacks are disabled before evidence files close after the terminal exits.

## Offline regression scope

`npm run test:context:runtime` uses a mechanical SDK double to check:

- 120 sequential native tool calls, repeated compaction, and recovery in the same TUI after an idle timeout, a setup timeout and Escape. Expected error cases need an actual error line and a successful next prompt; restarting the terminal does not count. Cosmetic redraws do not count as readiness or completion.
- A first-progress delay of **95 measured seconds** under the production 180-second first-progress and 90-second streaming limits. It requires one SDK session, one prompt submission, no recovery and a successful follow-up.
- Silent-turn recovery, and byte-only and root-phase progress. Private phase content is never exposed.

These are bounded SDK-double regressions, not remote-model uptime or maximum-context certification.

## Native workloads

- **GPT-6 Luna:** a persistent native thread with the actual model catalog's maximum advertised tier input budget and automatic compaction. Each turn reads a freshly updated, inert 8 KiB application sample through an owned native tool, then returns the sample identifier.
- **Claude Sonnet 5:** the same workload with a labelled **131,072-token client context override**, automatic compaction at 98,304 tokens, and explicit native compaction every 40 successful turn slots. This is accelerated client-context stress, not a claim to exercise the provider's maximum context.
- **Optional terminal lane:** `--terminal` adds a persistent actual Codex TUI on GPT-6 Luna with the labelled 65,536-token client override. `--terminal-driver playwright` selects headless xterm.js rendering; the default `pty` driver uses the independent terminal parser. These terminal results are separate from native app-server coverage.

- Turns normally start at least 25 seconds apart.
- Fixtures, `HOME` and `CODEX_HOME` are test-owned. Native threads are read-only, unexpected tools are rejected, approvals are declined, and existing user bridges and settings are not restarted or changed. Production request, turn and per-operation cleanup defaults stay in effect.
- Each new sample is announced by sequence number, and its hidden identifier can be learned only through the tool callback. An early smoke run showed models reusing earlier samples when identical requests were ambiguous. Those failures remain recorded; the workload now says that the sample changed and requires one fresh read in the current turn.

## Monitoring and failure evidence

- **Heartbeats and logs:** workers write heartbeats every five seconds and flush native and SDK events every turn. HTTP summaries keep byte counts, hashes, the terminal SSE type and explicit error codes instead of every growing full request. Error incidents keep scrubbed local evidence. Old per-turn arrays are cleared only after their evidence is written, so the observer buffer does not keep growing.
- **Supervisor:** an independent supervisor samples owned worker and child CPU and RSS every 15 seconds. A stale heartbeat and a live worker waiting for a long model response are different incident types.
- **Stall limits:** after 120 seconds without a heartbeat, or 480 seconds inside one native turn or compaction, the supervisor records an incident and terminates only that owned worker group, with bounded escalation. Long-response warnings start at 90 seconds; a warning is not proof of a deadlock.
- **Budgets:** the short-run native host keeps its original 8 MiB transcript and 1 MiB stderr defaults. Endurance uses a 512 MiB transcript budget, a 16 MiB per-drain stderr budget and disk-backed per-turn log draining. Exceeding any budget is an error, not silent truncation.
- **No retries:** the endurance runner never retries failed requests or turns them into successes. The bridge's own bounded idle recovery before output happens inside the original request, with watchdog and recovery diagnostics, and does not reset the turn or request deadline. A request that ultimately fails stays failed.
- **Recovery threads:** after a failed native session, a **new, recorded thread** may test recovery; the failed turn still counts. Three consecutive failures stop that lane for investigation. Cleanup errors, unknown outcomes and incomplete durations stay visible.
- **Report fields:** `durationMet` requires at least five actual hours in every declared lane of an endurance run. Reports separately show successful and failed turns, active request time, total measured coverage, maximum observed input tokens, history bytes and RSS, compaction counts, recovery threads and process-group cleanup. Pacing time is not model-active time, and elapsed time alone does not show that the maximum context was reached.

Raw artifacts stay in the Git-ignored `.runtime` directory; review and redact them before publishing. A native app-server run alone does not show that the interactive terminal renderer was exercised; terminal PTY coverage must be labelled and verified separately.
