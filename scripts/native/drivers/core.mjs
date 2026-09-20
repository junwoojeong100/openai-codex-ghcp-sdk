import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrerequisiteError } from "../../validation/fixture.mjs";
import { registration, controlTurn, openThread, commandPrompt, assertPhaseAnswer,
  commandResult, finalText, phaseById, nativeEvents, controlMarker, fileText, completedItems } from "../oracles.mjs";

const readMarker = commandPrompt('process.stdout.write(require("node:fs").readFileSync("marker.txt","utf8"));');
const recall = "Without tools, repeat exactly the file value you read in the first turn. No extra text.";
const phasesOf = (e, ids) => ids.map((id) => phaseById(e, id));
const noCommands = (p) => assert.ok(!completedItems(p).some(({ type }) => type === "commandExecution"));
const responseOf = (e, id, method) => { const p = phaseById(e, id); assert.equal(p.method, method); assert.ok(p.result); return p.result; };

function routing(dimension) {
  return registration(async (f) => {
    if (dimension === "lifecycle") { f.addWorkspace(); f.baseline(); }
    const c = await openThread(f);
    if (dimension === "failure") {
      const before = f.sdk.length;
      let invalid;
      let unknown;
      try {
        unknown = await f.thread(c.host, { model: "invalid-validation-model" });
        invalid = await f.turn(c.host, unknown.thread.id, "Say READY without tools.");
        assert.notEqual(invalid.turn.status, "completed", "Unknown model unexpectedly completed.");
      } catch (error) {
        f.runtimeState.invalidModel = { name: error.name, message: error.message, code: error.code, sdkStart: before, sdkEnd: f.sdk.length };
      }
      f.runtimeState.invalidModel ??= { turnPhase: invalid.id, sdkStart: before, sdkEnd: f.sdk.length };
      const control = await controlTurn(f, c);
      return { first: control.phase.id, thread: c.threadId };
    }
    const first = await f.turn(c.host, c.threadId, readMarker);
    if (dimension === "normal") return { first: first.id, thread: c.threadId };
    const other = await f.thread(c.host, { cwd: f.workspaces[1].path });
    const otherValue = f.markers[1];
    const second = await f.turn(c.host, other.thread.id, readMarker);
    const a = await f.turn(c.host, c.threadId, recall);
    const b = await f.turn(c.host, other.thread.id, recall);
    return { first: first.id, second: second.id, a: a.id, b: b.id, otherValue };
  }, (e, data) => {
    const first = assertPhaseAnswer(e, data.first, controlMarker(e));
    const thread = e.native.phases.find((p) => p.kind === "thread" && p.result.thread.id === first.threadId);
    assert.ok(thread);
    assert.equal(thread.result.model, e.model);
    assert.equal(thread.result.modelProvider, "ghcp");
    if (dimension === "failure") {
      const invalid = e.native.runtimeState.invalidModel;
      assert.ok(invalid);
      const nativeRejection = invalid.turnPhase
        ? phaseById(e, invalid.turnPhase).turn.status === "failed"
        : invalid.name === "RpcError" && Number.isInteger(invalid.code);
      assert.ok(nativeRejection, "A transport timeout or assertion is not native unknown-model rejection.");
      assert.ok(!e.sdk.slice(invalid.sdkStart, invalid.sdkEnd).some(({ type }) => ["usage", "session.send.started", "session.created"].includes(type)));
    } else if (dimension === "lifecycle") {
      const [second, a, b] = phasesOf(e, [data.second, data.a, data.b]);
      assert.notEqual(first.threadId, second.threadId);
      assert.equal(a.threadId, first.threadId);
      assert.equal(b.threadId, second.threadId);
      assert.equal(data.otherValue, fileText(e.state.before, "marker.txt", 1).trim());
      assert.notEqual(data.otherValue, controlMarker(e));
      assertPhaseAnswer(e, second.id, data.otherValue);
      assert.ok(!second.prompt.includes(data.otherValue));
      assert.equal(finalText(a).trim(), controlMarker(e));
      assert.equal(finalText(b).trim(), data.otherValue);
      for (const phase of [a, b]) noCommands(phase);
      assert.equal(e.sdk.filter(({ type }) => type === "session.created").length, 2);
    }
  });
}

