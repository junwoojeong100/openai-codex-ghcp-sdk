// Twelve real-TUI scenarios. run() drives the actual Codex UI; evaluate() is a pure function of
// recorded facts so a verifier can recompute every check from saved evidence.
import fs from "node:fs";
import path from "node:path";
import { SUPPORTED_MODEL_IDS, modelCatalog, resolveContextTier } from "../../src/model-map.mjs";
import { ROOT } from "../compatibility/util.mjs";
import { TUI_CATALOG } from "./catalog.mjs";
import { TuiSession, isExpectedTitleRejection, pickerRows } from "./session.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const marker = (seed, n) => `TUI_${seed}_${String(n).padStart(6, "0")}`;
const FORBIDDEN = /GPT-5\.|gpt-5\.|gpt-5-|Grok|grok-|Opus 4|opus-4|opus-5(?!\.5)|mai-code|codex-mini|\bo3\b|\bo4-mini\b/;
const SHELL_TOOLS = new Set(["shell", "shell_command", "exec_command", "unified_exec", "local_shell_call", "container.exec"]);
export const switchSource = model => model === "gpt-6-astra" ? "gpt-6-luna" : "gpt-6-astra";

export function sessionOptions(scenario, model, { ownedRoot, seed }) {
  const options = { model: scenario.id === "U02" ? switchSource(model) : model, sandbox: scenario.sandbox, codexArgs: [] };
  if (scenario.id === "U05") {
    const config = path.join(ownedRoot, "mcp-fixture.json");
    options.mcpFixture = { config, nonce: marker(seed, 1) };
    options.codexArgs = ["-c", `mcp_servers.fixture={ command=${JSON.stringify(process.execPath)}, args=[${JSON.stringify(path.join(ROOT, "scripts/compatibility/mcp-fixture.mjs"))}, ${JSON.stringify(config)}], startup_timeout_sec=15, tool_timeout_sec=15, default_tools_approval_mode="approve" }`];
  }
  return options;
}

async function openPicker(s, facts) {
  await s.slash("/model");
  const text = await s.waitFor("picker", t => /Select Model and Effort/.test(t) && pickerRows(t, SUPPORTED_MODEL_IDS).length >= 6, 20000);
  await sleep(500);
  const rows = pickerRows(s.snapshot("picker") || text, SUPPORTED_MODEL_IDS);
  facts.picker = { rows, forbidden: s.screen().split("\n").filter(line => FORBIDDEN.test(line)).length };
  return rows;
}
async function highlight(s, parse, wanted, label) {
  let rows = parse(s.screen()), index = rows.findIndex(r => r.selected);
  const target = rows.findIndex(wanted);
  for (let moves = 0; index !== target && moves < 12; moves++) {
    await s.press(index > target ? "ArrowUp" : "ArrowDown");
    await sleep(250);
    rows = parse(s.screen()); index = rows.findIndex(r => r.selected);
  }
  if (target < 0 || index !== target) throw new Error(`Could not highlight ${label}`);
}
const effortRows = text => TuiSession.bottom(text, 20).split("\n").map(line => /^\s*([\u203a\u276f>])?\s*(\d+)\.\s+(.+?)(?:\s{2,}|$)/.exec(line))
  .filter(Boolean).map(m => ({ selected: Boolean(m[1]), label: m[3].replace(/\s*\(default\)\s*$/, "").trim() }));
// Select a model in the real popup; accept or choose a reasoning level when Codex asks for one.
async function selectModel(s, facts, target, effort = null) {
  await openPicker(s, facts);
  await highlight(s, text => pickerRows(text, SUPPORTED_MODEL_IDS), row => row.id === target, target);
  await s.press("Enter");
  const next = await s.waitFor("after-model-select", t => /Select Reasoning Level/.test(TuiSession.bottom(t, 20)) || t.includes(`Model changed to ${target}`), 20000);
  facts.effortPopup = /Select Reasoning Level/.test(TuiSession.bottom(next, 20));
  if (facts.effortPopup) {
    facts.effortOptions = effortRows(next).map(row => row.label);
    if (effort) await highlight(s, effortRows, row => row.label === effort, `effort ${effort}`);
    await s.press("Enter");
  }
  await s.waitFor("model-changed", t => t.includes(`Model changed to ${target}`), 20000);
  // Codex keeps the model popup open after choosing a model without reasoning levels.
  await sleep(500);
  if (/Select Model and Effort/.test(TuiSession.bottom(s.screen(), 20))) {
    facts.pickerStayedOpen = true;
    await s.escape();
  }
  const settled = await s.waitFor("model-settled", t => s.ready(t), 20000);
  facts.modelChangedLine = settled.split("\n").find(line => line.includes(`Model changed to ${target}`))?.trim() ?? null;
}

