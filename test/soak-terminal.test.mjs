import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TerminalScreen, inspectTerminalScreen, runTerminalProbe } from "../scripts/soak/terminal.mjs";

const fakeTui = `
if (!process.stdin.isTTY || !process.stdout.isTTY) process.exit(91);
process.stdin.setRawMode(true);
process.stdin.resume();
const mode = process.env.PROBE_TEST_MODE;
let count = 0, input = '', trusting = mode === 'trust';
const ready = () => process.stdout.write('\\x1b[2J\\x1b[HOpenAI Codex (offline mechanical peer)\\r\\n\\x1b[?2004h\\u203a \\r\\n? for shortcuts');
if (mode === 'permission') {
  process.stdout.write('OpenAI Codex\\r\\nWould you like to run the following command?\\r\\n1. Yes, proceed');
} else if (trusting) {
  process.stdout.write('Do you trust the contents of this directory?\\r\\n' + process.cwd() + '\\r\\n\\u203a 1. Yes, continue\\r\\n2. No, quit');
} else if (mode !== 'silent') ready();
if (mode === 'animated') setInterval(() => process.stdout.write('\\x1b[s\\x1b[1;30H*\\x1b[u'), 40);
process.on('SIGINT', () => { if (mode !== 'ignore-interrupt') process.exit(0); });
process.stdin.on('data', data => {
  if (mode === 'interrupt-recovery' && data.toString() === '\\x1b') {
    process.stdout.write('\\x1b[2J\\x1b[HOpenAI Codex\\r\\n\\u25a0 Fixture interrupted\\r\\n\\u203a \\r\\n? for shortcuts');
    return;
  }
  input += data.toString();
  if (!input.includes('\\r')) return;
  if (trusting) { trusting = false; input = ''; setTimeout(ready, 80); return; }
  const prompt = input.replace(/\\x1b\\[20[01]~/g, '').replace(/\\r/g, '');
  input = ''; count++;
  if (mode === 'exit-after-submit') process.exit(0);
  process.stdout.write('\\x1b[2J\\x1b[HOpenAI Codex\\r\\n\\u203a ' + prompt + '\\r\\nWorking (0s - esc to interrupt)');
  if (mode === 'interrupt-recovery' && count === 1) return;
  if (mode === 'expected-error' && count === 1) {
    setTimeout(() => process.stdout.write('\\x1b[2J\\x1b[HOpenAI Codex\\r\\n\\u25a0 Fixture deadline expired\\r\\n\\u203a \\r\\n? for shortcuts'), 80);
    return;
  }
  if (mode === 'missing-marker' || mode === 'ignore-interrupt' || mode === 'waiting') return;
  if (mode === 'echo-only') {
    setTimeout(() => process.stdout.write('\\x1b[2J\\x1b[HOpenAI Codex\\r\\n\\u203a ' + prompt + '\\r\\n\\u203a \\r\\n? for shortcuts'), 60);
    return;
  }
  setTimeout(() => {
    process.stdout.write('\\x1b[2J\\x1b[HOpenAI Codex\\r\\n\\u203a ' + prompt +
      '\\r\\n\\r\\n\\u2022 PTY_OK_' + count + '\\r\\n\\r\\n\\u203a \\r\\n? for shortcuts');
  }, 80);
});
`;

function options(t, mode = "normal") {
  const ownedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-pty-unit-")));
  const home = path.join(ownedRoot, "home"), codex = path.join(home, ".codex"), cwd = path.join(ownedRoot, "workspace");
  for (const directory of [codex, cwd, path.join(ownedRoot, "tmp")]) fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(ownedRoot, { recursive: true, force: true }));
  return {
    bin: process.execPath, args: ["-e", fakeTui], cwd, ownedRoot, directory: path.join(ownedRoot, "evidence"),
    env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: codex, TMPDIR: path.join(ownedRoot, "tmp"), PROBE_TEST_MODE: mode },
    timeoutMs: 5000, readyTimeoutMs: 2500, turnTimeoutMs: 1200, stopGraceMs: 100,
    prompt: "Respond with the first numbered marker.", expectedMarker: "PTY_OK_1",
  };
}

function assertReaped(result) {
  assert.equal(result.cleanup.childReaped, true);
  assert.equal(result.cleanup.processGroupGone, true);
  assert.equal(result.cleanup.helperExited, true);
  assert.throws(() => process.kill(result.childPid, 0), { code: "ESRCH" });
  assert.throws(() => process.kill(result.helperPid, 0), { code: "ESRCH" });
}

