# Draft: owned fixture exact-copy request classified as reasoning extraction on Opus

**Draft only. No upstream issue or support request has been submitted.**

## Environment

- GitHub Copilot SDK: **1.0.14**, bundled runtime **1.0.85**.
- Exact models: `claude-opus-5` and `claude-sonnet-5`; account catalog reports both enabled.
- Native endpoint observed: Copilot `/v1/messages`.
- Both requests use low effort, adaptive thinking, omitted reasoning display, temperature 1 and max_tokens 32000.
- Empty SDK mode, preserved default foundation plus ordinary application instructions, only one declared synthetic external tool, permission requests rejected.

## Minimal task

The `read_fixture` tool takes an empty JSON object and returns two owned, randomly generated non-sensitive marker lines of the form `value:N_<random>_한글` and `receipt:N_<random>_한글`. It reads no files, credentials, user data or external systems. The task asks to call it once and copy its two literal lines in a fenced block. The actual unchanged request text is `PROMPTS.read` in `scripts/stability/catalog.mjs`; the reusable reproduction command is:

```sh
npm run diagnose:opus -- --execute --output .runtime/opus-support-repro-new
```

This command performs real inference, rejects existing nonempty output directories and keeps filtered/mismatched outcomes. It does not disable filters, substitute a model or automatically retry a failed inference.

## Observed

Four paired Opus trials through direct SDK and production-manager routes all refused before a tool result was submitted. Four paired Sonnet trials copied the same fixture correctly. Model order was reversed on the second repeat.

The raw native Opus response included:

```json
{
  "type": "message_delta",
  "delta": {
    "stop_reason": "refusal",
    "stop_details": {
      "type": "refusal",
      "category": "reasoning_extraction"
    }
  },
  "usage": { "output_tokens": 0 }
}
```

The same call's SDK `assistant.usage` exposed `contentFilterTriggered:true` and `finishReason:"content_filter"`, but not the native category. The SDK's generated event schema explicitly documents this normalized mapping.

Replaying the previous full validation's exact initial S01 body, without rewriting any part of it, also produced the native category. These are separate diagnostics, not replacement scores for the full matrix.

## Controls and important caveats

- Original and bridge-hashed tool names both reproduced filtering.
- A single plain user message, without replay history, also reproduced it.
- Summary configuration and SDK streaming option changes did not resolve it. On the native route the SDK streaming flag did not disable upstream HTTP streaming.
- Arithmetic and a separate simple tool-use control produced normal responses. The simple control reformatted the two fields, so its literal-copy mismatch was retained rather than counted as a pass.
- The final request bodies were **not** identical except for model ID. SDK system text differed in model identity and an additional Opus-specific JSON/tool-string instruction; per-request timing text differed too. Public protocol headers and other observed generation options matched. Adding that extra restriction to Sonnet still succeeded. No default SDK instruction was removed or swapped between models.
- We do not infer the provider's internal decision rule from its category or assert that the user was requesting hidden reasoning. The task concerns owned tool data, not model reasoning.

## Requested upstream investigation

Please investigate whether this is a false-positive `reasoning_extraction` classification for literal copying of owned tool output on the Opus model path. Please also consider exposing bounded native refusal category metadata through the SDK so callers need not install a model-layer observer to distinguish refusal categories.

See [matched comparisons and captured-request evidence](model-comparison.json), [diagnostic history](opus-diagnostics.json), and the local raw evidence referenced by [the manifest](evidence-manifest.json). Credentials and full prompts are not included in the published wire-observer records. Local provider request identifiers are available in the private raw SDK events if an authorized support investigation needs them.