function streaming(dimension) {
  return registration(async (f) => {
    const c = await openThread(f);
    const control = await f.turn(c.host, c.threadId, readMarker);
    if (dimension === "normal") {
      const second = await f.turn(c.host, c.threadId, recall);
      return { control: control.id, second: second.id };
    }
    const after = c.host.transcript.length;
    const start = await f.rpc(c.host, "turn/start", { threadId: c.threadId, input: [{ type: "text", text: "Write integers from one onward, one per line, without tools." }] });
    const started = await c.host.waitFor(({ direction, message }) => direction === "receive" && message.method === "turn/started" &&
      message.params?.threadId === c.threadId && message.params?.turn?.id === start.turn.id, { after });
    assert.ok(started);
    await f.rpc(c.host, "turn/interrupt", { threadId: c.threadId, turnId: start.turn.id });
    await c.host.waitFor(({ direction, message }) => direction === "receive" && message.method === "turn/completed" &&
      message.params?.threadId === c.threadId && message.params?.turn?.id === start.turn.id, { after });
    const result = { control: control.id, interruptedTurn: start.turn.id, thread: c.threadId };
    if (dimension === "lifecycle") result.second = (await f.turn(c.host, c.threadId, readMarker)).id;
    return result;
  }, (e, data) => {
    assertPhaseAnswer(e, data.control, controlMarker(e));
    if (dimension === "normal") {
      const second = assertPhaseAnswer(e, data.second, controlMarker(e), { tool: false });
      noCommands(second);
      for (const id of [data.control, data.second]) {
        const phase = phaseById(e, id);
        const items = completedItems(phase).filter(({ type }) => type === "agentMessage");
        for (const item of items) {
          const deltas = phase.transcript.filter(({ direction, message }) => direction === "receive" && message.method === "item/agentMessage/delta" &&
            message.params?.threadId === phase.threadId && message.params?.turnId === phase.turnId && message.params?.itemId === item.id);
          assert.ok(deltas.length, "Missing native message deltas.");
          assert.equal(deltas.map(({ message }) => message.params.delta).join(""), item.text);
        }
      }
    } else {
      const completions = nativeEvents(e, "turn/completed").filter(({ message }) => message.params.threadId === data.thread && message.params.turn.id === data.interruptedTurn);
      assert.equal(completions.length, 1);
      assert.equal(completions[0].message.params.turn.status, "interrupted");
      assert.ok(e.sdk.some(({ type }) => type === "session.abort"), "Interrupted SDK session was not aborted.");
      if (data.second) {
        const second = assertPhaseAnswer(e, data.second, controlMarker(e));
        assert.notEqual(second.turnId, data.interruptedTurn);
        assert.equal(second.threadId, data.thread);
      }
    }
  }, dimension === "normal" ? {} : { covers: ["primary"], gaps: ["Need per-turn SDK abort correlation and proof no queued side effect survived interruption; an unrelated session.abort is insufficient."] });
}

