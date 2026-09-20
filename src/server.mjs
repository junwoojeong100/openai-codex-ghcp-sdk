import http from "node:http";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

import { DEFAULT_MAX_BODY_BYTES, DEFAULT_MAX_REPLAY_BYTES } from "./limits.mjs";
import { DEFAULT_MODEL, SUPPORTED_MODEL_IDS, modelCatalog } from "./model-map.mjs";
import { BridgeRequestError } from "./request-policy.mjs";
import { ResponsesStream, createResponse } from "./responses.mjs";
import { SessionManager } from "./session-manager.mjs";

function writeJson(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function writeError(res, error) {
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
  writeJson(res, status, {
    error: {
      message: error.message || "The bridge could not complete the request.",
      type: status < 500 ? "invalid_request_error" : "api_error",
      code: error.code || (status < 500 ? "invalid_request_error" : "copilot_error"),
      param: null,
    },
  });
}

function authenticated(req, apiKey) {
  const value = req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.headers["x-api-key"];
  if (typeof value !== "string") return false;
  const provided = Buffer.from(value);
  const expected = Buffer.from(apiKey);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function readBody(req, maxBodyBytes) {
  const encoding = req.headers["content-encoding"];
  if (encoding && encoding !== "identity") {
    throw new BridgeRequestError("Compressed requests are not supported. Disable features.enable_request_compression in Codex.", {
      status: 415, code: "unsupported_content_encoding",
    });
  }
  if (Number(req.headers["content-length"]) > maxBodyBytes) {
    throw new BridgeRequestError("Request body exceeds MAX_BODY_BYTES.", { status: 413, code: "body_too_large" });
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new BridgeRequestError("Request body exceeds MAX_BODY_BYTES.", { status: 413, code: "body_too_large" });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BridgeRequestError("Request body must be valid JSON.");
  }
}

export function createBridgeServer({
  manager,
  apiKey,
  instanceId = null,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  onDiagnostic = () => {},
}) {
  if (!apiKey || typeof apiKey !== "string") throw new Error("BRIDGE_API_KEY is required.");
  const controllers = new Set();
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader("x-request-id", requestId);
    let pathname;
    try {
      pathname = new URL(req.url || "/", "http://localhost").pathname;
    } catch {
      writeError(res, new BridgeRequestError("Invalid request URL."));
      return;
    }
    if (req.method === "GET" && pathname === "/health") {
      writeJson(res, 200, {
        ok: true,
        protocol: "responses",
        instanceId,
        pid: process.pid,
        preferredModel: manager.preferredModel,
        modelCount: manager.listModels().length,
      });
      return;
    }
    if (!authenticated(req, apiKey)) {
      writeJson(res, 401, { error: { type: "authentication_error", code: "invalid_api_key", message: "Invalid bridge credential." } });
      return;
    }
    if (req.method === "GET" && pathname === "/v1/models") {
      writeJson(res, 200, modelCatalog(manager.listModels()));
      return;
    }
    if (pathname === "/v1/responses/compact") {
      writeError(res, new BridgeRequestError("Remote Responses compaction is not supported by this bridge.", { code: "unsupported_compaction" }));
      return;
    }
    if (req.method !== "POST" || pathname !== "/v1/responses") {
      writeError(res, new BridgeRequestError("Not found.", { status: 404, code: "not_found" }));
      return;
    }
    const controller = new AbortController();
    controllers.add(controller);
    const onClose = () => { if (!res.writableEnded) controller.abort(); };
    req.once("aborted", onClose);
    res.once("close", onClose);
    let stream;
    let keepAlive;
    try {
      const body = await readBody(req, maxBodyBytes);
      const id = `resp_${requestId.replaceAll("-", "")}`;
      const result = await manager.execute(body, req.headers, {
        responseId: id,
        signal: controller.signal,
        onReady: ({ model }) => {
          if (body.stream !== true) return;
          res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          res.flushHeaders();
          stream = new ResponsesStream(res, { id, model });
          stream.start();
          keepAlive = setInterval(() => {
            if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
          }, 15_000);
          keepAlive.unref();
        },
        onEvent: (event) => stream?.handleSdkEvent(event),
      });
      clearInterval(keepAlive);
      if (res.destroyed) return;
      if (stream) stream.finish(result);
      else writeJson(res, 200, createResponse({ id, ...result }));
    } catch (error) {
      clearInterval(keepAlive);
      if (error.name === "AbortError" || res.destroyed) return;
      onDiagnostic({ event: "bridge.request_failed", requestId, name: error.name, code: error.code || "copilot_error" });
      if (stream) stream.fail(error);
      else writeError(res, error);
    } finally {
      req.removeListener("aborted", onClose);
      res.removeListener("close", onClose);
      controllers.delete(controller);
    }
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  server.abortActiveRequests = () => { for (const controller of controllers) controller.abort(); };
  return server;
}

function integerEnv(env, name, fallback, minimum = 1) {
  if (env[name] === undefined || env[name] === "") return fallback;
  const value = Number(env[name]);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}.`);
  return value;
}

export function bridgeConfig(env = process.env) {
  const host = env.HOST || "127.0.0.1";
  if (!["127.0.0.1", "::1", "localhost"].includes(host)) throw new Error("The bridge only binds to loopback.");
  const port = integerEnv(env, "PORT", 4143, 0);
  if (port > 65_535) throw new Error("PORT must be between 0 and 65535.");
  if (!env.BRIDGE_API_KEY) throw new Error("BRIDGE_API_KEY is required.");
  const preferredModel = env.GHCP_MODEL || DEFAULT_MODEL;
  if (!SUPPORTED_MODEL_IDS.includes(preferredModel)) throw new Error(`Unsupported GHCP_MODEL: ${preferredModel}.`);
  return {
    host, port, preferredModel,
    apiKey: env.BRIDGE_API_KEY,
    instanceId: env.BRIDGE_INSTANCE_ID || null,
    maxBodyBytes: integerEnv(env, "MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES),
    managerOptions: {
      preferredModel,
      logLevel: env.LOG_LEVEL || "error",
      turnTimeoutMs: integerEnv(env, "TURN_TIMEOUT_MS", 300_000),
      cleanupTimeoutMs: integerEnv(env, "CLEANUP_TIMEOUT_MS", 5_000),
      pendingToolWaitMs: integerEnv(env, "PENDING_TOOL_WAIT_MS", 10_000),
      stateIdleTtlMs: integerEnv(env, "STATE_IDLE_TTL_MS", 30 * 60_000),
      maxStates: integerEnv(env, "MAX_STATES", 64),
      maxReplayBytes: integerEnv(env, "MAX_REPLAY_BYTES", DEFAULT_MAX_REPLAY_BYTES),
      maxToolResults: integerEnv(env, "MAX_TOOL_RESULTS", 32),
    },
  };
}

async function main() {
  const config = bridgeConfig();
  const onDiagnostic = (event) => console.error(JSON.stringify(event));
  const manager = new SessionManager({ ...config.managerOptions, onDiagnostic });
  const server = createBridgeServer({ ...config, manager, onDiagnostic });
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    server.close();
    server.abortActiveRequests();
    server.closeAllConnections();
    await manager.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await manager.start();
    if (stopping) return;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, resolve);
    });
    const { port } = server.address();
    const event = {
      event: "bridge.started",
      port,
      address: `http://${config.host.includes(":") ? `[${config.host}]` : config.host}:${port}`,
      instanceId: config.instanceId,
      preferredModel: config.preferredModel,
      modelCount: manager.listModels().length,
    };
    console.log(JSON.stringify(event));
    process.send?.(event);
  } catch (error) {
    await manager.stop();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  });
}
