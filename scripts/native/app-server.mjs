import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export class RpcError extends Error {
  constructor(method, error) { super(`${method}: ${error.message}`); this.name = "RpcError"; this.code = error.code; this.data = error.data; }
}

// Codex 0.154.0 app-server: bidirectional JSONL RPC without a jsonrpc field.
// No daemon discovery/reuse; this controller owns exactly one child process group.
export class CodexAppServer {
  constructor({ command, args, cwd, env, signal, timeoutMs = 90_000, maxBytes = 16 * 1024 * 1024,
    onRequest = async () => undefined, spawnProcess = spawn } = {}) {
    Object.assign(this, { command, args, cwd, env, signal, timeoutMs, maxBytes, onRequest, spawnProcess });
    this.events = new EventEmitter();
    this.pending = new Map();
    this.transcript = [];
    this.stderr = "";
    this.counter = 0;
    this.bytes = 0;
    this.closed = false;
    this.callbacks = new Set();
    this.waiters = new Set();
  }

  record(direction, message) {
    const entry = { sequence: this.transcript.length, direction, message };
    this.transcript.push(entry);
    this.events.emit("record", entry);
    return entry;
  }

  async start({ initialize = true } = {}) {
    this.signal?.throwIfAborted();
    this.child = this.spawnProcess(this.command, this.args, { cwd: this.cwd, env: this.env,
      detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    this.exit = new Promise((resolve) => {
      this.child.once("error", (error) => { this.closed = true; this.fail(error); resolve({ error: error.message }); });
      this.child.once("close", (code, signal) => {
        this.closed = true;
        this.fail(new Error(`Owned Codex app-server closed (${code ?? signal}).`));
        resolve({ code, signal });
      });
    });
    let buffer = "";
    const budget = (text) => {
      this.bytes += Buffer.byteLength(text);
      if (this.bytes > this.maxBytes) {
        this.fail(new Error("Codex app-server output limit exceeded."));
        void this.stop();
        return false;
      }
      return true;
    };
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      if (!budget(chunk) || this.protocolError) return;
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        try { this.receive(JSON.parse(line)); }
        catch (error) { this.protocolError = error; this.fail(error); void this.stop(); break; }
      }
    });
    this.child.stdout.once("end", () => {
      if (buffer.trim()) { this.protocolError = new Error("Truncated app-server JSONL frame."); this.fail(this.protocolError); }
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { if (budget(chunk)) this.stderr += chunk; });
    this.child.stdin.on("error", (error) => { if (!this.stopping) this.fail(error); });
    this.onAbort = () => { this.fail(this.signal.reason ?? new Error("Interrupted.")); void this.stop(); };
    this.signal?.addEventListener("abort", this.onAbort, { once: true });
    if (this.signal?.aborted) this.onAbort();
    if (initialize) await this.initialize();
    return this;
  }

  async initialize() {
    const result = await this.request("initialize", {
      clientInfo: { name: "codex-ghcp-native-validation", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized");
    return result;
  }

  receive(message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid app-server message.");
    this.record("receive", message);
    if (message.method && message.id !== undefined) {
      const callback = this.respond(message).catch((error) => { this.fail(error); void this.stop(); });
      this.callbacks.add(callback);
      callback.finally(() => this.callbacks.delete(callback));
    } else if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) throw new Error(`Uncorrelated app-server response: ${message.id}`);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new RpcError(pending.method, message.error));
      else if (Object.hasOwn(message, "result")) pending.resolve(message.result);
      else pending.reject(new Error("RPC response has neither result nor error."));
    } else if (!message.method) throw new Error("App-server notification has no method.");
  }

  async respond(message) {
    // A host callback must be answered explicitly. Unknown/approval callbacks are never auto-accepted.
    const result = await this.onRequest(message, this);
    if (this.stopping || this.closed) return;
    this.write(result === undefined
      ? { id: message.id, error: { code: -32601, message: `No fixture handler for ${message.method}.` } }
      : { id: message.id, result });
  }

  write(message) {
    if (this.closed || this.failure) throw this.failure ?? new Error("App-server is closed.");
    this.record("send", message);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) { this.write({ method, ...(params === undefined ? {} : { params }) }); }

  request(method, params = {}) {
    if (this.closed || this.failure) return Promise.reject(this.failure ?? new Error("App-server is closed."));
    this.signal?.throwIfAborted();
    const id = ++this.counter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Stop instead of accepting a late response as success or letting an abandoned turn run.
        const error = new Error(`App-server ${method} exceeded ${this.timeoutMs} ms.`);
        this.fail(error);
        void this.stop();
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.write({ method, id, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  waitFor(predicate, { after = 0, timeoutMs = this.timeoutMs } = {}) {
    const existing = this.transcript.slice(after).find(predicate);
    if (existing) return Promise.resolve(existing);
    if (this.failure || this.closed) return Promise.reject(this.failure ?? new Error("App-server is closed."));
    return new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); this.events.off("record", listener); this.waiters.delete(fail); };
      const fail = (error) => { clean(); reject(error); };
      const listener = (entry) => {
        try { if (entry.sequence >= after && predicate(entry)) { clean(); resolve(entry); } }
        catch (error) { fail(error); }
      };
      const timer = setTimeout(() => {
        const error = new Error("Timed out waiting for a native event.");
        this.fail(error);
        void this.stop();
      }, timeoutMs);
      this.waiters.add(fail);
      this.events.on("record", listener);
    });
  }

  async turn(threadId, input, overrides = {}) {
    const after = this.transcript.length;
    const response = await this.request("turn/start", { threadId,
      input: typeof input === "string" ? [{ type: "text", text: input }] : input, ...overrides });
    const turnId = response.turn?.id;
    if (!turnId) throw new Error("turn/start did not return an ID.");
    const final = await this.waitFor(({ direction, message }) => direction === "receive" &&
      message.method === "turn/completed" && message.params?.threadId === threadId && message.params?.turn?.id === turnId, { after });
    return { threadId, turnId, turn: final.message.params.turn, transcript: this.transcript.slice(after), after };
  }

  fail(error) {
    this.failure ??= error;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
    for (const reject of [...this.waiters]) reject(error);
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.signal?.removeEventListener("abort", this.onAbort);
    this.stopPromise = (async () => {
      if (!this.child) { this.closed = true; this.fail(new Error("App-server never started.")); return; }
      if (this.closed) return;
      this.fail(new Error("Owned app-server is stopping."));
      const kill = (signal) => {
        if (!this.child.pid) return;
        try {
          if (process.platform === "win32") this.child.kill(signal);
          else process.kill(-this.child.pid, signal);
        } catch (error) { if (error.code !== "ESRCH") this.fail(error); }
      };
      this.child.stdin.end();
      const term = setTimeout(() => kill("SIGTERM"), 250);
      const hard = setTimeout(() => kill("SIGKILL"), 1_500);
      try { await this.exit; }
      finally { clearTimeout(term); clearTimeout(hard); }
    })();
    return this.stopPromise;
  }
}
