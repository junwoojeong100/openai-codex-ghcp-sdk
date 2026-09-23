import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./catalog.mjs";
import { getProfile, DEFAULT_PROFILE } from "./profiles.mjs";
import { newReport, summarize, markdown, readCase, implementationHash, sourceManifest } from "./report.mjs";
import { pool, freshDirectory } from "../compatibility/runner.mjs";
import { supervise, killOwnedGroup } from "../compatibility/supervisor.mjs";
import { ROOT, mkdir, writeJson, sha, safeRead, scrubber } from "../compatibility/util.mjs";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";
import { verificationEnvironment } from "../compatibility/preflight.mjs";

function settings(env) {
  const codex = env.CODEX_HOME || path.join(env.HOME || os.homedir(), ".codex");
  return [path.join(codex, "config.toml"), path.join(codex, "auth.json"), path.join(resolveCopilotHome(env.COPILOT_HOME), "config.json")]
    .map(file => {
      try { const stat = fs.lstatSync(file); return { pathHash: sha(file), hash: stat.isFile() ? sha(fs.readFileSync(file)) : null, mode: stat.mode,
        linkHash: stat.isSymbolicLink() ? sha(fs.readlinkSync(file)) : null }; }
      catch (e) { if (e.code !== "ENOENT") throw e; return { pathHash: sha(file), missing: true }; }
    });
}
export async function runStability({ output, bin = process.env.CODEX_BIN || "codex", executionKind = "live", profile = DEFAULT_PROFILE, signal,
  env = process.env, onProgress = () => {}, ...unknown } = {}) {
  if (Object.keys(unknown).length) throw new Error("No subset, retry or model overrides are supported");
  const { catalog: CATALOG } = getProfile(profile);
  signal?.throwIfAborted();
  const runId = randomUUID(), started = performance.now(), clean = scrubber(env);
  const report = newReport({ runId, executionKind, profile });
  report.environment = verificationEnvironment(env);
  const before = executionKind === "live" ? settings(env) : null;
  const directory = freshDirectory(output || path.join(ROOT, ".runtime", `stability-${executionKind}-${runId}`));
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-stability-")));
  const owned = new Set(), onGroup = (pid, live) => live ? owned.add(pid) : owned.delete(pid);
  const stop = () => { for (const pid of owned) try { killOwnedGroup(pid); } catch { /* Supervisor owns receipts. */ } };
  const workerFile = fileURLToPath(new URL("./worker.mjs", import.meta.url));
  const checkpoint = () => { report.summary = summarize(report); writeJson(path.join(directory, "report.json"), clean(report));
    fs.writeFileSync(path.join(directory, "report.md"), clean(markdown(report)), { mode: 0o600 }); };
  const launch = config => supervise({ bin, runId, seed: runId, provider: "ghcp", executionKind,
    profile: report.profile, catalogId: report.catalogId,
    catalogHash: report.catalogHash, implementationHash: report.implementationHash, ...config }, { signal, env, onGroup, workerFile });
  try {
    const manifest = sourceManifest();
    for (const file of Object.keys(manifest)) {
      const target = path.join(directory, "source-snapshot", file); mkdir(path.dirname(target)); fs.copyFileSync(path.join(ROOT, file), target);
    }
    writeJson(path.join(directory, "freeze.json"), { frozenAt: new Date().toISOString(), runId, executionKind, profile: report.profile,
      catalog: CATALOG, catalogHash: report.catalogHash, implementationHash: report.implementationHash, sources: manifest });
    checkpoint(); signal?.addEventListener("abort", stop, { once: true });
    const preDir = path.join(directory, "preflight");
    const models = [...new Set(report.cases.map(c => c.model))];
    const receipt = await launch({ action: "preflight", models, directory: preDir, workRoot: path.join(temp, "preflight"), timeoutMs: CATALOG.preflightSeconds * 1000 });
    report.preflightSupervisor = receipt;
    if (receipt.code || receipt.error || !receipt.processGroupGone) throw new Error("Preflight process or cleanup failed");
    report.preflight = JSON.parse(safeRead(path.join(preDir, "preflight.json")));
    if (report.preflight.status !== "passed") throw new Error(report.preflight.error || "Prerequisites unavailable");
    const available = report.preflight.value.models;
    if (!Array.isArray(available) || available.length !== models.length || models.some(id => available.filter(m => m.id === id && typeof m.available === "boolean").length !== 1)) throw new Error("Malformed preflight model catalog");
    await pool(models, executionKind === "live" ? CATALOG.concurrency : 1, async model => {
      const rows = report.cases.filter(c => c.model === model);
      if (!available.find(m => m.id === model).available) { rows.forEach(c => Object.assign(c, { status: "blocked", reason: "Exact model unavailable; no fallback" })); checkpoint(); return; }
      for (const row of rows) {
        if (signal?.aborted) break;
        const scenario = SCENARIOS.find(s => s.id === row.scenarioId);
        const relative = `cases/${model}/${scenario.id}`, dir = path.join(directory, relative), work = path.join(temp, model, scenario.id);
        row.startedAt = new Date().toISOString();
        try {
          row.supervisor = await launch({ action: "case", model, scenarioId: scenario.id, directory: dir, workRoot: work, timeoutMs: scenario.seconds * 1000 });
          if (fs.existsSync(path.join(dir, "result.json"))) {
            const { manifest } = readCase(dir, { ...report, ...row });
            Object.assign(row, { status: manifest.status, observedStatus: manifest.status, artifactPath: relative,
              resultHash: sha(safeRead(path.join(dir, "result.json"))), failedChecks: manifest.checks.filter(c => !c.passed).map(c => c.id),
              error: manifest.error, category: manifest.category, metrics: manifest.metrics });
          } else Object.assign(row, { status: "failed", reason: "No complete result; see partial evidence and worker log" });
          if (row.supervisor.error?.name === "TimeoutError") row.status = "timed-out";
          else if (row.supervisor.code !== 0 || row.supervisor.error || row.supervisor.killed || !row.supervisor.processGroupGone) row.status = "failed";
          if (signal?.aborted) row.status = "not-run";
          row.durationMs = row.supervisor.durationMs;
        } catch (error) { Object.assign(row, { status: signal?.aborted ? "not-run" : "failed", error: clean(error.message), category: "harness" }); }
        finally {
          try { fs.rmSync(work, { force: true, recursive: true }); } catch (error) { row.status = "failed"; row.error = clean(error.message); }
          checkpoint(); onProgress({ model, scenario: scenario.id, status: row.status });
        }
      }
    });
  } catch (error) {
    report.error = clean(error.message);
    for (const row of report.cases) if (row.status === "not-run" && !signal?.aborted) Object.assign(row, { status: "blocked", reason: report.error });
  } finally {
    stop(); signal?.removeEventListener("abort", stop);
    report.interrupted = signal?.aborted === true;
    report.implementationUnchanged = implementationHash() === report.implementationHash;
    try { report.userSettingsUnchanged = executionKind !== "live" || JSON.stringify(before) === JSON.stringify(settings(env)); }
    catch { report.userSettingsUnchanged = false; }
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch (error) { report.error = clean(error.message); }
    report.durationMs = Math.ceil(performance.now() - started); report.finishedAt = new Date().toISOString(); checkpoint();
  }
  return { directory, report };
}
