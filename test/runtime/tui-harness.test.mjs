import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCase } from "../../scripts/tui/worker.mjs";

const preload = fileURLToPath(new URL("../fixtures/tui-sdk.mjs", import.meta.url));

for (const scenarioId of ["U01", "U12"]) {
  test(`${scenarioId}: the real Codex TUI through bin/codex-ghcp and headless Playwright, with an SDK double`, { timeout: 180_000 }, async t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tui-runtime-")));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const result = await runCase({ directory: path.join(root, "evidence"), workRoot: path.join(root, "work"), model: "gpt-6-astra", scenarioId,
      seed: "0a1b2c3d", executionKind: "offline-self-test", preload, runId: "runtime", catalogHash: "runtime", implementationHash: "runtime" });
    // The SDK double has no copilot-runtime process, so runtime MCP isolation is only established live.
    assert.deepEqual(result.checks.filter(check => !check.passed).map(check => check.id), ["mcp-isolation"], JSON.stringify(result));
    const facts = JSON.parse(fs.readFileSync(path.join(root, "evidence", "facts.json"), "utf8"));
    assert.equal(facts.evidence.samples.maxRuntimes, 0);
    assert.deepEqual(facts.evidence.leftovers, []);
    assert.equal(fs.existsSync(path.join(root, "work", "owned")), false);
  });
}
