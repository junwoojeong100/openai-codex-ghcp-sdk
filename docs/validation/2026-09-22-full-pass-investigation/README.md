# Full-pass investigation - 2026-09-22

[한국어](README_KO.md)

## Outcome: 77/77 remains unproven

The best completed full matrix remains **74/77 (96.10%)**, profile `application-data-v1`. The **77/77 target is unmet**. Baseline commit [`fec3519ba89b6f7782318b3d583aa00ebba93d8c`](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/commit/fec3519ba89b6f7782318b3d583aa00ebba93d8c) was committed and pushed before this investigation. Its remaining failures are Opus S10/S11 with explicit SDK filter signals and Sonnet S05 with a literal-output mismatch.

This record covers **47 prospectively declared, unscored native diagnostic attempts**, not another full matrix: **32 individual attempts passed their original checks, 14 complete attempts failed, and one attempt was inconclusive**. The original diagnostic summaries retain 15 failed statuses, including that inconclusive attempt. There were no case retries and no new full 77-case run in this investigation. Passing cells from different experiments are not combined, and the earlier 74/77 result is not regraded.

**Every candidate remains unpromoted.** The frozen baseline implementation is `58405707a80c24da513f3db492ccdec845aecf81f3ed9f0c7374a713dd5f8384`. These probes made no main-source changes. Subsequent, separate soak development must not be confused with the historical implementations verified here.

## Declared native scope and outcomes

| Diagnostic | Attempts | Passed | Failed, complete | Inconclusive | SDK filter events | Own concurrency limit |
|---|---:|---:|---:|---:|---:|---:|
| Positive tool-format description | 11 | 8 | 3 | 0 | 3 | 3 |
| Baseline Opus wire observation | 2 | 0 | 2 | 0 | 2 | 1 |
| A: current request outside quoted history | 11 | 8 | 3 | 0 | 2 | 3 |
| B: same-author user-only projection | 11 | 9 | 2 | 0 | 2 | 3 |
| Readable SDK aliases | 6 | 4 | 2 | 0 | 2 | 2 |
| Public SDK workspace alignment | 6 | 3 | 2 | 1 | 2 | 1 |
| **Attempt inventory, not a matrix score** | **47** | **32** | **14** | **1** | **13** | - |

The three 11-case scopes were S01 for all seven exact models, plus Opus S10/S11, Sonnet S05 and Haiku S11. Each six-case scope was Astra S01, Opus S01/S10/S11, Sonnet S05 and Haiku S11. Wire observation used only Opus S10/S11.

All used the existing `application-data-v1` user prompts, fixture generation and bytes, scenario budgets, model identities and original `evaluate()`/`readCase()` checks. Normal repeated turns, tool continuations, resume and compaction remained part of their declared scenarios, not retries. SDK foundation, permissions, filters and reasoning settings were not relaxed. Exact per-case statuses, failed check IDs, observed/not-run phases, filter flags and declared scope are in [sanitizeddiagnostics.json](sanitizeddiagnostics.json).

## What each experiment established

| Experiment | Isolated difference and bounded evidence | Limit |
|---|---|---|
| Positive format description | Only copied `read_fixture` metadata documented the existing `value:`/`receipt:` prefixes and newline. Both original and candidate description strings are preserved in the sanitized JSON; generated fixture values are not. | Opus S01, S10 and S11 filtered. Not promoted. |
| Opus wire observer | Original request/response objects were forwarded unchanged; native provider refusal metadata was observed for S10 recall and S11 repeat-2. | Observation only, not a production fix. |
| A: active request framing | Only copied `renderPrompt` moved the final genuine user message outside the unchanged escaped history envelope. The model-free countercheck failed that invariant on baseline and passed it on A; captured SDK send hashes confirmed the candidate path. | Opus S10 recall and S11 repeat-2 still filtered. Sonnet S05 still failed literal preservation. |
| B: user-only projection | Only copied `renderPrompt` joined consecutive user-only messages with two newlines, matching existing same-user multipart normalization. Baseline and A failed equivalence; B passed. Singleton bytes, Unicode/whitespace, mixed history and tool-data safety were preserved. | Opus S10 recall and S11 repeat-2 still filtered. A passing Sonnet S05 trial does not establish a durable fix. |
| Readable aliases | Only copied `addTools` added up to 24 sanitized qualified-name characters after reserved `ghcp_`, retaining the same 128-bit hash suffix. Four prefix-collision groups stayed distinct; names were ASCII and at most 62 characters. Function/custom output restoration and custom-only permissions passed. | Existing correlation already worked. Native mapping passed, but Opus S10 filtered during remember and S11 during repeat-2. |
| Workspace alignment | The diagnostic wrapper added only public `workingDirectory: executor.fixture.cwd` to SDK session creation. Frozen production files remained baseline-identical. Recorded public session-start cwd confirmed alignment. | Complete Opus S10/S11 still filtered. Astra S01 has insufficient model-outcome and cleanup evidence. |

