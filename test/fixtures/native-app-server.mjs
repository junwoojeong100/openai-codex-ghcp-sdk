// Local JSONL peer for controller tests; not a model or native acceptance driver.
import readline from "node:readline";
const mode = process.argv[2] ?? "normal";
let initialized = false;
let callback;
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (id, result) => send({ id, result });
const error = (id, message) => send({ id, error: { code: -32002, message } });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (!message.method) {
    if (message.id === 900 && callback !== undefined) reply(callback, { callback: message });
    return;
  }
  if (message.method === "initialize") {
    if (mode === "invalid-json") return process.stdout.write("not-json\n");
    if (mode === "truncated") { process.stdout.write('{"truncated":'); process.stdout.end(); return; }
    if (mode === "flood") return process.stdout.write("x".repeat(32_000));
    if (mode === "hang") return;
    initialized = true; return reply(message.id, { userAgent: "offline-peer" });
  }
  if (message.method === "initialized") return;
  if (!initialized) return error(message.id, "Not initialized");
  if (message.method === "fixture/echo") return reply(message.id, message.params);
  if (message.method === "fixture/hang") return;
  if (message.method === "fixture/callback") {
    callback = message.id;
    return send({ id: 900, method: "item/commandExecution/requestApproval", params: { itemId: "owned-fixture-command", threadId: "fixture-thread", turnId: "fixture-turn" } });
  }
  if (message.method === "turn/start") {
    const turn = { id: `turn-${message.id}`, status: "completed" };
    const notification = { method: "turn/completed", params: { threadId: message.params.threadId, turn } };
    if (mode === "completion-first") send(notification);
    reply(message.id, { turn: { ...turn, status: "inProgress" } });
    if (mode !== "completion-first") send(notification);
    return;
  }
  error(message.id, `Unknown method ${message.method}`);
}).on("close", () => process.exit(0));
