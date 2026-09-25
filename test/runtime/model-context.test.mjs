import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { codexProviderArgs, writeCodexCatalog } from "../../src/launcher.mjs";
import { DEFAULT_MODEL, SUPPORTED_MODEL_IDS, modelCatalog } from "../../src/model-map.mjs";
import { createBridgeServer } from "../../src/server.mjs";
import { SessionManager } from "../../src/session-manager.mjs";
import { NativeHost } from "../../scripts/verification/rpc.mjs";
import { environment } from "../../scripts/verification/util.mjs";
import { runTerminalProbe } from "../../scripts/verification/terminal.mjs";
import { FakeClient, replayInput } from "../helpers/stability-sdk.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const bin = process.env.CODEX_BIN || "codex";
const model = DEFAULT_MODEL;
const token = "owned-context-runtime-fixture";
const isolatedCodexArgs = ["apps", "plugins", "memories", "multi_agent"]
  .flatMap(feature => ["-c", `features.${feature}=false`]);
const limits = { max_context_window_tokens: 65_536, max_prompt_tokens: 49_152, max_output_tokens: 16_384 };
const models = [{ id: model, supportedReasoningEfforts: ["low"], capabilities: {
  supports: { reasoningEffort: true }, limits,
} }];

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-context-runtime-"));
  const codexHome = path.join(directory, ".codex");
  fs.mkdirSync(codexHome, { mode: 0o700 });
  const env = environment(process.env, { home: directory, codexHome, tmp: directory, token });
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
        bin, cwd: directory, env, signal: AbortSignal.timeout(20_000), ...options,
        args: [...args, ...isolatedCodexArgs],
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
  const host = await f.host(["--ghcp-model", model, "--"], {
    bin: path.join(root, "bin/codex-ghcp"),
    env: { ...f.env, CODEX_BIN: bin,
      COPILOT_HOME: path.join(f.directory, "copilot"), GHCP_DAEMON_DIR: path.join(f.directory, "daemon"),
      NODE_OPTIONS: `--import=${JSON.stringify(path.join(root, "test/fixtures/catalog-sdk.mjs"))}` },
  });
  const picker = await host.request("model/list", { includeHidden: true });
  assert.deepEqual(picker.data.map(entry => entry.model), [model]);
  const config = await host.request("config/read", { includeLayers: false });
  for (const feature of ["apps", "plugins", "memories", "multi_agent"]) {
    assert.equal(config.config.features[feature], false, `Offline context fixtures must disable ${feature}`);
  }
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
    ...(id === "gpt-6-luna" ? { policy: { state: "disabled" } } : {}),
  })).concat({ id: "unrelated-model" }, { id: "gpt-5.6-luna" }, { id: "claude-opus-5" }));
  const catalogPath = writeCodexCatalog(catalog, f.directory);
  const host = await f.host(codexProviderArgs({ model, port: 4143, catalogPath }));
  for (const includeHidden of [false, true]) {
    const picker = await host.request("model/list", { includeHidden });
    assert.deepEqual(picker.data.map(entry => entry.model), SUPPORTED_MODEL_IDS.filter(id => id !== "gpt-6-luna"));
    assert.equal(picker.nextCursor, null);
  }
});

