import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CopilotClient } from "@github/copilot-sdk";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";
import { withinDeadline } from "../../src/copilot-session-rpc.mjs";
import { daemonPaths } from "../../src/bridge-daemon.mjs";
import { codexProviderArgs } from "../../src/launcher.mjs";
import { createBridgeServer } from "../../src/server.mjs";
import { SessionManager } from "../../src/session-manager.mjs";
import { versionAtLeast } from "../../src/version.mjs";
import { fileState, redactor, treeState } from "./evidence.mjs";
import { runProcess } from "./process.mjs";
import { isolatedCodexEnvironment } from "./environment.mjs";

export class PrerequisiteError extends Error {
  constructor(message, code) { super(message); this.name = "PrerequisiteError"; this.code = code; }
}

export function observeClient(client, events) {
  const record = (event) => events.push({ sequence: events.length, ...event });
  record({ type: "client.created" });
  const observeSession = (session, config) => {
    const sessionId = session.sessionId ?? config.sessionId;
    record({ type: "session.created", sessionId, model: config.model, effort: config.reasoningEffort ?? null,
      systemMessage: config.systemMessage, availableTools: config.availableTools, tools: (config.tools || []).map(({ name, parameters }) => ({ name, parameters })) });
    for (const eventType of ["assistant.message", "external_tool.requested", "external_tool.completed"]) {
      session.on(eventType, (event) => {
        if (!event.agentId) record({ type: `sdk.${eventType}`, sessionId, data: event.data });
      });
    }
    session.on("assistant.usage", (event) => {
      if (event.agentId) return;
      const data = event.data || {};
      record({ type: "usage", sessionId, model: data.model ?? null,
        inputTokens: data.inputTokens ?? null, outputTokens: data.outputTokens ?? null,
        cacheReadTokens: data.cacheReadTokens ?? null, reasoningTokens: data.reasoningTokens ?? null });
    });
    return new Proxy(session, {
      get(target, key) {
        if (key === "rpc") {
          return { tools: { handlePendingToolCall: async (request) => {
            const result = await target.rpc.tools.handlePendingToolCall(request);
            record({ type: "tool.submitted", sessionId, requestId: request.requestId, result: request.result });
            return result;
          } } };
        }
        if (["send", "setModel", "abort", "disconnect"].includes(key)) return async (...args) => {
          if (key === "send") record({ type: "session.send.started", sessionId,
            promptSha256: createHash("sha256").update(args[0]?.prompt || "").digest("hex") });
          try {
            const result = await target[key](...args);
            record({ type: `session.${key}`, sessionId, ...(key === "setModel" ? { model: args[0], effort: args[1]?.reasoningEffort ?? null } : {}) });
            return result;
          } catch (error) {
            record({ type: `session.${key}.failed`, sessionId, message: error.message });
            throw error;
          }
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };
  return new Proxy(client, {
    get(target, key) {
      if (key === "createSession") return async (config) => observeSession(await target.createSession(config), config);
      if (["start", "listModels", "deleteSession", "stop", "forceStop"].includes(key)) return async (...args) => {
        try {
          const result = await target[key](...args);
          record({ type: `client.${key}`, ...(key === "deleteSession" ? { sessionId: args[0] } : {}),
            ...(key === "listModels" ? { models: result } : {}),
            ...(key === "stop" ? { errors: (result || []).map((error) => error.message) } : {}) });
          return result;
        } catch (error) {
          record({ type: `client.${key}.failed`, ...(key === "deleteSession" ? { sessionId: args[0] } : {}), message: error.message });
          throw error;
        }
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export class ValidationFixture {
  constructor({ directory, model, scenario, signal, timeoutMs = 240_000, env = process.env, clientFactory, codexBin } = {}) {
    Object.assign(this, { directory, model, scenario, signal, timeoutMs, env });
    this.clientFactory = clientFactory ?? (() => new CopilotClient({
      mode: "empty", baseDirectory: resolveCopilotHome(env.COPILOT_HOME), logLevel: "error", enableRemoteSessions: false,
    }));
    this.codexBin = codexBin ?? env.CODEX_BIN ?? "codex";
    this.offline = Boolean(clientFactory);
    this.token = randomBytes(32).toString("hex");
    this.scrub = redactor(env, [this.token]);
    this.sdk = [];
    this.http = [];
    this.diagnostics = [];
    this.processes = [];
    this.cleanupErrors = [];
    this.servers = [];
    this.workspaces = [];
    this.markers = [];
    this.configurationPaths = [
      path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml"),
      path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "auth.json"),
      path.join(resolveCopilotHome(env.COPILOT_HOME), "config.json"),
      daemonPaths(env).registry,
    ];
    this.configurationBefore = this.configurationPaths.map(fileState);
    this.addWorkspace();
  }

  addWorkspace() {
    const workspace = path.join(this.directory, `workspace ${this.workspaces.length + 1}`);
    fs.mkdirSync(workspace, { mode: 0o700 });
    const marker = `fixture-${randomUUID()}-한글`;
    fs.writeFileSync(path.join(workspace, "marker.txt"), `${marker}\n`, { mode: 0o600 });
    this.workspaces.push({ path: workspace, before: treeState(workspace) });
    this.markers.push(marker);
    return workspace;
  }

  async start() {
    const limited = this.scenario.id === "resources.failure";
    this.manager = new SessionManager({
      client: observeClient(this.clientFactory(), this.sdk), preferredModel: this.model,
      turnTimeoutMs: Math.min(this.timeoutMs, 90_000), cleanupTimeoutMs: 2_000,
      ...(limited ? { maxReplayBytes: 256 } : {}),
      onDiagnostic: (event) => this.diagnostics.push(event),
    });
    try {
      await withinDeadline(() => this.manager.start(), Math.min(this.timeoutMs, 60_000), this.signal);
    } catch (error) {
      if (this.signal?.aborted) throw error;
      throw new PrerequisiteError(`Cannot initialize the Copilot SDK: ${error.message}`, "sdk-unavailable");
    }
    const models = this.manager.listModels();
    this.modelInfo = models.find((entry) => entry.id === this.model);
    if (!this.modelInfo || this.modelInfo.policy?.state === "disabled") {
      throw new PrerequisiteError(`Selected model is unavailable: ${this.model}; no fallback was attempted.`, "model-unavailable");
    }
    this.instanceId = randomUUID();
    const manager = this.manager;
    const observed = {
      preferredModel: this.model, listModels: () => manager.listModels(),
      execute: async (body, headers, options) => {
        const record = { layer: "bridge", requestId: headers["x-validation-request"] ?? null, request: body, sessionId: headers["session-id"] ?? null, threadId: headers["thread-id"] ?? null };
        this.http.push(record);
        record.sdkStart = this.sdk.length;
        try {
          const result = await manager.execute(body, headers, options);
          record.result = result;
          record.sdkEnd = this.sdk.length;
          return result;
        } catch (error) {
          record.error = { name: error.name, code: error.code, message: error.message };
          record.sdkEnd = this.sdk.length;
          throw error;
        }
      },
    };
    const server = createBridgeServer({ manager: observed, apiKey: this.token, instanceId: this.instanceId,
      ...(limited ? { maxBodyBytes: 1_024 } : {}), onDiagnostic: (event) => this.diagnostics.push(event) });
    server.prependListener("request", (request, response) => {
      const record = { layer: "transport", method: request.method, route: request.url,
        threadId: request.headers["thread-id"] ?? null, sessionId: request.headers["session-id"] ?? null,
        contentEncoding: request.headers["content-encoding"] ?? null, upgrade: request.headers.upgrade ?? null,
        sdkStart: this.sdk.length };
      this.http.push(record);
      response.once("finish", () => { record.status = response.statusCode; record.sdkEnd = this.sdk.length; });
      response.once("close", () => { record.closed = true; record.sdkEnd = this.sdk.length; });
    });
    this.server = server;
    this.servers.push(server);
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => { server.removeListener("error", onError); resolve(); });
    });
    this.url = `http://127.0.0.1:${server.address().port}`;
  }

  counts() {
    const count = (type) => this.sdk.filter((entry) => entry.type === type).length;
    return { sessions: count("session.created"), prompts: count("session.send.started"), results: count("tool.submitted"), usage: count("usage") };
  }

  async request(route, { body, method = body === undefined ? "GET" : "POST", headers = {}, auth = "valid", signal, stream = false } = {}) {
    const record = { layer: "client", requestId: randomUUID(), route, method, authentication: auth, body,
      sessionId: headers["session-id"] ?? null, threadId: headers["thread-id"] ?? null, sdkStart: this.sdk.length };
    this.http.push(record);
    const combined = AbortSignal.any([this.signal, signal, AbortSignal.timeout(this.timeoutMs)].filter(Boolean));
    try {
      const response = await fetch(this.url + route, { method, signal: combined,
        headers: { ...(auth === "none" ? {} : { authorization: ["Bearer", auth === "valid" ? this.token : "invalid-fixture-token"].join(" ") }),
          "content-type": "application/json", ...headers, "x-validation-request": record.requestId },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      });
      record.status = response.status;
      record.contentType = response.headers.get("content-type");
      if (stream) { record.streaming = true; return response; }
      const wire = await response.text();
      record.wire = wire;
      let data;
      try { data = JSON.parse(wire); } catch { /* SSE is deliberately not JSON. */ }
      return { status: response.status, contentType: record.contentType, wire, data };
    } catch (error) {
      record.error = { name: error.name, message: error.message };
      throw error;
    } finally { record.sdkEnd = this.sdk.length; }
  }

  post(body, { session, ...options } = {}) {
    return this.request("/v1/responses", { ...options, body: { model: this.model, stream: false, ...body },
      headers: { ...options.headers, ...(session ? { "session-id": session, "thread-id": session } : {}) } });
  }

  async response(body, options) {
    const result = await this.post(body, options);
    assert.equal(result.status, 200, this.scrub(result.wire));
    assert.equal(result.data?.status, "completed");
    assert.equal(result.data?.model, this.model);
    return result.data;
  }

  async codex(prompt, workspaceIndex = 0) {
    const home = path.join(this.directory, `home-${this.processes.length + 1}`);
    const codexHome = path.join(home, ".codex");
    const temporary = path.join(home, "tmp");
    for (const directory of [codexHome, temporary]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const env = isolatedCodexEnvironment(this.env, { home, codexHome, temporary, token: this.token });
    const cwd = this.workspaces[workspaceIndex].path;
    if (!this.codexVersion) {
      let version;
      try { version = await runProcess(this.codexBin, ["--version"], { cwd, env, signal: this.signal, timeoutMs: 10_000 }); }
      catch { throw new PrerequisiteError("Cannot execute the configured Codex binary.", "codex-unavailable"); }
      if (version.code !== 0 || !versionAtLeast(version.stdout, "0.154.0")) {
        throw new PrerequisiteError("Codex CLI 0.154.0 or newer is required.", "codex-version");
      }
      this.codexVersion = version.stdout.trim();
    }
    const port = this.server.address().port;
    const args = [...codexProviderArgs({ model: this.model, port }),
      "-c", "features.apps=false", "-c", "features.plugins=false", "-c", "features.memories=false",
      "exec", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only", "--skip-git-repo-check", "--json", "--color", "never", prompt];
    const invocation = { command: this.codexBin, args, cwd, sandbox: "read-only", isolatedCodexHome: true, version: this.codexVersion };
    try {
      const result = await runProcess(this.codexBin, args, { cwd, env, signal: this.signal, timeoutMs: this.timeoutMs });
      this.processes.push({ ...invocation, ...result });
      return result;
    } catch (error) {
      this.processes.push({ ...invocation, ...error.processResult, error: error.message });
      throw error;
    }
  }

  assertRoute() {
    assert.ok(this.sdk.some(({ type }) => type === "client.listModels"), "No SDK model catalog evidence.");
    const counts = this.counts();
    if (this.scenario.inference === "none") {
      assert.equal(counts.prompts + counts.results, 0, "A rejection/discovery scenario performed inference.");
    } else {
      assert.ok(counts.sessions && counts.prompts, "No SDK session or prompt submission evidence.");
      const usage = this.sdk.filter(({ type }) => type === "usage");
      if (!usage.length || usage.some(({ model }) => model == null)) {
        throw new PrerequisiteError("The SDK did not provide model-attributed usage; the route cannot be fully certified.", "missing-route-evidence");
      }
      assert.ok(usage.every(({ model }) => model === this.model), "SDK usage indicates a different model.");
    }
    assert.ok(this.sdk.filter(({ type }) => type === "session.created").every(({ model }) => model === this.model), "SDK session model mismatch.");
    return { model: this.model, ...counts, nativeProcesses: this.processes.length, usage: this.sdk.filter(({ type }) => type === "usage") };
  }

  state() {
    const workspaces = this.workspaces.map(({ path: directory, before }) => ({ name: path.basename(directory), before, after: treeState(directory) }));
    const configurationAfter = this.configurationPaths.map(fileState);
    return {
      workspaces, configurationBefore: this.configurationBefore, configurationAfter,
      workspaceUnchanged: workspaces.every(({ before, after }) => JSON.stringify(before) === JSON.stringify(after)),
      configurationUnchanged: JSON.stringify(this.configurationBefore) === JSON.stringify(configurationAfter),
      // Only these explicitly observed config files are attested, not all files in the user's home.
      observedConfigFiles: ["Codex config.toml", "Codex auth.json", "Copilot config.json", "existing project daemon registry"],
      processesClosed: this.processes.every(({ closed }) => closed === true),
      cleanupErrors: [...this.cleanupErrors], allListenersClosed: this.servers.every((server) => !server.listening),
    };
  }

  async stop() {
    const server = this.server;
    this.server = null;
    if (server) {
      server.abortActiveRequests();
      server.closeAllConnections();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    }
    const manager = this.manager;
    this.manager = null;
    if (manager) {
      try { await manager.stop(); }
      catch (error) { this.cleanupErrors.push(error.message); }
    }
    for (const entry of this.sdk.filter(({ type, errors }) => type === "client.stop" && errors?.length)) {
      for (const message of entry.errors) if (!this.cleanupErrors.includes(message)) this.cleanupErrors.push(message);
    }
    if (this.diagnostics.some(({ event }) => event === "bridge.session_cleanup_failed")) {
      this.cleanupErrors.push("The SDK could not clean up an owned session.");
    }
  }
}
