import fs from "node:fs";
import path from "node:path";

// Bridge sessions expose only Codex-declared custom:* tools, yet the SDK runtime
// still starts every user/plugin MCP server for each session unless its exact
// configured name is disabled at creation. Disabled servers never start.
const MANIFESTS = ["plugin.json", ".plugin/plugin.json", ".claude-plugin/plugin.json", ".github/plugin/plugin.json", ".cursor-plugin/plugin.json"];
const MAX_CONFIG_BYTES = 1024 * 1024;
const RUNNING_STATUSES = new Set(["connected", "pending"]);

function readJson(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_CONFIG_BYTES ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
}

function serverNames(servers) {
  return servers && typeof servers === "object" && !Array.isArray(servers) ? Object.keys(servers) : [];
}

function directories(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
      .map(entry => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function pluginServerNames(root) {
  const found = [], files = new Set([path.join(root, ".mcp.json")]);
  for (const manifest of MANIFESTS) {
    const declared = readJson(path.join(root, manifest))?.mcpServers;
    if (typeof declared !== "string") {
      found.push(...serverNames(declared));
      continue;
    }
    // Manifest paths are relative to the plugin root; never read outside it.
    const file = path.resolve(root, declared), relative = path.relative(root, file);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) files.add(file);
  }
  for (const file of files) {
    const config = readJson(file);
    found.push(...serverNames(config?.mcpServers ?? config?.servers));
  }
  return found;
}

// Exact MCP server names configured in the SDK home: the user's mcp-config.json
// and installed plugins (installed-plugins/<marketplace>/<plugin> or one level up).
export function configuredMcpServerNames(copilotHome) {
  const found = [];
  if (typeof copilotHome === "string" && copilotHome) {
    const user = readJson(path.join(copilotHome, "mcp-config.json"));
    found.push(...serverNames(user?.mcpServers ?? user?.servers));
    for (const first of directories(path.join(copilotHome, "installed-plugins"))) {
      found.push(...pluginServerNames(first));
      for (const second of directories(first)) found.push(...pluginServerNames(second));
    }
  }
  return [...new Set(found.filter(name => typeof name === "string" && name.length > 0 && name.length <= 256))].sort();
}

// Servers from a session.mcp.list result that still hold a process or connection.
export function runningMcpServerNames(list) {
  const servers = Array.isArray(list?.servers) ? list.servers : [];
  return [...new Set(servers.filter(server => typeof server?.name === "string" && server.name.length > 0 && server.name.length <= 256 &&
    RUNNING_STATUSES.has(server.status)).map(server => server.name))].sort();
}