function goals(dimension) {
  return registration(async (f) => {
    // A goal can automatically continue a turn. Do not run the fixture model
    // while the goal is active: the control finishes before setting the goal.
    const c = await controlTurn(f);
    const objective = `GOAL_${randomUUID()}`;
    const before = f.phases.length;
    const set = await f.rpc(c.host, "thread/goal/set", { threadId: c.threadId, objective, tokenBudget: 1000 });
    await f.rpc(c.host, "thread/goal/get", { threadId: c.threadId });
    if (dimension === "failure") {
      await f.rpc(c.host, "thread/goal/set", { threadId: c.threadId, tokenBudget: -1 }, { expectError: true });
      await f.rpc(c.host, "thread/goal/set", { threadId: `missing-${randomUUID()}`, objective }, { expectError: true });
      await f.rpc(c.host, "thread/goal/get", { threadId: c.threadId });
    } else if (dimension === "normal") {
      const other = await f.thread(c.host);
      await f.rpc(c.host, "thread/goal/get", { threadId: other.thread.id });
    } else {
      await f.rpc(c.host, "thread/goal/set", { threadId: c.threadId, objective: `${objective}_CHANGED`, status: "complete" });
      await f.rpc(c.host, "thread/goal/get", { threadId: c.threadId });
    }
    await f.rpc(c.host, "thread/goal/clear", { threadId: c.threadId });
    await f.rpc(c.host, "thread/goal/get", { threadId: c.threadId });
    return { control: c.phase.id, thread: c.threadId, objective, initial: set.goal, rpcIds: f.phases.slice(before).filter(({ kind }) => kind === "rpc").map(({ id }) => id) };
  }, (e, data) => {
    assertPhaseAnswer(e, data.control, controlMarker(e));
    const rpcs = phasesOf(e, data.rpcIds);
    const initial = rpcs.find(({ method }) => method === "thread/goal/get").result.goal;
    assert.equal(initial.threadId, data.thread);
    assert.equal(initial.objective, data.objective);
    assert.equal(initial.status, "active");
    assert.equal(initial.tokenBudget, 1000);
    assert.ok(nativeEvents(e, "thread/goal/updated").some(({ message }) => message.params?.goal?.threadId === data.thread));
    if (dimension === "normal") assert.ok(rpcs.some(({ method, params, result }) => method === "thread/goal/get" && params.threadId !== data.thread && result.goal === null));
    else if (dimension === "failure") {
      assert.equal(rpcs.filter(({ error }) => error?.name === "RpcError").length, 2);
      const reads = rpcs.filter(({ method, result }) => method === "thread/goal/get" && result.goal);
      assert.equal(reads.length, 2);
      assert.equal(reads[1].result.goal.objective, initial.objective);
      assert.equal(reads[1].result.goal.tokenBudget, initial.tokenBudget);
    } else {
      const changed = rpcs.filter(({ method, result }) => method === "thread/goal/get" && result.goal).at(-1).result.goal;
      assert.equal(changed.objective, `${data.objective}_CHANGED`);
      assert.equal(changed.status, "complete");
    }
    assert.equal(rpcs.at(-2).method, "thread/goal/clear");
    assert.equal(rpcs.at(-2).result.cleared, true);
    assert.equal(rpcs.at(-1).result.goal, null);
    assert.ok(nativeEvents(e, "thread/goal/cleared").some(({ message }) => message.params?.threadId === data.thread));
  }, { covers: ["primary"], gaps: ["Goal auto-continuation must be explicitly contained and accounted for; lifecycle still needs a post-clear thread-isolation check."] });
}

