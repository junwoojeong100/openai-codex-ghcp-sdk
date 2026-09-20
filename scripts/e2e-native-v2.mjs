#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_FEATURES, NATIVE_MODELS } from "./native/catalog.mjs";
import { runnerPlan } from "./native/plan.mjs";
import { runNativeValidation, validateExecutionOptions } from "./native/runner.mjs";
import { verifyNativeReport } from "./native/report.mjs";
import { freshDirectory, redactor, writeJson } from "./validation/evidence.mjs";

export const usage = `Usage: node scripts/e2e-native-v2.mjs [mode] [options]

Modes (default: --prepare; no model calls):
  --prepare           Report driver/oracle readiness without starting processes
  --execute           Full acceptance: all 207 scenarios, all seven models,
                      complete harness and a current offline preparation proof
  --run-selected      Explicit native diagnostic run of READY selected scenarios;
                      not a substitute for the full acceptance gate
  --verify REPORT     Re-evaluate retained native evidence, without model calls

Options:
  --models IDS        Comma-separated exact IDs or all; explicit for live runs
  --scenarios IDS     Comma-separated exact native scenario IDs
  --feature ID        Select the three scenarios of one native feature
  --output DIR        New private result directory; never overwrite existing data
  --preparation FILE  Current preparation-checks.json for this exact selection
  --timeout-ms N      Per-case deadline, 1..900000 (default 240000)
  --concurrency N     Model lanes, 1..3 (default 1)
  --help              Show this help

GHCP_E2E_MODELS, GHCP_E2E_SCENARIOS, GHCP_E2E_OUTPUT_DIR,
GHCP_E2E_PREPARATION_REPORT and GHCP_E2E_CONCURRENCY are also supported.
Live runs consume GitHub Copilot account usage. All 1,449 matrix slots remain in
reports. Partial/missing drivers cannot run as successful diagnostic scenarios.
No user daemon, credentials, user configuration, or sibling repository is changed.
`;

export function parseRunnerArguments(args, env = {}) {
  const options = { mode: "prepare", models: [...NATIVE_MODELS], timeoutMs: 240_000, concurrency: 1 };
  const seen = new Set();
  let explicitModels = false;
  let explicitSelection = false;
  const take = (index, flag) => {
    const value = args[index + 1];
    if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value.`);
    return value;
  };
  const models = (value) => value === "all" ? [...NATIVE_MODELS] : value.split(",").map((item) => item.trim());
  if (env.GHCP_E2E_MODELS) { options.models = models(env.GHCP_E2E_MODELS); explicitModels = true; }
  if (env.GHCP_E2E_SCENARIOS) { options.selected = env.GHCP_E2E_SCENARIOS.split(",").map((item) => item.trim()); explicitSelection = true; }
  if (env.GHCP_E2E_OUTPUT_DIR) options.output = path.resolve(env.GHCP_E2E_OUTPUT_DIR);
  if (env.GHCP_E2E_PREPARATION_REPORT) options.preparation = path.resolve(env.GHCP_E2E_PREPARATION_REPORT);
  if (env.GHCP_E2E_CONCURRENCY) options.concurrency = Number(env.GHCP_E2E_CONCURRENCY);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (["--prepare", "--execute", "--run-selected", "--verify"].includes(flag)) {
      if (["--prepare", "--execute", "--run-selected", "--verify"].filter((key) => seen.has(key)).length > 1) throw new Error("Choose one runner mode.");
      options.mode = flag.slice(2);
      if (flag === "--verify") options.report = path.resolve(take(index++, flag));
    } else if (flag === "--models") { options.models = models(take(index++, flag)); explicitModels = true; }
    else if (flag === "--scenarios") { options.selected = take(index++, flag).split(",").map((id) => id.trim()); explicitSelection = true; }
    else if (flag === "--feature") {
      const id = take(index++, flag);
      const feature = NATIVE_FEATURES.find((entry) => entry.id === id);
      if (!feature) throw new Error(`Unknown native feature: ${id}`);
      options.selected = feature.scenarios.map((scenario) => scenario.id);
      explicitSelection = true;
    } else if (flag === "--output") options.output = path.resolve(take(index++, flag));
    else if (flag === "--preparation") options.preparation = path.resolve(take(index++, flag));
    else if (flag === "--timeout-ms" || flag === "--concurrency") {
      const value = take(index++, flag);
      if (!/^[0-9]+$/.test(value)) throw new Error(`${flag} must be an integer.`);
      options[flag === "--timeout-ms" ? "timeoutMs" : "concurrency"] = Number(value);
    } else if (flag === "--help" || flag === "-h") options.help = true;
    else throw new Error(`Unknown runner argument: ${flag}`);
  }
  if (options.help) return options;
  if (seen.has("--feature") && (seen.has("--scenarios") || env.GHCP_E2E_SCENARIOS)) throw new Error("Use --feature or --scenarios, not both.");
  if (options.mode === "verify") {
    if ([...seen].some((flag) => !["--verify"].includes(flag))) throw new Error("--verify cannot be combined with execution options.");
    return options;
  }
  if (["execute", "run-selected"].includes(options.mode) && !explicitModels) throw new Error("Live native execution requires explicit --models (or GHCP_E2E_MODELS).");
  if (options.mode === "run-selected" && !explicitSelection) throw new Error("--run-selected requires exact --scenarios or --feature selection.");
  options.scope = options.mode === "run-selected" ? "selected" : "acceptance";
  validateExecutionOptions(options);
  runnerPlan(options); // Validate IDs even for preparation; no native/model calls.
  return options;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseRunnerArguments(argv, env);
  if (options.help) { console.log(usage); return 0; }
  if (options.mode === "prepare") {
    const plan = runnerPlan(options);
    if (options.output) writeJson(path.join(freshDirectory(options.output), "plan.json"), plan);
    console.log(JSON.stringify(plan, null, 2));
    return plan.readyToExecute ? 0 : 1;
  }
  if (options.mode === "verify") {
    const result = verifyNativeReport(options.report);
    console.log(JSON.stringify(result, null, 2));
    return result.selectedScopePassed ? 0 : 1;
  }
  const controller = new AbortController();
  let interrupted;
  const cancel = (name) => { interrupted ??= name; controller.abort(new Error(`Interrupted by ${name}.`)); };
  const onInt = () => cancel("SIGINT");
  const onTerm = () => cancel("SIGTERM");
  process.on("SIGINT", onInt); process.on("SIGTERM", onTerm);
  try {
    const { report, directory } = await runNativeValidation({ ...options, env, signal: controller.signal }, {
      onProgress: (row) => console.error(`${row.status.toUpperCase()} ${row.model} ${row.scenarioId} (${row.durationMs} ms)`),
    });
    // Check the persisted artifacts, not only the in-memory result booleans.
    const verified = verifyNativeReport(path.join(directory, "results.json"));
    console.log(JSON.stringify({ report: path.join(directory, "results.json"), ...verified }, null, 2));
    return interrupted ? interrupted === "SIGINT" ? 130 : 143
      : options.scope === "acceptance" ? report.summary.fullMatrixPassed ? 0 : 1 : verified.selectedScopePassed ? 0 : 1;
  } finally {
    process.off("SIGINT", onInt); process.off("SIGTERM", onTerm);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(redactor()(`${error.name}: ${error.message}`)); process.exitCode = 2;
  });
}
