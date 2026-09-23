// Full real-TUI matrix: every scenario for every supported model, from a frozen source snapshot.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";
import { preflight } from "../compatibility/preflight.mjs";
import { pool, freshDirectory } from "../compatibility/runner.mjs";
import { supervise, killOwnedGroup } from "../compatibility/supervisor.mjs";
import { ROOT, safeRead, scrubber, sha, writeJson } from "../compatibility/util.mjs";
import { snapshotSources, verifyFrozenSources } from "../soak/runner.mjs";
import { implementationHash } from "../stability/report.mjs";
import { TUI_CATALOG as C, TUI_SCENARIOS, tuiCatalogHash } from "./catalog.mjs";
import { evaluate } from "./scenarios.mjs";

function settings(env) {
  const codex = env.CODEX_HOME || path.join(env.HOME || os.homedir(), ".codex");
  return [path.join(codex, "config.toml"), path.join(codex, "auth.json"), path.join(resolveCopilotHome(env.COPILOT_HOME), "config.json")].map(file => {
    try { const stat = fs.lstatSync(file); return { pathHash: sha(file), hash: stat.isFile() ? sha(fs.readFileSync(file)) : null, mode: stat.mode }; }
    catch (error) { if (error.code !== "ENOENT") throw error; return { pathHash: sha(file), missing: true }; }
  });
}
export const tuiMatrix = () => C.models.flatMap(model => TUI_SCENARIOS.map(scenario => ({ model, scenarioId: scenario.id, status: "not-run" })));

export function summarizeTui(report) {
  const counts = Object.fromEntries(C.statuses.map(status => [status, report.cases.filter(row => row.status === status).length]));
  const complete = report.cases.map(r => `${r.model}/${r.scenarioId}`).join() === tuiMatrix().map(r => `${r.model}/${r.scenarioId}`).join();
  const eligible = complete && Boolean(report.finishedAt) && report.implementationUnchanged === true && report.frozenSourceUnchanged === true
    && report.userSettingsUnchanged === true && !report.interrupted && !report.error;
  return { catalogId: C.id, totalCases: C.totalCases, counts, passed: counts.passed, percent: counts.passed / C.totalCases * 100,
    fullMatrixPassed: report.executionKind === "live" && eligible && counts.passed === C.totalCases, eligible,
    perModel: C.models.map(model => {
      const rows = report.cases.filter(row => row.model === model), passed = rows.filter(row => row.status === "passed").length;
      return { model, passed, total: TUI_SCENARIOS.length, verdict: eligible && passed === TUI_SCENARIOS.length ? `${C.id}-passed` : "not-established" };
    }),
    perScenario: TUI_SCENARIOS.map(s => ({ scenarioId: s.id, passed: report.cases.filter(r => r.scenarioId === s.id && r.status === "passed").length, total: C.models.length })),
    driver: C.driver, realTuiThroughLauncher: true, hoursLongSoakCertified: false };
}

function markdown(report) {
  const rows = report.cases.map(r => `| ${r.model} | ${r.scenarioId} | ${r.status} | ${(r.failedChecks ?? []).join(", ")} |`);
  return [`# ${C.id}`, "", `Run ${report.runId} (${report.executionKind}); ${report.summary.passed}/${report.summary.totalCases} passed.`, "",
    "| Model | Scenario | Status | Failed checks |", "|---|---|---|---|", ...rows, ""].join("\n");
}

