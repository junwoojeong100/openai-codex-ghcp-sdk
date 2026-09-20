import assert from "node:assert/strict";
import { sha256 } from "../validation/evidence.mjs";

export const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
export const nodeCommand = (code) => `${shellQuote(process.execPath)} -e ${shellQuote(code)}`;
export const commandPrompt = (code, ending = "Reply with exactly the single line printed by the command, without formatting.") =>
  `Bounded fixture validation. Use the native shell tool exactly once to run this exact command from the current workspace:\n${nodeCommand(code)}\n` +
  `Do not execute other commands, inspect other files, access external services, or delegate. ${ending}`;

export function phaseById(evidence, id) {
  const phases = evidence.native.phases.filter((phase) => phase.id === id);
  assert.equal(phases.length, 1, `Missing/ambiguous native phase ${id}.`);
  return phases[0];
}
export function completedItems(phase) {
  if (phase.kind === "exec") {
    assert.equal(phase.result.code, 0, phase.result.stderr);
    assert.equal(phase.result.signal, null);
    const events = phase.result.stdout.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
    assert.ok(!events.some(({ type }) => ["error", "turn.failed"].includes(type)));
    assert.equal(events.filter(({ type }) => type === "turn.completed").length, 1);
    return events.filter(({ type }) => type === "item.completed").map(({ item }) => ({
      ...item, type: ({ command_execution: "commandExecution", agent_message: "agentMessage", file_change: "fileChange" })[item.type] || item.type,
      ...(item.type === "command_execution" ? { exitCode: item.exit_code, aggregatedOutput: item.aggregated_output } : {}),
    }));
  }
  assert.equal(phase.turn?.status, "completed", "Native turn did not complete successfully.");
  assert.ok(!phase.turn.error);
  const records = phase.transcript || [];
  const completed = records.filter(({ direction, message }) => direction === "receive" && message.method === "turn/completed" &&
    message.params?.threadId === phase.threadId && message.params?.turn?.id === phase.turnId);
  assert.equal(completed.length, 1, "Exactly one native completion per turn is required.");
  const completedTurn = completed[0].message.params.turn;
  assert.equal(completedTurn.status, "completed", "Retained native completion contradicts the claimed success.");
  assert.ok(!completedTurn.error, "Retained native completion has an error.");
  assert.equal(phase.turn.id, phase.turnId, "Native phase and completed turn identities differ.");
  const items = records.filter(({ direction, message }) => direction === "receive" && message.method === "item/completed" &&
    message.params?.threadId === phase.threadId && message.params?.turnId === phase.turnId).map(({ message }) => message.params.item);
  assert.equal(new Set(items.map(({ id }) => id)).size, items.length, "Duplicated native completed item.");
  assert.ok(!records.some(({ direction, message }) => direction === "receive" && message.method === "error" && !message.params?.willRetry), "Native terminal error.");
  return items;
}
export function finalText(phase) {
  const messages = completedItems(phase).filter(({ type }) => type === "agentMessage");
  assert.ok(messages.length, "No final native agent message.");
  return messages.at(-1).text;
}
export function commandResult(phase, { count = 1, failure = false, text, contains } = {}) {
  const items = completedItems(phase);
  const commands = items.filter(({ type }) => type === "commandExecution");
  assert.equal(commands.length, count, "Unexpected native command count.");
  assert.ok(!items.some(({ type }) => ["mcpToolCall", "webSearch", "collabAgentToolCall"].includes(type)), "Unexpected tool surface in a bounded shell scenario.");
  for (const command of commands) {
    assert.ok(Number.isInteger(command.exitCode), "Missing actual command exit code.");
    assert.ok(failure ? command.exitCode !== 0 : command.exitCode === 0, "Wrong native command outcome.");
  }
  if (text !== undefined) assert.equal(commands.at(-1).aggregatedOutput.trim(), text);
  if (contains) assert.match(commands.at(-1).aggregatedOutput, contains);
  return commands;
}
export function fileText(capture, name, workspace = 0) {
  const item = capture[workspace]?.[name];
  assert.equal(item?.kind, "file", `Missing retained fixture file ${name}.`);
  const data = Buffer.from(item.base64, "base64");
  assert.equal(sha256(data), item.sha256, `Corrupt fixture bytes: ${name}`);
  return data.toString("utf8");
}
export function assertPhaseAnswer(evidence, id, expected, { tool = true, json = false, failure = false, contains } = {}) {
  const phase = phaseById(evidence, id);
  if (tool) commandResult(phase, { ...(json ? {} : { text: failure ? undefined : expected }), failure, contains });
  const text = finalText(phase).trim();
  if (json) assert.deepEqual(JSON.parse(text), expected);
  else assert.equal(text, expected);
  return phase;
}
export function nativeEvents(evidence, method) {
  return evidence.native.hosts.flatMap((host) => host.transcript.map((record) => ({ ...record, hostId: host.id })))
    .filter(({ direction, message }) => direction === "receive" && message.method === method);
}
export function controlMarker(evidence) { return fileText(evidence.state.before, "marker.txt").trim(); }

