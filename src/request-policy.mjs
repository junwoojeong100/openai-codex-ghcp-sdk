import { createHash } from "node:crypto";

export class BridgeRequestError extends Error {
  constructor(message, { status = 400, code = "invalid_request_error" } = {}) {
    super(message);
    this.name = "BridgeRequestError";
    this.status = status;
    this.code = code;
  }
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeRequestError(`${label} must be an object.`);
  }
  return value;
}

function string(value, label, { empty = false } = {}) {
  if (typeof value !== "string" || (!empty && !value.length)) {
    throw new BridgeRequestError(`${label} must be ${empty ? "a" : "a non-empty"} string.`);
  }
  return value;
}

function keys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new BridgeRequestError(`Unsupported ${label} field: ${key}.`);
  }
}

function boolean(value, label, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new BridgeRequestError(`${label} must be a boolean.`);
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function textContent(value, label) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new BridgeRequestError(`${label} must be text or an array of text parts.`);
  return value.map((part) => {
    object(part, `${label} part`);
    if (!["input_text", "output_text"].includes(part.type)) {
      throw new BridgeRequestError(`Unsupported ${label} part: ${part.type || "missing type"}. Only text is supported.`);
    }
    keys(part, ["type", "text", "annotations", "logprobs"], `${label} part`);
    return string(part.text, `${label} text`, { empty: true });
  }).join("\n\n");
}

function namespace(value) {
  return value == null ? {} : { namespace: string(value, "Tool namespace") };
}

function jsonArguments(value) {
  if (value === undefined) throw new BridgeRequestError("function_call.arguments is required.");
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch {
      throw new BridgeRequestError("function_call.arguments must contain valid JSON.");
    }
  }
  return value;
}

// The same representation is used for incoming history and our outgoing items.
export function canonicalItem(item) {
  object(item, "Input item");
  const type = item.type || (item.role ? "message" : undefined);
  switch (type) {
    case "message": {
      keys(item, ["type", "role", "content", "id", "status", "phase"], "message");
      if (!["user", "assistant", "system", "developer"].includes(item.role)) {
        throw new BridgeRequestError("Message role must be user, assistant, system, or developer.");
      }
      return { type: "message", role: item.role, content: textContent(item.content, "Message content") };
    }
    case "function_call":
      keys(item, ["type", "id", "status", "name", "namespace", "call_id", "arguments"], "function_call");
      return {
        type,
        name: string(item.name, "Tool name"),
        ...namespace(item.namespace),
        call_id: string(item.call_id, "Tool call_id"),
        arguments: jsonArguments(item.arguments),
      };
    case "custom_tool_call":
      keys(item, ["type", "id", "status", "name", "namespace", "call_id", "input"], "custom_tool_call");
      return {
        type,
        name: string(item.name, "Tool name"),
        ...namespace(item.namespace),
        call_id: string(item.call_id, "Tool call_id"),
        input: string(item.input, "Custom tool input", { empty: true }),
      };
    case "function_call_output":
    case "custom_tool_call_output":
      keys(item, ["type", "id", "status", "call_id", "output"], type);
      return { type, call_id: string(item.call_id, "Tool call_id"), output: textContent(item.output, "Tool output") };
    default:
      throw new BridgeRequestError(`Unsupported input item type: ${type || "missing type"}.`);
  }
}

function toolName(value, label) {
  string(value, label);
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(value)) {
    throw new BridgeRequestError(`${label} must use 1–128 letters, digits, underscores, dots, or hyphens.`);
  }
  return value;
}