export async function runTui({ output, bin = process.env.CODEX_BIN || "codex", env = process.env, signal, onProgress = () => {} } = {}) {
  const runId = randomUUID(), clean = scrubber(env), started = performance.now();
  const directory = freshDirectory(output || path.join(ROOT, ".runtime", `tui-live-${runId}`));
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-tui-")));
  const sources = snapshotSources(directory), before = implementationHash(), beforeSettings = settings(env);
  const report = { schemaVersion: C.schemaVersion, catalogId: C.id, catalogHash: tuiCatalogHash(), implementationHash: before, runId,
    executionKind: "live", startedAt: new Date().toISOString(), finishedAt: null, cases: tuiMatrix() };
  const owned = new Set();
  const checkpoint = () => { report.summary = summarizeTui(report); writeJson(path.join(directory, "report.json"), clean(report));
    fs.writeFileSync(path.join(directory, "report.md"), clean(markdown(report)), { mode: 0o600 }); };
  const stop = () => { for (const pid of owned) { try { killOwnedGroup(pid, "SIGTERM"); } catch { /* receipts record failures */ } } };
  signal?.addEventListener("abort", stop, { once: true });
  writeJson(path.join(directory, "freeze.json"), { frozenAt: new Date().toISOString(), runId, catalog: C, catalogHash: report.catalogHash, implementationHash: before, sources });
  try {
    checkpoint();
    report.preflight = await preflight({ bin, models: C.models, env, signal: AbortSignal.any([signal, AbortSignal.timeout(C.preflightSeconds * 1000)].filter(Boolean)) });
    const workerFile = path.join(directory, "source-snapshot/scripts/tui/worker.mjs");
    await pool(C.models, C.concurrency, async model => {
      const rows = report.cases.filter(row => row.model === model);
      if (!report.preflight.models.find(m => m.id === model)?.available) { rows.forEach(row => Object.assign(row, { status: "blocked", reason: "Exact model unavailable; no fallback" })); checkpoint(); return; }
      for (const row of rows) {
        if (signal?.aborted) break;
        const scenario = TUI_SCENARIOS.find(s => s.id === row.scenarioId), relative = `cases/${model}/${scenario.id}`;
        const dir = path.join(directory, relative), work = path.join(temp, model, scenario.id);
        Object.assign(row, { startedAt: new Date().toISOString(), seed: randomBytes(4).toString("hex") });
        try {
          row.supervisor = await supervise({ directory: dir, workRoot: work, timeoutMs: scenario.seconds * 1000, gracefulShutdownMs: 25000,
            runId, model, scenarioId: scenario.id, seed: row.seed, executionKind: "live", catalogHash: report.catalogHash, implementationHash: before },
          { signal, env, workerFile, onGroup: (pid, live) => live ? owned.add(pid) : owned.delete(pid) });
          const resultFile = path.join(dir, "result.json");
          if (fs.existsSync(resultFile)) {
            const result = JSON.parse(safeRead(resultFile));
            Object.assign(row, { status: result.status, observedStatus: result.status, failedChecks: result.checks.filter(c => !c.passed).map(c => c.id),
              error: result.error, durationMs: result.durationMs, artifactPath: relative, resultHash: sha(fs.readFileSync(resultFile)) });
          } else Object.assign(row, { status: "failed", reason: "No complete result; see worker log and partial evidence", artifactPath: relative });
          if (row.supervisor.error?.name === "TimeoutError") row.status = "timed-out";
          else if (row.supervisor.code !== 0 || row.supervisor.error || !row.supervisor.processGroupGone) row.status = "failed";
          if (signal?.aborted) row.status = "not-run";
        } catch (error) { Object.assign(row, { status: signal?.aborted ? "not-run" : "failed", error: clean(error.message) }); }
        finally {
          try { fs.rmSync(work, { recursive: true, force: true }); } catch (error) { row.status = "failed"; row.error = clean(error.message); }
          checkpoint(); onProgress(row);
        }
      }
    });
  } catch (error) {
    report.error = clean(error.message);
    report.cases.filter(row => row.status === "not-run").forEach(row => Object.assign(row, { status: "blocked", reason: report.error }));
  } finally {
    signal?.removeEventListener("abort", stop);
    report.interrupted = signal?.aborted === true;
    report.finishedAt = new Date().toISOString();
    report.durationMs = Math.ceil(performance.now() - started);
    report.implementationUnchanged = implementationHash() === before;
    report.frozenSourceUnchanged = verifyFrozenSources(directory, sources);
    try { report.userSettingsUnchanged = JSON.stringify(beforeSettings) === JSON.stringify(settings(env)); } catch { report.userSettingsUnchanged = false; }
    fs.rmSync(temp, { recursive: true, force: true });
    checkpoint();
  }
  return { directory, report };
}

// Recompute every case from its saved facts; stored pass flags are not trusted.
export function verifyTuiReport(file) {
  const report = JSON.parse(safeRead(file)), directory = path.dirname(file);
  if (report.catalogId !== C.id || report.catalogHash !== tuiCatalogHash()) throw new Error("Historical or foreign report: verify with its frozen source snapshot.");
  if (report.cases.map(r => `${r.model}/${r.scenarioId}`).join() !== tuiMatrix().map(r => `${r.model}/${r.scenarioId}`).join()) throw new Error("Incomplete matrix");
  for (const row of report.cases) {
    if (!row.artifactPath) { if (row.status === "passed") throw new Error("A passing row has no evidence"); continue; }
    const dir = path.join(directory, row.artifactPath), resultFile = path.join(dir, "result.json");
    if (!fs.existsSync(resultFile)) { if (row.status === "passed") throw new Error(`Missing result for ${row.model}/${row.scenarioId}`); continue; }
    const bytes = fs.readFileSync(resultFile), result = JSON.parse(bytes), factsText = fs.readFileSync(path.join(dir, "facts.json"), "utf8");
    if (sha(bytes) !== row.resultHash || sha(factsText) !== result.factsHash) throw new Error(`Evidence hash mismatch for ${row.model}/${row.scenarioId}`);
    if (result.runId !== report.runId || result.model !== row.model || result.scenarioId !== row.scenarioId || result.seed !== row.seed) throw new Error("Case identity mismatch");
    const scenario = TUI_SCENARIOS.find(s => s.id === row.scenarioId), checks = evaluate(scenario, row.model, JSON.parse(factsText));
    if (JSON.stringify(checks) !== JSON.stringify(result.checks)) throw new Error(`Recomputed checks differ for ${row.model}/${row.scenarioId}`);
    const status = checks.every(c => c.passed) ? "passed" : "failed";
    if (status !== result.status || (row.status === "passed" && status !== "passed")) throw new Error(`Status mismatch for ${row.model}/${row.scenarioId}`);
  }
  return { evidenceIntegrity: true, ...summarizeTui(report) };
}
