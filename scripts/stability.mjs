#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "./stability/catalog.mjs";
import { runStability } from "./stability/runner.mjs";
import { verifyReport } from "./stability/report.mjs";
import { scrubber } from "./compatibility/util.mjs";

export function parseArguments(args) {
  const options = { mode: "plan" }, seen = new Set(); let action = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; if (seen.has(key)) throw new Error(`Duplicate option ${key}`); seen.add(key);
    if (["--plan", "--execute", "--runtime", "--verify"].includes(key)) {
      if (action) throw new Error("Choose exactly one action"); action = true; options.mode = key.slice(2);
      if (key !== "--verify") continue;
    }
    if (["--verify", "--output", "--bin"].includes(key)) {
      const value = args[++i]; if (!value || value.startsWith("-")) throw new Error(`Missing value for ${key}`);
      options[key === "--verify" ? "file" : key.slice(2)] = value;
    } else throw new Error(`Unknown option ${key}`);
  }
  if (!["execute", "runtime"].includes(options.mode) && (options.output || options.bin)) throw new Error("Output/bin options require execute or runtime");
  return options;
}
export async function main(args = process.argv.slice(2)) {
  const { mode, file, ...options } = parseArguments(args);
  if (mode === "plan") { console.log(JSON.stringify({ ...CATALOG, modelCalls: 0, liveCompatibilityVerified: false }, null, 2)); return 0; }
  if (mode === "verify") {
    const result = verifyReport(path.resolve(file)); console.log(JSON.stringify(result, null, 2));
    return result.fullMatrixPassed || result.offlineHarnessPassed ? 0 : 1;
  }
  const controller = new AbortController(), interrupt = () => controller.abort(Object.assign(new Error("Interrupted"), { name: "AbortError" }));
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    const { directory, report } = await runStability({ ...options, executionKind: mode === "runtime" ? "offline-self-test" : "live",
      signal: controller.signal, onProgress: r => console.error(`${r.model} ${r.scenario}: ${r.status}`) });
    console.log(JSON.stringify({ directory, ...report.summary }, null, 2));
    return report.summary.fullMatrixPassed || report.summary.offlineHarnessPassed ? 0 : 1;
  } finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(scrubber()(error.message)); process.exitCode = 2; });
}
