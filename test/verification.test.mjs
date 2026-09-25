import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SUPPORTED_MODEL_IDS, modelCatalog, resolveContextTier } from "../src/model-map.mjs";
import { parseArguments } from "../scripts/verify.mjs";
import { CATALOG as C, SCENARIOS, catalogHash } from "../scripts/verification/catalog.mjs";
import { evaluate, marker, recoveredTransportErrors, runScenario, sessionOptions, switchSource, TEST_COMMAND } from "../scripts/verification/scenarios.mjs";
import { TuiSession, isExpectedTitleRejection, pickerRows, readRollouts } from "../scripts/verification/session.mjs";
import { completionOutputTypes } from "../scripts/verification/observer.mjs";
import { matrix, summarize, markdown, verifyReport } from "../scripts/verification/report.mjs";
import { snapshotSources } from "../scripts/verification/source.mjs";
import { NativeHost } from "../scripts/verification/rpc.mjs";
import { workerEnvironment } from "../scripts/verification/supervisor.mjs";
import { caseSections } from "../scripts/verification/report-format.mjs";
import { sha, writeJson, environment, scrubber, bounded, run, freshDirectory, hasUnmaskedFinalCommand, tree } from "../scripts/verification/util.mjs";

const seed = "0a1b2c3d", scenario = id => SCENARIOS.find(row => row.id === id);
const temp = t => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "essential-unit-"))); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const info = id => ({ id, capabilities: { limits: { max_context_window_tokens: 200000, max_prompt_tokens: 180000 } } });
const reply = value => ({ expected: value, observed: [value] });

function passingFacts(id, model = "gpt-6-astra") {
  const m = n => marker(seed, n), selected = info(model), tier = resolveContextTier(selected);
  const launch = { cleanup: { childReaped: true, processGroupGone: true }, childExit: { code: 0 } };
  const facts = { seed, launchModel: model, answers: [reply(m(1))], before: {}, error: null, mcpLedger: [],
    observer: { sdk: [], http: [{ method: "POST", path: "/v1/responses", status: 200, contentType: "text/event-stream", finished: true, terminal: "response.completed", startedAt: 1000 },
      { method: "GET", path: "/v1/models", status: 200, body: modelCatalog([selected]) },
      { method: "GET", path: "/health", status: 200, body: { ready: true, protocol: "responses", turnWatchdog: C.watchdog } }],
      answers: [{ content: m(1), at: 1050 }], diagnostics: [] },
    evidence: { workspace: {}, sampleErrors: [], samples: { count: 2, maxRuntimes: 1, maxRuntimeMcp: 0, maxCodexMcpFixture: 1 },
      launches: [launch], leftovers: [], catalogLeft: [], rollout: { errors: [], toolCalls: [], commands: [], turnContexts: [{ model, effort: "low" }], compactions: 0 } } };
  const session = (activeModel, sid, at, effort = "low") => {
    facts.observer.sdk.push({ type: "session.created", sessionId: sid, model: activeModel, contextTier: tier, effort, at, toolCount: 10 },
      { type: "session.model_verified", sessionId: sid, operation: "created", model: activeModel, requestedModel: activeModel, contextTier: tier, requestedTier: tier },
      { type: "session.send", sessionId: sid, at }, { type: "assistant.usage", sessionId: sid, model: activeModel, at },
      { type: "models.list", models: [info(activeModel)] });
  };
  session(model, "one", 1000);
  if (id === "V01") {
    facts.cli = { exitCode: 0, events: [{ type: "turn.completed" }, { type: "item.completed", item: { type: "agent_message", text: m(4) } }] };
    facts.picker = SUPPORTED_MODEL_IDS.map((value, i) => ({ id: value, number: i + 1, isCurrent: value === model }));
    facts.answers = [reply(`${m(1)} 안녕 café`), reply(m(2))]; facts.newAt = 1100;
    session(model, "two", 1200);
  }
  if (id === "V02") {
    facts.before = { "discount.mjs": { hash: "before" }, "discount.test.mjs": { hash: "tests" } };
    facts.evidence.workspace = { "discount.mjs": { hash: "after" }, "discount.test.mjs": { hash: "tests" } };
    facts.evidence.rollout.toolCalls = [{ name: "exec_command" }, { name: "apply_patch" }];
    facts.observer.sdk.push({ type: "external_tool.requested" });
    facts.evidence.rollout.commands = [{ command: TEST_COMMAND, exitCode: 1, output: "# tests 3\n# fail 2" }, { command: TEST_COMMAND, exitCode: 0, output: "# tests 3\n# pass 3" }];
    facts.answers = [reply(m(2)), reply(m(1))];
    facts.baseline = { workspace: structuredClone(facts.before), rollout: {
      commands: [structuredClone(facts.evidence.rollout.commands[0])], toolCalls: [{ name: "exec_command" }], patchApplies: 0, errors: [],
    } };
  }
  if (id === "V03") {
    facts.answers = [reply(m(1)), reply(m(1))]; facts.evidence.rollout.toolCalls = [{ name: "fixture.lookup" }];
    facts.mcpLedger = ["missing", "selected"].map(key => ({ event: "request", method: "tools/call", params: { name: "lookup", arguments: { key } } }));
    facts.mcpLedger.push({ event: "response", method: "tools/call", result: { isError: true } });
  }
  if (id === "V04") {
    facts.launchModel = switchSource(model); facts.observer.sdk = [];
    facts.observer.http.push({ method: "GET", path: "/v1/models", status: 200, body: modelCatalog([info(facts.launchModel)]) });
    session(facts.launchModel, "one", 1000); session(model, "two", 1200, model === "claude-haiku-4.5" ? null : "high");
    facts.switchedAt = 1100; facts.modelChangedLine = `Model changed to ${model}`;
    facts.effortPopup = model !== "claude-haiku-4.5"; facts.effortOptions = ["Low", "High"];
    facts.evidence.rollout.turnContexts = [{ model, effort: facts.effortPopup ? "high" : null }];
    facts.answers = [reply(m(1)), reply(m(2))];
  }
  if (id === "V05") {
    facts.escapeAt = 1200; facts.interrupted = true; facts.inFlightSessionId = "one"; facts.inFlightSendAt = 1000;
    facts.observer.sdk.push({ type: "session.abort", sessionId: "one", at: 1200 });
    facts.observer.http.push({ method: "POST", path: "/v1/responses", status: 200, contentType: "text/event-stream", finished: false, startedAt: 1100 });
  }
  if (id === "V06") {
    session(model, "two", 1200); facts.evidence.launches.push(structuredClone(launch));
    facts.compacted = true; facts.quitExited = true; facts.relaunched = true; facts.evidence.rollout.compactions = 1;
    facts.answers = [reply(m(2)), reply(m(1)), reply(m(1))];
  }
  return facts;
}
const failures = (id, facts, model = "gpt-6-astra") => evaluate(scenario(id), model, facts).filter(row => !row.passed);
const finished = () => ({ schemaVersion: C.schemaVersion, catalogId: C.id, catalogHash: catalogHash(), runId: "unit", executionKind: "live",
  startedAt: "start", finishedAt: "finish", implementationUnchanged: true, frozenSourceUnchanged: true, userSettingsUnchanged: true,
  cases: matrix().map(row => ({ ...row, status: "passed" })) });

