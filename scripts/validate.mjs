#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS, SUITES, validateModels } from "./validation/catalog.mjs";
import { freshDirectory, writeJson } from "./validation/evidence.mjs";
import { prepareValidation, runValidation, verifyReport } from "./validation/runner.mjs";

export const usage = `Usage: node scripts/validate.mjs [--prepare | --execute | --verify REPORT] [options]

Default: offline preparation only; no model calls or external processes.
  --models IDS       Comma-separated model IDs, or all (required with --execute)
  --suite NAME       full, smoke, protocol, cli (default: full)
  --scenarios IDS    Comma-separated exact scenario IDs; cannot combine with --suite
  --output DIR       New private result directory; existing paths are never overwritten
  --timeout-ms N     Per-case timeout, 1..900000 ms (default: 240000)
  --help             Show this help without starting a bridge

--execute uses existing Copilot authentication and incurs account usage.
Only selected cases run; all 168 matrix slots remain in the report.
No daemon stop command, authentication change or user-config write is performed.
Native CLI cases use real Codex + production provider arguments, an isolated
CODEX_HOME and --sandbox read-only; they do not invoke the production launcher.

Examples:
  npm run test:e2e:protocol -- --prepare
  npm run test:e2e:protocol -- --execute --models gpt-6-astra --suite smoke
  npm run test:e2e:protocol -- --execute --models all --suite full
  node scripts/validate.mjs --verify .runtime/validation/<run>/report.json
`;

export function parseArgs(args) {
  const options = { mode: "prepare", suite: "full", models: [...MODELS], timeoutMs: 240_000 };
  const seen = new Set();
  const take = (index, flag) => {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    return value;
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (["--prepare", "--execute", "--verify"].includes(flag)) {
      if (["--prepare", "--execute", "--verify"].filter((name) => seen.has(name)).length > 1) throw new Error("Choose one execution mode.");
      options.mode = flag.slice(2);
      if (flag === "--verify") options.report = take(index++, flag);
    } else if (flag === "--models") {
      const value = take(index++, flag);
      options.models = value === "all" ? [...MODELS] : value.split(",").map((item) => item.trim());
    } else if (flag === "--suite") options.suite = take(index++, flag);
    else if (flag === "--scenarios") options.scenarios = take(index++, flag).split(",").map((item) => item.trim());
    else if (flag === "--output") options.output = path.resolve(take(index++, flag));
    else if (flag === "--timeout-ms") {
      const value = take(index++, flag);
      if (!/^[0-9]+$/.test(value)) throw new Error("--timeout-ms must be an integer.");
      options.timeoutMs = Number(value);
    } else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  validateModels(options.models);
  if (!Object.hasOwn(SUITES, options.suite)) throw new Error(`Unknown suite: ${options.suite}`);
  if (seen.has("--suite") && seen.has("--scenarios")) throw new Error("Use --suite or --scenarios, not both.");
  if (options.mode === "execute" && !seen.has("--models")) throw new Error("Live execution requires an explicit --models selection (or all).");
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 900_000) throw new Error("--timeout-ms must be between 1 and 900000.");
  if (options.mode === "verify" && [...seen].some((flag) => !["--verify", "--help", "-h"].includes(flag))) throw new Error("--verify cannot be combined with execution/selection options.");
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { console.log(usage); return 0; }
  if (options.mode === "prepare") {
    const plan = prepareValidation(options);
    if (options.output) writeJson(path.join(freshDirectory(options.output), "plan.json"), plan);
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }
  if (options.mode === "verify") {
    const result = verifyReport(options.report);
    console.log(JSON.stringify(result, null, 2));
    return result.selectedScopePassed ? 0 : 1;
  }
  const controller = new AbortController();
  let signalName;
  const interrupt = (signal) => {
    signalName ??= signal;
    controller.abort(Object.assign(new Error(`Interrupted by ${signal}.`), { name: "AbortError" }));
  };
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  try {
    const { report, directory } = await runValidation({ ...options, signal: controller.signal }, {
      onProgress: (record) => console.error(`${record.status.toUpperCase()} ${record.model} ${record.scenarioId} (${record.durationMs} ms)`),
    });
    console.log(JSON.stringify({ report: path.join(directory, "report.json"), executionKind: report.executionKind, ...report.summary }, null, 2));
    return signalName ? signalName === "SIGINT" ? 130 : 143 : report.summary.selectedScopePassed ? 0 : 1;
  } finally {
    process.removeListener("SIGINT", onInt);
    process.removeListener("SIGTERM", onTerm);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  });
}
