// Synthetic positive traces for testing the new oracles. Never live evidence.
export function extendedEvidence(id, e, { file, command, item, received }) {
  if (Number(id.slice(1)) < 11) return;
  const n = e.fixture.nonce, secret = e.fixture.secrets, model = e.model;
  e.native = []; e.phases = [];
  const session = name => e.sdk.push({ type: "session.created", sessionId: name, model }, { type: "session.send", sessionId: name }, { type: "assistant.usage", sessionId: name, data: { model } }, { type: "client.deleteSession", sessionId: name });
  const thread = (threadId = "t1", kind = "thread", pid = 400) => e.phases.push({ kind, threadId, hostPid: pid, result: { model, modelProvider: "ghcp", thread: { id: threadId } } });
  const rpc = (method, params, result = {}) => {
    const rpcId = `rpc-${e.native.length}`;
    return [{ direction: "send", message: { id: rpcId, method, params } }, received({ id: rpcId, result })];
  };
  const turn = (label, text, events = [], extra = {}) => {
    const result = { id: `turn-${e.phases.length}`, status: "completed" }, after = e.native.length;
    const output = label === "plan" ? item({ type: "plan", id: `${result.id}-plan`, text }) : item({ type: "agentMessage", text });
    for (const record of [...events, output]) if (["item/started", "item/completed"].includes(record.message?.method)) {
      record.message.params.threadId ??= "t1";
      record.message.params.turnId ??= result.id;
    }
    e.native.push(...events, output, received({ method: "turn/completed", params: { threadId: "t1", turn: result } }));
    const phase = { kind: "turn", label, threadId: "t1", after, end: e.native.length, result, ...extra }; e.phases.push(phase); return phase;
  };
  thread();
  const response = { status: "completed", model, output: [] };
  e.transport = [{ method: "POST", path: "/v1/responses", request: { model, input: [] }, status: 200, contentType: "application/json", responseText: JSON.stringify(response) }];
  if (id === "C11") {
    e.cli = { code: 0 };
    e.native.push(received({ type: "thread.started", thread_id: "t1" }), command("cat secret.txt", n), item({ type: "agentMessage", text: n }), received({ type: "turn.completed" }));
    e.launcher = { command: "bin/codex-ghcp", args: ["--ghcp-model", model, "--", "exec", "--json"], executionKind: "offline-self-test", catalogOverride: false,
      metadata: { executionKind: "offline-self-test", pid: 501, port: 30001, stopped: true }, bridgeGone: true, portClosed: true };
  }
  if (id === "C12") {
    e.fixture.workspace = "/owned";
    const review = JSON.stringify({ findings: [{ title: "Bounds error", body: "The <= reads beyond length and returns NaN.", code_location: { absolute_file_path: "/owned/review.mjs", line_range: { start: 3, end: 3 } } }] });
    turn("native-review", review, [...rpc("review/start", { threadId: "t1", target: { type: "uncommittedChanges" }, delivery: "inline" }),
      received({ method: "item/started", params: { item: { type: "enteredReviewMode", id: "review-start", review: "uncommitted changes" } } }), command("git -c color.ui=false diff -- review.mjs", "+ for (let i=0; i <= items.length; i++)"), item({ type: "exitedReviewMode", review })], { operation: "review/start" });
  }
  if (id === "C13") {
    e.phases[0].result.sandbox = { type: "readOnly", networkAccess: false };
    const params = { threadId: "t1", turnId: "turn-1", itemId: "q1", questions: [{ id: "release_code" }] }, result = { answers: { release_code: { answers: [secret.guide] } } };
    e.clarifications = [{ rpcId: 91, params, result }];
    turn("plan", `Plan ${secret.guide}`, [ ...rpc("turn/start", { threadId: "t1", collaborationMode: { mode: "plan" } }),
      received({ id: 91, method: "item/tool/requestUserInput", params }), { direction: "send", message: { id: 91, result } } ]);
    e.transport[0].request.input = [{ type: "function_call_output", call_id: "q1", output: JSON.stringify(result) }];
  }
  if (id === "C14") {
    e.before["memory.txt"] = file(n); delete e.after["memory.txt"];
    turn("remember", n, [command("cat memory.txt", n)]);
    turn("padding", "ACK", [...rpc("turn/start", { threadId: "t1", input: [{ type: "text", text: "x".repeat(13000) }] })]);
    const events = [ ...rpc("thread/compact/start", { threadId: "t1" }),
      received({ method: "item/started", params: { threadId: "t1", item: { type: "contextCompaction", id: "compact" } } }),
      received({ method: "item/completed", params: { threadId: "t1", item: { type: "contextCompaction", id: "compact" } } }) ];
    const compact = turn("compact", `summary ${n}`, events, { kind: "compaction" }); e.compaction = { inputBytes: 13000, phase: compact };
    e.restart = { sdkOffset: e.sdk.length, previousSdkSessionIds: ["s1"] }; session("s2"); thread("t1", "resume", 401); e.hosts.push({ pid: 401 });
    turn("compacted-recall", n);
  }
  if (id === "C15") {
    const commandItem = command("node long-task.mjs", "OWNED_TASK_STARTED");
    const phase = turn("interrupt", "", [received({ method: "item/started", params: { threadId: "t1", item: commandItem.message.params.item } }), commandItem,
      ...rpc("turn/interrupt", { threadId: "t1", turnId: "turn-1" }), ...rpc("thread/backgroundTerminals/clean", { threadId: "t1" }) ]);
    phase.result.status = "interrupted";
    e.interruption = { started: true, threadId: "t1", turnId: phase.result.id, pid: 777, hostPid: 777, processGone: true };
    e.after["task-started.json"] = file(JSON.stringify({ pid: 777 }));
    turn("recovery", n, [command("cat recovery.txt", n)]);
  }
  if (id === "C16") {
    const ledger = [{ event: "http", authenticated: false }];
    const call = (method, params, result) => { const id = ledger.length; ledger.push({ event: "request", id, method, params, authenticated: true }, { event: "response", id, method, result }); };
    call("resources/list", {}, {}); call("tools/list", {}, {});
    call("resources/read", { uri: "fixture://config" }, { contents: [{ text: JSON.stringify({ code: secret.resource }) }] });
    call("tools/call", { name: "lookup", arguments: { key: "missing" } }, { isError: true, content: [{ text: "ENOENT" }] });
    call("tools/call", { name: "lookup", arguments: { key: "selected" } }, { isError: false, content: [{ text: secret.mcp }] });
    e.mcp = { protocol: "http", unauthenticatedStatus: 401, ledger };
    turn("http-mcp", `${secret.resource} ${secret.mcp}`, ["missing", "selected"].map(key => item({ type: "mcpToolCall", server: "fixture", tool: "lookup", arguments: { key } })));
  }
  if (id === "C17") {
    session("s2");
    const lifecycle = tool => item({ type: "collabAgentToolCall", id: `agent-${tool}`, tool, status: "completed", senderThreadId: "t1",
      receiverThreadIds: ["child"], agentsStates: { child: { status: "completed", message: n } } });
    const read = command("cat child.txt", n);
    Object.assign(read.message.params, { threadId: "child", turnId: "child-turn" });
    const childAnswer = item({ type: "agentMessage", id: "child-answer", text: n });
    Object.assign(childAnswer.message.params, { threadId: "child", turnId: "child-turn" });
    const phase = turn("delegate", n, [lifecycle("spawnAgent"), read, childAnswer,
      received({ method: "turn/completed", params: { threadId: "child", turn: { id: "child-turn", status: "completed" } } }),
      lifecycle("wait"), lifecycle("closeAgent")]);
    for (const r of e.native) if (r.message.method === "item/completed") {
      r.message.params.threadId ??= "t1"; r.message.params.turnId ??= phase.result.id;
    }
    e.sdk.push({ type: "assistant.message", sessionId: "s1", data: { toolRequests: [{ toolCallId: "agent-spawnAgent" }] } },
      { type: "assistant.message", sessionId: "s2", data: { toolRequests: [{ toolCallId: read.message.params.item.id }] } });
    e.transport[0].request.input = [
      { type: "function_call_output", call_id: read.message.params.item.id, output: n },
      { type: "function_call_output", call_id: "agent-wait", output: JSON.stringify({ status: { child: { completed: n } }, timed_out: false }) },
    ];
  }
  if (id === "C18") {
    e.retry = { requestedFailures: 1, marker: secret.resource };
    e.transport.unshift({ ...e.transport[0], request: structuredClone(e.transport[0].request), status: 503, responseText: JSON.stringify({ error: { code: "fixture_transient_fault", message: secret.resource } }) });
    turn("retry", n, [command("cat secret.txt", n)]);
  }
}
