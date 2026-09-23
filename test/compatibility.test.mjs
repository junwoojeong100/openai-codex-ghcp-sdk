import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NATIVE_SCENARIO_CATALOG as C, NATIVE_SCENARIOS, NATIVE_MODELS, TOTAL_CASES, catalogFingerprint } from "../scripts/compatibility/catalog.mjs";
import { validateDesign } from "../scripts/compatibility/design.mjs";
import { parseArguments } from "../scripts/compatibility.mjs";
import { DRIVER_IDS, CaseExecutor } from "../scripts/compatibility/execute.mjs";
import { evaluate, commands, streamEvents, streamValid } from "../scripts/compatibility/oracles.mjs";
import { newReport, summarize, readCase, verifyReport } from "../scripts/compatibility/report.mjs";
import { pool, runCompatibility, freshDirectory } from "../scripts/compatibility/runner.mjs";
import { NativeHost } from "../scripts/compatibility/rpc.mjs";
import { Backend } from "../scripts/compatibility/backend.mjs";
import { safeApprovalCommand } from "../scripts/compatibility/fixtures.mjs";
import { supervise, workerEnvironment } from "../scripts/compatibility/supervisor.mjs";
import { ROOT, writeJson, sha, safeRead, scrubber, environment, bounded, run } from "../scripts/compatibility/util.mjs";
import { updateDocumentation } from "../scripts/compatibility/documentation.mjs";
import { CoreScriptedSdk } from "./helpers/core-scripted-sdk.mjs";
import { syntheticEvidence, writeSyntheticCase } from "./helpers/core-evidence.mjs";

function temporary(t) { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "core10-unit-"))); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const scenario = id => NATIVE_SCENARIOS.find(s => s.id === id);

test("one integrated suite has a versioned scenario catalog, six models and a derived full matrix without a global cutoff", () => {
  const plan = validateDesign();
  assert.equal(plan.scenarios, NATIVE_SCENARIOS.length); assert.equal(plan.models, 6); assert.equal(plan.totalCases, TOTAL_CASES); assert.equal(TOTAL_CASES, 108);
  assert.equal(plan.perModelSeconds, NATIVE_SCENARIOS.reduce((sum, s) => sum + s.timeoutSeconds, 0)); assert.equal(plan.scheduledCeilingEstimateSeconds, C.budget.preflightSeconds + 2 * plan.perModelSeconds);
  assert.equal(plan.budget.globalDeadline, false); assert.equal(plan.modelCalls, 0); assert.equal(plan.liveCompatibilityVerified, false);
  assert.equal(plan.coverage.measuredPercent, null); assert.equal(plan.coverage.targetPercent, 90);
  assert.equal(plan.coverage.namedCapabilities, C.coverage.included.length); assert.ok(!Object.hasOwn(C, "baseline"));
  assert.deepEqual(DRIVER_IDS, NATIVE_SCENARIOS.map(s => s.id));
  assert.ok(Object.isFrozen(C) && Object.isFrozen(C.scenarios[0].assertions));
  const copy = structuredClone(C); copy.scenarios[0].timeoutSeconds = 999;
  assert.throws(() => validateDesign(copy)); assert.notEqual(catalogFingerprint(copy), catalogFingerprint());
});

