#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL, SUPPORTED_MODEL_IDS } from "../src/model-map.mjs";
import { preflight } from "./compatibility/preflight.mjs";
import { supervise } from "./compatibility/supervisor.mjs";
import { ROOT, writeJson, scrubber } from "./compatibility/util.mjs";
import { implementationHash } from "./stability/report.mjs";
import { snapshotSources, verifyFrozenSources } from "./soak/runner.mjs";

export function parseArguments(args) {
  const options = { mode: "plan", model: DEFAULT_MODEL, terminalDriver: "pty",
    durationSeconds: 120, payloadBytes: 8192, responseWords: 500 };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw new Error(`Duplicate option ${key}`);
    seen.add(key);
    if (["--plan", "--execute"].includes(key)) {
      if (seen.has("--plan") && seen.has("--execute")) throw new Error("Choose one terminal action");
      options.mode = key.slice(2); continue;
    }
    const names = { "--model": "model", "--driver": "terminalDriver", "--duration-seconds": "durationSeconds",
      "--payload-bytes": "payloadBytes", "--response-words": "responseWords", "--output": "output", "--bin": "bin" };
    if (!names[key]) throw new Error(`Unknown option ${key}`);
    const value = args[++i];
    if (!value || value.startsWith("-")) throw new Error(`Missing ${key}`);
    options[names[key]] = ["durationSeconds", "payloadBytes", "responseWords"].includes(names[key]) ? Number(value) : value;
  }
  if (!SUPPORTED_MODEL_IDS.includes(options.model) || !["pty", "playwright"].includes(options.terminalDriver)) throw new Error("Unsupported terminal model or driver");
  for (const [key, min, max] of [["durationSeconds", 1, 86400], ["payloadBytes", 128, 65536], ["responseWords", 0, 3000]]) {
    if (!Number.isSafeInteger(options[key]) || options[key] < min || options[key] > max) throw new Error(`Invalid ${key}`);
  }
  if (options.mode === "plan" && (options.output || options.bin)) throw new Error("Output/bin require --execute");
  return options;
}

export async function runTerminalCheck(options, { signal, env = process.env } = {}) {
  if (options.mode !== "execute") throw new Error("Live terminal validation requires explicit --execute.");
  const bin = options.bin || env.CODEX_BIN || "codex";
  const runId = randomUUID();
  const directory = path.resolve(options.output || path.join(ROOT, ".runtime", `terminal-${runId}`));
  if (fs.existsSync(directory)) throw new Error("Terminal output must be a new directory");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const clean = scrubber(env), before = implementationHash(), sources = snapshotSources(directory);
  const report = { kind: "bounded-live-terminal-check", runId, executionKind: "live",
    model: options.model, terminalDriver: options.terminalDriver, startedAt: new Date().toISOString(),
    durationRequiredSeconds: options.durationSeconds, payloadBytes: options.payloadBytes,
    responseWords: options.responseWords, implementationHash: before, hoursLongSoakCertified: false };
  writeJson(path.join(directory, "freeze.json"), { ...report, sources });
  try {
    report.preflight = await preflight({ bin, models: [options.model], env,
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)].filter(Boolean)) });
    if (!report.preflight.models.every(model => model.available)) throw new Error("The exact requested model is unavailable.");
    const laneDirectory = path.join(directory, "terminal");
    report.supervisor = await supervise({ ...options, bin, runId, kind: "terminal", executionKind: "live",
      expectedImplementationHash: before, directory: laneDirectory, workRoot: path.join(directory, "supervisor-work"),
      intervalSeconds: 2, gracefulShutdownMs: 45000, timeoutMs: (options.durationSeconds + 480) * 1000 },
    { signal, env, workerFile: path.join(directory, "source-snapshot/scripts/soak/worker.mjs") });
    const resultFile = path.join(laneDirectory, "report.json");
    if (fs.existsSync(resultFile)) report.result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    else report.error = "No complete terminal lane report; inspect the worker log and partial evidence.";
  } catch (error) { report.error = clean(error.message); }
  finally {
    report.interrupted = signal?.aborted === true;
    report.finishedAt = new Date().toISOString();
    report.implementationUnchanged = implementationHash() === before;
    report.frozenSourceUnchanged = verifyFrozenSources(directory, sources);
    report.passed = !report.interrupted && !report.error && report.implementationUnchanged && report.frozenSourceUnchanged &&
      report.supervisor?.code === 0 && report.supervisor.processGroupGone && !report.supervisor.error && !report.supervisor.killed &&
      report.result?.durationMet === true && report.result.failed === 0 && !report.result.cleanupError && !report.result.evidenceError;
    writeJson(path.join(directory, "report.json"), clean(report));
  }
  return { directory, report };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.mode === "plan") {
    console.log(JSON.stringify({ ...options, modelCalls: 0, contextOverrides: false, hoursLongSoakCertified: false }, null, 2));
    return 0;
  }
  const controller = new AbortController();
  const stop = () => controller.abort(Object.assign(new Error("Interrupted"), { name: "AbortError" }));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const { directory, report } = await runTerminalCheck(options, { signal: controller.signal });
    console.log(JSON.stringify({ directory, passed: report.passed, interrupted: report.interrupted,
      turns: report.result?.turns, verifiedModelResponses: report.result?.evidence?.completed,
      coveredSeconds: report.result?.coveredSeconds, error: report.error ?? report.result?.error }, null, 2));
    return report.passed ? 0 : 1;
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(scrubber()(error.message)); process.exitCode = 2;
  });
}
