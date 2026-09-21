import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NATIVE_SCENARIO_CATALOG as C, NATIVE_SCENARIOS, NATIVE_MODELS } from "./catalog.mjs";
import { validateDesign } from "./design.mjs";
import { supervise, killOwnedGroup } from "./supervisor.mjs";
import { newReport, summarize, readCase, markdownReport } from "./report.mjs";
import { ROOT, mkdir, writeJson, sha, safeRead, scrubber, implementationHash } from "./util.mjs";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";

function settingsSnapshot(env) {
  const home = env.CODEX_HOME || path.join(env.HOME || os.homedir(), ".codex");
  return [path.join(home, "config.toml"), path.join(home, "auth.json"), path.join(resolveCopilotHome(env.COPILOT_HOME), "config.json")].map(file => {
    try { const info = fs.lstatSync(file); return { path: file, hash: info.isFile() ? sha(fs.readFileSync(file)) : null,
      mode: info.mode, link: info.isSymbolicLink() ? fs.readlinkSync(file) : null }; }
    catch (error) { if (error.code !== "ENOENT") throw error; return { path: file, missing: true }; }
  });
}
export async function pool(items, concurrency, task) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency");
  let next = 0;
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) { const index = next++; if (index >= items.length) return; await task(items[index], index); }
  }));
  const failure = outcomes.find(r => r.status === "rejected"); if (failure) throw failure.reason;
}
export function freshDirectory(output) {
  const absolute = path.resolve(output), parent = path.dirname(absolute);
  mkdir(parent);
  if (fs.realpathSync(parent) !== parent) throw new Error("Output parent must not traverse a symlink");
  fs.mkdirSync(absolute, { mode: 0o700 }); // Never overwrite/reuse earlier evidence.
  return absolute;
}
export async function runCompatibility({ output, bin = process.env.CODEX_BIN || "codex", signal, env = process.env,
  onProgress = () => {}, workerSupervisor = supervise, ...unsupported } = {}) {
  if (Object.keys(unsupported).some(key => !["mode"].includes(key))) throw new Error("This runner always executes the complete current scenario matrix for all seven models.");
  validateDesign(); signal?.throwIfAborted();
  const runId = randomUUID(), started = performance.now(), clean = scrubber(env), beforeSettings = settingsSnapshot(env);
  const report = newReport({ runId, executionKind: workerSupervisor === supervise ? "live" : "offline-self-test" });
  const directory = freshDirectory(output ?? path.join(ROOT, ".runtime", `compatibility-${runId}`));
  const workRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-workflows-")));
  fs.chmodSync(workRoot, 0o700);
  const ownedGroups = new Set();
  const onGroup = (pid, active) => active ? ownedGroups.add(pid) : ownedGroups.delete(pid);
  const terminate = () => { for (const pid of ownedGroups) { try { killOwnedGroup(pid); } catch {} } };
  const checkpoint = () => {
    report.summary = summarize(report); writeJson(path.join(directory, "report.json"), clean(report));
    fs.writeFileSync(path.join(directory, "report.md"), clean(markdownReport(report)), { mode: 0o600 });
  };
  const launch = config => workerSupervisor({ bin, runId, seed: runId, provider: "ghcp", catalogHash: report.catalogHash, ...config }, { signal, env, onGroup });
  const caseTask = async row => {
    if (signal?.aborted) { row.reason = "User interrupted before this case"; return; }
    const scenario = NATIVE_SCENARIOS.find(s => s.id === row.scenarioId);
    const relative = `cases/${row.model}/${row.scenarioId}`, caseDir = path.join(directory, relative);
    const temporary = path.join(workRoot, row.model, row.scenarioId);
    try {
      row.startedAt = new Date().toISOString();
      const receipt = await launch({ action: "case", directory: caseDir, workRoot: temporary, model: row.model,
        scenarioId: row.scenarioId, timeoutMs: scenario.timeoutSeconds * 1000 });
      row.supervisor = receipt; row.durationMs = receipt.durationMs; row.processGroupGone = receipt.processGroupGone;
      if (fs.existsSync(path.join(caseDir, "result.json"))) {
        const { manifest } = readCase(caseDir, row, runId, report.catalogHash, report.executionKind);
        Object.assign(row, { artifactPath: relative, resultHash: sha(safeRead(path.join(caseDir, "result.json"))),
          observedStatus: manifest.status, status: manifest.status, error: manifest.error, category: manifest.category,
          metrics: manifest.metrics, failedChecks: manifest.checks.filter(c => !c.passed).map(c => c.id) });
      } else { row.status = "failed"; row.reason = "No complete result; retained partial evidence/worker log"; }
      if (receipt.error?.name === "TimeoutError") { row.status = "timed-out"; row.category = "timeout"; }
      else if (signal?.aborted) { row.status = "not-run"; row.category = "interrupted"; }
      else if (receipt.code !== 0 || !receipt.processGroupGone || receipt.error || receipt.killed) { row.status = "failed"; row.category = "harness"; }
      if (receipt.error) row.error = receipt.error.message;
    } catch (error) {
      row.status = signal?.aborted ? "not-run" : "failed"; row.error = clean(error.message); row.category = "harness";
    } finally {
      try { if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true }); }
      catch (error) { row.status = "failed"; row.error = `Fixture cleanup: ${clean(error.message)}`; }
      checkpoint(); onProgress({ model: row.model, scenario: row.scenarioId, status: row.status });
    }
  };
  signal?.addEventListener("abort", terminate, { once: true });
  try {
    checkpoint();
    const preflightDir = path.join(directory, "preflight");
    const receipt = await launch({ action: "preflight", directory: preflightDir, workRoot: path.join(workRoot, "preflight"),
      models: [...NATIVE_MODELS], timeoutMs: C.budget.preflightSeconds * 1000 });
    if (receipt.code !== 0 || receipt.error || !receipt.processGroupGone) throw new Error(receipt.error?.message || "Preflight process/cleanup failed");
    report.preflight = JSON.parse(safeRead(path.join(preflightDir, "preflight.json")));
    if (report.preflight.status !== "passed") throw new Error(report.preflight.error || "Prerequisites unavailable");
    const available = report.preflight.value?.models;
    if (!Array.isArray(available) || available.length !== 7 || NATIVE_MODELS.some(id => available.filter(m => m.id === id && typeof m.available === "boolean").length !== 1))
      throw new Error("Invalid preflight model catalog");
    await pool(NATIVE_MODELS, C.budget.modelConcurrency, async model => {
      const rows = report.cases.filter(r => r.model === model);
      if (!available.find(m => m.id === model).available) {
        for (const row of rows) { row.status = "blocked"; row.reason = "Exact model unavailable; no fallback"; } checkpoint(); return;
      }
      // Only per-case guards. A slow/failed case never cancels subsequent cases.
      for (const row of rows) await caseTask(row);
    });
  } catch (error) {
    report.error = clean(error.message);
    for (const row of report.cases) if (row.status === "not-run" && !signal?.aborted) { row.status = "blocked"; row.reason = report.error; }
  } finally {
    terminate(); signal?.removeEventListener("abort", terminate);
    report.interrupted = signal?.aborted === true;
    try { report.userSettingsUnchanged = JSON.stringify(beforeSettings) === JSON.stringify(settingsSnapshot(env)); }
    catch { report.userSettingsUnchanged = false; }
    report.implementationUnchanged = report.implementationHash === implementationHash();
    if (!report.userSettingsUnchanged) report.error = "Observed user settings changed; no compatibility verdict issued.";
    try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch (error) { report.error = `Cleanup: ${clean(error.message)}`; }
    report.finishedAt = new Date().toISOString(); report.durationMs = Math.ceil(performance.now() - started);
    report.targetExceeded = report.durationMs > C.budget.targetSeconds * 1000;
    checkpoint();
  }
  return { directory, report };
}
