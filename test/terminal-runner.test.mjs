import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments, runTerminalCheck } from "../scripts/terminal.mjs";
import { parseArguments as soakArguments } from "../scripts/soak.mjs";
import { terminalTurns, verifyTerminalEvidence } from "../scripts/soak/terminal-lane.mjs";
import { sourceManifest } from "../scripts/stability/report.mjs";

test("bounded terminal checks require live opt-in and keep model/driver/volume explicit", () => {
  const plan = parseArguments([]);
  assert.equal(plan.mode, "plan");
  assert.equal(plan.terminalDriver, "pty");
  assert.equal(plan.durationSeconds, 120);
  const browser = parseArguments(["--execute", "--driver", "playwright", "--model", "claude-sonnet-5",
    "--duration-seconds", "7200", "--payload-bytes", "24576", "--response-words", "2000"]);
  assert.equal(browser.terminalDriver, "playwright");
  assert.equal(browser.payloadBytes, 24576);
  for (const args of [
    ["--execute", "--plan"], ["--execute", "--execute"], ["--driver", "other"],
    ["--model", "unrelated"], ["--payload-bytes", "65537"], ["--response-words", "-1"],
    ["--response-words", "3001"], ["--duration-seconds", "0"], ["--duration-seconds", "86401"],
    ["--output", "must-not-create"], ["--unknown"],
  ]) assert.throws(() => parseArguments(args));
  assert.deepEqual(soakArguments(["--smoke", "--terminal", "--terminal-driver", "playwright"]),
    { mode: "smoke", terminal: true, terminalDriver: "playwright" });
  assert.throws(() => soakArguments(["--terminal-driver", "playwright"]));
  assert.throws(() => soakArguments(["--terminal", "--terminal-driver", "unknown"]));
});

test("the programmatic terminal runner also rejects a plan without executing it", async () => {
  await assert.rejects(runTerminalCheck(parseArguments([])), /explicit --execute/);
});

test("terminal workloads have fresh non-echoed markers and enough paced turns to cover the duration", () => {
  const turns = [...terminalTurns({ durationSeconds: 7, intervalSeconds: 2, payloadBytes: 8192, responseWords: 500, seed: "abcdef01" })];
  assert.equal(turns.length, 5);
  assert.equal(turns[0].delayMs, 0);
  assert.ok(turns.slice(1).every(turn => turn.delayMs === 2000));
  assert.equal(new Set(turns.map(turn => turn.expectedMarker)).size, turns.length);
  assert.ok(turns.every(turn => !turn.prompt.includes(turn.expectedMarker) && turn.prompt.includes("500 words")));
  for (const options of [{ durationSeconds: 0 }, { intervalSeconds: 0 }, { responseWords: 3001 }, { seed: "../bad" }]) {
    assert.throws(() => terminalTurns({ durationSeconds: 7, intervalSeconds: 2, payloadBytes: 8192, seed: "abcdef01", ...options }).next());
  }
});

test("maximum-duration workloads generate only the current payload, not gigabytes of queued prompts", () => {
  const turns = terminalTurns({ durationSeconds: 86400, intervalSeconds: 1, payloadBytes: 65536, responseWords: 3000, seed: "abcdef01" });
  assert.equal(turns[Symbol.iterator](), turns);
  assert.equal(Array.isArray(turns), false);
  const first = turns.next().value, second = turns.next().value;
  assert.equal(first.expectedMarker, "SOAK_abcdef01_000001");
  assert.equal(second.expectedMarker, "SOAK_abcdef01_000002");
  assert.ok(Buffer.byteLength(first.prompt) >= 65536);
  assert.ok(Buffer.byteLength(first.prompt) < 67000);
});

test("terminal success requires corresponding real-shaped SDK identity, output and failure evidence", () => {
  const model = "gpt-6-astra", marker = "SOAK_abcdef01_000001";
  const probe = { turns: [{ completedAt: "now", markerObserved: true, expectedMarker: marker }] };
  const metrics = { executionKind: "live", model, modelCalls: 1,
    rootAnswers: [{ chars: 1500, markers: [marker] }], filtered: 0, errors: 0, streamFailures: 0, modelMismatches: 0 };
  const config = { model, executionKind: "live", minimumResponseChars: 1000 };
  assert.deepEqual(verifyTerminalEvidence(probe, metrics, config),
    { completed: 1, modelResponsesVerified: true, largeResponses: 1, responseChars: 1500, upstreamFailed: false });
  assert.throws(() => verifyTerminalEvidence(probe, null, config), /SDK evidence/);
  assert.throws(() => verifyTerminalEvidence(probe, { ...metrics, executionKind: "offline-self-test" }, config), /SDK evidence/);
  assert.throws(() => verifyTerminalEvidence(probe, { ...metrics, modelCalls: 0 }, config), /SDK evidence/);
  assert.equal(verifyTerminalEvidence(probe, { ...metrics, rootAnswers: [] }, config).modelResponsesVerified, false);
  for (const field of ["filtered", "errors", "streamFailures", "modelMismatches"]) {
    assert.equal(verifyTerminalEvidence(probe, { ...metrics, [field]: 1 }, config).upstreamFailed, true);
  }
});

test("frozen implementations include the actual browser document and private PTY helper", () => {
  const files = sourceManifest();
  assert.ok(files["scripts/soak/browser-terminal.html"]?.sha256);
  assert.ok(files["scripts/soak/terminal-pty.py"]?.sha256);
  assert.ok(files["scripts/soak/terminal-lane.mjs"]?.sha256);
});