Plan, countercheck, source and driver hashes are retained in the manifests. The workspace intervention is identified by its diagnostic driver and configuration difference, not falsely presented as a modified production source hash. Short-lived successes are not proof of causation or a fix.

## Refusal attribution stays local to observed wire evidence

There are **13 explicit SDK filter events** in complete records. Four captured native provider refusals reported stop reason `refusal`, category **`reasoning_extraction`**, and zero output tokens: Opus S10/S11 in the wire-observer experiment and Opus S10/S11 in workspace alignment.

That category is published **only for those four wire-observed cases**. It is not assigned retroactively to other filter events or to the original 74/77 matrix. A reported provider category does not expose hidden reasoning or establish why these synthetic application requests triggered it. Genuine filters remain failures.

## Astra workspace attempt remains inconclusive

Workspace-alignment Astra S01 has only partial artifacts, no final result manifest and no complete original check set. Its original supervisor receipt records **exit code 1, `processGroupGone=false`, and `kill EPERM`**. Model-bound inference was not captured, so its model outcome and actual inference count remain unknown.

A later read-only check found the recorded native host PID absent. That does **not** establish that the entire owned process group was cleaned; the original failure and cleanup uncertainty are preserved. No follow-up workaround kill or rerun was performed. The root cause is **unknown**. Cleanup is confirmed for the other **46 complete attempts**, not for all 47.

## Attempts, workflow requests and model calls are different counts

The 46 complete records contain **97 SDK send requests, 70 tool-result submissions, and 167 SDK usage events with 167 distinct SDK API-call identifiers**. The partial Astra record contains one additional SDK send but no recorded usage event; that absence does not prove that no inference occurred.

Wire observers directly recorded **31 model-bound inference requests across seven complete cases**. These overlap the SDK usage evidence; they are not additional calls to add to 167. Catalog/control traffic and ordinary workflow requests are not counted as separate diagnostic cases. An exact total of actual/billed model calls across all 47 attempts is **not established**, particularly for the incomplete Astra attempt.

## Frozen verification and publication boundary

Publication verification re-ran the baseline full-report verifier against its frozen source and **all 46 available diagnostic `readCase()` checks against each experiment's frozen source**. The missing Astra final manifest was not reconstructed or treated as verified. All six prospective plans and the three available model-free countercheck receipts were checked. Source manifests confirm each isolated source difference; original statuses and acceptance checks were preserved.

No current-worktree implementation hash is used to invalidate or certify these historical runs. Ongoing soak changes are outside this verification. Publication itself made **zero model calls**.

| Artifact | Contents |
|---|---|
| [sanitizeddiagnostics.json](sanitizeddiagnostics.json) | All 47 attempts, declared scopes, counts, configuration differences, phases and observed filter metadata |
| [source-manifest.json](source-manifest.json) | Frozen baseline file hashes, candidate differences and diagnostic-driver hashes |
| [evidence-manifest.json](evidence-manifest.json) | SHA-256 and byte counts for ignored evidence artifacts; no raw evidence contents |
| [verification.json](verification.json) | Frozen verification receipts and explicit incomplete-case limits |
| [audit.json](audit.json) | Publication integrity, local-link and privacy checks |

Raw evidence remains ignored under `.runtime/full-pass-20260922/`. This publication includes only selected metadata, counts, hashes, approved configuration differences and phase outcomes: no raw conversations, full system instructions, credentials, generated fixture values or private home paths.

## Separate endurance work was stopped

The separate **at least five-hour real-Codex long-turn/hang test** was started, then stopped at the user's request on 2026-09-22 at 13:55 KST. It did not complete five hours. The endurance scaffold, partial logs and unfinished terminal integration are preserved as paused work, not completed certification. These bounded probes neither certify a five-hour run nor establish 77/77 stability. Committing this work does not resume testing.
