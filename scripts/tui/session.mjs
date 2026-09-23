// One owned, real Codex TUI launched through bin/codex-ghcp in a private PTY and
// rendered/driven by headless Playwright + xterm.js. Model output is never simulated.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";
import { ROOT, environment, mkdir, writeJson } from "../compatibility/util.mjs";
import { createBrowserTerminal } from "../soak/browser.mjs";
import { inspectTerminalScreen } from "../soak/terminal.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PASSTHROUGH = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_CONFIG_DIR", "HTTPS_PROXY", "HTTP_PROXY"];
export const POPUP = /Select Model and Effort|Select Reasoning Level|Select Model\b/;
export const MCP_PROCESS = /@azure\/mcp|azmcp|@playwright\/mcp|mcp-server|computer-use-mcp/i;

export function processTable() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim().split("\n")
    .map(line => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map(m => ({ pid: +m[1], ppid: +m[2], command: m[3] }));
}
export function descendants(root, rows = processTable()) {
  const out = [], queue = [root];
  while (queue.length) {
    const parent = queue.shift();
    for (const row of rows) if (row.ppid === parent) { out.push(row); queue.push(row.pid); }
  }
  return out;
}

// Numbered rows of the real Codex /model popup (1. slug (default) / › 4. slug (current)).
export function pickerRows(text, allowed) {
  return text.split("\n").map(line => /^\s*([\u203a\u276f>])?\s*(\d+)\.\s+(\S+)(.*)$/.exec(line)).filter(Boolean)
    .filter(m => allowed.includes(m[3]))
    .map(m => ({ number: Number(m[2]), id: m[3], selected: Boolean(m[1]), isDefault: /\(default\)/.test(m[4]), isCurrent: /\(current\)/.test(m[4]) }));
}