async function ask(s, facts, prompt, expected, timeoutMs) {
  await s.ask(prompt, expected, timeoutMs);
  facts.seen.push(expected);
}

export async function runScenario(scenario, s, { model, seed, launchModel, facts = { seen: [], launchModel, markers: {} } }) {
  const m = n => marker(seed, n);
  const reply = n => `Reply with only ${m(n)}. Do not use tools.`;
  const code = n => `The launch code for this conversation is ${m(n)}. Keep it verbatim in any summary of this conversation.`;
  const recall = "What is the launch code for this conversation? Do not use tools. Reply with only the launch code.";
  switch (scenario.id) {
    case "U01":
      await s.launch();
      await openPicker(s, facts);
      await s.escape();
      await s.waitFor("picker-closed", t => s.ready(t), 15000);
      await ask(s, facts, reply(1), m(1));
      break;
    case "U02":
      await s.launch();
      await ask(s, facts, reply(1), m(1));
      facts.switchedAt = Date.now();
      await selectModel(s, facts, model);
      await ask(s, facts, reply(2), m(2));
      break;
    case "U03": {
      fs.mkdirSync(path.join(s.workspace, "notes"));
      fs.writeFileSync(path.join(s.workspace, "notes", "sample.txt"), `sample_id=${m(1)}\n`);
      await s.launch();
      const prompt = "Read the synthetic application fixture with the shell tool: cat notes/sample.txt . Reply with only the value of sample_id on its own line.";
      facts.promptContainsSampleId = prompt.includes(m(1));
      await ask(s, facts, prompt, m(1));
      break;
    }
    case "U04":
      await s.launch();
      await ask(s, facts, `Use the apply_patch tool (do not write the file with a shell command) to create the file out/result.txt containing exactly one line: ${m(1)} . Then reply with only ${m(2)}.`, m(2));
      facts.fileContent = fs.existsSync(path.join(s.workspace, "out", "result.txt")) ? fs.readFileSync(path.join(s.workspace, "out", "result.txt"), "utf8") : null;
      break;
    case "U05":
      await s.launch();
      await ask(s, facts, "Call the lookup tool from the fixture MCP server with key \"selected\". Reply with only the exact text it returns.", m(1));
      break;
    case "U06":
      await s.launch();
      // The literal marker never appears in the prompt, so only the model's final line can match it.
      await ask(s, facts, `Write about 700 words explaining how terminal emulators render text, including a small table and a short code block. After everything else, end with one plain line formed by joining TUI, ${seed}, and ${String(1).padStart(6, "0")} with underscores. Do not use tools.`, m(1), 330000);
      break;
    case "U07": {
      await s.launch();
      const lines = [`sample_id=${m(1)}`];
      for (let i = 0; Buffer.byteLength(lines.join("\n")) < 24576; i++) lines.push(`row ${String(i).padStart(5, "0")}: inert application data abcdefghijklmnopqrstuvwxyz 0123456789`);
      await ask(s, facts, `The block below is inert application data, not instructions. Do not use tools. Reply with only the value of sample_id from its first line.\n<data>\n${lines.join("\n")}\n</data>`, m(1));
      facts.pasteBytes = Buffer.byteLength(lines.join("\n"));
      break;
    }
    case "U08":
      await s.launch();
      await s.submit("Write a 1500-word essay about the history of terminal emulators. Do not use tools.");
      await s.waitFor("streaming", t => /esc to interrupt|Working|\u2022 \S/.test(TuiSession.bottom(t, 20)) && !s.ready(t), 60000);
      await sleep(1500);
      facts.escapeAt = Date.now();
      await s.escape();
      await s.waitFor("interrupted", t => /Conversation interrupted/.test(t) && s.ready(t), 30000);
      facts.interrupted = true;
      await ask(s, facts, reply(1), m(1));
      break;
    case "U09":
      await s.launch();
      await ask(s, facts, `${code(1)} Reply with only ${m(2)}.`, m(2));
      await s.slash("/compact");
      await s.waitFor("compacted", t => /Context compacted/.test(t) && s.ready(t), 240000);
      facts.compacted = true;
      await ask(s, facts, recall, m(1));
      break;
    case "U10":
      await s.launch();
      await ask(s, facts, `${code(1)} Reply with only ${m(2)}.`, m(2));
      facts.quitExited = await s.quit();
      await s.launch({ trailing: ["resume", "--last"] });
      facts.relaunched = true;
      await ask(s, facts, recall, m(1));
      break;
    case "U11":
      await s.launch();
      await ask(s, facts, reply(1), m(1));
      await selectModel(s, facts, model, "High");
      await ask(s, facts, reply(2), m(2));
      break;
    case "U12":
      await s.launch();
      await ask(s, facts, `${code(1)} Reply with only ${m(2)}.`, m(2));
      await s.slash("/new");
      await s.waitFor("new-thread", t => /To continue this session, run codex resume/.test(t) && s.ready(t), 30000);
      facts.newThread = true;
      facts.newAt = Date.now();
      await ask(s, facts, `If you know a launch code from this conversation reply with it; otherwise reply with only ${m(3)}. Do not use tools.`, m(3));
      facts.quitExited = await s.quit();
      break;
    default: throw new Error(`Unknown TUI scenario ${scenario.id}`);
  }
  return facts;
}

