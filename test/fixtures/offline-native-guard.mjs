// Loaded only by the offline preparation child. Even accidental use of the
// production SDK fails before it can start a transport or consume model usage.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { CopilotClient } from "@github/copilot-sdk";

const deny = () => { throw new Error("Offline preparation forbids the production Copilot SDK."); };
for (const method of ["start", "listModels", "createSession", "resumeSession"]) {
  CopilotClient.prototype[method] = deny;
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node's net.connect normalizes to [options, callback] before calling this.
  const value = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof value === "object" ? value : typeof value === "number"
    ? { port: value, host: typeof args[1] === "string" ? args[1] : "localhost" } : { path: value };
  if (!options.path && !["localhost", "127.0.0.1", "::1"].includes(options.host ?? "localhost")) {
    throw new Error("Offline preparation permits only loopback network connections.");
  }
  return connect.apply(this, args);
};
syncBuiltinESMExports();
if (process.env.GHCP_OFFLINE_RECEIPTS) {
  fs.mkdirSync(process.env.GHCP_OFFLINE_RECEIPTS, { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${process.env.GHCP_OFFLINE_RECEIPTS}/${process.pid}.json`, JSON.stringify({
    pid: process.pid, parentPid: process.ppid,
    entrypoint: process.argv[1] && fs.existsSync(process.argv[1]) ? fs.realpathSync(path.resolve(process.argv[1])) : null,
    executionId: process.env.GHCP_OFFLINE_EXECUTION_ID ?? null,
    testFile: process.env.GHCP_OFFLINE_TEST_FILE ?? null,
    guard: "production-sdk-and-non-loopback-disabled", modelCalls: 0,
  }), { flag: "wx", mode: 0o600 });
}
