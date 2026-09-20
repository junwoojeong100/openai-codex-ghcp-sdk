# Live verification results — 2026-09-21

[한국어](README_KO.md) · [70-case result JSON](summary.json) · [Evidence hashes](evidence-manifest.json) · [Scenarios](../../NATIVE_SCENARIOS.md)

**All 70 live cases completed: 57 passed, 13 failed, in 450.686 seconds (~7m 31s).** No blocked, unsupported, timed-out or unrun cells.

This is not a full pass. No model achieved 10/10, so none earns `core-10-compatible`. The 90% figure is an everyday-workflow design target, not measured product coverage.

## Run metadata

- Run ID: `4b7856b2-0183-49ac-acea-92ca26b130a2`
- KST: 2026-09-21 00:35:58.141 → 00:43:28.804
- Codex: `0.154.0`; Copilot SDK: `1.0.14`
- One suite: ten workflows × seven GHCP models. No reference-provider run, fast suite, subset or case retries.
- Up to four model lanes; per-case deadlines, no overall cutoff.
- Saved evidence independently re-evaluated with integrity verified. Implementation and observed user settings stayed unchanged; no interruption.

## Original per-model verdicts

| Model | Passed | Failed | Failed scenarios |
|---|---:|---:|---|
| gpt-5.6-sol | 9/10 | 1 | C03 |
| gpt-5.6-terra | 9/10 | 1 | C03 |
| gpt-5.6-luna | 9/10 | 1 | C03 |
| gpt-6-astra | 9/10 | 1 | C03 |
| claude-opus-5 | 8/10 | 2 | C03, C05 |
| claude-sonnet-5 | 6/10 | 4 | C03, C04, C05, C10 |
| claude-haiku-4.5 | 7/10 | 3 | C03, C04, C10 |

## Per-workflow results

| Scenario | Workflow | Passed/7 |
|---|---|---:|
| C01 | CLI startup, exact routing and Unicode streaming | 7/7 |
| C02 | AGENTS instructions, skill execution and untrusted input | 7/7 |
| C03 | Repository exploration, code understanding and Git-diff review | 0/7 |
| C04 | Multi-file refactoring, creation, move, deletion and Git safety | 5/7 |
| C05 | Reproduce failure, debug, fix and regression test | 5/7 |
| C06 | Function tools, MCP resources/tools and error recovery | 7/7 |
| C07 | Approval denial, narrow grant and bypass prevention | 7/7 |
| C08 | Filesystem/network sandbox and resource cleanup | 7/7 |
| C09 | Conversation memory, revised instructions and session isolation | 7/7 |
| C10 | Resume after restart without replayed side effects | 5/7 |

## Failure interpretation and test limitations

- **C03 (all models):** Strict JSON-only and field-type requirements are a major observed cause. The prompt `empty (empty.txt)` does not clearly demand a boolean. Markdown fences can fail otherwise correct content. The command regex also fails to recognize valid `git -c ... diff` syntax. These failures do not establish that all models cannot understand code or that the bridge is defective.
- **C04 (Sonnet/Haiku):** Both emitted ten tool items against a nine-item limit. Sonnet passed the functional file assertions. Haiku also retained the original `notes.txt` after creating the destination (copy rather than move), failing the functional condition.
- **C05 (Opus/Sonnet):** Actual failing logs, three passing post-fix tests and passing independent inputs exist. Piping `node --test` through `tail` changed the initial shell exit to zero, failing the required nonzero exit evidence. This is not evidence that the bug fix itself failed.
- **C10 (Sonnet/Haiku):** The nonce survived resume but the counter receipt lost its literal `receipt:` prefix. Exact-value restoration failed; the no-replay assertion passed.
- All 13 original cause categories remain `undetermined`. No uncontrolled claim assigns the cause to model, bridge or test design. Prompts/oracles were not relaxed after observing results and failed cells were not rerun to improve scores.

## Reproduction and evidence retention

Raw evidence (~53 MiB) is retained in the local folder below. This repository publishes all 70 check outcomes and raw file hashes instead of personal paths, credentials or full transcripts. Hashes alone cannot independently re-evaluate the raw evidence.

```bash
npm run test:compatibility -- --verify .runtime/workflows-live-20260921-003558/report.json
```

Verification returns `evidenceIntegrity: true`, `fullMatrixPassed: false`. Exit code 1 reflects failing cells, not an integrity error.

- Catalog SHA-256: `9013014390f817fd7af5bc12d1b8b89dcf36ca3a42ecffa3441bd35173836339`
- Implementation SHA-256: `afb98c1f714968fcbc194a24bc6cd99cd78193a26268adf1649c3dbb6d0515c8`
- Raw report SHA-256: `f12e773d90bba8ef230278d28414eb402eab2e296db07fe783e894684e2fa224`

Retired scenarios, runners, reports and earlier run artifacts are removed. This new raw result is preserved; Git history is not rewritten.
