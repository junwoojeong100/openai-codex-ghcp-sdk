import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { codexProviderArgs } from "../../src/launcher.mjs";
import { ValidationFixture, PrerequisiteError } from "../validation/fixture.mjs";
import { fileState, sha256, treeState } from "../validation/evidence.mjs";
import { runProcess } from "../validation/process.mjs";
import { CodexAppServer } from "./app-server.mjs";

const privateDir = (directory) => { fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); return directory; };
const relative = (name) => typeof name === "string" && name && !path.isAbsolute(name) &&
  name.split(/[\\/]/).every((part) => part && part !== "." && part !== "..");

export { isolatedCodexEnvironment as nativeEnvironment } from "../validation/environment.mjs";
import { isolatedCodexEnvironment as nativeEnvironment } from "../validation/environment.mjs";

export function capturedFiles(root, maximum = 8 * 1024 * 1024) {
  const files = {};
  let size = 0;
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const key = path.relative(root, full).split(path.sep).join("/");
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) { files[key] = { kind: "directory", mode: stat.mode & 0o777 }; visit(full); }
      else if (stat.isSymbolicLink()) files[key] = { kind: "symlink", target: fs.readlinkSync(full) };
      else {
        assert.ok(stat.isFile(), `Unsupported fixture state: ${key}`);
        const data = fs.readFileSync(full);
        size += data.length;
        assert.ok(size <= maximum, "Fixture evidence exceeded the capture limit.");
        files[key] = { kind: "file", sha256: sha256(data), base64: data.toString("base64"), mode: stat.mode & 0o777 };
      }
    }
  };
  visit(root);
  return files;
}

export class NativeFixture extends ValidationFixture {
  constructor(options) {
    const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codex-ghcp-native-")));
    try { super({ ...options, directory: temporary }); }
    catch (error) { fs.rmSync(temporary, { recursive: true, force: true }); throw error; }
    this.temporary = temporary;
    this.evidenceDirectory = options.directory;
    this.ownership = randomUUID();
    fs.writeFileSync(path.join(temporary, ".owner"), this.ownership, { mode: 0o600 });
    this.home = privateDir(path.join(temporary, "home"));
    this.codexHome = privateDir(path.join(this.home, ".codex"));
    this.tmp = privateDir(path.join(temporary, "tmp"));
    this.outside = privateDir(path.join(temporary, "outside"));
    fs.writeFileSync(path.join(this.outside, "sentinel.txt"), `OUTSIDE_${randomUUID()}\n`, { mode: 0o600 });
    this.outsideBefore = capturedFiles(this.outside);
    this.hosts = [];
    this.phases = [];
    this.externalResources = [];
    this.expectedChanges = new Map();
    this.nativeConfigFiles = new Map();
    this.nativeCaptures = [];
    this.runtimeState = {};
    this.runBinary = options.runBinary ?? runProcess;
    this.appServerFactory = options.appServerFactory ?? ((settings) => new CodexAppServer(settings));
    this.offline ||= Boolean(options.runBinary || options.appServerFactory);
    this.baseline();
  }

  get workspace() { return this.workspaces[0].path; }

