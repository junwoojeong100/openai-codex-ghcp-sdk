#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_FEATURES } from "./native/catalog.mjs";
import { assessScenarioDesign, runnerPlan } from "./native/plan.mjs";
import { verifyNativeReport } from "./native/report.mjs";

export function main(args = process.argv.slice(2)) {
  if (!args.length || args.length === 1 && args[0] === "--design") {
    const design = assessScenarioDesign();
    console.log(JSON.stringify(design, null, 2));
    return design.complete ? 0 : 1;
  }
  if (args.length === 2 && args[0] === "--feature") {
    const feature = NATIVE_FEATURES.find(({ id }) => id === args[1]);
    if (!feature) throw new Error(`Unknown native feature: ${args[1]}`);
    console.log(JSON.stringify({ ...feature, readiness: runnerPlan({ selected: feature.scenarios.map(({ id }) => id) }).scenarios }, null, 2));
    return 0;
  }
  if (args.length === 1 && !args[0].startsWith("-")) {
    const result = verifyNativeReport(args[0]);
    console.log(JSON.stringify(result, null, 2));
    return result.fullMatrixPassed ? 0 : 1;
  }
  throw new Error("Usage: node scripts/native-coverage.mjs --design | --feature ID | results.json");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
