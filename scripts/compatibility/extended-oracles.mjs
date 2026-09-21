import { isDeepStrictEqual as same } from "node:util";
import path from "node:path";
import { reviewFindings } from "./native-output.mjs";

export function rpcRoundTrip(records, method, predicate = () => true) {
  return records.some(r => r.direction === "send" && r.message?.method === method && r.message.id !== undefined && predicate(r.message.params || {}) &&
    records.some(v => v.direction === "receive" && v.message?.id === r.message.id && Object.hasOwn(v.message, "result") && !v.message.error));
}
export function extendedChecks(scenario, e, h) {
  const { check, records, allCommands, final, n, secrets, turns, threads, sessions, sdk, posts, tools, phaseRecords, answer, content, code, output, completedItems, commands, has, parseAnswer, gitDiffCommand } = h;
  const id = scenario.id;
  if (id === "C11") {
    const l = e.launcher || {}, args = l.args || [];
    check("C11.1", l.command === "bin/codex-ghcp" && args.includes("--ghcp-model") && args.includes(e.model) && e.cli?.code === 0 &&
      final === n && allCommands.some(c => code(c) === 0 && has(output(c), n)), "Actual production launcher and native read, not a reconstructed provider invocation");
    check("C11.2", args.length > 0 && !args.some(a => /model_catalog_json|apply_patch_tool_type|shell_type/.test(a)) && l.catalogOverride === false &&
      ["live", "offline-self-test"].includes(l.executionKind) && l.metadata?.executionKind === l.executionKind &&
      Number.isSafeInteger(l.metadata?.pid) && Number.isSafeInteger(l.metadata?.port) && l.metadata.stopped === true && l.bridgeGone === true && l.portClosed === true,
      "Production tool metadata and owned bridge shutdown; offline instrumentation stays labelled offline");
  }
  if (id === "C12") {
    const reviewTurn = turns.find(p => p.operation === "review/start");
    const subset = phaseRecords(reviewTurn).filter(r => r.direction === "receive" &&
      r.message?.params?.threadId === reviewTurn?.threadId && r.message?.params?.turnId === reviewTurn?.result?.id);
    const items = completedItems(subset);
    const entered = subset.find(r => r.message?.method === "item/started" && r.message.params?.item?.type === "enteredReviewMode");
    const exited = items.filter(i => i.type === "exitedReviewMode");
    check("C12.1", rpcRoundTrip(phaseRecords(reviewTurn), "review/start", p => p.threadId === reviewTurn?.threadId && p.target?.type === "uncommittedChanges" && p.delivery === "inline") &&
      Boolean(entered) && exited.length === 1 && reviewTurn?.result?.status === "completed", "Native review RPC and same-thread/turn mode lifecycle");
    const findings = reviewFindings(exited[0]?.review), finding = findings[0];
    check("C12.2", findings.length === 1 && typeof e.fixture?.workspace === "string" &&
      finding.path === path.join(e.fixture.workspace, "review.mjs") && finding.start === 3 && finding.end === 3 &&
      /bound|off.by.one|length|undefined|NaN/i.test(finding.text) &&
      commands(subset, e.transport || []).some(c => gitDiffCommand(c.command) && code(c) === 0 && /\+.*i <= items\.length/.test(output(c))) && same(e.before, e.after),
      "One located bounds finding from native rendered text or JSON and an actual diff, with no mutation");
  }
  if (id === "C13") {
    const phase = turns.find(t => t.label === "plan"), rows = phaseRecords(phase), q = e.clarifications?.[0];
    const nativeQuestion = rows.find(r => r.direction === "receive" && r.message?.method === "item/tool/requestUserInput" && r.message.id === q?.rpcId);
    const nativeAnswer = rows.find(r => r.direction === "send" && r.message?.id === q?.rpcId && r.message.result);
    const planRequest = rows.find(r => r.direction === "send" && r.message?.method === "turn/start" && r.message.params?.collaborationMode?.mode === "plan");
    check("C13.1", e.clarifications?.length === 1 && Boolean(planRequest) && q.params?.threadId === phase?.threadId &&
      q.params.threadId === planRequest.message.params.threadId && q.params.turnId === phase.result?.id &&
      q.params.questions?.length === 1 && q.params.questions[0].id === "release_code" && typeof q.params.itemId === "string" &&
      same(nativeQuestion?.message.params, q.params) && same(nativeAnswer?.message.result, q.result) &&
      same(q.result?.answers?.release_code?.answers, [secrets.guide]), "Correlated native Plan-mode question and host answer");
    // The completed Plan item is authoritative, not an optional agentMessage.
    const planRows = rows.filter(r => r.direction === "receive" && r.message?.method === "item/completed" &&
      r.message.params?.threadId === phase?.threadId && r.message.params?.turnId === phase?.result?.id && r.message.params?.item?.type === "plan");
    const finalPlan = planRows.at(-1);
    const policy = threads.find(t => t.threadId === phase?.threadId)?.result?.sandbox;
    const allPhaseItems = completedItems(rows);
    check("C13.2", has(finalPlan?.message.params.item.text, secrets.guide) && Boolean(nativeAnswer) && rows.indexOf(finalPlan) > rows.indexOf(nativeAnswer) &&
      posts.some(p => p.request?.input?.some?.(i => ["function_call_output", "custom_tool_call_output"].includes(i.type) &&
        i.call_id === q?.params?.itemId && has(i.output, secrets.guide))) &&
      !(e.logicalPrompts || []).some(p => has(p, secrets.guide)) && same(e.before, e.after) && policy?.type === "readOnly" &&
      policy.networkAccess !== true && !(e.approvals || []).some(a => a.decision === "accept") &&
      !allPhaseItems.some(i => ["fileChange", "file_change", "mcpToolCall", "dynamicToolCall", "collabAgentToolCall"].includes(i.type)),
      "A correlated completed Plan consumes the hidden answer with enforced read-only execution and no edits or approved escalation");
  }
  if (id === "C14") {
    const compact = (e.phases || []).find(p => p.kind === "compaction"), rows = phaseRecords(compact);
    const start = rows.find(r => r.message?.method === "item/started" && r.message.params?.item?.type === "contextCompaction");
    const end = rows.find(r => r.message?.method === "item/completed" && r.message.params?.item?.type === "contextCompaction");
    check("C14.1", e.compaction?.inputBytes >= 12_000 && records.some(r => r.direction === "send" && r.message?.method === "turn/start" &&
      Buffer.byteLength(JSON.stringify(r.message.params?.input || [])) >= 12_000) &&
      rpcRoundTrip(records, "thread/compact/start", p => p.threadId === compact?.threadId) && compact?.result?.status === "completed" &&
      Boolean(start) && Boolean(end) && start.message.params.item.id === end.message.params.item.id &&
      start.message.params.threadId === compact.threadId && end.message.params.threadId === compact.threadId &&
      !(e.transport || []).some(p => /\/compact/.test(p.path || "")), "Real local contextCompaction after long input, not a claimed or remote-only compaction");
    const resumed = threads.find(p => p.kind === "resume"), initial = threads.find(p => p.kind === "thread");
    check("C14.2", Boolean(resumed) && resumed.threadId === initial?.threadId && resumed.hostPid !== initial?.hostPid && final === n &&
      !e.after?.["memory.txt"] && tools(phaseRecords(turns.at(-1))).length === 0 &&
      sdk.slice(e.restart?.sdkOffset ?? sdk.length).some(s => s.type === "session.created" && !(e.restart?.previousSdkSessionIds || []).includes(s.sessionId)),
      "Fresh Codex and SDK recover memory from persisted compacted history without rereading");
  }
  if (id === "C15") {
    const stopped = turns.find(p => p.label === "interrupt"), continued = turns.find(p => p.label === "recovery"), i = e.interruption || {};
    check("C15.1", i.started === true && stopped?.result?.status === "interrupted" && i.threadId === stopped.threadId && i.turnId === stopped.result.id &&
      rpcRoundTrip(records, "turn/interrupt", p => p.threadId === i.threadId && p.turnId === i.turnId) &&
      phaseRecords(stopped).some(r => r.message?.method === "item/started" && r.message.params?.item?.type === "commandExecution" && /node\s+long-task\.mjs/.test(r.message.params.item.command || "")),
      "An observed active native command is interrupted by exact thread/turn identity");
    let receipt; try { receipt = JSON.parse(content(e.after, "task-started.json")); } catch {}
    check("C15.2", Number.isSafeInteger(i.pid) && receipt?.pid === i.pid && i.processGone === true &&
      rpcRoundTrip(records, "thread/backgroundTerminals/clean", p => p.threadId === i.threadId) && continued?.threadId === i.threadId &&
      continued.result?.status === "completed" && answer(phaseRecords(continued)) === n &&
      allCommands.filter(c => /node\s+long-task\.mjs/.test(c.command || "")).length === 1 && allCommands.some(c => code(c) === 0 && has(output(c), n)),
      "Owned process cleanup and a real successful same-thread follow-up");
  }
  if (id === "C16") {
    const ledger = e.mcp?.ledger || [], requests = ledger.filter(r => r.event === "request"), responses = ledger.filter(r => r.event === "response");
    const read = requests.find(r => r.method === "resources/read" && r.params?.uri === "fixture://config");
    const lookups = requests.filter(r => r.method === "tools/call"), response = request => responses.find(r => r.id === request?.id && r.method === request?.method)?.result;
    const items = completedItems(records).filter(i => i.type === "mcpToolCall" && i.server === "fixture" && i.tool === "lookup");
    check("C16.1", requests.some(r => r.method === "resources/list") && requests.some(r => r.method === "tools/list") &&
      has(response(read)?.contents?.[0]?.text, secrets.resource) && lookups.length === 2 &&
      lookups[0].params?.arguments?.key === "missing" && response(lookups[0])?.isError === true && /ENOENT/.test(response(lookups[0])?.content?.[0]?.text || "") &&
      lookups[1].params?.arguments?.key === "selected" && response(lookups[1])?.isError === false && response(lookups[1])?.content?.[0]?.text === secrets.mcp &&
      items.length === 2 && items[0].arguments?.key === "missing" && items[1].arguments?.key === "selected" && has(final, secrets.resource) && has(final, secrets.mcp),
      "Native HTTP MCP discovery, resource and error-recovery round trips");
    check("C16.2", e.mcp?.protocol === "http" && e.mcp.unauthenticatedStatus === 401 && ledger.some(r => r.event === "http" && r.authenticated === false) &&
      requests.length > 0 && requests.every(r => r.authenticated === true) && !ledger.some(r => Object.hasOwn(r, "authorization") || Object.hasOwn(r, "token")) && allCommands.length === 0,
      "Rejected unauthenticated access and authenticated native operations, without shell bypass or stored bearer secrets");
  }
  if (id === "C17") {
    // App-server multiplexes parent and child events on the same connection.
    // Never credit the child's final message as the parent's answer, or mistake
    // a child command for a forbidden direct read by the parent.
    const root = threads[0]?.threadId;
    const rootRecords = records.filter(r => r.message?.params?.threadId === root && typeof root === "string");
    const events = completedItems(rootRecords).filter(i => i.type === "collabAgentToolCall");
    const spawns = events.filter(i => i.tool === "spawnAgent"), spawn = spawns[0], child = spawn?.receiverThreadIds?.[0];
    const wait = events.find(i => i.tool === "wait" && i.receiverThreadIds?.includes(child) && i.agentsStates?.[child]?.status === "completed");
    const closes = events.filter(i => i.tool === "closeAgent" && i.receiverThreadIds?.includes(child)), close = closes[0];
    check("C17.1", spawns.length === 1 && closes.length === 1 && typeof child === "string" && child !== root &&
      spawn.receiverThreadIds.length === 1 && [spawn, wait, close].every(i => i?.status === "completed" && i.senderThreadId === root && typeof i.id === "string") &&
      events.indexOf(spawn) < events.indexOf(wait) && events.indexOf(wait) < events.indexOf(close) &&
      has(wait.agentsStates[child].message, n), "Correlated parent spawn/wait/close lifecycle for one distinct completed child");
    const childRecords = records.filter(r => typeof child === "string" && r.message?.params?.threadId === child);
    const reads = commands(childRecords, e.transport || []).filter(c => code(c) === 0 && has(output(c), n));
    const resultFor = callId => typeof callId === "string" && posts.some(p => p.request?.input?.some?.(i =>
      ["function_call_output", "custom_tool_call_output"].includes(i.type) && i.call_id === callId && has(i.output, n)));
    const sessionFor = callId => sdk.find(r => r.type === "assistant.message" &&
      r.data?.toolRequests?.some(t => t.toolCallId === callId))?.sessionId;
    const rootSession = sessionFor(spawn?.id);
    check("C17.2", has(answer(rootRecords), n) && tools(rootRecords).every(i => i.type === "collabAgentToolCall") &&
      sessions.length >= 2 && new Set(sessions.map(s => s.sessionId)).size === sessions.length &&
      sessions.some(s => s.sessionId === rootSession) && reads.some(read => resultFor(read.id) &&
        sessionFor(read.id) !== rootSession && sessions.some(s => s.sessionId === sessionFor(read.id))) &&
      resultFor(wait?.id) && same(e.before, e.after),
      "A real child read and its exact call result feed a correlated parent wait and parent final answer, without a parent tool bypass");
  }
  if (id === "C18") {
    const failed = posts.filter(p => p.status === 503), first = posts[0], next = posts[1];
    check("C18.1", e.retry?.requestedFailures === 1 && failed.length === 1 && failed[0] === first &&
      has(first.responseText, "fixture_transient_fault") && has(first.responseText, e.retry?.marker) && next?.status === 200 && same(first.request, next.request),
      "One marked pre-inference 503 followed by an identical native retry");
    check("C18.2", sdk.filter(r => r.type === "session.send").length === 1 && allCommands.length === 1 && code(allCommands[0]) === 0 && has(output(allCommands[0]), n) && final === n,
      "Exactly one SDK prompt and one real tool execution despite the transport retry");
  }
}