test("native model switches keep the maximum context tier and catalog budget aligned for all six models", { timeout: 25_000 }, async t => {
  const f = fixture(t);
  const catalogModels = SUPPORTED_MODEL_IDS.map(id => {
    const extended = id !== "claude-haiku-4.5";
    return { id, supportedReasoningEfforts: extended ? ["low"] : [],
      capabilities: { supports: { reasoningEffort: extended }, limits: {
        max_context_window_tokens: extended ? 1_000_000 : 200_000,
        max_prompt_tokens: extended ? 872_000 : 136_000,
        max_output_tokens: extended ? 128_000 : 64_000,
      } },
      ...(extended ? { billing: { tokenPrices: {
        maxPromptTokens: 200_000, longContext: { maxPromptTokens: 872_000 },
      } } } : {}),
    };
  });
  const client = new FakeClient({ models: catalogModels, onSend: session => session.reply(`ACTIVE_${session.config.model}`) });
  const bridge = await f.bridge(client);
  const host = await f.host(bridge.args);
  const thread = await startThread(host, f.directory);
  for (const id of SUPPORTED_MODEL_IDS) {
    const turn = await host.turn(thread, `Report the active model ${id}.`, { model: id });
    assert.equal(turn.status, "completed", JSON.stringify({ id, error: turn.error, diagnostics: bridge.diagnostics }));
    assert.equal(client.sessions.at(-1).config.model, id);
    assert.equal(client.sessions.at(-1).config.contextTier, id === "claude-haiku-4.5" ? "default" : "long_context");
    const budget = id === "claude-haiku-4.5" ? 136_000 : 872_000;
    const metadata = bridge.catalog.models.find(entry => entry.slug === id);
    assert.equal(metadata.context_window, budget);
    assert.equal(metadata.auto_compact_token_limit, Math.floor(budget * 0.8));
    const usage = host.records.findLast(row => row.message.method === "thread/tokenUsage/updated")?.message.params.tokenUsage;
    assert.equal(usage?.modelContextWindow, Math.floor(budget * 0.95), id);
    const answer = host.records.findLast(row => row.message.method === "item/completed"
      && row.message.params?.turnId === turn.id && row.message.params?.item?.type === "agentMessage");
    assert.equal(answer?.message.params.item.text, `ACTIVE_${id}`);
  }
  assert.equal(client.sessions.length, SUPPORTED_MODEL_IDS.length);
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

test("native manual compaction and recall keep the current instruction separate from the original reply request", { timeout: 25_000 }, async t => {
  const f = fixture(t), label = `PROJECT_${randomUUID()}`, ack = `ACK_${randomUUID()}`;
  const remember = `The synthetic project label is ${label}. Keep it in summaries. Reply only ${ack}.`;
  const recall = "Return the remembered project label, not its earlier acknowledgment. Do not use tools.";
  let compactions = 0, recalls = 0;
  const client = new FakeClient({ models, onSend(session, { prompt }) {
    const items = replayInput(prompt), current = items.at(-1).content;
    const envelope = JSON.parse(prompt.split("<conversation_history>\n")[1].split("\n</conversation_history>")[0]);
    assert.ok(prompt.endsWith(`\n\nCurrent user request:\n${current}`));
    assert.ok(!envelope.some(item => item.content === current));
    if (!session.config.tools.length) {
      compactions++;
      assert.match(current, /CONTEXT CHECKPOINT COMPACTION/);
      assert.ok(envelope.some(item => item.content === remember));
      assert.ok(envelope.some(item => item.role === "assistant" && item.content === ack));
      session.reply(`The project label is ${label}; ${ack} was only an acknowledgment. Preserve the label.`);
    } else if (current === remember) session.reply(ack);
    else {
      assert.equal(current, recall);
      assert.ok(envelope.some(item => item.content.includes(label)));
      recalls++;
      session.reply(label);
    }
  } });
  const bridge = await f.bridge(client), host = await f.host(bridge.args);
  const thread = await startThread(host, f.directory);
  assert.equal((await host.turn(thread, remember)).status, "completed");
  const offset = host.records.length;
  await host.request("thread/compact/start", { threadId: thread });
  await host.wait(row => row.message.method === "turn/completed" && row.message.params.threadId === thread, offset);
  assert.equal((await host.turn(thread, recall)).status, "completed");
  assert.equal(compactions, 1);
  assert.equal(recalls, 1);
  assert.equal(client.sessions.length, 3);
  assert.ok(client.sessions.every(session => session.sent.length === 1 && session.submitted.length === 0));
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

test("one native turn can complete 120 sequential tools across repeated automatic compactions", { timeout: 25_000 }, async t => {
  const f = fixture(t);
  const target = 120;
  let toolExecutions = 0;
  const checkpoint = prompt => [...prompt.matchAll(/\bSTEP_(\d+)\b/g)].map(match => Number(match[1])).at(-1) ?? 0;
  const advance = (session, step) => {
    if (step === target) { session.reply("ALL_STEPS_DONE"); return; }
    const tool = session.config.tools.find(entry => entry.description.includes("longturn-counter fixture"));
    assert.ok(tool);
    session.inputTokens = (session.inputTokens ?? 4000) + 2000;
    session.emit("assistant.usage", { model, inputTokens: session.inputTokens, outputTokens: 20 });
    session.toolCalls([{ toolCallId: `longturn-${step + 1}`, name: tool.name, arguments: { index: step + 1 } }]);
  };
  const client = new FakeClient({ models,
    onSend(session, { prompt }) {
      const step = checkpoint(prompt);
      if (!session.config.tools.length) {
        assert.ok(step > 0);
        session.reply(`Completed through STEP_${step}. Continue the remaining steps without repeating earlier tools.`);
      } else advance(session, step);
    },
    onSubmit(session, request) { advance(session, checkpoint(request.result.textResultForLlm)); },
  });
  const bridge = await f.bridge(client);
  const host = await f.host(bridge.args, {
    onRequest: async request => {
      assert.equal(request.method, "item/tool/call");
      assert.equal(request.params.tool, "read_counter");
      assert.equal(request.params.arguments.index, toolExecutions + 1);
      toolExecutions++;
      return { success: true, contentItems: [{ type: "inputText", text: `STEP_${toolExecutions}\n${"inert measurement data\n".repeat(100)}` }] };
    },
  });
  const thread = await startThread(host, f.directory, {
    dynamicTools: [{ name: "read_counter", description: "Read longturn-counter fixture.",
      inputSchema: { type: "object", properties: { index: { type: "integer" } }, required: ["index"], additionalProperties: false },
      deferLoading: false }],
  });
  const turn = await host.turn(thread, `Read all ${target} counter samples in order, one tool call at a time.`);
  assert.equal(turn.status, "completed", JSON.stringify({ error: turn.error, diagnostics: bridge.diagnostics }));
  assert.equal(toolExecutions, target);
  const compactions = host.records.filter(row => row.message.method === "item/completed"
    && row.message.params?.item?.type === "contextCompaction");
  assert.ok(compactions.length >= 6, `Expected repeated compaction, observed ${compactions.length}`);
  assert.equal(bridge.manager.states.size, 1);
  assert.equal(bridge.manager.queue.total, 0);
  assert.ok(client.sessions.slice(0, -1).every(session => session.aborted === 1 && session.disconnected === 1));
  assert.ok(!bridge.diagnostics.some(event => event.event === "bridge.pending_session_changed"));
  t.diagnostic(JSON.stringify({ toolExecutions, compactions: compactions.length, sdkSessions: client.sessions.length }));
});

async function terminalFixture(t, { turns, hangFirstSetup = false, turnIdleRecoveryAttempts = 1,
  firstReplyDelayMs = 2200, firstProgressTimeoutMs = 1500, idleTimeoutMs = 1500, turnTimeoutMs = 4000,
  readinessIntervalMs = 250, probeTimeoutMs = 20000, probeTurnTimeoutMs = 6000 }) {
  const f = fixture(t);
  const tmp = path.join(f.directory, "tmp");
  fs.mkdirSync(tmp, { mode: 0o700 });
  const output = path.join(f.directory, "sdk.json");
  const configuration = path.join(f.directory, "fixture.json");
  fs.writeFileSync(configuration, JSON.stringify({ output, hangFirstSetup, firstReplyDelayMs }), { mode: 0o600 });
  const result = await runTerminalProbe({
    bin: path.join(root, "bin/codex-ghcp"),
    args: ["--", "-a", "never", "--sandbox", "read-only",
      "-c", `projects={ ${JSON.stringify(fs.realpathSync(f.directory))}={ trust_level="trusted" } }`,
      ...isolatedCodexArgs],
    cwd: f.directory, ownedRoot: f.directory, directory: path.join(f.directory, "terminal"),
    env: { ...f.env, TMPDIR: tmp, CODEX_BIN: bin, COPILOT_HOME: path.join(f.directory, "copilot"),
      GHCP_DAEMON_DIR: path.join(f.directory, "daemon"), GHCP_TERMINAL_FIXTURE: configuration,
      TURN_TIMEOUT_MS: String(turnTimeoutMs), TURN_IDLE_TIMEOUT_MS: String(idleTimeoutMs), SDK_STARTUP_TIMEOUT_MS: "500",
      TURN_FIRST_PROGRESS_TIMEOUT_MS: String(firstProgressTimeoutMs),
      TURN_IDLE_RECOVERY_ATTEMPTS: String(turnIdleRecoveryAttempts), SDK_READINESS_INTERVAL_MS: String(readinessIntervalMs),
      NODE_OPTIONS: `--import=${JSON.stringify(path.join(root, "test/fixtures/terminal-sdk.mjs"))}` },
    turns, timeoutMs: probeTimeoutMs, readyTimeoutMs: 8000, turnTimeoutMs: probeTurnTimeoutMs, stopGraceMs: 1000,
    allowOwnedTrust: true, allowOwnedSetup: true, columns: 160, rows: 45,
  });
  const sdk = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : null;
  assert.equal(result.status, "passed", JSON.stringify({
    result, sdk, screen: fs.readFileSync(path.join(f.directory, "terminal/terminal-screen.txt"), "utf8"),
  }));
  assert.equal(result.cleanup.childReaped, true);
  assert.equal(result.cleanup.processGroupGone, true);
  assert.ok(sdk, "The SDK fixture must write its exit record.");
  return { result, sdk };
}

test("the real TUI recovers from idle failure and Escape without restarting its terminal", { timeout: 25_000 }, async t => {
  const { result, sdk } = await terminalFixture(t, { turnIdleRecoveryAttempts: 0, turns: [
    { prompt: "Reply with FIRST_OK.", expectedMarker: "FIRST_OK" },
    { prompt: "Run IDLE_FIXTURE.", expectedError: "GitHub Copilot stopped producing model progress" },
    { prompt: "Reply with AFTER_IDLE_OK.", expectedMarker: "AFTER_IDLE_OK" },
    { prompt: "Run INTERRUPT_FIXTURE.", expectedError: "Conversation interrupted", interruptAfterMs: 500 },
    { prompt: "Reply with AFTER_INTERRUPT_OK.", expectedMarker: "AFTER_INTERRUPT_OK" },
  ] });
  assert.equal(sdk.sends, 5, "no stalled prompt or tool result may be silently retried");
  assert.equal(result.turns[1].errorObserved, true);
  assert.ok(result.turns[1].durationMs < 3500);
  assert.ok(result.turns[3].interruptionRecoveryMs < 2500);
  assert.equal(result.turns[4].markerObserved, true);
  assert.equal(sdk.diagnostics.filter(event => event.event === "bridge.turn_stalled").length, 1);
});

test("the real TUI automatically resumes a silent turn and accepts byte-only progress", { timeout: 25_000 }, async t => {
  const { result, sdk } = await terminalFixture(t, { turns: [
    { prompt: "Run RECOVER_FIXTURE.", expectedMarker: "AUTO_RECOVERED_OK" },
    { prompt: "Run BYTES_FIXTURE.", expectedMarker: "STREAM_PROGRESS_OK" },
    { prompt: "Reply with AFTER_RECOVERY_OK.", expectedMarker: "AFTER_RECOVERY_OK" },
  ] });
  assert.equal(sdk.sends, 4);
  assert.equal(sdk.sessions, 2);
  assert.equal(sdk.byteDeltas, 8);
  assert.ok(result.turns.every(turn => turn.markerObserved && !turn.errorObserved));
  assert.equal(sdk.diagnostics.filter(event => event.event === "bridge.turn_stalled").length, 1);
  assert.equal(sdk.diagnostics.filter(event => event.event === "bridge.turn_recovered").length, 1);
  assert.ok(sdk.diagnostics.some(event => event.event === "bridge.turn_watchdog"));
});

test("the real TUI waits for slow first progress and accepts private root-phase activity", { timeout: 25_000 }, async t => {
  const { result, sdk } = await terminalFixture(t, { firstProgressTimeoutMs: 3000, turnTimeoutMs: 5000, turns: [
    { prompt: "Run DELAYED_FIRST_FIXTURE.", expectedMarker: "DELAYED_FIRST_OK" },
    { prompt: "Run FUSION_FIXTURE.", expectedMarker: "FUSION_PROGRESS_OK" },
    { prompt: "Reply with AFTER_RECOVERY_OK.", expectedMarker: "AFTER_RECOVERY_OK" },
  ] });
  assert.equal(sdk.sends, 3);
  assert.equal(sdk.sessions, 1);
  assert.equal(sdk.fusionDeltas, 8);
  assert.ok(sdk.firstProgressDelays[0] >= 2200);
  assert.ok(result.turns.every(turn => turn.markerObserved && !turn.errorObserved));
  assert.ok(!sdk.diagnostics.some(event => /turn_stalled|turn_recovering/.test(event.event)));
});

test("production watchdog tolerates first progress after 90000 ms in the actual TUI without replay", { timeout: 130_000 }, async t => {
  const { result, sdk } = await terminalFixture(t, {
    firstReplyDelayMs: 95_000, firstProgressTimeoutMs: 180_000, idleTimeoutMs: 90_000, turnTimeoutMs: 300_000,
    readinessIntervalMs: 15_000, probeTimeoutMs: 120_000, probeTurnTimeoutMs: 110_000, turns: [
      { prompt: "Run DELAYED_FIRST_FIXTURE.", expectedMarker: "DELAYED_FIRST_OK" },
      { prompt: "Reply with AFTER_RECOVERY_OK.", expectedMarker: "AFTER_RECOVERY_OK" },
    ],
  });
  assert.deepEqual(sdk.watchdog, { firstProgressTimeoutMs: 180_000, idleTimeoutMs: 90_000,
    turnTimeoutMs: 300_000, recoveryAttempts: 1 });
  assert.equal(sdk.sends, 2);
  assert.equal(sdk.sessions, 1);
  assert.ok(sdk.firstProgressDelays[0] >= 95_000, JSON.stringify({ delays: sdk.firstProgressDelays }));
  assert.ok(result.turns.every(turn => turn.markerObserved && !turn.errorObserved));
  assert.ok(sdk.diagnostics.some(event => event.event === "bridge.turn_watchdog"
    && event.waitPhase === "first_progress" && event.idleMs >= 90_000 && event.timeoutMs === 180_000));
  assert.ok(!sdk.diagnostics.some(event => /turn_stalled|turn_recovering/.test(event.event)));
  t.diagnostic(JSON.stringify({ firstProgressDelayMs: sdk.firstProgressDelays[0], sends: sdk.sends, sdkSessions: sdk.sessions }));
});

test("the real TUI surfaces a stalled session setup and accepts the next prompt", { timeout: 25_000 }, async t => {
  const { result, sdk } = await terminalFixture(t, { hangFirstSetup: true, turns: [
    { prompt: "Start the initial controlled session.", expectedError: "GitHub Copilot session setup timed out" },
    { prompt: "Reply with AFTER_SETUP_OK.", expectedMarker: "AFTER_SETUP_OK" },
  ] });
  assert.equal(result.turns[0].errorObserved, true);
  // PTY timing also includes native preparation and rendering, not just SDK setup.
  assert.equal(sdk.setupFailures.length, 1);
  const [failure] = sdk.setupFailures;
  assert.equal(failure.code, "copilot_setup_timeout");
  assert.equal(failure.timeoutMs, 500);
  assert.ok(failure.elapsedMs >= 400 && failure.elapsedMs < 2500, JSON.stringify(failure));
  assert.equal(result.turns[1].markerObserved, true);
  assert.equal(sdk.sends, 1);
  assert.equal(sdk.sessions, 2);
  t.diagnostic(JSON.stringify({ setupFailureMs: failure.elapsedMs, visibleErrorMs: result.turns[0].durationMs }));
});
