#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG, SCENARIOS } from "./verification/catalog.mjs";
import { scrubber, writeJson } from "./verification/util.mjs";

export function parseArguments(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { mode: "help" };
  const options = { mode: "plan" }, seen = new Set();
  let action = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (["--plan", "--execute", "--verify"].includes(flag)) {
      if (action) throw new Error("Choose one action");
      action = true; options.mode = flag.slice(2);
    }
    if (["--output", "--verify"].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error(`Missing value: ${flag}`);
      options[flag === "--output" ? "output" : "file"] = value;
    } else if (!["--plan", "--execute"].includes(flag)) throw new Error(`Unknown option: ${flag}. There is one contract, with no profiles, subsets or case retries.`);
  }
  if (options.output && options.mode !== "execute") throw new Error("--output requires --execute");
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (["plan", "help"].includes(options.mode)) {
    console.log(`${CATALOG.id}: ${SCENARIOS.length} essential scenarios x ${CATALOG.models.length} models = ${CATALOG.totalCases} cases\n`);
    for (const row of SCENARIOS) console.log(`${row.id}  ${row.name}`);
    console.log("\nRun: npm run verify -- --execute\nSaved report: report.md; evidence is automatically recomputed.\nRecheck only: npm run verify -- --verify PATH/report.json\nPass: all 36 cases. No percentage target or alternative profile.\nThis plan makes no model calls. --execute consumes Copilot usage.");
    return 0;
  }
  const { verifyReport } = await import("./verification/report.mjs");
  if (options.mode === "verify") {
    const result = verifyReport(options.file);
    console.log(JSON.stringify(result, null, 2));
    return result.fullMatrixPassed ? 0 : 1;
  }
  const { runVerification } = await import("./verification/runner.mjs");
  const controller = new AbortController(), stop = () => controller.abort(new Error("Verification interrupted"));
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    const { directory } = await runVerification({ output: options.output, signal: controller.signal,
      onProgress: row => console.error(`${row.model} ${row.scenarioId}: ${row.status}${row.failedChecks?.length ? ` (${row.failedChecks.join(", ")})` : ""}`) });
    const result = verifyReport(path.join(directory, "report.json"));
    writeJson(path.join(directory, "verification.json"), result);
    console.log(JSON.stringify({ report: path.join(directory, "report.md"), ...result }, null, 2));
    return result.fullMatrixPassed ? 0 : 1;
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(scrubber()(error.message)); process.exitCode = 2; });
}
