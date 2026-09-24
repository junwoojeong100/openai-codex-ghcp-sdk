import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { bridgeModelCatalog, ensureDaemon, startBridge, stopChildBridge } from "./bridge-daemon.mjs";
import { DEFAULT_MODEL, SUPPORTED_MODEL_IDS } from "./model-map.mjs";
import { supportedNodeVersion, versionAtLeast } from "./version.mjs";

const disabledFeatures = [
  "enable_request_compression",
  "responses_websockets",
  "responses_websockets_v2",
  "remote_compaction_v2",
  "standalone_web_search",
];
const unsupportedFeatures = [...disabledFeatures, "web_search", "web_search_cached", "web_search_request"];
const protectedConfig = [
  "model", "model_provider", "model_providers", "model_catalog_json", "profile", "profiles", "web_search",
  ...unsupportedFeatures.map((name) => `features.${name}`),
];
const protectedFlags = ["--model", "--profile", "--oss", "--local-provider", "--remote", "--remote-auth-token-env", "--search"];

export const usage = `Usage: codex-ghcp [bridge options] [-- Codex options and prompt]

Run ./bin/codex-ghcp with no arguments for an interactive session.
The default launch starts a new private bridge and stops it when Codex exits.
No .env file or shell setup is needed; .env is not loaded automatically.

Bridge options:
  --ghcp-model MODEL    Initial model (overrides GHCP_MODEL; default: ${DEFAULT_MODEL})
  --bridge-port PORT    Fixed loopback port (default: select a free port)
  --bridge-background   Keep the bridge running for reuse after Codex exits
  -h, --help            Show launcher help without starting a bridge

Put bridge options before -- and Codex options after it.
Use --ghcp-model rather than Codex --model/-m. Provider and profile overrides,
remote TUI connections, hosted web search and incompatible transport flags
are rejected. Other Codex options, including sandbox and approvals, pass through.
Type /model, /compact and /quit inside Codex, not in your shell.

Supported models (subject to Copilot account policy):
${SUPPORTED_MODEL_IDS.map((model) => `  ${model}`).join("\n")}

Examples (from this repository's root):
  ./bin/codex-ghcp
  ./bin/codex-ghcp --ghcp-model gpt-6-sol
  ./bin/codex-ghcp -- exec --sandbox read-only "Explain this project"
  ./bin/codex-ghcp -- resume --last

Resume uses --ghcp-model, then GHCP_MODEL, then ${DEFAULT_MODEL};
it does not restore the previous /model selection.

From another project, use the launcher's absolute path without changing directory.
For official CLI help/version without a bridge:
  command codex --help
  command codex --version

Optional background bridge:
  ./bin/codex-ghcp --bridge-background
  ./bin/codex-ghcp-status
  ./bin/codex-ghcp-stop   # Only after closing all sessions using this bridge

Use --bridge-background on every launch that should reuse it.
Without the flag, a new foreground bridge starts; the background bridge stays up.
The default registry is shared across working projects and tied to one checkout.
For another checkout, set GHCP_DAEMON_DIR consistently for launch/status/stop.
Status/stop manage background bridges only. See docs/USAGE.md for details.
`;

function optionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value.`);
  return value;
}

function conflictsWithRouting(key) {
  return protectedConfig.some((protectedKey) =>
    key === protectedKey || key.startsWith(`${protectedKey}.`) || protectedKey.startsWith(`${key}.`));
}

function checkConfig(value) {
  const separator = value.indexOf("=");
  const key = value.slice(0, separator).trim();
  if (separator < 1 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(key)) {
    throw new Error("Codex --config requires a plain dotted key=value; quoted or ambiguous keys are not supported by this launcher.");
  }
  if (conflictsWithRouting(key)) {
    throw new Error(`Codex config '${key}' conflicts with the GHCP bridge. Use --ghcp-model to select a model.`);
  }
}

export function validateCodexArgs(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") break;
    if (protectedFlags.some((flag) => argument === flag || argument.startsWith(`${flag}=`)) ||
        /^-[mp](?:.|$)/.test(argument)) {
      throw new Error(`${argument.split("=")[0]} conflicts with GHCP routing. Use --ghcp-model and keep the local provider.`);
    }
    if (argument === "-c" || argument === "--config") {
      checkConfig(optionValue(argv, index, argument));
      index += 1;
    } else if (argument.startsWith("--config=")) {
      checkConfig(argument.slice("--config=".length));
    } else if (argument.startsWith("-c") && !argument.startsWith("--")) {
      checkConfig(argument.slice(2).replace(/^=/, ""));
    } else if (argument === "--enable" || argument.startsWith("--enable=")) {
      const feature = argument === "--enable" ? optionValue(argv, index++, argument) : argument.slice("--enable=".length);
      if (feature.split(",").some((name) => unsupportedFeatures.includes(name.trim()))) {
        throw new Error(`Feature '${feature}' is not supported by the GHCP bridge.`);
      }
    }
  }
}

export function parseLauncherArgs(argv, env = process.env) {
  const options = { model: env.GHCP_MODEL || DEFAULT_MODEL, port: env.GHCP_BRIDGE_PORT || "0", background: false, help: false, codexArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      options.codexArgs.push(...argv.slice(index + 1));
      break;
    }
    if (argument === "--ghcp-model" || argument === "--bridge-port") {
      options[argument === "--ghcp-model" ? "model" : "port"] = optionValue(argv, index, argument);
      index += 1;
    } else if (argument.startsWith("--ghcp-model=")) {
      options.model = argument.slice("--ghcp-model=".length);
    } else if (argument.startsWith("--bridge-port=")) {
      options.port = argument.slice("--bridge-port=".length);
    } else if (argument === "--bridge-background") {
      options.background = true;
    } else if ((argument === "-h" || argument === "--help") && options.codexArgs.length === 0) {
      options.help = true;
    } else {
      options.codexArgs.push(argument);
    }
  }
  if (options.help) return options;
  if (!SUPPORTED_MODEL_IDS.includes(options.model)) {
    throw new Error(`Unsupported model: ${options.model || "(empty)"}. Allowed: ${SUPPORTED_MODEL_IDS.join(", ")}.`);
  }
  if (!/^\d+$/.test(String(options.port)) || !Number.isSafeInteger(Number(options.port)) || Number(options.port) > 65_535) {
    throw new Error("--bridge-port/GHCP_BRIDGE_PORT must be an integer from 0 through 65535.");
  }
  options.port = Number(options.port);
  validateCodexArgs(options.codexArgs);
  return options;
}

export function writeCodexCatalog(catalog, directory) {
  if (!Array.isArray(catalog?.models) || !catalog.models.length
      || new Set(catalog.models.map(entry => entry?.slug)).size !== catalog.models.length
      || catalog.models.some(entry => !SUPPORTED_MODEL_IDS.includes(entry?.slug))) {
    throw new Error("Invalid GHCP model picker catalog; expected only the supported Copilot models.");
  }
  for (const entry of catalog.models) {
    if (!Number.isSafeInteger(entry.context_window) || entry.context_window < 1
        || entry.max_context_window !== entry.context_window
        || !Number.isSafeInteger(entry.auto_compact_token_limit) || entry.auto_compact_token_limit < 1
        || entry.auto_compact_token_limit > entry.context_window) {
      throw new Error(`Missing or invalid Copilot context limits for ${entry.slug}. Refusing to use Codex fallback limits.`);
    }
  }
  const filename = path.join(directory, "models.json");
  fs.writeFileSync(filename, JSON.stringify({ models: catalog.models }), { flag: "wx", mode: 0o600 });
  return filename;
}

export function codexProviderArgs({ model, port, catalogPath }) {
  if (!SUPPORTED_MODEL_IDS.includes(model) || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Invalid model or bridge port.");
  }
  if (catalogPath !== undefined && (typeof catalogPath !== "string" || !path.isAbsolute(catalogPath))) {
    throw new Error("The Codex model catalog path must be absolute.");
  }
  const provider = {
    name: "GitHub Copilot SDK",
    base_url: `http://127.0.0.1:${port}/v1`,
    wire_api: "responses",
    requires_openai_auth: false,
    supports_websockets: false,
    supports_standalone_web_search: false,
    env_key: "CODEX_GHCP_BRIDGE_TOKEN",
    // A failed live session must not silently resubmit inference or tool results.
    request_max_retries: 0,
    stream_max_retries: 0,
  };
  const inlineTable = `{ ${Object.entries(provider).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(", ")} }`;
  const settings = [
    `model=${JSON.stringify(model)}`,
    'model_provider="ghcp"',
    `model_providers.ghcp=${inlineTable}`,
    ...(catalogPath ? [`model_catalog_json=${JSON.stringify(catalogPath)}`] : []),
    'web_search="disabled"',
    'model_reasoning_summary="none"',
    ...disabledFeatures.map((name) => `features.${name}=false`),
  ];
  return settings.flatMap((setting) => ["-c", setting]);
}

