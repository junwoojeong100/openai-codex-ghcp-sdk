import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { NATIVE_SCENARIOS, EXECUTION_BUDGET, catalogFingerprint } from "./catalog.mjs";
import { CaseExecutor } from "./execute.mjs";
import { evaluate } from "./oracles.mjs";
import { preflight } from "./preflight.mjs";
import { artifactContents } from "./artifacts.mjs";
import { mkdir, safeRead, sha, writeJson, scrubber, statusFor } from "./util.mjs";

async function main() {
  const config = JSON.parse(safeRead(process.argv[2], 32_768));
  const started = performance.now(), clean = scrubber();
  const signal = AbortSignal.timeout(Math.max(1, config.timeoutMs - EXECUTION_BUDGET.caseCleanupReserveSeconds * 1000));
  if (config.action === "preflight") {
    let outcome;
    try { outcome = { status: "passed", value: await preflight({ ...config, signal }) }; }
    catch (error) { outcome = { status: statusFor(error), error: clean(error.message) }; }
    writeJson(path.join(config.directory, "preflight.json"), outcome); return;
  }
  const scenario = NATIVE_SCENARIOS.find(s => s.id === config.scenarioId);
  if (!scenario || config.catalogHash !== catalogFingerprint()) throw new Error("Worker contract mismatch");
  const executor = new CaseExecutor({ ...config, scenario, signal });
  // Partial evidence is diagnostic only: it can never earn a passing cell.
  const partial = setInterval(() => {
    try { writeJson(path.join(config.directory, "observation.partial.json"), scrubber(process.env, [executor.token])(executor.observation)); }
    catch { /* The supervisor will retain its own failure/timeout receipt. */ }
  }, 500);
  let error;
  try { await executor.prepare(); await executor.execute(); }
  catch (failure) { error = failure; }
  let evidence;
  try { evidence = await executor.finish(); }
  catch (failure) { error ??= failure; evidence = executor.observation; evidence.resources = { cleaned: false, errors: [failure.message] }; }
  clearInterval(partial);
  evidence = scrubber(process.env, [executor.token])(evidence);
  const checks = evaluate(scenario, evidence);
  const status = error ? statusFor(error) : checks.every(c => c.passed) ? "passed" : "failed";
  const manifest = { scenarioId: scenario.id, provider: config.provider, model: config.model, catalogHash: config.catalogHash,
    runId: config.runId, executionKind: "live", durationMs: Math.ceil(performance.now() - started), status,
    category: error?.category || (status === "passed" ? null : "undetermined"),
    error: error ? clean(error.message) : null, checks, files: {} };
  mkdir(config.directory);
  for (const [name, text] of Object.entries(artifactContents(config, scenario, evidence, checks, status))) {
    fs.writeFileSync(path.join(config.directory, name), text, { mode: 0o600 });
    manifest.files[name] = { sha256: sha(text), bytes: Buffer.byteLength(text) };
  }
  writeJson(path.join(config.directory, "result.json"), manifest);
}
main().catch(error => { console.error(scrubber()(error.message)); process.exitCode = 1; });
