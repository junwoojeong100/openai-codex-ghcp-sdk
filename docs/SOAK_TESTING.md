# Real Codex long-conversation endurance

[한국어](SOAK_TESTING_KO.md)

**Paused work:** the user stopped execution on 2026-09-22 at 13:55 KST, before five hours completed. The native runner and standalone PTY helper are preserved, but terminal-lane integration is unfinished (`--terminal` cannot complete a run yet). The commands below are reproducibility instructions, not a statement that testing is currently running or five-hour reliability has been established.

`npm run test:soak` is separate from the 77-case stability matrix. It measures real elapsed time, long-lived native Codex conversations, real Copilot SDK calls, context growth, compaction, queues, memory and owned-process liveness. A short harness check never establishes five-hour reliability.

```sh
npm run test:soak -- --plan
npm run test:soak -- --smoke --duration-seconds 60 --output .runtime/soak-smoke-new
# At least 18,000 seconds per lane after readiness; consumes real model usage.
npm run test:soak -- --execute --output .runtime/soak-five-hours-new
```

Each output directory must be new. The runner freezes source before execution and runs owned workers from the saved copy. `implementationUnchanged` reports whether the development worktree changed; `frozenSourceUnchanged` independently checks the code actually executed. Changing a development file does not silently change a running frozen worker. No result is an addition to, or regrade of, the 77-case matrix.

## Native workloads

- **GPT-5.6 Luna:** a persistent native thread with the actual model catalog's default context metadata and automatic compaction. Each turn reads a freshly updated, inert 8 KiB application sample through an owned native tool, then returns the sample identifier.
- **Claude Sonnet 5:** the same workload with a labelled **131,072-token client context override**, automatic compaction at 98,304 tokens, and explicit native compaction every 40 successful turn slots. This is accelerated client-context stress, not a claim to exercise the provider's maximum context.

Turns are normally paced at 25-second minimum start intervals. Fixtures, `HOME` and `CODEX_HOME` are test-owned; native threads are read-only, unexpected tools are rejected, approvals are declined, and existing user bridges/settings are not restarted or modified. Production request, turn and per-operation cleanup defaults remain in effect.

New samples are explicitly announced by sequence number; hidden sample identifiers are learned only through the tool callback. An early smoke exposed reuse of prior samples under identical ambiguous requests. Those failures remain recorded; the endurance workload now explicitly states that the sample changed and requires one fresh read in the current turn.

## Monitoring and failure evidence

Workers write five-second heartbeats and flush native/SDK events per turn. HTTP summaries retain byte counts, hashes, terminal SSE type and explicit error codes rather than every growing full request. Error incidents retain scrubbed local evidence. Old per-turn arrays are cleared only after evidence is written, avoiding an ever-growing observer buffer.

The independent supervisor samples owned worker/child CPU and RSS every 15 seconds. A stale worker heartbeat and a live worker awaiting a long model response are different incident categories. At 120 seconds without a heartbeat, or 480 seconds inside a native turn/compaction, it records an incident and terminates only that owned worker group with bounded escalation. Long-response warnings begin at 90 seconds; a warning is not proof of a deadlock.

The existing short-run native host retains its original 8 MiB transcript and 1 MiB stderr defaults. Endurance explicitly uses a 512 MiB transcript budget, a 16 MiB per-drain stderr budget, and disk-backed per-turn log draining. Exceeding any budget remains an error, not silent truncation.

Failed requests are not retried or converted into success. A failed native session may be followed by a **new, recorded thread** to test recovery; the failed turn remains counted. Three consecutive failures stop that lane for investigation. Cleanup errors, unknown outcomes and incomplete durations stay visible.

`durationMet` requires at least five actual hours in every declared lane for an endurance run. Reports separately show successful/failed turns, active request time, total measured coverage, maximum observed input tokens/history bytes/RSS, compaction counts, recovery threads and process-group cleanup. Pacing time is not model-active time; elapsed-time coverage alone is not evidence that the maximum context was reached.

Raw artifacts remain under ignored `.runtime`. Review/redact before publishing. A native app-server run alone does not establish that the interactive terminal renderer was exercised; terminal PTY coverage must be separately labelled and verified.
