#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrubber } from "./compatibility/util.mjs";
import { TUI_CATALOG, tuiCatalogHash } from "./tui/catalog.mjs";

export function parseArguments(args) {
  const options = { mode: "plan" }, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (seen.has(key)) throw new Error(`Duplicate option ${key}`);
    seen.add(key);
    if (key === "--plan" || key === "--execute") {
      if (seen.has("--plan") && seen.has("--execute") || seen.has("--verify")) throw new Error("Choose exactly one action");
      options.mode = key.slice(2);
    } else if (key === "--verify" || key === "--output") {
      const value = args[++i];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${key}`);
      if (key === "--verify") { if (seen.has("--plan") || seen.has("--execute")) throw new Error("Choose exactly one action"); options.mode = "verify"; options.file = value; }
      else options.output = value;
    } else throw new Error(`Unknown option ${key}; the TUI matrix has no subset, model or retry options`);
  }
  if (options.output && options.mode !== "execute") throw new Error("--output requires --execute");
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.mode === "plan") {
    console.log(JSON.stringify({ ...TUI_CATALOG, catalogHash: tuiCatalogHash(), modelCalls: 0 }, null, 2));
    return 0;
  }
  if (options.mode === "verify") {
    const { verifyTuiReport } = await import("./tui/runner.mjs");
    const result = verifyTuiReport(path.resolve(options.file));
    console.log(JSON.stringify(result, null, 2));
    return result.thresholdMet ? 0 : 1;
  }
  const { runTui } = await import("./tui/runner.mjs");
  const controller = new AbortController(), stop = () => controller.abort(Object.assign(new Error("Interrupted"), { name: "AbortError" }));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const { directory, report } = await runTui({ output: options.output, signal: controller.signal,
      onProgress: row => console.error(`${row.model} ${row.scenarioId}: ${row.status}${row.failedChecks?.length ? ` (${row.failedChecks.join(", ")})` : ""}`) });
    console.log(JSON.stringify({ directory, ...report.summary }, null, 2));
    return report.summary.thresholdMet ? 0 : 1;
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(scrubber()(error.message)); process.exitCode = 2; });
}
