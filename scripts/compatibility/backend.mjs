import { CopilotClient } from "@github/copilot-sdk";
import { SessionManager } from "../../src/session-manager.mjs";
import { createBridgeServer } from "../../src/server.mjs";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";
import { modelCatalog } from "../../src/model-map.mjs";
import { bounded, CaseError } from "./util.mjs";

import { observeSdk, observeHttp, listen } from "./instrumentation.mjs";
export { observeSdk, observeHttp, listen } from "./instrumentation.mjs";

export class Backend {
  constructor({ provider = "ghcp", model, env, token, signal, transport, sdk, diagnostics, clientFactory, turnTimeoutMs = 120_000 }) {
    if (provider !== "ghcp") throw new Error("Only the GHCP provider belongs to this suite.");
    Object.assign(this, { provider, model, env, token, signal, transport, sdk, diagnostics, clientFactory, turnTimeoutMs });
  }
  async start() {
    const raw = this.clientFactory?.() ?? new CopilotClient({ mode: "empty", baseDirectory: resolveCopilotHome(this.env.COPILOT_HOME), logLevel: "error", enableRemoteSessions: false });
    this.manager = new SessionManager({ client: observeSdk(raw, this.sdk), preferredModel: this.model, turnTimeoutMs: this.turnTimeoutMs,
      cleanupTimeoutMs: 1000, onDiagnostic: event => this.diagnostics.push(event) });
    await bounded(this.manager.start(), this.signal);
    const models = this.manager.listModels();
    if (!models.some(x => x.id === this.model && x.policy?.state !== "disabled"))
      throw new CaseError(`Unavailable Copilot model ${this.model}; no fallback.`);
    this.catalog = modelCatalog(models);
    this.server = createBridgeServer({ manager: this.manager, apiKey: this.token, onDiagnostic: event => this.diagnostics.push(event) });
    const handler = this.server.listeners("request")[0];
    this.server.removeListener("request", handler);
    this.server.on("request", (request, response) => {
      if (this.nextFailure && request.method === "POST" && request.url === "/v1/responses") {
        const failure = this.nextFailure; this.nextFailure = null;
        request.resume(); response.writeHead(failure.status, { "content-type": "application/json", "retry-after": "0" });
        response.end(JSON.stringify({ error: { code: "fixture_transient_fault", message: failure.marker } }));
        return;
      }
      handler(request, response);
    });
    observeHttp(this.server, this.transport);
    this.port = await listen(this.server); return this;
  }
  failNextRequest(marker) {
    if (this.nextFailure) throw new Error("Fault already armed");
    this.nextFailure = { status: 503, marker };
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.shutdown(); return this.closePromise;
  }
  async shutdown() {
    if (this.server) {
      this.server.abortActiveRequests?.(); this.server.closeAllConnections();
      await new Promise(resolve => this.server.close(resolve));
    }
    if (this.manager) await bounded(this.manager.stop(), AbortSignal.timeout(3500));
  }
}
