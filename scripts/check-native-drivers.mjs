#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { NativeFixture } from "./native/fixture.mjs";
import { runnerPlan } from "./native/plan.mjs";
import { runNativeValidation } from "./native/runner.mjs";
import { verifyNativeReport } from "./native/report.mjs";
import { ROOT, redactor } from "./validation/evidence.mjs";
import { parseRunnerArguments } from "./e2e-native-v2.mjs";
import { ScriptedNativeSdk } from "../test/helpers/native-scripted-sdk.mjs";

// An expected unsupported boundary can pass a HARNESS self-test without
// becoming a compatible feature. The original matrix status is never changed.
export function driverSelfTestSummary(report, verified) {
  assert.equal(report.executionKind, "offline-self-test", "This command accepts only offline self-test evidence.");
  assert.equal(verified.executionKind, report.executionKind);
  assert.equal(verified.evidenceIntegrity, true);
  const plan = runnerPlan({ models: report.selectedModels, selected: report.selectedScenarioIds });
  const selected = report.cases.filter((row) => plan.models.includes(row.model) && plan.selectedScenarioIds.includes(row.scenarioId));
  const mismatches = selected.flatMap((row) => {
    const preparation = plan.scenarios.find(({ scenarioId }) => scenarioId === row.scenarioId);
    const expected = preparation.expectedOutcome === "unsupported" ? "unsupported" : "passed";
    const checks = row.attempts.at(-1)?.checks;
    return preparation.status === "ready" && row.status === expected && checks &&
      ["primary", "secondary", "route", "isolation", "cleanup"].every((key) => checks[key]?.passed === true)
      ? [] : [{ model: row.model, scenarioId: row.scenarioId, expected, actual: row.status }];
  });
  return { realModelCalls: 0, executionKind: report.executionKind, checkedSlots: selected.length,
    harnessChecksPassed: Boolean(report.finishedAt) && !report.interrupted && !report.runnerError &&
      report.implementationUnchanged === true && selected.length === plan.selectedModelCaseSlots && mismatches.length === 0,
    mismatches, selectedCounts: verified.selectedCounts, fullMatrixPassed: false, liveCompatibilityCredit: false };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseRunnerArguments(args, {});
  if (options.help) {
    console.log("Usage: node scripts/check-native-drivers.mjs [--models IDS] [--scenarios IDS | --feature ID] [--output NEW_DIR]\n       node scripts/check-native-drivers.mjs --verify RESULTS_JSON\nReal Codex + scripted SDK; no model calls or compatibility credit. Defaults to all ready scenarios, including unsupported-boundary checks, on the synthetic gpt-6-astra identity."); return 0;
  }
  if (options.mode === "verify") {
    const verified = verifyNativeReport(options.report, { allowOffline: true });
    const report = JSON.parse(fs.readFileSync(options.report, "utf8"));
    const summary = driverSelfTestSummary(report, verified);
    console.log(JSON.stringify({ report: options.report, ...summary }, null, 2));
    return summary.harnessChecksPassed ? 0 : 1;
  }
  if (options.mode !== "prepare" || options.preparation) throw new Error("Driver self-tests cannot execute real SDK/model requests.");
  const selected = options.selected ?? runnerPlan().scenarios.filter(({ status }) => status === "ready").map(({ scenarioId }) => scenarioId);
  const models = args.includes("--models") ? options.models : ["gpt-6-astra"];
  const timeoutMs = args.includes("--timeout-ms") ? options.timeoutMs : 20_000;
  const controller = new AbortController();
  const onInt = () => controller.abort(new Error("Interrupted driver self-test."));
  process.on("SIGINT", onInt); process.on("SIGTERM", onInt);
  try {
    const { report, directory } = await runNativeValidation({ ...options, models, selected, scope: "selected", timeoutMs,
      output: options.output ?? path.join(ROOT, ".runtime", `native-driver-self-test-${randomUUID()}`), signal: controller.signal }, {
      fixtureFactory: (settings) => new NativeFixture({ ...settings, clientFactory: () => new ScriptedNativeSdk() }),
      onProgress: ({ scenarioId, status }) => console.error(`${status.toUpperCase()} ${scenarioId} (scripted SDK; no live credit)`),
    });
    const verified = verifyNativeReport(path.join(directory, "results.json"), { allowOffline: true });
    const summary = driverSelfTestSummary(report, verified);
    console.log(JSON.stringify({ report: path.join(directory, "results.json"), ...summary }, null, 2));
    return controller.signal.aborted ? 130 : summary.harnessChecksPassed ? 0 : 1;
  } finally { process.off("SIGINT", onInt); process.off("SIGTERM", onInt); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(redactor()(error.message)); process.exitCode = 2; });
}