  safePath(name, workspaceIndex = 0) {
    assert.ok(relative(name), `Unsafe fixture path: ${name}`);
    const root = this.workspaces[workspaceIndex].path;
    const parts = name.split("/");
    let parent = root;
    for (const part of parts.slice(0, -1)) {
      parent = path.join(parent, part);
      if (fs.existsSync(parent)) assert.ok(fs.lstatSync(parent).isDirectory() && !fs.lstatSync(parent).isSymbolicLink(), "Fixture parent is not an owned directory.");
      else privateDir(parent);
    }
    const target = path.join(root, ...parts);
    try { assert.ok(!fs.lstatSync(target).isSymbolicLink(), "Refusing to write through a fixture symlink."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    return target;
  }

  seed(files, workspaceIndex = 0) {
    for (const [name, content] of Object.entries(files)) {
      const file = this.safePath(name, workspaceIndex);
      assert.ok(!fs.existsSync(file) || !fs.lstatSync(file).isSymbolicLink(), "Refusing to seed through a symlink.");
      fs.writeFileSync(file, typeof content === "string" || Buffer.isBuffer(content) ? content : `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
    }
    this.baseline();
  }

  baseline() {
    for (const workspace of this.workspaces) workspace.before = treeState(workspace.path);
    this.beforeCapture = this.workspaces.map(({ path: root }) => capturedFiles(root));
  }

  expectFile(name, content, workspaceIndex = 0) {
    assert.ok(relative(name));
    this.expectedChanges.set(`${workspaceIndex}:${name}`, content === null ? { kind: "missing" } : { kind: "file", sha256: sha256(content) });
  }

  ownerWrite(name, content, workspaceIndex = 0) {
    const file = this.safePath(name, workspaceIndex);
    this.expectFile(name, content, workspaceIndex);
    if (content === null) fs.unlinkSync(file);
    else fs.writeFileSync(file, content, { mode: 0o600 });
    this.capture(`owner-change-${this.nativeCaptures.length}`);
  }

  capture(label) {
    const capture = { label, files: this.workspaces.map(({ path: root }) => capturedFiles(root)) };
    this.nativeCaptures.push(capture);
    return capture;
  }

  setConfig(text, home = this.codexHome) {
    const file = path.join(home, "config.toml");
    fs.writeFileSync(file, text, { mode: 0o600 });
    this.nativeConfigFiles.set(file, fileState(file));
  }

  async version() {
    if (this.nativeVersion) return this.nativeVersion;
    const result = await this.runBinary(this.codexBin, ["--version"], {
      cwd: this.workspace, env: this.environment(), signal: this.signal, timeoutMs: 10_000,
    }).catch(() => { throw new PrerequisiteError("Cannot execute the configured native Codex binary.", "codex-unavailable"); });
    if (result.code !== 0 || !/^codex-cli 0\.154\.0(?:\s|$)/.test(result.stdout.trim())) {
      throw new PrerequisiteError("Native harness is pinned to Codex CLI 0.154.0; regenerate/review contracts for another version.", "codex-version");
    }
    this.nativeVersion = result.stdout.trim();
    return this.nativeVersion;
  }

  environment(home = this.codexHome) {
    return nativeEnvironment(this.env, { home: this.home, codexHome: home, temporary: this.tmp, token: this.token });
  }

  args(extra = []) {
    return [...codexProviderArgs({ model: this.model, port: this.server.address().port }),
      "-c", "model_providers.ghcp.request_max_retries=0", "-c", "model_providers.ghcp.stream_max_retries=0",
      "-c", "features.apps=false", "-c", "features.plugins=false", "-c", "features.memories=false", ...extra];
  }

  async host({ home = this.codexHome, args = [], onRequest, command = this.codexBin, initialize = true, token = this.token } = {}) {
    await this.version();
    const id = `host-${this.hosts.length + 1}`;
    const host = this.appServerFactory({ command, args: [...this.args(args), "app-server", "--stdio"],
      cwd: this.workspace, env: { ...this.environment(home), CODEX_GHCP_BRIDGE_TOKEN: token }, signal: this.signal, timeoutMs: Math.min(this.timeoutMs, 90_000),
      onRequest: async (message, instance) => {
        if (onRequest) {
          const response = await onRequest(message, instance);
          if (response !== undefined) return response;
        }
        if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method)) return { decision: "decline" };
        if (message.method === "item/tool/requestUserInput") return { answers: {} };
        if (message.method === "mcpServer/elicitation/request") return { action: "cancel" };
        return undefined;
      },
    });
    Object.assign(host, { fixtureId: id, fixtureHome: home });
    this.hosts.push(host); // Register before startup; partial startup is still owned.
    await host.start({ initialize });
    return host;
  }

  async thread(host, options = {}) {
    const response = await host.request("thread/start", {
      model: this.model, modelProvider: "ghcp", allowProviderModelFallback: false,
      cwd: this.workspace, sandbox: "read-only", approvalPolicy: "on-request", ephemeral: true, ...options,
    });
    assert.ok(response.thread?.id, "Native thread/start returned no identity.");
    this.phases.push({ kind: "thread", hostId: host.fixtureId, result: response });
    return response;
  }

  async turn(host, threadId, prompt, options = {}) {
    const sdkStart = this.sdk.length;
    const httpStart = this.http.length;
    const phase = { id: `phase-${this.phases.length + 1}`, kind: "turn", hostId: host.fixtureId,
      threadId, prompt, options, sdkStart, httpStart };
    this.phases.push(phase);
    try {
      Object.assign(phase, await host.turn(threadId, prompt, options));
      return phase;
    } catch (error) { phase.error = { name: error.name, message: error.message, code: error.code }; throw error; }
    finally {
      phase.sdkEnd = this.sdk.length;
      phase.httpEnd = this.http.length;
      phase.state = this.capture(phase.id);
    }
  }

  async rpc(host, method, params, { expectError = false } = {}) {
    const phase = { id: `phase-${this.phases.length + 1}`, kind: "rpc", hostId: host.fixtureId, method, params };
    this.phases.push(phase);
    try {
      phase.result = await host.request(method, params);
      assert.ok(!expectError, `Expected a native failure for ${method}.`);
      return phase.result;
    } catch (error) {
      phase.error = { name: error.name, message: error.message, code: error.code };
      if (expectError && error.name === "RpcError") return phase.error;
      throw error;
    }
  }

  async exec(prompt, { args = [], home = this.codexHome, json = true, expectError = false, workspaceIndex = 0 } = {}) {
    await this.version();
    const invocation = { command: this.codexBin, args: [...this.args(), "exec", "--ephemeral", "--sandbox", "read-only",
      "--skip-git-repo-check", "--color", "never", ...(json ? ["--json"] : []), ...args, prompt],
    cwd: this.workspaces[workspaceIndex].path, sandbox: "read-only", isolatedCodexHome: true, version: this.nativeVersion };
    const phase = { id: `phase-${this.phases.length + 1}`, kind: "exec", prompt, json, sdkStart: this.sdk.length, httpStart: this.http.length, invocation };
    this.phases.push(phase);
    try {
      const result = await this.runBinary(invocation.command, invocation.args, {
        cwd: invocation.cwd, env: this.environment(home), signal: this.signal, timeoutMs: this.timeoutMs,
      });
      this.processes.push({ ...invocation, ...result });
      phase.result = result;
      if (!expectError) assert.equal(result.code, 0, this.scrub(result.stderr));
      return phase;
    } catch (error) {
      phase.error = { message: error.message };
      if (error.processResult) { this.processes.push({ ...invocation, ...error.processResult }); phase.result = error.processResult; }
      throw error;
    } finally {
      phase.sdkEnd = this.sdk.length;
      phase.httpEnd = this.http.length;
      phase.state = this.capture(phase.id);
    }
  }

  nativeEvidence() {
    return { version: this.nativeVersion, hosts: this.hosts.map((host) => ({ id: host.fixtureId, command: host.command, args: host.args,
      transcript: host.transcript, stderr: host.stderr, protocolError: host.protocolError?.message })),
    phases: this.phases, captures: this.nativeCaptures, runtimeState: this.runtimeState };
  }

  state() {
    if (this.finalState) return this.finalState;
    const after = this.workspaces.map(({ path: root }) => capturedFiles(root));
    const changes = [];
    const before = this.beforeCapture ?? [];
    for (let index = 0; index < after.length; index += 1) {
      for (const name of new Set([...Object.keys(before[index] || {}), ...Object.keys(after[index])])) {
        const previous = before[index]?.[name] ?? { kind: "missing" };
        const current = after[index][name] ?? { kind: "missing" };
        if (JSON.stringify(previous) === JSON.stringify(current)) continue;
        const expected = this.expectedChanges.get(`${index}:${name}`);
        changes.push({ workspace: index, path: name, before: previous, after: current,
          expected: expected ?? null, authorized: Boolean(expected && current.kind === expected.kind &&
            (expected.kind === "missing" || current.sha256 === expected.sha256)) });
      }
    }
    // Exact expected final state is checked even when a requested mutation never happened.
    const expectedFinal = [...this.expectedChanges].map(([key, expected]) => {
      const colon = key.indexOf(":");
      const index = Number(key.slice(0, colon));
      const name = key.slice(colon + 1);
      const actual = after[index]?.[name] ?? { kind: "missing" };
      return { key, expected, actual, matched: actual.kind === expected.kind &&
        (expected.kind === "missing" || actual.sha256 === expected.sha256) };
    });
    const base = super.state();
    return { ...base, before, after, changes, expectedFinal,
      workspaceUnchanged: undefined,
      fixtureChangesAuthorized: changes.every(({ authorized }) => authorized) && expectedFinal.every(({ matched }) => matched),
      outsideBefore: this.outsideBefore, outsideAfter: capturedFiles(this.outside),
      outsideUnchanged: JSON.stringify(this.outsideBefore) === JSON.stringify(capturedFiles(this.outside)),
      isolatedConfigUnchanged: [...this.nativeConfigFiles].every(([file, beforeState]) => JSON.stringify(fileState(file)) === JSON.stringify(beforeState)),
      nativeProcessesClosed: this.hosts.every((host) => host.closed),
    };
  }

  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeOwned();
    return this.closePromise;
  }

  async closeOwned() {
    for (const host of this.hosts) {
      try { await host.stop(); }
      catch (error) { this.cleanupErrors.push(error.message); }
      this.processes.push({ kind: "app-server", id: host.fixtureId, pid: host.child?.pid, closed: host.closed,
        version: this.nativeVersion, command: host.command, args: host.args, exit: host.exit ? await host.exit : null });
    }
    for (const resource of this.externalResources.reverse()) {
      try { await resource.stop(); }
      catch (error) { this.cleanupErrors.push(error.message); }
    }
    await super.stop();
    try { this.finalState = this.state(); }
    catch (error) { this.cleanupErrors.push(`State capture: ${error.message}`); this.finalState = { inspectionError: error.message }; }
    try {
      assert.equal(fs.readFileSync(path.join(this.temporary, ".owner"), "utf8"), this.ownership, "Fixture ownership marker changed.");
      fs.rmSync(this.temporary, { recursive: true, force: true });
      this.finalState.ownedFixtureRemoved = !fs.existsSync(this.temporary);
    } catch (error) { this.cleanupErrors.push(error.message); this.finalState.ownedFixtureRemoved = false; }
    this.finalState.cleanupErrors = [...this.cleanupErrors];
  }
}
