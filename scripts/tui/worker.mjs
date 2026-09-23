// Runs one real-TUI case in a supervised, owned process group and records recomputable evidence.
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { writeJson, sha, scrubber } from "../compatibility/util.mjs";
import { TUI_SCENARIOS } from "./catalog.mjs";
import { TuiSession } from "./session.mjs";
import { evaluate, runScenario, sessionOptions } from "./scenarios.mjs";

export async function runCase(config, { signal } = {}) {
  const started = performance.now(), clean = scrubber(process.env);
  const scenario = TUI_SCENARIOS.find(item => item.id === config.scenarioId);
  if (!scenario) throw new Error("Unknown TUI scenario");
  fs.mkdirSync(config.directory, { recursive: true, mode: 0o700 });
  const options = sessionOptions(scenario, config.model, { ownedRoot: config.workRoot, seed: config.seed });
  const ledger = path.join(config.directory, "mcp-ledger.jsonl");
  if (options.mcpFixture) writeJson(options.mcpFixture.config, { ledger, nonce: options.mcpFixture.nonce, resourceCode: `RC_${config.seed}` });
  const session = new TuiSession({ directory: config.directory, model: options.model, ownedRoot: path.join(config.workRoot, "owned"),
    sandbox: options.sandbox, codexArgs: options.codexArgs, executionKind: config.executionKind, preload: config.preload });
  let facts = { seen: [] }, error = null;
  const onAbort = () => { void session.closeLaunch(); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    facts = await runScenario(scenario, session, { model: config.model, seed: config.seed, launchModel: options.model });
  } catch (caught) {
    error = clean({ name: caught.name, message: caught.message });
  } finally {
    signal?.removeEventListener("abort", onAbort);
    const evidence = await session.close();
    const mcpLedger = fs.existsSync(ledger) ? fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    facts = clean({ ...facts, seed: config.seed, launchModel: options.model, observer: session.observer(), evidence, error, mcpLedger });
  }
  const checks = evaluate(scenario, config.model, facts);
  const factsText = JSON.stringify(facts, null, 2) + "\n";
  fs.writeFileSync(path.join(config.directory, "facts.json"), factsText, { mode: 0o600 });
  const result = { runId: config.runId, catalogHash: config.catalogHash, implementationHash: config.implementationHash, executionKind: config.executionKind,
    model: config.model, scenarioId: scenario.id, seed: config.seed, status: checks.every(c => c.passed) ? "passed" : "failed",
    checks, error, durationMs: Math.ceil(performance.now() - started), factsHash: sha(factsText) };
  writeJson(path.join(config.directory, "result.json"), result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort(new Error("Owned TUI case cancellation")));
  runCase(config, { signal: controller.signal }).then(result => { process.exitCode = result ? 0 : 1; })
    .catch(error => { console.error(scrubber()(error.message)); process.exitCode = 1; });
}
