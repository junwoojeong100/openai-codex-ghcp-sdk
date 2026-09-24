# Real Codex long-conversation endurance

[한국어](SOAK_TESTING_KO.md) · [Guide map](../README.md#testing) · [TUI scenarios](TUI_SCENARIOS.md) · [Verification records](validation/README.md)

Use `test:terminal` for a bounded, single-model terminal workload. Use `test:soak` for long-lived native conversations, optionally with a terminal lane. Pick one task below; each works on its own.

| Goal | Start here | Calls real models? |
| --- | --- | --- |
| Inspect the workload without running it | [Plan](#plan) | No |
| Check terminal drivers with simulated SDK responses | [Offline runtime](#offline-runtime) | No |
| Run one model for a bounded interval | [Terminal checks](#reproducible-terminal-checks) | **Yes** |
| Try a short multi-model workload | [Live smoke](#short-live-smoke) | **Yes**, even with `--smoke` |
| Measure at least five hours per lane | [Five-hour live run](#five-hour-live-run) | **Yes**, sustained usage |

For execution, install the [runtime prerequisites](#runtime-prerequisites); the offline check itself is optional. After a run, [read its report](#read-the-result).

This guide explains how to run the checks; recorded outcomes are in the [verification records](validation/README.md#recorded-results). Neither suite replaces the 66-case stability matrix. The Playwright driver renders real Codex pseudoterminal (PTY) output in xterm.js; desktop terminal applications are not tested.

## Prerequisites and offline checks

### Plan

After `npm ci`, inspect either plan from the repository root. Plans make **no model calls** and need no Codex, Python, Chromium or Copilot login:

```sh
npm run test:terminal -- --plan --driver playwright
npm run test:soak -- --plan
```

### Runtime prerequisites

For execution/runtime checks, use **Node 22.12+ and Codex 0.154.0**; terminal paths also need **Python 3**. Use the [CLI installation step](../README.md#2-install-dependencies); offline testing needs no Copilot login. Only the Playwright driver and terminal runtime suite require Chromium:

```sh
npx --no-install playwright install chromium
```

For Linux library errors, see the [Chromium setup note](TUI_SCENARIOS.md#runtime-prerequisites).

### Offline runtime

**No model calls or Copilot login.** With the [runtime prerequisites](#runtime-prerequisites) installed, check both terminal drivers using real Codex and an SDK double (a local replacement, not a model):

```sh
npm run test:terminal:runtime
```

## Reproducible terminal checks

**Consumes Copilot usage.** Install the [runtime prerequisites](#runtime-prerequisites) and complete the [Copilot account check](../README.md#3-check-installation-and-account-access). Pick **one** driver example below, and use a new output directory for each run.

These are test-runner options: `test:terminal` uses `--model`, unlike the launcher's `--ghcp-model`.

PTY driver, 120 seconds of measured traffic:

```sh
npm run test:terminal -- --execute --driver pty --model gpt-6-astra \
  --duration-seconds 120 --output .runtime/terminal-pty-new
```

Alternatively, Playwright with larger input and output:

```sh
npm run test:terminal -- --execute --driver playwright --model claude-sonnet-5 \
  --duration-seconds 120 --payload-bytes 24576 --response-words 1000 \
  --output .runtime/terminal-browser-new
```

`--duration-seconds 120` means at least 120 seconds of measured traffic **after readiness**, not a 120-second limit on the whole command. Setup, the final in-flight turn and cleanup add time. `Ctrl+C`/`SIGTERM` cancels work and leaves a partial run incomplete. For input/output limits and pass criteria, see [terminal workload and evidence](#terminal-workload-and-evidence).

## Combined soak runner

Pick the short smoke or the five-hour run; the smoke run is not a prerequisite.

Both modes start two **lanes** (independently monitored conversations): GPT-6 Luna and Claude Sonnet 5. Confirm access to `gpt-6-luna` and `claude-sonnet-5` with `./bin/ghcp-models`; access to the launcher's default Astra model is not enough. `--terminal` adds a separate Luna TUI lane.

### Short live smoke

**Consumes Copilot usage; it is not offline.** The short run calls the real GPT-6 Luna and Claude Sonnet 5 models. Complete the [runtime prerequisites](#runtime-prerequisites) and [Copilot account check](../README.md#3-check-installation-and-account-access), then use a new output directory.

```sh
npm run test:soak -- --smoke --duration-seconds 60 --output .runtime/soak-smoke-new
```

To add a terminal lane to a new run, add `--terminal` for a PTY lane or `--terminal --terminal-driver playwright` for a browser-rendered lane. Smoke duration accepts 1–600 seconds and never counts as endurance.

### Five-hour live run

**Sustained Copilot usage.** Every declared lane must run for at least 18,000 measured seconds after readiness. Preparation and cleanup add time. Complete the [runtime prerequisites](#runtime-prerequisites) and [Copilot account check](../README.md#3-check-installation-and-account-access) before starting:

```sh
npm run test:soak -- --execute --output .runtime/soak-five-hours-new
```

Each output directory must be new. The runner freezes source before execution and runs owned workers from the saved copy. `implementationUnchanged` reports whether the development worktree changed; `frozenSourceUnchanged` independently checks the code actually executed. Changing a development file does not silently change a running frozen worker. No result is an addition to, or regrade of, the 66-case matrix.

## Read the result

Read `report.json` in the chosen output directory, for example `.runtime/soak-smoke-new/report.json`. These two runners do not provide a separate `--verify` command.

| Run | Fields to check | What a pass establishes |
| --- | --- | --- |
| `test:terminal -- --execute` | `passed: true` | The declared bounded workload, duration, evidence and cleanup checks passed; not five-hour endurance |
| `test:soak -- --smoke` | `allLanesCompleted`, `noObservedFailures` and `frozenSourceUnchanged` are all `true` | The short workload passed; top-level `durationMet` remains `false` by design |
| `test:soak -- --execute` | The same three fields, plus `durationMet: true` | Every declared lane reached at least five hours without observed failures; not maximum-context certification |

Exit **0** means a valid plan or a passing run of the selected mode, **1** means failed/incomplete execution, and **2** means an argument or runner error. A successful smoke run is still not an endurance pass. Inspect the existing report before starting another run after an interruption.

## Terminal workload and evidence

These details explain the terminal checks above; they are not additional commands to run.

| Option | Accepted range | Meaning |
| --- | --- | --- |
| `--duration-seconds` | 1–86,400 seconds | Minimum measured traffic interval for `test:terminal`, not five-hour certification. The final in-flight turn has a bounded completion allowance. |
| `--payload-bytes` | 128–65,536 bytes | Generated input size. |
| `--response-words` | 0–3,000 words | Requested output length; 0 requests only the completion marker. Actual output must meet the declared minimum character workload. |
| `--model` | [Six supported IDs](../README.md#models) | Must be available to the account; no fallback. |

Both drivers share the same private PTY lifecycle, workload and success criteria. Playwright submits prompts and Escape through the browser, while xterm.js handles terminal rendering/query responses. Unique completion markers must also appear in observed root SDK responses with the exact model identity; visible terminal text alone is insufficient.

Filter signals, SDK errors, failed SSE, short/missing responses, timeouts and cleanup failures remain failures. The new output directory retains reports, heartbeats, SDK/HTTP summaries and terminal receipts, plus a screenshot for the browser driver. Source snapshots include HTML and Python.

Only generated non-sensitive data is sent. Each run owns its `HOME`, `CODEX_HOME`, working directory and bridge; sandbox remains read-only and tool approval is never bypassed. Live child environments retain only the authentication/proxy settings needed by the SDK. The browser binds no public service and uses an owned empty browser profile. Supervisor cancellation gives terminal workers bounded time to reap the separate PTY and browser before escalation.

Payloads are generated only for the next turn, rather than allocating a whole day of large prompts at startup. The terminal parser honors Codex's scrolling regions so long answers do not lose their final marker during composer redraws. Late browser input callbacks are disabled before evidence files close after terminal exit.

## Offline regression scope

`npm run test:context:runtime` uses a mechanical SDK to check 120 sequential native tool calls, repeated compaction and same-TUI recovery after idle timeout, setup timeout and Escape. Expected error cases require an actual error line and a successful subsequent prompt; restarting the terminal does not count. Cosmetic redraws do not count as readiness or completion.

It also delays first progress for **95 measured seconds** under production 180-second first-progress and 90-second streaming limits, requiring one SDK session, one prompt submission, no recovery and a successful follow-up. Other cases check silent-turn recovery, byte-only and root-phase progress; private phase content is never exposed. These are bounded SDK-double regressions, not remote-model uptime or maximum-context certification.

## Native workloads

- **GPT-6 Luna:** a persistent native thread with the actual model catalog's maximum advertised tier input budget and automatic compaction. Each turn reads a freshly updated, inert 8 KiB application sample through an owned native tool, then returns the sample identifier.
- **Claude Sonnet 5:** the same workload with a labelled **131,072-token client context override**, automatic compaction at 98,304 tokens, and explicit native compaction every 40 successful turn slots. This is accelerated client-context stress, not a claim to exercise the provider's maximum context.
- **Optional terminal lane:** `--terminal` adds a persistent actual Codex TUI on GPT-6 Luna with the labelled 65,536-token client override. `--terminal-driver playwright` selects headless xterm.js rendering; the default `pty` driver uses the independent terminal parser. These terminal results are separate from native app-server coverage.

Turns are normally paced at 25-second minimum start intervals. Fixtures, `HOME` and `CODEX_HOME` are test-owned; native threads are read-only, unexpected tools are rejected, approvals are declined, and existing user bridges/settings are not restarted or modified. Production request, turn and per-operation cleanup defaults remain in effect.

New samples are explicitly announced by sequence number; hidden sample identifiers are learned only through the tool callback. An early smoke exposed reuse of prior samples under identical ambiguous requests. Those failures remain recorded; the endurance workload now explicitly states that the sample changed and requires one fresh read in the current turn.

## Monitoring and failure evidence

Workers write five-second heartbeats and flush native/SDK events per turn. HTTP summaries retain byte counts, hashes, terminal SSE type and explicit error codes rather than every growing full request. Error incidents retain scrubbed local evidence. Old per-turn arrays are cleared only after evidence is written, avoiding an ever-growing observer buffer.

The independent supervisor samples owned worker/child CPU and RSS every 15 seconds. A stale worker heartbeat and a live worker awaiting a long model response are different incident categories. At 120 seconds without a heartbeat, or 480 seconds inside a native turn/compaction, it records an incident and terminates only that owned worker group with bounded escalation. Long-response warnings begin at 90 seconds; a warning is not proof of a deadlock.

The existing short-run native host retains its original 8 MiB transcript and 1 MiB stderr defaults. Endurance explicitly uses a 512 MiB transcript budget, a 16 MiB per-drain stderr budget, and disk-backed per-turn log draining. Exceeding any budget remains an error, not silent truncation.

The endurance runner does not retry failed requests or convert them into success. The production bridge's bounded pre-output idle recovery happens inside the original request, with watchdog/recovery diagnostics; it does not reset turn/request deadlines. A request that ultimately fails remains failed. A failed native session may be followed by a **new, recorded thread** to test recovery; the failed turn remains counted. Three consecutive failures stop that lane for investigation. Cleanup errors, unknown outcomes and incomplete durations stay visible.

`durationMet` requires at least five actual hours in every declared lane for an endurance run. Reports separately show successful/failed turns, active request time, total measured coverage, maximum observed input tokens/history bytes/RSS, compaction counts, recovery threads and process-group cleanup. Pacing time is not model-active time; elapsed-time coverage alone is not evidence that the maximum context was reached.

Raw artifacts remain under ignored `.runtime`. Review/redact before publishing. A native app-server run alone does not establish that the interactive terminal renderer was exercised; terminal PTY coverage must be separately labelled and verified.
