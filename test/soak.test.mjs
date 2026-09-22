import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "../scripts/soak.mjs";
import { assessProgress, SOAK_SECONDS } from "../scripts/soak/runner.mjs";
import { syntheticPayload, summarizeTransport, samplePrompt } from "../scripts/soak/native.mjs";
import { NativeHost } from "../scripts/compatibility/rpc.mjs";

test("five-hour execution cannot be silently shortened or confused with a smoke run", () => {
  assert.equal(SOAK_SECONDS, 18000);
  assert.deepEqual(parseArguments([]), { mode: "plan" });
  assert.equal(parseArguments(["--execute", "--duration-seconds", "18000"]).durationSeconds, 18000);
  assert.equal(parseArguments(["--smoke", "--duration-seconds", "30"]).durationSeconds, 30);
  for (const args of [["--execute", "--duration-seconds", "17999"], ["--execute", "--smoke"],
    ["--plan", "--execute"], ["--output"], ["--duration-seconds", "NaN"]]) assert.throws(() => parseArguments(args));
});
test("independent watchdog distinguishes worker starvation from long live responses", () => {
  assert.equal(assessProgress(null, 90001, 0), "startup-unresponsive");
  assert.equal(assessProgress({ phase: "turn", at: 1, currentTurnStartedAt: 0 }, 40000, 0), "worker-heartbeat-stale");
  assert.equal(assessProgress({ phase: "turn", at: 100000, currentTurnStartedAt: 0 }, 100000, 0), "long-response");
  assert.equal(assessProgress({ phase: "pacing", at: 100000 }, 100000, 0), "responsive");
  assert.equal(assessProgress({ phase: "finished", at: 0 }, 100000, 0), "finished");
});
test("sample growth is bounded and transport truncation remains explicit", () => {
  const sample = syntheticPayload(3, 8192);
  assert.equal(Buffer.byteLength(sample.text), 8192);
  assert.ok(sample.text.includes(sample.marker));
  assert.notEqual(samplePrompt(1), samplePrompt(2));
  assert.match(samplePrompt(3), /file has been updated/);
  assert.match(samplePrompt(3), /exactly once in THIS turn/);
  assert.equal(samplePrompt(3).includes(sample.marker), false);
  assert.throws(() => syntheticPayload(1, 65537));
  const row = summarizeTransport({ request: { input: [] }, responseText: 'data: {"type":"response.created"}\n\ndata: {"type":',
    status: 200, finished: false });
  assert.equal(row.terminal, null); assert.equal(row.parseFailures.length, 1);
});
test("long-lived hosts can raise only the diagnostic transcript budget explicitly", () => {
  assert.equal(new NativeHost({}).maxTranscriptBytes, 8 * 1024 * 1024);
  assert.equal(new NativeHost({}).maxStderrBytes, 1024 * 1024);
  assert.equal(new NativeHost({ maxTranscriptBytes: 10000000 }).maxTranscriptBytes, 10000000);
  assert.throws(() => new NativeHost({ maxTranscriptBytes: Infinity }));
  assert.throws(() => new NativeHost({ maxStderrBytes: -1 }));
});
