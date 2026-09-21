import { isDeepStrictEqual as same } from "node:util";
import { CATALOG, FLOW, PROMPTS } from "./catalog.mjs";
import { normalizeRequest } from "../../src/request-policy.mjs";
import { sha } from "../compatibility/util.mjs";
import { completedItems, answer, streamEvents, streamValid, wireOutputs } from "../compatibility/oracles.mjs";

const parse = text => { try { return JSON.parse(text); } catch { return null; } };
const includes = (text, value) => typeof value === "string" && value.length > 12 && typeof text === "string" && text.includes(value);
const toolTypes = new Set(["commandExecution", "command_execution", "fileChange", "file_change", "dynamicToolCall", "mcpToolCall", "collabAgentToolCall"]);
function validTree(tree) {
  return tree && typeof tree === "object" && Object.keys(tree).length > 0 && Object.values(tree).every(f =>
    typeof f?.link === "string" || (typeof f?.base64 === "string" && sha(Buffer.from(f.base64, "base64")) === f.hash && Number.isInteger(f.mode)));
}
export function phaseRecords(e, phase) {
  return phase && Number.isInteger(phase.after) && Number.isInteger(phase.end) && phase.after >= 0 && phase.end > phase.after
    ? (e.native ?? []).slice(phase.after, phase.end) : [];
}
export function metrics(e) {
  const turns = (e.phases ?? []).filter(p => p.kind === "turn");
  return { nativeTurns: turns.length, completedTurns: turns.filter(p => p.result?.status === "completed").length,
    failedTurns: turns.filter(p => p.result?.status === "failed").length, nativeToolCalls: (e.toolLedger ?? []).length,
    sdkPrompts: (e.sdk ?? []).filter(r => r.type === "session.send").length,
    sdkResultSubmissions: (e.sdk ?? []).filter(r => r.type === "tool.submit").length,
    presentation: turns.filter(p => p.result?.status === "completed" && p.label !== "padding").map(p => ({ label: p.label,
      exactFixtureText: answer(phaseRecords(e, p)) === `${e.fixture?.expectedValue}\n${e.fixture?.expectedReceipt}` })) };
}
export function evaluate(scenario, e) {
  const checks = [], check = (id, passed, detail) => checks.push({ id, passed: passed === true, detail });
  const native = e?.native ?? [], sdk = e?.sdk ?? [], transport = e?.transport ?? [], controls = e?.controls ?? [];
  const turns = (e?.phases ?? []).filter(p => p.kind === "turn"), threads = (e?.phases ?? []).filter(p => ["thread", "resume"].includes(p.kind));
  const phases = label => turns.find(p => p.label === label);
  const reads = phase => (e?.toolLedger ?? []).filter(r => phase && r.threadId === phase.threadId && r.turnId === phase.result?.id);
  const act = action => controls.filter(r => r.action === action);
  const state = label => act("state").find(r => r.label === label);
  const posts = transport.filter(r => r.method === "POST" && r.path === "/v1/responses");
  const nativePosts = posts.filter(r => r.origin === "native");
  const successfulPosts = posts.filter(r => streamEvents(r).at(-1)?.type === "response.completed");
  const errorCode = r => parse(r.responseText)?.error?.code ?? streamEvents(r).find(v => v.type === "response.failed")?.response?.error?.code;
  const sends = sdk.filter(r => r.type === "session.send"), submissions = sdk.filter(r => r.type === "tool.submit");
  const sessions = sdk.filter(r => r.type === "session.created");
  const usages = sdk.filter(r => r.type === "assistant.usage" && !r.agentId);
  const ledger = e?.toolLedger ?? [];
  const expected = `${e?.fixture?.expectedValue}\n${e?.fixture?.expectedReceipt}`;
  const expectedFlow = FLOW[scenario.id] ?? [];
  check("identity", e?.scenarioId === scenario.id && e?.provider === "ghcp" && CATALOG.models.includes(e?.model) &&
    ["live", "offline-self-test"].includes(e?.executionKind) && /^value:N_[a-f0-9]{20}_한글$/.test(e?.fixture?.expectedValue ?? "") &&
    /^receipt:N_[a-f0-9]{20}_한글$/.test(e?.fixture?.expectedReceipt ?? ""), "Exact case, execution kind and hidden synthetic values");
  check("native-route", threads.length > 0 && threads.every(p => p.threadId && p.result?.thread?.id === p.threadId &&
    p.result.model === e.model && p.result.modelProvider === "ghcp" && p.result.sandbox?.type === "readOnly" && p.result.sandbox.networkAccess !== true) &&
    (e.hosts ?? []).length > 0 && e.hosts.every(h => Number.isSafeInteger(h.pid) && h.model === e.model && h.provider === "ghcp"), "Real native app-server identities and read-only policy");
  check("turns", turns.length === scenario.turns && turns.every((p, i) => {
    const flow = expectedFlow[i]; if (!flow) return false;
    const rows = phaseRecords(e, p);
    return p.label === flow[0] && p.prompt === PROMPTS[flow[1]] && p.result?.status === flow[2] && typeof p.result.id === "string" &&
      rows.some(r => r.direction === "send" && r.message?.method === "turn/start" && r.message.params?.threadId === p.threadId &&
        r.message.params.input?.some(v => v.type === "text" && v.text === PROMPTS[flow[1]])) &&
      rows.some(r => r.direction === "receive" && r.message?.method === "turn/completed" && r.message.params?.threadId === p.threadId &&
        r.message.params.turn?.id === p.result.id && r.message.params.turn.status === flow[2]);
  }), "All fixed native phases terminate with their predeclared status and prompt");
  check("sdk-route", sessions.length > 0 && sessions.every(s => s.model === e.model && typeof s.sessionId === "string") &&
    usages.length > 0 && usages.every(u => u.data?.model === e.model && sessions.some(s => s.sessionId === u.sessionId)) &&
    sends.length > 0 && sends.every(s => sessions.some(v => v.sessionId === s.sessionId)) && nativePosts.length > 0 &&
    nativePosts.every(p => p.request?.model === e.model) && wireOutputs(successfulPosts).every(r => r.model === e.model), "Actual selected-model SDK usage, no model substitution");
  check("stream", successfulPosts.length > 0 && successfulPosts.every(p => p.status === 200 && !p.truncated && streamValid(p)), "All successful HTTP/SSE responses reconcile exactly");
  const allowedError = { S03: "pending_session_changed", S06: "request_timeout", S07: "upstream_session_lost", S08: "upstream_session_lost", S09: "invalid_upstream_response" }[scenario.id];
  check("transport-outcomes", posts.length > 0 && posts.every(p => successfulPosts.includes(p) ||
    (scenario.id === "S05" && p.origin === "control-cancelled" && p.closed && !p.finished) ||
    (allowedError && errorCode(p) === allowedError && (scenario.id === "S03" ? p.origin === "control-policy" : p.origin === "native"))), "Only explicitly injected failures may be observed; no unexpected transport failures");
  check("tool-correlation", ledger.length > 0 && ledger.length <= CATALOG.maxNativeToolCalls && new Set(ledger.map(r => r.callId)).size === ledger.length &&
    ledger.every(call => call.tool === "read_fixture" && same(call.arguments, {}) && call.result === expected &&
      native.some(r => r.direction === "receive" && r.message?.method === "item/tool/call" && r.message.id === call.rpcId &&
        r.message.params?.callId === call.callId && r.message.params.threadId === call.threadId && r.message.params.turnId === call.turnId) &&
      native.some(r => r.direction === "send" && r.message?.id === call.rpcId && r.message.result?.success === true &&
        r.message.result.contentItems?.some(i => i.text === expected)) &&
      completedItems(native.filter(r => r.message?.params?.threadId === call.threadId && r.message.params?.turnId === call.turnId)).some(i =>
        i.type === "dynamicToolCall" && i.id === call.callId && i.tool === "read_fixture" && i.success === true && i.contentItems?.some(v => v.text === expected))) &&
    new Set(submissions.map(r => `${r.sessionId}/${r.requestId}`)).size === submissions.length,
    "Owned native tool callbacks and literal results, without repeated SDK result submission");
  const allTools = completedItems(native).filter(i => toolTypes.has(i.type));
  check("isolation", validTree(e?.before) && validTree(e?.after) && same(e.before, e.after) &&
    validTree(e?.protectedBefore) && same(e.protectedBefore, e.protectedAfter) && e?.gitBefore?.head && same(e.gitBefore, e.gitAfter) &&
    allTools.length === ledger.length && allTools.every(i => i.type === "dynamicToolCall" && i.tool === "read_fixture") &&
    !(e?.approvals ?? []).some(a => a.decision === "accept") && (e?.logicalPrompts ?? []).every(p => !includes(p, e.fixture?.expectedValue) && !includes(p, e.fixture?.expectedReceipt)),
    "Preserved files/Git, fixture-only native tools, no approval or prompt-value bypass");
  check("final-values", turns.some(p => p.result?.status === "completed") && turns.filter(p => p.result?.status === "completed").every(p => {
    const text = answer(phaseRecords(e, p));
    return p.label === "padding" ? /\bACK\b/.test(text) && reads(p).length === 0 :
      includes(text, e.fixture?.expectedValue) && includes(text, e.fixture?.expectedReceipt);
  }), "Successful native answers preserve both literal tokens; presentation is a separate diagnostic");
  check("readiness", act("control-get").filter(r => r.path === "/readyz").at(-1)?.status === 200 &&
    act("control-get").filter(r => r.path === "/readyz").at(-1)?.body?.ready === true &&
    state("before-cleanup")?.queue === 0 && state("before-cleanup")?.pending === 0, "The bridge is ready with drained requests and tools at the end");
  check("cleanup", e?.resources?.cleaned === true && same(e.resources.errors, []) && e.resources.backends?.length > 0 &&
    e.resources.backends.every(b => b.serverClosed && b.proxyClosed && b.states === 0 && b.queued === 0 && b.sdkStopped && !b.proxyError) &&
    !(e.diagnostics ?? []).some(d => /cleanup_failed/.test(d.event ?? "")), "Owned native processes, sockets, SDK clients, queues and state cleaned");

  if (["S01", "S02", "S03", "S04", "S05"].includes(scenario.id)) {
    check(`${scenario.id}.once`, ledger.length === 1 && sessions.length === 1 && sends.length === 1 && submissions.length === 1,
      "One native read, SDK session, prompt and result submission");
  }
  if (scenario.id === "S01") check("S01.unmodified", !act("tools-permuted").length && !act("sdk-loss-start").length && !act("sdk-ack-held").length, "Unmodified baseline path");
  if (scenario.id === "S02") {
    const permutation = act("tools-permuted"); let equivalent = false;
    if (permutation.length === 1) try {
      const a = normalizeRequest(permutation[0].before), b = normalizeRequest(permutation[0].after);
      const toolsA = a.tools, toolsB = b.tools;
      a.tools = [...toolsA].sort((x, y) => x.name.localeCompare(y.name)); b.tools = [...toolsB].sort((x, y) => x.name.localeCompare(y.name));
      equivalent = !same(toolsA, toolsB) && same(a, b) && posts.some(p => p.origin === "native" && same(p.request, permutation[0].after));
    } catch { /* malformed observations fail */ }
    check("S02.permutation", equivalent, "A nontrivial tool-order-only permutation reaches the real bridge successfully");
  }
  if (scenario.id === "S03") {
    const probe = act("policy-rejection")[0];
    check("S03.reject", act("policy-rejection").length === 1 && probe.status === 409 && parse(probe.response)?.error?.code === "pending_session_changed" &&
      probe.before.pending === 1 && probe.after.pending === 1 && probe.before.submissions === probe.after.submissions &&
      posts.some(p => p.origin === "control-policy" && same(p.request, probe.request) && errorCode(p) === "pending_session_changed") &&
      posts.some(p => p.origin === "native" && sha(JSON.stringify(p.request)) === probe.originalHash) &&
      (e.diagnostics ?? []).some(d => d.event === "bridge.pending_session_changed" && d.changed?.includes("tools")),
      "Real 409 rejects changed definitions without losing/submitting the pending result; the original request then succeeds");
  }
  if (scenario.id === "S04") {
    const retry = act("exact-retry")[0]; const copies = posts.filter(p => p.origin === "control-duplicate");
    check("S04.retry", act("exact-retry").length === 1 && copies.length === 1 && retry.firstStatus === 200 && retry.retryStatus === 200 &&
      Array.isArray(retry.firstOutput) && same(retry.firstOutput, retry.retryOutput) && retry.before.sdkSends === retry.after.sdkSends &&
      retry.before.submissions === retry.after.submissions && posts.some(p => p.origin === "native" && same(p.request, copies[0].request)) &&
      sha(JSON.stringify(copies[0].request)) === retry.requestHash, "Exact duplicate HTTP result request uses cached output, not additional inference or tool submission");
  }
  if (scenario.id === "S05") {
    const cancelled = act("queued-copy-cancelled")[0], held = act("sdk-ack-held")[0], released = act("sdk-ack-released")[0];
    check("S05.cancel", act("queued-copy-cancelled").length === 1 && held && released && state("duplicate-queued")?.queue === 2 &&
      cancelled.snapshot.queue === 1 && cancelled.outcome?.errorName === "AbortError" && held.at <= cancelled.at && cancelled.at <= released.at &&
      state("duplicate-queued").sdkSends === cancelled.snapshot.sdkSends && posts.filter(p => p.origin === "control-cancelled").length === 1,
      "A real queued HTTP duplicate is cancelled before the gate releases; original native inference continues");
  }
  if (["S06", "S08", "S09"].includes(scenario.id)) {
    const clean = state("after-fault-drained");
    check(`${scenario.id}.recovery`, clean?.states === 0 && clean.pending === 0 && clean.queue === 0 && clean.responses === 0 &&
      phases("fault")?.threadId !== phases("recovery")?.threadId && reads(phases("recovery")).length === 1,
      "Injected failure leaves no pending/cached state, and a distinct native thread performs one fresh read");
  }
  if (scenario.id === "S06") check("S06.deadline", act("sdk-ack-held").length === 1 && nativePosts.filter(p => errorCode(p) === "request_timeout").length === 1 &&
    ledger.length === 1 && sends.length === 2 && submissions.length === 1 && sessions.length === 2, "Bounded total deadline cancels the gated native request; only recovery executes a tool");
  if (["S07", "S08"].includes(scenario.id)) {
    check(`${scenario.id}.loss`, act("sdk-loss-complete").length === 1 && act("control-get").some(r => r.path === "/readyz" && r.status === 503 && r.body?.ready === false) &&
      act("control-get").some(r => r.path === "/health" && r.status === 200 && r.body?.ok === true && r.body?.ready === false) &&
      (e.diagnostics ?? []).filter(r => r.event === "bridge.upstream_recovered").length === 1 && sessions.length === 2 && sends.length === 2 &&
      nativePosts.some(p => errorCode(p) === "upstream_session_lost"), "Owned SDK loss is detected, readiness is false, and one fresh client recovers without inference replay");
    if (scenario.id === "S07") check("S07.isolation", ledger.length === 2 && submissions.length === 2 && reads(phases("lost-conversation")).length === 0 &&
      phases("before-loss")?.threadId === phases("lost-conversation")?.threadId && phases("recovery")?.threadId !== phases("before-loss")?.threadId,
      "Lost conversation fails explicitly; only the new thread receives new inference");
    else {
      const lost = ledger.find(r => r.lossBeforeSubmission), pending = sdk.find(r => r.type === "external_tool.requested" && r.data?.toolCallId === lost?.callId);
      check("S08.no-replay", ledger.length === 2 && submissions.length === 1 && pending &&
        !submissions.some(s => s.requestId === pending.data.requestId && s.sessionId === pending.sessionId) &&
        state("before-pending-loss")?.pending === 1 && state("after-pending-loss")?.pending === 0,
        "The completed native callback is never submitted to a dead/replacement SDK session");
    }
  }
  if (scenario.id === "S09") check("S09.invalid-stream", act("sdk-delta-id-corrupted").length === 1 &&
    nativePosts.filter(p => errorCode(p) === "invalid_upstream_response").length === 1 &&
    sends.length === 2 && sessions.length === 2 && reads(phases("fault")).length <= 1,
    "The labelled delta-ID corruption yields response.failed, never a cached success");
  if (scenario.id === "S10") {
    const start = threads.find(p => p.kind === "thread"), resume = threads.find(p => p.kind === "resume");
    check("S10.resume", start && resume && start.threadId === resume.threadId && start.hostPid !== resume.hostPid &&
      e.restart?.oldHostPid === start.hostPid && sessions.length === 2 && new Set(sessions.map(s => s.sessionId)).size === 2 &&
      ledger.length === 1 && reads(phases("recall")).length === 0 && submissions.length === 1 && sends.length === 2,
      "Fresh native host/SDK restore one persisted thread without re-executing its read");
  }
  if (scenario.id === "S11") {
    const compact = (e.phases ?? []).find(p => p.kind === "compaction"), rows = phaseRecords(e, compact);
    const starts = rows.filter(r => r.direction === "receive" && r.message?.method === "item/started" && r.message.params?.item?.type === "contextCompaction");
    const ends = rows.filter(r => r.direction === "receive" && r.message?.method === "item/completed" && r.message.params?.item?.type === "contextCompaction");
    check("S11.compaction", e.compaction?.inputBytes >= 12_000 && compact?.result?.status === "completed" && starts.length === 1 && ends.length === 1 &&
      starts[0].message.params.item.id === ends[0].message.params.item.id && starts[0].message.params.threadId === compact.threadId &&
      ends[0].message.params.threadId === compact.threadId && rows.some(r => r.direction === "send" && r.message?.method === "thread/compact/start") &&
      rows.some(r => r.direction === "receive" && r.message?.method === "turn/completed" && r.message.params?.turn?.id === compact.result.id),
      "Long input followed by explicit native local compaction with correlated start/completion events");
    check("S11.repetition", ledger.length === 6 && submissions.length === 6 && Array.from({ length: 6 }, (_, i) => reads(phases(`repeat-${i + 1}`)).length).every(n => n === 1) &&
      reads(phases("recall")).length === 0 && !transport.some(p => /\/compact/.test(p.path ?? "")),
      "Six real read turns, no tool replay on recall, and no unsupported remote compaction");
  }
  return checks;
}
