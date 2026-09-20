import { randomUUID } from "node:crypto";
import { sha256, redactor } from "../../scripts/validation/evidence.mjs";

export class OfflineNativeFixture {
  constructor(settings, { startError, wrongAnswer = false, wrongModel = false, cleanupError = false, hang = false } = {}) {
    Object.assign(this, settings, { startError, wrongAnswer, wrongModel, cleanupError, hang });
    this.offline = true;
    this.sdk = []; this.http = []; this.diagnostics = []; this.processes = []; this.cleanupErrors = [];
    this.hosts = []; this.phases = []; this.sessions = new Map();
    this.marker = `offline-${randomUUID()}-한글`;
    this.scrub = redactor({});
    this.modelInfo = { id: this.model, supportedReasoningEfforts: ["low", "high"] };
  }
  event(value) { this.sdk.push({ sequence: this.sdk.length, ...value }); }
  async version() { return "codex-cli 0.154.0"; }
  async start() {
    this.event({ type: "client.created" });
    if (this.startError) throw this.startError;
    this.event({ type: "client.start" });
    this.event({ type: "client.listModels", models: [this.modelInfo] });
  }
  async host() {
    const host = { fixtureId: `host-${this.hosts.length + 1}`, command: "fake-native-offline-only", args: [], transcript: [], stderr: "", closed: false };
    this.hosts.push(host);
    return host;
  }
  async thread(host, options = {}) {
    const result = { model: options.model ?? this.model, modelProvider: "ghcp", thread: { id: `thread-${randomUUID()}`, cwd: "/private/fixture" } };
    this.phases.push({ kind: "thread", hostId: host.fixtureId, result });
    return result;
  }
  async turn(host, threadId, prompt, options = {}) {
    if (this.hang) return new Promise((_, reject) => {
      const cancel = () => reject(this.signal.reason);
      this.signal.addEventListener("abort", cancel, { once: true });
      if (this.signal.aborted) cancel();
    });
    const sdkStart = this.sdk.length, httpStart = this.http.length;
    let sessionId = this.sessions.get(threadId);
    if (!sessionId) {
      sessionId = `sdk-${randomUUID()}`;
      this.sessions.set(threadId, sessionId);
      this.event({ type: "session.created", sessionId, model: this.model, effort: null });
    }
    this.event({ type: "session.send.started", sessionId });
    this.event({ type: "usage", sessionId, model: this.wrongModel ? "wrong-model" : this.model, inputTokens: 10, outputTokens: 3 });
    this.event({ type: "session.send", sessionId });
    const value = this.wrongAnswer ? "fabricated" : this.marker;
    const turnId = `turn-${randomUUID()}`;
    const messages = [];
    const append = (message) => {
      const entry = { sequence: host.transcript.length, direction: "receive", message };
      host.transcript.push(entry); messages.push(entry);
    };
    append({ method: "turn/started", params: { threadId, turn: { id: turnId, status: "inProgress" } } });
    append({ method: "item/completed", params: { threadId, turnId, item: { id: `command-${turnId}`, type: "commandExecution", exitCode: 0, aggregatedOutput: `${this.marker}\n` } } });
    append({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: `message-${turnId}`, delta: value } });
    append({ method: "item/completed", params: { threadId, turnId, item: { id: `message-${turnId}`, type: "agentMessage", text: value } } });
    append({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
    this.http.push({ layer: "bridge", threadId, sessionId: threadId, sdkStart, sdkEnd: this.sdk.length,
      request: { model: this.model }, result: { model: this.model, messages: [{ content: value }] } });
    const phase = { id: `phase-${this.phases.length + 1}`, kind: "turn", hostId: host.fixtureId, threadId, turnId,
      turn: { id: turnId, status: "completed" }, prompt, options, transcript: messages,
      sdkStart, sdkEnd: this.sdk.length, httpStart, httpEnd: this.http.length };
    this.phases.push(phase);
    return phase;
  }
  async close() {
    this.closed = true;
    for (const host of this.hosts) {
      host.closed = true;
      this.processes.push({ kind: "app-server", id: host.fixtureId, closed: true, exit: { code: 0, signal: null } });
    }
    for (const sessionId of this.sessions.values()) this.event({ type: "client.deleteSession", sessionId });
    this.event({ type: "client.stop", errors: [] });
    if (this.cleanupError) this.cleanupErrors.push("Injected cleanup failure.");
  }
  nativeEvidence() { return { version: "codex-cli 0.154.0", hosts: this.hosts.map((host) => ({ ...host, id: host.fixtureId })), phases: this.phases, runtimeState: {} }; }
  state() {
    const content = Buffer.from(`${this.marker}\n`);
    const capture = [{ "marker.txt": { kind: "file", sha256: sha256(content), base64: content.toString("base64"), mode: 0o600 } }];
    return { before: capture, after: structuredClone(capture), changes: [], expectedFinal: [],
      configurationBefore: [], configurationAfter: [], configurationUnchanged: true,
      isolatedConfigUnchanged: true, outsideBefore: {}, outsideAfter: {}, outsideUnchanged: true,
      fixtureChangesAuthorized: true, allListenersClosed: this.closed === true, nativeProcessesClosed: this.closed === true,
      ownedFixtureRemoved: this.closed === true, cleanupErrors: [...this.cleanupErrors] };
  }
}
