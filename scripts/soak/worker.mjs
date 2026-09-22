import fs from "node:fs";
import { runNativeLane } from "./native.mjs";
import { runTerminalLane } from "./terminal-lane.mjs";
import { implementationHash } from "../stability/report.mjs";

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (config.expectedImplementationHash !== implementationHash()) throw new Error("Frozen soak worker source differs from declared implementation");
const controller = new AbortController();
const stop = () => controller.abort(Object.assign(new Error("Interrupted"), { name: "AbortError" }));
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  const report = config.kind === "terminal"
    ? await runTerminalLane(config, { signal: controller.signal })
    : await runNativeLane(config, { signal: controller.signal });
  process.exitCode = report.durationMet && !report.failed && !report.error && !report.cleanupError && !report.evidenceError ? 0 : 1;
} finally {
  process.off("SIGINT", stop); process.off("SIGTERM", stop);
}