export function codexEnvironment(env, token) {
  const result = { ...env, CODEX_GHCP_BRIDGE_TOKEN: token };
  for (const name of Object.keys(result)) {
    if (/^(?:COPILOT_.*TOKEN|GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|BRIDGE_API_KEY)$/.test(name)) {
      delete result[name];
    }
  }
  return result;
}

function signalExitCode(signal) {
  return 128 + (os.constants.signals[signal] || 1);
}

export async function launch(argv = process.argv.slice(2), env = process.env) {
  const options = parseLauncherArgs(argv, env);
  if (options.help) { console.log(usage); return 0; }
  if (!supportedNodeVersion(process.version)) throw new Error("Node.js ^20.19.0 or >=22.12.0 is required.");
  const codexBin = env.CODEX_BIN || "codex";
  const version = spawnSync(codexBin, ["--version"], { encoding: "utf8", timeout: 10_000, env: codexEnvironment(env, "") });
  if (version.error || version.status !== 0) {
    throw new Error(`Cannot run Codex (${codexBin}). Install the official CLI: npm install -g @openai/codex@0.154.0`);
  }
  if (!versionAtLeast(version.stdout || version.stderr, "0.154.0")) throw new Error("This launcher requires Codex CLI 0.154.0 or newer.");

  const controller = new AbortController();
  let bridge;
  let codex;
  let catalogDirectory;
  let receivedSignal;
  let forceExitTimer;
  let bridgeFailed = false;
  const onSignal = (signal) => {
    if (receivedSignal) return;
    receivedSignal = signal;
    controller.abort();
    if (codex && codex.exitCode === null && codex.signalCode === null) {
      codex.kill(signal);
      forceExitTimer = setTimeout(() => codex.kill("SIGKILL"), 30_000);
      forceExitTimer.unref();
    }
  };
  const onInterrupt = () => onSignal("SIGINT");
  const onTerminate = () => onSignal("SIGTERM");
  const onBridgeExit = () => {
    if (codex && codex.exitCode === null && codex.signalCode === null && !receivedSignal) {
      bridgeFailed = true;
      console.error("The GHCP bridge exited while Codex was running.");
      codex.kill("SIGTERM");
      forceExitTimer = setTimeout(() => codex.kill("SIGKILL"), 30_000);
      forceExitTimer.unref();
    }
  };
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try {
    const bridgeOptions = { env, model: options.model, port: options.port, signal: controller.signal };
    bridge = await (options.background ? ensureDaemon(bridgeOptions) : startBridge(bridgeOptions));
    if (receivedSignal) return signalExitCode(receivedSignal);
    const catalog = await bridgeModelCatalog(bridge, controller.signal);
    if (!catalog.models.some(entry => entry?.slug === options.model)) {
      throw new Error(`GitHub Copilot model is unavailable: ${options.model}. Run ./bin/ghcp-models.`);
    }
    catalogDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-ghcp-models-"));
    const catalogPath = writeCodexCatalog(catalog, catalogDirectory);
    if (receivedSignal) return signalExitCode(receivedSignal);
    const childArgs = [...codexProviderArgs({ model: options.model, port: bridge.port, catalogPath }), ...options.codexArgs];
    codex = spawn(codexBin, childArgs, { stdio: "inherit", env: codexEnvironment(env, bridge.token) });
    bridge.child?.once("exit", onBridgeExit);
    if (bridge.child && (bridge.child.exitCode !== null || bridge.child.signalCode !== null)) onBridgeExit();
    const result = await new Promise((resolve, reject) => {
      codex.once("error", reject);
      codex.once("exit", (code, signal) => resolve({ code, signal }));
    });
    return receivedSignal ? signalExitCode(receivedSignal) : bridgeFailed ? 1 : result.signal ? signalExitCode(result.signal) : result.code ?? 1;
  } catch (error) {
    if (receivedSignal) return signalExitCode(receivedSignal);
    throw error;
  } finally {
    clearTimeout(forceExitTimer);
    bridge?.child?.removeListener("exit", onBridgeExit);
    try {
      if (!options.background) await stopChildBridge(bridge);
    } finally {
      if (catalogDirectory) fs.rmSync(catalogDirectory, { recursive: true, force: true });
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
