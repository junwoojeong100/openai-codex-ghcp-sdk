import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { registration, controlTurn, openThread, commandPrompt, assertPhaseAnswer,
  phaseById, finalText, commandResult, fileText, controlMarker } from "../oracles.mjs";
import { ROOT, treeState } from "../../validation/evidence.mjs";

const noInference = (e, start, end) => assert.ok(!e.sdk.slice(start, end).some(({ type }) =>
  ["session.created", "session.send.started", "tool.submitted", "usage"].includes(type)), "A rejected native invocation performed inference.");
const read = commandPrompt('process.stdout.write(require("node:fs").readFileSync("marker.txt","utf8"));');
const recall = "Without using tools, repeat exactly the marker you read earlier. No extra text.";
const readConfig = async (f, host) => {
  await f.rpc(host, "config/read", { includeLayers: true, cwd: f.workspace });
  return f.phases.at(-1).id;
};

function cli(dimension) {
  return registration(async (f) => {
    if (dimension === "normal") {
      f.seed({ "unicode.txt": "한글 café Ω\n", "crlf.txt": "ONE\r\nTWO\r\n", "empty.txt": "" });
      const names = ["marker.txt", "unicode.txt", "crlf.txt", "empty.txt"];
      const prompt = commandPrompt(`const fs=require("node:fs");console.log(JSON.stringify({cwd:process.cwd(),files:Object.fromEntries(${JSON.stringify(names)}.map(name=>[name,fs.readFileSync(name,"utf8")]))}));`);
      const text = await f.exec(prompt, { json: false });
      const json = await f.exec(prompt);
      return { text: text.id, json: json.id, names };
    }
    if (dimension === "failure") {
      const invalid = await f.exec("No inference is allowed for this invalid invocation.", { args: ["--invalid-native-validation-flag"], expectError: true });
      const missing = await f.exec(commandPrompt('require("node:fs").readFileSync("absent-fixture.txt","utf8");', "After the command fails, reply with exactly ENOENT."));
      return { invalid: invalid.id, missing: missing.id };
    }
    f.addWorkspace();
    f.baseline();
    const secondHome = path.join(f.home, "second-codex-home");
    fs.mkdirSync(secondHome, { mode: 0o700 });
    const first = await f.exec(read);
    const second = await f.exec(read, { home: secondHome, workspaceIndex: 1 });
    f.runtimeState.execHomes = [f.codexHome, secondHome].map((home) => ({ home, files: treeState(home) }));
    return { first: first.id, second: second.id };
  }, (e, data) => {
    if (dimension === "normal") {
      const text = phaseById(e, data.text), json = phaseById(e, data.json);
      const expected = { cwd: json.invocation.cwd, files: Object.fromEntries(data.names.map((name) => [name, fileText(e.state.before, name)])) };
      assert.match(expected.cwd, /workspace /);
      assert.equal(text.result.code, 0); assert.equal(text.result.signal, null);
      assert.deepEqual(JSON.parse(text.result.stdout.trim()), expected);
      assert.deepEqual(JSON.parse(finalText(json)), expected);
      assert.deepEqual(JSON.parse(commandResult(json)[0].aggregatedOutput.trim()), expected);
      assert.equal(text.invocation.cwd, json.invocation.cwd);
    } else if (dimension === "failure") {
      const invalid = phaseById(e, data.invalid);
      assert.ok(Number.isInteger(invalid.result.code) && invalid.result.code !== 0);
      assert.match(invalid.result.stderr, /invalid-native-validation-flag/);
      noInference(e, invalid.sdkStart, invalid.sdkEnd);
      assertPhaseAnswer(e, data.missing, "ENOENT", { failure: true, contains: /ENOENT/ });
      assert.deepEqual(e.state.before, e.state.after);
    } else {
      const ids = new Set();
      for (const [index, id] of [data.first, data.second].entries()) {
        const phase = assertPhaseAnswer(e, id, fileText(e.state.before, "marker.txt", index).trim());
        const rows = phase.result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
        const started = rows.filter(({ type }) => type === "thread.started");
        assert.equal(started.length, 1); ids.add(started[0].thread_id);
        assert.ok(phase.invocation.args.includes("--ephemeral"));
        assert.ok(!phase.prompt.includes(fileText(e.state.before, "marker.txt", 1 - index).trim()));
      }
      assert.equal(ids.size, 2);
      assert.notEqual(phaseById(e, data.first).invocation.cwd, phaseById(e, data.second).invocation.cwd);
      assert.equal(e.sdk.filter(({ type }) => type === "session.created").length, 2);
      assert.equal(new Set(e.native.runtimeState.execHomes.map(({ home }) => home)).size, 2);
      for (const { files } of e.native.runtimeState.execHomes) assert.ok(!Object.keys(files).some((name) => name.startsWith("sessions/")), "Ephemeral execution retained a session rollout.");
    }
  });
}