test("terminal screen handles split ANSI, cursor edits, OSC and dimension queries", () => {
  const screen = new TerminalScreen({ rows: 5, columns: 40 });
  screen.write("\x1b[2");
  screen.write("J\x1b[HOpenAI Codex\x1b[2;1Hbad\x1b[2K\r\u203a \x1b[?2004h");
  screen.write("\x1b]0;ignored title\x07\x1b[6n\x1b[18t\x1b[?u");
  assert.match(screen.text(), /OpenAI Codex\n\u203a/);
  assert.ok(!screen.text().includes("bad"));
  assert.ok(!screen.text().includes("ignored title"));
  assert.equal(screen.bracketedPaste, true);
  assert.deepEqual(screen.replies, ["\x1b[2;3R", "\x1b[8;5;40t", "\x1b[?0u"]);
  screen.write("\x1b[?1049hsecondary\x1b[?1049l");
  assert.match(screen.text(), /OpenAI Codex/);
});

test("Codex scrolling regions preserve a long response marker above the composer", () => {
  const screen = new TerminalScreen({ rows: 6, columns: 40 });
  screen.write("\x1b[6;1HFOOTER\x1b[1;4r\x1b[1;1H");
  screen.write("line one\r\nline two\r\nline three\r\nline four\r\nline five\r\nSOAK_abcdef01_000001");
  screen.write("\x1b[r\x1b[5;1H\x1b[2K\u203a \x1b[6;1HFOOTER");
  const lines = screen.text().split("\n");
  assert.equal(lines[3], "SOAK_abcdef01_000001");
  assert.equal(lines[5], "FOOTER");
  assert.equal(inspectTerminalScreen(screen.text(), { knownCodex: true, expectedMarker: "SOAK_abcdef01_000001" }).markerObserved, true);
});

test("line edits, scrolling and reverse index stay inside the configured margins", () => {
  const screen = new TerminalScreen({ rows: 6, columns: 20 });
  screen.write("HEADER\x1b[2;1HA\x1b[3;1HB\x1b[4;1HC\x1b[5;1HD\x1b[6;1HFOOTER");
  screen.write("\x1b[2;5r\x1b[3;1H\x1b[L");
  assert.deepEqual(screen.text().split("\n"), ["HEADER", "A", "", "B", "C", "FOOTER"]);
  screen.write("\x1b[M");
  assert.deepEqual(screen.text().split("\n"), ["HEADER", "A", "B", "C", "", "FOOTER"]);
  screen.write("\x1b[S\x1b[T\x1b[2;1H\x1bM");
  assert.equal(screen.text().split("\n")[0], "HEADER");
  assert.equal(screen.text().split("\n")[5], "FOOTER");
  assert.equal(screen.row, 1);
  screen.write("\x1b[?1049h");
  assert.deepEqual([screen.scrollTop, screen.scrollBottom], [0, 5]);
  screen.write("\x1b[?1049l\x1b[5;2r");
  assert.deepEqual([screen.scrollTop, screen.scrollBottom], [1, 4]);
  screen.write("\x1b[r");
  assert.deepEqual([screen.scrollTop, screen.scrollBottom], [0, 5]);
});

test("startup readiness and echoed marker alone are not assistant completion", () => {
  const startup = "OpenAI Codex\n\u203a ask a question\n? for shortcuts";
  assert.equal(inspectTerminalScreen(startup).ready, true);
  assert.equal(inspectTerminalScreen(startup + "\nWorking (2s - esc to interrupt)").ready, false);
  const echoed = "OpenAI Codex\n\u203a Say PTY_OK_1\n\u203a \n? for shortcuts";
  assert.equal(inspectTerminalScreen(echoed, { prompt: "Say PTY_OK_1", expectedMarker: "PTY_OK_1" }).markerObserved, false);
  assert.equal(inspectTerminalScreen(echoed + "\n\u2022 PTY_OK_1", { prompt: "Say PTY_OK_1", expectedMarker: "PTY_OK_1" }).markerObserved, true);
  assert.equal(inspectTerminalScreen("Would you like to run the following command?").permission, true);
  for (const field of ["model", "directory"]) {
    const loading = `OpenAI Codex\n\u2502 ${field}: loading\n\u203a Ask Codex to do anything\n? for shortcuts`;
    assert.equal(inspectTerminalScreen(loading).ready, false);
    assert.equal(inspectTerminalScreen(loading).loading, true);
  }
});

