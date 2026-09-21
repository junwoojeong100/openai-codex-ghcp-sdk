#!/usr/bin/env node
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SessionManager } from "../src/session-manager.mjs";
import { normalizeRequest } from "../src/request-policy.mjs";
import { outputItems } from "../src/responses.mjs";
import { FakeClient, deferred, headers, model } from "../test/helpers/stability-sdk.mjs";

// A repeatable state-machine stress test, not a wall-clock soak or live-model run.
export async function checkStress({ cycles = 100 } = {}) {
  assert.ok(Number.isSafeInteger(cycles) && cycles > 0 && cycles <= 1000);
  const start = performance.now(), clients = [], diagnostics = [];
  let generation = 0, callNumber = 0, toolResults = 0, held, gate;
  const tools = ["fixture", "unused"].map(name => ({ type: "function", name, description: `Owned ${name} tool.`, parameters: { type: "object", properties: {} } }));
  const createClient = () => {
    const client = new FakeClient({
      onSend: async (session, { prompt }) => {
        if (!client.alive) throw new Error("closed synthetic SDK");
        if (prompt === "gated") { held.resolve(); await gate.promise; session.reply("released"); return; }
        const declaration = session.config.tools.find(t => t.description.startsWith("Client tool fixture."));
        session.toolCalls([{ name: declaration.name, toolCallId: `stress-${++callNumber}`, arguments: {} }]);
      },
      onSubmit: (session, request) => { toolResults++; session.reply(request.result.textResultForLlm); },
    });
    client.alive = true; client.generation = ++generation;
    client.ping = async () => { if (!client.alive) throw new Error("closed synthetic SDK"); return {}; };
    client.forceStop = async () => { client.alive = false; client.stopped = true; for (const s of client.sessions) s.events.removeAllListeners(); };
    clients.push(client); return client;
  };
  const manager = new SessionManager({ client: createClient(), clientFactory: createClient, maxStates: 8,
    readinessTimeoutMs: 100, startupTimeoutMs: 500, cleanupTimeoutMs: 50, recoveryBackoffMs: 1,
    turnTimeoutMs: 2000, requestTimeoutMs: 2500, maxRequestsPerFamily: 4, onDiagnostic: e => diagnostics.push(e) });
  await manager.start();
  let maxStates = 0, recoveries = 0, cancelledWaiters = 0;
  try {
    for (let index = 0; index < cycles; index++) {
      const family = `stress-${index}`, prompt = `read-${index}`, token = `literal:${index}:한글`;
      const firstBody = { model, input: prompt, tools }, normalized = normalizeRequest(firstBody);
      const first = await manager.execute(firstBody, headers(family));
      const call = outputItems(first.messages, first.tools).find(i => i.type === "function_call"); assert.ok(call);
      const next = { model, tools: [...tools].reverse(), input: [{ role: "user", content: prompt },
        ...outputItems(first.messages, first.tools), { type: "function_call_output", call_id: call.call_id, output: token }] };
      const before = toolResults;
      const reply = await manager.execute(next, headers(family));
      assert.equal(reply.messages.at(-1).content, token);
      const retry = await manager.execute({ ...next, tools }, headers(family));
      assert.deepEqual(retry, reply); assert.equal(toolResults, before + 1);
      assert.equal(normalized.tools.length, 2);
      await manager.queue.drain(); assert.equal(manager.queue.total, 0);
      assert.ok([...manager.states.values()].every(s => s.outstanding.size === 0 && s.pending.size === 0));
      maxStates = Math.max(maxStates, manager.states.size); assert.ok(maxStates <= 8);
      if ((index + 1) % 10 === 0) {
        held = deferred(); gate = deferred();
        const active = manager.execute({ model, input: "gated" }, headers(`gate-${index}`));
        await held.promise;
        const controller = new AbortController();
        const waiter = manager.execute({ model, input: "must-not-run" }, headers(`gate-${index}`), { signal: controller.signal });
        const rejected = assert.rejects(waiter, { name: "AbortError" }); controller.abort(); await rejected;
        assert.equal(manager.queue.total, 1); cancelledWaiters++;
        gate.resolve(); await active; await manager.queue.drain();
        const old = manager.client;
        old.alive = false; assert.equal((await manager.readiness()).ready, false);
        await Promise.all(Array.from({ length: 8 }, () => manager.ensureReady()));
        recoveries++; assert.notEqual(manager.client, old);
        assert.equal(manager.states.size, 0); assert.equal(manager.responses.size, 0); assert.equal(manager.callStates.size, 0);
        await assert.rejects(manager.execute({ model, input: "do not replay", tools }, headers(family)), { code: "upstream_session_lost" });
        await delay(2); // Let the deliberately short synthetic recovery backoff elapse.
      }
    }
    assert.equal(toolResults, cycles);
    assert.equal(diagnostics.filter(d => d.event === "bridge.upstream_recovered").length, recoveries);
    assert.ok(!clients.flatMap(c => c.sessions).flatMap(s => s.sent).some(s => s.prompt === "must-not-run"));
  } finally { gate?.resolve(); await manager.stop(); }
  assert.equal(manager.queue.total, 0); assert.equal(manager.states.size, 0); assert.equal(manager.responses.size, 0); assert.equal(manager.callStates.size, 0);
  assert.equal(manager.queue.families.size, 0); assert.equal(manager.busyFamilies.size, 0);
  assert.ok(clients.flatMap(c => c.sessions).every(s => s.events.eventNames().length === 0));
  return { executionKind: "offline-stress", realModelCalls: 0, passed: true, cycles,
    toolResults, exactResultRetries: cycles, cancelledWaiters, recoveredGenerations: recoveries,
    maximumResidentStates: maxStates, finalQueue: 0, finalStates: 0, listenersRemaining: 0,
    durationMs: Math.ceil(performance.now() - start), hoursLongSoakCertified: false };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/check-stability-stress.mjs");
  checkStress().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error); process.exitCode = 1; });
}
