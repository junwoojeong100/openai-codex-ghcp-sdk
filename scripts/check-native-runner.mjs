#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRunnerArguments } from "./e2e-native-v2.mjs";
import { checkNativeRunner } from "./native/preparation.mjs";
import { redactor } from "./validation/evidence.mjs";

export async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseRunnerArguments(args, env);
  if (options.help) {
    console.log("Usage: node scripts/check-native-runner.mjs --output NEW_DIR [--models IDS] [--scenarios IDS | --feature ID]\nRuns every discovered offline test with production SDK/non-loopback network calls disabled. No model calls.");
    return 0;
  }
  if (options.mode !== "prepare" || options.preparation) throw new Error("Preparation checks cannot execute live models or verify a live report.");
  const controller = new AbortController();
  const onInt = () => controller.abort(new Error("Interrupted by SIGINT."));
  const onTerm = () => controller.abort(new Error("Interrupted by SIGTERM."));
  process.on("SIGINT", onInt); process.on("SIGTERM", onTerm);
  try {
    const { proof, directory } = await checkNativeRunner({ ...options, env, signal: controller.signal });
    console.log(JSON.stringify({ report: path.join(directory, "preparation-checks.json"), modelCalls: 0,
      checksPassed: proof.checksPassed, readyToExecute: proof.readyToExecute, readiness: proof.readiness,
      testFiles: proof.executions.length }, null, 2));
    return proof.checksPassed && proof.readyToExecute ? 0 : 1;
  } finally { process.off("SIGINT", onInt); process.off("SIGTERM", onTerm); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(redactor()(`${error.name}: ${error.message}`)); process.exitCode = 2; });
}