function addTools(declarations, destination, enclosingNamespace) {
  if (!Array.isArray(declarations)) throw new BridgeRequestError("tools must be an array.");
  for (const tool of declarations) {
    object(tool, "Tool declaration");
    const name = toolName(tool.name, "Tool name");
    if (tool.type === "namespace") {
      keys(tool, ["type", "name", "description", "tools"], "namespace tool");
      if (enclosingNamespace) throw new BridgeRequestError("Nested tool namespaces are not supported.");
      if (tool.description != null) string(tool.description, "Namespace description", { empty: true });
      addTools(tool.tools, destination, name);
      continue;
    }
    if (!["function", "custom"].includes(tool.type)) {
      throw new BridgeRequestError(`Unsupported tool type: ${tool.type || "missing type"}. Only client-side function/custom tools are supported.`);
    }
    keys(tool, tool.type === "function"
      ? ["type", "name", "description", "parameters", "strict"]
      : ["type", "name", "description", "format"], "tool");
    const description = tool.description == null ? "" : string(tool.description, "Tool description", { empty: true });
    const identity = JSON.stringify([enclosingNamespace || null, name]);
    const sdkName = `ghcp_${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
    const qualifiedName = enclosingNamespace ? `${enclosingNamespace}.${name}` : name;
    const normalized = {
      name: sdkName,
      originalName: name,
      ...(enclosingNamespace ? { namespace: enclosingNamespace } : {}),
      type: tool.type,
      description: `Client tool ${qualifiedName}.\n${description}`,
    };
    if (tool.type === "function") {
      if (tool.strict != null && typeof tool.strict !== "boolean") throw new BridgeRequestError("Tool strict must be a boolean.");
      if (tool.strict === true) throw new BridgeRequestError("Strict tool-schema enforcement is not supported by the Copilot bridge.");
      normalized.parameters = tool.parameters == null ? { type: "object", properties: {} } : object(tool.parameters, "Tool parameters");
    } else {
      const format = tool.format == null ? { type: "text" } : object(tool.format, "Custom tool format");
      if (format.type === "text") keys(format, ["type"], "custom tool format");
      else if (format.type === "grammar") {
        keys(format, ["type", "syntax", "definition"], "custom tool grammar");
        if (!["lark", "regex"].includes(format.syntax)) throw new BridgeRequestError("Custom tool grammar syntax must be lark or regex.");
        string(format.definition, "Custom tool grammar definition");
      } else throw new BridgeRequestError("Custom tool format must be text or grammar.");
      normalized.format = format;
      normalized.parameters = {
        type: "object",
        properties: { input: { type: "string", description: "Exact raw tool input. Preserve whitespace and newlines; do not add quoting or code fences." } },
        required: ["input"],
        additionalProperties: false,
      };
      normalized.description += "\nSupply the exact raw tool input as the input string. Preserve all whitespace and newlines; do not JSON-encode that string again.";
      if (format.type === "grammar") {
        normalized.description += `\nRequested ${format.syntax} grammar (advisory; not enforced by this bridge):\n${format.definition}`;
      }
    }
    const existing = destination.get(identity);
    if (existing && JSON.stringify(stable(existing)) !== JSON.stringify(stable(normalized))) {
      throw new BridgeRequestError(`Conflicting declarations for tool ${qualifiedName}.`);
    }
    if (!existing) destination.set(identity, normalized);
  }
}

export function normalizeRequest(body, onDiagnostic = () => {}) {
  object(body, "Request body");
  keys(body, [
    "model", "input", "instructions", "tools", "stream", "previous_response_id", "tool_choice",
    "parallel_tool_calls", "reasoning", "store", "background", "text", "include", "prompt_cache_key",
    "client_metadata", "metadata", "user", "safety_identifier", "service_tier", "temperature", "top_p",
    "max_output_tokens", "max_tool_calls", "truncation",
  ], "request");
  const ignored = [];
  const stream = boolean(body.stream, "stream", false);
  const parallelToolCalls = boolean(body.parallel_tool_calls, "parallel_tool_calls", true);
  if (boolean(body.store, "store", false)) throw new BridgeRequestError("store=true is not supported; response state is process-local only.");
  if (boolean(body.background, "background", false)) throw new BridgeRequestError("Background Responses requests are not supported.");
  for (const field of ["temperature", "top_p", "max_output_tokens", "max_tool_calls"]) {
    if (body[field] != null) throw new BridgeRequestError(`${field} is not supported by this bridge.`);
  }
  if (body.truncation != null && body.truncation !== "disabled") throw new BridgeRequestError("Automatic request truncation is not supported.");
  if (body.service_tier != null && body.service_tier !== "auto") throw new BridgeRequestError("Custom service_tier is not supported.");
  const toolChoice = body.tool_choice ?? "auto";
  if (!["auto", "none"].includes(toolChoice)) throw new BridgeRequestError("Only tool_choice auto or none is supported.");
  let reasoningEffort;
  if (body.reasoning != null) {
    object(body.reasoning, "reasoning");
    keys(body.reasoning, ["effort", "context", "summary"], "reasoning");
    if (body.reasoning.effort != null) reasoningEffort = string(body.reasoning.effort, "reasoning.effort");
    if (body.reasoning.context != null) {
      string(body.reasoning.context, "reasoning.context");
      ignored.push("reasoning.context");
    }
    if (body.reasoning.summary != null) throw new BridgeRequestError("Reasoning summaries are not exposed by this bridge.");
  }
  if (body.text != null) {
    object(body.text, "text");
    keys(body.text, ["format", "verbosity"], "text");
    if (body.text.format != null) {
      object(body.text.format, "text.format");
      if (body.text.format.type !== "text") throw new BridgeRequestError("Structured output is not supported; use plain text output.");
      keys(body.text.format, ["type"], "text.format");
    }
    if (body.text.verbosity != null) {
      if (!["low", "medium", "high"].includes(body.text.verbosity)) throw new BridgeRequestError("Invalid text.verbosity.");
      ignored.push("text.verbosity");
    }
  }
  if (body.include != null) {
    if (!Array.isArray(body.include)) throw new BridgeRequestError("include must be an array.");
    for (const field of body.include) {
      if (field !== "reasoning.encrypted_content") throw new BridgeRequestError(`Unsupported include field: ${field}.`);
    }
    if (body.include.length) ignored.push("reasoning.encrypted_content");
  }
  for (const field of ["prompt_cache_key", "user", "safety_identifier"]) {
    if (body[field] != null) { string(body[field], field); ignored.push(field); }
  }
  for (const field of ["client_metadata", "metadata"]) {
    if (body[field] != null) { object(body[field], field); ignored.push(field); }
  }
  const declarations = new Map();
  let toolsProvided = Object.hasOwn(body, "tools");
  if (toolsProvided) addTools(body.tools, declarations);
  const rawInput = typeof body.input === "string" ? [{ type: "message", role: "user", content: body.input }] : (body.input ?? []);
  if (!Array.isArray(rawInput)) throw new BridgeRequestError("input must be a string or an array.");
  const input = [];
  for (const item of rawInput) {
    if (item?.type === "additional_tools") {
      object(item, "additional_tools");
      keys(item, ["type", "id", "role", "tools"], "additional_tools");
      if (item.role !== "developer") throw new BridgeRequestError("additional_tools must have the developer role.");
      toolsProvided = true;
      addTools(item.tools, declarations);
    } else input.push(canonicalItem(item));
  }
  if (ignored.length) onDiagnostic({ event: "bridge.unsupported_hints", fields: [...new Set(ignored)] });
  return {
    model: body.model == null ? undefined : string(body.model, "model"),
    stream,
    instructions: body.instructions == null ? "" : string(body.instructions, "instructions", { empty: true }),
    instructionsProvided: Object.hasOwn(body, "instructions"),
    input,
    tools: toolChoice === "none" ? [] : [...declarations.values()],
    toolsProvided,
    toolChoice,
    previousResponseId: body.previous_response_id == null ? undefined : string(body.previous_response_id, "previous_response_id"),
    reasoningEffort,
    parallelToolCalls,
  };
}
