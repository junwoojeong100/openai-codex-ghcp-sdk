import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CodexAppServer, RpcError } from "../scripts/native/app-server.mjs";
import { runProcess } from "../scripts/validation/process.mjs";

const peer = fileURLToPath(new URL("./fixtures/native-app-server.mjs", import.meta.url));
function client(t, mode = "normal", extra = {}) {
  const value = new CodexAppServer({ command: process.execPath, args: [peer, mode], cwd: path.dirname(peer), env: process.env, timeoutMs: 3000, ...extra });
  t.after(() => value.stop());
  return value;
}
test("app-server performs the native initialize/initialized handshake and correlates concurrent RPCs", async (t) => {
  const server = await client(t).start();
  const [a, b] = await Promise.all([server.request("fixture/echo", { value: "A" }), server.request("fixture/echo", { value: "B" })]);
  assert.deepEqual([a.value, b.value], ["A", "B"]);
  assert.equal(server.transcript[0].message.method, "initialize");
  assert.equal(server.transcript[2].message.method, "initialized");
  await server.stop();
  assert.equal(server.closed, true);
  assert.equal(server.pending.size, 0); assert.equal(server.waiters.size, 0);
});
test("a completion received before the turn/start response is not lost", async (t) => {
  const server = await client(t, "completion-first").start();
  const turn = await server.turn("fixture-thread", "local peer only");
  assert.equal(turn.turn.status, "completed");
  assert.equal(turn.threadId, "fixture-thread");
  assert.ok(turn.turnId);
});
test("raw hosts expose before-initialize rejection, then recover through the real handshake", async (t) => {
  const server = await client(t).start({ initialize: false });
  await assert.rejects(server.request("fixture/echo"), (error) => error instanceof RpcError && /Not initialized/.test(error.message));
  await server.initialize();
  assert.deepEqual(await server.request("fixture/echo", { ok: true }), { ok: true });
});
test("unknown callbacks fail closed rather than silently approving commands", async (t) => {
  const server = await client(t).start();
  const response = await server.request("fixture/callback");
  assert.equal(response.callback.error.code, -32601);
  assert.equal(response.callback.result, undefined);
});
test("a fixture approval response is correlated to the exact server callback ID", async (t) => {
  const seen = [];
  const server = await client(t, "normal", { onRequest: async (request) => { seen.push(request); return { decision: "decline" }; } }).start();
  const response = await server.request("fixture/callback");
  assert.equal(seen.length, 1);
  assert.equal(response.callback.id, seen[0].id);
  assert.equal(response.callback.result.decision, "decline");
});
for (const [mode, expression] of [["invalid-json", /JSON|Unexpected token/], ["truncated", /Truncated/], ["flood", /output limit/]]) {
  test(`app-server retains ${mode} failure and closes its owned process`, async (t) => {
    const server = client(t, mode, { maxBytes: 1024 });
    await assert.rejects(server.start(), expression);
    await server.stop(); assert.equal(server.closed, true);
    assert.ok(server.failure);
  });
}
test("RPC timeout and abort close the process instead of accepting late responses", async (t) => {
  const timed = client(t, "normal", { timeoutMs: 3000 });
  await timed.start(); timed.timeoutMs = 30;
  await assert.rejects(timed.request("fixture/hang"), /exceeded/);
  await timed.stop(); assert.equal(timed.closed, true);
  const controller = new AbortController();
  const aborted = await client(t, "normal", { signal: controller.signal }).start();
  const pending = aborted.request("fixture/hang");
  controller.abort(new Error("fixture cancellation"));
  await assert.rejects(pending, /fixture cancellation/);
  await aborted.stop(); assert.equal(aborted.closed, true);
});
test("event wait timeout drains waiters and stops abandoned native work", async (t) => {
  const server = await client(t).start();
  await assert.rejects(server.waitFor(() => false, { timeoutMs: 20 }), /Timed out/);
  await server.stop(); assert.equal(server.waiters.size, 0); assert.equal(server.closed, true);
});
test("app-server startup failure and unstarted cleanup are both bounded", async (t) => {
  const server = client(t, "normal", { command: path.join(path.dirname(peer), "missing-native-binary") });
  await assert.rejects(server.start(), /ENOENT/);
  await server.stop(); assert.equal(server.closed, true);
  const never = client(t); await never.stop(); assert.equal(never.closed, true);
});
test("process capture retains Unicode and nonzero exit results without losing ownership", async () => {
  const result = await runProcess(process.execPath, ["-e", 'process.stdout.write("한글");process.stderr.write("diagnostic");process.exitCode=7;']);
  assert.equal(result.code, 7); assert.equal(result.stdout, "한글"); assert.equal(result.stderr, "diagnostic");
  assert.equal(result.closed, true);
});
test("process limits and spawn failures retain output plus a closed-process receipt", async () => {
  await assert.rejects(runProcess(process.execPath, ["-e", 'process.stdout.write("x".repeat(4000));setInterval(()=>{},1000);'], { maxBytes: 128, graceMs: 50 }), (error) =>
    /output exceeded/.test(error.message) && error.processResult.closed && error.processResult.stdout.length <= 128);
  await assert.rejects(runProcess(path.join(path.dirname(peer), "absent"), []), (error) => error.code === "ENOENT" && error.processResult.closed);
});
test("process cancellation normalizes non-Error abort reasons", async () => {
  const controller = new AbortController(); controller.abort("stop fixture");
  await assert.rejects(runProcess(process.execPath, ["-e", 'throw new Error("must not execute");'], { signal: controller.signal }), /stop fixture/);
});
test("process timeout terminates the owned process group, including an inherited-pipe descendant", async (t) => {
  let childPid;
  t.after(() => { if (childPid) { try { process.kill(childPid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } } });
  const descendant = 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000);';
  const program = `const{spawn}=require("node:child_process");const c=spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:["ignore",process.stdout,process.stderr]});console.log(c.pid);process.on("SIGTERM",()=>{});setInterval(()=>{},1000);`;
  await assert.rejects(runProcess(process.execPath, ["-e", program], { timeoutMs: 600, graceMs: 100 }), (error) => {
    childPid = Number(error.processResult.stdout.trim());
    return /exceeded/.test(error.message) && error.processResult.closed && childPid > 0;
  });
  let alive = true;
  for (let attempt = 0; attempt < 100 && alive; attempt += 1) {
    try { process.kill(childPid, 0); await new Promise((resolve) => setTimeout(resolve, 10)); }
    catch (error) { assert.equal(error.code, "ESRCH"); alive = false; }
  }
  assert.equal(alive, false); childPid = null;
});
