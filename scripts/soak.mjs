#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSoak, NATIVE_LANES, SOAK_SECONDS } from "./soak/runner.mjs";

export function parseArguments(args) {
  const options = { mode: "plan" }, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw new Error(`Duplicate option ${key}`); seen.add(key);
    if (["--plan", "--execute", "--smoke"].includes(key)) {
      if (options.mode !== "plan" || (key !== "--plan" && seen.has("--plan"))) throw new Error("Choose one soak action");
      options.mode = key.slice(2);
    } else if (["--output", "--duration-seconds", "--bin"].includes(key)) {
      const value = args[++i]; if (!value || value.startsWith("-")) throw new Error(`Missing ${key}`);
      options[key === "--duration-seconds" ? "durationSeconds" : key.slice(2)] =
        key === "--duration-seconds" ? Number(value) : value;
    } else if (key === "--terminal") options.terminal = true;
    else throw new Error(`Unknown option ${key}`);
  }
  if (options.durationSeconds !== undefined && (!Number.isSafeInteger(options.durationSeconds) ||
    options.durationSeconds < (options.mode === "smoke" ? 1 : SOAK_SECONDS))) throw new Error("Invalid soak duration");
  if (options.mode === "plan" && (options.output || options.bin)) throw new Error("Output/bin require execution");
  return options;
}
export async function main(args = process.argv.slice(2)) {
  const { mode, ...options } = parseArguments(args);
  if (mode === "plan") {
    console.log(JSON.stringify({ kind: "five-hour-soak-plan", modelCalls: 0, requiredSeconds: SOAK_SECONDS,
      nativeLanes: NATIVE_LANES, terminalRequested: options.terminal === true,
      controlledContextOverridesAreNotModelCapacityChanges: true }, null, 2));
    return 0;
  }
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Interrupted"));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const { directory, report } = await runSoak({ ...options, smoke: mode === "smoke", signal: controller.signal });
    console.log(JSON.stringify({ directory, durationMet: report.durationMet, elapsedSeconds: report.elapsedSeconds,
      allLanesCompleted: report.allLanesCompleted, noObservedFailures: report.noObservedFailures }, null, 2));
    return report.allLanesCompleted && report.noObservedFailures && report.frozenSourceUnchanged ? 0 : 1;
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
