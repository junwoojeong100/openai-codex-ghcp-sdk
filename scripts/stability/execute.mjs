import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { CaseExecutor } from "../compatibility/execute.mjs";
import { tree, bounded, sha } from "../compatibility/util.mjs";
import { StabilityBackend, waitUntil } from "./backend.mjs";
import { CATALOG } from "./catalog.mjs";
import { getProfile } from "./profiles.mjs";

const tool = name => ({ name, description: name === "read_fixture"
  ? "Read the owned synthetic fixture once and return its complete literal value and receipt. No credentials or external data."
  : "Unused fixture probe. Do not call this tool.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false }, deferLoading: false });

export class StabilityExecutor extends CaseExecutor {
  constructor(options) {
    const scenario = { ...options.scenario, timeoutSeconds: options.scenario.seconds,
      maxUserTurns: options.scenario.turns, maxToolCalls: CATALOG.maxNativeToolCalls };
    super({ ...options, scenario, teardownTimeoutMs: CATALOG.cleanupReserveSeconds * 1000 });
    this.profile = getProfile(options.profile);
    this.prompts = this.profile.catalog.prompts;
    this.observation.profile = this.profile.name;
    this.executionKind = options.executionKind ?? "live";
    this.observation.executionKind = this.executionKind;
    this.observation.controls = [];
    this.backendFactory = opts => new StabilityBackend({ ...opts, scenario, observation: this.observation,
      clientFactory: options.clientFactory });
    this.ownedThreads = new Set();
  }

  async prepare() {
    await super.prepare();
    this.fixtureText = `value:${this.fixture.nonce}\nreceipt:${this.fixture.secrets.helper}`;
    fs.writeFileSync(path.join(this.fixture.workspace, "fixture-data.txt"), this.fixtureText, { mode: 0o600 });
    this.observation.before = tree(this.fixture.workspace);
    this.observation.fixtureHash = sha(JSON.stringify(this.observation.before));
    this.observation.fixture.expectedValue = `value:${this.fixture.nonce}`;
    this.observation.fixture.expectedReceipt = `receipt:${this.fixture.secrets.helper}`;
    this.observation.fixture.allowed = [];
  }

  async startThread({ resume } = {}) {
    const params = { model: this.model, modelProvider: "ghcp", cwd: this.fixture.cwd,
      sandbox: "read-only", approvalPolicy: "on-request" };
    if (resume) params.threadId = resume;
    else Object.assign(params, { allowProviderModelFallback: false, ephemeral: !["S10", "S11"].includes(this.scenario.id),
      dynamicTools: [tool("read_fixture"), tool("unused_fixture")] });
    const reply = await this.host.request(resume ? "thread/resume" : "thread/start", params);
    assert.equal(reply.model, this.model); assert.equal(reply.modelProvider, "ghcp");
    assert.ok(reply.thread?.id);
    this.threadId = reply.thread.id; this.ownedThreads.add(this.threadId);
    this.observation.phases.push({ kind: resume ? "resume" : "thread", threadId: this.threadId,
      result: reply, hostPid: this.host.child.pid });
    return this.threadId;
  }

  async callback(message) {
    const p = message.params ?? {};
    if (message.method === "item/tool/call") {
      assert.equal(p.tool, "read_fixture", "Only the owned read tool is permitted");
      assert.ok(this.ownedThreads.has(p.threadId));
      assert.deepEqual(p.arguments, {});
      assert.ok(this.observation.toolLedger.length < CATALOG.maxNativeToolCalls);
      const value = fs.readFileSync(path.join(this.fixture.workspace, "fixture-data.txt"), "utf8");
      const entry = { ...p, rpcId: message.id, result: value, at: Date.now() };
      this.observation.toolLedger.push(entry);
      if (this.scenario.id === "S08" && !this.backend.faultUsed) {
        this.backend.faultUsed = true;
        entry.lossBeforeSubmission = true;
        this.backend.snapshot("before-pending-loss");
        await this.backend.loseSdk("pending-result");
        this.backend.snapshot("after-pending-loss");
      }
      return { success: true, contentItems: [{ type: "inputText", text: value }] };
    }
    if (/requestApproval$/.test(message.method)) {
      this.observation.approvals.push({ method: message.method, rpcId: message.id, decision: "decline" });
      return { decision: "decline" };
    }
    return undefined;
  }

  async turn(text, { label = "read", expected = "completed" } = {}) {
    assert.ok(this.observation.phases.filter(p => p.kind === "turn").length < this.scenario.turns);
    const phase = { kind: "turn", label, expected, threadId: this.threadId,
      after: this.observation.native.length, prompt: text };
    this.observation.phases.push(phase); this.observation.logicalPrompts.push(text);
    try {
      phase.result = await this.host.turn(this.threadId, text);
      assert.equal(phase.result.status, expected, `Unexpected native ${label} status: ${phase.result.error?.message ?? phase.result.status}`);
    } finally { phase.end = this.observation.native.length; }
    return phase;
  }

  async compact() {
    const phase = { kind: "compaction", label: "compact", operation: "thread/compact/start",
      after: this.observation.native.length, threadId: this.threadId };
    this.observation.phases.push(phase);
    try {
      phase.reply = await this.host.request("thread/compact/start", { threadId: this.threadId });
      const started = await this.host.wait(r => r.direction === "receive" && r.message.method === "turn/started" &&
        r.message.params?.threadId === this.threadId, phase.after);
      const id = started.message.params.turn.id;
      const ended = await this.host.wait(r => r.direction === "receive" && r.message.method === "turn/completed" &&
        r.message.params?.threadId === this.threadId && r.message.params.turn?.id === id, phase.after);
      phase.result = ended.message.params.turn;
      assert.equal(phase.result.status, "completed");
    } finally { phase.end = this.observation.native.length; }
  }

  async execute() {
    const PROMPTS = this.prompts;
    const id = this.scenario.id;
    await this.backend.control("/readyz");
    await this.newHost(); await this.startThread();
    if (id === "S09") this.backend.corruptDelta = true;
    if (id === "S06" || id === "S08" || id === "S09") {
      await this.turn(PROMPTS.read, { label: "fault", expected: "failed" });
      this.backend.gate?.release(); this.backend.gate = null;
      this.backend.corruptDelta = false;
      this.backend.manager.queue.timeoutMs = 80_000;
      await bounded(this.backend.manager.queue.drain(), this.signal);
      this.backend.snapshot("after-fault-drained");
      await this.startThread();
      await this.turn(PROMPTS.read, { label: "recovery" });
    } else if (id === "S07") {
      await this.turn(PROMPTS.read, { label: "before-loss" });
      await this.backend.loseSdk("idle");
      await this.turn(PROMPTS.recall, { label: "lost-conversation", expected: "failed" });
      await this.startThread();
      await this.turn(PROMPTS.read, { label: "recovery" });
    } else if (id === "S10") {
      await this.turn(PROMPTS.remember, { label: "remember" });
      const threadId = this.threadId;
      this.observation.restart = { oldHostPid: this.host.child.pid,
        sdkOffset: this.observation.sdk.length, nativeOffset: this.observation.native.length };
      await this.host.close(); await this.backend.close();
      await this.openBackend(); await this.newHost(); await this.startThread({ resume: threadId });
      await this.turn(PROMPTS.recall, { label: "recall" });
    } else if (id === "S11") {
      for (let i = 0; i < 6; i++) await this.turn(PROMPTS.remember, { label: `repeat-${i + 1}` });
      this.observation.compaction = { inputBytes: Buffer.byteLength(PROMPTS.padding) };
      await this.turn(PROMPTS.padding, { label: "padding" });
      await this.compact();
      await this.turn(PROMPTS.recall, { label: "recall" });
    } else await this.turn(PROMPTS.read);
    await waitUntil(() => this.backend.manager.queue.total === 0, this.signal);
    this.backend.snapshot("before-cleanup");
    await this.backend.control("/readyz");
  }

  async finish() {
    const result = await super.finish();
    result.resources.backends = this.backends.map(b => ({ serverClosed: !b.server?.listening,
      proxyClosed: !b.proxy?.listening, states: b.manager?.states.size ?? 0,
      queued: b.manager?.queue.total ?? 0, sdkStopped: b.manager?.lifecycle.snapshot().state === "stopped",
      generation: b.manager?.lifecycle.generation, proxyError: b.proxyError?.message ?? null }));
    result.resources.cleaned = result.resources.cleaned && result.resources.backends.every(b =>
      b.serverClosed && b.proxyClosed && b.states === 0 && b.queued === 0 && b.sdkStopped && !b.proxyError);
    return result;
  }
}