test("C05 requires the declared standalone in-process command and all three original tests", () => {
  assert.equal(C.id, "codex-ghcp-workflows-18-v6");
  assert.match(scenario("C05").prompt, /node --test --experimental-test-isolation=none/);
  for (const replacement of ["node --test", "node --test --experimental-test-isolation=none | cat", "echo 'node --test'"]) {
    const evidence = syntheticEvidence("C05");
    for (const row of evidence.native) if (row.message.params?.item?.type === "commandExecution") row.message.params.item.command = replacement;
    assert.equal(evaluate(scenario("C05"), evidence).find(check => check.id === "C05.1").passed, false);
  }
  const evidence = syntheticEvidence("C05");
  const last = evidence.native.findLast(row => row.message.params?.item?.type === "commandExecution");
  last.message.params.item.aggregatedOutput = "# tests 1\n# pass 1";
  assert.equal(evaluate(scenario("C05"), evidence).find(check => check.id === "C05.1").passed, false);
});
test("CLI requires deliberate execution, has no fast/subset mode and defaults to an offline plan", () => {
  assert.equal(parseArguments([]).mode, "plan");
  assert.equal(parseArguments(["--execute"]).mode, "execute");
  assert.equal(parseArguments(["--execute", "--output", "new-run"]).output, "new-run");
  for (const args of [["--models", "all"], ["--execute", "--plan"], ["--execute", "--models", "all"],
    ["--fast"], ["--suite", "full"], ["--verify"], ["--verify", "x", "--bin", "codex"], ["--concurrency", "99"],
    ["--execute", "--output"], ["--execute", "--execute"], ["--plan", "--output", "x"], ["--help", "--execute"]])
    assert.throws(() => parseArguments(args), undefined, args.join(" "));
});
for (const s of NATIVE_SCENARIOS) test(`${s.id} oracle requires genuine-shaped positive evidence and rejects empty/wrong-route/changed-state/unclean data`, () => {
  const e = syntheticEvidence(s.id);
  assert.deepEqual(evaluate(s, e).filter(c => !c.passed), []);
  assert.ok(evaluate(s, {}).every(c => !c.passed));
  for (const mutate of [e => { e.sdk[0].model = "wrong-model"; }, e => { e.after["user-dirty.txt"].hash = "bad"; },
    e => { e.resources.cleaned = false; }, e => { e.native = []; }, e => { e.transport = []; }]) {
    const bad = structuredClone(e); mutate(bad); assert.ok(evaluate(s, bad).some(c => !c.passed));
  }
});
test("scenario-specific tampering never passes", () => {
  const mutations = {
    C01: e => { e.cli.code = 1; }, C02: e => { e.skill.receipts = []; },
    C03: e => { e.native.findLast(r => r.message.params?.item?.type === "agentMessage").message.params.item.text = "{}"; },
    C04: e => { e.sdk.find(r => r.type === "assistant.message").data.toolRequests[0].arguments.input += "\ncorrupted"; },
    C05: e => { e.independentTest.code = 1; }, C06: e => { e.toolLedger[0].arguments.ids.reverse(); },
    C07: e => { e.approvals[0].decision = "accept"; }, C08: e => { e.resources.networkConnections = 1; },
    C09: e => { e.phases.filter(p => p.kind === "turn").at(-1).after = 0; },
    C10: e => { e.phases.find(p => p.kind === "resume").hostPid = 400; },
  };
  for (const [id, mutate] of Object.entries(mutations)) { const e = syntheticEvidence(id); mutate(e); assert.ok(evaluate(scenario(id), e).some(c => !c.passed), id); }
});
test("strict approval matching rejects substring, chaining, alternate paths and session-wide permissions", () => {
  const exact = '"/usr/bin/node" "/tmp/owned/write.mjs" "/tmp/owned/allow.txt"';
  assert.equal(safeApprovalCommand(exact, exact), true);
  assert.equal(safeApprovalCommand(`/bin/zsh -lc '${exact}'`, exact), true);
  for (const wrong of [`echo ${exact}`, `${exact}; rm victim`, exact.replace("allow.txt", "deny.txt"), "", undefined]) assert.equal(safeApprovalCommand(wrong, exact), false);
});
test("suite pass rates are not product coverage; no offline certification or reduced denominator", () => {
  const report = newReport({ runId: "unit" });
  Object.assign(report, { finishedAt: new Date().toISOString(), implementationUnchanged: true, userSettingsUnchanged: true });
  report.cases.forEach(r => r.status = "passed");
  assert.equal(summarize(report).fullMatrixPassed, true); assert.equal(report.cases.length, TOTAL_CASES);
  assert.ok(!Object.hasOwn(report, "baseline"));
  for (const status of C.acceptance.statuses.filter(s => s !== "passed")) {
    report.cases[0].status = status; const summary = summarize(report);
    assert.equal(summary.fullMatrixPassed, false); assert.equal(summary.perModel[0].total, NATIVE_SCENARIOS.length); assert.equal(summary.perModel[0].percent, (NATIVE_SCENARIOS.length - 1) / NATIVE_SCENARIOS.length * 100);
  }
  report.cases[0].status = "passed"; report.executionKind = "offline-self-test";
  assert.equal(summarize(report).fullMatrixPassed, false);
  assert.equal(summarize(report).measuredCoveragePercent, null); assert.equal(summarize(report).wholeProductCoverageClaim, false);
  assert.equal(summarize(report).nativeProviderParityMeasured, false);
  report.cases.pop(); assert.equal(summarize(report).fullMatrixPassed, false);
});
test("hashed evidence, cell ownership and recomputed assertions are required", t => {
  const dir = temporary(t), config = { directory: dir, scenarioId: "C01", provider: "ghcp", model: "gpt-6-astra", runId: "run1" };
  writeSyntheticCase(config);
  assert.equal(readCase(dir, config, "run1", catalogFingerprint(), "offline-self-test").manifest.status, "passed");
  assert.throws(() => readCase(dir, { ...config, model: "claude-opus-5.5" }, "run1"));
  assert.throws(() => readCase(dir, config, "other-run"));
  fs.appendFileSync(path.join(dir, "native.jsonl"), "tampered");
  assert.throws(() => readCase(dir, config, "run1", catalogFingerprint(), "offline-self-test"), /Changed artifact|strictly equal/);
  writeSyntheticCase(config, e => { e.cli.code = 2; });
  const manifest = JSON.parse(safeRead(path.join(dir, "result.json"))); manifest.status = "passed";
  writeJson(path.join(dir, "result.json"), manifest); assert.throws(() => readCase(dir, config, "run1", catalogFingerprint(), "offline-self-test"));
});
test("worker/native environment excludes actual keys, shell injection variables and user config", () => {
  const env = { PATH: "/bin", HOME: "/real", OPENAI_API_KEY: "sk-secret-value", GH_TOKEN: "ghp-secret-value", NODE_OPTIONS: "--require malicious", CODEX_HOME: "/real/.codex" };
  const native = environment(env, { home: "/isolated", codexHome: "/isolated/.codex", tmp: "/temporary", token: "local-token" });
  assert.equal(native.OPENAI_API_KEY, undefined); assert.equal(native.GH_TOKEN, undefined); assert.equal(native.NODE_OPTIONS, undefined);
  assert.equal(workerEnvironment(env).OPENAI_API_KEY, undefined); assert.equal(workerEnvironment(env).NODE_OPTIONS, undefined);
  assert.equal(scrubber(env)(`Authorization: Bearer ${env.OPENAI_API_KEY}`), "Authorization: Bearer [REDACTED]");
});
test("bounded waits reject cancellation and processes are actually terminated", async () => {
  const abort = new AbortController();
  setTimeout(() => abort.abort(new DOMException("fixture timeout", "TimeoutError")), 25);
  await assert.rejects(bounded(new Promise(() => {}), abort.signal), { name: "TimeoutError" });
  await assert.rejects(run(process.execPath, ["-e", "setInterval(()=>{},100)"], { signal: AbortSignal.timeout(40) }), { name: "TimeoutError" });
});
test("native RPC handles response races and denies unknown approval callbacks", async t => {
  const peer = fileURLToPath(new URL("./fixtures/core-rpc-peer.mjs", import.meta.url));
  const host = new NativeHost({ bin: process.execPath, args: [peer], env: { ...process.env, CORE_PEER_MODE: "normal" }, signal: AbortSignal.timeout(2000) });
  t.after(() => host.close()); await host.start();
  assert.equal((await host.turn("thread1", "hello")).status, "completed");
  const callback = await host.request("fixture/callback", {});
  assert.equal(callback.error.code, -32601);
});
test("native RPC fails on corrupt JSON rather than hanging or manufacturing a reply", async t => {
  const peer = fileURLToPath(new URL("./fixtures/core-rpc-peer.mjs", import.meta.url));
  const host = new NativeHost({ bin: process.execPath, args: [peer], env: { ...process.env, CORE_PEER_MODE: "bad-json" }, signal: AbortSignal.timeout(1000) });
  t.after(() => host.close()); await assert.rejects(host.start());
});
test("HTTP instrumentation does not alter Buffer parsing or Unicode on the production bridge", async t => {
  const transport = [], sdk = [], backend = new Backend({ provider: "ghcp", model: "gpt-6-astra", env: {}, token: "local-token",
    signal: AbortSignal.timeout(2000), transport, sdk, diagnostics: [], clientFactory: () => new CoreScriptedSdk("C09") });
  t.after(() => backend.close()); await backend.start();
  const body = Buffer.from(JSON.stringify({ model: "gpt-6-astra", input: "Remember N_01234567890123456789_한글 GREEN café 🙂" }));
  const result = await new Promise((resolve, reject) => {
    const r = http.request(`http://127.0.0.1:${backend.port}/v1/responses`, { method: "POST", headers: { authorization: "Bearer local-token", "content-type": "application/json" } }, res => {
      let data = ""; res.setEncoding("utf8"); res.on("data", s => data += s); res.on("end", () => resolve({ code: res.statusCode, data }));
    }); r.on("error", reject);
    for (let i = 0; i < body.length; i++) r.write(body.subarray(i, i + 1)); r.end();
  });
  assert.equal(result.code, 200, result.data); assert.ok(result.data.includes("한글"));
  assert.equal(transport[0].request.input, JSON.parse(body).input); assert.deepEqual(JSON.parse(transport[0].responseText), JSON.parse(result.data));
});
test("pool limits concurrent model lanes", async () => {
  let active = 0, peak = 0; const done = [];
  await pool([1, 2, 3, 4, 5, 6, 7], 4, async value => { peak = Math.max(peak, ++active); await new Promise(r => setTimeout(r, 5)); done.push(value); active--; });
  assert.equal(peak, 4); assert.equal(done.length, 7);
});
test("process-group timeout kills worker and descendant without touching unrelated processes", { skip: process.platform === "win32" }, async t => {
  const root = temporary(t), peer = fileURLToPath(new URL("./fixtures/core-worker-peer.mjs", import.meta.url));
  const receipt = await supervise({ directory: path.join(root, "evidence"), workRoot: path.join(root, "work"), timeoutMs: 400, mode: "hang" }, { workerFile: peer });
  assert.equal(receipt.killed, true); assert.equal(receipt.error.name, "TimeoutError"); assert.ok(receipt.durationMs < 1200);
});
test("fresh output directories reject overwrite and symlink parents", t => {
  const root = temporary(t); freshDirectory(path.join(root, "new")); assert.throws(() => freshDirectory(path.join(root, "new")));
  fs.symlinkSync(path.join(root, "new"), path.join(root, "alias")); assert.throws(() => freshDirectory(path.join(root, "alias", "child")), /symlink/);
});
test("full scheduler self-test records the whole current matrix but cannot certify live compatibility; reports verify", async t => {
  const root = temporary(t), calls = [];
  const workerSupervisor = async config => {
    calls.push(config);
    if (config.action === "preflight") writeJson(path.join(config.directory, "preflight.json"), { status: "passed", value: { models: NATIVE_MODELS.map(id => ({ id, available: true })) } });
    else writeSyntheticCase(config);
    return { code: 0, killed: false, processGroupGone: true, durationMs: 5 };
  };
  const { report, directory } = await runCompatibility({ output: path.join(root, "results"), workerSupervisor });
  assert.equal(calls.filter(c => c.action === "case").length, TOTAL_CASES);
  assert.equal(report.executionKind, "offline-self-test"); assert.equal(report.summary.fullMatrixPassed, false);
  assert.ok(report.cases.every(r => r.status === "passed"), report.error);
  assert.equal(verifyReport(path.join(directory, "report.json")).evidenceIntegrity, true);
  // Summaries are projections, not trusted substitutes for the case evidence.
  for (const mutate of [
    r => { r.cases[0].metrics.toolCalls += 1; },
    r => { r.cases[0].failedChecks = ["fabricated-failure"]; },
    r => { r.cases.pop(); },
  ]) {
    const bad = structuredClone(report); mutate(bad);
    writeJson(path.join(directory, "report.json"), bad);
    assert.throws(() => verifyReport(path.join(directory, "report.json")));
  }
  writeJson(path.join(directory, "report.json"), report);
  assert.equal(verifyReport(path.join(directory, "report.json")).evidenceIntegrity, true);
});
test("failed or timed-out cases do not skip the remaining matrix or retry", async t => {
  const root = temporary(t), calls = [];
  const workerSupervisor = async config => {
    if (config.action === "preflight") writeJson(path.join(config.directory, "preflight.json"), { status: "passed", value: { models: NATIVE_MODELS.map(id => ({ id, available: true })) } });
    else {
      calls.push(`${config.model}/${config.scenarioId}`);
      if (config.scenarioId === "C02") return { code: null, killed: true, processGroupGone: true, durationMs: 5, error: { name: "TimeoutError", message: "synthetic per-case timeout" } };
      writeSyntheticCase(config, config.scenarioId === "C01" ? e => { e.cli.code = 1; } : undefined);
    }
    return { code: 0, killed: false, processGroupGone: true, durationMs: 5 };
  };
  const { report, directory } = await runCompatibility({ output: path.join(root, "results"), workerSupervisor });
  assert.equal(calls.length, TOTAL_CASES); assert.equal(new Set(calls).size, TOTAL_CASES);
  assert.equal(report.cases.filter(r => r.status === "failed").length, NATIVE_MODELS.length);
  assert.equal(report.cases.filter(r => r.status === "timed-out").length, NATIVE_MODELS.length);
  assert.equal(report.cases.filter(r => r.status === "passed").length, TOTAL_CASES - 2 * NATIVE_MODELS.length);
  assert.equal(report.cases.length, TOTAL_CASES); assert.equal(report.summary.fullMatrixPassed, false);
  assert.equal(verifyReport(path.join(directory, "report.json")).evidenceIntegrity, true);
});
test("unavailable exact models remain as one blocked cell per current scenario without fallback", async t => {
  const root = temporary(t), called = [];
  const unavailable = NATIVE_MODELS[1];
  const workerSupervisor = async config => {
    if (config.action === "preflight") writeJson(path.join(config.directory, "preflight.json"), { status: "passed", value: { models: NATIVE_MODELS.map(id => ({ id, available: id !== unavailable })) } });
    else { called.push(config.model); writeSyntheticCase(config); }
    return { code: 0, killed: false, processGroupGone: true, durationMs: 5 };
  };
  const { report } = await runCompatibility({ output: path.join(root, "results"), workerSupervisor });
  assert.equal(called.length, TOTAL_CASES - NATIVE_SCENARIOS.length); assert.ok(!called.includes(unavailable));
  assert.equal(report.cases.filter(r => r.status === "blocked").length, NATIVE_SCENARIOS.length); assert.equal(report.summary.totalCases, TOTAL_CASES);
});
test("user cancellation stops new cases, preserves incomplete cells and cannot certify compatibility", async t => {
  const root = temporary(t), controller = new AbortController(); let cases = 0;
  const workerSupervisor = async config => {
    if (config.action === "preflight") writeJson(path.join(config.directory, "preflight.json"), { status: "passed", value: { models: NATIVE_MODELS.map(id => ({ id, available: true })) } });
    else { cases++; controller.abort(new DOMException("cancelled", "AbortError")); }
    return { code: 0, killed: false, processGroupGone: true, durationMs: 5 };
  };
  const { report } = await runCompatibility({ output: path.join(root, "results"), signal: controller.signal, workerSupervisor });
  assert.equal(cases, 1); assert.equal(report.interrupted, true); assert.equal(report.cases.length, TOTAL_CASES);
  assert.equal(report.summary.fullMatrixPassed, false); assert.ok(report.cases.every(r => r.status === "not-run"));
});
test("scenario documentation is generated from the contract and local links resolve", () => {
  updateDocumentation({ check: true });
  for (const file of ["README.md", "README_KO.md", "docs/NATIVE_SCENARIOS.md", "docs/NATIVE_SCENARIOS_KO.md", "docs/COMPATIBILITY_TESTING.md", "docs/COMPATIBILITY_TESTING_KO.md"]) {
    const full = path.join(ROOT, file);
    for (const match of fs.readFileSync(full, "utf8").matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(full), target)), `${file}: ${target}`);
    }
  }
});

