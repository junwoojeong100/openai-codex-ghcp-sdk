// Deliberately tiny, local stdio MCP server owned by one case. No credentials,
// sockets or model calls. Never imports a user's MCP configuration.
import fs from "node:fs";
import readline from "node:readline";
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const log = entry => fs.appendFileSync(config.ledger, JSON.stringify({ ...entry, pid: process.pid }) + "\n", { mode: 0o600 });
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const fail = (id, message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message } }) + "\n");
log({ event: "started" });
let ended = false;
const end = () => { if (ended) return; ended = true; log({ event: "stopped" }); process.exit(0); };
process.once("SIGTERM", end); process.once("SIGINT", end);
readline.createInterface({ input: process.stdin }).on("line", line => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const { id, method, params = {} } = message;
  log({ event: "request", id, method, params });
  if (id === undefined) return;
  let result;
  if (method === "initialize") result = { protocolVersion: params.protocolVersion || "2024-11-05",
    capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
    serverInfo: { name: "owned-fixture", version: "1.0.0" } };
  else if (method === "ping") result = {};
  else if (method === "tools/list") result = { tools: [{ name: "lookup", description: "Fixture MCP lookup: missing returns ENOENT; selected returns the hidden MCP nonce.",
    inputSchema: { type: "object", properties: { key: { type: "string", enum: ["missing", "selected"] } }, required: ["key"], additionalProperties: false } }] };
  else if (method === "resources/list") result = { resources: [{ uri: "fixture://config", name: "fixture-config", description: "Hidden resource code and lookup key", mimeType: "application/json" }] };
  else if (method === "resources/templates/list") result = { resourceTemplates: [] };
  else if (method === "resources/read" && params.uri === "fixture://config") result = {
    contents: [{ uri: "fixture://config", mimeType: "application/json", text: JSON.stringify({ code: config.resourceCode, key: "selected" }) }],
  };
  else if (method === "tools/call" && params.name === "lookup" && Object.keys(params.arguments || {}).length === 1 && ["missing", "selected"].includes(params.arguments?.key)) {
    const missing = params.arguments.key === "missing";
    result = { isError: missing, content: [{ type: "text", text: missing ? "ENOENT: fixture key missing" : config.nonce }] };
  } else { fail(id, "Unknown fixture request"); log({ event: "rejected", id }); return; }
  log({ event: "response", id, method, result }); send(id, result);
}).once("close", end);
