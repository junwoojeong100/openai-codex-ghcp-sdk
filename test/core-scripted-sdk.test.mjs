import assert from "node:assert/strict";
import test from "node:test";
import { CoreScriptedSdk } from "./helpers/core-scripted-sdk.mjs";

const marker = "N_0123456789abcdef0123_한글";
const tool = (name, properties = {}) => ({ name, description: `Client tool functions.${name}.`, parameters: { type: "object", properties } });
async function session(id) {
  const sdk = new CoreScriptedSdk(id);
  const session = await sdk.createSession({ sessionId: `test-${id}`, model: "gpt-6-astra", tools: [
    tool("exec_command", { cmd: { type: "string" } }), tool("spawn_agent"),
    tool("wait", { targets: { type: "array" } }), tool("close_agent", { target: { type: "string" } }),
  ] });
  const messages = [], calls = [];
  session.on("assistant.message", event => { messages.push(event.data); calls.push(...(event.data.toolRequests ?? [])); });
  const submit = (call, text) => session.rpc.tools.handlePendingToolCall({ requestId: `rpc-${call.toolCallId}`, result: { textResultForLlm: text, resultType: "success" } });
  return { session, messages, calls, submit };
}

test("the mechanical peer buffers interrupted-turn steering until the original tool result arrives", async () => {
  const { session: sdk, messages, calls, submit } = await session("C15");
  await sdk.send({ prompt: "Start the long task." });
  assert.equal(calls.length, 1); assert.equal(calls[0].arguments.cmd, "node long-task.mjs");
  await sdk.send({ mode: "immediate", source: "user", prompt: "<turn_aborted>The task was interrupted.</turn_aborted>" });
  await sdk.send({ mode: "immediate", source: "user", prompt: "Read recovery.txt once and return its exact contents." });
  assert.equal(calls.length, 1, "steering must not execute tools before the pending result");
  await submit(calls[0], "Original command was interrupted.");
  assert.equal(calls.length, 2); assert.equal(calls[1].arguments.cmd, "cat recovery.txt");
  await submit(calls[1], marker);
  assert.equal(calls.length, 2); assert.equal(messages.at(-1).content, marker);
  assert.equal(sdk.steering.length, 0);
});

test("the mechanical parent does not treat an immediate child notification as a new child task", async () => {
  const { session: sdk, messages, calls, submit } = await session("C17");
  await sdk.send({ prompt: "Use spawn_agent to read child.txt, then wait and close." });
  assert.equal(calls[0].name, "spawn_agent");
  await submit(calls[0], JSON.stringify({ agent_id: "owned-child" }));
  assert.equal(calls[1].name, "wait");
  await sdk.send({ mode: "immediate", source: "user", prompt: `<subagent_notification>${marker}</subagent_notification>` });
  assert.equal(calls.length, 2, "notification must not make the parent perform a file read");
  assert.equal(sdk.memory, undefined, "the parent's value must come from the correlated wait result");
  await submit(calls[1], JSON.stringify({ status: { "owned-child": { completed: marker } } }));
  assert.equal(calls[2].name, "close_agent");
  await submit(calls[2], "closed");
  assert.deepEqual(calls.map(c => c.name), ["spawn_agent", "wait", "close_agent"]);
  assert.equal(messages.at(-1).content, marker); assert.equal(sdk.steering.length, 0);
});
