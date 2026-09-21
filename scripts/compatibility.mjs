#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDesign } from "./compatibility/design.mjs";
import { runCompatibility } from "./compatibility/runner.mjs";
import { verifyReport } from "./compatibility/report.mjs";
import { scrubber } from "./compatibility/util.mjs";

import { NATIVE_SCENARIOS, NATIVE_MODELS, TOTAL_CASES } from "./compatibility/catalog.mjs";

export const usage = `Codex/GHCP integrated workflow verification: ${NATIVE_SCENARIOS.length} scenarios × ${NATIVE_MODELS.length} models = ${TOTAL_CASES} cases

node scripts/compatibility.mjs --plan
node scripts/compatibility.mjs --execute [--output NEW_DIR] [--bin NATIVE_CODEX]
node scripts/compatibility.mjs --verify REPORT_JSON

Default: --plan (offline, no model calls or credential access).
Live execution always uses all seven exact catalog IDs and all current scenarios.
No fast/subset suite, native OpenAI comparison or overall time cutoff.
Individual case deadlines remain; failures do not skip later cases.
Requires Copilot authentication, Codex 0.154.0 and macOS/Linux. No OpenAI API key.
Exit: 0 = valid plan / all ${TOTAL_CASES} passed; 1 = failed/blocked/incomplete; 2 = invalid arguments/evidence.
`;
export function parseArguments(args) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { mode: "help" };
  const options = { mode: "plan" }, seen = new Set(); let modeSet = false;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    if (["--plan", "--execute", "--verify"].includes(flag)) {
      if (modeSet) throw new Error("Choose exactly one action");
      options.mode = flag.slice(2); modeSet = true;
    }
    if (["--verify", "--output", "--bin"].includes(flag)) {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error(`Missing value: ${flag}`);
      options[flag === "--verify" ? "file" : flag.slice(2)] = value;
    } else if (!["--plan", "--execute"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
  }
  if (options.mode !== "execute" && (options.output || options.bin)) throw new Error("--output and --bin require --execute");
  return options;
}
export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.mode === "help") { console.log(usage); return 0; }
  if (options.mode === "plan") { console.log(JSON.stringify(validateDesign(), null, 2)); return 0; }
  if (options.mode === "verify") {
    const result = verifyReport(path.resolve(options.file)); console.log(JSON.stringify(result, null, 2)); return result.fullMatrixPassed ? 0 : 1;
  }
  const abort = new AbortController();
  const interrupt = () => abort.abort(Object.assign(new Error("Interrupted by user"), { name: "AbortError" }));
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    const { directory, report } = await runCompatibility({ ...options, signal: abort.signal,
      onProgress: row => console.error(`${row.model} ${row.scenario}: ${row.status}`) });
    console.log(JSON.stringify({ report: path.join(directory, "report.json"), ...report.summary }, null, 2));
    return report.summary.fullMatrixPassed ? 0 : 1;
  } finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(scrubber()(error.message)); process.exitCode = 2; });
}
