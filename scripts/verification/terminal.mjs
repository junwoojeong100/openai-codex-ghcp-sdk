import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const hash = value => createHash("sha256").update(value).digest("hex");
const quote = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clamp = (value, lower, upper) => Math.max(lower, Math.min(value, upper));
const defaultPrompt = "Join SOAK, TERMINAL, and OK with underscores. Reply with only that single word. Do not use tools.";

// Only text/cursor operations and terminal queries needed by a private Codex PTY.
export class TerminalScreen {
  constructor({ rows = 40, columns = 120 } = {}) {
    this.rows = rows; this.columns = columns; this.row = 0; this.column = 0;
    this.lines = Array.from({ length: rows }, () => Array(columns).fill(" "));
    this.saved = [0, 0]; this.pending = ""; this.replies = []; this.bracketedPaste = false;
    this.scrollTop = 0; this.scrollBottom = rows - 1;
    this.seenCodex = false;
  }
  text() { return this.lines.map(line => line.join("").trimEnd()).join("\n"); }
  #linefeed() {
    if (this.row === this.scrollBottom) this.#scroll(true);
    else this.row = Math.min(this.rows - 1, this.row + 1);
  }
  #scroll(up, count = 1, top = this.scrollTop) {
    if (top < this.scrollTop || top > this.scrollBottom) return;
    for (let i = 0; i < Math.min(count, this.scrollBottom - top + 1); i++) {
      this.lines.splice(up ? top : this.scrollBottom, 1);
      this.lines.splice(up ? this.scrollBottom : top, 0, Array(this.columns).fill(" "));
    }
  }
  #eraseLine(mode) {
    const from = mode === 1 || mode === 2 ? 0 : this.column;
    const end = mode === 0 || mode === 2 ? this.columns : this.column + 1;
    this.lines[this.row].fill(" ", from, end);
  }
  #csi(parameters, command) {
    const privateMode = parameters.startsWith("?"), n = parameters.replace(/^[?>]/, "").split(";").map(Number);
    const first = n[0] || 1;
    if (["H", "f"].includes(command)) { this.row = clamp(first - 1, 0, this.rows - 1); this.column = clamp((n[1] || 1) - 1, 0, this.columns - 1); }
    else if (command === "A") this.row = Math.max(0, this.row - first);
    else if (command === "B") this.row = Math.min(this.rows - 1, this.row + first);
    else if (command === "C") this.column = Math.min(this.columns - 1, this.column + first);
    else if (command === "D") this.column = Math.max(0, this.column - first);
    else if (["E", "F"].includes(command)) { this.row = clamp(this.row + first * (command === "E" ? 1 : -1), 0, this.rows - 1); this.column = 0; }
    else if (command === "G") this.column = clamp(first - 1, 0, this.columns - 1);
    else if (command === "d") this.row = clamp(first - 1, 0, this.rows - 1);
    else if (command === "K") this.#eraseLine(n[0]);
    else if (command === "J") {
      if (n[0] === 2 || n[0] === 3) this.lines.forEach(line => line.fill(" "));
      else {
        this.#eraseLine(n[0]);
        this.lines.forEach((line, index) => { if (n[0] === 1 ? index < this.row : index > this.row) line.fill(" "); });
      }
    } else if (command === "X") this.lines[this.row].fill(" ", this.column, Math.min(this.columns, this.column + first));
    else if (command === "P") { this.lines[this.row].splice(this.column, first); while (this.lines[this.row].length < this.columns) this.lines[this.row].push(" "); }
    else if (command === "@") { this.lines[this.row].splice(this.column, 0, ...Array(Math.min(first, this.columns)).fill(" ")); this.lines[this.row].length = this.columns; }
    else if (command === "L") this.#scroll(false, first, this.row);
    else if (command === "M") this.#scroll(true, first, this.row);
    else if (command === "S") this.#scroll(true, first);
    else if (command === "T") this.#scroll(false, first);
    else if (command === "r" && !privateMode) {
      const top = first - 1, bottom = (n[1] || this.rows) - 1;
      if (top >= 0 && bottom < this.rows && top < bottom) {
        this.scrollTop = top; this.scrollBottom = bottom; this.row = 0; this.column = 0;
      }
    }
    else if (command === "s") this.saved = [this.row, this.column];
    else if (command === "u" && !privateMode) [this.row, this.column] = this.saved;
    else if (command === "u" && privateMode) this.replies.push("\x1b[?0u");
    else if (command === "n" && n[0] === 6) this.replies.push(`\x1b[${this.row + 1};${Math.min(this.column + 1, this.columns)}R`);
    else if (command === "n" && n[0] === 5) this.replies.push("\x1b[0n");
    else if (command === "c") this.replies.push(parameters.startsWith(">") ? "\x1b[>0;0;0c" : "\x1b[?1;2c");
    else if (command === "t" && n[0] === 18) this.replies.push(`\x1b[8;${this.rows};${this.columns}t`);
    else if (command === "t" && n[0] === 14) this.replies.push(`\x1b[4;${this.rows * 16};${this.columns * 8}t`);
    else if (privateMode && ["h", "l"].includes(command)) {
      if (n.includes(2004)) this.bracketedPaste = command === "h";
      if (n.includes(1049) && command === "h") {
        this.mainBuffer = { lines: this.lines, row: this.row, column: this.column,
          scrollTop: this.scrollTop, scrollBottom: this.scrollBottom };
        this.lines = Array.from({ length: this.rows }, () => Array(this.columns).fill(" ")); this.row = 0; this.column = 0;
        this.scrollTop = 0; this.scrollBottom = this.rows - 1;
      } else if (n.includes(1049) && this.mainBuffer) {
        Object.assign(this, this.mainBuffer); this.mainBuffer = null;
      }
    }
  }
  write(chunk) {
    this.pending += chunk;
    while (this.pending) {
      if (this.pending.startsWith("\x1b[")) {
        const match = /^\x1b\[([0-?]*)(?:[ -/]*)([@-~])/.exec(this.pending);
        if (!match) break;
        this.#csi(match[1], match[2]); this.pending = this.pending.slice(match[0].length); continue;
      }
      if (this.pending.startsWith("\x1b]") || this.pending.startsWith("\x1bP")) {
        const end = this.pending.slice(2).search(/\x07|\x1b\\/);
        if (end < 0) break;
        const content = this.pending.slice(2, end + 2), terminator = this.pending[end + 2] === "\x07" ? 1 : 2;
        if (/^(10|11);\?$/.test(content)) this.replies.push(`\x1b]${content.slice(0, 2)};rgb:0000/0000/0000\x1b\\`);
        this.pending = this.pending.slice(end + 2 + terminator); continue;
      }
      if (this.pending[0] === "\x1b") {
        if (this.pending.length < 2) break;
        const next = this.pending[1];
        if ("()".includes(next) && this.pending.length < 3) break;
        if (next === "7") this.saved = [this.row, this.column];
        if (next === "8") [this.row, this.column] = this.saved;
        if (next === "D") this.#linefeed();
        if (next === "E") { this.column = 0; this.#linefeed(); }
        if (next === "M") {
          if (this.row === this.scrollTop) this.#scroll(false);
          else this.row = Math.max(0, this.row - 1);
        }
        this.pending = this.pending.slice("()".includes(next) ? 3 : 2); continue;
      }
      const character = String.fromCodePoint(this.pending.codePointAt(0));
      this.pending = this.pending.slice(character.length);
      if (character === "\r") { this.column = 0; continue; }
      if (character === "\n") { this.#linefeed(); continue; }
      if (character === "\b") { this.column = Math.max(0, this.column - 1); continue; }
      if (character === "\t") { this.column = Math.min(this.columns - 1, this.column + 8 - this.column % 8); continue; }
      if (character < " " || character === "\x7f") continue;
      if (/\p{Mark}/u.test(character)) { if (this.column) this.lines[this.row][this.column - 1] += character; continue; }
      if (this.column >= this.columns) { this.column = 0; this.#linefeed(); }
      const code = character.codePointAt(0), wide = code >= 0x1100 && (code <= 0x115f || code >= 0x2e80 && code <= 0xa4cf || code >= 0xac00 && code <= 0xd7ff || code >= 0x1f300);
      this.lines[this.row][this.column++] = character;
      if (wide && this.column < this.columns) this.lines[this.row][this.column++] = "";
    }
    if (this.pending.length > 65536) throw new Error("Unterminated terminal escape exceeds the observation budget.");
    this.seenCodex ||= /OpenAI Codex|Codex CLI/i.test(this.text());
  }
}

export function inspectTerminalScreen(text, { knownCodex = false, prompt = "", expectedMarker = "", expectedError = "" } = {}) {
  const trust = /Do you trust (?:the contents of )?this (?:directory|folder)|trust this (?:folder|workspace)/i.test(text);
  const theme = /(?:select|choose) (?:a |your )?theme/i.test(text);
  const permission = !trust && /would you like to run|do you want to (?:run|allow)|requires (?:your )?approval|approve (?:this|the) (?:command|tool)|allow (?:this|the) (?:command|tool)|grant .{0,40}access/i.test(text);
  const login = /sign in (?:with|to)|paste (?:your )?(?:api key|token)|enter (?:your )?(?:api key|password)/i.test(text);
  const loading = /^\s*[\u2502|]\s*(?:model|directory):\s+loading\b/im.test(text);
  const busy = /esc to (?:interrupt|cancel)|\b(?:working|thinking|reconnecting)\s*(?:\.{3}|\(|\u2026)/i.test(text);
  const lines = text.split("\n"), last = lines.findLastIndex(line => line.trim());
  const composer = lines.slice(Math.max(0, last - 7)).some(line => /^\s*[\u203a\u276f]\s*/.test(line));
  const codex = knownCodex || /OpenAI Codex|Codex CLI/i.test(text);
  const marker = expectedMarker && lines.some(line => {
    const clean = line.trim();
    if (new RegExp(`^(?:\\u2022|\\*)\\s+${quote(expectedMarker)}$`).test(clean)) return true;
    return !prompt.includes(expectedMarker) && clean === expectedMarker;
  });
  const error = expectedError && !prompt.includes(expectedError) && lines.some(line =>
    /^\s*(?:\u25a0|error[:\s])/i.test(line) && line.includes(expectedError));
  return { ready: Boolean(codex && composer && !loading && !busy && !trust && !theme && !permission && !login),
    markerObserved: Boolean(marker), errorObserved: Boolean(error), trust, theme, permission, login, loading, busy };
}

function integer(value, name, maximum = 2_147_483_647) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}.`);
}
function inside(file, base) {
  const relative = path.relative(base, file);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Caller owns the root, isolated HOME/CODEX_HOME and production-launcher arguments.
// The helper is a foreground child; its private PTY session is stopped and reaped.
export async function runTerminalProbe({
  bin, args = [], cwd, env, directory, signal, timeoutMs, ownedRoot = directory,
  prompt = defaultPrompt, expectedMarker = "SOAK_TERMINAL_OK", turns,
  rows = 40, columns = 120, readyTimeoutMs = Math.min(timeoutMs, 30_000),
  turnTimeoutMs = Math.min(timeoutMs, 120_000), stopGraceMs = 2000,
  allowOwnedTrust = false, allowOwnedSetup = false, maxOutputBytes = 32 * 1024 * 1024,
  durationMs, maxPromptBytes = 16_384, renderer, onProgress = () => {},
} = {}) {
  integer(timeoutMs, "timeoutMs"); integer(readyTimeoutMs, "readyTimeoutMs"); integer(turnTimeoutMs, "turnTimeoutMs");
  integer(stopGraceMs, "stopGraceMs", 10_000); integer(rows, "rows", 200); integer(columns, "columns", 500);
  integer(maxOutputBytes, "maxOutputBytes");
  integer(maxPromptBytes, "maxPromptBytes", 131072);
  if (durationMs !== undefined) integer(durationMs, "durationMs", timeoutMs);
  if (typeof bin !== "string" || !bin || !Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error("A launch binary and string arguments are required.");
  if (!env || !path.isAbsolute(cwd ?? "") || !path.isAbsolute(ownedRoot ?? "") || !path.isAbsolute(directory ?? "")) throw new Error("Absolute owned paths and an isolated environment are required.");
  const owned = fs.realpathSync(ownedRoot), actualCwd = fs.realpathSync(cwd), userHome = fs.realpathSync(process.env.HOME);
  if (inside(userHome, owned)) throw new Error("ownedRoot cannot be the user's HOME or its ancestor.");
  for (const candidate of [actualCwd, env.HOME, env.CODEX_HOME, ...(env.TMPDIR ? [env.TMPDIR] : [])]) {
    if (!candidate || !inside(fs.realpathSync(candidate), owned)) throw new Error("Workspace, HOME, CODEX_HOME and TMPDIR must be inside ownedRoot.");
  }
  if (fs.realpathSync(env.HOME) === userHome) throw new Error("The user's HOME cannot be used for a terminal probe.");
  const normalizeTurn = (turn, index) => {
    if (typeof turn.prompt !== "string" || !turn.prompt.trim() || /[\x00-\x08\x0b-\x1f\x7f]/.test(turn.prompt) || Buffer.byteLength(turn.prompt) > maxPromptBytes) throw new Error(`Invalid prompt for turn ${index}.`);
    if (turn.expectedError !== undefined) {
      if (turn.expectedMarker !== undefined || typeof turn.expectedError !== "string" || !turn.expectedError.trim()
          || turn.expectedError.length > columns - 4 || /[\x00-\x1f\x7f]/.test(turn.expectedError)
          || turn.prompt.includes(turn.expectedError)) throw new Error(`Invalid expectedError for turn ${index}.`);
    } else if (!/^[A-Za-z0-9_.-]{1,128}$/.test(turn.expectedMarker ?? "") || turn.expectedMarker.length > columns - 4) {
      throw new Error(`Invalid expectedMarker for turn ${index}.`);
    }
    const budget = turn.timeoutMs ?? turnTimeoutMs, delayMs = turn.delayMs ?? 0;
    integer(budget, "turn timeoutMs");
    if (turn.interruptAfterMs !== undefined) {
      integer(turn.interruptAfterMs, "interruptAfterMs");
      if (!turn.expectedError || turn.interruptAfterMs >= budget) throw new Error("Interruption requires an expected error and time before the turn deadline.");
    }
    if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > timeoutMs) throw new Error("Invalid inter-turn delay.");
    return { ...turn, timeoutMs: budget, delayMs };
  };
  const supplied = turns ?? [{ prompt, expectedMarker }];
  if (typeof supplied?.[Symbol.iterator] !== "function") throw new Error("Terminal turns must be iterable.");
  const requests = Array.isArray(supplied) ? supplied.map(normalizeTurn) : null;
  if (requests && (!requests.length || new Set(requests.map(turn => turn.expectedMarker ?? turn.expectedError)).size !== requests.length)) {
    throw new Error("Turns require distinct completion markers or errors.");
  }
  const iterator = requests ? null : supplied[Symbol.iterator](), outcomes = new Set();
  const nextTurn = index => {
    if (requests) return requests[index];
    const item = iterator.next();
    if (item.done) return undefined;
    const turn = normalizeTurn(item.value, index), key = turn.expectedMarker ?? turn.expectedError;
    if (outcomes.has(key)) throw new Error("Turns require distinct completion markers or errors.");
    outcomes.add(key);
    return turn;
  };
  let upcoming = nextTurn(0);
  if (!upcoming) throw new Error("At least one terminal turn is required.");
  if (signal?.aborted) throw signal.reason ?? new Error("Terminal probe already aborted.");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const rawFile = path.join(directory, "terminal.raw"), eventFile = path.join(directory, "terminal-events.jsonl");
  const raw = fs.openSync(rawFile, "wx", 0o600), events = fs.openSync(eventFile, "wx", 0o600);
  const startedAt = Date.now(), started = performance.now(), screen = renderer ?? new TerminalScreen({ rows, columns }), decoder = new StringDecoder("utf8");
  const result = { status: "failed", reason: null, startedAt: new Date(startedAt).toISOString(), turns: [],
    terminal: { rows, columns, privatePty: true, driver: renderer ? "playwright" : "pty" }, artifacts: { raw: rawFile, events: eventFile },
    childPid: null, helperPid: null, cleanup: { childReaped: false, processGroupGone: false, helperExited: false } };
  const record = event => fs.writeSync(events, JSON.stringify({ observedAt: Date.now(), ...event }) + "\n");
  const helper = spawn("python3", [fileURLToPath(new URL("./terminal-pty.py", import.meta.url))], {
    cwd: owned, env: { ...env, TERM: "xterm-256color", COLUMNS: String(columns), LINES: String(rows) },
    stdio: ["pipe", "pipe", "pipe"], detached: false,
  });
  result.helperPid = helper.pid ?? null;
  let stopped = false, bytes = 0, lineBuffer = "", active = null, index = 0, readySince = null;
  let trafficStarted;
  let nextAt = started + upcoming.delayMs, readySeen = false, trustHandled = false, setupHandled = false, fallbackTimer;
  const send = message => {
    if (!helper.stdin.destroyed && !helper.stdin.writableEnded) helper.stdin.write(JSON.stringify(message) + "\n");
  };
  const input = (text, action) => {
    record({ type: "input", action, bytes: Buffer.byteLength(text), sha256: hash(text) });
    send({ type: "input", base64: Buffer.from(text).toString("base64") });
  };
  const stop = (reason, status = "failed") => {
    if (stopped) return;
    stopped = true; result.reason = reason; result.status = status;
    result.coveredMs = trafficStarted === undefined ? 0 : Math.max(0, performance.now() - trafficStarted);
    record({ type: "stop-requested", reason });
    send({ type: "stop" });
    fallbackTimer = setTimeout(() => {
      if (helper.exitCode !== null || helper.signalCode !== null) return;
      record({ type: "helper-cleanup-deadline", childPid: result.childPid });
      if (result.childPid) {
        try { process.kill(-result.childPid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") record({ type: "cleanup-error", operation: "owned-group-kill", code: error.code }); }
      }
      helper.kill("SIGKILL");
    }, stopGraceMs + 4000);
  };
  const onAbort = () => stop("cancelled", "aborted");
  renderer?.attachInput(text => { if (!stopped) input(text, "browser-terminal-input"); }, error => {
    if (stopped) return;
    record({ type: "browser-error", name: error.name, message: error.message });
    stop("browser-driver-failed");
  });
  signal?.addEventListener("abort", onAbort, { once: true });
  helper.stdin.on("error", error => { if (error.code !== "EPIPE") stop("helper-input-error"); });
  helper.on("error", error => { record({ type: "helper-error", code: error.code ?? error.name }); stop("helper-start-failed"); });
  helper.stderr.on("data", data => {
    bytes += data.length; fs.writeSync(raw, data);
    record({ type: "helper-stderr", bytes: data.length, sha256: hash(data) });
    if (bytes > maxOutputBytes) stop("output-budget-exceeded");
  });
  helper.stdout.setEncoding("utf8");
  helper.stdout.on("data", data => {
    lineBuffer += data;
    if (lineBuffer.length > 1_048_576) { stop("helper-protocol-budget-exceeded"); return; }
    let newline;
    while ((newline = lineBuffer.indexOf("\n")) >= 0) {
      const line = lineBuffer.slice(0, newline); lineBuffer = lineBuffer.slice(newline + 1);
      let event;
      try { event = JSON.parse(line); } catch { stop("invalid-helper-event"); continue; }
      if (event.type === "data") {
        const chunk = Buffer.from(event.base64, "base64"); bytes += chunk.length;
        if (bytes > maxOutputBytes) { stop("output-budget-exceeded"); continue; }
        fs.writeSync(raw, chunk);
        record({ type: "output", at: event.at, bytes: chunk.length, sha256: hash(chunk) });
        try { screen.write(decoder.write(chunk)); } catch { stop("terminal-parser-limit"); }
        for (const reply of screen.replies.splice(0)) if (!stopped) input(reply, "terminal-query-response");
      } else {
        record(event);
        if (event.type === "started") {
          if (!Number.isSafeInteger(event.pid) || event.pid <= 1 || event.ppid !== helper.pid || event.pgid !== event.pid) stop("invalid-owned-child-identity");
          else result.childPid = event.pid;
        }
        if (event.type === "child-exit") result.childExit = { code: event.code, signal: event.signal };
        if (event.type === "cleanup") result.cleanup = { ...event, helperExited: false };
        if (event.type === "error") stop(event.code ?? "pty-helper-error");
      }
    }
  });
  send({ bin, args, cwd: actualCwd, rows, columns, stopGraceMs });
  const tick = setInterval(() => { try {
    if (stopped) return;
    const now = performance.now(), text = screen.text(), request = active ?? upcoming;
    const state = inspectTerminalScreen(text, { knownCodex: screen.seenCodex, ...request });
    if (state.ready) readySince ??= now;
    else readySince = null;
    if (now - started >= timeoutMs) { stop("total-deadline", "timed-out"); return; }
    if (state.ready && !readySeen) {
      result.readyAt = new Date().toISOString();
      onProgress({ phase: "ready", at: Date.now() });
    }
    readySeen ||= state.ready;
    if (!readySeen && now - started >= readyTimeoutMs) { stop("readiness-deadline", "timed-out"); return; }
    if (state.permission) { stop("unexpected-tool-permission"); return; }
    if (state.login) { stop("unexpected-authentication-prompt"); return; }
    if (state.trust) {
      const ownedPathVisible = text.replace(/\n\s*/g, "").includes(actualCwd);
      const selectedYes = /^\s*[\u203a\u276f>]\s*1\.\s*Yes,?\s*(?:continue|I trust)/im.test(text);
      if (trustHandled) return;
      if (!allowOwnedTrust || !ownedPathVisible || !selectedYes) { stop("unhandled-workspace-trust-prompt"); return; }
      trustHandled = true; input("\r", "accept-explicitly-owned-workspace-trust"); return;
    }
    if (state.theme) {
      if (setupHandled) return;
      if (!allowOwnedSetup) { stop("unhandled-initial-theme-prompt"); return; }
      setupHandled = true; input("\r", "accept-owned-initial-theme-default"); return;
    }
    if (active) {
      if (active.interruptAfterMs !== undefined && active.interruptSentAt === undefined
          && state.busy && now - active.sentAt >= active.interruptAfterMs) {
        active.interruptSentAt = now;
        result.turns.at(-1).interruptedAt = new Date().toISOString();
        if (renderer) {
          record({ type: "input", action: "interrupt-active-turn", bytes: 1, sha256: hash("\x1b") });
          void renderer.pressEscape().catch(error => { if (!stopped) { record({ type: "browser-input-error", message: error.message }); stop("browser-input-failed"); } });
        } else input("\x1b", "interrupt-active-turn");
      }
      const observed = active.expectedError ? state.errorObserved : state.markerObserved;
      const interruptionObserved = active.interruptAfterMs === undefined || active.interruptSentAt !== undefined;
      // Cosmetic animations keep emitting bytes even at an idle composer.
      // Require a stable logical outcome, not a completely quiet terminal.
      if (observed && interruptionObserved && state.ready) active.observedSince ??= now;
      else active.observedSince = undefined;
      if (active.observedSince !== undefined && now - active.observedSince >= 150) {
        const turn = result.turns.at(-1);
        Object.assign(turn, { completedAt: new Date().toISOString(), durationMs: Math.ceil(now - active.sentAt),
          markerObserved: state.markerObserved, errorObserved: state.errorObserved,
          ...(active.interruptSentAt !== undefined ? { interruptionRecoveryMs: Math.ceil(now - active.interruptSentAt) } : {}) });
        record({ type: "turn-completed", index, expectedMarker: active.expectedMarker, expectedError: active.expectedError, screenHash: hash(text) });
        onProgress({ phase: "pacing", at: Date.now(), turn: index + 1, completed: true, durationMs: turn.durationMs });
        index++; active = null;
        if (durationMs !== undefined && now - trafficStarted >= durationMs) { stop("duration-covered", "passed"); return; }
        upcoming = nextTurn(index);
        if (!upcoming) {
          stop(durationMs === undefined ? "all-markers-observed" : "insufficient-turns",
            durationMs === undefined ? "passed" : "failed"); return;
        }
        nextAt = now + upcoming.delayMs;
      } else if (now - active.sentAt >= active.timeoutMs) stop("completion-deadline", "timed-out");
    } else if (readySince !== null && durationMs !== undefined && trafficStarted !== undefined && now - trafficStarted >= durationMs) {
      stop("duration-covered", "passed");
    } else if (readySince !== null && now >= nextAt && now - readySince >= 150) {
      const turn = upcoming;
      const stale = inspectTerminalScreen(text, { expectedMarker: turn.expectedMarker, expectedError: turn.expectedError });
      if (stale.markerObserved || stale.errorObserved) { stop("stale-completion-marker"); return; }
      if (turn.prompt.includes("\n") && !screen.bracketedPaste) { stop("multiline-paste-not-supported"); return; }
      active = { ...turn, sentAt: now };
      trafficStarted ??= now;
      readySince = null;
      result.turns.push({ index, promptHash: hash(turn.prompt), expectedMarker: turn.expectedMarker, expectedError: turn.expectedError,
        sentAt: new Date().toISOString(), markerObserved: false });
      onProgress({ phase: "turn", at: Date.now(), turn: index + 1 });
      if (renderer) {
        record({ type: "input", action: "visible-probe-prompt", bytes: Buffer.byteLength(turn.prompt), sha256: hash(turn.prompt) });
        void renderer.sendPrompt(turn.prompt).then(() => {
          if (!stopped) record({ type: "input", action: "submit-visible-probe-prompt", bytes: 1, sha256: hash("\r") });
        }).catch(error => { if (!stopped) { record({ type: "browser-input-error", message: error.message }); stop("browser-input-failed"); } });
      } else {
        input(screen.bracketedPaste ? `\x1b[200~${turn.prompt}\x1b[201~` : turn.prompt, "visible-probe-prompt");
        input("\r", "submit-visible-probe-prompt");
      }
    }
  } catch (error) {
    record({ type: "probe-error", name: error.name, message: error.message });
    stop("probe-operation-failed");
  }
  }, 50);
  try {
    await new Promise(resolve => helper.once("close", (code, exitSignal) => {
      result.helperExit = { code, signal: exitSignal }; resolve();
    }));
    if (!stopped) { result.reason = "terminal-exited-before-completion"; result.status = "failed"; }
    result.cleanup.helperExited = true;
    if (!result.cleanup.childReaped || !result.cleanup.processGroupGone || result.cleanup.errors?.length) {
      result.status = "failed"; result.reason = "owned-cleanup-unconfirmed";
    }
  } finally {
    stopped = true;
    clearInterval(tick); clearTimeout(fallbackTimer); signal?.removeEventListener("abort", onAbort);
    helper.stdin.end();
    result.finishedAt = new Date().toISOString(); result.durationMs = Math.ceil(performance.now() - started); result.rawBytes = bytes;
    fs.writeFileSync(path.join(directory, "terminal-screen.txt"), screen.text(), { mode: 0o600 });
    record({ type: "probe-finished", status: result.status, reason: result.reason, durationMs: result.durationMs });
    fs.closeSync(raw); fs.closeSync(events);
    fs.writeFileSync(path.join(directory, "terminal-result.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  }
  return result;
}