test("one version has six essential cases on each of the six models and no alternate score", () => {
  assert.equal(C.id, "codex-ghcp-essential-v1"); assert.equal(C.totalCases, 36);
  assert.equal(SCENARIOS.length, 6); assert.deepEqual(C.models, SUPPORTED_MODEL_IDS);
  assert.equal(C.automaticCaseRetries, 0); assert.ok(Object.isFrozen(C.scenarios));
  assert.equal(matrix().length, 36); assert.match(catalogHash(), /^[a-f0-9]{64}$/);
  assert.equal(summarize(finished()).fullMatrixPassed, true);
  assert.ok(!Object.hasOwn(summarize(finished()), "thresholdMet"));
  for (const change of [{ finishedAt: null }, { interrupted: true }, { implementationUnchanged: false }, { frozenSourceUnchanged: false },
    { userSettingsUnchanged: false }, { executionKind: "offline-self-test" }, { error: "failure" }, { cases: matrix().slice(1) }]) {
    assert.equal(summarize({ ...finished(), ...change }).fullMatrixPassed, false);
  }
  for (const status of ["failed", "blocked", "timed-out", "not-run", "unknown"]) {
    const report = finished(); report.cases.at(-1).status = status;
    assert.equal(summarize(report).fullMatrixPassed, false, status);
  }
});

test("plans are offline and legacy profiles, subsets and retry options are rejected", () => {
  assert.deepEqual(parseArguments([]), { mode: "plan" });
  assert.deepEqual(parseArguments(["--execute", "--output", "new"]), { mode: "execute", output: "new" });
  assert.deepEqual(parseArguments(["--verify", "report.json"]), { mode: "verify", file: "report.json" });
  for (const args of [["--profile", "v5"], ["--models", "gpt-6-astra"], ["--smoke"], ["--retry"], ["--execute", "--plan"],
    ["--execute", "--execute"], ["--output", "x"], ["--verify"], ["--help", "--execute"]]) assert.throws(() => parseArguments(args));
  const result = spawnSync(process.execPath, ["scripts/verify.mjs", "--plan"], { encoding: "utf8", timeout: 5000, env: { ...process.env, CODEX_BIN: "/not-installed", COPILOT_HOME: "/not-present" } });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /36 cases/);
});

for (const id of SCENARIOS.map(row => row.id)) test(`${id}: essential checks require actual outcomes and common safety evidence`, () => {
  assert.deepEqual(failures(id, passingFacts(id)), []);
  for (const mutate of [facts => { facts.error = { message: "run failed" }; }, facts => { facts.evidence.leftovers = [123]; },
    facts => { facts.evidence.workspace["user-unexpected.txt"] = { hash: "changed" }; },
    facts => { facts.observer.sdk.find(row => row.type === "assistant.usage").model = "other"; },
    facts => { facts.observer.http[0].terminal = "response.failed"; },
    facts => { facts.evidence.samples.maxRuntimeMcp = 1; }, facts => { facts.evidence.rollout.errors = ["Invalid JSONL"]; }]) {
    const facts = passingFacts(id); mutate(facts); assert.ok(failures(id, facts).length > 0);
  }
});

