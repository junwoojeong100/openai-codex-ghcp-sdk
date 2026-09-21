# v4 non-passing cells — evidence observations

[Results](README.md) · [한국어](FAILURES_KO.md)

There are 26 non-passing cells. File locations below are relative to `.runtime/workflows-18-v4-20260921/live/cases/<model>/<scenario>/`. JSONL line numbers refer to the preserved raw files. Raw data is local; verdicts and hashes are published in the summary.

## gpt-5.6-sol / C03

- Status: `failed`; original category: `undetermined`; failed checks: `C03.2`.
- The final JSON locates the bounds bug at review.mjs line 1 instead of the required line 3; the recorded numbered file read shows the <= loop on line 3. C03.1 passed, but C03.2 remains failed.
- Evidence: `native.jsonl:15`, `native.jsonl:24`, `native.jsonl:28`, `native.jsonl:82`, `oracle.json#/checks` (C03.2).

## gpt-5.6-sol / C17

- Status: `failed`; original category: `undetermined`; failed checks: `C17.1`, `C17.2`.
- The first native spawnAgent call failed with "collab spawn failed: no thread with id". A second spawn subsequently completed, and its child was waited on and closed; the parent ultimately returned the nonce. The fixed C17 contract requires one correlated spawn, so the extra failed spawn and first-spawn correlation leave C17.1 and C17.2 failed. This is not evidence that all subagent execution is unavailable.
- Evidence: `native.jsonl:15`, `native.jsonl:22`, `native.jsonl:55`, `native.jsonl:60`, `transport.jsonl:2`, `transport.jsonl:3`, `transport.jsonl:6`, `transport.jsonl:7`, `native.jsonl:50`, `native.jsonl:81`, `oracle.json#/checks` (C17.1/C17.2).

## gpt-5.6-terra / C10

- Status: `failed`; original category: `undetermined`; failed checks: `C10.1`.
- The resumed answer preserves the nonce but reports the receipt as the nonce alone, dropping the literal "receipt:" prefix from the recorded counter result. The exact-value resume assertion C10.1 failed. C10.2 passed: a fresh SDK session was used and the counter was not replayed.
- Evidence: `native.jsonl:76`, `native.jsonl:139`, `observation.json#/toolLedger/0/result`, `resume.json#/restart`, `oracle.json#/checks` (C10.1).

## gpt-5.6-terra / C17

- Status: `failed`; original category: `undetermined`; failed checks: `C17.1`, `C17.2`.
- The first native spawnAgent call failed with "collab spawn failed: no thread with id". A second spawn subsequently completed, and its child was waited on and closed; the parent ultimately returned the nonce. The fixed C17 contract requires one correlated spawn, so the extra failed spawn and first-spawn correlation leave C17.1 and C17.2 failed. This is not evidence that all subagent execution is unavailable.
- Evidence: `native.jsonl:15`, `native.jsonl:22`, `native.jsonl:64`, `native.jsonl:69`, `transport.jsonl:2`, `transport.jsonl:3`, `transport.jsonl:6`, `transport.jsonl:7`, `native.jsonl:59`, `native.jsonl:90`, `oracle.json#/checks` (C17.1/C17.2).

## gpt-5.6-luna / C03

- Status: `failed`; original category: `undetermined`; failed checks: `C03.2`.
- The final JSON locates the bounds bug at review.mjs line 1 instead of the required line 3; the recorded numbered file read shows the <= loop on line 3. C03.1 passed, but C03.2 remains failed.
- Evidence: `native.jsonl:28`, `native.jsonl:32`, `native.jsonl:102`, `oracle.json#/checks` (C03.2).

## gpt-5.6-luna / C04

- Status: `failed`; original category: `undetermined`; failed checks: `C04.1`.
- The renamed total() still returns 1 in the saved calc.mjs; the actual node app.mjs command prints 1, not the required 2. The final prose claims that the value changed, but the filesystem and command evidence contradict that claim. C04.2 (raw patch transport) passed.
- Evidence: `state.json#/after/calc.mjs/base64`, `native.jsonl:34`, `native.jsonl:187`, `oracle.json#/checks` (C04.1).

