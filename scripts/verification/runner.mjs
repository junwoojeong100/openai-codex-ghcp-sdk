import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";
import { CATALOG as C, SCENARIOS, catalogHash } from "./catalog.mjs";
import { preflight, verificationEnvironment } from "./preflight.mjs";
import { snapshotSources, verifyFrozenSources, implementationHash } from "./source.mjs";
import { supervise, killOwnedGroup } from "./supervisor.mjs";
import { matrix, summarize, markdown } from "./report.mjs";
import { ROOT, freshDirectory, pool, safeRead, scrubber, sha, writeJson } from "./util.mjs";

function settings(env) {
  const home = env.CODEX_HOME || path.join(env.HOME || os.homedir(), ".codex");
  return [path.join(home, "config.toml"), path.join(home, "auth.json"), path.join(resolveCopilotHome(env.COPILOT_HOME), "config.json")].map(file => {
    try {
      const stat = fs.lstatSync(file);
      return { pathHash: sha(file), hash: stat.isFile() ? sha(fs.readFileSync(file)) : null, mode: stat.mode,
        link: stat.isSymbolicLink() ? sha(fs.readlinkSync(file)) : null };
    } catch (error) { if (error.code !== "ENOENT") throw error; return { pathHash: sha(file), missing: true }; }
  });
}

export async function runVerification({ output, env = process.env, signal, onProgress = () => {} } = {}) {
  const runId = randomUUID(), clean = scrubber(env), started = performance.now(), bin = env.CODEX_BIN || "codex";
  const directory = freshDirectory(output || path.join(ROOT, ".runtime", `verification-${runId}`));
  const sources = snapshotSources(directory), before = sha(JSON.stringify(sources)), beforeSettings = settings(env);
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-verification-")));
  const report = { schemaVersion: C.schemaVersion, catalogId: C.id, catalogHash: catalogHash(), implementationHash: before,
    runId, executionKind: "live", environment: verificationEnvironment(env), startedAt: new Date().toISOString(), finishedAt: null, cases: matrix() };
  const owned = new Set();
  const checkpoint = () => {
    report.summary = summarize(report);
    writeJson(path.join(directory, "report.json"), clean(report));
    fs.writeFileSync(path.join(directory, "report.md"), clean(markdown(report)), { mode: 0o600 });
  };
  const stop = () => {
    for (const pid of owned) {
      try { killOwnedGroup(pid, "SIGTERM"); }
      catch (error) { report.error ??= `Owned worker shutdown: ${clean(error.message)}`; }
    }
  };
  signal?.addEventListener("abort", stop, { once: true });
  writeJson(path.join(directory, "freeze.json"), { runId, catalog: C, catalogHash: report.catalogHash, sources });
  try {
    checkpoint();
    report.preflight = await preflight({ bin, models: C.models, env, signal: AbortSignal.any([signal, AbortSignal.timeout(C.preflightSeconds * 1000)].filter(Boolean)) });
    const workerFile = path.join(directory, "source-snapshot/scripts/verification/worker.mjs");
    await pool(C.models, C.concurrency, async model => {
      const rows = report.cases.filter(row => row.model === model);
      if (!report.preflight.models.find(row => row.id === model)?.available) {
        rows.forEach(row => Object.assign(row, { status: "blocked", reason: "Exact model unavailable; no fallback" }));
        checkpoint(); return;
      }
      for (const row of rows) {
        if (signal?.aborted) break;
        const scenario = SCENARIOS.find(item => item.id === row.scenarioId), relative = `cases/${model}/${scenario.id}`;
        const dir = path.join(directory, relative), work = path.join(temp, model, scenario.id);
        Object.assign(row, { startedAt: new Date().toISOString(), seed: randomBytes(4).toString("hex") });
        try {
          row.supervisor = await supervise({ bin, directory: dir, workRoot: work, timeoutMs: scenario.seconds * 1000, gracefulShutdownMs: 25000,
            runId, model, scenarioId: scenario.id, seed: row.seed, executionKind: "live", catalogHash: report.catalogHash, implementationHash: before },
          { signal, env, workerFile, onGroup: (pid, active) => active ? owned.add(pid) : owned.delete(pid) });
          writeJson(path.join(dir, "supervisor.json"), row.supervisor);
          row.artifactPath = relative;
          const resultFile = path.join(dir, "result.json");
          if (fs.existsSync(resultFile)) {
            const bytes = safeRead(resultFile), result = JSON.parse(bytes);
            Object.assign(row, { status: result.status, observedStatus: result.status, failedChecks: result.checks.filter(check => !check.passed).map(check => check.id),
              error: result.error, durationMs: result.durationMs, resultHash: sha(bytes), auxiliaryTitleRejections: result.auxiliaryTitleRejections,
              recoveredTransportErrors: result.recoveredTransportErrors, catalogRecoveries: result.catalogRecoveries });
          } else Object.assign(row, { status: "failed", reason: "No complete case result; see worker.log and retained partial evidence" });
          if (row.supervisor.error?.name === "TimeoutError") row.status = "timed-out";
          else if (row.supervisor.code !== 0 || row.supervisor.error || row.supervisor.killed || !row.supervisor.processGroupGone) row.status = "failed";
          if (signal?.aborted) row.status = "not-run";
        } catch (error) {
          Object.assign(row, { status: signal?.aborted ? "not-run" : "failed", reason: clean(error.message) });
        } finally {
          try { fs.rmSync(work, { recursive: true, force: true }); }
          catch (error) { row.status = "failed"; row.cleanupError = clean(error.message); }
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
    try { report.frozenSourceUnchanged = verifyFrozenSources(directory, sources); }
    catch (error) { report.frozenSourceUnchanged = false; report.error ??= clean(error.message); }
    try { report.userSettingsUnchanged = JSON.stringify(settings(env)) === JSON.stringify(beforeSettings); }
    catch (error) { report.userSettingsUnchanged = false; report.error ??= clean(error.message); }
    try { fs.rmSync(temp, { recursive: true, force: true }); }
    catch (error) { report.error ??= `Fixture cleanup: ${clean(error.message)}`; }
    checkpoint();
  }
  return { directory, report };
}
