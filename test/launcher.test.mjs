import assert from "node:assert/strict";
import test from "node:test";

import { codexEnvironment, codexProviderArgs, parseLauncherArgs, validateCodexArgs } from "../src/launcher.mjs";
import { DEFAULT_MODEL, SUPPORTED_MODEL_IDS } from "../src/model-map.mjs";

test("launcher defaults and model selection stay within the seven allowed models", () => {
  const defaults = parseLauncherArgs([], {});
  assert.equal(defaults.model, DEFAULT_MODEL);
  assert.equal(defaults.port, 0);
  assert.equal(defaults.background, false);
  for (const model of SUPPORTED_MODEL_IDS) {
    assert.equal(parseLauncherArgs(["--ghcp-model", model], {}).model, model);
    assert.equal(parseLauncherArgs([], { GHCP_MODEL: model }).model, model);
  }
  assert.throws(() => parseLauncherArgs(["--ghcp-model=other"], {}), /Unsupported model/);
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
  assert.ok(settings.includes("features.enable_request_compression=false"));
  assert.ok(settings.includes("features.remote_compaction_v2=false"));
  assert.ok(!settings.some((setting) => /^features\.web_search(?:=|_)/.test(setting)));
  assert.doesNotMatch(args.join(" "), /dangerously|bypass|approval_policy|sandbox_mode/);
  assert.throws(() => codexProviderArgs({ model: DEFAULT_MODEL, port: 0 }), /Invalid/);
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
