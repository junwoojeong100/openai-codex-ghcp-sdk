# Real Codex long-conversation endurance

[한국어](SOAK_TESTING_KO.md)

The native, owned-PTY and Playwright Headless terminal paths are implemented. Historical interrupted runs remain interrupted: the commands below are reproducibility instructions, not a claim of five-hour reliability. The Playwright path renders actual Codex PTY bytes in xterm.js; it does not substitute model output or certify another desktop terminal emulator.

`npm run test:soak` is separate from the 66-case stability matrix. It measures real elapsed time, long-lived native Codex conversations, real Copilot SDK calls, context growth, compaction, queues, memory and owned-process liveness. A short harness check never establishes five-hour reliability.

For a bounded, offline regression, `npm run test:context:runtime` exercises 120 sequential native tool calls with repeated compaction and the actual TUI's same-process recovery from idle timeout, setup timeout and Escape. It also checks automatic silent-turn recovery on the original stream, byte-only SDK progress lasting beyond the idle limit, and a successful subsequent prompt without restarting the TUI. The deliberate fail-fast case explicitly sets `TURN_IDLE_RECOVERY_ATTEMPTS=0`. These cases use a mechanical SDK, not live inference. The PTY observer waits until Codex's model/directory loading placeholders disappear and debounces logical readiness/completion rather than raw output silence: cosmetic redraws must not look like a terminal hang. Expected error cases require an actual error line and a successful subsequent prompt, not a stopped/restarted terminal.

## Reproducible terminal checks

Node/npm, Python 3, the pinned Codex CLI, and Copilot authentication are required for live checks. `npm ci` installs the pinned development dependencies (`playwright@1.63.0`, `@xterm/xterm@6.0.0`); install the owned headless browser once:

```sh
npx --no-install playwright install chromium
npm run test:terminal:runtime  # actual Codex + both terminal drivers + mechanical SDK; no model calls
npm run test:terminal -- --plan --driver playwright

# Explicit live opt-in; uses the selected real model and consumes Copilot usage.
npm run test:terminal -- --execute --driver pty --model gpt-6-astra \
  --duration-seconds 120 --output .runtime/terminal-pty-new
npm run test:terminal -- --execute --driver playwright --model claude-sonnet-5 \
  --duration-seconds 120 --payload-bytes 24576 --response-words 1000 \
  --output .runtime/terminal-browser-new
```

The standalone duration accepts 1–86,400 seconds and is a minimum measured traffic interval, not a five-hour certificate. The final in-flight turn has a bounded completion allowance. `Ctrl+C`/`SIGTERM` cancels work; it cannot turn a partial duration into a pass. Payloads accept 128–65,536 bytes; response requests accept 0–3,000 words (0 requests only the marker). Actual response size is recorded and checked against the declared minimum character workload, not assumed from the prompt. Models must be one of the bridge's six supported IDs; there is no fallback.

Payloads are generated lazily for the next turn, rather than allocating a whole day of large prompts at startup. The terminal parser honors Codex's scrolling regions so long answers do not lose their final marker during composer redraws. Late browser input callbacks are disabled before evidence files close after terminal exit.

Both drivers share the same private PTY lifecycle, workload and success criteria. Playwright submits prompts and Escape through the browser, while xterm.js handles terminal rendering/query responses. Unique completion markers must also appear in observed root SDK responses with the exact model identity; visible terminal text alone is insufficient. Filter signals, SDK errors, failed SSE, short/missing responses, timeouts and cleanup failures remain failures. Reports, heartbeat, SDK/HTTP summaries, terminal receipts and a browser screenshot are saved beneath the new output directory; source snapshots include HTML and Python.

Only generated non-sensitive data is sent. Each run owns its `HOME`, `CODEX_HOME`, working directory and bridge; sandbox remains read-only and tool approval is never bypassed. Live child environments retain only the authentication/proxy settings needed by the SDK. The browser binds no public service and uses an owned empty browser profile. Supervisor cancellation gives terminal workers bounded time to reap the separate PTY and browser before escalation.

## Combined soak runner

```sh
npm run test:soak -- --plan
npm run test:soak -- --smoke --duration-seconds 60 --output .runtime/soak-smoke-new
npm run test:soak -- --smoke --duration-seconds 60 --terminal --output .runtime/soak-pty-new
npm run test:soak -- --smoke --duration-seconds 60 --terminal --terminal-driver playwright \
  --output .runtime/soak-browser-new
# At least 18,000 seconds per lane after readiness; consumes real model usage.
npm run test:soak -- --execute --output .runtime/soak-five-hours-new
```

Each output directory must be new. The runner freezes source before execution and runs owned workers from the saved copy. `implementationUnchanged` reports whether the development worktree changed; `frozenSourceUnchanged` independently checks the code actually executed. Changing a development file does not silently change a running frozen worker. No result is an addition to, or regrade of, the 66-case matrix.

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
