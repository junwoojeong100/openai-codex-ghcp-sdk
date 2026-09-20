import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { supportedNodeVersion, versionAtLeast } from "./version.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function commandVersion(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 10_000 });
  return {
    ok: result.status === 0,
    version: result.status === 0 ? (result.stdout.trim() || result.stderr.trim()) : null,
    ...(result.error ? { error: result.error.code || result.error.message } : {}),
  };
}

let sdkVersion = null;
try {
  sdkVersion = JSON.parse(fs.readFileSync(path.join(rootDir, "node_modules", "@github", "copilot-sdk", "package.json"), "utf8")).version;
} catch { /* Missing dependencies are reported below. */ }

const report = {
  node: { ok: supportedNodeVersion(process.version), version: process.version, required: "^20.19.0 || >=22.12.0" },
  npm: commandVersion("npm"),
  codex: commandVersion(process.env.CODEX_BIN || "codex"),
  copilot: commandVersion(process.env.COPILOT_CLI_PATH || "copilot"),
  sdk: { ok: sdkVersion === "1.0.14", version: sdkVersion, required: "1.0.14" },
  authentication: "Not inspected. Run ./bin/ghcp-models to check catalog access; use copilot login if needed.",
};
report.codex.minimum = "0.154.0";
report.codex.supportedVersion = report.codex.ok && versionAtLeast(report.codex.version, report.codex.minimum);
console.log(JSON.stringify(report, null, 2));
if (![report.node, report.npm, report.codex, report.copilot, report.sdk].every((item) => item.ok) || !report.codex.supportedVersion) {
  process.exitCode = 1;
}