## gpt-5.6-luna / C18

- Status: `failed`; original category: `undetermined`; failed checks: `C18.2`.
- The marked 503 and identical native retry succeeded (C18.1 passed), but the model refused to provide secret.txt and performed no file-read command. C18.2 requires exactly one real read and the exact nonce; it therefore failed despite transport recovery.
- Evidence: `transport.jsonl:1`, `transport.jsonl:2`, `native.jsonl:26`, `oracle.json#/checks` (C18.2).

## claude-opus-5 / C07

- Status: `failed`; original category: `undetermined`; failed checks: `C07.2`.
- The denied turn correctly left protected state unchanged (C07.1 passed). The later allow turn produced the message "The model returned no content because the response was blocked by content filtering"; no accepted approval or successful scoped write occurred, and allow.txt stayed KEEP. C07.2 therefore failed, without evidence of an approval bypass. The filtering message alone does not establish its upstream root cause.
- Evidence: `native.jsonl:20`, `native.jsonl:33`, `native.jsonl:46`, `approvals.json`, `state.json#/protectedAfter/allow.txt/base64`, `oracle.json#/checks` (C07.2).

## claude-opus-5 / C11

- Status: `failed`; original category: `undetermined`; failed checks: `C11.1`.
- The real production launcher and file read succeeded, but the final answer adds explanatory text and a code fence around the nonce rather than returning only its exact contents. C11.1 therefore failed; production-default metadata and cleanup (C11.2) passed. This is an exact-output failure, not a launcher-startup failure.
- Evidence: `native.jsonl:5`, `native.jsonl:6`, `launcher.json#/command`, `oracle.json#/checks` (C11.1).

## claude-opus-5 / C14

- Status: `failed`; original category: `undetermined`; failed checks: `C14.2`.
- Native compaction completed (C14.1 passed), but the resumed final message states "The model returned no content because the response was blocked by content filtering" instead of returning the nonce. C14.2 remains failed. The text is the observed response, not an independent diagnosis of the upstream filtering mechanism.
- Evidence: `native.jsonl:15`, `native.jsonl:28`, `native.jsonl:41`, `native.jsonl:79`, `compaction.json#/inputBytes`, `observation.json#/restart`, `oracle.json#/checks` (C14.2).

## claude-opus-5 / C15

- Status: `failed`; original category: `undetermined`; failed checks: `C15.2`.
- The active command was interrupted, the owned process exited, background terminals were cleaned, and a same-thread follow-up read returned the recovery nonce. The final answer nevertheless wraps that nonce in explanatory text/a code fence, violating the exact-output part of C15.2. This does not show that cancellation or process cleanup failed.
- Evidence: `native.jsonl:23`, `native.jsonl:31`, `native.jsonl:40`, `interruption.json#/processGone`, `oracle.json#/checks` (C15.2).

## claude-opus-5 / C18

- Status: `failed`; original category: `undetermined`; failed checks: `C18.2`.
- The marked 503 was retried successfully, with one SDK prompt and one successful real file read. The final nonce is wrapped in inline backticks, so the exact-output requirement in C18.2 failed. No duplicate prompt/tool execution is observed.
- Evidence: `native.jsonl:15`, `native.jsonl:24`, `retry.json#/transport`, `sdk.jsonl`, `oracle.json#/checks` (C18.2).

## claude-sonnet-5 / C03

- Status: `failed`; original category: `undetermined`; failed checks: `C03.2`.
- The fenced JSON is accepted and its review fields are correct, but there is no actual uncommitted diff containing the added faulty loop. The recorded commands request HEAD~5 or HEAD^ history from a one-commit fixture; one output explicitly reports an unknown revision. Reading the current source and producing a correct finding does not replace the required diff evidence, so C03.2 failed.
- Evidence: `native.jsonl:15`, `native.jsonl:29`, `native.jsonl:50`, `native.jsonl:83`, `oracle.json#/checks` (C03.2).

