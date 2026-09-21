# v4 live verification results — 2026-09-21

[한국어](README_KO.md) · [126-case result JSON](summary.json) · [Failure details](FAILURES.md) · [Evidence hashes](evidence-manifest.json) · [Scenarios](../../NATIVE_SCENARIOS.md)

**100/126 passed (79.4%), 26 failed, in 722.935 seconds (~12m 2.9s).**
Unsupported: 0; blocked: 0; timed out: 0; not run: 0.

**This is not a full matrix pass.** Failed cells were neither removed from the denominator nor replaced with reruns.
Models earning this version's 18/18 workflow verdict: **gpt-6-astra**. Other models remain `not-established`.

The pass rate is an observation of this synthetic workflow matrix. The reviewer checklist **75% is a design score**, **90% is a target**, and measured product-feature coverage remains **unknown/null**. OpenAI-provider parity was not measured.

## Run metadata and frozen criteria

- Run ID: `3dffb267-558d-4290-ba3c-67bbdcf0d42a`
- KST: 2026-09-21T12:09:02.244+09:00 → 2026-09-21T12:21:05.171+09:00
- Contract: `codex-ghcp-workflows-18-v4`; Codex `0.154.0`; Copilot SDK `1.0.14`.
- Seven exact models × 18 scenarios; up to 4 model lanes. Per-case limits retained; no global cutoff, model substitution, subset or case retry.
- The catalog and implementation were frozen after documentation cleanup and local checks. Prompts, oracles and acceptance were not changed during execution or after observing results.
- `implementationUnchanged=true`, `userSettingsUnchanged=true`, `interrupted=false`.
- Owned process-group cleanup receipts: 126/126.
- Working-tree base commit: `57f0658d2dfb75628963ed580f8c84c855558f7b`. The pre-run snapshot and [source hashes](source-manifest.json) preserve the executed uncommitted work.

## Per-model results

| Model | Passed | Non-passing scenarios | Verdict |
|---|---:|---|---|
| gpt-5.6-sol | 16/18 | C03, C17 | not-established |
| gpt-5.6-terra | 16/18 | C10, C17 | not-established |
| gpt-5.6-luna | 15/18 | C03, C04, C18 | not-established |
| gpt-6-astra | 18/18 | — | v4-compatible |
| claude-opus-5 | 13/18 | C07, C11, C14, C15, C18 | not-established |
| claude-sonnet-5 | 11/18 | C03, C08, C10, C11, C12, C15, C18 | not-established |
| claude-haiku-4.5 | 11/18 | C03, C06, C10, C11, C14, C15, C18 | not-established |

`v4-compatible` means only the 18 workflows in this versioned contract, not whole-product support.

## Per-scenario results

| Scenario | Workflow | Passed/7 |
|---|---|---:|
| C01 | CLI startup, exact routing and Unicode streaming | 7/7 |
| C02 | AGENTS instructions, skill execution and untrusted input | 7/7 |
| C03 | Repository exploration, code understanding and Git-diff review | 3/7 |
| C04 | Multi-file refactoring, creation, move, deletion and Git safety | 6/7 |
| C05 | Reproduce failure, debug, fix and regression test | 7/7 |
| C06 | Function tools, MCP resources/tools and error recovery | 6/7 |
| C07 | Approval denial, narrow grant and bypass prevention | 6/7 |
| C08 | Filesystem/network sandbox and resource cleanup | 6/7 |
| C09 | Conversation memory, revised instructions and session isolation | 7/7 |
| C10 | Resume after restart without replayed side effects | 4/7 |
| C11 | Production launcher defaults and process lifecycle | 4/7 |
| C12 | Native reviewer entry point | 6/7 |
| C13 | Plan mode and user clarification round trip | 7/7 |
| C14 | Longer context, native compaction and fresh-process resume | 5/7 |
| C15 | Interrupt an active turn, clean owned work and continue | 4/7 |
| C16 | HTTP MCP, bearer authentication and error recovery | 7/7 |
| C17 | Native subagent delegation and result collection | 5/7 |
| C18 | Transient HTTP retry without duplicate execution | 3/7 |

## Remaining failures and evidence

[Failure details](FAILURES.md) record every non-passing cell's original check IDs, observed symptoms and raw file/event locations. [summary.json](summary.json) preserves all verdicts, including passing cells and efficiency diagnostics.
Key observations, all retaining their original failed verdicts:

- **Value/workflow mismatches:** incorrect review line numbers in C03, `total()` still returning 1 in C04, the omitted required error lookup in C06, and a failed first spawn followed by a second spawn in C17.
- **Literal preservation:** three C10 cells lost the `receipt:` prefix. Ten C11/C14/C15/C18 cells included the value but added prose/backticks/fences, failing the exact-output requirement.
- **Missing final results:** Opus C07/C14 ended with a content-filter message; Luna C18 refused the fixture read. These messages are not an independent diagnosis of service internals.
- **Test-shape limitations:** Haiku C03's `./` prefix, Sonnet C08's unrecognized `cd … &&` probe command, and Sonnet C12's overall exit 1 after a valid diff also remain failed. Sonnet C03 returned correct JSON but lacked an actual uncommitted diff.

Observed symptoms are distinct from root-cause attribution. Original `undetermined` categories are retained; no model, bridge or harness fault is asserted without additional evidence. Successful-sounding final prose does not override failed tool/file evidence.

## Pre-run local checks

- `npm test`: **134/134**.
- `npm run test:compatibility:runtime`: **18/18**, real Codex + mechanical SDK peer; **0** real-model calls.
- `npm run test:scenarios`, `npm run docs:scenarios:check`, `npm run test:compatibility -- --plan`: **exit 0**.
- JavaScript syntax checks: **56 files passed**.
- The initial restricted sandbox denied loopback binding (`EPERM`), failing 11 unit tests and the runtime check. Those logs are preserved; the approved host rerun established the results above. These were offline harness checks, not live-case retries.
- [Local-check records and log hashes](local-checks.json). Offline successes are not included in the live pass rate.

## Reverification and evidence retention

Raw evidence is retained at `.runtime/workflows-18-v4-20260921/live`. Full transcripts contain machine-specific paths and are not published in the redacted summary. Hashes alone cannot independently re-evaluate observations and are not third-party attestation.

```bash
npm run test:compatibility -- --verify .runtime/workflows-18-v4-20260921/live/report.json
# Frozen pre-run source (same dependencies required)
node .runtime/workflows-18-v4-20260921/source-snapshot/scripts/compatibility.mjs \
  --verify .runtime/workflows-18-v4-20260921/live/report.json
```

Verification returns `evidenceIntegrity=true`, `fullMatrixPassed=false`. Exit code 1 reflects non-passing cells, not corrupt evidence. After implementation changes, use the preserved runner instead of regrading this run with new criteria.

- Catalog SHA-256: `1288898be512fc016d607cdcb870d895ed031c41f03377daadc28b0600ac9fd1`
- Implementation SHA-256: `30f3bf3b58ebd563827de6b1a351bc975b32fb5549911befeb9190fad62bdd96`
- Raw report SHA-256: `1b97ba07c86118b56af45c732956ce03439e9a0a603ca4d816dca5c455f554c3`
- [Raw evidence manifest](evidence-manifest.json) · [Frozen source manifest](source-manifest.json) · [Final audit](final-audit.json)

The historical [core-10 57/70](../2026-09-21/README.md) and local v3 86/126 records are preserved. Different contracts are not pooled into v4 or treated as a directly comparable pass-rate improvement.
