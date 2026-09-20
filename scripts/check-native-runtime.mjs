#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { NativeFixture } from "./native/fixture.mjs";
import { ROOT, freshDirectory, redactor, writeJson } from "./validation/evidence.mjs";

// Real Codex/HTTP protocol, but NO real Copilot SDK client or model transport.
// This smoke check diagnoses runtime/schema assumptions, not compatibility.
export async function checkNativeRuntime({ output, env = process.env } = {}) {
  const directory = freshDirectory(output ?? path.join(ROOT, ".runtime", `native-runtime-${randomUUID()}`));
  let sessionAttempts = 0;
  const metadataClient = {
    async start() {}, async stop() { return []; }, async forceStop() {},
    async listModels() { return [{ id: "gpt-6-astra", capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ["low", "high"] }]; },
    async createSession() { sessionAttempts += 1; throw new Error("Metadata-only runtime check forbids inference."); },
  };
  const f = new NativeFixture({ directory, model: "gpt-6-astra", scenario: { id: "settings.normal" }, timeoutMs: 15_000,
    env, clientFactory: () => metadataClient });
  const result = { kind: "native-runtime-smoke", executionKind: "offline-self-test", realNativeBinary: true,
    realModelCalls: 0, catalogSource: "synthetic-local-fixture", startedAt: new Date().toISOString(), checks: [], passed: false };
  try {
    assert.equal(await f.version(), "codex-cli 0.154.0"); result.checks.push("pinned native executable");
    await f.start(); f.setConfig('model_verbosity = "low"\n');
    const host = await f.host({ args: ["-c", 'model_verbosity="high"'] });
    const config = await f.rpc(host, "config/read", { includeLayers: true, cwd: f.workspace });
    assert.equal(config.config.model_verbosity, "high"); assert.equal(config.config.model_provider, "ghcp");
    assert.ok(config.layers.some(({ name }) => name.file === path.join(f.codexHome, "config.toml")));
    result.checks.push("configuration precedence and canonical source paths");
    const thread = await f.thread(host);
    assert.equal(thread.model, f.model); assert.equal(thread.modelProvider, "ghcp"); assert.equal(thread.thread.cwd, f.workspace);
    result.checks.push("thread identity/provider/cwd");
    // 0.154.0 accepts arbitrary nonempty effort strings at turn/start. Rejection
    // is asynchronous at the bridge, not necessarily an immediate RPC error.
    const invalid = await f.turn(host, thread.thread.id, "This invalid effort must not reach inference.", { effort: "invalid-native-effort" });
    assert.equal(invalid.turn.status, "failed");
    assert.ok(f.http.some(({ error }) => error?.code === "model_unavailable"));
    result.checks.push("invalid effort rejected before SDK inference");
    const raw = await f.host({ initialize: false });
    const early = await f.rpc(raw, "thread/read", { threadId: "uninitialized-fixture" }, { expectError: true });
    assert.match(early.message, /not initialized/i); await raw.stop();
    result.checks.push("before-initialize protocol rejection");
    // The host can initialize with configuration warnings so an editor can
    // repair them; config/read and thread/start must reject the broken TOML.
    f.setConfig('model = ["unfinished"\n');
    const broken = await f.host();
    const bad = await f.rpc(broken, "config/read", { includeLayers: true, cwd: f.workspace }, { expectError: true });
    assert.match(bad.message, /configuration|unclosed/i);
    await f.rpc(broken, "thread/start", { cwd: f.workspace, model: f.model, modelProvider: "ghcp", ephemeral: true }, { expectError: true });
    result.checks.push("malformed isolated TOML rejection");
    assert.equal(sessionAttempts, 0);
    result.passed = true;
  } catch (error) { result.error = { name: error.name, message: error.message }; }
  finally {
    await f.close();
    const state = f.state();
    if (!state.ownedFixtureRemoved || !state.allListenersClosed || !state.nativeProcessesClosed || state.cleanupErrors.length) result.passed = false;
    else result.checks.push("owned-process/listener/fixture cleanup");
    Object.assign(result, { finishedAt: new Date().toISOString(), inferenceAttempts: sessionAttempts,
      native: f.nativeEvidence(), sdk: f.sdk, http: f.http, state, processes: f.processes });
    writeJson(path.join(directory, "runtime-checks.json"), result, f.scrub);
  }
  return { result, directory };
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("Usage: node scripts/check-native-runtime.mjs [--output NEW_DIR]\nReal pinned Codex + synthetic local catalog. No Copilot authentication or model calls."); return 0;
  }
  if (args.length && (args.length !== 2 || args[0] !== "--output" || !args[1] || args[1].startsWith("-"))) throw new Error("Use --output NEW_DIR or no arguments.");
  const { result, directory } = await checkNativeRuntime({ output: args[1] });
  console.log(JSON.stringify({ report: path.join(directory, "runtime-checks.json"), passed: result.passed,
    realModelCalls: 0, inferenceAttempts: result.inferenceAttempts, checks: result.checks, error: result.error }, null, 2));
  return result.passed ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(redactor()(error.message)); process.exitCode = 2; });
}
