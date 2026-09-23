import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function processTable() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim().split("\n")
    .map(line => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map(m => ({ pid: +m[1], ppid: +m[2], command: m[3] }));
}

export function descendants(root, rows = processTable()) {
  const out = [], queue = [root], seen = new Set([root]);
  while (queue.length) {
    const parent = queue.shift();
    for (const row of rows) if (row.ppid === parent && !seen.has(row.pid)) {
      seen.add(row.pid); out.push(row); queue.push(row.pid);
    }
  }
  return out;
}

export function sandboxTaskPid(parentPid, reportedPid, workspace, { platform = process.platform, rows = processTable(), procRoot = "/proc" } = {}) {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 1 || !Number.isSafeInteger(reportedPid) || reportedPid < 1) {
    throw new Error("Invalid owned command process identity.");
  }
  const cwd = fs.realpathSync(workspace);
  // A receipt can contain PID 2 inside bubblewrap, not host PID 2.
  const candidates = descendants(parentPid, rows).filter(row => {
    if (platform !== "linux") return row.pid === reportedPid;
    try {
      const status = fs.readFileSync(path.join(procRoot, String(row.pid), "status"), "utf8");
      const namespacePids = /^NSpid:\s*(\d+(?:[ \t]+\d+)*)\s*$/m.exec(status)?.[1].trim().split(/[ \t]+/).map(Number);
      return namespacePids?.[0] === row.pid && namespacePids.at(-1) === reportedPid &&
        fs.readlinkSync(path.join(procRoot, String(row.pid), "cwd")) === cwd;
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes(error.code)) return false;
      throw error;
    }
  });
  if (candidates.length !== 1) throw new Error("Cannot uniquely correlate the sandbox receipt with an owned host process.");
  return candidates[0].pid;
}