// Evidence Codex itself persisted for the conversation: tool calls and per-turn model/effort.
export function readRollouts(codexHome) {
  const files = [];
  const walk = dir => {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/^rollout-.*\.jsonl$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(codexHome, "sessions"));
  const summary = { files: files.length, toolCalls: [], turnContexts: [], compactions: 0, userMessages: 0, patchApplies: 0, eventTypes: [] };
  const eventTypes = new Set();
  for (const file of files.sort()) for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const payload = row.payload ?? {};
    if (row.type === "event_msg" && typeof payload.type === "string") eventTypes.add(payload.type);
    if (row.type === "event_msg" && payload.type === "item_completed" && typeof payload.item?.type === "string") {
      eventTypes.add(`item:${payload.item.type}`);
      if (/^(?:file_?change|patch)/i.test(payload.item.type) && !/fail|declin|reject/i.test(String(payload.item.status ?? ""))) summary.patchApplies++;
    }
    if (row.type === "turn_context") summary.turnContexts.push({ model: payload.model ?? null, effort: payload.effort ?? payload.reasoning_effort ?? null });
    else if (row.type === "compacted") summary.compactions++;
    else if (row.type === "response_item" && ["function_call", "custom_tool_call", "local_shell_call"].includes(payload.type)) {
      let name = payload.name ?? payload.type;
      // Codex intercepts `apply_patch` run through its shell tool; record only that fact, not the command.
      try {
        const args = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : payload.arguments ?? {};
        const command = Array.isArray(args.cmd ?? args.command) ? (args.cmd ?? args.command).join(" ") : String(args.cmd ?? args.command ?? "");
        if (/^\s*(?:bash -lc\s+['"]?)?apply_patch\b/.test(command)) name = "apply_patch";
      } catch { /* Non-JSON arguments are custom tool input. */ }
      summary.toolCalls.push({ type: payload.type, name });
    } else if (row.type === "event_msg" && payload.type === "mcp_tool_call_end") {
      summary.toolCalls.push({ type: "mcp_tool_call", name: `${payload.invocation?.server ?? "?"}.${payload.invocation?.tool ?? "?"}` });
    } else if (row.type === "event_msg" && payload.type === "patch_apply_end" && payload.success !== false) summary.patchApplies++;
    else if (row.type === "event_msg" && payload.type === "user_message") summary.userMessages++;
  }
  summary.eventTypes = [...eventTypes].sort();
  return summary;
}

export class TuiSession {
  constructor({ directory, model, ownedRoot, env = process.env, rows = 45, columns = 140, executionKind = "live", preload, codexArgs = [], sandbox = "read-only" }) {
    Object.assign(this, { directory, model, env, rows, columns, executionKind, preload, codexArgs, sandbox });
    this.steps = []; this.launches = []; this.samples = []; this.closed = false;
    this.owned = fs.realpathSync(mkdir(ownedRoot));
    this.home = mkdir(path.join(this.owned, "home"));
    this.codexHome = mkdir(path.join(this.home, ".codex"));
    this.workspace = fs.realpathSync(mkdir(path.join(this.owned, "workspace")));
    this.tmp = mkdir(path.join(this.owned, "tmp"));
    this.observerDir = mkdir(path.join(directory, "observer"));
    this.observerFile = path.join(directory, "observer-config.json");
    writeJson(this.observerFile, { output: this.observerDir, executionKind, model });
  }
  childEnv() {
    const env = environment(this.env, { home: this.home, codexHome: this.codexHome, tmp: this.tmp, token: "" });
    Object.assign(env, { CODEX_BIN: this.env.CODEX_BIN || "codex", TERM: "xterm-256color", COLUMNS: String(this.columns), LINES: String(this.rows),
      COPILOT_HOME: this.executionKind === "live" ? resolveCopilotHome(this.env.COPILOT_HOME) : mkdir(path.join(this.owned, "copilot-offline")),
      GHCP_DAEMON_DIR: path.join(this.owned, "daemon"), GHCP_SOAK_OBSERVER: this.observerFile,
      NODE_OPTIONS: `--import=${JSON.stringify(fileURLToPath(new URL("../soak/terminal-observer.mjs", import.meta.url)))}${this.preload ? ` --import=${JSON.stringify(this.preload)}` : ""}` });
    if (this.executionKind === "live") for (const key of PASSTHROUGH) if (this.env[key]) env[key] = this.env[key];
    return env;
  }
  launchArgs({ model = this.model, trailing = [] } = {}) {
    return ["--ghcp-model", model, "--", "-a", "never", "--sandbox", this.sandbox,
      "-c", `projects={ ${JSON.stringify(this.workspace)}={ trust_level="trusted" } }`,
      ...["apps", "plugins", "memories", "multi_agent"].flatMap(name => ["-c", `features.${name}=false`]), ...this.codexArgs, ...trailing];
  }
  async launch(options = {}) {
    if (this.helper && !this.helperExit) throw new Error("A terminal is already running for this case.");
    const label = `launch-${this.launches.length + 1}`;
    this.renderer = await createBrowserTerminal({ directory: mkdir(path.join(this.directory, label)), rows: this.rows, columns: this.columns });
    const raw = fs.openSync(path.join(this.directory, `${label}.raw`), "wx", 0o600), decoder = new StringDecoder("utf8");
    const launch = { label, startedAt: new Date().toISOString(), events: [], rawBytes: 0, browserVersion: this.renderer.version };
    this.launches.push(launch);
    this.helperExit = null; this.childPid = null;
    const helper = spawn("python3", [fileURLToPath(new URL("../soak/terminal-pty.py", import.meta.url))],
      { cwd: this.owned, env: this.childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    this.helper = helper;
    let buffer = "";
    this.exited = new Promise(resolve => helper.once("close", (code, signal) => {
      this.helperExit = { code, signal }; launch.helperExit = this.helperExit; fs.closeSync(raw); resolve();
    }));
    const send = message => { if (!helper.stdin.destroyed && !helper.stdin.writableEnded) helper.stdin.write(JSON.stringify(message) + "\n"); };
    this.send = send;
    this.renderer.attachInput(text => send({ type: "input", base64: Buffer.from(text).toString("base64") }),
      error => { launch.browserError = error.message; });
    helper.stderr.on("data", data => { launch.rawBytes += data.length; fs.writeSync(raw, data); });
    helper.stdout.setEncoding("utf8");
    helper.stdout.on("data", data => {
      buffer += data;
      for (let newline; (newline = buffer.indexOf("\n")) >= 0;) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === "data") {
          const chunk = Buffer.from(event.base64, "base64");
          launch.rawBytes += chunk.length; fs.writeSync(raw, chunk);
          this.renderer?.write(decoder.write(chunk));
        } else if (event.type !== "heartbeat") {
          launch.events.push(event);
          if (event.type === "started") this.childPid = event.pid;
          if (event.type === "cleanup") launch.cleanup = event;
          if (event.type === "child-exit") launch.childExit = event;
        }
      }
    });
    send({ bin: path.join(ROOT, "bin/codex-ghcp"), args: this.launchArgs(options), cwd: this.workspace, rows: this.rows, columns: this.columns, stopGraceMs: 10000 });
    this.sampler = setInterval(() => this.sample(), 1000);
    await this.waitReady();
    return launch;
  }
  sample() {
    if (!this.childPid) return;
    try {
      const rows = processTable(), tree = descendants(this.childPid, rows);
      const runtimes = tree.filter(row => /copilot-runtime/.test(row.command));
      const underRuntime = runtimes.flatMap(runtime => descendants(runtime.pid, rows));
      this.samples.push({ at: Date.now(), processes: tree.length, runtimes: runtimes.length,
        runtimeMcp: underRuntime.filter(row => MCP_PROCESS.test(row.command)).length, runtimeChildren: underRuntime.length,
        codexMcpFixture: tree.filter(row => /mcp-fixture\.mjs/.test(row.command)).length });
      this.seen = new Set([...(this.seen ?? []), ...tree.map(row => row.pid)]);
    } catch { /* ps can race process exit; the next sample retries. */ }
  }
  screen() { return this.renderer?.text() ?? ""; }
  snapshot(name) {
    const text = this.screen();
    fs.writeFileSync(path.join(this.directory, `screen-${String(this.steps.length).padStart(2, "0")}-${name}.txt`), text + "\n", { mode: 0o600 });
    return text;
  }
  async waitFor(label, predicate, timeoutMs) {
    const started = performance.now();
    for (;;) {
      const text = this.screen();
      if (predicate(text)) { this.steps.push({ step: label, ms: Math.round(performance.now() - started) }); return text; }
      if (this.helperExit) { this.snapshot(`exited-${label}`); throw new Error(`Codex exited while waiting for ${label}`); }
      if (performance.now() - started > timeoutMs) { this.snapshot(`timeout-${label}`); throw new Error(`Timed out waiting for ${label}`); }
      await sleep(100);
    }
  }
  // Prompts, popups and the composer sit just above the last non-empty line;
  // old transcript text (for example a quoted "requires approval" error) must not block readiness.
  static bottom(text, count = 14) {
    const lines = text.split("\n");
    let last = lines.length - 1;
    while (last >= 0 && !lines[last].trim()) last--;
    return lines.slice(Math.max(0, last - count + 1), last + 1).join("\n");
  }
  ready(text) {
    const bottom = TuiSession.bottom(text);
    return inspectTerminalScreen(bottom, { knownCodex: true }).ready && !POPUP.test(bottom)
      && !inspectTerminalScreen(text, { knownCodex: this.renderer?.seenCodex }).loading && Boolean(this.renderer?.seenCodex);
  }
  async waitReady(timeoutMs = 90000) {
    let trusted = false, themed = false;
    return this.waitFor("ready", text => {
      const state = inspectTerminalScreen(TuiSession.bottom(text), { knownCodex: true });
      if (state.trust && !trusted) { trusted = true; void this.renderer.press("Enter"); }
      if (state.theme && !themed) { themed = true; void this.renderer.press("Enter"); }
      return this.ready(text);
    }, timeoutMs);
  }
  async submit(prompt) { this.lastPrompt = prompt; await this.renderer.sendPrompt(prompt); }
  async keys(text) { await this.renderer.typeKeys(text); }
  async press(key) { await this.renderer.press(key); }
  async escape() { await this.renderer.pressEscape(); }
  answered(text, marker, prompt = this.lastPrompt ?? "") {
    return inspectTerminalScreen(text, { knownCodex: true, prompt, expectedMarker: marker }).markerObserved && this.ready(text);
  }
  async ask(prompt, marker, timeoutMs = 240000) {
    await this.submit(prompt);
    await sleep(300);
    return this.waitFor(`answer-${marker}`, text => this.answered(text, marker, prompt), timeoutMs);
  }
  async slash(command) {
    await this.keys(command);
    await sleep(400);
    await this.press("Enter");
  }
  async quit(timeoutMs = 45000) {
    clearInterval(this.sampler);
    await this.slash("/quit");
    const exited = await Promise.race([this.exited.then(() => true), sleep(timeoutMs).then(() => false)]);
    await this.closeLaunch();
    return exited;
  }
  async closeLaunch() {
    clearInterval(this.sampler);
    if (this.helper && !this.helperExit) {
      this.send?.({ type: "stop" });
      const stopped = await Promise.race([this.exited.then(() => true), sleep(20000).then(() => false)]);
      if (!stopped) { this.helper.kill("SIGKILL"); await this.exited; }
    }
    try { await this.renderer?.close(); } catch (error) { this.launches.at(-1).rendererCloseError = error.message; }
    this.renderer = null;
  }
  leftovers() {
    const alive = new Map(processTable().map(row => [row.pid, row.command]));
    return [...(this.seen ?? [])].filter(pid => alive.has(pid) && !/^\(git\)$/.test(alive.get(pid)));
  }
  observer() {
    const read = name => fs.existsSync(path.join(this.observerDir, name))
      ? fs.readFileSync(path.join(this.observerDir, name), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    const metricsFile = path.join(this.observerDir, "sdk-metrics.json");
    return { sdk: read("sdk.jsonl"), answers: read("answers.jsonl"), http: read("http.jsonl"), diagnostics: read("diagnostics.jsonl"),
      metrics: fs.existsSync(metricsFile) ? JSON.parse(fs.readFileSync(metricsFile, "utf8")) : null };
  }
  async close() {
    if (this.closed) return this.evidence;
    this.closed = true;
    await this.closeLaunch();
    await sleep(750);
    const catalogLeft = fs.existsSync(this.tmp) ? fs.readdirSync(this.tmp).filter(name => name.startsWith("codex-ghcp-models-")) : [];
    this.evidence = { rollout: readRollouts(this.codexHome), catalogLeft, leftovers: this.leftovers(),
      launches: this.launches.map(({ events, ...rest }) => ({ ...rest, eventTypes: [...new Set(events.map(event => event.type))] })),
      samples: { count: this.samples.length, maxRuntimeMcp: Math.max(0, ...this.samples.map(s => s.runtimeMcp)),
        maxRuntimes: Math.max(0, ...this.samples.map(s => s.runtimes)),
        maxCodexMcpFixture: Math.max(0, ...this.samples.map(s => s.codexMcpFixture)) },
      steps: this.steps, lastPromptHash: this.lastPrompt ? hash(this.lastPrompt) : null };
    writeJson(path.join(this.directory, "session-evidence.json"), this.evidence);
    fs.rmSync(this.owned, { recursive: true, force: true });
    return this.evidence;
  }
}
