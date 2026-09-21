import assert from "node:assert/strict";
import test from "node:test";
import { waitForOwnedGroupExit } from "../scripts/compatibility/supervisor.mjs";

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
