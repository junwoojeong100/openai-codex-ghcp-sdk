# Opus upstream-response diagnostics

[한국어](OPUS_DIAGNOSTICS_KO.md) · [Guide map](../README.md#testing) · [Stability contract](STABILITY_TESTING.md)

Use this when Opus returns `upstream_content_filter` and you need evidence beyond the error label. This opt-in diagnostic compares **upstream protocol responses with SDK events**; a generic `content_filter` event alone does not explain the root cause. It neither replaces nor regrades a stability-matrix case.

## Run

Run from the repository root after `npm ci`. No Codex CLI or browser is required. Choose the plan to inspect the probes, or live execution to collect evidence.

### Plan

**No model calls or Copilot login.** This default mode describes the probes without running them:

```sh
npm run diagnose:opus
```

### Live diagnostic

**Consumes Copilot usage.** This mode requires Copilot SDK **1.0.14** and an authenticated account with access to `claude-opus-5.5`. Run `./bin/ghcp-models` first and confirm that model is neither `disabled` nor `not available`. If catalog access fails, use [authentication troubleshooting](USAGE.md#startup-and-configuration).

Use a new or empty evidence directory; existing reports cannot be overwritten:

```sh
npm run diagnose:opus -- --execute --output .runtime/opus-diagnostic-new
```

Each of the seven probes runs in a fresh session and appears in the report under its `id`:

| Probe `id` | Route | What it sends |
| --- | --- | --- |
| `sdk-exact-fixture` | Direct SDK | The unchanged v4 fixture prompt |
| `bridge-exact-fixture` | Production bridge manager | The same prompt |
| `sdk-exact-nonstreaming` | Direct SDK | The same prompt with SDK `streaming: false` |
| `sdk-exact-default-summary` | Direct SDK | The same prompt with the SDK's default reasoning summary; other probes send `reasoningSummary: "none"` |
| `sdk-simple-tool-control` | Direct SDK | Control: call `read_fixture` once and return its result |
| `bridge-simple-tool-control` | Production bridge manager | The same simple-tool control |
| `sdk-arithmetic-control` | Direct SDK | Control: an arithmetic question with no tool |

Control wording is diagnostic only; it never replaces production requests or any of the 66 stability cases. The model, low reasoning effort, SDK protective instructions and provider filter policy stay unchanged. Every permission request is rejected; the only tool action returns a synthetic string generated in memory. There are no automatic retries, fallback models or user-setting changes. Earlier findings for `claude-opus-5` remain historical.

Filtering, literal-output mismatches, errors or cleanup failures give exit code 1. Exit code 0 still does not mean the stability matrix passes.

## Read the evidence

Open `.runtime/opus-diagnostic-new/report.json` (or the output directory you chose), **including when execution exits with code 1**. This diagnostic has no `--verify` mode; inspect the saved evidence before deciding to run another live diagnostic.

Start with each entry in `cases`:

| `status` | Meaning |
| --- | --- |
| `completed` | The probe met its output and tool-submission checks. |
| `filtered` | The SDK or bridge reported an explicit upstream filter. This does not explain the provider's reason. |
| `mismatch` | The returned output or tool-submission count did not meet the probe's checks. |
| `error` | The probe encountered an execution error; inspect `errorCode`. |
| `not-run` | The probe did not execute; it is not a pass. |

Also check `cases[].cleanup[].passed` and the report's `implementationUnchanged`. A completed response alone is not a successful diagnostic run, and a successful diagnostic is not a matrix pass.

For the provider investigation, the report distinguishes:

- Chat Completions `finish_reason: content_filter`.
- Anthropic Messages `stop_reason: refusal` and allowlisted `stop_details.category`.
- SDK `contentFilterTriggered` / `finishReason`.
- Bridge lifecycle phase, pending-call count and tool-result submission count.

Provider categories are **per-run observations, not a confirmed root cause**:

| Record | Observed category |
| --- | --- |
| [2026-09-22 investigation](validation/2026-09-22-opus-analysis/README.md) | `reasoning_extraction` |
| [2026-09-23 diagnostic](validation/2026-09-23-failure-iterations.json) | `other` in all four exact-fixture probes |

Neither category proves user intent or explains why the provider filtered the synthetic copy task. The remaining S11 matrix failure has no recorded native refusal category; do not fill it in from these separate probes. The diagnostic does not rewrite requests to avoid a category or disable protective instructions.

Model discovery can also pass through the SDK request handler. `observedHttpRequests` therefore differs from `observedInferenceRequests`, which requires the exact model in the request. SDK `streaming:false` does not guarantee nonstreaming HTTP on every provider route: inspect the observed `wire[].request.streaming`. An unknown response format has `explicitBlock:null`—missing evidence, not evidence of an unfiltered inference.

Simple-tool controls retain `status:mismatch` when the two literal fixture lines change formatting. `fixtureValuesPreserved:true` is a separate diagnostic, not an exact-copy pass.

## Privacy and limitations

The observer forwards the original `Request` and `Response` unmodified. It reads only copies, capped at 256 KiB and 45 seconds, recording `complete:false` on incomplete capture. Headers, credentials, prompts, tool outputs, response prose and provider explanations are never saved: only hashes, counts and allowlisted protocol fields survive.

The bridge monitors root filtering for the entire session lifetime, including between HTTP requests. A late signal cannot retract delivered text or a tool already executed by the client, but it prevents subsequent cached success, tool-result continuation and response-handle commitment. Subordinate-agent events and filter-looking prose do not become root failures.