test("coding rejects masked exits, weakened tests and fake success summaries", () => {
  const repeated = passingFacts("V02");
  repeated.evidence.rollout.commands.push(structuredClone(repeated.evidence.rollout.commands.at(-1)));
  assert.deepEqual(failures("V02", repeated), [], "An extra genuine test run is not an integration failure");
  for (const mutate of [facts => { facts.evidence.rollout.commands[0].exitCode = 0; },
    facts => { facts.evidence.rollout.commands[0].output = "File not found"; },
    facts => { facts.evidence.rollout.commands[1].command += " | cat"; }, facts => { facts.evidence.rollout.commands[1].output = "# pass 1"; },
    facts => { facts.evidence.workspace["discount.test.mjs"].hash = "weakened"; }, facts => { facts.evidence.rollout.toolCalls = [{ name: "exec_command" }]; }]) {
    const facts = passingFacts("V02"); mutate(facts); assert.ok(failures("V02", facts).length);
  }
});

test("coding requires the unchanged baseline checkpoint and its exact native prefix before the repair", () => {
  for (const mutate of [facts => { delete facts.baseline; },
    facts => { facts.baseline.workspace["discount.mjs"].hash = "premature-edit"; },
    facts => { facts.baseline.rollout.patchApplies = 1; },
    facts => { facts.baseline.rollout.toolCalls.push({ name: "apply_patch" }); },
    facts => { delete facts.baseline.rollout.toolCalls; },
    facts => { facts.baseline.rollout.errors.push("Invalid native rollout JSONL"); },
    facts => { facts.baseline.rollout.commands = []; },
    facts => { facts.baseline.rollout.commands[0].exitCode = 0; },
    facts => { facts.baseline.rollout.commands[0].output = "# tests 3\n# fail 0"; },
    facts => { facts.baseline.rollout.commands[0].command += "; true"; },
    facts => { facts.answers.shift(); },
    facts => { facts.evidence.rollout.commands.reverse(); },
    facts => { facts.evidence.rollout.commands.shift(); },
    facts => { facts.evidence.rollout.toolCalls.unshift({ name: "apply_patch" }); },
    facts => { facts.evidence.launches.push(structuredClone(facts.evidence.launches[0])); }]) {
    const facts = passingFacts("V02"); mutate(facts);
    assert.ok(failures("V02", facts).some(check => check.id.startsWith("V02.")));
  }
});

