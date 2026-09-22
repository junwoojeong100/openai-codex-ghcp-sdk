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
process.on('SIGINT', () => { if (mode !== 'ignore-interrupt') process.exit(0); });
process.stdin.on('data', data => {
  input += data.toString();
  if (!input.includes('\\r')) return;
  if (trusting) { trusting = false; input = ''; setTimeout(ready, 80); return; }
  const prompt = input.replace(/\\x1b\\[20[01]~/g, '').replace(/\\r/g, '');
  input = ''; count++;
  process.stdout.write('\\x1b[2J\\x1b[HOpenAI Codex\\r\\n\\u203a ' + prompt + '\\r\\nWorking (0s - esc to interrupt)');
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

test("startup readiness and echoed marker alone are not assistant completion", () => {
  const startup = "OpenAI Codex\n\u203a ask a question\n? for shortcuts";
  assert.equal(inspectTerminalScreen(startup).ready, true);
  assert.equal(inspectTerminalScreen(startup + "\nWorking (2s - esc to interrupt)").ready, false);
  const echoed = "OpenAI Codex\n\u203a Say PTY_OK_1\n\u203a \n? for shortcuts";
  assert.equal(inspectTerminalScreen(echoed, { prompt: "Say PTY_OK_1", expectedMarker: "PTY_OK_1" }).markerObserved, false);
  assert.equal(inspectTerminalScreen(echoed + "\n\u2022 PTY_OK_1", { prompt: "Say PTY_OK_1", expectedMarker: "PTY_OK_1" }).markerObserved, true);
  assert.equal(inspectTerminalScreen("Would you like to run the following command?").permission, true);
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

test("missing completion times out and reaps the owned child", async t => {
  const result = await runTerminalProbe({ ...options(t, "missing-marker"), turnTimeoutMs: 250 });
  assert.equal(result.status, "timed-out", JSON.stringify(result));
  assert.equal(result.reason, "completion-deadline");
  assert.equal(result.turns[0].markerObserved, false);
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