function evidenceRange(records, start, end, label) {
  assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start && end <= records.length,
    `${label} evidence range is invalid.`);
  return records.slice(start, end);
}

export function assertNativeRoute(evidence, model, { offline = false } = {}) {
  if (!offline) {
    assert.match(evidence.native.version || "", /^codex-cli 0\.154\.0\s*$/);
    assert.ok(evidence.native.hosts.every(({ command }) => command && !/fake|mock/i.test(command)), "A test double is not native execution.");
  }
  const sessions = evidence.sdk.filter(({ type }) => type === "session.created");
  const usage = evidence.sdk.filter(({ type }) => type === "usage");
  assert.ok(sessions.length && usage.length, "Native route needs actual SDK session and usage evidence.");
  const ids = new Set(sessions.map(({ sessionId }) => sessionId));
  assert.equal(ids.size, sessions.length, "Duplicate SDK session identity.");
  assert.ok(sessions.every((event) => typeof event.sessionId === "string" && event.sessionId.length && event.model === model));
  assert.ok(usage.every((event) => event.model === model && ids.has(event.sessionId)), "Wrong/unattributed SDK model usage.");
  assert.ok(evidence.http.some(({ layer, threadId, sessionId, result }) => layer === "bridge" && (threadId || sessionId) && result?.model === model), "No correlated native bridge request.");
  let turns = 0;
  for (const phase of evidence.native.phases) {
    const successful = phase.kind === "turn" ? phase.turn?.status === "completed" : phase.kind === "exec" && phase.result?.code === 0 && phase.json;
    if (!successful) continue;
    const text = finalText(phase);
    assert.ok(typeof text === "string" && text.length, "A successful native answer must contain text.");
    let threadId = phase.threadId;
    if (phase.kind === "exec") {
      const starts = phase.result.stdout.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
        .filter(({ type }) => type === "thread.started");
      assert.equal(starts.length, 1, "Native exec needs exactly one thread identity.");
      threadId = starts[0].thread_id;
    } else {
      const hosts = evidence.native.hosts.filter(({ id }) => id === phase.hostId);
      assert.equal(hosts.length, 1, "Missing/ambiguous native host for the completed turn.");
      const completions = hosts[0].transcript.filter(({ direction, message }) => direction === "receive" &&
        message.method === "turn/completed" && message.params?.threadId === threadId && message.params?.turn?.id === phase.turnId);
      assert.equal(completions.length, 1, "Host transcript has no unique completion for the native turn.");
      assert.equal(completions[0].message.params.turn.status, "completed");
      assert.ok(!completions[0].message.params.turn.error);
    }
    assert.ok(typeof threadId === "string" && threadId.length, "Missing native thread identity.");
    const trace = evidenceRange(evidence.sdk, phase.sdkStart, phase.sdkEnd, `${phase.id} SDK`);
    assert.ok(trace.some(({ type, model: actual }) => type === "usage" && actual === model), `Missing SDK usage for ${phase.id}`);
    const exchanges = evidenceRange(evidence.http, phase.httpStart, phase.httpEnd, `${phase.id} HTTP`)
      .filter(({ layer }) => layer === "bridge");
    assert.ok(exchanges.length, `Missing native bridge exchanges for ${phase.id}`);
    for (const exchange of exchanges) {
      assert.equal(exchange.threadId, threadId, "Bridge request belongs to a different native thread.");
      if (exchange.sessionId != null) assert.equal(exchange.sessionId, threadId, "Bridge session and native thread differ.");
      assert.ok(exchange.sdkStart >= phase.sdkStart && exchange.sdkEnd <= phase.sdkEnd, "Bridge SDK evidence is outside the native turn.");
      evidenceRange(evidence.sdk, exchange.sdkStart, exchange.sdkEnd, "Bridge SDK");
    }
    const matched = exchanges.filter(({ result }) => result?.model === model &&
      result.messages?.some(({ content }) => content === text));
    assert.ok(matched.length, `Native text lacks matching bridge output for ${phase.id}`);
    assert.ok(matched.some((exchange) => evidenceRange(evidence.sdk, exchange.sdkStart, exchange.sdkEnd, "Answer SDK")
      .some(({ type, model: actual, sessionId }) => type === "usage" && actual === model && ids.has(sessionId))),
    `Final native answer has no SDK usage in its own bridge exchange: ${phase.id}`);
    turns += 1;
  }
  assert.ok(turns > 0, "No native model turn was completed; direct HTTP probes are not native evidence.");
  return { model, sdkSessions: ids.size, usageEvents: usage.length, nativeCompletedTurns: turns };
}