for (const mode of ["valid", "missing-test", "zero-exit", "masked-exit", "wrong-summary", "early-edit", "early-patch", "malformed-rollout"]) {
  test(`coding sends the repair request only after real baseline evidence (${mode})`, async t => {
    const dir = temp(t), workspace = path.join(dir, "workspace"), codexHome = path.join(dir, "codex");
    fs.mkdirSync(workspace); fs.mkdirSync(path.join(codexHome, "sessions"), { recursive: true });
    const records = [], answers = [], prompts = [], facts = { answers: [] };
    const command = (cmd, exitCode, output) => {
      const callId = `call-${records.length}`;
      records.push({ type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: callId, arguments: JSON.stringify({ cmd }) } },
        { type: "event_msg", payload: { type: "exec_command_end", call_id: callId, command: ["/bin/zsh", "-c", cmd], exit_code: exitCode, aggregated_output: output } });
    };
    const session = { workspace, codexHome, async launch() {}, observer: () => ({ answers }),
      async ask(prompt, expected) {
        prompts.push(prompt);
        if (prompts.length === 1) {
          assert.match(prompt, /^Read-only baseline:/);
          assert.match(prompt, /do not edit any file or fix the bug/);
          assert.ok(!prompt.includes(marker(seed, 1)), "the hidden file value is not supplied in the request");
          if (mode !== "missing-test") command(mode === "masked-exit" ? `${TEST_COMMAND}; true` : TEST_COMMAND,
            mode === "zero-exit" || mode === "masked-exit" ? 0 : 1, mode === "wrong-summary" ? "No tests found" : "# tests 3\n# fail 2");
          if (mode === "early-edit") fs.appendFileSync(path.join(workspace, "discount.mjs"), "\n// premature edit\n");
          if (mode === "early-patch") records.push({ type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", input: "synthetic early patch" } });
        } else {
          assert.equal(mode, "valid", "invalid baseline must not get a corrective request");
          assert.match(prompt, /^Repair the verified failure:/);
          assert.deepEqual(facts.baseline.workspace, facts.before);
          assert.equal(facts.baseline.rollout.commands[0].exitCode, 1);
          assert.equal(facts.baseline.rollout.patchApplies, 0);
          fs.writeFileSync(path.join(workspace, "discount.mjs"), "export function discount(price, percent) { return price * (100 - percent) / 100; }\n");
          records.push({ type: "response_item", payload: { type: "custom_tool_call", name: "apply_patch", input: "synthetic repair" } },
            { type: "event_msg", payload: { type: "patch_apply_end", success: true } });
          command(TEST_COMMAND, 0, "# tests 3\n# pass 3\n# fail 0");
        }
        fs.writeFileSync(path.join(codexHome, "sessions/rollout-code.jsonl"), records.map(row => JSON.stringify(row)).join("\n")
          + (mode === "malformed-rollout" ? "\n{incomplete" : "") + "\n");
        answers.push({ content: expected });
      },
    };
    const execution = runScenario(scenario("V02"), session, { model: "gpt-6-astra", seed, facts });
    if (mode === "valid") {
      await execution;
      assert.equal(prompts.length, 2);
      assert.deepEqual(facts.answers.map(row => row.expected), [marker(seed, 2), marker(seed, 1)]);
      assert.deepEqual(readRollouts(codexHome).commands.map(row => row.exitCode), [1, 0]);
      assert.notDeepEqual(tree(workspace), facts.baseline.workspace);
    } else {
      await assert.rejects(execution, /V02 baseline was not verified/);
      assert.equal(prompts.length, 1);
      assert.ok(facts.baseline, "retain the rejected baseline instead of hiding its evidence");
    }
  });
}

test("read-only preparation may precede the final test command without hiding its real exit", () => {
  for (const body of [TEST_COMMAND, `cat sample.txt discount.mjs && ${TEST_COMMAND}`,
    `cat sample.txt; echo ---; cat discount.mjs; echo ---; ${TEST_COMMAND}`,
    `cat sample.txt && printf '\\n--- discount.mjs ---\\n' && cat discount.mjs && printf '\\n--- initial test run ---\\n' && ${TEST_COMMAND}`,
    `cat 'sample.txt' "discount.mjs";\n${TEST_COMMAND}`]) {
    for (const command of [body, `/bin/zsh -lc ${JSON.stringify(body)}`]) {
      assert.equal(hasUnmaskedFinalCommand(command, TEST_COMMAND), true, command);
      const facts = passingFacts("V02"); facts.evidence.rollout.commands[0].command = command;
      facts.baseline.rollout.commands[0].command = command;
      assert.deepEqual(failures("V02", facts), []);
    }
  }
  for (const body of [`echo '${TEST_COMMAND}'`, `echo 'cat sample.txt; ${TEST_COMMAND}'`,
    `${TEST_COMMAND} | cat`, `${TEST_COMMAND}; true`, `${TEST_COMMAND} || true`,
    `cat sample.txt || ${TEST_COMMAND}`, `node() { echo fake; }; ${TEST_COMMAND}`,
    `cat sample.txt && ${TEST_COMMAND} &&`, `cat sample.txt; ; ${TEST_COMMAND}`,
    `PATH=/untrusted; ${TEST_COMMAND}`, `source untrusted; ${TEST_COMMAND}`,
    `printf -v PATH /untrusted; ${TEST_COMMAND}`, `printf '-v' PATH /untrusted; ${TEST_COMMAND}`,
    `printf -\\v PATH /untrusted; ${TEST_COMMAND}`,
    `cat $(touch ignored); ${TEST_COMMAND}`, `echo \\; ${TEST_COMMAND}`, `echo "unclosed; ${TEST_COMMAND}`]) {
    assert.equal(hasUnmaskedFinalCommand(`/bin/zsh -lc ${JSON.stringify(body)}`, TEST_COMMAND), false, body);
  }
});

test("MCP errors, model switches and fresh recall cannot be replaced with prose or stale markers", () => {
  const cli = passingFacts("V01"); cli.cli.events = []; assert.ok(failures("V01", cli).some(row => row.id === "V01.cli"));
  const mcp = passingFacts("V03"); mcp.mcpLedger.reverse(); assert.ok(failures("V03", mcp).length);
  const recall = passingFacts("V06"); recall.answers.at(-1).observed = ["I cannot answer"]; assert.ok(failures("V06", recall).length);
  const switched = passingFacts("V04"); switched.evidence.rollout.turnContexts[0].model = switchSource("gpt-6-astra"); assert.ok(failures("V04", switched).length);
  assert.deepEqual(failures("V04", passingFacts("V04", "claude-haiku-4.5"), "claude-haiku-4.5"), []);
  const cleanup = passingFacts("V06"); cleanup.error = { message: "unexpected answer" };
  assert.equal(evaluate(scenario("V06"), "gpt-6-astra", cleanup).find(row => row.id === "cleanup").passed, true);
  assert.ok(failures("V06", cleanup).some(row => row.id === "execution"));
});

test("interruption waits for a real SDK send, not the TUI's queued working indicator", async t => {
  let sent = false, escaped = false;
  const answers = [], sdk = [], facts = { answers: [] };
  const session = { workspace: temp(t), launch: async () => {}, submit: async () => {},
    observer: () => ({ sdk, answers }), ready: text => text === "Conversation interrupted",
    async waitFor(label, predicate) {
      if (label === "in-flight") {
        assert.equal(predicate("Working"), false, "A queued prompt has not reached the SDK yet");
        sdk.push({ type: "session.send", sessionId: "active-session", at: Date.now() }); sent = true;
        assert.equal(predicate("Working"), true);
      } else { assert.equal(label, "interrupted"); assert.ok(escaped); assert.equal(predicate("Conversation interrupted"), true); }
    },
    async escape() { assert.ok(sent); escaped = true; },
    async ask(_prompt, expected) { answers.push({ content: expected }); },
  };
  await runScenario(scenario("V05"), session, { model: "gpt-6-astra", seed, facts });
  assert.equal(facts.inFlightSessionId, "active-session");
  assert.ok(facts.inFlightSendAt < facts.escapeAt);
  for (const mutate of [candidate => { delete candidate.inFlightSessionId; },
    candidate => { candidate.inFlightSendAt = candidate.escapeAt + 1; },
    candidate => { candidate.observer.sdk.find(row => row.type === "session.abort").sessionId = "unrelated"; }]) {
    const candidate = passingFacts("V05"); mutate(candidate);
    assert.ok(failures("V05", candidate).some(check => check.id === "V05.interrupt"));
  }
});

test("only the exact unsupported automatic title is excluded from supported-response failures", () => {
  const title = { method: "POST", path: "/v1/responses", status: 400, contentType: "application/json", finished: true,
    requestShape: { stream: true, toolCount: 0, format: { type: "json_schema", strict: true, name: "codex_output_schema",
      schema: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 36 } }, required: ["title"], additionalProperties: false } } },
    error: { code: "invalid_request_error", message: "Structured output is not supported; use plain text output." } };
  const facts = passingFacts("V01"); facts.observer.http.push(title);
  assert.equal(isExpectedTitleRejection(title), true); assert.deepEqual(failures("V01", facts), []);
  for (const change of [{ status: 503 }, { terminal: "response.failed" }, { finished: false }, { error: { message: "another error" } }]) {
    const changed = { ...title, ...change }; assert.equal(isExpectedTitleRejection(changed), false);
    const candidate = passingFacts("V01"); candidate.observer.http.push(changed); assert.ok(failures("V01", candidate).length);
  }
});

