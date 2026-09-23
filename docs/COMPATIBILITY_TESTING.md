# Integrated compatibility verification

[한국어](COMPATIBILITY_TESTING_KO.md) · [Scenarios and checklist](NATIVE_SCENARIOS.md) · [Product boundaries](COMPATIBILITY.md)

## Current contract and verification records

`codex-ghcp-workflows-18-v6` (schemaVersion 6): **18 scenarios × six exact GHCP models = 108 cases**. Matrix dimensions, report denominators and documentation are derived from the catalog. There is one full suite, no live subset, no automatic case reruns and no native OpenAI baseline. Runtime verification uses Node 22.12+; the bridge's application engine requirements are unchanged.

Historical v5 108-case and v4 126-case reports verify only with their original runner revision. See the [verification records](validation/README.md). The separate 11-scenario stability contract cannot be credited as a pass of this 18-workflow contract.

v6 corrects three Linux verification assumptions without relaxing the OS sandbox. C05 explicitly runs `node --test --experimental-test-isolation=none`: the same three immutable tests execute in one Node process, avoiding the pinned sandbox's loss of captured child-stdio ([upstream issue](https://github.com/openai/codex/issues/18473)). The oracle still requires the real failing and passing exits, all three tests and independent inputs. C08 writes its unchanged measurements directly to stdout's file descriptor instead of the affected Node stream. C15 maps the receipt's namespace PID to a unique descendant of the owned native host with the same working directory before checking that the host process exits; it never probes host PID 2 on the assumption that a sandbox PID is global. Old failed runs are preserved, not regraded.

## Three separate metrics

1. **Checklist design scope:** 20 reviewer-defined, equal-weight feature groups; direct=1, partial=0.5, uncovered=0. Current score **75%** (12 direct, six partial, two uncovered). “Direct” means a representative implemented probe, not a successful or exhaustive feature.
2. **Live matrix pass rate:** passed cells divided by **108**, plus model-specific results out of 18. Missing/unsupported/blocked/timed-out cells stay in the denominator. A model needs all 18 workflows to pass for the versioned compatibility verdict.
3. **Measured product coverage:** **unknown/null**. The checklist is not an OpenAI metric, a usage-frequency survey or a product support percentage. **90% remains a target**, not a result.

Reports also show feature-group evidence per model. Offline runs never establish live feature evidence. Partial scope remains partial even if its linked scenarios pass.

## Checks without live inference

```bash
npm test
npm run test:scenarios
npm run docs:scenarios:check
npm run test:compatibility -- --plan
npm run test:compatibility:runtime
```

Unit tests use synthetic evidence, owned subprocesses and loopback HTTP. The runtime check uses **real Codex 0.154.0 + mechanical SDK peers**, not real models. C11 starts the actual launcher and child bridge with explicit, offline-labelled observation instrumentation and isolated credentials. A valid OS sandbox is required. Runtime success is a harness check, never live compatibility credit.

## New native paths

- **C11:** actual `bin/codex-ghcp`, production bridge lifecycle and default tool catalog; no injected `model_catalog_json`/patch profile. This does not certify interactive `/model` or every reasoning effort.
- **C12:** native `review/start` and reviewer lifecycle, not a review-like prompt. If the native reviewer requires structured output unsupported by the bridge, that is an **unsupported** case, not a pass.
- **C13:** native Plan collaboration mode and a correlated user-input callback. A hidden host answer must reach the final plan without edits.
- **C14:** ≥12 KiB of history, explicit native local compaction and fresh-process resume. Not maximum-context, automatic/remote compaction or soak certification.
- **C15:** interrupt an observed in-flight owned command, explicitly clean background terminals, prove its process exited and continue on the same thread.
- **C16:** owned Streamable HTTP MCP endpoint, temporary bearer authentication, unauthorized rejection, discovery/resources and error recovery. Not external OAuth or plugin installation.
- **C17:** native spawn/wait/close lifecycle for one read-only child, with distinct thread and SDK sessions.
- **C18:** one marked 503 before inference, one bounded native HTTP retry and no duplicate SDK prompt/tool execution. Not retrying a failed case or a mid-stream response.

C03 now explicitly specifies field types and distinguishes semantic JSON checks from presentation (bare JSON or one JSON fence). `git -c ... diff` is recognized. C05 requests standalone test commands so pipelines cannot mask the failing exit. Tool-call targets are **efficiency diagnostics**; a separate higher hard cap bounds runaway execution.

## Evidence interpretation (fixed before execution)

- C12 reads the native completed review's rendered findings or JSON. It still requires exactly one actionable finding at `review.mjs:3`, an actual diff read, the correlated reviewer lifecycle and unchanged files.
- C13 reads the authoritative completed native `plan` item, not an incidental assistant message. The hidden host answer must be correlated and appear in the final plan; only read-only exploration is allowed, with no edits, mutating commands or broad permission grant.
- Git-diff evidence recognizes grouped shell invocations and Git global options, but a quoted `git diff` string is not execution evidence. Negative tests reject wrong paths/turns, extra findings, missing diffs and uncorrelated or unsafe plans.
- These C12/C13 and Git rules were fixed for v4 and carry over unchanged to v6; they are not post-run exceptions. The C05 command and C15 host-PID evidence changes are explicitly versioned above. Freeze catalog and implementation hashes before live execution; preserve failures and do not rerun cells to improve the score.

## Live execution: explicit opt-in and usage

Copilot authentication is required and inference consumes usage. No OpenAI API key is needed.

```bash
npm run test:compatibility -- --execute
npm run test:compatibility -- --execute --output .runtime/compatibility-new-run
npm run test:compatibility -- --verify .runtime/compatibility-new-run/report.json
```

The default is offline `--plan`. Existing output folders are never overwritten. An unavailable model retains 18 blocked cells. Shared prerequisite failure retains all 108 cells. Failures do not skip subsequent cases. User interruption stops scheduling and preserves incomplete evidence.

Up to four model lanes run concurrently. Each case includes preparation, native/model/tool work and an eight-second cleanup reserve. The sum of worst-case slots is 2,220 seconds/model; including preflight and two scheduling waves gives **75.5 minutes**, excluding I/O/OS overhead. One hour is a target, **not a global cutoff**. Normal runs need not consume every deadline.

## Isolation and evidence

All fixtures have private temporary homes, immutable user-dirty/Git state and explicit mutation allowlists. Native shell environments exclude upstream authentication. Unknown callbacks are denied. Only the exact owned approval helper and scoped fixture MCP operations can be consented. A request-user-input response is supplied only to the C13 fixture question. No blanket permission or external OAuth grant is made.

C11 instrumentation wraps the actual SDK and HTTP boundaries in live mode without changing production arguments or metadata. Only offline mode replaces the SDK, and that mode is checked when reading evidence. Temporary MCP credentials are not retained in headers/evidence. Owned processes, servers and SDK sessions must be cleaned.

Reports retain native JSONL, HTTP/SSE, SDK, state, assertion, cleanup and scenario-specific evidence. Verification checks contract and implementation hashes, every matrix slot, artifact ownership/hashes, recomputed assertions and metrics. Hashes are not third-party attestation. Inspect evidence for private information before publishing; raw evidence can stay under ignored `.runtime`.

Exit codes: `0` valid plan or **108/108** live pass; `1` failed/blocked/unsupported/incomplete matrix; `2` invalid arguments or evidence. A runtime self-test has its own non-live verdict.
