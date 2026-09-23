import fs from "node:fs";
import path from "node:path";
import { sha, mkdir, writeJson } from "../../scripts/compatibility/util.mjs";
import { NATIVE_SCENARIOS, catalogFingerprint } from "../../scripts/compatibility/catalog.mjs";
import { evaluate, diagnosticMetrics } from "../../scripts/compatibility/oracles.mjs";
import { artifactContents } from "../../scripts/compatibility/artifacts.mjs";

import { extendedEvidence } from "./extended-evidence.mjs";

// Synthetic oracle inputs only. They deliberately carry an offline label and
// may never certify actual model behavior, even when every check is satisfied.
const file = text => ({ hash: sha(text), base64: Buffer.from(text).toString("base64"), mode: 384 });
const received = message => ({ direction: "receive", message });
const item = value => received({ method: "item/completed", params: { item: value } });
const command = (cmd, output, exitCode = 0) => item({ type: "commandExecution", id: `cmd-${sha(cmd + output).slice(0, 12)}`, command: cmd, exitCode, aggregatedOutput: output, status: "completed" });
const message = text => item({ type: "agentMessage", text, id: `msg-${sha(text).slice(0, 12)}` });
const paths = { C11: [], C12: [], C13: [], C14: ["memory.txt"], C15: ["task-started.json"], C16: [], C17: [], C18: [], C01: [], C02: ["sub/skill-receipts.jsonl"], C03: [],
  C04: ["calc.mjs", "app.mjs", "notes.txt", "docs/notes.txt", "obsolete.txt", "README.md"], C05: ["discount.mjs"],
  C06: [], C07: [], C08: ["allowed.txt"], C09: ["memory.txt", "other.txt"], C10: ["memory.txt"] };
