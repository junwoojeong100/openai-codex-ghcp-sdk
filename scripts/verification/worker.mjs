import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { SCENARIOS } from "./catalog.mjs";
import { TuiSession, isExpectedTitleRejection } from "./session.mjs";
import { evaluate, recoveredTransportErrors, runScenario, sessionOptions } from "./scenarios.mjs";
import { writeJson, sha, scrubber } from "./util.mjs";

export async function runCase(config, { signal } = {}) {
  const started = performance.now(), clean = scrubber(), scenario = SCENARIOS.find(item => item.id === config.scenarioId);
  if (!scenario) throw new Error("Unknown verification scenario");
  if (config.executionKind === "live" && config.preload) throw new Error("Live verification cannot load an SDK double");
  if (!["live", "offline-self-test"].includes(config.executionKind)) throw new Error("Unknown execution kind");
  fs.mkdirSync(config.directory, { recursive: true, mode: 0o700 });
  const options = sessionOptions(scenario, config.model, { ownedRoot: config.workRoot, seed: config.seed });
  const ledger = path.join(config.directory, "mcp-ledger.jsonl");
  if (options.mcpFixture) writeJson(options.mcpFixture.config, { ledger, nonce: options.mcpFixture.nonce, resourceCode: `RC_${config.seed}` });
  const session = new TuiSession({ directory: config.directory, model: options.model, ownedRoot: path.join(config.workRoot, "owned"),
    env: { ...process.env, CODEX_BIN: config.bin || process.env.CODEX_BIN || "codex" },
    sandbox: options.sandbox, codexArgs: options.codexArgs, executionKind: config.executionKind, preload: config.preload });
  let facts = { answers: [] }, error = null;
  const abort = () => { void session.closeLaunch().catch(caught => { error ??= clean({ name: caught.name, message: caught.message }); }); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    facts = await runScenario(scenario, session, { model: config.model, seed: config.seed, facts });
  } catch (caught) {
    error = clean({ name: caught.name, message: caught.message });
  } finally {
    signal?.removeEventListener("abort", abort);
    const evidence = await session.close();
    const mcpLedger = fs.existsSync(ledger) ? fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    facts = clean({ ...facts, seed: config.seed, launchModel: options.model, observer: session.observer(), evidence, error, mcpLedger });
  }
  const checks = evaluate(scenario, config.model, facts), factsText = JSON.stringify(facts, null, 2) + "\n";
  fs.writeFileSync(path.join(config.directory, "facts.json"), factsText, { mode: 0o600 });
  const result = { runId: config.runId, catalogHash: config.catalogHash, implementationHash: config.implementationHash,
    executionKind: config.executionKind, model: config.model, scenarioId: scenario.id, seed: config.seed,
    status: checks.every(check => check.passed) ? "passed" : "failed", checks, error,
    auxiliaryTitleRejections: facts.observer.http.filter(isExpectedTitleRejection).length,
    recoveredTransportErrors: recoveredTransportErrors(facts),
    catalogRecoveries: facts.observer.diagnostics.filter(row => row.event === "bridge.upstream_catalog_recovered").length,
    durationMs: Math.ceil(performance.now() - started), factsHash: sha(factsText) };
  writeJson(path.join(config.directory, "result.json"), result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), controller = new AbortController();
  process.once("SIGTERM", () => controller.abort(new Error("Owned verification case cancellation")));
  runCase(config, { signal: controller.signal }).then(() => { process.exitCode = 0; })
    .catch(error => { console.error(scrubber()(error.message)); process.exitCode = 1; });
}