test("a private PTY sends two turns in one TUI and requires fresh distinct markers", async t => {
  const config = options(t);
  const result = await runTerminalProbe({ ...config, turns: [
    { prompt: "Respond with the first numbered marker.", expectedMarker: "PTY_OK_1" },
    { prompt: "Respond with the second numbered marker.", expectedMarker: "PTY_OK_2", delayMs: 100 },
  ] });
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.turns.length, 2);
  assert.ok(result.turns.every(turn => turn.markerObserved && turn.completedAt));
  assert.ok(Date.parse(result.turns[1].sentAt) >= Date.parse(result.turns[0].completedAt) + 100);
  assertReaped(result);
  assert.equal(fs.statSync(result.artifacts.raw).mode & 0o777, 0o600);
  assert.equal(fs.statSync(result.artifacts.events).mode & 0o777, 0o600);
  const events = fs.readFileSync(result.artifacts.events, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(events.some(event => event.type === "heartbeat" && event.childAlive));
  assert.equal(events.filter(event => event.action === "submit-visible-probe-prompt").length, 2);
});

test("duration checks finish only after covered time and completed responses", async t => {
  const result = await runTerminalProbe({ ...options(t), durationMs: 450, turns: [
    { prompt: "First.", expectedMarker: "PTY_OK_1" },
    { prompt: "Second.", expectedMarker: "PTY_OK_2", delayMs: 100 },
    { prompt: "Third.", expectedMarker: "PTY_OK_3", delayMs: 100 },
  ] });
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.reason, "duration-covered");
  assert.ok(result.coveredMs >= 450);
  assert.ok(result.turns.length >= 2 && result.turns.every(turn => turn.completedAt));
  assertReaped(result);
});

test("long-duration probes consume lazy turns without retaining an entire prompt workload", async t => {
  let generated = 0;
  function* turns() {
    for (let i = 1; i < 10000; i++) {
      generated++;
      yield { prompt: `Request ${i}.`, expectedMarker: `PTY_OK_${i}`, delayMs: i > 1 ? 100 : 0 };
    }
  }
  const result = await runTerminalProbe({ ...options(t), durationMs: 450, turns: turns() });
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.ok(generated < 5);
  assert.ok(result.turns.every(turn => turn.completedAt));
  assertReaped(result);
});

test("exhausting a short marker list cannot masquerade as a longer duration pass", async t => {
  const result = await runTerminalProbe({ ...options(t), durationMs: 1000 });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "insufficient-turns");
  assert.ok(result.coveredMs < 1000);
  assertReaped(result);
});
test("cosmetic redraws cannot prevent readiness or completion in a responsive terminal", async t => {
  const result = await runTerminalProbe({ ...options(t, "animated"), turns: [
    { prompt: "Return the first marker.", expectedMarker: "PTY_OK_1" },
    { prompt: "Return the second marker.", expectedMarker: "PTY_OK_2" },
  ] });
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.turns.length, 2);
  assert.ok(result.turns.every(turn => turn.markerObserved && turn.completedAt));
  assertReaped(result);
});

test("a visible expected error can be followed by recovery in the same terminal", async t => {
  const result = await runTerminalProbe({ ...options(t, "expected-error"), turns: [
    { prompt: "Trigger the controlled failure.", expectedError: "Fixture deadline expired" },
    { prompt: "Recover with the next marker.", expectedMarker: "PTY_OK_2" },
  ] });
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.turns[0].errorObserved, true);
  assert.equal(result.turns[0].markerObserved, false);
  assert.equal(result.turns[1].markerObserved, true);
  assertReaped(result);
});

test("Escape interrupts only the active turn and the same terminal accepts another prompt", async t => {
  const result = await runTerminalProbe({ ...options(t, "interrupt-recovery"), turns: [
    { prompt: "Wait until interrupted.", expectedError: "Fixture interrupted", interruptAfterMs: 100 },
    { prompt: "Recover with the next marker.", expectedMarker: "PTY_OK_2" },
  ] });
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.ok(result.turns[0].interruptedAt);
  assert.ok(result.turns[0].interruptionRecoveryMs < 1000);
  assert.equal(result.turns[1].markerObserved, true);
  const events = fs.readFileSync(result.artifacts.events, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.filter(event => event.action === "interrupt-active-turn").length, 1);
  assertReaped(result);
});

