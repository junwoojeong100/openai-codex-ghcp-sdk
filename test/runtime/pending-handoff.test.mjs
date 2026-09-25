import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { TuiSession, isExpectedTitleRejection } from "../../scripts/verification/session.mjs";
import { scrubber } from "../../scripts/verification/util.mjs";
import { verificationEnvironment } from "../../scripts/verification/preflight.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pending-handoff-tui-")));
const clean = scrubber();
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(clean(value), null, 2) + "\n", { mode: 0o600 });
const read = file => fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
const prompts = [
  'Call the fixture MCP lookup tool exactly once with key "selected". Reply with only the returned application sample on a line by itself, without a label or other text. Do not use shell tools.',
  "Without using tools, repeat only the exact application sample returned by the earlier lookup on a line by itself, without a label or other text.",
];
const report = { prompts, executionKind: "offline-self-test",
  environment: verificationEnvironment(), startedAt: new Date().toISOString(),
  scope: "Actual Codex TUI and headless Playwright; labelled trusted-instruction update with complete tool results. No /new or user bridge restart.",
  cases: [{ model: "gpt-6-astra", status: "not-run" }] };
const save = () => write(path.join(directory, "report.json"), report);
save();
after(() => {
  Object.assign(report, { finishedAt: new Date().toISOString(),
    passed: report.cases.filter(row => row.status === "passed").length, total: report.cases.length });
  save();
  fs.rmSync(directory, { recursive: true, force: true });
});

for (const row of report.cases) test(`${row.model}: complete tool results survive an instruction update in the same actual TUI (${report.executionKind})`, { timeout: 300_000 }, async t => {
  const out = path.join(directory, row.model);
  fs.mkdirSync(out, { mode: 0o700 });
  const ledger = path.join(out, "mcp-ledger.jsonl"), fixture = path.join(out, "mcp.json");
  const seed = randomBytes(4).toString("hex"), sample = `TUI_${seed}_000001`;
  write(fixture, { ledger, nonce: sample, resourceCode: `RC_${seed}` });
  const session = new TuiSession({ directory: out, model: row.model, ownedRoot: path.join(out, "owned"),
    sandbox: "read-only", executionKind: report.executionKind,
    preload: fileURLToPath(new URL("../fixtures/pending-handoff.mjs", import.meta.url)),
    codexArgs: ["-c", `mcp_servers.fixture={ command=${JSON.stringify(process.execPath)}, args=[${JSON.stringify(path.join(root, "scripts/verification/mcp-fixture.mjs"))}, ${JSON.stringify(fixture)}], startup_timeout_sec=15, tool_timeout_sec=15, default_tools_approval_mode="approve" }`] });
  write(session.observerFile, { ...JSON.parse(fs.readFileSync(session.observerFile, "utf8")), pendingHandoffProbe: true });
  const cancel = () => { void session.closeLaunch(); };
  t.signal.addEventListener("abort", cancel, { once: true });
  let failure, evidence, browser;
  row.startedAt = new Date().toISOString(); save();
  try {
    await session.launch();
    browser = { driver: session.renderer.driver, version: session.renderer.version, pid: session.renderer.pid };
    await session.ask(prompts[0], sample, 120_000);
    session.snapshot("handoff-completed");
    await session.ask(prompts[1], sample, 90_000);
    session.snapshot("same-thread-continued");
    const observation = session.observer();
    const injections = read(path.join(session.observerDir, "pending-handoff.jsonl"));
    const injected = injections.filter(event => event.event === "injected-trusted-instruction");
    const accepted = injections.filter(event => event.event === "handoff-accepted");
    assert.equal(injected.length, 1);
    assert.equal(injected[0].allPendingResultsPresent, true);
    assert.equal(injected[0].resultSubmissions, 0);
    assert.equal(accepted.length, 1);
    assert.equal(accepted[0].oldSessionEvicted, true);
    assert.equal(accepted[0].replacementSession, true);
    assert.equal(accepted[0].completedResultsPreserved, true);
    assert.equal(accepted[0].pendingCalls, 0);
    assert.equal(accepted[0].oldResultSubmissions, 0);
    assert.equal(accepted[0].resultSubmissions, 0);
    assert.ok(!injections.some(event => event.event === "handoff-rejected"));
    assert.equal(observation.diagnostics.filter(event => event.event === "bridge.session_handoff" && event.changed.includes("instructions")).length, 1);
    assert.ok(!observation.http.some(event => event.terminal === "response.failed" || event.status >= 400 && !isExpectedTitleRejection(event)));
    assert.equal(observation.sdk.filter(event => event.type === "tool.submit").length, 0);
    assert.equal(observation.sdk.filter(event => event.type === "session.created").length, 2);
    assert.ok(observation.sdk.filter(event => event.type === "session.created").every(event => event.model === row.model));
    assert.equal(observation.sdk.filter(event => event.type === "session.send").length, 3);
    const requests = observation.diagnostics.filter(event => event.event === "bridge.request_started");
    assert.equal(requests.length, 3);
    assert.equal(new Set(requests.map(event => event.familyHash)).size, 1);
    assert.equal(observation.answers.filter(answer => answer.content.includes(sample)).length, 2);
    const calls = read(ledger).filter(event => event.event === "request" && event.method === "tools/call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params.name, "lookup");
    assert.deepEqual(calls[0].params.arguments, { key: "selected" });
    Object.assign(row, { lookupExecutions: calls.length, resultRpcSubmissions: 0, sameThreadContinued: true });
  } catch (error) { failure = error; row.error = clean({ name: error.name, message: error.message }); }
  try {
    evidence = await session.close();
    if (browser) assert.throws(() => process.kill(browser.pid, 0), { code: "ESRCH" });
    assert.deepEqual(evidence.leftovers, []);
    assert.deepEqual(evidence.catalogLeft, []);
    assert.equal(evidence.launches.length, 1);
    assert.equal(evidence.rollout.files, 1);
    assert.equal(session.observer().metrics.modelMismatches, 0);
    assert.ok(evidence.launches.every(launch => launch.cleanup?.childReaped && launch.cleanup?.processGroupGone && !launch.browserError && !launch.rendererCloseError));
    assert.equal(evidence.samples.maxRuntimes, 0);
    row.cleanupPassed = true;
  } catch (error) { failure ??= error; row.cleanupError = clean(error.message); }
  t.signal.removeEventListener("abort", cancel);
  row.status = failure ? "failed" : "passed";
  row.finishedAt = new Date().toISOString();
  write(path.join(out, "facts.json"), { observation: session.observer(),
    injections: read(path.join(session.observerDir, "pending-handoff.jsonl")), ledger: read(ledger), evidence, browser, result: row });
  save();
  if (failure) t.diagnostic(JSON.stringify({ result: row, evidenceDirectory: out, diagnostics: session.observer().diagnostics,
    injections: read(path.join(session.observerDir, "pending-handoff.jsonl")) }));
  assert.ifError(failure);
});
