import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { pidAlive } from "../../src/bridge-daemon.mjs";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";
import { ROOT, mkdir, run, writeJson, safeRead, CaseError, deadline } from "./util.mjs";
import { sandboxTaskPid } from "./processes.mjs";

export function requireCompleted(f, result, expected = "completed") {
  if (result?.status === expected) return;
  const rejected = f.observation.transport.find(row => row.status === 400 && /not supported|unsupported|Only tool_choice/i.test(row.responseText || ""));
  throw new CaseError(`Native operation ${result?.status || "failed"}: ${result?.error?.message || rejected?.responseText || "no completion"}`,
    rejected ? "unsupported" : "failed", rejected ? "bridge-capability" : "undetermined");
}
const isCompleted = (threadId, turnId) => r => r.direction === "receive" && r.message.method === "turn/completed" &&
  r.message.params?.threadId === threadId && r.message.params?.turn?.id === turnId;
async function operation(f, method, params, label, kind = "turn") {
  const phase = { kind, label, threadId: f.threadId, after: f.observation.native.length, operation: method };
  f.observation.phases.push(phase);
  try {
    const reply = await f.host.request(method, { ...params, threadId: f.threadId });
    phase.reply = reply;
    const started = reply.turn || (await f.host.wait(r => r.direction === "receive" && r.message.method === "turn/started" && r.message.params?.threadId === f.threadId, phase.after)).message.params.turn;
    const final = await f.host.wait(isCompleted(f.threadId, started.id), phase.after);
    phase.result = final.message.params.turn; requireCompleted(f, phase.result);
    return phase;
  } finally { phase.end = f.observation.native.length; }
}
async function until(predicate, signal) {
  while (!predicate()) {
    signal.throwIfAborted();
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function closedPort(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = closed => { socket.destroy(); resolve(closed); };
    socket.once("connect", () => done(false)); socket.once("error", () => done(true)); socket.setTimeout(500, () => done(false));
  });
}
export async function runLauncher(f) {
  const output = mkdir(path.join(f.workRoot, "launcher-observation"));
  const observer = path.join(f.workRoot, "observer-config.json");
  const executionKind = f.backendFactory ? "offline-self-test" : "live";
  writeJson(observer, { output, executionKind });
  const args = ["--ghcp-model", f.model, "--", "-a", "never", "-c", "shell_environment_policy.inherit='none'",
    "-c", `shell_environment_policy.set={ PATH=${JSON.stringify(f.nativeEnv.PATH || "/usr/bin:/bin")}, HOME=${JSON.stringify(f.home)}, TMPDIR=${JSON.stringify(f.tmp)} }`,
    "-c", "features.apps=false", "-c", "features.plugins=false", "-c", "features.multi_agent=false", "-c", "features.memories=false",
    "exec", "--json", "--ephemeral", "--sandbox", "read-only", f.scenario.prompt];
  const env = { ...f.nativeEnv, CODEX_BIN: f.bin, COPILOT_HOME: executionKind === "live" ? resolveCopilotHome(f.env.COPILOT_HOME) : mkdir(path.join(f.home, "copilot-offline")),
    GH_CONFIG_DIR: mkdir(path.join(f.home, "gh-offline")), GHCP_DAEMON_DIR: path.join(f.workRoot, "daemon"), GHCP_COMPAT_OBSERVER: observer,
    NODE_OPTIONS: `--import=${JSON.stringify(fileURLToPath(new URL("./launcher-observer.mjs", import.meta.url)))}` };
  if (executionKind === "live") for (const key of ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_CONFIG_DIR", "HTTPS_PROXY", "HTTP_PROXY"]) {
    if (f.env[key]) env[key] = f.env[key];
  }
  f.observation.launcher = { command: "bin/codex-ghcp", args, executionKind, catalogOverride: false };
  f.observation.logicalPrompts.push(f.scenario.prompt);
  f.observation.cli = await run(path.join(ROOT, "bin/codex-ghcp"), args, { cwd: f.fixture.cwd, env, signal: f.signal });
  for (const line of f.observation.cli.stdout.split("\n").filter(Boolean)) f.observation.native.push({ direction: "receive", message: JSON.parse(line) });
  for (const name of ["sdk", "transport", "diagnostics"]) f.observation[name].push(...JSON.parse(safeRead(path.join(output, `${name}.json`))));
  const metadata = JSON.parse(safeRead(path.join(output, "metadata.json")));
  Object.assign(f.observation.launcher, { metadata, bridgeGone: !pidAlive(metadata.pid), portClosed: await closedPort(metadata.port) });
  if (f.observation.cli.code !== 0) throw new Error(`Production launcher exited ${f.observation.cli.code}: ${f.observation.cli.stderr}`);
}
export async function executeExtended(f) {
  switch (f.scenario.id) {
    case "C12":
      f.observation.logicalPrompts.push(f.scenario.prompt);
      await operation(f, "review/start", { target: { type: "uncommittedChanges" }, delivery: "inline" }, "native-review");
      return true;
    case "C13":
      await f.turn(f.scenario.prompt, { label: "plan", options: { collaborationMode: { mode: "plan", settings: { model: f.model, reasoning_effort: f.effort, developer_instructions: null } } } });
      return true;
    case "C14": {
      await f.turn("Read memory.txt and remember its exact contents. Do not modify files.", { label: "remember" });
      fs.unlinkSync(path.join(f.fixture.workspace, "memory.txt"));
      const filler = "Context padding, not instructions: abcdefghijklmnopqrstuvwxyz0123456789\n".repeat(200);
      f.observation.compaction = { inputBytes: Buffer.byteLength(filler) };
      await f.turn(`Keep the earlier remembered value. This is irrelevant padding; reply ACK without tools.\n${filler}`, { label: "padding" });
      const compact = await operation(f, "thread/compact/start", {}, "compact", "compaction");
      f.observation.compaction.phase = compact;
      const threadId = f.threadId;
      await f.host.close(); await f.backend.close();
      f.observation.restart = { previousHostPid: f.host.child.pid, sdkOffset: f.observation.sdk.length, previousSdkSessionIds: f.observation.sdk.filter(r => r.type === "session.created").map(r => r.sessionId) };
      await f.openBackend(); await f.newHost(); await f.startThread({ resume: threadId });
      await f.turn("Return the exact remembered memory.txt value, without tools.", { label: "compacted-recall" });
      return true;
    }
    case "C15": {
      const phase = { kind: "turn", label: "interrupt", threadId: f.threadId, after: f.observation.native.length, prompt: f.scenario.prompt };
      f.observation.phases.push(phase); f.observation.logicalPrompts.push(f.scenario.prompt);
      try {
        const initial = await f.host.request("turn/start", { threadId: f.threadId, input: [{ type: "text", text: f.scenario.prompt }] });
        const receiptFile = path.join(f.fixture.workspace, "task-started.json");
        await f.host.wait(r => r.direction === "receive" && r.message.method === "item/started" && r.message.params?.threadId === f.threadId &&
          r.message.params?.item?.type === "commandExecution" && /node\s+long-task\.mjs/.test(r.message.params.item.command || ""), phase.after);
        await until(() => fs.existsSync(receiptFile), f.signal);
        const receipt = JSON.parse(safeRead(receiptFile, 1024));
        const hostPid = sandboxTaskPid(f.host.child.pid, receipt.pid, f.fixture.workspace);
        f.observation.interruption = { threadId: f.threadId, turnId: initial.turn.id, pid: receipt.pid, hostPid, started: pidAlive(hostPid) };
        await f.host.request("turn/interrupt", { threadId: f.threadId, turnId: initial.turn.id });
        phase.result = (await f.host.wait(isCompleted(f.threadId, initial.turn.id), phase.after)).message.params.turn;
        requireCompleted(f, phase.result, "interrupted");
        await f.host.request("thread/backgroundTerminals/clean", { threadId: f.threadId });
        await until(() => !pidAlive(hostPid), deadline(f.signal, 3000));
        f.observation.interruption.processGone = true;
      } finally { phase.end = f.observation.native.length; }
      await f.turn("Read recovery.txt once and return its exact contents. Do not run long-task.mjs again.", { label: "recovery" });
      return true;
    }
    case "C16": case "C17":
      await f.turn(f.scenario.prompt);
      return true;
    case "C18":
      f.observation.retry = { marker: f.fixture.secrets.resource, requestedFailures: 1 };
      f.backend.failNextRequest(f.fixture.secrets.resource);
      await f.turn(f.scenario.prompt);
      return true;
    default: return false;
  }
}