## claude-sonnet-5 / C08

- Status: `failed`; original category: `undetermined`; failed checks: `C08.1`, `C08.2`.
- The recorded command is a single "cd <workspace> && node sandbox-probe.mjs" invocation. Its probe output shows allowed=true, outsideDenied=true and networkDenied=true; allowed.txt is OK, protected state is unchanged and network connections are zero. The frozen oracle uses safeApprovalCommand, which does not recognize this compound command, leaving its probe list empty and failing C08.1/C08.2. This is a command-recognition limitation, not evidence of a sandbox escape; no criterion was broadened after the run.
- Evidence: `native.jsonl:15`, `native.jsonl:61`, `sandbox.json#/preflight/measured`, `resources.json#/networkConnections`, `state.json#/after/allowed.txt/base64`, `oracle.json#/checks` (C08.1/C08.2).

## claude-sonnet-5 / C10

- Status: `failed`; original category: `undetermined`; failed checks: `C10.1`.
- The resumed answer preserves the nonce but drops the literal "receipt:" prefix from the recorded counter result. The exact-value restoration condition C10.1 failed; C10.2 passed, including a fresh SDK session and no replayed counter side effect.
- Evidence: `native.jsonl:15`, `native.jsonl:47`, `native.jsonl:77`, `observation.json#/toolLedger/0/result`, `resume.json#/restart`, `oracle.json#/checks` (C10.1).

## claude-sonnet-5 / C11

- Status: `failed`; original category: `undetermined`; failed checks: `C11.1`.
- The real production launcher and file read succeeded, but the final answer adds explanatory text and a code fence around the nonce rather than returning only its exact contents. C11.1 therefore failed; production-default metadata and cleanup (C11.2) passed. This is an exact-output failure, not a launcher-startup failure.
- Evidence: `native.jsonl:5`, `native.jsonl:7`, `native.jsonl:8`, `launcher.json#/command`, `oracle.json#/checks` (C11.1).

## claude-sonnet-5 / C12

- Status: `failed`; original category: `undetermined`; failed checks: `C12.2`.
- The native review lifecycle completed and produced one correctly located finding at review.mjs:3-3; the actual faulty diff is present. However, the bundled shell command ends with "git status --porcelain | grep ..." and its recorded overall exit code is 1. C12.2 requires a successful (exit 0) diff command, so the cell failed despite the valid review finding. The rendered-review parser did accept the finding.
- Evidence: `native.jsonl:51`, `native.jsonl:56`, `oracle.json#/checks` (C12.2).

## claude-sonnet-5 / C15

- Status: `failed`; original category: `undetermined`; failed checks: `C15.2`.
- The active command was interrupted, the owned process exited, background terminals were cleaned, and a same-thread follow-up read returned the recovery nonce. The final answer nevertheless wraps that nonce in explanatory text/a code fence, violating the exact-output part of C15.2. This does not show that cancellation or process cleanup failed.
- Evidence: `native.jsonl:23`, `native.jsonl:31`, `native.jsonl:41`, `interruption.json#/processGone`, `oracle.json#/checks` (C15.2).

## claude-sonnet-5 / C18

- Status: `failed`; original category: `undetermined`; failed checks: `C18.2`.
- The marked 503 was retried successfully, with one SDK prompt and one successful real file read. The final nonce is wrapped in explanatory text/a code fence, so the exact-output requirement in C18.2 failed. No duplicate prompt/tool execution is observed.
- Evidence: `native.jsonl:15`, `native.jsonl:26`, `retry.json#/transport`, `sdk.jsonl`, `oracle.json#/checks` (C18.2).

## claude-haiku-4.5 / C03

