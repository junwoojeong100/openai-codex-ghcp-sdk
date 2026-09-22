import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runTerminalLane } from "../../scripts/soak/terminal-lane.mjs";

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (config.executionKind !== "offline-self-test") throw new Error("This worker is only a mechanical terminal test.");
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort(Object.assign(new Error("Owned test cancellation"), { name: "AbortError" })));
const report = await runTerminalLane(config, { signal: controller.signal,
  preload: fileURLToPath(new URL("./soak-sdk.mjs", import.meta.url)) });
process.exitCode = report.durationMet && !report.failed ? 0 : 1;