function hostContract(dimension) {
  return registration(async (f) => {
    let beforeInitialize;
    if (dimension === "failure") {
      const raw = await f.host({ initialize: false });
      await f.rpc(raw, "thread/read", { threadId: "not-initialized-fixture" }, { expectError: true });
      beforeInitialize = f.phases.at(-1).id;
      await raw.stop();
    }
    const c = await controlTurn(f, await openThread(f, { ephemeral: false }));
    const before = f.phases.length;
    await f.rpc(c.host, "thread/read", { threadId: c.threadId, includeTurns: true });
    if (dimension === "failure") {
      await f.rpc(c.host, "validation/unknownMethod", {}, { expectError: true });
      await f.rpc(c.host, "thread/read", { threadId: 7 }, { expectError: true });
      await f.turn(c.host, c.threadId, recall);
    } else if (dimension === "lifecycle") {
      await f.rpc(c.host, "thread/name/set", { threadId: c.threadId, name: `fixture-${c.threadId}` });
      await f.rpc(c.host, "thread/read", { threadId: c.threadId, includeTurns: true });
      await f.rpc(c.host, "thread/list", { limit: 100, sourceKinds: [], cwd: f.workspace });
      await f.rpc(c.host, "thread/archive", { threadId: c.threadId });
      await f.rpc(c.host, "thread/list", { limit: 100, archived: true, sourceKinds: [], cwd: f.workspace });
      await f.rpc(c.host, "thread/unarchive", { threadId: c.threadId });
      await f.rpc(c.host, "thread/resume", { threadId: c.threadId, model: f.model, modelProvider: "ghcp", cwd: f.workspace, sandbox: "read-only" });
      await f.turn(c.host, c.threadId, recall);
    }
    return { control: c.phase.id, thread: c.threadId, beforeInitialize, phases: f.phases.slice(before).filter(({ id }) => id).map(({ id }) => id) };
  }, (e, data) => {
    assertPhaseAnswer(e, data.control, controlMarker(e));
    const host = e.native.hosts.find(({ id }) => id === phaseById(e, data.control).hostId);
    const init = host.transcript.find(({ direction, message }) => direction === "send" && message.method === "initialize");
    const initialized = host.transcript.find(({ direction, message }) => direction === "send" && message.method === "initialized");
    assert.ok(init && initialized && initialized.sequence > init.sequence);
    assert.ok(host.transcript.some(({ direction, message, sequence }) => direction === "receive" && message.id === init.message.id && message.result && sequence < initialized.sequence));
    const read = phasesOf(e, data.phases).find(({ method }) => method === "thread/read");
    assert.equal(read.result.thread.id, data.thread);
    assert.ok(JSON.stringify(read.result.thread.turns).includes(controlMarker(e)));
    if (dimension === "failure") {
      const errors = phasesOf(e, data.phases).filter(({ error }) => error);
      assert.equal(errors.length, 2);
      assert.ok(errors.every(({ error }) => error.name === "RpcError" && Number.isInteger(error.code)));
      const early = phaseById(e, data.beforeInitialize);
      assert.equal(early.error.name, "RpcError");
      assert.match(early.error.message, /not initialized/i);
      const raw = e.native.hosts.find(({ id }) => id === early.hostId);
      assert.ok(!raw.transcript.some(({ direction, message }) => direction === "send" && message.method === "initialize"));
      const recovered = phasesOf(e, data.phases).at(-1);
      assertPhaseAnswer(e, recovered.id, controlMarker(e), { tool: false });
      noCommands(recovered);
    } else if (dimension === "lifecycle") {
      const phases = phasesOf(e, data.phases);
      const renamed = phases.filter(({ method }) => method === "thread/read").at(-1);
      assert.equal(renamed.result.thread.name, `fixture-${data.thread}`);
      const lists = phases.filter(({ method }) => method === "thread/list");
      assert.equal(lists.length, 2);
      assert.ok(lists.every(({ result }) => result.data.some(({ id }) => id === data.thread)));
      assert.ok(nativeEvents(e, "thread/archived").some(({ message }) => message.params?.threadId === data.thread));
      assert.ok(nativeEvents(e, "thread/unarchived").some(({ message }) => message.params?.threadId === data.thread));
      const last = phases.at(-1);
      assert.equal(last.threadId, data.thread);
      assert.equal(finalText(last).trim(), controlMarker(e));
      noCommands(last);
    }
  });
}