test("preflight locates the actual SDK version through its CJS/ESM entry layout", async () => {
  const { installedSdkVersion } = await import("../scripts/compatibility/preflight.mjs");
  assert.equal(installedSdkVersion(), C.versions.copilotSdk);
});

test("verification records the runtime environment without credentials or proxy addresses", async () => {
  const { verificationEnvironment } = await import("../scripts/compatibility/preflight.mjs");
  const plain = verificationEnvironment({});
  assert.equal(plain.platform, process.platform);
  assert.equal(plain.architecture, process.arch);
  assert.equal(plain.node, process.version);
  assert.equal(plain.proxyConfigured, false);
  assert.equal(plain.ci, false);
  assert.ok(plain.cpuCount > 0 && plain.totalMemoryBytes > 0);
  const configured = verificationEnvironment({ CI: "1", HTTPS_PROXY: "https://private-user:private-token@private-host:1234",
    GITHUB_TOKEN: "private-credential", HOME: "/private-home" });
  assert.equal(configured.proxyConfigured, true);
  assert.equal(configured.ci, true);
  assert.doesNotMatch(JSON.stringify(configured), /private-/);
});
test("retired provider path cannot be used and subset injection is rejected", async () => {
  assert.throws(() => new Backend({ provider: "openai" }), /GHCP/);
  await assert.rejects(runCompatibility({ models: ["gpt-6-astra"] }), /complete current scenario matrix/);
});

