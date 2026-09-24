import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { codexEnvironment, codexProviderArgs, parseLauncherArgs, validateCodexArgs, writeCodexCatalog } from "../src/launcher.mjs";
import { DEFAULT_MODEL, SUPPORTED_MODEL_IDS, modelCatalog } from "../src/model-map.mjs";

test("launcher help explains argument boundaries and needs no working CLI or model", () => {
  for (const flag of ["--help", "-h"]) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../src/launcher.mjs", import.meta.url)), flag], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, CODEX_BIN: "/missing/codex", GHCP_MODEL: "unavailable-model", GHCP_BRIDGE_PORT: "invalid" },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Put bridge options before -- and Codex options after it/);
    assert.match(result.stdout, /\.env is not loaded automatically/);
    assert.match(result.stdout, /Status\/stop manage background bridges only/);
    for (const model of SUPPORTED_MODEL_IDS) assert.ok(result.stdout.includes(`  ${model}\n`));
  }
  const codexHelp = parseLauncherArgs(["--", "--help"], {});
  assert.equal(codexHelp.help, false);
  assert.deepEqual(codexHelp.codexArgs, ["--help"]);
  const resume = parseLauncherArgs(["--", "resume", "--last"], {});
  assert.deepEqual(resume.codexArgs, ["resume", "--last"]);
});

test("launcher defaults and model selection stay within the six allowed models", () => {
  const defaults = parseLauncherArgs([], {});
  assert.equal(defaults.model, DEFAULT_MODEL);
  assert.equal(defaults.port, 0);
  assert.equal(defaults.background, false);
  for (const model of SUPPORTED_MODEL_IDS) {
    assert.equal(parseLauncherArgs(["--ghcp-model", model], {}).model, model);
    assert.equal(parseLauncherArgs([], { GHCP_MODEL: model }).model, model);
  }
  assert.throws(() => parseLauncherArgs(["--ghcp-model=other"], {}), /Unsupported model/);
  for (const removed of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "claude-opus-5"]) {
    assert.throws(() => parseLauncherArgs(["--ghcp-model", removed], {}), /Unsupported model/);
    assert.throws(() => parseLauncherArgs([], { GHCP_MODEL: removed }), /Unsupported model/);
  }
  for (const port of ["-1", "65536", "not-a-port", "1.5"]) {
    assert.throws(() => parseLauncherArgs([`--bridge-port=${port}`], {}), /integer/);
  }
});

test("launcher passes through normal Codex sandbox, approval and prompt arguments", () => {
  const codexArgs = ["exec", "--sandbox", "read-only", "--ask-for-approval", "on-request", "--skip-git-repo-check", "Explain this project"];
  const options = parseLauncherArgs(["--bridge-background", "--bridge-port", "4143", "--", ...codexArgs], {});
  assert.equal(options.background, true);
  assert.equal(options.port, 4143);
  assert.deepEqual(options.codexArgs, codexArgs);
  assert.doesNotThrow(() => validateCodexArgs(["exec", "-c", 'model_reasoning_effort="low"', "--", "--model is literal prompt text"]));
});

test("routing, provider and unsupported transport overrides fail before starting a bridge", () => {
  for (const args of [
    ["--model", "other"], ["--model=other"], ["-mother"], ["-m", "other"],
    ["--profile", "other"], ["-pother"], ["--oss"], ["--local-provider", "other"],
    ["--remote", "http://example.invalid"], ["--remote-auth-token-env", "TOKEN"], ["--search"],
    ["-c", 'model_provider="other"'], ["--config=model_providers.ghcp.base_url=\"https://example.invalid\""],
    ["-cmodel=\"other\""], ["-c", "features={responses_websockets=true}"],
    ["-c", '"model_provider"="other"'], ["-c", 'web_search="live"'],
    ["-c", 'model_catalog_json="other.json"'], ["--enable", "enable_request_compression"],
    ["--enable=responses_websockets_v2"], ["--enable=web_search_cached"],
    ["--enable=unified_exec,web_search_request"],
  ]) assert.throws(() => validateCodexArgs(args), /conflicts|not supported|plain dotted/);
});

