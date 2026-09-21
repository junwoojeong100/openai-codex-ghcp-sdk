# Fresh stability live verification — 2026-09-21

[한국어](README_KO.md) · [Full result JSON](summary.json) · [Non-passing details](FAILURES.md) · [Evidence hashes](evidence-manifest.json) · [Final audit](final-audit.json) · [Contract](../../STABILITY_TESTING.md)

**66/77 passed (85.7%), 11 failed, in 468.540 seconds.**
Unsupported: 0; blocked: 0; scenario timeouts: 0; not run: 0. An injected request timeout is distinct from a whole-case timeout.

**Full matrix passed: no.** Failures were not removed from the denominator, selectively rerun, replaced or regraded. This rate describes the fixed synthetic scenarios, not product support or hours-long endurance.

## 95% target and remaining cause

**Target not met: 66/77 (85.7%). 8 additional passing cells are needed to reach the 74-cell threshold.** Completed execution/evidence verification is not goal completion.

All 11 failed cells in this run are claude-opus-5. They contain 14 structured SDK filter/refusal signals and 14 corresponding upstream_content_filter error responses. The SDK documents that Anthropic refusal stop reasons are normalized to content_filter; this evidence does not distinguish an external input filter from the model's refusal path.

All recorded filter signals have outputTokens=0 and none of their responses emits a false response.completed. Some phases fail before tool work; S11 stops at the second turn after one successful read. Failed turns/final-values/readiness checks include missing evidence caused by early termination, not necessarily independent bridge defects. blocked=0 means no cell was prevented from running by prerequisites, not that no response was filtered/refused.

The bridge's false-success reporting was corrected and error delivery is verified in this run. The upstream reason for refusing this request remains unknown. The next step is provider diagnosis with a minimal reproduction preserving the request, tools and policy, not disabling filters, excluding a model, auto-retrying or relaxing the oracle. No further paid full run was made without a new evidence-backed correction.

## Deletion and fresh execution scope

- At the user’s request, previous working-tree raw validation data, logs, reports and generated browser artifacts were deleted. No backups were created and no old scores were reused. Git history was not rewritten.
- This is a new **11-scenario × seven exact models = 77-cell stability run** after deletion. It is not a rerun of the separate 18-workflow/126-cell compatibility matrix.
- The route is owned real Codex app-server → production bridge → real Copilot SDK → the selected model. Fault injections are explicit; scripted SDK responses receive no live credit.
- v3 uses the same benign synthetic-Unicode exact-copy request and fenced text format for all models. The v2 per-turn reads, production cleanup/SDK-startup budgets, asynchronous process cleanup and non-secret diagnostics remain in effect. The 77-cell denominator and acceptance checks were not weakened. SDK system append mode now preserves the SDK-managed foundation for every model without stripping client instructions or changing tool allowlists/permission rejection. Source was frozen after these corrections.
- The user’s operating bridge and its authentication/runtime files were neither deleted nor restarted.

## Execution metadata

- Run ID: `6eb67b7a-6780-4398-8161-17b444276ddf`
- KST: 2026-09-21T19:21:41.806+09:00 → 2026-09-21T19:29:30.347+09:00.
- Contract: `codex-ghcp-stability-11-v3`; Codex `0.154.0`; Copilot SDK `1.0.14`.
- `implementationUnchanged=true`, `userSettingsUnchanged=true`, `interrupted=false`.
- Current/frozen-source verification agrees: `evidenceIntegrity=true`; verifier exit **1**. Exit 1 means valid evidence with non-passing cells, not corrupt evidence (exit 2).
- All 82 source files match the frozen snapshot. Owned process-group exit receipts: 77/77; final resource receipts clean: 77/77. These do not erase earlier cleanup diagnostics.
- Real SDK model-use routing was verified in 77/77 cells. Actual billed/model API-call count is unknown/null; 77 matrix cells do not mean exactly 77 model calls.

## Per-model results

| Model | Passed | Non-passing scenarios | Verdict |
|---|---:|---|---|
| gpt-5.6-sol | 11/11 | — | codex-ghcp-stability-11-v3-passed |
| gpt-5.6-terra | 11/11 | — | codex-ghcp-stability-11-v3-passed |
| gpt-5.6-luna | 11/11 | — | codex-ghcp-stability-11-v3-passed |
| gpt-6-astra | 11/11 | — | codex-ghcp-stability-11-v3-passed |
| claude-opus-5 | 0/11 | S01, S02, S03, S04, S05, S06, S07, S08, S09, S10, S11 | not-established |
| claude-sonnet-5 | 11/11 | — | codex-ghcp-stability-11-v3-passed |
| claude-haiku-4.5 | 11/11 | — | codex-ghcp-stability-11-v3-passed |

