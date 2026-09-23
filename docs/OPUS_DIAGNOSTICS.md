# Opus upstream-response diagnostics

[한국어](OPUS_DIAGNOSTICS_KO.md) · [Stability contract](STABILITY_TESTING.md)

This opt-in diagnostic correlates **upstream protocol responses with SDK events**, rather than treating a generic `content_filter` event as a root-cause explanation. It neither replaces nor regrades a stability-matrix cell.

## Run

```sh
# Plan only; zero model calls.
npm run diagnose:opus

# Actual claude-opus-5.5 calls; requires a new or empty evidence directory.
npm run diagnose:opus -- --execute --output .runtime/opus-diagnostic-new
```

The pinned Copilot SDK 1.0.14 and existing Copilot access to `claude-opus-5.5` are required. Earlier refusal/filter findings for `claude-opus-5` remain historical. Seven fresh sessions compare the unchanged v4 fixture prompt through the direct SDK and production manager, SDK streaming/summary options, separate simple-tool controls on both routes, and an arithmetic control. Control wording is diagnostic only and never substitutes for production requests or any of the 66 scenarios.

The model, low reasoning effort, SDK foundation and provider filter policy are retained. Permission requests are rejected; the only tool action is returning an owned synthetic string generated in memory. There are no automatic retries, fallback models or user-setting changes. Execution consumes actual model usage. Existing reports cannot be overwritten. Filtering, literal-output mismatches, errors or cleanup failures produce exit code 1; even exit code 0 does not establish full-matrix compatibility.

## Read the evidence

`report.json` distinguishes:

- Chat Completions `finish_reason: content_filter`.
- Anthropic Messages `stop_reason: refusal` and allowlisted `stop_details.category`.
- SDK `contentFilterTriggered` / `finishReason`.
- Bridge lifecycle phase, pending-call count and tool-result submission count.

An actual investigation observed the provider's `reasoning_extraction` category for the owned synthetic fixture request. This is the provider's classification, not proof of the user's intent. Why that benign copy request is classified this way remains a separate question. The diagnostic does not rewrite requests to avoid the category or disable protective instructions.

Model discovery can also pass through the SDK request handler. `observedHttpRequests` therefore differs from `observedInferenceRequests`, which requires the exact model in the request. SDK `streaming:false` does not guarantee nonstreaming HTTP on every provider route: inspect the observed `wire[].request.streaming`. An unknown response format has `explicitBlock:null`—missing evidence, not evidence of an unfiltered inference.

Simple-tool controls retain `status:mismatch` when the two literal fixture lines change formatting. `fixtureValuesPreserved:true` is a separate diagnostic, not an exact-copy pass.

## Privacy and limitations

The observer forwards the original `Request` and `Response` unmodified. It reads only copies, capped at 256 KiB and 45 seconds, recording `complete:false` on incomplete capture. Headers, credentials, prompts, tool outputs, response prose and provider explanations are never saved: only hashes, counts and allowlisted protocol fields survive.

The bridge monitors root filtering for the entire session lifetime, including between HTTP requests. A late signal cannot retract delivered text or a tool already executed by the client, but it prevents subsequent cached success, tool-result continuation and response-handle commitment. Subordinate-agent events and filter-looking prose do not become root failures.