test("command output is recovered only from correlated native tool result IDs", () => {
  const e = syntheticEvidence("C03"), cmd = e.native.find(r => r.message.params?.item?.type === "commandExecution").message.params.item;
  cmd.aggregatedOutput = "tail without nonce";
  e.transport[0].request.input = [{ type: "function_call_output", call_id: "wrong-call", output: e.fixture.nonce }];
  assert.equal(evaluate(scenario("C03"), e).find(c => c.id === "C03.1").passed, false);
  e.transport[0].request.input[0].call_id = cmd.id;
  assert.equal(evaluate(scenario("C03"), e).find(c => c.id === "C03.1").passed, true);
});
test("stream integrity rejects missing final text, altered delta, duplicate sequence and unmatched item", () => {
  const original = syntheticEvidence("C01").transport[0]; assert.equal(streamValid(original), true);
  for (const modify of [events => { events[1].delta += "bad"; }, events => { events.splice(2, 1); },
    events => { events[1].sequence_number = 0; }, events => { events[1].item_id = "wrong"; }]) {
    const events = streamEvents(original); modify(events);
    const row = { ...original, responseText: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join("") };
    assert.equal(streamValid(row), false);
  }
});
test("missing Skill or MCP subworkflow cannot be compensated by correct answer text", () => {
  for (const [id, drop] of [["C02", e => { e.skill.receipts = []; }], ["C02", e => { e.native = e.native.filter(r => r.message.method !== "turn/start"); }],
    ["C06", e => { e.mcp.ledger = []; }], ["C06", e => { e.native = e.native.filter(r => r.message.params?.item?.type !== "mcpToolCall"); }]]) {
    const e = syntheticEvidence(id); drop(e); assert.equal(evaluate(scenario(id), e).find(c => c.id === `${id}.2`).passed, false);
  }
});
