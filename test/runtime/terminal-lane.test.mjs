import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { runTerminalLane } from "../../scripts/soak/terminal-lane.mjs";
import { createBrowserTerminal } from "../../scripts/soak/browser.mjs";
import { supervise } from "../../scripts/compatibility/supervisor.mjs";

const preload = fileURLToPath(new URL("../fixtures/soak-sdk.mjs", import.meta.url));
function config(t, terminalDriver, durationSeconds = 1) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-terminal-lane-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, terminalDriver, durationSeconds, intervalSeconds: 1, payloadBytes: 128, responseWords: 0,
    model: "gpt-6-astra", bin: process.env.CODEX_BIN || "codex", executionKind: "offline-self-test" };
}
for (const driver of ["pty", "playwright"]) {
  test(`the integrated ${driver} lane runs actual Codex with labelled offline SDK evidence`, { timeout: 45000 }, async t => {
    const c = config(t, driver);
    const result = await runTerminalLane(c, { preload });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.evidenceError, undefined);
    assert.equal(result.cleanupError, undefined);
    assert.equal(result.failed, 0);
    assert.equal(result.durationMet, true);
    assert.equal(result.realModelCalls, 0);
    assert.ok(result.evidence.modelResponsesVerified);
    assert.equal(result.probe.cleanup.processGroupGone, true);
    assert.throws(() => process.kill(result.probe.childPid, 0), { code: "ESRCH" });
    if (driver === "playwright") {
      assert.ok(fs.statSync(path.join(c.directory, "terminal-browser.png")).size > 0);
      assert.throws(() => process.kill(result.browser.pid, 0), { code: "ESRCH" });
    }
  });
  test(`cancelling the integrated ${driver} lane cannot claim full-duration success`, { timeout: 45000 }, async t => {
    const c = config(t, driver, 30), controller = new AbortController();
    const running = runTerminalLane(c, { preload, signal: controller.signal });
    t.after(async () => { controller.abort(); await running; });
    const until = Date.now() + 30000;
    let started = false;
    while (Date.now() < until && !started) {
      const file = path.join(c.directory, "heartbeat.json");
      if (fs.existsSync(file)) {
        const heartbeat = JSON.parse(fs.readFileSync(file, "utf8"));
        if (heartbeat.error) assert.fail(JSON.stringify(heartbeat));
        started = heartbeat.turns > 0;
      }
      if (!started) await delay(50);
    }
    assert.ok(started, "Cancellation must exercise a started terminal, not a missing browser or failed startup.");
    controller.abort(Object.assign(new Error("owned cancellation"), { name: "AbortError" }));
    const result = await running;
    assert.equal(result.durationMet, false);
    assert.ok(result.error);
    assert.equal(result.probe.status, "aborted");
    assert.equal(result.probe.cleanup.processGroupGone, true);
    if (result.browser) assert.throws(() => process.kill(result.browser.pid, 0), { code: "ESRCH" });
  });
}
test("an already-aborted browser setup does not leave a browser process", { timeout: 45000 }, async t => {
  const c = config(t, "playwright");
  await assert.rejects(createBrowserTerminal({ directory: c.directory, signal: AbortSignal.abort(new Error("cancelled")) }), /cancelled/);
});

test("supervisor cancellation lets the worker reap its separate PTY and browser processes", { timeout: 45000 }, async t => {
  const c = config(t, "playwright", 30), controller = new AbortController();
  const operation = supervise({ ...c, workRoot: path.join(c.directory, "supervisor"),
    timeoutMs: 60000, gracefulShutdownMs: 15000 }, {
    signal: controller.signal, workerFile: fileURLToPath(new URL("../fixtures/terminal-worker.mjs", import.meta.url)),
  });
  t.after(async () => { controller.abort(); await operation; });
  const until = Date.now() + 25000;
  let started = false;
  while (Date.now() < until && !started) {
    const file = path.join(c.directory, "heartbeat.json");
    if (fs.existsSync(file)) {
      const heartbeat = JSON.parse(fs.readFileSync(file, "utf8"));
      if (heartbeat.error) assert.fail(JSON.stringify(heartbeat));
      started = heartbeat.turns > 0;
    }
    if (!started) await delay(50);
  }
  assert.ok(started);
  controller.abort(Object.assign(new Error("owned stop"), { name: "AbortError" }));
  const supervisor = await operation;
  assert.equal(supervisor.processGroupGone, true, JSON.stringify(supervisor));
  assert.equal(supervisor.error.name, "AbortError");
  const result = JSON.parse(fs.readFileSync(path.join(c.directory, "report.json"), "utf8"));
  assert.equal(result.durationMet, false);
  assert.equal(result.probe.cleanup.childReaped, true);
  assert.equal(result.probe.cleanup.processGroupGone, true);
  for (const pid of [result.probe.childPid, result.probe.helperPid, result.browser.pid]) {
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }
});

test("a native startup failure is recorded and cannot become a terminal success", { timeout: 45000 }, async t => {
  const c = config(t, "pty");
  const result = await runTerminalLane({ ...c, bin: path.join(c.directory, "missing-codex") }, { preload });
  assert.equal(result.durationMet, false);
  assert.ok(result.failed > 0);
  assert.ok(result.error);
  assert.equal(result.probe.status, "failed");
  assert.equal(result.probe.cleanup.processGroupGone, true);
});
