import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sourceManifest, implementationHash } from "../stability/report.mjs";
import { preflight, verificationEnvironment } from "../compatibility/preflight.mjs";
import { supervise, killOwnedGroup } from "../compatibility/supervisor.mjs";
import { ROOT, writeJson, sha } from "../compatibility/util.mjs";

export const SOAK_SECONDS = 18000;
export const NATIVE_LANES = Object.freeze([
  Object.freeze({ id: "native-luna-default", model: "gpt-6-luna", contextWindow: null, compactEvery: 0 }),
  Object.freeze({ id: "native-sonnet-128k", model: "claude-sonnet-5", contextWindow: 131072, compactEvery: 40 }),
]);

export function assessProgress(heartbeat, now, startedAt) {
  if (!heartbeat) return now - startedAt > 90000 ? "startup-unresponsive" : "starting";
  if (heartbeat.phase === "finished") return "finished";
  if (now - heartbeat.at > 30000) return "worker-heartbeat-stale";
  if (["turn", "compacting"].includes(heartbeat.phase) && now - heartbeat.currentTurnStartedAt > 90000)
    return "long-response";
  return "responsive";
}

export function snapshotSources(directory) {
  const manifest = sourceManifest();
  const helper = "scripts/soak/terminal-pty.py";
  if (fs.existsSync(path.join(ROOT, helper))) {
    const bytes = fs.readFileSync(path.join(ROOT, helper));
    manifest[helper] = { sha256: sha(bytes), bytes: bytes.length };
  }
  for (const relative of Object.keys(manifest)) {
    const target = path.join(directory, "source-snapshot", relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, relative), target);
  }
  return manifest;
}

export function verifyFrozenSources(directory, manifest) {
  return Object.entries(manifest).every(([relative, metadata]) => {
    const file = path.join(directory, "source-snapshot", relative);
    return fs.existsSync(file) && sha(fs.readFileSync(file)) === metadata.sha256;
  });
}

function ownedProcesses(groups) {
  const output = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,%cpu=,rss=,etime=,comm="],
    { encoding: "utf8", timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  return output.split("\n").flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match || !groups.has(Number(match[3]))) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]),
      cpuPercent: Number(match[4]), rssKiB: Number(match[5]), elapsed: match[6], executable: path.basename(match[7]) }];
  });
}