export function assertIsolation(evidence) {
  const state = evidence.state;
  assert.equal(state.configurationUnchanged, true);
  assert.deepEqual(state.configurationBefore, state.configurationAfter);
  assert.equal(state.isolatedConfigUnchanged, true);
  assert.equal(state.outsideUnchanged, true);
  assert.deepEqual(state.outsideBefore, state.outsideAfter);
  assert.equal(state.fixtureChangesAuthorized, true);
  assert.ok(Array.isArray(state.before) && state.before.length > 0, "Missing initial workspace snapshots.");
  assert.ok(Array.isArray(state.after) && state.after.length === state.before.length, "Missing/mismatched final workspace snapshots.");
  assert.ok(Array.isArray(state.changes) && Array.isArray(state.expectedFinal), "Missing file-change evidence.");
  const expectedByKey = new Map();
  for (const expectation of state.expectedFinal) {
    assert.ok(typeof expectation.key === "string" && /^(0|[1-9][0-9]*):.+$/.test(expectation.key));
    assert.ok(!expectedByKey.has(expectation.key), "Duplicate expected final state.");
    expectedByKey.set(expectation.key, expectation);
    const colon = expectation.key.indexOf(":");
    const workspace = Number(expectation.key.slice(0, colon)), name = expectation.key.slice(colon + 1);
    assert.ok(workspace < state.after.length, "Expectation belongs to a missing workspace.");
    assert.deepEqual(expectation.actual, state.after[workspace][name] ?? { kind: "missing" }, "Expected-state receipt differs from the final snapshot.");
  }
  for (const change of state.changes) {
    assert.equal(change.authorized, true);
    assert.ok(change.expected);
    assert.ok(Number.isSafeInteger(change.workspace) && change.workspace >= 0 && change.workspace < state.after.length);
    assert.deepEqual(change.before, state.before[change.workspace][change.path] ?? { kind: "missing" }, "Change receipt differs from the initial snapshot.");
    assert.deepEqual(change.after, state.after[change.workspace][change.path] ?? { kind: "missing" }, "Change receipt differs from the final snapshot.");
    assert.notDeepEqual(change.before, change.after, "A change receipt claims an unchanged file.");
    assert.deepEqual(change.expected, expectedByKey.get(`${change.workspace}:${change.path}`)?.expected,
      "Changed file has no matching final-state authorization.");
    assert.equal(change.after.kind, change.expected.kind);
    if (change.after.kind === "file") assert.equal(change.after.sha256, change.expected.sha256);
  }
  for (const expectation of state.expectedFinal) {
    assert.equal(expectation.matched, true);
    assert.equal(expectation.actual.kind, expectation.expected.kind);
    if (expectation.actual.kind === "file") assert.equal(expectation.actual.sha256, expectation.expected.sha256);
  }
  // Re-derive file changes from the retained snapshots, not the reported booleans.
  for (let index = 0; index < state.after.length; index += 1) {
    for (const capture of [state.before[index], state.after[index]]) {
      assert.ok(capture && typeof capture === "object" && !Array.isArray(capture), "Invalid workspace snapshot.");
      for (const item of Object.values(capture)) {
        assert.ok(item && ["file", "directory", "symlink"].includes(item.kind), "Invalid snapshot entry.");
        if (item.kind === "file") {
          assert.equal(typeof item.base64, "string");
          assert.equal(sha256(Buffer.from(item.base64, "base64")), item.sha256, "Corrupt retained fixture bytes.");
        }
      }
    }
    for (const name of new Set([...Object.keys(state.before[index]), ...Object.keys(state.after[index])])) {
      const before = state.before[index][name] ?? { kind: "missing" };
      const after = state.after[index][name] ?? { kind: "missing" };
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        assert.equal(state.changes.filter((change) => change.workspace === index && change.path === name && change.authorized).length, 1);
      }
    }
  }
}
export function assertCleanup(evidence) {
  assert.equal(evidence.state.allListenersClosed, true);
  assert.equal(evidence.state.nativeProcessesClosed, true);
  assert.equal(evidence.state.ownedFixtureRemoved, true);
  assert.deepEqual(evidence.state.cleanupErrors, []);
  assert.ok(Array.isArray(evidence.processes), "Missing native process receipts.");
  const receipts = evidence.processes.filter(({ kind }) => kind === "app-server");
  assert.equal(receipts.length, evidence.native.hosts.length, "Missing/extra app-server cleanup receipt.");
  for (const host of evidence.native.hosts) {
    const matches = receipts.filter(({ id }) => id === host.id);
    assert.equal(matches.length, 1, "Missing/ambiguous app-server cleanup receipt.");
    assert.equal(matches[0].closed, true);
    assert.ok(matches[0].exit && (Number.isInteger(matches[0].exit.code) || typeof matches[0].exit.signal === "string" ||
      typeof matches[0].exit.error === "string"), "App-server has no exit receipt.");
  }
  for (const phase of evidence.native.phases.filter(({ kind, result }) => kind === "exec" && result)) {
    const matches = evidence.processes.filter((record) => record.kind !== "app-server" && record.pid === phase.result.pid);
    assert.equal(matches.length, 1, "Missing/ambiguous native exec cleanup receipt.");
    assert.equal(matches[0].closed, true);
    for (const key of ["code", "signal", "stdout", "stderr", "terminated"]) assert.deepEqual(matches[0][key], phase.result[key]);
  }
  assert.ok(evidence.processes.every(({ closed }) => closed === true), "An owned native process was not closed.");
  const deleted = new Set(evidence.sdk.filter(({ type }) => type === "client.deleteSession").map(({ sessionId }) => sessionId));
  assert.ok(evidence.sdk.filter(({ type }) => type === "session.created").every(({ sessionId }) => deleted.has(sessionId)), "SDK session cleanup receipt missing.");
  const clients = evidence.sdk.filter(({ type }) => type === "client.created");
  const stopped = evidence.sdk.filter(({ type }) => type === "client.stop" || type === "client.forceStop");
  assert.equal(clients.length, stopped.length, "SDK client shutdown receipt missing.");
  assert.ok(stopped.every(({ errors }) => !errors?.length));
}

export function registration(execute, evaluate, { covers = ["primary", "secondary"], outcome = "supported", gaps = [] } = {}) {
  return Object.freeze({ execute, evaluate, covers: Object.freeze(covers), outcome, gaps });
}
export async function openThread(fixture, options) {
  const host = await fixture.host();
  const start = await fixture.thread(host, options);
  return { host, start, threadId: start.thread.id };
}
export async function controlTurn(fixture, connection) {
  const c = connection ?? await openThread(fixture);
  const phase = await fixture.turn(c.host, c.threadId, commandPrompt('process.stdout.write(require("node:fs").readFileSync("marker.txt","utf8"));'));
  return { ...c, phase };
}
