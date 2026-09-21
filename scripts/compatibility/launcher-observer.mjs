// Explicit, owned test instrumentation. Loaded only by the C11 launcher child.
// Live mode wraps the actual client; only the offline runtime test substitutes
// a mechanical peer. It never changes provider arguments or model metadata.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { SessionManager } from "../../src/session-manager.mjs";
import { observeSdk, observeHttp } from "./instrumentation.mjs";
import { ROOT, safeRead, scrubber, writeJson } from "./util.mjs";

if (process.env.GHCP_COMPAT_OBSERVER && path.resolve(process.argv[1] || ".") === path.join(ROOT, "src/server.mjs")) {
  const config = JSON.parse(safeRead(process.env.GHCP_COMPAT_OBSERVER, 8192));
  if (!["live", "offline-self-test"].includes(config.executionKind) || !fs.statSync(config.output).isDirectory()) throw new Error("Invalid owned observer configuration");
  const sdk = [], transport = [], diagnostics = [], servers = new Set();
  const metadata = { executionKind: config.executionKind, pid: process.pid, port: null, instrumentation: "observational", stopped: false };
  const start = SessionManager.prototype.start;
  SessionManager.prototype.start = async function () {
    if (config.executionKind === "offline-self-test") {
      const { CoreScriptedSdk } = await import("../../test/helpers/core-scripted-sdk.mjs");
      this.clientFactory = () => new CoreScriptedSdk("C11");
      this.client = this.clientFactory();
    }
    const factory = this.clientFactory;
    this.clientFactory = factory ? () => observeSdk(factory(), sdk) : null;
    this.client = observeSdk(this.client, sdk);
    const diagnostic = this.onDiagnostic;
    this.onDiagnostic = event => { diagnostics.push(event); diagnostic(event); };
    return start.call(this);
  };
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, ...args) {
    if (event === "request" && !servers.has(this)) {
      servers.add(this); metadata.port = this.address()?.port; observeHttp(this, transport);
    }
    return emit.call(this, event, ...args);
  };
  process.once("exit", () => {
    metadata.stopped = [...servers].every(server => !server.listening);
    const clean = scrubber(process.env);
    for (const [name, value] of Object.entries({ sdk, transport, diagnostics, metadata })) writeJson(path.join(config.output, `${name}.json`), clean(value));
  });
}
