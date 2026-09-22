# Bridge and terminal-runner integration

[한국어](README_KO.md) · [Verification index](../README.md) · [Terminal commands](../../SOAK_TESTING.md)

## Result

Implementation and execution were completed, but **neither live matrix passed 77/77**. Both final runs contain all seven models and all 11 unchanged scenarios. Failed cells were not retried selectively, replaced, removed, or combined across profiles.

| Model | Default v3 | Separate application-data-v1 |
|---|---:|---:|
| gpt-5.6-sol | 11/11 | 11/11 |
| gpt-5.6-terra | 11/11 | 11/11 |
| gpt-5.6-luna | 11/11 | 11/11 |
| gpt-6-astra | 11/11 | 11/11 |
| claude-opus-5 | 0/11 | 9/11 |
| claude-sonnet-5 | 11/11 | 8/11 |
| claude-haiku-4.5 | 11/11 | 11/11 |
| **Total** | **66/77 (85.71%)** | **72/77 (93.51%)** |

Both verification passes reported `evidenceIntegrity=true` against the current and frozen implementation. Both preserve `fullMatrixPassed=false` and exit code 1. The older independent 74/77 result remains historical; it is not the result of this implementation. The previously recorded 95% target was **not met by these final runs**.

## Implementation

- Added progress-aware inactivity and bounded session-setup failures to the bridge. Root reasoning/tool-input fragments count as activity without being exposed as output.
- Connected the actual PTY lane to the soak worker. Added the repository-owned `test:terminal` command and `--terminal-driver playwright` using real xterm.js rendering, not simulated assistant output.
- Shared the PTY lifecycle and response checks across both terminal drivers. SDK identity/output corroboration, source freezing for HTML/Python, explicit live opt-in, and bounded terminal/browser cleanup are included.
- Preserved SDK foundation, approval/sandbox boundaries, model IDs, the 11-scenario contracts and their oracles. No content-filter bypass or inference retry was added.

## Failure discovered by extra live validation

The first standalone Astra PTY run failed its completion deadline even though the SDK and SSE had already completed with the correct marker. Codex used an ANSI scrolling region above its composer. The independent terminal parser ignored that region and subsequently erased the valid marker while updating the footer.

A new regression first reproduced that failure. The parser now handles scrolling margins, line insertion/deletion, reverse index and alternate-buffer margin restoration. Replaying the **exact original terminal bytes** recovered the marker without changing the model response. A fresh equivalent real-model run then passed.

The failed run is preserved in [additional-live.json](additional-live.json). The preliminary pre-fix v3 matrix is separately preserved in [preliminary-v3.json](preliminary-v3.json). After the parser fix, both entire final matrices were executed anew; no preliminary success cell was reused.

Final cleanup review also reproduced a late browser-input rejection writing an already-closed evidence descriptor after an unexpected PTY exit. The probe now marks itself stopped before closing evidence, and a deterministic regression covers the late callback. The earlier complete post-scroll matrices are retained in [post-scroll-v3.json](post-scroll-v3.json) and [post-scroll-application-data-v1.json](post-scroll-application-data-v1.json); the release matrices were executed in full again after this final code change.

Long-duration workload generation was then made lazy: the maximum accepted duration/payload no longer preallocates gigabytes of unused prompts. Its bounded-allocation regression and a fresh large-message live Playwright run passed. The post-cleanup matrices remain in [post-cleanup-v3.json](post-cleanup-v3.json) and [post-cleanup-application-data-v1.json](post-cleanup-application-data-v1.json); the published final matrices were run in full on the lazy-generation source. These successive builds are preserved rather than selecting their best scores.

## Remaining live failures

- **Default v3:** all 11 Opus cases observed explicit upstream SDK content-filter signals. The bridge reported these failures and cleaned its resources.
- **Application-data-v1, Opus S10/S11:** explicit upstream filtering during recall/repetition.
- **Application-data-v1, Sonnet S03/S07:** actual SDK answers omitted the required `value:` / `receipt:` labels. These are literal-output failures, not failures repaired by rewriting model output.
- **Application-data-v1, Sonnet S11:** only one `read_fixture` call was observed across six required read turns. Returning remembered values did not satisfy the six-call oracle.

All final failed cases retained their cleaned-resource/process-group receipts. The evidence does not establish the upstream filter's internal cause or certify universally correct model behavior.

## Additional verification

| Check | Result / scope |
|---|---|
| Offline unit/controller suite | 317/317; no model calls |
| Native compatibility runtime | 18/18; mechanical SDK |
| Context/TUI runtime | 8/8; mechanical SDK |
| Integrated PTY/Playwright runtime | 7/7; includes started-terminal cancellation, supervised cleanup and startup failure |
| Stability runtime | 11/11 v3; separate from live scores |
| Fresh live Astra PTY after parser repair | Passed; correct visible and SDK-confirmed responses, duration and cleanup |
| Live Sonnet Playwright, 24 KiB samples and 1,000-word requests | Passed; actual output size and markers checked |
| Combined native + Playwright smoke | All three lanes completed without observed failures |
| Final combined native + PTY smoke | All three lanes completed without observed failures |
| Deliberate live Playwright cancellation | Expected interruption verified after real inference; partial-duration run remained `passed=false`, with terminal/browser processes gone |
| Final lazy large-message Playwright workload | Passed; only current/next input is generated instead of the full long-duration payload queue |

These are bounded checks, **not a new two-hour/overnight or five-hour reliability certificate**. Smoke reports intentionally do not claim the five-hour `durationMet` flag.

## Evidence and reproduction

- [Final v3: all 77 case outcomes, checks and artifact hashes](final-v3.json)
- [Final application-data-v1: all 77 case outcomes, checks and artifact hashes](final-application-data-v1.json)
- [Combined summary](summary.json) · [Additional live runs](additional-live.json)
- [Final source manifest](source-manifest.json) · [Local checks](local-checks.json)

The committed JSON is a sanitized publication ledger, not the raw `--verify` input. Full SDK/native/HTTP artifacts remain in the listed ignored `.runtime` directories. Verification was performed against those complete artifacts; hashes are traceability records, not independent certification.

```sh
npm ci
npx --no-install playwright install chromium
npm test
npm run test:terminal:runtime
npm run test:stability -- --execute --output .runtime/new-full-v3
npm run test:stability -- --execute --profile application-data-v1 --output .runtime/new-full-application
npm run test:stability -- --verify .runtime/new-full-v3/report.json
```

Use the saved `source-snapshot/scripts/stability.mjs` to verify a run after source changes. Real execution consumes Copilot usage and requires the exact models to be available.
