#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CopilotClient, defineTool } from "@github/copilot-sdk";
import { SessionManager } from "../src/session-manager.mjs";
import { resolveCopilotHome } from "../src/copilot-home.mjs";
import { configuredMcpServerNames } from "../src/mcp-isolation.mjs";
import { withinDeadline } from "../src/copilot-session-rpc.mjs";
import { modelCatalog, resolveCopilotModel } from "../src/model-map.mjs";
import { outputItems } from "../src/responses.mjs";
import { PROMPTS, catalogHash } from "./stability/catalog.mjs";
import { implementationHash } from "./stability/report.mjs";
import { mkdir, writeJson, sha, scrubber } from "./compatibility/util.mjs";
import { CopilotWireObserver } from "./diagnostics/copilot-wire.mjs";

export const DIAGNOSTIC_MODEL = "claude-opus-5.5";
export const PROBES = Object.freeze([
  { id: "sdk-exact-fixture", route: "sdk", prompt: "exact" },
  { id: "bridge-exact-fixture", route: "bridge", prompt: "exact" },
  { id: "sdk-exact-nonstreaming", route: "sdk", prompt: "exact", streaming: false },
  { id: "sdk-exact-default-summary", route: "sdk", prompt: "exact", defaultSummary: true },
  { id: "sdk-simple-tool-control", route: "sdk", prompt: "simple" },
  { id: "bridge-simple-tool-control", route: "bridge", prompt: "simple" },
  { id: "sdk-arithmetic-control", route: "sdk", prompt: "arithmetic" },
].map(Object.freeze));
const prompts = { exact: PROMPTS.read, simple: "Call read_fixture once and return its result.", arithmetic: "What is two plus two?" };
const fixtureTool = { type: "function", name: "read_fixture",
  description: "Read the owned synthetic fixture once and return its complete literal value and receipt. No credentials or external data.",
  parameters: { type: "object", properties: {}, additionalProperties: false } };

export function parseArguments(args) {
  const result = { execute: false }, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (seen.has(option)) throw new Error(`Duplicate option ${option}`);
    seen.add(option);
    if (option === "--execute") result.execute = true;
    else if (option === "--output") {
      const value = args[++i];
      if (!value || value.startsWith("-")) throw new Error("--output requires a directory");
      result.output = value;
    } else throw new Error(`Unknown option ${option}`);
  }
  if (result.output && !result.execute) throw new Error("--output requires --execute");
  return result;
}

export function answerEvidence(text, fixture) {
  return { answerBytes: Buffer.byteLength(text), answerHash: sha(text), exactFixture: text.includes(fixture),
    fixtureValuesPreserved: fixture.split("\n").every(line => text.includes(line.slice(line.indexOf(":") + 1))) };
}