function settings(dimension) {
  return registration(async (f) => {
    const configs = [], controls = [];
    let invalid;
    if (dimension === "failure") {
      f.setConfig('model = ["unfinished"\n');
      const sdkStart = f.sdk.length;
      let broken;
      try {
        broken = await f.host();
        await f.rpc(broken, "config/read", { includeLayers: true, cwd: f.workspace });
        assert.fail("Malformed TOML was silently accepted.");
      } catch (error) {
        if (error.code === "ERR_ASSERTION") throw error;
        invalid = { hostId: f.hosts.at(-1).fixtureId, sdkStart, sdkEnd: f.sdk.length,
          phase: broken ? f.phases.at(-1).id : null, message: error.message };
      } finally { if (broken) await broken.stop(); }
    }
    f.setConfig('model_verbosity = "low"\n');
    const first = await f.host({ args: dimension === "normal" ? ["-c", 'model_verbosity="high"'] : [] });
    configs.push(await readConfig(f, first));
    const firstStart = await f.thread(first);
    controls.push((await controlTurn(f, { host: first, start: firstStart, threadId: firstStart.thread.id })).phase.id);
    if (dimension === "lifecycle") {
      await first.stop();
      f.setConfig('model_verbosity = "high"\n');
      for (const args of [[], ["-c", 'model_verbosity="low"']]) {
        const host = await f.host({ args });
        configs.push(await readConfig(f, host));
        const start = await f.thread(host);
        controls.push((await f.turn(host, start.thread.id, read)).id);
        await host.stop();
      }
    }
    return { configs, controls, invalid, configPath: path.join(f.codexHome, "config.toml"), cwd: f.workspace };
  }, (e, data) => {
    const expected = dimension === "normal" ? ["high"] : dimension === "lifecycle" ? ["low", "high", "low"] : ["low"];
    assert.equal(data.configs.length, expected.length);
    data.configs.forEach((id, index) => {
      const phase = phaseById(e, id);
      assert.equal(phase.method, "config/read");
      assert.equal(phase.params.cwd, data.cwd);
      assert.equal(phase.result.config.model_verbosity, expected[index]);
      assert.equal(phase.result.config.model_provider, "ghcp");
      assert.ok(phase.result.layers.some(({ name, disabledReason }) => name.file === data.configPath && !disabledReason));
      const control = assertPhaseAnswer(e, data.controls[index], controlMarker(e));
      assert.equal(control.hostId, phase.hostId);
      const thread = e.native.phases.find((p) => p.kind === "thread" && p.result.thread.id === control.threadId);
      assert.equal(thread.result.thread.cwd, data.cwd);
    });
    assert.equal(new Set(data.configs.map((id) => phaseById(e, id).hostId)).size, expected.length);
    if (dimension === "failure") {
      noInference(e, data.invalid.sdkStart, data.invalid.sdkEnd);
      const host = e.native.hosts.find(({ id }) => id === data.invalid.hostId);
      assert.match(host.stderr, /TOML|parse|config/i);
      const process = e.processes.find(({ id }) => id === host.id);
      assert.equal(process.closed, true);
      if (data.invalid.phase) {
        const failure = phaseById(e, data.invalid.phase);
        assert.equal(failure.error.name, "RpcError");
        assert.match(failure.error.message, /configuration|TOML|parse|unclosed/i);
      } else assert.notEqual(process.exit.code, 0);
    }
  });
}

const rejectedOverrides = [
  ["--model", "gpt-6-astra"], ["-c", 'model_provider="openai"'], ["--search"],
  ["--enable", "enable_request_compression"], ["--enable", "responses_websockets"],
  ["--enable", "remote_compaction_v2"], ["--remote", "ws://127.0.0.1:9"],
];
function providerControls(dimension) {
  return registration(async (f) => {
    const rejects = [];
    const c = await openThread(f);
    const before = await readConfig(f, c.host);
    if (dimension !== "normal") {
      for (const args of rejectedOverrides) {
        const phase = { id: `phase-${f.phases.length + 1}`, kind: "launcher-rejection", args, sdkStart: f.sdk.length };
        f.phases.push(phase);
        phase.result = await f.runBinary(process.execPath, [path.join(ROOT, "src/launcher.mjs"), "--ghcp-model", f.model, "--", ...args], {
          cwd: f.workspace, env: { ...f.environment(), CODEX_BIN: path.join(f.tmp, "must-not-start-codex") }, signal: f.signal, timeoutMs: 10_000,
        });
        f.processes.push({ kind: "launcher-rejection", ...phase.result });
        phase.sdkEnd = f.sdk.length;
        rejects.push(phase.id);
      }
    }
    const control = await controlTurn(f, c);
    return { control: control.phase.id, before, after: await readConfig(f, c.host), rejects };
  }, (e, data) => {
    assertPhaseAnswer(e, data.control, controlMarker(e));
    const before = phaseById(e, data.before).result.config, after = phaseById(e, data.after).result.config;
    assert.deepEqual(before, after);
    assert.equal(after.model_provider, "ghcp");
    assert.equal(after.web_search, "disabled");
    const transports = e.http.filter(({ layer }) => layer === "transport");
    assert.ok(transports.length);
    assert.ok(transports.every(({ contentEncoding, upgrade }) => contentEncoding === null && upgrade === null));
    for (const { request } of e.http.filter(({ layer }) => layer === "bridge")) {
      assert.equal(request.model, e.model);
      assert.ok(!(request.tools || []).some(({ type }) => ["web_search", "file_search", "code_interpreter"].includes(type)));
    }
    assert.equal(data.rejects.length, dimension === "normal" ? 0 : rejectedOverrides.length);
    data.rejects.forEach((id, index) => {
      const phase = phaseById(e, id);
      assert.deepEqual(phase.args, rejectedOverrides[index]);
      assert.ok(Number.isInteger(phase.result.code) && phase.result.code !== 0);
      assert.match(phase.result.stderr, /conflicts|not supported/);
      assert.ok(!phase.result.stderr.includes("Cannot run Codex"));
      noInference(e, phase.sdkStart, phase.sdkEnd);
    });
  });
}
export const RUNTIME_DRIVERS = Object.freeze(Object.fromEntries(["normal", "failure", "lifecycle"].flatMap((dimension) => [
  [`cli-runtime.${dimension}`, cli(dimension)], [`settings.${dimension}`, settings(dimension)],
  [`provider-controls.${dimension}`, providerControls(dimension)],
])));
