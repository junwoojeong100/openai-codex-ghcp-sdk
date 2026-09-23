import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configuredMcpServerNames, runningMcpServerNames } from "../src/mcp-isolation.mjs";

function home(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-mcp-home-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

test("configured MCP names come from user config and every installed-plugin declaration form", t => {
  const root = home(t, {
    "mcp-config.json": { mcpServers: { playwright: {}, "microsoft-learn": { url: "https://example.invalid" } } },
    "installed-plugins/azure-skills/azure/.mcp.json": { mcpServers: { azure: { command: "azmcp" } } },
    "installed-plugins/azure-skills/azure/.claude-plugin/plugin.json": { name: "azure", mcpServers: "./.mcp.json" },
    "installed-plugins/market/relative/.plugin/plugin.json": { mcpServers: "./config/servers.json" },
    "installed-plugins/market/relative/config/servers.json": { servers: { "vscode-style": {} } },
    "installed-plugins/market/inline/plugin.json": { mcpServers: { inline: { command: "node" } } },
    "installed-plugins/market/escape/.github/plugin/plugin.json": { mcpServers: "../../outside.json" },
    "installed-plugins/outside.json": { mcpServers: { "must-not-read": {} } },
    "installed-plugins/direct/.mcp.json": { mcpServers: { direct: {} } },
    "installed-plugins/market/broken/.mcp.json": "{not json",
    "installed-plugins/market/array/.mcp.json": { mcpServers: ["not", "a", "map"] },
  });
  assert.deepEqual(configuredMcpServerNames(root),
    ["azure", "direct", "inline", "microsoft-learn", "playwright", "vscode-style"]);
});

test("missing, oversized or unreadable MCP configuration disables nothing rather than failing", t => {
  assert.deepEqual(configuredMcpServerNames(undefined), []);
  assert.deepEqual(configuredMcpServerNames(path.join(os.tmpdir(), `ghcp-missing-${process.pid}-${Date.now()}`)), []);
  const root = home(t, { "mcp-config.json": JSON.stringify({ mcpServers: { huge: {} }, padding: "x".repeat(1024 * 1024) }) });
  assert.deepEqual(configuredMcpServerNames(root), []);
});

test("only connected or pending servers count as still running", () => {
  assert.deepEqual(runningMcpServerNames({ servers: [
    { name: "late", status: "connected" }, { name: "starting", status: "pending" }, { name: "late", status: "connected" },
    { name: "off", status: "disabled" }, { name: "stopped", status: "stopped" }, { name: "failed", status: "failed" },
    { name: "auth", status: "needs-auth" }, { status: "connected" }, null,
  ] }), ["late", "starting"]);
  for (const list of [undefined, null, {}, { servers: "none" }]) assert.deepEqual(runningMcpServerNames(list), []);
});
