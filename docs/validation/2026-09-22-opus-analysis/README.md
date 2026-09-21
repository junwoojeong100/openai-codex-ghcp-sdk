# Opus / Sonnet analysis, source fixes and revalidation — 2026-09-22

[한국어: full analysis](README_KO.md) · [Verification index](../README.md) · [Reusable diagnostic](../../OPUS_DIAGNOSTICS.md)

## Findings

Matched fresh-session comparisons, repeated twice in reversed model order, yielded **Sonnet 4/4 exact-copy successes and Opus 4/4 explicit refusals** across direct SDK and production-manager routes. The client fixture prompt, tool schema and low effort were held fixed. The upstream Copilot Messages response explicitly contained `stop_reason: refusal` and `stop_details.category: reasoning_extraction`, with zero output tokens. SDK events normalized this to `content_filter`.

The previous full run's **S01 request payload, with its fields and text unchanged,** also reproduced that native category through the production manager. This establishes the reported refusal category, not why an owned synthetic-data copy request is classified that way, nor the user's intent. It does not prove the bridge defect-free or solve the upstream refusal.

The actual request bodies were **not identical except for model ID**. Differences included model identity in the SDK foundation, an additional Opus JSON/tool-string instruction, and per-request time text. Public protocol headers, tools, low adaptive thinking, omitted summaries, temperature 1 and max_tokens 32000 matched. Adding the Opus restriction to Sonnet, without removing any default instructions, still produced an exact-copy success. That instruction alone is not a sufficient explanation; model-specific interactions remain possible.

Six name-mapping probes ruled out merely restoring original tool names as a fix. A history-free direct SDK request also refused. Summary and SDK streaming option changes did not fix it; the native route remained HTTP streaming even with SDK streaming=false. Model discovery and inference were distinguished: a pre-discovery direct probe used Chat Completions, whereas the initialized model path used Anthropic Messages. Simple-tool controls returned both marker values but changed formatting, so their literal-output `mismatch` statuses were retained.

## Source fixes

- Monitor explicit root filtering for the whole session lifetime, not only an active HTTP waiter. Late filtering at tool handoff/idle now blocks cached success and result continuation.
- Recheck faults before fresh and cached response-handle commitment.
- Preserve the first fault when later SDK errors occur.
- Log only bounded lifecycle and usage metadata, never arbitrary provider strings or prompt/tool contents.
- Add an opt-in, bounded, pass-through wire observer covering both native refusal and Chat Completions formats, with privacy and byte/timeout tests. Unknown protocol data remains missing evidence, not an unfiltered success.

Six new regressions were demonstrated failing before their fixes. A total of 25 tests were added. Model IDs, low effort, permission denial, SDK foundation, fixture prompts and acceptance rules were not weakened. Delivered output and already-executed client tools cannot be retracted by a later signal.

## Results

| Validation | Result |
|---|---:|
| Baseline unit/regression | 223/223 |
| Final unit/regression | **248/248** |
| Real Codex + mechanical SDK compatibility | **18/18** |
| Real Codex + mechanical SDK stability | **11/11** |
| Fresh full live matrix | **66/77 (85.71%)** |

The ≥95% target is **not met**; it requires at least 74/77. No failed cell was excluded, replaced or regraded.

| Model | Passed |
|---|---:|
| gpt-5.6-sol | 11/11 |
| gpt-5.6-terra | 11/11 |
| gpt-5.6-luna | 11/11 |
| gpt-6-astra | 11/11 |
| claude-opus-5 | 0/11 |
| claude-sonnet-5 | 11/11 |
| claude-haiku-4.5 | 11/11 |

Offline stress passed 100 tool-result cycles, 100 exact retries, 10 cancelled waiters and 10 recovered generations, ending with no states, queued requests or listeners. Cleanup markers: 77/77. Markers do not override timeout/supervisor failures. Source/user settings remained unchanged: true/true. Current and frozen verification agree.

## Evidence and limitations

Native refusal categories come from separate explicitly unscored probes, including the exact captured S01 body. They are not retroactively assigned to every scored failure: `upstreamCategoryInScoredRun:null` preserves that distinction. The preliminary observer's missed native fields and control mismatches, and a temporary raw-probe empty-GET-body parser error with zero inference, are retained. New runs followed the diagnostic fixes; earlier results were not edited.

[Summary](summary.json) · [Failures](failure-analysis.json) · [Matched comparison and captured request](model-comparison.json) · [Diagnostic history](opus-diagnostics.json) · [Local checks](local-checks.json) · [Current/frozen verification](verification.json) · [Final audit](final-audit.json) · [Source hashes](source-manifest.json) · [Evidence hashes](evidence-manifest.json) · [SDK source review](dependency-source-evidence.json) · [Unsubmitted upstream report draft](UPSTREAM_REPORT.md)

Raw local evidence and executed comparison scripts: `.runtime/opus-analysis-20260922/`. Previous [65/77 and 66/77 runs](../2026-09-22-bridge-repair/README.md) remain unchanged. The reusable plan-only command is `npm run diagnose:opus`; actual diagnostic execution requires `-- --execute --output <new-directory>`. Full live revalidation is `npm run test:stability -- --execute --output <new-directory>`.

Contract: `bcb5958d066a1628552f059aecd6e4fb04808acab0d0443ec70075df6e1b23fd`

Implementation: `7cb34838fe930672c375fcf6a68e5c6bafb1ef07ddc253c6cb77f870f5a82402`
