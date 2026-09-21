#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NATIVE_SCENARIOS, EXECUTION_BUDGET } from "./compatibility/catalog.mjs";
import { CaseExecutor } from "./compatibility/execute.mjs";
import { Backend } from "./compatibility/backend.mjs";
import { evaluate } from "./compatibility/oracles.mjs";
import { run, mkdir, scrubber } from "./compatibility/util.mjs";
import { CoreScriptedSdk } from "../test/helpers/core-scripted-sdk.mjs";

export async function checkRuntime({ bin = process.env.CODEX_BIN || "codex", scenarios = NATIVE_SCENARIOS } = {}) {
  const version = await run(bin, ["--version"], { signal: AbortSignal.timeout(5000) });
  if (version.stdout.trim() !== "codex-cli 0.154.0") throw new Error("Runtime check requires codex-cli 0.154.0");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-compatibility-offline-")));
  const rows = [];
  try {
    for (const scenario of scenarios) {
      const signal = AbortSignal.timeout((scenario.timeoutSeconds - EXECUTION_BUDGET.caseCleanupReserveSeconds) * 1000);
      const f = new CaseExecutor({ directory: mkdir(path.join(root, "evidence", scenario.id)), workRoot: mkdir(path.join(root, scenario.id)),
        provider: "ghcp", model: "gpt-6-astra", scenario, seed: "offline-runtime-fixture", bin, signal,
        backendFactory: options => new Backend({ ...options, clientFactory: () => new CoreScriptedSdk(scenario.id) }) });
      let error;
      try { await f.prepare(); await f.execute(); } catch (e) { error = e; }
      const observation = await f.finish();
      const checks = evaluate(scenario, observation);
      const row = { id: scenario.id, passed: !error && checks.every(c => c.passed), error: error?.message,
        failedChecks: checks.filter(c => !c.passed).map(c => c.id) };
      rows.push(row);
      console.log(JSON.stringify(scrubber()(row)));
      // Only temporary fixture logs, deleted on exit. No compatibility report.
      if (!row.passed && (process.env.COMPATIBILITY_DEBUG === "1" || process.env.CORE10_DEBUG === "1")) console.error(JSON.stringify(scrubber(process.env, [f.token, f.httpToken])(observation), null, 2));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  return { executionKind: "offline-self-test", realModelCalls: 0, liveCompatibilityVerified: false, passed: rows.every(r => r.passed), cases: rows };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error("Usage: node scripts/check-compatibility-runtime.mjs");
  checkRuntime().then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.passed ? 0 : 1; })
    .catch(error => { console.error(scrubber()(error.message)); process.exitCode = 1; });
}