test("a transport error is recovered only with same-session cleanup and same-response completion receipts", () => {
  const facts = passingFacts("V01"), sdk = facts.observer.sdk, diagnostics = facts.observer.diagnostics;
  sdk.push({ type: "session.error", sessionId: "one", errorType: "query", at: 1010 },
    ...["session.abort", "session.disconnect", "client.deleteSession"].map(type => ({ type, sessionId: "one", at: 1020 })));
  diagnostics.push({ event: "bridge.model_call_failed", sessionId: "one", kind: "transport", statusCode: null, at: 1005 },
    { event: "bridge.turn_transport_failed", sessionId: "one", recoverySafe: true, reason: null, at: 1010 },
    { event: "bridge.turn_recovering", sessionId: "one", cause: "copilot_transport_error", requestId: "resp_one", attempt: 1, at: 1030 },
    { event: "bridge.turn_recovered", requestId: "resp_one", attempts: 1, at: 1040 });
  Object.assign(facts.observer.http[0], { responseId: "resp_one", finishedAt: 1050 });
  assert.equal(recoveredTransportErrors(facts), 1);
  assert.deepEqual(failures("V01", facts), []);
  for (const mutate of [
    f => { f.observer.sdk.find(row => row.type === "session.error").errorType = "quota"; },
    f => { f.observer.sdk.find(row => row.type === "session.error").errorCode = "content_filter"; },
    f => { f.observer.sdk.find(row => row.type === "session.error").statusCode = 503; },
    f => { f.observer.sdk.find(row => row.type === "session.disconnect").sessionId = "other"; },
    f => { f.observer.diagnostics[1].recoverySafe = false; },
    f => { f.observer.diagnostics[2].attempt = 2; },
    f => { f.observer.diagnostics[2].at = 999; },
    f => { f.observer.diagnostics[3].requestId = "unrelated"; },
    f => { f.observer.http[0].responseId = "unrelated"; },
    f => { f.observer.http[0].terminal = "response.failed"; },
    f => { f.observer.sdk.push({ type: "session.error", sessionId: "one", errorType: "query", at: 1011 }); },
  ]) {
    const changed = structuredClone(facts); mutate(changed);
    assert.equal(recoveredTransportErrors(changed), 0);
    assert.ok(failures("V01", changed).some(row => row.id === "upstream"));
  }
});

