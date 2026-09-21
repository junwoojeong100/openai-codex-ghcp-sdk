import { FLOW, PROMPTS } from "../../scripts/stability/catalog.mjs";
import { sha } from "../../scripts/compatibility/util.mjs";
import { ResponsesStream } from "../../src/responses.mjs";

// Synthetic evidence for oracle mutation tests, never live validation credit.
export function stabilityEvidence(id) {
  const model = "gpt-6-astra", value = `value:N_${"a".repeat(20)}_한글`, receipt = `receipt:N_${"b".repeat(20)}_한글`;
  const text = `${value}\n${receipt}`, file = content => ({ base64: Buffer.from(content).toString("base64"), hash: sha(content), mode: 384 });
  const e = { provider: "ghcp", model, scenarioId: id, executionKind: "offline-self-test", fixture: { expectedValue: value, expectedReceipt: receipt },
    native: [], sdk: [], transport: [], phases: [], controls: [], logicalPrompts: [], toolLedger: [], approvals: [], hosts: [{ pid: 5001, model, provider: "ghcp" }],
    before: { "fixture-data.txt": file(text), "user-dirty.txt": file("KEEP") }, protectedBefore: { "sentinel.txt": file("KEEP") },
    gitBefore: { head: "synthetic-head", index: "synthetic-index" },
    resources: { cleaned: true, errors: [], backends: [{ serverClosed: true, proxyClosed: true, states: 0, queued: 0, sdkStopped: true, proxyError: null }] }, diagnostics: [] };
  e.after = structuredClone(e.before); e.protectedAfter = structuredClone(e.protectedBefore); e.gitAfter = structuredClone(e.gitBefore);
  const declared = [{ type: "function", name: "read_fixture", parameters: { type: "object", properties: {} } },
    { type: "function", name: "unused_fixture", parameters: { type: "object", properties: {} } }];
  let sequence = 0;
  const row = (direction, message) => e.native.push({ direction, message, at: ++sequence });
  const control = (action, data = {}) => { const item = { action, ...data, at: ++sequence }; e.controls.push(item); return item; };
  const snapshot = (label, pending = 0, queue = 0) => control("state", { label, generation: 1, readiness: { ready: true, state: "ready" }, states: pending ? 1 : 0,
    pending, queue, responses: 0, sdkSends: e.sdk.filter(r => r.type === "session.send").length, submissions: e.sdk.filter(r => r.type === "tool.submit").length });
  function session(sid) { e.sdk.push({ type: "session.created", sessionId: sid, model }, { type: "assistant.usage", sessionId: sid, data: { model, inputTokens: 10, outputTokens: 2 } }); }
  function thread(tid, kind = "thread", hostPid = 5001) {
    e.phases.push({ kind, threadId: tid, hostPid, result: { model, modelProvider: "ghcp", thread: { id: tid }, sandbox: { type: "readOnly", networkAccess: false } } });
  }
  function post(request, { origin = "native", error, output = [], status = 200 } = {}) {
    let responseText, contentType;
    if (error && status !== 200) { contentType = "application/json"; responseText = JSON.stringify({ error: { code: error } }); }
    else {
      const chunks = [], sink = { write: text => { chunks.push(text); return true; }, end() { this.writableEnded = true; } };
      const stream = new ResponsesStream(sink, { id: `resp_${++sequence}`, model });
      if (error) stream.fail({ code: error });
      else stream.finish({ messages: output.length ? [{ messageId: `m${sequence}`, content: output[0] }] : [], tools: [] });
      responseText = chunks.join(""); contentType = "text/event-stream";
    }
    const result = { origin, method: "POST", path: "/v1/responses", request, status, responseText, contentType, closed: true, finished: true };
    e.transport.push(result); return result;
  }
  thread("t1"); session("s1");
  control("control-get", { path: "/readyz", status: 200, body: { ready: true } });
  let threadId = "t1", sessionId = "s1";
  const multi = ["S06", "S07", "S08", "S09", "S10"].includes(id);
  for (const [index, [label, promptName, expected]] of FLOW[id].entries()) {
    if (multi && index === FLOW[id].length - 1) {
      if (id === "S10") {
        e.restart = { oldHostPid: 5001, sdkOffset: e.sdk.length }; thread(threadId, "resume", 5002); e.hosts.push({ pid: 5002, model, provider: "ghcp" });
      } else { threadId = "t2"; thread(threadId); }
      sessionId = "s2"; session(sessionId);
    }
    const tid = `turn${index}`, phase = { kind: "turn", label, prompt: PROMPTS[promptName], threadId, after: e.native.length, result: { id: tid, status: expected } };
    e.phases.push(phase); e.logicalPrompts.push(phase.prompt);
    row("send", { method: "turn/start", params: { threadId, input: [{ type: "text", text: phase.prompt }] } });
    if (label !== "lost-conversation") e.sdk.push({ type: "session.send", sessionId, promptHash: sha(phase.prompt) });
    const doRead = (promptName === "read" || promptName === "remember") && !(label === "fault" && ["S06", "S09"].includes(id));
    const request = { model, tools: structuredClone(declared), input: [{ role: "user", content: phase.prompt }] };
    if (doRead) {
      const callId = `call${index}`, rpcId = index;
      const params = { threadId, turnId: tid, callId, tool: "read_fixture", arguments: {} };
      row("receive", { method: "item/tool/call", id: rpcId, params });
      row("send", { id: rpcId, result: { success: true, contentItems: [{ type: "inputText", text }] } });
      row("receive", { method: "item/completed", params: { threadId, turnId: tid, item: { type: "dynamicToolCall", id: callId, tool: "read_fixture", arguments: {}, success: true, contentItems: [{ text }] } } });
      e.toolLedger.push({ ...params, rpcId, result: text, ...(id === "S08" && label === "fault" ? { lossBeforeSubmission: true } : {}) });
      e.sdk.push({ type: "external_tool.requested", sessionId, data: { toolCallId: callId, requestId: `rpc-${callId}`, toolName: "read_fixture" } });
      if (!(id === "S08" && label === "fault")) e.sdk.push({ type: "tool.submit", sessionId, requestId: `rpc-${callId}` });
      request.input.push({ type: "function_call_output", call_id: callId, output: text });
    }
    if (expected === "completed") row("receive", { method: "item/completed", params: { threadId, turnId: tid, item: { type: "agentMessage", text: label === "padding" ? "ACK" : text } } });
    const code = { S06: "request_timeout", S07: "upstream_session_lost", S08: "upstream_session_lost", S09: "invalid_upstream_response" }[id];
    post(request, { ...(expected === "failed" ? { error: code, status: ["S07", "S08"].includes(id) ? 409 : 200 } : { output: [label === "padding" ? "ACK" : text] }) });
    row("receive", { method: "turn/completed", params: { threadId, turn: phase.result } }); phase.end = e.native.length;
    if (label === "fault" && ["S06", "S08", "S09"].includes(id)) snapshot("after-fault-drained");
    if (label === "padding" && id === "S11") {
      e.compaction = { inputBytes: Buffer.byteLength(PROMPTS.padding) };
      const compact = { kind: "compaction", threadId, after: e.native.length, result: { id: "compact-turn", status: "completed" } };
      e.phases.push(compact);
      row("send", { method: "thread/compact/start", params: { threadId } });
      for (const method of ["item/started", "item/completed"]) row("receive", { method, params: { threadId, item: { type: "contextCompaction", id: "compact-item" } } });
      row("receive", { method: "turn/completed", params: { threadId, turn: compact.result } }); compact.end = e.native.length;
    }
  }
  const req = e.transport[0].request;
  if (id === "S02") {
    const before = structuredClone(req); req.tools.reverse(); control("tools-permuted", { before, after: structuredClone(req) });
  }
  if (id === "S03") {
    const changed = structuredClone(req); changed.tools[0].description = "changed policy";
    post(changed, { origin: "control-policy", status: 409, error: "pending_session_changed" });
    control("policy-rejection", { status: 409, response: JSON.stringify({ error: { code: "pending_session_changed" } }), request: changed,
      originalHash: sha(JSON.stringify(req)), before: { pending: 1, submissions: 0 }, after: { pending: 1, submissions: 0 } });
    e.diagnostics.push({ event: "bridge.pending_session_changed", changed: ["tools"] });
  }
  if (id === "S04") {
    const duplicate = post(structuredClone(req), { origin: "control-duplicate", output: [text] });
    const parse = p => p.responseText.split("\n").filter(l => l.startsWith("data: ")).map(l => JSON.parse(l.slice(6))).at(-1).response.output;
    // Production IDs remain stable across an exact retry.
    duplicate.responseText = e.transport[0].responseText;
    control("exact-retry", { firstStatus: 200, retryStatus: 200, requestHash: sha(JSON.stringify(req)), firstOutput: parse(e.transport[0]), retryOutput: parse(duplicate), before: { sdkSends: 1, submissions: 1 }, after: { sdkSends: 1, submissions: 1 } });
  }
  if (id === "S05") {
    control("sdk-ack-held"); snapshot("duplicate-queued", 0, 2);
    control("queued-copy-cancelled", { outcome: { errorName: "AbortError" }, snapshot: snapshot("cancelled-before-release", 0, 1) });
    control("sdk-ack-released"); e.transport.push({ origin: "control-cancelled", method: "POST", path: "/v1/responses", request: structuredClone(req), closed: true, finished: false });
  }
  if (id === "S06") control("sdk-ack-held");
  if (["S07", "S08"].includes(id)) {
    control("sdk-loss-complete", { generation: 1 });
    control("control-get", { path: "/readyz", status: 503, body: { ready: false } });
    control("control-get", { path: "/health", status: 200, body: { ok: true, ready: false } });
    e.diagnostics.push({ event: "bridge.upstream_recovered", generation: 2 });
    if (id === "S08") { snapshot("before-pending-loss", 1); snapshot("after-pending-loss"); }
  }
  if (id === "S09") control("sdk-delta-id-corrupted");
  snapshot("before-cleanup"); control("control-get", { path: "/readyz", status: 200, body: { ready: true } });
  return e;
}