test("expected-error detection rejects echoed, stale and non-error text", () => {
  const expectedError = "Fixture deadline expired";
  assert.equal(inspectTerminalScreen(`OpenAI Codex\n\u25a0 ${expectedError}\n\u203a`, { expectedError }).errorObserved, true);
  assert.equal(inspectTerminalScreen(`OpenAI Codex\n\u203a ${expectedError}\n\u203a`, { expectedError }).errorObserved, false);
  assert.equal(inspectTerminalScreen(`OpenAI Codex\n\u2022 ${expectedError}\n\u203a`, { expectedError }).errorObserved, false);
  assert.equal(inspectTerminalScreen(`OpenAI Codex\n\u25a0 ${expectedError}\n\u203a`,
    { expectedError, prompt: `Echo ${expectedError}` }).errorObserved, false);
});

test("missing completion times out and reaps the owned child", async t => {
  const result = await runTerminalProbe({ ...options(t, "missing-marker"), turnTimeoutMs: 250 });
  assert.equal(result.status, "timed-out", JSON.stringify(result));
  assert.equal(result.reason, "completion-deadline");
  assert.equal(result.turns[0].markerObserved, false);
  assertReaped(result);
});

test("late browser input rejection after an unexpected terminal exit cannot write closed evidence files", async t => {
  const config = options(t, "exit-after-submit"), renderer = new TerminalScreen();
  let send, rejected = false;
  renderer.attachInput = input => { send = input; };
  renderer.sendPrompt = async text => {
    send(text + "\r");
    await new Promise(resolve => setTimeout(resolve, 200));
    rejected = true;
    throw new Error("late browser shutdown");
  };
  const result = await runTerminalProbe({ ...config, renderer });
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "terminal-exited-before-completion");
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(rejected, true);
  assertReaped(result);
});

test("no startup screen times out without sending any prompt", async t => {
  const result = await runTerminalProbe({ ...options(t, "silent"), readyTimeoutMs: 300 });
  assert.equal(result.reason, "readiness-deadline");
  assert.equal(result.turns.length, 0);
  assertReaped(result);
});

test("echoing the requested marker without an assistant answer cannot pass", async t => {
  const result = await runTerminalProbe({ ...options(t, "echo-only"), prompt: "Say PTY_OK_1", turnTimeoutMs: 300 });
  assert.equal(result.reason, "completion-deadline");
  assert.equal(result.turns[0].markerObserved, false);
  assertReaped(result);
});

test("an ignored SIGINT is followed by bounded owned SIGKILL and reaping", async t => {
  const result = await runTerminalProbe({ ...options(t, "ignore-interrupt"), turnTimeoutMs: 250 });
  assert.equal(result.status, "timed-out", JSON.stringify(result));
  assert.deepEqual(result.cleanup.signals, ["SIGINT", "SIGKILL"]);
  assertReaped(result);
});

test("an unexpected permission prompt is never approved or sent probe text", async t => {
  const result = await runTerminalProbe(options(t, "permission"));
  assert.equal(result.status, "failed", JSON.stringify(result));
  assert.equal(result.reason, "unexpected-tool-permission");
  assert.equal(result.turns.length, 0);
  assertReaped(result);
  assert.ok(!fs.readFileSync(result.artifacts.events, "utf8").includes("submit-visible-probe-prompt"));
});

test("explicitly owned trust can be accepted once, without tool approval", async t => {
  const result = await runTerminalProbe({ ...options(t, "trust"), allowOwnedTrust: true });
  assert.equal(result.status, "passed", JSON.stringify(result));
  assertReaped(result);
  const events = fs.readFileSync(result.artifacts.events, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(events.filter(event => event.action === "accept-explicitly-owned-workspace-trust").length, 1);
});

test("trust is not accepted without the caller's explicit owned-workspace opt-in", async t => {
  const result = await runTerminalProbe(options(t, "trust"));
  assert.equal(result.reason, "unhandled-workspace-trust-prompt");
  assert.equal(result.turns.length, 0);
  assertReaped(result);
});

test("cancellation stops the private terminal without retrying a prompt", async t => {
  const config = options(t, "waiting"), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  t.after(() => clearTimeout(timer));
  const result = await runTerminalProbe({ ...config, signal: controller.signal });
  assert.equal(result.status, "aborted", JSON.stringify(result));
  assert.equal(result.reason, "cancelled");
  assert.ok(result.turns.length <= 1);
  assertReaped(result);
});

test("isolated paths and distinct turn markers are required before launch", async t => {
  const config = options(t);
  await assert.rejects(runTerminalProbe({ ...config, env: { ...config.env, HOME: process.env.HOME } }), /inside ownedRoot/);
  await assert.rejects(runTerminalProbe({ ...config, turns: [
    { prompt: "one", expectedMarker: "SAME" }, { prompt: "two", expectedMarker: "SAME" },
  ] }), /distinct/);
});