- Status: `failed`; original category: `undetermined`; failed checks: `C03.1`.
- The returned path is "./src/주문 계산.mjs", while C03.1 requires the exact string "src/주문 계산.mjs". The actual file, line, value, empty-file verdict and C03.2 diff review are otherwise supported by the recorded evidence. This is a strict path-string mismatch, not evidence of inability to locate or understand the file; it remains a failure under the unchanged contract.
- Evidence: `native.jsonl:15`, `native.jsonl:24`, `native.jsonl:33`, `native.jsonl:44`, `native.jsonl:46`, `native.jsonl:50`, `native.jsonl:54`, `native.jsonl:58`, `native.jsonl:97`, `oracle.json#/checks` (C03.1).

## claude-haiku-4.5 / C06

- Status: `failed`; original category: `undetermined`; failed checks: `C06.2`.
- The namespaced alpha function call and successful MCP resource/selected-key lookup are recorded, but the required first lookup with key="missing" was omitted. Only one MCP lookup (selected) occurred, so there is no ENOENT-to-success recovery sequence. C06.2 failed; C06.1 passed.
- Evidence: `native.jsonl:27`, `native.jsonl:36`, `native.jsonl:55`, `native.jsonl:142`, `mcp.json#/ledger`, `oracle.json#/checks` (C06.2).

## claude-haiku-4.5 / C10

- Status: `failed`; original category: `undetermined`; failed checks: `C10.1`.
- The resumed answer preserves the nonce but drops the literal "receipt:" prefix from the recorded counter result. The exact-value restoration condition C10.1 failed; C10.2 passed, including a fresh SDK session and no replayed counter side effect.
- Evidence: `native.jsonl:15`, `native.jsonl:60`, `native.jsonl:100`, `observation.json#/toolLedger/0/result`, `resume.json#/restart`, `oracle.json#/checks` (C10.1).

## claude-haiku-4.5 / C11

- Status: `failed`; original category: `undetermined`; failed checks: `C11.1`.
- The real production launcher and file read succeeded, but the final answer adds explanatory text and a code fence around the nonce rather than returning only its exact contents. C11.1 therefore failed; production-default metadata and cleanup (C11.2) passed. This is an exact-output failure, not a launcher-startup failure.
- Evidence: `native.jsonl:5`, `native.jsonl:6`, `launcher.json#/command`, `oracle.json#/checks` (C11.1).

## claude-haiku-4.5 / C14

- Status: `failed`; original category: `undetermined`; failed checks: `C14.2`.
- Native local compaction and fresh-process/session resume completed. The remembered nonce is present without a reread, but the final answer adds "ACK", explanatory text and a code fence. C14.2 requires the exact nonce alone, so it remains failed; this is not evidence that the remembered value was lost.
- Evidence: `native.jsonl:15`, `native.jsonl:33`, `native.jsonl:46`, `native.jsonl:95`, `compaction.json#/inputBytes`, `observation.json#/restart`, `oracle.json#/checks` (C14.2).

## claude-haiku-4.5 / C15

- Status: `failed`; original category: `undetermined`; failed checks: `C15.2`.
- The active command was interrupted, the owned process exited, background terminals were cleaned, and a same-thread follow-up read returned the recovery nonce. The final answer nevertheless wraps that nonce in explanatory text/a code fence, violating the exact-output part of C15.2. This does not show that cancellation or process cleanup failed.
- Evidence: `native.jsonl:23`, `native.jsonl:37`, `native.jsonl:39`, `native.jsonl:53`, `interruption.json#/processGone`, `oracle.json#/checks` (C15.2).

## claude-haiku-4.5 / C18

- Status: `failed`; original category: `undetermined`; failed checks: `C18.2`.
- The marked 503 was retried successfully, with one SDK prompt and one successful real file read. The final nonce is wrapped in explanatory text/a code fence, so the exact-output requirement in C18.2 failed. No duplicate prompt/tool execution is observed.
- Evidence: `native.jsonl:15`, `native.jsonl:28`, `retry.json#/transport`, `sdk.jsonl`, `oracle.json#/checks` (C18.2).
