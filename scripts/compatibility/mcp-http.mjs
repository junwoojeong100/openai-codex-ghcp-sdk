import http from "node:http";
import { listen } from "./instrumentation.mjs";

// An owned Streamable HTTP protocol fixture, NOT external OAuth certification.
export async function startHttpMcp({ token, resourceCode, nonce, ledger }) {
  const server = http.createServer(async (request, response) => {
    const authenticated = request.headers.authorization === `Bearer ${token}`;
    ledger.push({ event: "http", method: request.method, authenticated }); // Never retain headers/token.
    if (!authenticated) { request.resume(); response.writeHead(401); response.end(); return; }
    if (request.method !== "POST" || request.url !== "/mcp") { request.resume(); response.writeHead(405); response.end(); return; }
    let bytes = 0, body = "";
    try {
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 64 * 1024) throw new Error("MCP request limit"); body += chunk.toString("utf8"); }
      const message = JSON.parse(body), { id, method, params = {} } = message;
      if (id === undefined) { response.writeHead(202); response.end(); return; }
      ledger.push({ event: "request", id, method, params, authenticated });
      let result;
      if (method === "initialize") result = { protocolVersion: params.protocolVersion || "2025-03-26", capabilities: { tools: {}, resources: {} }, serverInfo: { name: "owned-http-fixture", version: "1.0.0" } };
      else if (method === "ping") result = {};
      else if (method === "tools/list") result = { tools: [{ name: "lookup", description: "missing returns ENOENT; selected returns the fixture nonce", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: { key: { type: "string", enum: ["missing", "selected"] } }, required: ["key"], additionalProperties: false } }] };
      else if (method === "resources/list") result = { resources: [{ uri: "fixture://config", name: "fixture-config", mimeType: "application/json" }] };
      else if (method === "resources/templates/list") result = { resourceTemplates: [] };
      else if (method === "resources/read" && params.uri === "fixture://config") result = { contents: [{ uri: "fixture://config", mimeType: "application/json", text: JSON.stringify({ code: resourceCode, key: "selected" }) }] };
      else if (method === "tools/call" && params.name === "lookup" && Object.keys(params.arguments || {}).length === 1 && ["missing", "selected"].includes(params.arguments?.key)) {
        const missing = params.arguments.key === "missing";
        result = { isError: missing, content: [{ type: "text", text: missing ? "ENOENT: fixture key missing" : nonce }] };
      }
      response.setHeader("content-type", "application/json");
      if (result === undefined) response.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message: "Unknown fixture request" } }));
      else { ledger.push({ event: "response", id, method, result }); response.end(JSON.stringify({ jsonrpc: "2.0", id, result })); }
    } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
  });
  const port = await listen(server);
  return { server, port, url: `http://127.0.0.1:${port}/mcp`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
