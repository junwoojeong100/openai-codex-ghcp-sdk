import fs from "node:fs";
import { runNativeLane } from "./native.mjs";
import { implementationHash } from "../stability/report.mjs";

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (config.expectedImplementationHash !== implementationHash()) throw new Error("Frozen soak worker source differs from declared implementation");
if (config.kind === "terminal") throw new Error("Terminal lane integration is not yet available");
const report = await runNativeLane(config);
process.exitCode = report.durationMet && !report.error && !report.cleanupError && !report.evidenceError ? 0 : 1;