test("report verification recomputes facts, failures, scores, ownership and source hashes", t => {
  const dir = temp(t), sources = snapshotSources(dir), report = finished();
  report.implementationHash = sha(JSON.stringify(sources));
  writeJson(path.join(dir, "freeze.json"), { runId: report.runId, catalog: C, catalogHash: report.catalogHash, sources });
  for (const row of report.cases) {
    const facts = passingFacts(row.scenarioId, row.model), checks = evaluate(scenario(row.scenarioId), row.model, facts);
    assert.ok(checks.every(check => check.passed));
    const relative = `cases/${row.model}/${row.scenarioId}`, caseDir = path.join(dir, relative);
    if (row === report.cases[0]) {
      const mediaDir = path.join(caseDir, "launch-1"); fs.mkdirSync(mediaDir, { recursive: true });
      const artifacts = ["terminal-browser.png", "terminal-browser.webm"].map(file => {
        const bytes = Buffer.from(`synthetic ${file}`); fs.writeFileSync(path.join(mediaDir, file), bytes);
        return { file, bytes: bytes.length, sha256: sha(bytes) };
      });
      Object.assign(facts.evidence.launches[0], { label: "launch-1", media: { screenshot: artifacts[0], video: artifacts[1] } });
    }
    writeJson(path.join(caseDir, "facts.json"), facts);
    const result = { runId: report.runId, catalogHash: report.catalogHash, implementationHash: report.implementationHash, executionKind: "live",
      model: row.model, scenarioId: row.scenarioId, seed, checks, status: "passed", error: null, auxiliaryTitleRejections: 0,
      recoveredTransportErrors: 0, catalogRecoveries: 0,
      factsHash: sha(fs.readFileSync(path.join(caseDir, "facts.json"))) };
    writeJson(path.join(caseDir, "result.json"), result);
    Object.assign(row, { seed, artifactPath: relative, observedStatus: "passed", failedChecks: [], error: null, auxiliaryTitleRejections: 0,
      recoveredTransportErrors: 0, catalogRecoveries: 0,
      supervisor: { code: 0, killed: false, error: null, processGroupGone: true }, resultHash: sha(fs.readFileSync(path.join(caseDir, "result.json"))) });
    writeJson(path.join(caseDir, "supervisor.json"), row.supervisor);
  }
  report.summary = summarize(report);
  const file = path.join(dir, "report.json"), save = value => writeJson(file, value); save(report);
  assert.equal(verifyReport(file).fullMatrixPassed, true);
  for (const mutate of [r => { r.summary.passed = 35; }, r => { r.cases[0].failedChecks = ["invented"]; },
    r => { r.cases[0].seed = "foreign"; }, r => { r.cases[0].artifactPath = "../other"; },
    r => { r.cases[0].recoveredTransportErrors = 1; }, r => { r.cases[0].catalogRecoveries = 1; },
    r => { r.cases.pop(); }, r => { r.implementationHash = "old"; }, r => { r.catalogId = "codex-ghcp-tui-12-v3"; }]) {
    const changed = structuredClone(report); mutate(changed); save(changed); assert.throws(() => verifyReport(file));
  }
  save(report);
  const video = path.join(dir, report.cases[0].artifactPath, "launch-1/terminal-browser.webm");
  const original = fs.readFileSync(video);
  fs.writeFileSync(video, Buffer.alloc(original.length));
  assert.throws(() => verifyReport(file), /Media hash mismatch/);
  fs.writeFileSync(video, original);
  fs.appendFileSync(path.join(dir, report.cases[0].artifactPath, "facts.json"), " ");
  assert.throws(() => verifyReport(file), /Facts hash mismatch/);
});