const nonce = "N_01234567890123456789_한글";
const secrets = Object.fromEntries(["guide", "helper", "resource", "mcp", "other"].map(key => [key, `N_${sha(key).slice(0, 20)}_한글`]));
export function syntheticEvidence(id, provider = "ghcp", model = "gpt-6-astra") {
  const e = { scenarioId: id, provider, model, fixtureHash: sha(`unit-${id}`), logicalPrompts: [`unit-${id}`],
    fixture: { nonce, secrets: { ...secrets }, allowed: [...paths[id]], skillPath: "/owned/.agents/skills/fixture-check/SKILL.md" },
    native: [], transport: [], sdk: [], phases: [], toolLedger: [], approvals: [], diagnostics: [],
    before: { "user-dirty.txt": file("USER CHANGE\n") }, after: {}, protectedBefore: { "sentinel.txt": file("KEEP\n") }, protectedAfter: {},
    gitBefore: { head: "owned-head", index: "owned-index" }, gitAfter: { head: "owned-head", index: "owned-index" },
    resources: { cleaned: true, errors: [], networkConnections: 0 }, hosts: [{ pid: 400 }],
    toolProfile: { shell: "unified_exec", applyPatch: "freeform", source: "explicit-test-profile", effort: "low" } };
  const session = sessionId => e.sdk.push({ type: "session.created", sessionId, model }, { type: "session.send", sessionId },
    { type: "assistant.usage", sessionId, data: { model } }, { type: "client.deleteSession", sessionId });
  const thread = (threadId, kind = "thread", hostPid = 400) => e.phases.push({ kind, threadId, hostPid,
    result: { model, modelProvider: provider, thread: { id: threadId } } });
  const turn = (threadId, label, text, events = []) => {
    const after = e.native.length, result = { id: `turn-${e.phases.length}`, status: "completed" };
    e.native.push(...events, message(text), received({ method: "turn/completed", params: { threadId, turn: result } }));
    const phase = { kind: "turn", threadId, label, after, end: e.native.length, result }; e.phases.push(phase); return phase;
  };
  session("s1"); thread("t1");
  let text = nonce, events = [], output = [], inputs = [];
  if (id === "C01") {
    e.cli = { code: 0 };
    e.native.push(received({ type: "thread.started", thread_id: "t1" }), command("cat secret.txt", nonce), message(nonce), received({ type: "turn.completed" }));
    output = [{ type: "message", id: "wire-message", content: [{ type: "output_text", text: nonce }] }];
    const response = { id: "response1", model, status: "completed", output };
    const events = [{ type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "wire-message", delta: nonce },
      { type: "response.output_text.done", output_index: 0, content_index: 0, item_id: "wire-message", text: nonce }, { type: "response.completed", response }];
    e.transport.push({ method: "POST", path: "/v1/responses", request: { model, input: [] }, status: 200, contentType: "text/event-stream",
      responseText: events.map((v, i) => `data: ${JSON.stringify({ ...v, sequence_number: i })}\n\n`).join("") });
  }
  if (id === "C02") {
    e.before["sub/sentinel.txt"] = file("KEEP\n");
    const selected = { name: "fixture-check", path: e.fixture.skillPath, enabled: true };
    e.skill = { selected, receipts: [{ result: secrets.helper }] };
    e.native.push(received({ result: { data: [{ skills: [selected] }] } }), { direction: "send", message: { method: "turn/start", params: { input: [{ type: "skill", ...selected }] } } });
    text = `CHILD MODE=SAFE ${nonce} ${secrets.guide} ${secrets.helper}`;
    events = [command("cat note.txt guide.txt", `${nonce}\n${secrets.guide}`), command("node helper.mjs", secrets.helper)];
  }
  if (id === "C03") {
    text = JSON.stringify({ path: "src/주문 계산.mjs", line: 2, value: nonce, empty: true,
      review: { path: "review.mjs", line: 3, operator: "<=", replacement: "<", input: [7], expected: 7 } });
    events = [command("grep -n targetPrice src/*; cat 'src/주문 계산.mjs'", nonce), command("git diff -- review.mjs", "+ for (let i=0; i <= items.length; i++) n+=items[i];")];
  }
  if (id === "C04") {
    e.before["calc.mjs"] = file("export function second() {\n\treturn 1;\n}\n");
    e.before["app.mjs"] = file("import { second } from './calc.mjs';\nconsole.log(second());\n");
    e.before["notes.txt"] = file("Keep these notes.\n"); e.before["obsolete.txt"] = file("obsolete\n");
    const input = "*** Begin Patch\n*** Update File: calc.mjs\n*** Update File: app.mjs\n*** Update File: notes.txt\n*** Move to: docs/notes.txt\n*** Delete File: obsolete.txt\n*** Add File: README.md\n*** End Patch";
    output = [{ type: "custom_tool_call", name: "apply_patch", call_id: "p1", input }];
    e.sdk.push({ type: "assistant.message", sessionId: "s1", data: { toolRequests: [{ toolCallId: "p1", arguments: { input } }] } });
    events = [item({ type: "fileChange", id: "p1", status: "completed" }), command("node app.mjs && git diff --check", "2\n")];
  }
  if (id === "C05") {
    e.before["discount.mjs"] = file("buggy"); e.before["discount.test.mjs"] = file("fixed tests");
    events = [command("node --test --experimental-test-isolation=none", "# tests 3\n# fail 1", 1), command("node --test --experimental-test-isolation=none", "# tests 3\n# pass 3", 0)]; e.independentTest = { code: 0 };
  }
  if (id === "C06") {
    const args = { key: "한글", ids: [2, 1], enabled: false, note: null };
    e.toolLedger = [{ namespace: "alpha", tool: "lookup", arguments: args, callId: "c1", result: nonce }];
    output = [{ type: "function_call", call_id: "c1", name: "lookup", namespace: "alpha" }]; inputs = [{ type: "function_call_output", call_id: "c1", output: nonce }];
    const rows = [];
    const rpc = (id, method, params, result) => rows.push({ event: "request", id, method, params }, { event: "response", id, method, result });
    rpc(1, "resources/list", {}, {}); rpc(2, "tools/list", {}, {});
    rpc(3, "resources/read", { uri: "fixture://config" }, { contents: [{ text: JSON.stringify({ code: secrets.resource }) }] });
    rpc(4, "tools/call", { name: "lookup", arguments: { key: "missing" } }, { isError: true, content: [{ type: "text", text: "ENOENT" }] });
    rpc(5, "tools/call", { name: "lookup", arguments: { key: "selected" } }, { isError: false, content: [{ type: "text", text: secrets.mcp }] });
    e.mcp = { ledger: rows };
    events = ["missing", "selected"].map(key => item({ type: "mcpToolCall", server: "fixture", tool: "lookup", arguments: { key } }));
    text = `${nonce} ${secrets.resource} ${secrets.mcp}`;
  }
  if (id === "C07") {
    e.protectedBefore["deny.txt"] = file("KEEP"); e.protectedBefore["allow.txt"] = file("KEEP");
    e.approvals = [{ mode: "deny", decision: "decline" }, { mode: "allow", decision: "accept" }];
    const denied = turn("t1", "deny", "Denied"); denied.protectedAfter = structuredClone(e.protectedBefore);
    events = [command("approved fixture command", "WROTE")];
  }
  if (id === "C08") {
    events = [command("node sandbox-probe.mjs", JSON.stringify({ allowed: true, outsideDenied: true, networkDenied: true }))];
    e.sandboxPreflight = { measured: { outsideDenied: true, networkDenied: true } };
  }
  if (id === "C09") {
    e.before["memory.txt"] = file(nonce); e.before["other.txt"] = file(secrets.other); e.contextThreads = { x: "t1", y: "t2" };
    session("s2"); thread("t2");
    turn("t1", "x-read", `${nonce} BLUE`, [command("cat memory.txt", nonce)]);
    turn("t2", "y-read", `${secrets.other} RED`, [command("cat other.txt", secrets.other)]);
    turn("t1", "x-update", `${nonce} GREEN`); turn("t2", "y-recall", `${secrets.other} RED`); turn("t1", "x-recall", `${nonce} GREEN`);
  }
  if (id === "C10") {
    e.before["memory.txt"] = file(nonce); e.toolLedger = [{ tool: "counter", result: `receipt:${nonce}` }];
    turn("t1", "read", `${nonce} receipt:${nonce}`, [command("cat memory.txt", nonce)]);
    e.restart = { sdkOffset: e.sdk.length, previousSdkSessionIds: ["s1"] }; session("s2"); thread("t1", "resume", 401); e.hosts.push({ pid: 401 });
    text = `${nonce} receipt:${nonce}`;
  }
  if (!["C01", "C09"].includes(id)) turn("t1", "final", text, events);
  e.after = structuredClone(e.before); e.protectedAfter = structuredClone(e.protectedBefore);
  if (id === "C02") e.after["sub/skill-receipts.jsonl"] = file(JSON.stringify({ result: secrets.helper }) + "\n");
  if (id === "C04") {
    e.after["calc.mjs"] = file("export function total() {\n\treturn 2;\n}\n"); e.after["app.mjs"] = file("import { total } from './calc.mjs';\nconsole.log(total());\n");
    e.after["README.md"] = file("Uses total.\n"); e.after["docs/notes.txt"] = e.after["notes.txt"]; delete e.after["notes.txt"]; delete e.after["obsolete.txt"];
  }
  if (id === "C05") e.after["discount.mjs"] = file("fixed");
  if (id === "C07") e.protectedAfter["allow.txt"] = file("probe");
  if (id === "C08") e.after["allowed.txt"] = file("OK");
  if (["C09", "C10"].includes(id)) { delete e.after["memory.txt"]; delete e.after["other.txt"]; }
  if (id !== "C01") e.transport.push({ method: "POST", path: "/v1/responses", request: { model, input: inputs }, status: 200,
    contentType: "application/json", responseText: JSON.stringify({ status: "completed", model, output }) });
  extendedEvidence(id, e, { file, command, item, received });
  return e;
}
export function writeSyntheticCase(config, mutate) {
  const e = syntheticEvidence(config.scenarioId, config.provider, config.model); mutate?.(e);
  const scenario = NATIVE_SCENARIOS.find(s => s.id === config.scenarioId), checks = evaluate(scenario, e);
  const status = checks.every(c => c.passed) ? "passed" : "failed";
  mkdir(config.directory);
  const manifest = { runId: config.runId, catalogHash: catalogFingerprint(), scenarioId: scenario.id, model: config.model, provider: config.provider,
    executionKind: "offline-self-test", durationMs: 5, status, checks, metrics: diagnosticMetrics(scenario, e), files: {} };
  for (const [name, text] of Object.entries(artifactContents(manifest, scenario, e, checks, status))) {
    fs.writeFileSync(path.join(config.directory, name), text, { mode: 0o600 }); manifest.files[name] = { sha256: sha(text), bytes: Buffer.byteLength(text) };
  }
  writeJson(path.join(config.directory, "result.json"), manifest); return manifest;
}