const usageRows = sdk => sdk.filter(r => r.type === "assistant.usage");
export function evaluate(scenario, model, facts) {
  const checks = [], check = (id, passed, detail) => checks.push({ id, passed: Boolean(passed), detail });
  const sdk = facts.observer?.sdk ?? [], usage = usageRows(sdk), http = facts.observer?.http ?? [], answers = facts.observer?.answers ?? [];
  const ev = facts.evidence ?? {}, m = n => marker(facts.seed, n), seen = new Set(facts.seen ?? []);
  const expected = scenario.id === "U02" ? [facts.launchModel, model] : [model];
  const sessions = sdk.filter(r => r.type === "session.created" || r.type === "session.setModel");
  const verified = sdk.filter(r => r.type === "session.model_verified");
  check("routing", sessions.length > 0 && usage.length > 0 && usage.every(r => expected.includes(r.model)) && sessions.every(r => expected.includes(r.model))
    && verified.length === sessions.length && sessions.every(r => verified.some(v => v.sessionId === r.sessionId
      && v.operation === r.type.slice("session.".length) && v.requestedModel === r.model && v.requestedTier === r.contextTier))
    && verified.every(r => r.model === r.requestedModel && expected.includes(r.model)),
    `Every SDK session and usage record uses ${expected.join(" then ")}`);
  const responses = http.filter(r => r.method === "POST" && r.path === "/v1/responses" && !isExpectedTitleRejection(r));
  check("connection", sdk.some(r => r.type === "session.send") && answers.length > 0 && responses.some(r => r.terminal === "response.completed")
    && responses.every(r => r.status === 200 && (/^text\/event-stream\b/.test(r.contentType ?? ""))
      && (r.finished && r.terminal === "response.completed" || scenario.id === "U08" && !r.finished && r.startedAt < facts.escapeAt)),
    "Actual SDK input, model output and successful Responses SSE reached the TUI; only U08 permits its explicit cancellation");
  const models = sdk.filter(r => r.type === "models.list").flatMap(r => r.models);
  const catalogs = http.filter(r => r.path === "/v1/models" && r.status === 200).flatMap(r => r.body?.models ?? []);
  check("context-tier", sessions.length > 0 && verified.length === sessions.length && !sdk.some(r => r.type === "session.model_verification_failed")
    && sessions.every(r => {
      const info = models.find(entry => entry.id === r.model), budget = info && modelCatalog([info]).models[0];
      const published = catalogs.filter(entry => entry.slug === r.model);
      return info && budget && r.contextTier === resolveContextTier(info) && published.length > 0
        && published.every(entry => entry.context_window === budget.context_window && entry.max_context_window === budget.max_context_window
        && entry.auto_compact_token_limit === budget.auto_compact_token_limit);
    }) && verified.every(r => r.contextTier === r.requestedTier && r.contextTier === resolveContextTier(models.find(entry => entry.id === r.model))),
    "The published input budget and authoritative SDK model snapshot agree with the maximum advertised context tier");
  const health = http.filter(r => r.path === "/health" && r.status === 200);
  check("watchdog", health.length > 0 && health.every(r => r.body?.ready === true && r.body?.protocol === "responses"
    && Object.entries(TUI_CATALOG.watchdog).every(([key, value]) => r.body?.turnWatchdog?.[key] === value)),
    "The newly launched bridge reports the production watchdog and bounded recovery settings");
  check("upstream", !usage.some(r => r.contentFilterTriggered === true || r.finishReason === "content_filter") && !sdk.some(r => r.type === "session.error")
    && !http.some(r => r.terminal === "response.failed" || r.status >= 400 && !isExpectedTitleRejection(r)),
    "No upstream filter, SDK error or failed supported request; the exact unsupported auxiliary title rejection is reported separately");
  check("mcp-isolation", (ev.samples?.count ?? 0) > 0 && ev.samples.maxRuntimes >= 1 && ev.samples.maxRuntimeMcp === 0,
    "No MCP server process ever ran under the bridge's Copilot runtime");
  const launches = ev.launches ?? [];
  check("cleanup", launches.length > 0 && launches.every(l => l.cleanup?.childReaped && l.cleanup?.processGroupGone && !l.browserError && !l.rendererCloseError && !l.quitError)
    && !(facts.observer?.diagnostics ?? []).some(r => r.event === "bridge.session_cleanup_failed")
    && (ev.leftovers ?? ["unknown"]).length === 0 && (ev.catalogLeft ?? ["unknown"]).length === 0 && !facts.error,
    "PTY group, launcher, bridge, runtime and browser gone; private catalog removed; no harness error");
  const answerWith = token => answers.find(a => typeof a.content === "string" && a.content.includes(token));
  const toolNames = (ev.rollout?.toolCalls ?? []).map(t => t.name);
  switch (scenario.id) {
    case "U01": {
      const rows = facts.picker?.rows ?? [];
      check("U01.picker", rows.map(r => r.id).join() === SUPPORTED_MODEL_IDS.join() && rows.map(r => r.number).join() === "1,2,3,4,5,6"
        && facts.picker.forbidden === 0 && rows.find(r => r.isCurrent)?.id === model, "Exactly the six pinned models in order, the launch model current, no other models");
      check("U01.reply", seen.has(m(1)) && answerWith(m(1)), "The first turn answers with its random marker");
      break;
    }
    case "U02": {
      const after = usage.filter(r => r.at >= facts.switchedAt);
      check("U02.switch", facts.modelChangedLine?.includes(model) && after.length > 0 && after.every(r => r.model === model)
        && usage.some(r => r.at < facts.switchedAt && r.model === facts.launchModel), `Turn before uses ${facts.launchModel}; turns after the picker use ${model}`);
      check("U02.reply", seen.has(m(1)) && seen.has(m(2)) && (ev.rollout?.turnContexts ?? []).at(-1)?.model === model, "Both turns answered; Codex recorded the switched model");
      break;
    }
    case "U03":
      check("U03.tool", toolNames.some(name => SHELL_TOOLS.has(name)) && sdk.some(r => r.type === "external_tool.requested"), "Codex executed a shell tool handed off by the bridge");
      check("U03.value", seen.has(m(1)) && facts.promptContainsSampleId === false && answerWith(m(1)), "The hidden synthetic sample id came back only through the tool result");
      break;
    case "U04":
      check("U04.patch", (toolNames.includes("apply_patch") || (ev.rollout?.patchApplies ?? 0) > 0) && sdk.some(r => r.type === "external_tool.requested"),
        "Codex applied a patch (apply_patch tool or its shell interception) handed off by the bridge");
      check("U04.file", typeof facts.fileContent === "string" && facts.fileContent.trim() === m(1) && seen.has(m(2)), "The created file holds exactly the requested line");
      break;
    case "U05":
      check("U05.mcp", toolNames.some(name => /lookup/.test(name)) && (facts.mcpLedger ?? []).some(e => e.event === "request" && e.method === "tools/call" && e.params?.arguments?.key === "selected")
        && (ev.samples?.maxCodexMcpFixture ?? 0) >= 1, "Codex started and called its own fixture MCP server");
      check("U05.value", seen.has(m(1)) && answerWith(m(1)), "The hidden MCP nonce came back through Codex");
      break;
    case "U06": {
      const answer = answerWith(m(1));
      check("U06.length", answer && answer.content.length >= 2500, "The streamed answer is at least 2,500 characters");
      check("U06.marker", seen.has(m(1)), "The final marker stays visible after the long render");
      break;
    }
    case "U07":
      check("U07.delivery", http.some(r => r.method === "POST" && r.requestBytes >= 24576) && usage.some(r => (r.inputTokens ?? 0) >= 5000), "The 24 KiB paste reached the model");
      check("U07.value", seen.has(m(1)), "The first-line sample id was answered");
      break;
    case "U08":
      check("U08.interrupt", facts.interrupted && sdk.some(r => r.type === "session.abort" && r.at >= facts.escapeAt - 1000)
        && http.some(r => r.method === "POST" && r.terminal !== "response.completed" && r.startedAt < facts.escapeAt), "Escape cancelled the in-flight request and the bridge aborted its SDK turn");
      check("U08.recovery", seen.has(m(1)) && launches.length === 1, "The same Codex process answered the next turn");
      break;
    case "U09":
      check("U09.compaction", facts.compacted && (sdk.some(r => r.type === "session.created" && r.toolCount === 0) || (ev.rollout?.compactions ?? 0) > 0), "Codex compaction ran through a tool-less bridge session");
      check("U09.recall", seen.has(m(2)) && seen.has(m(1)), "The explicitly important launch code survived compaction");
      break;
    case "U10":
      check("U10.relaunch", facts.quitExited && launches.length === 2 && launches[0].childExit?.code === 0 && facts.relaunched
        && sdk.filter(r => r.type === "session.created").length >= 2, "Codex quit cleanly and resume --last started a new bridge session");
      check("U10.recall", seen.has(m(2)) && seen.has(m(1)), "The replayed history answered the launch code");
      break;
    case "U11": {
      const contexts = ev.rollout?.turnContexts ?? [];
      const options = facts.effortOptions ?? [];
      const changed = facts.effortPopup
        ? options.includes("High") && contexts.at(-1)?.effort === "high"
          && sdk.some(r => (r.type === "session.setModel" || r.type === "session.created") && r.effort === "high")
        : contexts.every(c => !c.effort || c.effort === "none") && Boolean(facts.modelChangedLine);
      check("U11.effort", changed, facts.effortPopup ? "High was selected, recorded by Codex and applied by the bridge" : "No reasoning popup for a model without configurable effort");
      check("U11.reply", seen.has(m(1)) && seen.has(m(2)), "Turns before and after the change answered");
      break;
    }
    case "U12": {
      const leaked = answers.some(a => a.at >= (facts.newAt ?? 0) && typeof a.content === "string" && a.content.includes(m(1)) && !a.content.includes(m(2)));
      check("U12.isolation", facts.newThread && seen.has(m(3)) && !leaked && sdk.filter(r => r.type === "session.created").length >= 2, "The new thread used a new SDK session without the earlier code");
      check("U12.quit", facts.quitExited && launches[0]?.childExit?.code === 0, "/quit exited Codex and the launcher with status 0");
      break;
    }
    default: check("scenario", false, "Unknown scenario");
  }
  return checks;
}
