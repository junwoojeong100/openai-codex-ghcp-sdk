// Test-only process-group timeout fixture: no network, tools or models.
import fs from "node:fs";
import { spawn } from "node:child_process";
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (config.mode === "hang") {
  spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "inherit" });
  setInterval(() => {}, 1000);
} else { console.log("fixture exited"); }
