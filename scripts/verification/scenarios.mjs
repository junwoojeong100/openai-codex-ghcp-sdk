import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual as same } from "node:util";
import { SUPPORTED_MODEL_IDS, modelCatalog, resolveContextTier } from "../../src/model-map.mjs";
import { ROOT, hasUnmaskedFinalCommand, run, sha, tree } from "./util.mjs";
import { CATALOG } from "./catalog.mjs";
import { TuiSession, isExpectedTitleRejection, pickerRows, readRollouts } from "./session.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const marker = (seed, n) => `TUI_${seed}_${String(n).padStart(6, "0")}`;
export const codeSample = seed => marker(sha(`V02 sample:${seed}`).slice(0, 8), 1);
export const switchSource = model => model === "gpt-6-astra" ? "gpt-6-luna" : "gpt-6-astra";
export const TEST_COMMAND = "node --test --experimental-test-isolation=none discount.test.mjs";
const SHELL_TOOLS = new Set(["shell", "shell_command", "exec_command", "unified_exec", "local_shell_call", "container.exec"]);

const testRuns = rollout => (rollout?.commands ?? []).filter(row => hasUnmaskedFinalCommand(row.command, TEST_COMMAND));
function verifiedCodeBaseline(before, baseline) {
  const rollout = baseline?.rollout, tests = testRuns(rollout);
  return Boolean(before && baseline?.workspace) && same(before, baseline.workspace)
    && rollout?.errors?.length === 0 && rollout.patchApplies === 0
    && Array.isArray(rollout.toolCalls)
    && rollout.toolCalls.some(row => SHELL_TOOLS.has(row.name))
    && !rollout.toolCalls.some(row => row.name === "apply_patch")
    && tests.length > 0 && tests.every(row => Number.isInteger(row.exitCode) && row.exitCode !== 0
      && /(?:#|ℹ) tests 3\b/.test(row.output) && /(?:#|ℹ) fail [1-9]\d*\b/.test(row.output));
}

export function sessionOptions(scenario, model, { ownedRoot, seed }) {
  const options = { model: scenario.id === "V04" ? switchSource(model) : model, sandbox: scenario.sandbox, codexArgs: [] };
  if (scenario.id === "V03") {
    const config = path.join(ownedRoot, "mcp-fixture.json");
    options.mcpFixture = { config, nonce: marker(seed, 1) };
    options.codexArgs = ["-c", `mcp_servers.fixture={ command=${JSON.stringify(process.execPath)}, args=[${JSON.stringify(path.join(ROOT, "scripts/verification/mcp-fixture.mjs"))}, ${JSON.stringify(config)}], startup_timeout_sec=15, tool_timeout_sec=15, default_tools_approval_mode="approve" }`];
  }
  return options;
}

async function openPicker(s, facts) {
  await s.slash("/model");
  await s.waitFor("picker", text => /Select Model and Effort/.test(text) && pickerRows(text, SUPPORTED_MODEL_IDS).length === 6, 20000);
  await sleep(500);
  facts.picker = pickerRows(s.snapshot("picker"), SUPPORTED_MODEL_IDS);
}

async function highlight(s, parse, wanted) {
  let rows = parse(s.screen()), index = rows.findIndex(row => row.selected);
  const target = rows.findIndex(wanted);
  if (target < 0 || index < 0) throw new Error("Required picker option is absent");
  for (let moves = 0; index !== target && moves < 12; moves++) {
    await s.press(index > target ? "ArrowUp" : "ArrowDown");
    await sleep(250);
    rows = parse(s.screen()); index = rows.findIndex(row => row.selected);
  }
  if (index !== target) throw new Error("Could not select the required picker option");
}

const effortRows = text => TuiSession.bottom(text, 20).split("\n")
  .map(line => /^\s*([\u203a\u276f>])?\s*(\d+)\.\s+(.+?)(?:\s{2,}|$)/.exec(line)).filter(Boolean)
  .map(row => ({ selected: Boolean(row[1]), label: row[3].replace(/\s*\(default\)\s*$/, "").trim() }));

async function selectModel(s, facts, model) {
  await openPicker(s, facts);
  await highlight(s, text => pickerRows(text, SUPPORTED_MODEL_IDS), row => row.id === model);
  await s.press("Enter");
  const text = await s.waitFor("model-option", value => /Select Reasoning Level/.test(TuiSession.bottom(value, 20)) || value.includes(`Model changed to ${model}`), 20000);
  facts.effortPopup = /Select Reasoning Level/.test(TuiSession.bottom(text, 20));
  if (facts.effortPopup) {
    facts.effortOptions = effortRows(text).map(row => row.label);
    await highlight(s, effortRows, row => row.label === "High");
    await s.press("Enter");
  }
  await s.waitFor("model-changed", value => value.includes(`Model changed to ${model}`), 20000);
  await sleep(500);
  if (/Select Model and Effort/.test(TuiSession.bottom(s.screen(), 20))) await s.escape();
  const settled = await s.waitFor("model-settled", value => s.ready(value), 20000);
  facts.modelChangedLine = settled.split("\n").find(line => line.includes(`Model changed to ${model}`))?.trim();
}

export async function runScenario(scenario, s, { model, seed, facts }) {
  const m = n => scenario.id === "V02" && n === 1 ? codeSample(seed) : marker(seed, n);
  const ask = async (prompt, answer, timeout) => {
    const offset = s.observer().http.length;
    try { await s.ask(prompt, answer, timeout); }
    finally {
      facts.answers.push({ expected: answer, observed: s.observer().http.slice(offset)
        .filter(row => row.method === "POST" && row.path === "/v1/responses" && row.status === 200
          && row.finished && row.terminal === "response.completed" && typeof row.outputText === "string")
        .map(row => row.outputText) });
    }
  };
  const reply = n => `Reply with only ${m(n)}. Do not use tools.`;
  if (scenario.id === "V02") {
    fs.writeFileSync(path.join(s.workspace, "AGENTS.md"), "Only discount.mjs may be edited. Keep tests and user-notes.txt unchanged. Do not install dependencies.\n");
    fs.writeFileSync(path.join(s.workspace, "user-notes.txt"), "Existing user work must survive.\n");
    fs.writeFileSync(path.join(s.workspace, "sample.txt"), m(1));
    fs.writeFileSync(path.join(s.workspace, "discount.mjs"), "export function discount(price, percent) { return price * (100 - percent); }\n");
    fs.writeFileSync(path.join(s.workspace, "discount.test.mjs"), "import test from 'node:test'; import assert from 'node:assert/strict'; import { discount } from './discount.mjs';\ntest('ten percent', () => assert.equal(discount(200, 10), 180));\ntest('zero', () => assert.equal(discount(80, 0), 80));\ntest('full', () => assert.equal(discount(90, 100), 0));\n");
  }
  facts.before = tree(s.workspace);
  if (scenario.id === "V01") {
    const cli = await run(path.join(ROOT, "bin/codex-ghcp"), s.launchArgs({ trailing: ["exec", "--json", "--ephemeral", "--skip-git-repo-check", reply(4)] }),
      { cwd: s.workspace, env: s.childEnv(), signal: AbortSignal.timeout(60000) });
    facts.cli = { exitCode: cli.code, events: cli.stdout.split("\n").filter(Boolean).map(line => JSON.parse(line)) };
    if (cli.code !== 0) throw new Error(`Native codex exec failed: ${cli.stderr}`);
  }
  await s.launch();
  switch (scenario.id) {
    case "V01": {
      await openPicker(s, facts);
      await s.escape();
      await s.waitFor("picker-closed", text => s.ready(text), 15000);
      const unicode = `${m(1)} 안녕 café`;
      await ask(`Remember the inert project label ${m(3)} in this conversation. Reply with only ${unicode}. Do not use tools.`, unicode);
      await s.slash("/new");
      await s.waitFor("new-thread", text => /To continue this session, run codex resume/.test(text) && s.ready(text), 30000);
      facts.newAt = Date.now();
      await ask(`If you know a project label from this conversation reply with it; otherwise reply with only ${m(2)}. Do not use tools.`, m(2));
      break;
    }
    case "V02":
      await ask(`Read-only baseline: do not edit any file or fix the bug in this turn, even if the fix is obvious. Read sample.txt and discount.mjs with the native shell tool, then run exactly ${TEST_COMMAND} to reproduce the failing tests. Keep that test command last; do not append echo, pipe its output, mask its exit status or install dependencies. After observing the nonzero test exit, stop and reply with only ${m(2)} on one plain line.`, m(2));
      facts.baseline = { rollout: readRollouts(s.codexHome), workspace: tree(s.workspace) };
      if (!verifiedCodeBaseline(facts.before, facts.baseline)) {
        throw new Error("V02 baseline was not verified: require actual failing tests with an unmasked nonzero exit and no file changes before requesting a repair.");
      }
      await ask(`Repair the verified failure: use apply_patch to fix only discount.mjs. After applying the patch, re-read sample.txt with the native shell; do not infer its contents from earlier messages. Then run exactly ${TEST_COMMAND} again. Keep that test command last; do not append echo, pipe its output, mask its exit status, edit tests or install dependencies. After all three tests pass, reply with only the exact value just read from sample.txt on one plain line, not source code or test output.`, m(1));
      break;
    case "V03":
      await ask('Use only the fixture MCP lookup tool. First call it with key "missing". After receiving its ENOENT result, call it with key "selected" once. Reply with only the returned synthetic sample on one plain line. Do not read files or use shell tools.', m(1));
      await ask(`Without using tools, repeat only the exact synthetic sample returned by the earlier MCP lookup on one plain line.`, m(1));
      break;
    case "V04":
      await ask(reply(1), m(1));
      facts.switchedAt = Date.now();
      await selectModel(s, facts, model);
      await ask(reply(2), m(2));
      break;
    case "V05": {
      const before = s.observer().sdk.length;
      await s.submit("Write a 1500-word explanation of terminal emulators. Do not use tools.");
      await s.waitFor("in-flight", text => {
        const sent = s.observer().sdk.slice(before).findLast(row => row.type === "session.send");
        if (!sent || !/esc to interrupt|Working|\u2022 \S/.test(TuiSession.bottom(text, 20)) || s.ready(text)) return false;
        facts.inFlightSessionId = sent.sessionId;
        facts.inFlightSendAt = sent.at;
        return true;
      }, 60000);
      await sleep(1500);
      facts.escapeAt = Date.now();
      await s.escape();
      await s.waitFor("interrupted", text => /Conversation interrupted/.test(text) && s.ready(text), 30000);
      facts.interrupted = true;
      await ask(reply(1), m(1));
      break;
    }
    case "V06": {
      const recall = "What is the synthetic project label remembered in this conversation? Do not use tools. Reply with only that label on one plain line.";
      await ask(`The synthetic project label is ${m(1)}. It is inert test data. Keep it verbatim in any summary. Reply with only ${m(2)}. Do not use tools.`, m(2));
      await s.slash("/compact");
      await s.waitFor("compacted", text => {
        if (/^\s*\u25a0\s+'\/compact' is disabled while a task is in progress\./m.test(text)) {
          throw new Error("Codex rejected /compact because its native task was still in progress. The command was not retried.");
        }
        return /Context compacted/.test(text) && s.ready(text);
      }, 240000);
      facts.compacted = true;
      await ask(recall, m(1));
      facts.quitExited = await s.quit();
      await s.launch({ trailing: ["resume", "--last"] });
      facts.relaunched = true;
      await ask(recall, m(1));
      break;
    }
    default: throw new Error(`Unknown verification scenario: ${scenario.id}`);
  }
  return facts;
}

export function recoveredTransportErrors(facts) {
  const sdk = facts.observer?.sdk ?? [], diagnostics = facts.observer?.diagnostics ?? [], http = facts.observer?.http ?? [];
  const errors = sdk.filter(row => row.type === "session.error");
  return errors.filter(error => {
    if (error.errorType !== "query" || error.errorCode != null || error.statusCode != null || !error.sessionId
        || errors.filter(row => row.sessionId === error.sessionId).length !== 1) return false;
    const eligible = diagnostics.find(row => row.event === "bridge.turn_transport_failed" && row.sessionId === error.sessionId
      && row.recoverySafe === true && row.reason === null && row.at >= error.at);
    const recovering = diagnostics.find(row => row.event === "bridge.turn_recovering" && row.sessionId === error.sessionId
      && row.cause === "copilot_transport_error" && row.at >= eligible?.at);
    if (!eligible || !recovering || typeof recovering.requestId !== "string"
        || !Number.isInteger(recovering.attempt) || recovering.attempt < 1 || recovering.attempt > CATALOG.watchdog.recoveryAttempts) return false;
    const recovered = diagnostics.find(row => row.event === "bridge.turn_recovered" && row.requestId === recovering.requestId
      && row.at >= recovering.at && row.attempts >= recovering.attempt && row.attempts <= CATALOG.watchdog.recoveryAttempts);
    return Boolean(recovered) && ["session.abort", "session.disconnect", "client.deleteSession"].every(type => sdk.some(row =>
      row.type === type && row.sessionId === error.sessionId && row.at >= error.at && row.at <= recovering.at))
      && diagnostics.some(row => row.event === "bridge.model_call_failed" && row.sessionId === error.sessionId
        && row.kind === "transport" && row.statusCode === null && row.at <= error.at)
      && http.some(row => row.responseId === recovering.requestId && row.status === 200 && row.finished
        && row.terminal === "response.completed" && row.startedAt <= error.at && row.finishedAt >= recovered.at);
  }).length;
}

export function evaluate(scenario, model, facts) {
  const checks = [], check = (id, passed, detail) => checks.push({ id, passed: Boolean(passed), detail });
  const sdk = facts.observer?.sdk ?? [], http = facts.observer?.http ?? [], ev = facts.evidence ?? {};
  const usage = sdk.filter(row => row.type === "assistant.usage");
  const sessions = sdk.filter(row => ["session.created", "session.setModel"].includes(row.type));
  const verified = sdk.filter(row => row.type === "session.model_verified");
  const expectedModels = scenario.id === "V04" ? [switchSource(model), model] : [model];
  check("routing", sessions.length > 0 && usage.length > 0 && usage.every(row => expectedModels.includes(row.model))
    && sessions.every(row => expectedModels.includes(row.model)) && verified.length === sessions.length
    && sessions.every(row => verified.some(v => v.sessionId === row.sessionId && v.operation === row.type.slice(8)
      && v.requestedModel === row.model && v.model === row.model && v.requestedTier === row.contextTier)), "Exact catalog models and authoritative SDK configuration, without fallback");
  const responses = http.filter(row => row.method === "POST" && row.path === "/v1/responses" && !isExpectedTitleRejection(row));
  check("connection", sdk.some(row => row.type === "session.send") && responses.some(row => row.terminal === "response.completed")
    && responses.every(row => row.status === 200 && /^text\/event-stream\b/.test(row.contentType ?? "")
      && (row.finished && row.terminal === "response.completed" || scenario.id === "V05" && !row.finished && row.startedAt < facts.escapeAt)), "Real Responses SSE; only the intentional interruption may end before completion");
  const models = sdk.filter(row => row.type === "models.list").flatMap(row => row.models);
  const catalogs = http.filter(row => row.path === "/v1/models" && row.status === 200).flatMap(row => row.body?.models ?? []);
  check("context-tier", sessions.length > 0 && verified.length === sessions.length && !sdk.some(row => row.type === "session.model_verification_failed")
    && sessions.every(row => {
      const info = models.find(entry => entry.id === row.model), budget = info && modelCatalog([info]).models[0];
      const published = catalogs.filter(entry => entry.slug === row.model);
      return info && budget && row.contextTier === resolveContextTier(info) && published.length > 0
        && published.every(entry => entry.context_window === budget.context_window && entry.max_context_window === budget.max_context_window && entry.auto_compact_token_limit === budget.auto_compact_token_limit);
    }) && verified.every(row => row.contextTier === row.requestedTier), "Maximum advertised context tier and published input/compaction budgets agree");
  const health = http.filter(row => row.path === "/health" && row.status === 200);
  check("watchdog", health.length > 0 && health.every(row => row.body?.ready === true && row.body.protocol === "responses"
    && Object.entries(CATALOG.watchdog).every(([key, value]) => row.body.turnWatchdog?.[key] === value)), "Production timeouts and bounded recovery remain enabled");
  const diagnostics = facts.observer?.diagnostics ?? [];
  const startupRecovered = failure => failure.operation === "listModels" && Number.isSafeInteger(failure.pid)
    && (failure.failureType === "timeout" || failure.catalogFailure?.retryable === true)
    && diagnostics.some(row => row.event === "bridge.upstream_catalog_recovering" && row.pid === failure.pid
      && row.generation === failure.generation && row.at >= failure.at
      && diagnostics.some(done => done.event === "bridge.upstream_catalog_recovered" && done.pid === failure.pid
        && done.generation === failure.generation + 1 && done.at >= row.at));
  check("upstream", diagnostics.filter(row => row.event === "bridge.upstream_connect_failed").every(startupRecovered)
    && !usage.some(row => row.contentFilterTriggered === true || row.finishReason === "content_filter")
    && sdk.filter(row => row.type === "session.error").length === recoveredTransportErrors(facts)
    && !http.some(row => row.terminal === "response.failed" || row.status >= 400 && !isExpectedTitleRejection(row)),
  "No unrecovered startup, upstream or stream error; recovery requires matching receipts");
  check("mcp-isolation", ev.samples?.count > 0 && ev.samples.maxRuntimes >= 1 && ev.samples.maxRuntimeMcp === 0 && ev.sampleErrors?.length === 0, "No MCP server ran under the Copilot runtime during owned process observations");
  const allowed = scenario.id === "V02" ? ["discount.mjs"] : [];
  check("workspace", facts.before && ev.workspace && [...new Set([...Object.keys(facts.before), ...Object.keys(ev.workspace)])]
    .every(file => allowed.includes(file) || same(facts.before[file], ev.workspace[file])), "Only the declared source file may change; existing user files and tests stay intact");
  const launches = ev.launches ?? [];
  check("cleanup", launches.length > 0 && launches.every(row => row.cleanup?.childReaped && row.cleanup?.processGroupGone
    && !row.browserError && !row.rendererCloseError && !row.quitError)
    && !facts.observer?.diagnostics?.some(row => ["bridge.session_cleanup_failed", "bridge.shutdown_failed"].includes(row.event))
    && ev.leftovers?.length === 0 && ev.catalogLeft?.length === 0, "Owned PTY, bridge, runtime, browser and private catalogs are gone");
  check("execution", !facts.error && ev.rollout?.errors?.length === 0, "No case execution or native-evidence error");
  const answer = value => (facts.answers ?? []).filter(row => row.expected === value && row.observed?.at(-1)?.trim() === value).length;
  const m = n => scenario.id === "V02" && n === 1 ? codeSample(facts.seed) : marker(facts.seed, n);
  const toolNames = (ev.rollout?.toolCalls ?? []).map(row => row.name);
  switch (scenario.id) {
    case "V01":
      check("V01.cli", facts.cli?.exitCode === 0 && facts.cli.events.some(row => row.type === "turn.completed")
        && facts.cli.events.some(row => row.type === "item.completed" && row.item?.type === "agent_message" && row.item.text === m(4)), "Non-interactive codex exec uses the production launcher and returns a completed model answer");
      check("V01.launch", same(facts.picker?.map(row => row.id), SUPPORTED_MODEL_IDS)
        && facts.picker?.find(row => row.isCurrent)?.id === model && answer(`${m(1)} 안녕 café`) === 1, "Six-model picker and a correctly rendered Unicode reply");
      check("V01.isolation", answer(m(2)) === 1 && facts.newAt && sdk.filter(row => row.type === "session.created").length >= 2
        && !facts.observer.answers.some(row => row.at >= facts.newAt && row.content.includes(m(3))), "/new starts fresh without the prior project label");
      break;
    case "V02": {
      const tests = testRuns(ev.rollout), baseline = facts.baseline?.rollout;
      check("V02.tests", verifiedCodeBaseline(facts.before, facts.baseline) && answer(m(2)) === 1
        && same(ev.rollout?.commands?.slice(0, baseline.commands.length), baseline.commands)
        && same(ev.rollout?.toolCalls?.slice(0, baseline.toolCalls.length), baseline.toolCalls)
        && tests.length > testRuns(baseline).length
        && tests.at(-1).exitCode === 0 && /(?:#|ℹ) tests 3\b/.test(tests.at(-1).output)
        && /(?:#|ℹ) pass 3\b/.test(tests.at(-1).output), "Verified unchanged baseline with actual failing tests, then the same three passing tests in the repair turn; unmasked exits required");
      check("V02.edit", toolNames.some(name => SHELL_TOOLS.has(name)) && toolNames.includes("apply_patch")
        && sdk.some(row => row.type === "external_tool.requested") && facts.before?.["discount.mjs"]?.hash !== ev.workspace?.["discount.mjs"]?.hash
        && typeof ev.workspace?.["discount.mjs"]?.hash === "string" && launches.length === 1,
      "Native read and apply_patch fix only the source in the same process");
      check("V02.answer", answer(m(1)) === 1, "The exact final client-visible answer is the hidden sample, not source code, commentary or test output");
      break;
    }
    case "V03": {
      const calls = (facts.mcpLedger ?? []).filter(row => row.event === "request" && row.method === "tools/call");
      check("V03.mcp", same(calls.map(row => row.params?.arguments?.key), ["missing", "selected"])
        && calls.every(row => row.params?.name === "lookup") && ev.samples?.maxCodexMcpFixture >= 1
        && toolNames.some(name => /lookup/.test(name)) && !toolNames.some(name => SHELL_TOOLS.has(name))
        && (facts.mcpLedger ?? []).some(row => row.event === "response" && row.method === "tools/call" && row.result?.isError === true), "Native MCP failure is observed before the successful lookup, without shell bypass");
      check("V03.continuation", answer(m(1)) === 2 && launches.length === 1, "The tool result and a fresh follow-up agree in the same process");
      break;
    }
    case "V04": {
      const after = usage.filter(row => row.at >= facts.switchedAt), context = ev.rollout?.turnContexts?.at(-1);
      check("V04.switch", facts.modelChangedLine?.includes(model) && after.length > 0 && after.every(row => row.model === model)
        && usage.some(row => row.at < facts.switchedAt && row.model === switchSource(model))
        && context?.model === model && answer(m(1)) === 1 && answer(m(2)) === 1, "Picker selection changes the next actual model response");
      check("V04.effort", model === "claude-haiku-4.5" ? facts.effortPopup === false && (!context?.effort || context.effort === "none")
        : facts.effortPopup && facts.effortOptions?.includes("High") && context?.effort === "high"
          && sessions.some(row => row.model === model && row.effort === "high"), "Reasoning effort reaches the selected model, or is absent for Haiku");
      break;
    }
    case "V05":
      check("V05.interrupt", facts.interrupted && typeof facts.inFlightSessionId === "string" && facts.inFlightSendAt < facts.escapeAt
        && sdk.some(row => row.type === "session.send" && row.sessionId === facts.inFlightSessionId && row.at === facts.inFlightSendAt)
        && sdk.some(row => row.type === "session.abort" && row.sessionId === facts.inFlightSessionId && row.at >= facts.escapeAt - 1000)
        && http.some(row => row.method === "POST" && row.terminal !== "response.completed" && row.startedAt < facts.escapeAt), "Escape aborts a real in-flight model request");
      check("V05.recovery", answer(m(1)) === 1 && launches.length === 1, "The same native process accepts and answers the next prompt");
      break;
    case "V06":
      check("V06.compact", facts.compacted && (ev.rollout?.compactions > 0 || sdk.some(row => row.type === "session.created" && row.toolCount === 0))
        && answer(m(2)) === 1 && answer(m(1)) === 2, "Local compaction and cold resume both preserve the remembered label in fresh answers");
      check("V06.resume", facts.quitExited && facts.relaunched && launches.length === 2 && launches[0].childExit?.code === 0
        && sdk.filter(row => row.type === "session.created").length >= 2, "Normal quit and resume --last create a new bridge using saved history");
      break;
    default: check("scenario", false, "Unknown scenario");
  }
  return checks;
}
