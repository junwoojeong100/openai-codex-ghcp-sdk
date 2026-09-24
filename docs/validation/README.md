# Verification records

[한국어](README_KO.md) · [Guide map](../../README.md#testing) · [Stability contract](../STABILITY_TESTING.md)

**The recorded TUI matrix passed; the recorded stability matrices did not fully pass.** This archive describes named, dated runs, not the current worktree or future service availability. For commands instead of results, use the [guide map](../../README.md#testing).

**Jump to:** [Recorded results](#recorded-results) · [Read a result](#read-a-result) · [Recheck evidence](#recheck-evidence) · [Earlier runs](#earlier-runs).

## Recorded results

The latest retained summaries are dated **2026-09-23 KST**. Each row is a separate run or scope; do not combine its passing cases with another row. The abbreviated source hashes below identify recorded implementations, **not Git commits**.

| Check / profile | Recorded result | What remains unproved or failed | Record / source hash |
| --- | --- | --- | --- |
| Real TUI `v3` | **72/72 (100%), full pass** | Bounded TUI scenarios, not whole-product or multi-hour reliability | [Handoff release](2026-09-23-pending-handoff.json), `320d502c` |
| Stability, default `v5` | **57/66 (86.36%), not passed** | Nine Opus 5.5 upstream-filter failures; not pending-session 409 failures | [Handoff release](2026-09-23-pending-handoff.json), `320d502c` |
| Stability, optional `application-data-v3` | **62/66 (93.94%), not passed** | Two Opus filters and two Haiku literal-output failures | [Failure iterations](2026-09-23-failure-iterations.json), `0401d9d1` |
| Stability, optional `application-data-v4` | **65/66 (98.48%), not passed** | Opus S11 upstream filter remains. Meets the 95% reference, but exits 1 | [Failure iterations](2026-09-23-failure-iterations.json), `1f07ae19` |
| Focused completed-result handoff `v2` | **6/6**, separate live probe | Does not replace the 66-case stability or 72-case TUI matrix | [Focused probe](2026-09-23-pending-handoff.json) |
| Workflow compatibility `v6` | **No 108-case live result recorded here** | Offline workflow checks are not live-model compatibility | [Recorded scope](2026-09-23-failure-iterations.json) |
| Five-hour endurance | **Not established** | The long run was stopped before five hours; later smoke/terminal checks were bounded | [Paused run](2026-09-22-full-pass-investigation/README.md) · [Bounded checks](2026-09-23-six-model-switch/README.md) |

`application-data-v4` is an opt-in wording change, not a fix or regrade of the default v5 result. The provider's internal reason for the remaining filter is **unconfirmed**. The [diagnostic record](2026-09-23-failure-iterations.json) observed category `other`; an [earlier investigation](2026-09-22-opus-analysis/README.md) observed `reasoning_extraction`. Do not assign either diagnostic category to a matrix case without that case's evidence.

### Offline checks are separate

| Recorded check | Result | What it establishes |
| --- | --- | --- |
| Local unit/integration checks after the literal-file change | **448/448** | Local behavior; no live-model pass credit |
| Native stability with an SDK double | **11/11** | Harness behavior without model calls |
| Linux/macOS CI after the Linux repairs | **6/6 jobs** | Unit/coverage and offline Codex/PTY/browser, workflow and stability suites |

These counts come from the [iteration record](2026-09-23-failure-iterations.json), not one combined score. The [recorded successful CI run](https://github.com/junwoojeong100/openai-codex-ghcp-sdk/actions/runs/35872289448) followed a failed run; both are retained. Publication was later explicitly authorized despite the failed stability release gate; [the original gate and override](2026-09-23-pending-handoff.json) remain separate facts.

## Read a result

In a newly generated `report.md`, read **Result → Per-model results → Cases needing attention**. Expand **Complete matrix** for every case. Case links lead to recorded artifact directories; a missing link means no case artifact path was recorded. The Markdown view does not verify its own evidence.

| Field or term | Meaning |
| --- | --- |
| `executionKind` | `live` uses real models; `offline-self-test` uses SDK doubles. A plan executes no cases. |
| `catalogId` / `profile` | The versioned test rules and task wording. Different contracts/profiles are not interchangeable. |
| `passed` / `totalCases` | Passing cases over the full declared matrix. Failed, blocked, unsupported, timed-out and not-run cases stay in the denominator. |
| `fullMatrixPassed` | All required live cases and run-level conditions passed. A high percentage alone is insufficient. |
| `thresholdMet` | TUI's separate 95% target: 69/72 in an eligible complete run. It is not a full pass. |
| `evidenceIntegrity: true` | The verifier accepted the evidence and recomputed result. It does **not** mean the tested behavior passed. |
| `implementationHash` / `sourceHash` | A source fingerprint. Use the matching saved source; this is not a commit ID or third-party attestation. |
| Coverage | Source coverage, the 75% reviewer checklist design score and live pass rate are different metrics. Measured product coverage remains **unknown/null**. |

For example, stability **65/66**, `evidenceIntegrity: true`, `fullMatrixPassed: false` and exit **1** are consistent: **valid evidence of a non-passing run**. `--verify` checks evidence; it neither reruns failed cases nor turns them into passes. Invalid evidence or arguments produce exit 2 in the matrix runners.

## Recheck evidence

| Location | Contents and use |
| --- | --- |
| `docs/validation/` | Published summaries, hashes and selected diagnostics. A summary is **not** a complete runner report. |
| `.runtime/<run>/report.md` | Readable generated view, where the runner supplies one. |
| `.runtime/<run>/report.json` and `cases/` | Original matrix and case artifacts required for independent recomputation. |
| `.runtime/<run>/source-snapshot/` | Automatically saved by stability and TUI (also terminal/soak). Workflow compatibility does **not** create this directory; retain its exact source separately. |

Raw `.runtime` directories are ignored by Git and are **not supplied by cloning this repository**. A published JSON summary or file hash alone cannot reproduce a verification. You need the original complete run directory; do not pass a summary to `--verify` or substitute another run's artifacts.

With the original directory and matching source/dependencies available, follow the instructions for [workflow compatibility](../COMPATIBILITY_TESTING.md#read-the-result), [stability](../STABILITY_TESTING.md#evidence-and-exit-codes) or [TUI](../TUI_SCENARIOS.md#verify-an-older-run-and-read-exit-codes). Verification makes no model calls. Without those inputs, independent recomputation is unavailable; a new live run requires a new directory, explicit execution and Copilot usage. Terminal/soak runners and Opus diagnostics do not have a separate `--verify` mode.

## Earlier runs

Each link retains its detailed results, failures, changes, source identities and evidence references. Equal totals can describe different cases. Old contracts are not regraded against current rules, and the seven-model 77-case results are not six-model 66-case results.

| Date (KST) | Record | Result or finding in that record |
| --- | --- | --- |
| 2026-09-23 | [First-progress watchdog / TUI v3](2026-09-23-first-progress.json) | Separate **72/72** run; offline first progress delayed for 95 measured seconds |
| 2026-09-23 | [TUI connection v2](2026-09-23-tui-connection-v2/README.md) | First **45/72**, then a separate **72/72**; initial failures retained |
| 2026-09-23 | [TUI v1](2026-09-23-tui-scenarios/README.md) | **70/72**, target met but not a full pass; Sol/Luna U03 refusals retained |
| 2026-09-23 | [Six-model switch and MCP isolation](2026-09-23-six-model-switch/README.md) | Default v4 **57/66**; optional application-data-v2 **63/66**; neither fully passed |
| 2026-09-23 | [Terminal integration, seven-model contracts](2026-09-22-terminal-integration/README.md) | Default v3 **66/77**; optional application-data-v1 **72/77** |
| 2026-09-22 | [Tool-result description repair](2026-09-22-runner-repair/README.md) | Optional application-data-v1 **74/77**; 95% target met, three failures and exit 1 retained |
| 2026-09-22 | [Further failure-boundary investigation](2026-09-22-fidelity-followup/README.md) | New **50/77** run, not the same cases as the preceding 50/77; output/filter/cleanup failures retained |
| 2026-09-22 | [Optional-profile closeout](2026-09-22-opus-closeout/README.md) | **50/77**; unresolved; further experiments stopped at the user's request |
| 2026-09-22 | [Full-pass investigation and paused soak](2026-09-22-full-pass-investigation/README.md) | Five-hour work stopped before completion; not endurance certification |
| 2026-09-22 | [Opus/Sonnet comparison](2026-09-22-opus-analysis/README.md) | Separate **66/77** matrix; diagnostic Sonnet 4/4 copies versus Opus 4/4 refusals |
| 2026-09-22 | [Bridge repair](2026-09-22-bridge-repair/README.md) | **66/77**; earlier **65/77** and its process-exit timeout also retained |
