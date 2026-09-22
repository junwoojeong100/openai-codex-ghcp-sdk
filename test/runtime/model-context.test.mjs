import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { codexEnvironment, codexProviderArgs, writeCodexCatalog } from "../../src/launcher.mjs";
import { DEFAULT_MODEL, SUPPORTED_MODEL_IDS, modelCatalog } from "../../src/model-map.mjs";
import { createBridgeServer } from "../../src/server.mjs";
import { SessionManager } from "../../src/session-manager.mjs";
import { NativeHost } from "../../scripts/compatibility/rpc.mjs";
import { FakeClient } from "../helpers/stability-sdk.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bin = process.env.CODEX_BIN || "codex";
const model = DEFAULT_MODEL;
const token = "owned-context-runtime-fixture";
const limits = { max_context_window_tokens: 65_536, max_prompt_tokens: 49_152, max_output_tokens: 16_384 };
const models = [{ id: model, supportedReasoningEfforts: ["low"], capabilities: {
  supports: { reasoningEffort: true }, limits,
} }];

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-context-runtime-"));
  const codexHome = path.join(directory, ".codex");
  fs.mkdirSync(codexHome, { mode: 0o700 });
  const env = { ...codexEnvironment(process.env, token), HOME: directory, CODEX_HOME: codexHome };
  const hosts = [];
  let manager, server;
  t.after(async () => {
    try {
      for (const host of hosts) await host.close();
      server?.abortActiveRequests();
      server?.closeAllConnections();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      await manager?.stop();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  return {
    directory, env,
    async host(args, options = {}) {
      const host = new NativeHost({
        bin, args, cwd: directory, env, signal: AbortSignal.timeout(20_000), ...options,
      });
      hosts.push(host);
      await host.start();
      return host;
    },
    async bridge(client, options = {}) {
      const diagnostics = [];
      manager = new SessionManager({
        client, turnTimeoutMs: 3000, cleanupTimeoutMs: 250,
        onDiagnostic: event => diagnostics.push(event), ...options,
      });
      server = createBridgeServer({ manager, apiKey: token, onDiagnostic: event => diagnostics.push(event) });
      await manager.start();
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const catalog = modelCatalog(manager.listModels());
      const catalogPath = writeCodexCatalog(catalog, directory);
      return { manager, diagnostics, catalog,
        args: codexProviderArgs({ model, port: server.address().port, catalogPath }) };
    },
  };
}

async function startThread(host, directory, extra = {}) {
  const result = await host.request("thread/start", {
    model, modelProvider: "ghcp", cwd: directory, sandbox: "read-only",
    approvalPolicy: "never", allowProviderModelFallback: false, ephemeral: true, ...extra,
  });
  assert.equal(result.model, model);
  return result.thread.id;
}

test("the actual launcher replaces bundled picker entries and removes its private catalog on exit", { timeout: 25_000 }, async t => {
  const f = fixture(t);
  const output = path.join(f.directory, "observer");
  fs.mkdirSync(output, { mode: 0o700 });
  const observer = path.join(f.directory, "observer.json");
  fs.writeFileSync(observer, JSON.stringify({ output, executionKind: "offline-self-test" }), { mode: 0o600 });
  const host = await f.host(["--ghcp-model", model, "--"], {
    bin: path.join(root, "bin/codex-ghcp"),
    env: { ...f.env, CODEX_BIN: bin, GHCP_COMPAT_OBSERVER: observer,
      COPILOT_HOME: path.join(f.directory, "copilot"), GHCP_DAEMON_DIR: path.join(f.directory, "daemon"),
      NODE_OPTIONS: `--import=${JSON.stringify(path.join(root, "scripts/compatibility/launcher-observer.mjs"))}` },
  });
  const picker = await host.request("model/list", { includeHidden: true });
  assert.deepEqual(picker.data.map(entry => entry.model), [model]);
  const config = await host.request("config/read", { includeLayers: false });
  const filename = config.config.model_catalog_json;
  assert.equal(typeof filename, "string");
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(filename)).mode & 0o777, 0o700);
  const catalog = JSON.parse(fs.readFileSync(filename, "utf8"));
  assert.deepEqual(catalog.models.map(entry => entry.slug), [model]);
  assert.equal(catalog.models[0].context_window, 240_000);
  assert.equal(catalog.models[0].auto_compact_token_limit, 192_000);
  await host.close();
  assert.equal(fs.existsSync(filename), false);
  assert.equal(fs.existsSync(path.dirname(filename)), false);
});

test("native model/list exposes exactly the available main models, including Claude, with no hidden bundled models", { timeout: 25_000 }, async t => {
  const f = fixture(t);
  const catalog = modelCatalog(SUPPORTED_MODEL_IDS.map(id => ({
    ...models[0], id,
    ...(id === "claude-haiku-4.5" ? {
      supportedReasoningEfforts: [], capabilities: { supports: { reasoningEffort: false }, limits },
    } : {}),
    ...(id === "gpt-5.6-luna" ? { policy: { state: "disabled" } } : {}),
  })).concat({ id: "unrelated-model" }));
  const catalogPath = writeCodexCatalog(catalog, f.directory);
  const host = await f.host(codexProviderArgs({ model, port: 4143, catalogPath }));
  for (const includeHidden of [false, true]) {
    const picker = await host.request("model/list", { includeHidden });
    assert.deepEqual(picker.data.map(entry => entry.model), SUPPORTED_MODEL_IDS.filter(id => id !== "gpt-5.6-luna"));
    assert.equal(picker.nextCursor, null);
  }
});