export async function runSoak({ output, smoke = false, durationSeconds = smoke ? 60 : SOAK_SECONDS,
  signal, bin = process.env.CODEX_BIN || "codex", terminal = false, terminalDriver = "pty" } = {}) {
  if (!["pty", "playwright"].includes(terminalDriver) || terminalDriver !== "pty" && !terminal) throw new Error("A valid terminal driver requires --terminal.");
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds < (smoke ? 1 : SOAK_SECONDS))
    throw new Error("A live endurance run requires at least 18000 seconds; use --smoke for a short harness check");
  if (smoke && durationSeconds > 600) throw new Error("Smoke runs are limited to 600 seconds");
  const directory = path.resolve(output ?? path.join(ROOT, ".runtime", `soak-${randomUUID()}`));
  if (fs.existsSync(directory)) throw new Error("Soak output must be a new directory");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const runId = randomUUID(), before = implementationHash(), manifest = snapshotSources(directory);
  const declaredAt = Date.now(), groups = new Set(), started = performance.now();
  const report = { kind: smoke ? "real-codex-soak-smoke" : "real-codex-five-hour-soak", scored: false,
    environment: verificationEnvironment(),
    runId, declaredAt: new Date(declaredAt).toISOString(), requiredSeconds: durationSeconds,
    implementationHash: before, sourceHash: sha(JSON.stringify(manifest)), mockModelCalls: 0,
    scope: "Long-lived native conversations and separately labelled controlled context/compaction stress; not a stability-matrix score.",
    lanes: NATIVE_LANES.map(lane => ({ ...lane, status: "not-run" })), monitorErrors: [], incidents: [] };
  if (terminal) report.lanes.push({ id: "terminal-luna-64k", model: "gpt-6-luna",
    contextWindow: 65536, kind: "terminal", terminalDriver, status: "not-run" });
  writeJson(path.join(directory, "freeze.json"), { ...report, sources: manifest });
  const checkpoint = () => writeJson(path.join(directory, "report.json"), report);
  const seen = new Set(), terminating = new Set();
  const monitor = () => {
    try {
      const rows = report.lanes.map(lane => {
        const file = path.join(directory, lane.id, "heartbeat.json");
        let heartbeat;
        if (fs.existsSync(file)) heartbeat = JSON.parse(fs.readFileSync(file, "utf8"));
        const state = assessProgress(heartbeat, Date.now(), declaredAt);
        if (["startup-unresponsive", "worker-heartbeat-stale", "long-response"].includes(state)) {
          const key = `${lane.id}:${heartbeat?.turns ?? 0}:${state}`;
          if (!seen.has(key)) {
            seen.add(key); report.incidents.push({ lane: lane.id, state, at: Date.now(),
              turn: heartbeat?.turns ?? null, lastProgressAt: heartbeat?.lastProgressAt ?? null });
          }
        }
        const stalled = heartbeat && ((Date.now() - heartbeat.at > 120000) ||
          (["turn", "compacting"].includes(heartbeat.phase) && Date.now() - heartbeat.currentTurnStartedAt > 480000));
        if (stalled && groups.has(lane.workerPid) && !terminating.has(lane.workerPid)) {
          terminating.add(lane.workerPid);
          writeJson(path.join(directory, `${lane.id}-watchdog-incident.json`), {
            at: Date.now(), state, heartbeat, ownedProcesses: ownedProcesses(groups), action: "terminate-owned-worker" });
          killOwnedGroup(lane.workerPid, "SIGTERM");
          const timer = setTimeout(() => {
            if (groups.has(lane.workerPid)) killOwnedGroup(lane.workerPid);
          }, 30000);
          timer.unref();
        }
        return { lane: lane.id, state, heartbeat };
      });
      fs.appendFileSync(path.join(directory, "monitor.jsonl"),
        JSON.stringify({ at: Date.now(), elapsedSeconds: (performance.now() - started) / 1000,
          lanes: rows, ownedProcesses: ownedProcesses(groups) }) + "\n", { mode: 0o600 });
      report.latestMonitorAt = Date.now(); checkpoint();
    } catch (error) {
      report.monitorErrors.push({ at: Date.now(), name: error.name, message: error.message }); checkpoint();
    }
  };
  let timer;
  const stop = () => { for (const pid of groups) killOwnedGroup(pid, "SIGTERM"); };
  try {
    report.preflight = await preflight({ bin, models: [...new Set(report.lanes.map(lane => lane.model))],
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)].filter(Boolean)) });
    if (report.preflight.models.some(model => !model.available)) throw new Error("One or more exact soak models unavailable");
    report.startedAt = new Date().toISOString(); checkpoint();
    signal?.addEventListener("abort", stop, { once: true });
    timer = setInterval(monitor, 15000);
    await Promise.all(report.lanes.map(async lane => {
      lane.status = "running"; checkpoint();
      const laneDirectory = path.join(directory, lane.id);
      const config = { ...lane, runId, bin, durationSeconds, intervalSeconds: smoke ? 2 : 25,
        compactEvery: smoke && lane.compactEvery ? 3 : lane.compactEvery,
        expectedImplementationHash: before,
        payloadBytes: smoke ? 1024 : 8192, directory: laneDirectory,
        workRoot: path.join(laneDirectory, "supervisor-work"), timeoutMs: (durationSeconds + 900) * 1000,
        gracefulShutdownMs: 45000 };
      lane.supervisor = await supervise(config, { signal,
        workerFile: path.join(directory, "source-snapshot/scripts/soak/worker.mjs"),
        onGroup: (pid, live) => { if (live) { groups.add(pid); lane.workerPid = pid; } else groups.delete(pid); checkpoint(); } });
      const file = path.join(laneDirectory, "report.json");
      if (fs.existsSync(file)) lane.result = JSON.parse(fs.readFileSync(file, "utf8"));
      lane.status = lane.supervisor.code === 0 && lane.supervisor.processGroupGone &&
        lane.result?.durationMet && !lane.result.error && !lane.result.cleanupError && !lane.result.evidenceError ? "completed" : "failed";
      checkpoint();
    }));
  } catch (error) {
    report.error = { name: error.name, message: error.message };
  } finally {
    if (timer) clearInterval(timer);
    signal?.removeEventListener("abort", stop);
    stop(); monitor();
    report.finishedAt = new Date().toISOString();
    report.elapsedSeconds = (performance.now() - started) / 1000;
    report.implementationUnchanged = implementationHash() === before;
    report.frozenSourceUnchanged = verifyFrozenSources(directory, manifest);
    report.durationMet = !smoke && report.lanes.every(lane => lane.result?.durationMet &&
      (lane.result.coveredSeconds ?? 0) >= SOAK_SECONDS);
    report.allLanesCompleted = report.lanes.every(lane => lane.status === "completed");
    report.noObservedFailures = report.allLanesCompleted && report.frozenSourceUnchanged && report.incidents.length === 0 &&
      report.monitorErrors.length === 0 && report.lanes.every(lane => lane.result.failed === 0);
    checkpoint();
  }
  return { directory, report };
}