test("Markdown has one verdict, keeps every failure, and does not confuse percentage with pass", () => {
  const report = finished(); report.cases.at(-1).status = "failed";
  Object.assign(report.cases.at(-1), { failedChecks: ["V06.resume"], artifactPath: "cases/gpt-6-luna/V06", reason: "missing <recall> | evidence" });
  const text = markdown(report);
  assert.match(text, /NOT PASSED\.\*\* 35\/36/); assert.match(text, /V06.resume/); assert.match(text, /&lt;recall&gt; &#124;/);
  assert.match(text, /Show all 36 case rows/); assert.ok(!text.includes("TARGET MET"));
  assert.match(markdown(finished()), /Result: PASS/);
  assert.doesNotMatch(markdown({ ...finished(), error: "cleanup failed" }), /Result: PASS/);
  assert.match(markdown({ ...finished(), finishedAt: null }), /IN PROGRESS/);
  assert.match(caseSections([{ model: "gpt-6-astra", scenarioId: "V01", status: "blocked", reason: "unavailable" }]).join("\n"), /unavailable/);
  const error = caseSections([{ model: "gpt-6-astra", scenarioId: "V01", status: "failed", error: { name: "Error", message: "The SDK request failed" } }]).join("\n");
  assert.match(error, /The SDK request failed/); assert.ok(!error.includes("[object Object]"));
});

test("native rollout records actual commands and flags malformed JSON rather than silently skipping it", t => {
  const dir = temp(t); fs.mkdirSync(path.join(dir, "sessions"));
  fs.writeFileSync(path.join(dir, "sessions/rollout-test.jsonl"), [
    { type: "event_msg", payload: { type: "exec_command_begin", call_id: "test", command: ["/bin/zsh", "-lc", TEST_COMMAND] } },
    { type: "event_msg", payload: { type: "exec_command_end", call_id: "test", exit_code: 0, aggregated_output: "# tests 3\n# pass 3" } },
    { type: "event_msg", payload: { type: "item_completed", item: { type: "CommandExecution", id: "new-test", command: ["/bin/zsh", "-c", TEST_COMMAND], exit_code: 1, aggregated_output: "# fail 2" } } },
  ].map(row => JSON.stringify(row)).join("\n") + "\nnot-json\n");
  const evidence = readRollouts(dir);
  assert.equal(evidence.commands.length, 2); assert.equal(evidence.commands[0].exitCode, 0);
  assert.equal(evidence.commands[1].command, `/bin/zsh -c ${JSON.stringify(TEST_COMMAND)}`);
  assert.equal(evidence.commands[1].exitCode, 1);
  assert.deepEqual(evidence.errors, ["Invalid native rollout JSONL"]);
});

test("native task receipts preserve identities and reject malformed completion evidence", t => {
  const dir = temp(t); fs.mkdirSync(path.join(dir, "sessions"));
  fs.writeFileSync(path.join(dir, "sessions/rollout-tasks.jsonl"), [
    { type: "event_msg", payload: { type: "task_started", turn_id: "first" } },
    { type: "event_msg", payload: { type: "task_complete", turn_id: "first" } },
    { type: "event_msg", payload: { type: "task_started", turn_id: "second" } },
    { type: "event_msg", payload: { type: "task_complete" } },
  ].map(row => JSON.stringify(row)).join("\n") + "\n");
  const evidence = readRollouts(dir);
  assert.deepEqual(evidence.tasks, [{ type: "task_started", turnId: "first" }, { type: "task_complete", turnId: "first" },
    { type: "task_started", turnId: "second" }]);
  assert.deepEqual(evidence.errors, ["Invalid native task identity"]);
});

test("a stale visible marker or completed refusal cannot stand in for a fresh model answer", async () => {
  const session = Object.create(TuiSession.prototype); let sent = false;
  session.observer = () => ({ answers: [{ content: marker(seed, 1) }], http: sent ? [{ method: "POST", status: 200, finished: true,
    terminal: "response.completed", outputTypes: ["message"] }] : [] });
  session.submit = async () => { sent = true; }; session.screen = () => "previous marker still visible";
  session.rollout = () => ({ tasks: sent ? [{ type: "task_started", turnId: "current" }, { type: "task_complete", turnId: "current" }] : [] });
  session.ready = () => true; session.answered = () => true; session.steps = []; session.snapshot = () => {};
  session.capture = async () => {};
  await assert.rejects(session.ask("Recall", marker(seed, 1), 5000), /without the expected answer/);
});

test("completion evidence distinguishes tool handoffs from final text and rejects malformed frames", () => {
  const frame = output => `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output } })}\n\n`;
  assert.deepEqual(completionOutputTypes(frame([{ type: "message" }])), ["message"]);
  assert.deepEqual(completionOutputTypes(frame([{ type: "message" }, { type: "function_call" }])), ["message", "function_call"]);
  assert.deepEqual(completionOutputTypes(frame([{ type: "custom_tool_call" }])), ["custom_tool_call"]);
  assert.throws(() => completionOutputTypes(frame([null])));
  assert.throws(() => completionOutputTypes("event: response.completed\ndata: invalid\n\n"));
  assert.throws(() => completionOutputTypes("event: response.failed\ndata: {}\n\n"));
});

test("a temporarily ready composer during tool continuation cannot prematurely fail the model turn", async () => {
  const session = Object.create(TuiSession.prototype), sample = marker(seed, 1);
  let sent = false, completed = false, timer;
  const tool = { method: "POST", status: 200, finished: true, terminal: "response.completed", outputTypes: ["message", "function_call"] };
  const final = { ...tool, outputTypes: ["message"] };
  session.observer = () => ({ answers: completed ? [{ content: sample }] : [], http: !sent ? [] : completed ? [tool, final] : [tool] });
  session.submit = async () => { sent = true; timer = setTimeout(() => { completed = true; }, 1100); };
  session.rollout = () => ({ tasks: !sent ? [] : [{ type: "task_started", turnId: "current" },
    ...(completed ? [{ type: "task_complete", turnId: "current" }] : [])] });
  session.screen = () => "The composer briefly looks idle between tool output and the next model fragment";
  session.ready = () => true; session.answered = () => completed; session.steps = [];
  session.capture = async () => {};
  session.snapshot = () => assert.fail("A tool handoff is not an unexpected final answer");
  try { await session.ask("Complete the code fix", sample, 5000); }
  finally { clearTimeout(timer); }
  assert.equal(completed, true);
});

for (const mode of ["missing", "wrong-turn", "completion-before-start"]) {
  test(`a visible answer and completed SSE cannot replace the native task receipt (${mode})`, async () => {
    const session = Object.create(TuiSession.prototype), sample = marker(seed, 1);
    const old = [{ type: "task_started", turnId: "old" }, { type: "task_complete", turnId: "old" }];
    let sent = false;
    session.rollout = () => ({ tasks: !sent ? old : [...old, ...(mode === "completion-before-start"
      ? [{ type: "task_complete", turnId: "current" }, { type: "task_started", turnId: "current" }]
      : [{ type: "task_started", turnId: "current" }, ...(mode === "wrong-turn" ? [{ type: "task_complete", turnId: "other" }] : [])])] });
    session.observer = () => ({ answers: sent ? [{ content: sample }] : [], http: sent ? [{ method: "POST", status: 200,
      finished: true, terminal: "response.completed", outputTypes: ["message"] }] : [] });
    session.submit = async () => { sent = true; };
    session.screen = () => "Native composer appears idle before task_complete";
    session.ready = () => true; session.answered = () => true; session.steps = [];
    session.snapshot = () => {}; session.capture = async () => assert.fail("An unfinished native task must not become an answer checkpoint");
    await assert.rejects(session.ask("Remember the sample", sample, 1000), /Timed out waiting for answer-/);
    assert.deepEqual(session.steps, []);
  });
}

test("V06 reports a rejected compact command without waiting out or retrying it", async t => {
  const answers = [], commands = [], session = { workspace: temp(t), observer: () => ({ answers }), async launch() {},
    async ask(_prompt, answer) { answers.push({ content: answer }); }, async slash(command) { commands.push(command); },
    async waitFor(label, predicate) { assert.equal(label, "compacted"); predicate("\u25a0 '/compact' is disabled while a task is in progress."); },
    ready: () => true };
  await assert.rejects(runScenario(scenario("V06"), session, { model: "gpt-6-astra", seed, facts: { answers: [] } }), /Codex rejected \/compact/);
  assert.deepEqual(commands, ["/compact"]);
});

test("isolation, fresh output directories and bounded process cancellation stay fail-closed", async t => {
  const env = { PATH: "/bin", HOME: "/real", OPENAI_API_KEY: "sk-private-test-value", GH_TOKEN: "private-test-value", NODE_OPTIONS: "--require unsafe", CODEX_HOME: "/real/.codex" };
  const isolated = environment(env, { home: "/isolated", codexHome: "/isolated/.codex", tmp: "/temporary", token: "local-token" });
  assert.equal(isolated.OPENAI_API_KEY, undefined); assert.equal(isolated.GH_TOKEN, undefined); assert.equal(isolated.NODE_OPTIONS, undefined);
  assert.equal(workerEnvironment(env).NODE_OPTIONS, undefined); assert.equal(workerEnvironment(env).OPENAI_API_KEY, undefined);
  assert.ok(!scrubber(env)(env.GH_TOKEN).includes(env.GH_TOKEN));
  const output = path.join(temp(t), "run"); freshDirectory(output); assert.throws(() => freshDirectory(output));
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), 25);
  try { await assert.rejects(bounded(new Promise(() => {}), controller.signal), { name: "TimeoutError" }); }
  finally { clearTimeout(timer); }
  await assert.rejects(run(process.execPath, ["-e", "setInterval(()=>{},100)"], { signal: AbortSignal.timeout(40) }), { name: "TimeoutError" });
  assert.equal(sessionOptions(scenario("V02"), "gpt-6-astra", { ownedRoot: output, seed }).sandbox, "workspace-write");
  assert.deepEqual(pickerRows("1. gpt-6-astra (current)", SUPPORTED_MODEL_IDS).map(row => row.id), ["gpt-6-astra"]);
});