test("native automatic compaction at a resolved tool handoff completes and continues the same thread", { timeout: 25_000 }, async t => {
  const f = fixture(t);
  const marker = `CONTEXT_${randomUUID()}`;
  let toolExecutions = 0;
  const client = new FakeClient({ models,
    onSend(session, { prompt }) {
      if (!session.config.tools.length) {
        assert.match(prompt, /function_call_output/);
        assert.ok(prompt.includes(marker), "compaction must receive the actual tool result");
        session.reply(`Retained marker: ${marker}`);
      } else if (prompt.includes(marker) || session.rememberedMarker) {
        if (prompt.includes(marker)) session.rememberedMarker = marker;
        session.reply(session.rememberedMarker);
      } else {
        assert.equal(client.sessions.length, 1, "the completed tool must not be executed again after compaction");
        session.emit("assistant.usage", { model, inputTokens: 40_000, outputTokens: 10 });
        const tool = session.config.tools.find(entry => entry.description.includes("context regression fixture"));
        assert.ok(tool);
        session.toolCalls([{ toolCallId: "context-fixture-call", name: tool.name, arguments: {} }]);
      }
    },
    onSubmit() { assert.fail("compaction must retire the old SDK session, not release its pending call"); },
  });
  const bridge = await f.bridge(client);
  assert.equal(bridge.catalog.models[0].auto_compact_token_limit, 39_321);
  const host = await f.host(bridge.args, {
    onRequest: async request => {
      assert.equal(request.method, "item/tool/call");
      assert.equal(request.params.tool, "read_context");
      toolExecutions += 1;
      return { success: true, contentItems: [{ type: "inputText", text: marker }] };
    },
  });
  const thread = await startThread(host, f.directory, {
    dynamicTools: [{ name: "read_context", description: "Read context regression fixture.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }, deferLoading: false }],
  });
  const turn = await host.turn(thread, "Use read_context exactly once and return the marker it supplies.");
  assert.equal(turn.status, "completed", JSON.stringify({ error: turn.error, diagnostics: bridge.diagnostics }));
  assert.equal(toolExecutions, 1);
  const compactions = host.records.filter(row => row.message.method === "item/completed"
    && row.message.params?.item?.type === "contextCompaction");
  assert.equal(compactions.length, 1);
  assert.equal(compactions[0].message.params.threadId, thread);
  assert.equal(client.sessions[0].aborted, 1);
  assert.equal(client.sessions[0].disconnected, 1);
  assert.ok(client.sessions.every(session => session.submitted.length === 0 && session.config.contextTier === "default"));
  assert.equal(bridge.manager.callStates.size, 0);
  assert.ok(!bridge.diagnostics.some(event => event.event === "bridge.pending_session_changed"));
  const usage = host.records.find(row => row.message.method === "thread/tokenUsage/updated")?.message.params.tokenUsage;
  assert.equal(usage?.modelContextWindow, Math.floor(limits.max_prompt_tokens * 0.95));
  const next = await host.turn(thread, "Recall the retained marker without tools.");
  assert.equal(next.status, "completed");
  assert.equal(toolExecutions, 1);
  const answer = host.records.findLast(row => row.message.method === "item/completed"
    && row.message.params?.turnId === next.id && row.message.params?.item?.type === "agentMessage");
  assert.equal(answer?.message.params.item.text, marker);
});

test("native context overflow fails once with the recognized code and allows a shorter follow-up", { timeout: 25_000 }, async t => {
  const f = fixture(t);
  let sends = 0;
  const client = new FakeClient({ models, onSend(session) {
    sends += 1;
    if (sends === 1) session.emit("session.error", { errorType: "context_limit", message: "Fixture context limit" });
    else session.reply("Recovered with a shorter conversation.");
  } });
  const bridge = await f.bridge(client);
  const host = await f.host(bridge.args);
  const thread = await startThread(host, f.directory);
  const turn = await host.turn(thread, "Trigger the fixture overflow.");
  assert.equal(turn.status, "failed");
  assert.equal(turn.error.codexErrorInfo, "contextWindowExceeded");
  assert.equal(sends, 1);
  const next = await host.turn(thread, "Shorter follow-up.");
  assert.equal(next.status, "completed", JSON.stringify(next.error));
  assert.ok(sends <= 3, "only a local compaction and the follow-up may make another request");
});

test("a stalled native stream returns a deadline error without automatic inference retries", { timeout: 25_000 }, async t => {
  const f = fixture(t);
  const client = new FakeClient({ models, onSend() {} });
  const bridge = await f.bridge(client, { turnTimeoutMs: 100 });
  const host = await f.host(bridge.args);
  const thread = await startThread(host, f.directory);
  const started = Date.now();
  const turn = await host.turn(thread, "Wait for the stalled fixture.");
  assert.equal(turn.status, "failed");
  assert.match(turn.error.message, /Timed out waiting for GitHub Copilot/);
  assert.ok(Date.now() - started < 4000, "a bounded timeout must not turn into repeated long waits");
  assert.equal(client.sessions.length, 1);
  assert.equal(client.sessions[0].sent.length, 1);
  assert.equal(client.sessions[0].aborted, 1);
  assert.equal(bridge.manager.states.size, 0);
});
