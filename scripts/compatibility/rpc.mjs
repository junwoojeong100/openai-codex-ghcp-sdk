import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { bounded } from "./util.mjs";

// Owned stdio app-server transport. Unknown host callbacks are denied, never approved.
export class NativeHost {
  constructor({ bin, args, cwd, env, signal, onRequest = async () => undefined, records,
    maxTranscriptBytes = 8 * 1024 * 1024, maxStderrBytes = 1024 * 1024 }) {
    Object.assign(this, { bin, args, cwd, env, signal, onRequest });
    if (!Number.isSafeInteger(maxTranscriptBytes) || maxTranscriptBytes < 1) throw new Error("Invalid native transcript limit");
    this.maxTranscriptBytes = maxTranscriptBytes;
    if (!Number.isSafeInteger(maxStderrBytes) || maxStderrBytes < 1) throw new Error("Invalid native stderr limit");
    this.maxStderrBytes = maxStderrBytes;
    this.records = records ?? []; this.events = new EventEmitter(); this.pending = new Map(); this.counter = 0;
  }
  async start() {
    this.signal?.throwIfAborted();
    this.child = spawn(this.bin, [...this.args, "app-server", "--stdio"], { cwd: this.cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    this.exit = new Promise(resolve => this.child.once("close", (code, signal) => {
      this.closed = true; this.fail(new Error(`Native host exited: ${code ?? signal}`)); resolve({ code, signal });
    }));
    this.child.on("error", error => this.fail(error));
    this.child.stdin.on("error", error => this.fail(error));
    this.stderr = ""; let buffer = "", bytes = 0;
    this.child.stdout.setEncoding("utf8"); this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", text => { this.stderr += text; if (Buffer.byteLength(this.stderr) > this.maxStderrBytes) { this.fail(new Error("Host stderr limit")); this.child.kill("SIGKILL"); } });
    this.child.stdout.on("data", text => {
      bytes += Buffer.byteLength(text);
      if (bytes > this.maxTranscriptBytes) { this.fail(new Error("Host transcript limit")); this.child.kill("SIGKILL"); return; }
      buffer += text;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line)); } catch (error) { this.fail(error); this.child.kill("SIGKILL"); break; }
      }
    });
    this.child.stdout.on("end", () => { if (buffer.trim()) this.fail(new Error("Truncated native JSONL")); });
    this.abort = () => { this.fail(this.signal.reason); this.child.kill("SIGTERM"); };
    this.signal?.addEventListener("abort", this.abort, { once: true });
    if (this.signal?.aborted) this.abort();
    await this.request("initialize", { clientInfo: { name: "ghcp-compatibility", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    this.write({ method: "initialized" }); return this;
  }
  record(direction, message) { const r = { direction, message, at: Date.now() }; this.records.push(r); this.events.emit("record", r); }
  write(message) { if (this.failure || this.closed) throw this.failure ?? new Error("Native host closed"); this.record("send", message); this.child.stdin.write(JSON.stringify(message) + "\n"); }
  receive(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid native message");
    this.record("receive", message);
    if (message.method && message.id !== undefined) {
      Promise.resolve(this.onRequest(message)).then(result => {
        if (!this.closed && !this.failure) this.write(result === undefined ? { id: message.id, error: { code: -32601, message: "Unconfigured fixture callback denied" } } : { id: message.id, result });
      }).catch(error => { this.fail(error); this.child.kill("SIGTERM"); });
    } else if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) throw new Error("Uncorrelated native response");
      this.pending.delete(message.id);
      if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { rpc: message.error }));
      else if (Object.hasOwn(message, "result")) waiter.resolve(message.result);
      else waiter.reject(new Error("Native response has no result"));
    } else if (!message.method) throw new Error("Invalid native notification");
  }
  async request(method, params) {
    this.signal?.throwIfAborted();
    const id = ++this.counter;
    try {
      return await bounded(new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.write({ method, id, params }); }), this.signal);
    } finally { this.pending.delete(id); }
  }
  async wait(predicate, after = 0) {
    const found = this.records.slice(after).find(predicate);
    if (found) return found;
    if (this.failure) throw this.failure;
    let listener, fail;
    try {
      return await bounded(new Promise((resolve, reject) => {
        listener = record => { try { if (predicate(record)) resolve(record); } catch (error) { reject(error); } };
        fail = reject; this.events.on("record", listener); this.events.on("failure", fail);
      }), this.signal);
    } finally { this.events.off("record", listener); this.events.off("failure", fail); }
  }
  async turn(threadId, input, options = {}) {
    const after = this.records.length;
    const result = await this.request("turn/start", { ...options, threadId, input: typeof input === "string" ? [{ type: "text", text: input }] : input });
    if (!result.turn?.id) throw new Error("Native turn lacks ID");
    const final = await this.wait(r => r.direction === "receive" && r.message.method === "turn/completed" &&
      r.message.params?.threadId === threadId && r.message.params?.turn?.id === result.turn.id, after);
    return final.message.params.turn;
  }
  fail(error) {
    this.failure ??= error;
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear(); this.events.emit("failure", error);
  }
  async close() {
    this.signal?.removeEventListener("abort", this.abort);
    if (!this.child || this.closed) return;
    this.child.stdin.end(); this.child.kill("SIGTERM");
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 700);
    try { await this.exit; } finally { clearTimeout(timer); }
  }
}
