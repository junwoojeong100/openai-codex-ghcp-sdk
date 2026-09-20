import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CopilotClient } from "@github/copilot-sdk";
import { resolveCopilotHome } from "../../src/copilot-home.mjs";
import { NATIVE_SCENARIO_CATALOG as C } from "./catalog.mjs";
import { run, bounded, CaseError, deadline } from "./util.mjs";

export function installedSdkVersion() {
  let directory = path.dirname(createRequire(import.meta.url).resolve("@github/copilot-sdk"));
  for (;;) {
    const manifest = path.join(directory, "package.json");
    if (fs.existsSync(manifest)) {
      const data = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (data.name === "@github/copilot-sdk") return data.version;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new CaseError("Cannot locate the installed Copilot SDK package manifest");
    directory = parent;
  }
}
export async function preflight({ bin, models, signal, env = process.env }) {
  const sdkVersion = installedSdkVersion();
  if (sdkVersion !== C.versions.copilotSdk) throw new CaseError(`Require Copilot SDK ${C.versions.copilotSdk}, found ${sdkVersion}`);
  const version = await run(bin, ["--version"], { env, signal: deadline(signal, 5000) });
  if (version.code || version.stdout.trim() !== `codex-cli ${C.versions.codex}`) throw new CaseError(`Require codex-cli ${C.versions.codex}; use the original native executable.`);
  const client = new CopilotClient({ mode: "empty", baseDirectory: resolveCopilotHome(env.COPILOT_HOME), logLevel: "error", enableRemoteSessions: false });
  try {
    await bounded(client.start(), signal);
    const catalog = await bounded(client.listModels(), signal);
    return { codexVersion: version.stdout.trim(),
      copilotSdk: sdkVersion, modelCalls: 0,
      models: models.map(id => ({ id, available: catalog.some(m => m.id === id && m.policy?.state !== "disabled") })) };
  } finally {
    try { await bounded(client.stop(), AbortSignal.timeout(2000)); }
    catch { await bounded(Promise.resolve(client.forceStop?.()), AbortSignal.timeout(1000)).catch(() => {}); }
  }
}