test("provider arguments use loopback Responses without deprecated web search keys or approval bypasses", () => {
  const args = codexProviderArgs({ model: DEFAULT_MODEL, port: 4143 });
  assert.ok(args.every((value, index) => index % 2 || value === "-c"));
  const settings = args.filter((_value, index) => index % 2);
  assert.ok(settings.includes(`model="${DEFAULT_MODEL}"`));
  assert.ok(settings.includes('model_provider="ghcp"'));
  assert.ok(settings.includes('web_search="disabled"'));
  assert.ok(settings.includes('model_reasoning_summary="none"'));
  const provider = settings.find((setting) => setting.startsWith("model_providers.ghcp="));
  assert.match(provider, /http:\/\/127\.0\.0\.1:4143\/v1/);
  assert.match(provider, /wire_api = "responses"/);
  assert.match(provider, /requires_openai_auth = false/);
  assert.match(provider, /env_key = "CODEX_GHCP_BRIDGE_TOKEN"/);
  assert.match(provider, /supports_websockets = false/);
  assert.match(provider, /request_max_retries = 0/);
  assert.match(provider, /stream_max_retries = 0/);
  assert.ok(settings.includes("features.enable_request_compression=false"));
  assert.ok(settings.includes("features.remote_compaction_v2=false"));
  assert.ok(!settings.some((setting) => /^features\.web_search(?:=|_)/.test(setting)));
  assert.doesNotMatch(args.join(" "), /dangerously|bypass|approval_policy|sandbox_mode/);
  assert.throws(() => codexProviderArgs({ model: DEFAULT_MODEL, port: 0 }), /Invalid/);
});

test("the launch-specific private catalog contains only account-enabled main models and context limits", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ghcp catalog test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const catalog = modelCatalog(SUPPORTED_MODEL_IDS.map(id => ({
    id, capabilities: { limits: { max_context_window_tokens: 200_000, max_prompt_tokens: 136_000 } },
    ...(id === "claude-haiku-4.5" ? { policy: { state: "disabled" } } : {}),
  })).concat({ id: "unrelated-model" }));
  const filename = writeCodexCatalog(catalog, directory);
  const contents = JSON.parse(fs.readFileSync(filename, "utf8"));
  assert.deepEqual(contents, { models: catalog.models });
  assert.deepEqual(contents.models.map(entry => entry.slug), SUPPORTED_MODEL_IDS.filter(id => id !== "claude-haiku-4.5"));
  assert.ok(contents.models.every(entry => entry.context_window === 136_000 && entry.auto_compact_token_limit === 108_800));
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const args = codexProviderArgs({ model: DEFAULT_MODEL, port: 4143, catalogPath: filename });
  assert.ok(args.includes(`model_catalog_json=${JSON.stringify(filename)}`));
  assert.throws(() => codexProviderArgs({ model: DEFAULT_MODEL, port: 4143, catalogPath: "relative.json" }), /absolute/);
  assert.throws(() => writeCodexCatalog(catalog, directory), { code: "EEXIST" });
});

test("malformed or incomplete picker metadata fails before writing a fallback catalog", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-invalid-catalog-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const valid = modelCatalog([{ id: DEFAULT_MODEL, capabilities: { limits: { max_context_window_tokens: 200_000 } } }]);
  for (const catalog of [
    {}, { models: [] }, { models: [null] },
    { models: [{ ...valid.models[0], slug: "unrelated-model" }] },
    { models: [valid.models[0], valid.models[0]] },
    modelCatalog([{ id: DEFAULT_MODEL }]),
    { models: [{ ...valid.models[0], auto_compact_token_limit: 300_000 }] },
    { models: [{ ...valid.models[0], max_context_window: 1_000_000 }] },
  ]) {
    assert.throws(() => writeCodexCatalog(catalog, directory), /catalog|context limits/);
    assert.deepEqual(fs.readdirSync(directory), []);
  }
});

test("Codex receives only the local bridge token, not Copilot token environment variables", () => {
  const source = {
    PATH: "/example/bin", HOME: "/example/home", GH_TOKEN: "test-secret", GITHUB_TOKEN: "test-secret",
    GH_ENTERPRISE_TOKEN: "test-secret", GITHUB_ENTERPRISE_TOKEN: "test-secret",
    COPILOT_GITHUB_TOKEN: "test-secret", BRIDGE_API_KEY: "test-secret", GHCP_MODEL: DEFAULT_MODEL,
  };
  const result = codexEnvironment(source, "test-local-token");
  assert.equal(result.CODEX_GHCP_BRIDGE_TOKEN, "test-local-token");
  assert.equal(result.PATH, source.PATH);
  assert.equal(result.HOME, source.HOME);
  assert.equal(result.GHCP_MODEL, DEFAULT_MODEL);
  assert.equal(JSON.stringify(result).includes("test-secret"), false);
  assert.equal(source.GH_TOKEN, "test-secret");
});