function sessions(dimension) {
  return registration(async (f) => {
    const c = await controlTurn(f, await openThread(f, { ephemeral: false }));
    const before = f.phases.length;
    await f.rpc(c.host, "thread/read", { threadId: c.threadId, includeTurns: true });
    await c.host.stop();
    const host = await f.host();
    if (dimension === "failure") {
      await f.rpc(host, "thread/resume", { threadId: `missing-${randomUUID()}` }, { expectError: true });
      const otherHome = path.join(f.home, "separate-codex-home");
      fs.mkdirSync(otherHome, { mode: 0o700 });
      const other = await f.host({ home: otherHome });
      await f.rpc(other, "thread/resume", { threadId: c.threadId }, { expectError: true });
    }
    await f.rpc(host, "thread/resume", { threadId: c.threadId, model: f.model, modelProvider: "ghcp", cwd: f.workspace, sandbox: "read-only" });
    const resumed = await f.turn(host, c.threadId, recall);
    if (dimension !== "lifecycle") return { control: c.phase.id, resumed: resumed.id, phases: f.phases.slice(before).filter(({ id }) => id).map(({ id }) => id) };
    const fork = await f.rpc(host, "thread/fork", { threadId: c.threadId, ephemeral: false, model: f.model, modelProvider: "ghcp", cwd: f.workspace, sandbox: "read-only" });
    const a = `SOURCE_${randomUUID()}`;
    const b = `FORK_${randomUUID()}`;
    const source = await f.turn(host, c.threadId, `Remember branch value ${JSON.stringify(a)}. Reply with only that value.`);
    const branch = await f.turn(host, fork.thread.id, `Remember branch value ${JSON.stringify(b)}. Reply with only that value.`);
    const sourceRead = await f.turn(host, c.threadId, 'Without tools return JSON with "file" equal to the originally read file value and "branch" equal to your branch value.');
    const branchRead = await f.turn(host, fork.thread.id, 'Without tools return JSON with "file" equal to the originally read file value and "branch" equal to your branch value.');
    return { control: c.phase.id, resumed: resumed.id, source: source.id, branch: branch.id, sourceRead: sourceRead.id, branchRead: branchRead.id, a, b, forkId: fork.thread.id };
  }, (e, data) => {
    const original = assertPhaseAnswer(e, data.control, controlMarker(e));
    const resumed = assertPhaseAnswer(e, data.resumed, controlMarker(e), { tool: false });
    assert.equal(original.threadId, resumed.threadId);
    assert.notEqual(original.hostId, resumed.hostId);
    noCommands(resumed);
    if (dimension === "normal") {
      const read = phasesOf(e, data.phases).find(({ method }) => method === "thread/read");
      assert.equal(read.result.thread.id, original.threadId);
      assert.ok(JSON.stringify(read.result.thread.turns).includes(controlMarker(e)));
    } else if (dimension === "failure") {
      const phases = phasesOf(e, data.phases);
      assert.equal(phases.filter(({ method, error }) => method === "thread/resume" && error?.name === "RpcError").length, 2);
    } else {
      assert.notEqual(original.threadId, data.forkId);
      for (const [id, text] of [[data.source, data.a], [data.branch, data.b]]) {
        const p = assertPhaseAnswer(e, id, text, { tool: false }); noCommands(p);
      }
      for (const [id, branch] of [[data.sourceRead, data.a], [data.branchRead, data.b]]) {
        const p = assertPhaseAnswer(e, id, { file: controlMarker(e), branch }, { tool: false, json: true }); noCommands(p);
      }
      assert.equal(phaseById(e, data.branchRead).threadId, data.forkId);
      assert.equal(phaseById(e, data.sourceRead).threadId, original.threadId);
    }
  }, dimension === "lifecycle" ? { covers: ["primary"], gaps: ["Still needs process restart/resume and independent persisted-history inspection for both branches."] } : {});
}

