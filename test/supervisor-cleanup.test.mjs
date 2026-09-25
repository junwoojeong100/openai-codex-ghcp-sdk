import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { groupExists, killOwnedGroup, supervise, waitForOwnedGroupExit } from "../scripts/verification/supervisor.mjs";

const failWith = code => () => { throw Object.assign(new Error(`kill ${code}`), { code }); };

test("owned-group cleanup waits for asynchronous exit without signalling another group", async () => {
  let clock = 0, probes = 0;
  const waits = [];
  const gone = await waitForOwnedGroupExit(42, 100, {
    now: () => clock, probe: pid => { assert.equal(pid, 42); return ++probes < 3; },
    sleep: async ms => { waits.push(ms); clock += ms; },
  });
  assert.equal(gone, true); assert.deepEqual(waits, [10, 10]);
});

test("owned-group cleanup never exceeds the remaining case slot", async () => {
  let clock = 0;
  const gone = await waitForOwnedGroupExit(42, 13, {
    now: () => clock, probe: () => true, sleep: async ms => { clock += ms; },
  });
  assert.equal(gone, false); assert.equal(clock, 13);
  assert.equal(await waitForOwnedGroupExit(42, 0, { probe: () => false }), true);
  assert.equal(await waitForOwnedGroupExit(42, 0, { probe: () => true }), false);
  await assert.rejects(waitForOwnedGroupExit(1, 100));
});

test("macOS EPERM for a zombie-only owned group means still present, never gone and not a signal failure", async () => {
  assert.equal(groupExists(42, failWith("EPERM")), true);
  assert.equal(groupExists(42, failWith("ESRCH")), false);
  assert.throws(() => groupExists(42, failWith("EINVAL")), /EINVAL/);
  assert.doesNotThrow(() => killOwnedGroup(42, "SIGKILL", failWith("EPERM")));
  assert.throws(() => killOwnedGroup(42, "SIGKILL", failWith("EINVAL")), /EINVAL/);
  let clock = 0, probes = 0;
  const reaped = pid => groupExists(pid, ++probes < 3 ? failWith("EPERM") : failWith("ESRCH"));
  assert.equal(await waitForOwnedGroupExit(42, 100, { probe: reaped, now: () => clock, sleep: async ms => { clock += ms; } }), true);
  clock = 0;
  assert.equal(await waitForOwnedGroupExit(42, 30, { probe: pid => groupExists(pid, failWith("EPERM")),
    now: () => clock, sleep: async ms => { clock += ms; } }), false);
});

test("a normally exited worker whose group briefly reports EPERM is still verified gone", { skip: process.platform === "win32" }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-eperm-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workerFile = fileURLToPath(new URL("./fixtures/core-worker-peer.mjs", import.meta.url));
  let eperms = 0;
  const kill = (pid, signal) => {
    if (pid < 0 && eperms < 2) { eperms++; failWith("EPERM")(); }
    return process.kill(pid, signal);
  };
  const receipt = await supervise({ directory: path.join(root, "evidence"), workRoot: path.join(root, "work"), timeoutMs: 5000, mode: "exit" },
    { workerFile, kill });
  assert.equal(eperms, 2);
  assert.equal(receipt.code, 0); assert.equal(receipt.killed, false);
  assert.equal(receipt.error, null); assert.equal(receipt.processGroupGone, true);
});