## Per-scenario results

| ID | Scenario | Passed/7 |
|---|---|---:|
| S01 | Native read, Unicode SSE and readiness | 6/7 |
| S02 | Reordered tools while returning a pending result | 6/7 |
| S03 | Reject changed tool policy, then accept the unchanged result | 6/7 |
| S04 | Duplicate pending-result HTTP request without duplicate submission | 6/7 |
| S05 | Cancel a queued HTTP duplicate while native inference continues | 6/7 |
| S06 | Total request deadline followed by a fresh native turn | 6/7 |
| S07 | Idle SDK loss, truthful readiness and new-thread recovery | 6/7 |
| S08 | SDK loss with a native tool result pending, no replay | 6/7 |
| S09 | Reject mismatched stream before committing pending state | 6/7 |
| S10 | Fresh-process native resume without replaying a tool receipt | 6/7 |
| S11 | Repeated native tool turns, long history and local compaction | 6/7 |

## Non-passing observations and limitations

Failed-check counts overlap: **0 cleanup**, **10 final-values**, **1 S06.deadline**, **1 S11.repetition**. Cleanup/final-value overlap: 0 cells. Original verdicts are retained in the [diagnostic JSON](failure-analysis.json).

- Cleanup diagnostics now identify abort/disconnect/delete and distinguish timeout from RPC failure. The harness uses the production 5,000ms per-operation default. Remaining errors are not suppressed or regraded.
- 0 non-passing cells contain both payloads but change the contiguous literal tokens. Surrounding prose/fences are allowed; changes inside `value:<payload>` / `receipt:<payload>` (spacing, case or Markdown) fail the fixed contract.
- 0 cells fail literal checks on phases using the `remember` prompt. The v3 prompt explicitly requests unchanged lines in a text code block and a new read once in this turn. Surrounding fences were already allowed; the oracle was not changed. Remaining failures stay failed; literal checks are not relaxed and responses are not rewritten.
- 11 non-passing cells contain structured root-SDK filter metadata; 11 record an actual upstream_content_filter error response. Prose alone is not used to classify filtering. The underlying service-side cause is not established.

### Observed failed deadline-injection checks

- `claude-opus-5/S06`: ACK-hold=1; SDK prompts=2; fault=4078ms; recovery=false.

ACK-hold=0 means the intended ACK gate was not observed. A bounded timeout/recovery alone is not substituted for evidence of the specified injection path.

### Observed failed repetition checks

- `claude-opus-5/S11`: [1, 0, 0, 0, 0, 0]; SDK result submissions=1; recall tool calls=0.

Required per-turn reads are [1, 1, 1, 1, 1, 1]. Missing calls are neither fabricated nor credited.

### Output boundary check

Of 0 failed literal-answer phases, 0 had identity-correlated messages. Exact SDK → bridge text: not applicable; exact bridge → native text: not applicable. Failed requests with no completed answer are not successful fidelity comparisons. No final native message: 0; other uncorrelated messages: 0. Unavailable comparisons are not counted as successes. This checks output delivery, not prompt/history semantic equivalence. 148 raw JSON pointers were validated.

## Fresh local checks and reverification

- Full local regression suite: **192/192 passed**.
- Offline mechanical stress: 100 tool round trips/exact retries, ten queued cancellations and ten SDK recoveries passed; not elapsed-time endurance testing.
- Scenario design, generated docs, 75 syntax checks and whitespace checks passed. Commands and exit codes are in [local checks](local-checks.json).
- Raw evidence: `.runtime/stability-rerun-20260921/live`. Public artifacts contain new verdicts, redacted diagnostics and file hashes—not credentials, user configuration contents or raw request logs. Hashes provide local integrity evidence, not third-party attestation.
- The requested target is at least 74/77 (96.1%); goalThresholdPassed=false. fullMatrixPassed still requires 77/77. This latest run retains all its failures; older records are deleted before each live iteration. Hours-long endurance still needs a separate test.

```bash
node .runtime/stability-rerun-20260921/live/source-snapshot/scripts/stability.mjs \
  --verify .runtime/stability-rerun-20260921/live/report.json
# Expected exit: 1; evidenceIntegrity=true; fullMatrixPassed=false
```