export async function runProbe({ variant, signal }) {
  const model = DIAGNOSTIC_MODEL, prompt = prompts[variant.prompt];
  const fixture = `value:N_${randomBytes(10).toString("hex")}_한글\nreceipt:N_${randomBytes(10).toString("hex")}_한글`;
  const row = { ...variant, model, startedAt: new Date().toISOString(), promptHash: sha(prompt), fixtureHash: sha(fixture),
    status: "not-run", wire: [], usage: [], diagnostics: [], submissions: 0, permissionRequests: 0, cleanup: [] };
  const observer = new CopilotWireObserver({ model, records: row.wire });
  const client = new CopilotClient({ mode: "empty", baseDirectory: resolveCopilotHome(process.env.COPILOT_HOME),
    logLevel: "error", enableRemoteSessions: false, requestHandler: observer });
  let session, manager;
  const pending = [];
  const instructions = modelCatalog([{ id: model }]).models[0].base_instructions;
  const capture = event => {
    if (event.agentId || event.data?.parentToolCallId) return;
    if (event.type === "assistant.usage") {
      const d = event.data;
      row.usage.push({ contentFilterTriggered: d.contentFilterTriggered === true, finishReason:
        ["stop", "tool_calls", "length", "content_filter"].includes(d.finishReason) ? d.finishReason : null });
    }
  };
  try {
    signal?.throwIfAborted();
    let text;
    if (variant.route === "bridge") {
      const create = client.createSession.bind(client);
      client.createSession = async config => {
        const s = await create({ ...config, onPermissionRequest: (...args) => {
          row.permissionRequests++; return config.onPermissionRequest(...args);
        } });
        s.on(capture); return s;
      };
      manager = new SessionManager({ client, preferredModel: model, turnTimeoutMs: 35_000, requestTimeoutMs: 45_000,
        cleanupTimeoutMs: 3000, onDiagnostic: event => row.diagnostics.push(event) });
      await manager.start();
      const family = { "session-id": `opus-probe-${randomUUID()}` }, responseId = `resp_${randomUUID()}`;
      let result = await manager.execute({ model, instructions, input: prompt, tools: [fixtureTool], reasoning: { effort: "low" } }, family, { signal, responseId });
      const calls = outputItems(result.messages, result.tools).filter(item => item.type.endsWith("_call"));
      if (calls.length !== 1 || calls[0].type !== "function_call" || calls[0].name !== "read_fixture" || calls[0].arguments !== "{}") {
        throw new Error("Unexpected tool call; no tool executed");
      }
      row.submissions++;
      result = await manager.execute({ model, previous_response_id: responseId, reasoning: { effort: "low" },
        input: [{ type: "function_call_output", call_id: calls[0].call_id, output: fixture }] }, family, { signal });
      text = outputItems(result.messages, result.tools).filter(item => item.type === "message").flatMap(item => item.content.map(part => part.text)).join("\n");
    } else {
      await withinDeadline(() => client.start(), 30_000, signal);
      resolveCopilotModel({ requested: model, models: await withinDeadline(() => client.listModels(), 5000, signal) });
      session = await withinDeadline(() => client.createSession({ sessionId: `codex-ghcp-opus-probe-${randomUUID()}`,
        model, reasoningEffort: "low", ...(!variant.defaultSummary ? { reasoningSummary: "none" } : {}),
        tools: [defineTool(fixtureTool.name, { description: fixtureTool.description, parameters: fixtureTool.parameters,
          skipPermission: true, defer: "never", overridesBuiltInTool: true })], availableTools: ["custom:read_fixture"],
        disabledMcpServers: configuredMcpServerNames(resolveCopilotHome(process.env.COPILOT_HOME)),
        toolSearch: { enabled: false }, streaming: variant.streaming !== false, infiniteSessions: { enabled: false },
        systemMessage: { mode: "append", content: instructions }, skipCustomInstructions: true, customAgentsLocalOnly: true,
        enableSessionTelemetry: false, onPermissionRequest: () => { row.permissionRequests++; return { kind: "reject" }; },
      }), 30_000, signal);
      session.on(event => {
        capture(event);
        if (event.agentId || event.data?.parentToolCallId || event.type !== "external_tool.requested") return;
        const d = event.data;
        if (d.toolName !== "read_fixture" || d.sessionId !== session.sessionId || !d.requestId ||
          JSON.stringify(d.arguments ?? {}) !== "{}" || row.submissions) { row.unexpectedToolRequest = true; return; }
        row.submissions++;
        pending.push(session.rpc.tools.handlePendingToolCall({ requestId: d.requestId,
          result: { textResultForLlm: fixture, resultType: "success" } }));
        void pending.at(-1).catch(() => {});
      });
      const answer = await withinDeadline(() => session.sendAndWait({ prompt, attachments: [] }, 35_000), 36_000, signal);
      await Promise.all(pending);
      if (row.unexpectedToolRequest) throw new Error("Unexpected tool call; no additional tool executed");
      text = answer?.data?.content ?? "";
    }
    Object.assign(row, answerEvidence(text, fixture));
    row.status = row.usage.some(u => u.contentFilterTriggered || u.finishReason === "content_filter") ? "filtered"
      : (variant.prompt === "arithmetic" ? text.length > 0 && row.submissions === 0 : row.exactFixture && row.submissions === 1) ? "completed" : "mismatch";
  } catch (error) {
    row.status = error.code === "upstream_content_filter" ? "filtered" : "error";
    row.errorCode = ["upstream_content_filter", "model_unavailable", "copilot_timeout"].includes(error.code) ? error.code : "probe_error";
  } finally {
    const clean = async (operation, task) => {
      try { await withinDeadline(task, 5000); row.cleanup.push({ operation, passed: true }); }
      catch { row.cleanup.push({ operation, passed: false }); }
    };
    if (manager) await clean("manager.stop", () => manager.stop());
    else {
      if (session) {
        await clean("session.abort", () => session.abort());
        await clean("session.disconnect", () => session.disconnect());
        await clean("session.delete", () => client.deleteSession(session.sessionId));
      }
      await clean("client.stop", async () => { const errors = await client.stop(); if (errors?.length) throw errors[0]; });
      await clean("client.forceStop", () => client.forceStop());
    }
    await clean("observer.drain", () => observer.drain());
    row.finishedAt = new Date().toISOString();
    row.wireBlockObserved = row.wire.some(w => w.response?.explicitBlock === true);
    row.observedInferenceRequests = row.wire.filter(w => w.request?.modelMatches === true).length;
  }
  return row;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (!options.execute) {
    console.log(JSON.stringify({ model: DIAGNOSTIC_MODEL, inferenceRequests: 0, executionRequires: "--execute",
      unscored: true, automaticRetries: 0, probes: PROBES }, null, 2));
    return 0;
  }
  const directory = path.resolve(options.output ?? `.runtime/opus-diagnostic-${Date.now()}`);
  if (fs.existsSync(directory) && fs.readdirSync(directory).length) throw new Error("Refusing to overwrite diagnostic evidence");
  mkdir(directory);
  const controller = new AbortController(), interrupt = () => controller.abort(new Error("Interrupted"));
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  const report = { kind: "unscored-opus-wire-diagnostic", schemaVersion: 1, model: DIAGNOSTIC_MODEL,
    sdkVersion: "1.0.14", startedAt: new Date().toISOString(), catalogHash: catalogHash(), implementationHash: implementationHash(),
    sdkFoundationPreserved: true, wireBytesUnmodified: true, automaticRetries: 0, safetyPolicyChanges: false,
    promptChangesAreDiagnosticOnly: true, cases: PROBES.map(p => ({ ...p, status: "not-run" })) };
  try {
    for (const [i, variant] of PROBES.entries()) {
      if (controller.signal.aborted) break;
      report.cases[i] = await runProbe({ variant, signal: controller.signal });
      writeJson(path.join(directory, "report.json"), report);
      console.log(JSON.stringify({ id: variant.id, status: report.cases[i].status, wireBlockObserved: report.cases[i].wireBlockObserved }));
    }
  } finally {
    process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
    report.interrupted = controller.signal.aborted;
    report.finishedAt = new Date().toISOString();
    report.implementationUnchanged = implementationHash() === report.implementationHash;
    report.observedHttpRequests = report.cases.reduce((sum, row) => sum + (row.wire?.length ?? 0), 0);
    report.observedInferenceRequests = report.cases.reduce((sum, row) => sum + (row.observedInferenceRequests ?? 0), 0);
    writeJson(path.join(directory, "report.json"), report);
  }
  return report.cases.every(row => row.status === "completed" && row.cleanup?.every(c => c.passed)) && report.implementationUnchanged ? 0 : 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(scrubber()(error.message)); process.exitCode = 2; });
}