function reasoning(dimension) {
  return registration(async (f) => {
    const c = await openThread(f);
    const control = await controlTurn(f, c);
    if (dimension === "failure") {
      const before = f.sdk.length;
      try {
        const invalid = await f.turn(c.host, c.threadId, "Reply INVALID.", { effort: "invalid-native-effort" });
        assert.equal(invalid.turn.status, "failed", "Invalid effort was silently accepted.");
      } catch (error) { if (error.name !== "RpcError") throw error; }
      const errorPhase = f.phases.at(-1).id;
      const after = f.sdk.length;
      const available = [...(f.modelInfo.supportedReasoningEfforts || []), ...(f.modelInfo.capabilities?.supportedReasoningEfforts || [])];
      const recovered = await f.turn(c.host, c.threadId, recall, { effort: available[0] ?? "low" });
      return { control: control.phase.id, before, after, errorPhase, recovered: recovered.id };
    }
    const configurable = f.modelInfo.capabilities?.supports?.reasoningEffort !== false;
    const available = [...new Set([...(f.modelInfo.supportedReasoningEfforts || []), ...(f.modelInfo.capabilities?.supportedReasoningEfforts || [])])];
    if (configurable && (!available.length || dimension === "lifecycle" && available.length < 2)) {
      throw new PrerequisiteError("Catalog lacks required effort levels; no approximation used.", "reasoning-catalog");
    }
    const low = configurable ? (available.includes("low") ? "low" : available[0]) : "low";
    const high = configurable ? available.findLast((level) => level !== low) : "high";
    const first = await f.turn(c.host, c.threadId, recall, { effort: low });
    const second = dimension === "lifecycle" ? await f.turn(c.host, c.threadId, recall, { effort: high }) : null;
    f.runtimeState.modelInfo = f.modelInfo;
    return { control: control.phase.id, first: first.id, second: second?.id, configurable, low, high };
  }, (e, data) => {
    assertPhaseAnswer(e, data.control, controlMarker(e));
    if (dimension === "failure") {
      const error = phaseById(e, data.errorPhase);
      assert.ok(error.error?.name === "RpcError" || error.turn?.status === "failed");
      assert.equal(error.options.effort, "invalid-native-effort");
      if (!error.error) assert.ok(e.http.slice(error.httpStart, error.httpEnd).some(({ error }) => error?.code === "model_unavailable"));
      assert.ok(!e.sdk.slice(data.before, data.after).some(({ type }) => ["session.send.started", "usage"].includes(type)));
      const recovered = assertPhaseAnswer(e, data.recovered, controlMarker(e), { tool: false });
      assert.equal(recovered.threadId, phaseById(e, data.control).threadId);
      noCommands(recovered);
      return;
    }
    const info = e.native.runtimeState.modelInfo;
    assert.equal(data.configurable, info.capabilities?.supports?.reasoningEffort !== false);
    const advertised = [...(info.supportedReasoningEfforts || []), ...(info.capabilities?.supportedReasoningEfforts || [])];
    for (const [id, effort] of [[data.first, data.low], ...(data.second ? [[data.second, data.high]] : [])]) {
      const p = assertPhaseAnswer(e, id, controlMarker(e), { tool: false });
      assert.equal(p.options.effort, effort); noCommands(p);
      if (data.configurable) {
        assert.ok(advertised.includes(effort));
        const configured = e.sdk.slice(0, p.sdkEnd).filter(({ type }) => ["session.created", "session.setModel"].includes(type)).at(-1);
        assert.equal(configured.effort, effort);
      } else {
        assert.ok(e.sdk.filter(({ type }) => ["session.created", "session.setModel"].includes(type)).every(({ effort: actual }) => actual === null));
        assert.ok(e.diagnostics.some(({ event, requested }) => event === "bridge.reasoning_not_configurable" && requested === effort));
      }
    }
    assert.equal(e.sdk.filter(({ type }) => type === "session.created").length, 1);
  });
}

export const CORE_DRIVERS = Object.freeze(Object.fromEntries(["normal", "failure", "lifecycle"].flatMap((dimension) => [
  [`model-routing.${dimension}`, routing(dimension)], [`streaming.${dimension}`, streaming(dimension)],
  [`goals.${dimension}`, goals(dimension)], [`agent-sdk-host.${dimension}`, hostContract(dimension)],
  [`session-resume.${dimension}`, sessions(dimension)], [`reasoning-effort.${dimension}`, reasoning(dimension)],
])));
