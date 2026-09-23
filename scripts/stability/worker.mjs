import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { SCENARIOS } from "./catalog.mjs";
import { profileForRecord } from "./profiles.mjs";
import { StabilityExecutor } from "./execute.mjs";
import { evaluate, failureCategory, metrics } from "./oracles.mjs";
import { artifacts, implementationHash } from "./report.mjs";
import { preflight } from "../compatibility/preflight.mjs";
import { safeRead, writeJson, mkdir, sha, scrubber, statusFor, run } from "../compatibility/util.mjs";

async function main() {
  const config = JSON.parse(safeRead(process.argv[2], 32768)), started = performance.now();
  if (!["live", "offline-self-test"].includes(config.executionKind)) throw new Error("Invalid execution kind");
  const selected = profileForRecord(config), CATALOG = selected.catalog;
  if (config.implementationHash !== implementationHash()) throw new Error("Worker source/contract differs from frozen run");
  const signal = AbortSignal.timeout(Math.max(1, config.timeoutMs - CATALOG.cleanupReserveSeconds * 1000));
  if (config.action === "preflight") {
    let result;
    try {
      let value;
      if (config.executionKind === "live") value = await preflight({ ...config, signal });
      else {
        const version = await run(config.bin, ["--version"], { signal });
        if (version.code || version.stdout.trim() !== `codex-cli ${CATALOG.versions.codex}`) throw new Error("Wrong native Codex version");
        value = { codexVersion: version.stdout.trim(), modelCalls: 0, models: config.models.map(id => ({ id, available: true, mechanicalPeer: true })) };
      }
      result = { status: "passed", value };
    } catch (error) { result = { status: "blocked", error: scrubber()(error.message) }; }
    writeJson(path.join(config.directory, "preflight.json"), result); return;
  }
  const scenario = SCENARIOS.find(s => s.id === config.scenarioId); if (!scenario) throw new Error("Unknown stability scenario");
  let clientFactory;
  if (config.executionKind === "offline-self-test") {
    const { StabilityScriptedSdk } = await import("../../test/helpers/stability-scripted-sdk.mjs");
    clientFactory = () => new StabilityScriptedSdk();
  }
  const executor = new StabilityExecutor({ ...config, scenario, signal, clientFactory });
  let error, evidence;
  const partial = setInterval(() => {
    try { writeJson(path.join(config.directory, "observation.partial.json"), scrubber(process.env, [executor.token])(executor.observation)); } catch { /* Partial evidence cannot pass. */ }
  }, 1000);
  try { await executor.prepare(); await executor.execute(); } catch (failure) { error = failure; }
  try { evidence = await executor.finish(); } catch (failure) {
    error ??= failure; evidence = executor.observation; evidence.resources = { cleaned: false, errors: [failure.message] };
  } finally { clearInterval(partial); }
  evidence = scrubber(process.env, [executor.token])(evidence);
  const checks = evaluate(scenario, evidence, selected.name), status = error ? statusFor(error) : checks.every(c => c.passed) ? "passed" : "failed";
  const manifest = { runId: config.runId, scenarioId: scenario.id, model: config.model,
    profile: selected.name, catalogId: selected.catalog.id,
    executionKind: config.executionKind, catalogHash: config.catalogHash, implementationHash: config.implementationHash,
    durationMs: Math.ceil(performance.now() - started), status, error: error ? scrubber()(error.message) : null,
    category: status === "passed" ? null : failureCategory(evidence, checks) ?? error?.category ?? "undetermined",
    checks, metrics: metrics(evidence), files: {} };
  mkdir(config.directory);
  for (const [name, text] of Object.entries(artifacts(config, evidence, checks, status))) {
    fs.writeFileSync(path.join(config.directory, name), text, { mode: 0o600 });
    manifest.files[name] = { sha256: sha(text), bytes: Buffer.byteLength(text) };
  }
  writeJson(path.join(config.directory, "result.json"), manifest);
}
main().catch(error => { console.error(scrubber()(error.message)); process.exitCode = 2; });