test("native RPC preserves completion races and denies unknown approval callbacks", async t => {
  const peer = fileURLToPath(new URL("./fixtures/core-rpc-peer.mjs", import.meta.url));
  const host = new NativeHost({ bin: process.execPath, args: [peer], env: { ...process.env, CORE_PEER_MODE: "normal" }, signal: AbortSignal.timeout(2000) });
  t.after(() => host.close()); await host.start();
  assert.equal((await host.turn("thread1", "hello")).status, "completed");
  assert.equal((await host.request("fixture/callback", {})).error.code, -32601);
});

test("pinned verification disables startup update checks for CLI, TUI and resume only", t => {
  const root = temp(t);
  const session = new TuiSession({ directory: path.join(root, "evidence"), model: "gpt-6-astra",
    ownedRoot: path.join(root, "owned"), executionKind: "offline-self-test" });
  for (const trailing of [[], ["exec", "--json"], ["resume", "--last"]]) {
    const args = session.launchArgs({ trailing });
    const index = args.indexOf("check_for_update_on_startup=false");
    assert.ok(index > args.indexOf("--"));
    assert.equal(args[index - 1], "-c");
    assert.equal(args.filter(value => value.startsWith("check_for_update_on_startup=")).length, 1);
  }
  assert.equal(fs.existsSync(path.join(session.codexHome, "config.toml")), false);
});

test("an update popup is rejected before readiness or prompt input", async () => {
  const session = Object.create(TuiSession.prototype), snapshots = [], inputs = [];
  session.steps = [];
  session.screen = () => "OpenAI Codex\nUpdate available! 0.154.0 -> 999.0.0\n\n\u203a 1. Update now\n  2. Skip\n  3. Skip until next version\n\nPress enter to continue";
  session.snapshot = label => snapshots.push(label);
  session.capture = async () => assert.fail("A popup cannot become a ready checkpoint");
  session.renderer = { seenCodex: true, press: async key => inputs.push(key), sendPrompt: async text => inputs.push(text) };
  assert.equal(session.ready(session.screen()), false);
  await assert.rejects(session.waitReady(500), /Verification will not select or install updates/);
  await assert.rejects(session.submit("Continue the saved conversation"), /composer is ready/);
  assert.deepEqual(inputs, []);
  assert.deepEqual(snapshots, ["unexpected-update-prompt"]);
  assert.deepEqual(session.steps, []);
  assert.equal(session.lastPrompt, undefined);
});
