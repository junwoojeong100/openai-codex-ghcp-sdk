// Test-only JSONL peer, never imported by the live runner.
import readline from "node:readline";
const mode = process.env.CORE_PEER_MODE;
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
let waiting;
readline.createInterface({ input: process.stdin }).on("line", line => {
  const m = JSON.parse(line);
  if (m.method === "initialize") {
    if (mode === "bad-json") { process.stdout.write("not json\n"); return; }
    if (mode === "hang") return;
    send({ id: m.id, result: { userAgent: "test-peer" } });
  } else if (m.method === "fixture/callback") { waiting = m.id; send({ id: 901, method: "item/commandExecution/requestApproval", params: {} }); }
  else if (m.id === 901) send({ id: waiting, result: m });
  else if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn1" } } });
    send({ method: "turn/completed", params: { threadId: m.params.threadId, turn: { id: "turn1", status: "completed" } } });
  } else if (m.id) send({ id: m.id, result: m.params });
});
