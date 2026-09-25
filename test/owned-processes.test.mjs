import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { descendants, sandboxTaskPid } from "../scripts/verification/processes.mjs";

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "owned-processes-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace"), procRoot = path.join(root, "proc");
  fs.mkdirSync(workspace); fs.mkdirSync(procRoot);
  const rows = [{ pid: 500, ppid: 100 }, { pid: 600, ppid: 500 }, { pid: 700, ppid: 100 }, { pid: 800, ppid: 999 }];
  const process = (pid, namespacePid, cwd = workspace) => {
    const dir = path.join(procRoot, String(pid)); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "status"), `Name:\tnode\nNSpid:\t${pid}\t${namespacePid}\n`);
    fs.symlinkSync(cwd, path.join(dir, "cwd"));
  };
  return { workspace, procRoot, rows, process };
}

test("Linux namespace PID 2 is correlated only with an owned host descendant", t => {
  const f = fixture(t);
  f.process(500, 1); f.process(600, 2); f.process(700, 2, f.procRoot); f.process(800, 2);
  assert.equal(sandboxTaskPid(100, 2, f.workspace, { ...f, platform: "linux" }), 600);
});

test("ambiguous or missing namespace receipts fail without probing an unrelated PID", t => {
  const f = fixture(t);
  f.process(600, 2); f.process(700, 2);
  assert.throws(() => sandboxTaskPid(100, 2, f.workspace, { ...f, platform: "linux" }), /uniquely correlate/);
  assert.throws(() => sandboxTaskPid(100, 9, f.workspace, { ...f, platform: "linux" }), /uniquely correlate/);
  assert.throws(() => sandboxTaskPid(100, -1, f.workspace, { ...f, platform: "linux" }), /Invalid/);
});

test("an incomplete or inconsistent namespace chain cannot identify a host process", t => {
  const f = fixture(t); f.process(600, 2);
  const file = path.join(f.procRoot, "600", "status");
  for (const value of ["Name:\tnode\n", "NSpid:\t999\t2\n", "NSpid:\t600\tunknown\n"]) {
    fs.writeFileSync(file, value);
    assert.throws(() => sandboxTaskPid(100, 2, f.workspace, { ...f, platform: "linux" }), /uniquely correlate/);
  }
});

test("non-namespaced PIDs must still belong to the native host's descendants", t => {
  const f = fixture(t);
  assert.equal(sandboxTaskPid(100, 600, f.workspace, { ...f, platform: "darwin" }), 600);
  assert.throws(() => sandboxTaskPid(100, 800, f.workspace, { ...f, platform: "darwin" }), /uniquely correlate/);
  assert.throws(() => sandboxTaskPid(100, 100, f.workspace, { ...f, platform: "darwin" }), /uniquely correlate/);
});

test("a racing process snapshot cannot loop through reused ancestor PIDs", () => {
  assert.deepEqual(descendants(100, [{ pid: 500, ppid: 100 }, { pid: 100, ppid: 500 }]), [{ pid: 500, ppid: 100 }]);
});
