import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { registration, openThread, controlTurn, commandPrompt, assertPhaseAnswer, commandResult,
  completedItems, finalText, fileText, phaseById } from "../oracles.mjs";

const base = { "unicode.txt": "한글 café Ω\n", "crlf.txt": "FIRST\r\nSECOND\r\n", "empty.txt": "", "a space.txt": "spaced fixture\n" };
const jsonCode = (names) => `const fs=require("node:fs");console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map(name=>[name,fs.readFileSync(name,"utf8")]))));`;

const read = (dimension) => registration(async (f) => {
  f.seed(base);
  const c = await openThread(f);
  if (dimension === "normal") {
    const first = await f.turn(c.host, c.threadId, commandPrompt(jsonCode(Object.keys(base))));
    return { first: first.id, names: Object.keys(base) };
  }
  if (dimension === "failure") {
    fs.symlinkSync("absent-target.txt", path.join(f.workspace, "dangling-link.txt"));
    f.baseline();
    const phases = [];
    for (const file of ["absent-file.txt", "dangling-link.txt"]) {
      phases.push((await f.turn(c.host, c.threadId, commandPrompt(`process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(file)},"utf8"));`,
        "This path is intentionally missing. After the command fails, reply with exactly ENOENT."))).id);
    }
    return { phases };
  }
  const first = await f.turn(c.host, c.threadId, commandPrompt('process.stdout.write(require("node:fs").readFileSync("unicode.txt","utf8"));'));
  f.ownerWrite("unicode.txt", `UPDATED_${randomUUID()}\n`);
  const second = await f.turn(c.host, c.threadId, commandPrompt('process.stdout.write(require("node:fs").readFileSync("unicode.txt","utf8"));'));
  return { first: first.id, second: second.id };
}, (e, data) => {
  if (dimension === "normal") {
    const expected = Object.fromEntries(data.names.map((name) => [name, fileText(e.state.before, name)]));
    const phase = assertPhaseAnswer(e, data.first, expected, { json: true });
    const output = commandResult(phase)[0].aggregatedOutput.trim();
    assert.deepEqual(JSON.parse(output), expected);
  } else if (dimension === "failure") {
    assert.equal(data.phases.length, 2);
    for (const id of data.phases) assertPhaseAnswer(e, id, "ENOENT", { failure: true, contains: /ENOENT/ });
    assert.deepEqual(e.state.before, e.state.after);
  } else {
    const before = fileText(e.state.before, "unicode.txt").trim();
    const after = fileText(e.state.after, "unicode.txt").trim();
    assert.notEqual(before, after);
    const a = assertPhaseAnswer(e, data.first, before);
    const b = assertPhaseAnswer(e, data.second, after);
    assert.equal(a.threadId, b.threadId);
    assert.notEqual(a.turnId, b.turnId);
  }
});

const searchCode = `const fs=require("node:fs");const rows=[];for(const p of fs.readdirSync("search").sort()){const text=fs.readFileSync("search/"+p,"utf8");text.split(/\\r?\\n/).forEach((s,i)=>{if(s.includes("NEEDLE"))rows.push({path:"search/"+p,line:i+1,text:s})})}console.log(JSON.stringify(rows));`;
const expectedSearch = (capture) => Object.keys(capture[0]).filter((name) => name.startsWith("search/") && capture[0][name].kind === "file").sort()
  .flatMap((name) => fileText(capture, name).split(/\r?\n/).flatMap((text, i) => text.includes("NEEDLE") ? [{ path: name, line: i + 1, text }] : []));
const search = (dimension) => registration(async (f) => {
  f.seed({ "search/a space.txt": "NEEDLE one\nskip\nNEEDLE two\n", "search/한글.txt": "skip\nNEEDLE 한글\n", "search/none.txt": "nothing here\n" });
  const c = await openThread(f);
  if (dimension === "failure") {
    const noMatch = await f.turn(c.host, c.threadId, commandPrompt('const fs=require("node:fs");const found=fs.readFileSync("search/none.txt","utf8").includes("NEEDLE");console.log(found?"MATCH":"NO_MATCH");process.exitCode=found?0:1;', "After observing the exit code, reply with exactly NO_MATCH."));
    const invalid = await f.turn(c.host, c.threadId, commandPrompt('new RegExp("[");', "After observing the actual regex error, reply with exactly INVALID_REGEX."));
    return { noMatch: noMatch.id, invalid: invalid.id };
  }
  const first = await f.turn(c.host, c.threadId, commandPrompt(searchCode));
  if (dimension === "normal") return { first: first.id };
  f.ownerWrite("search/a space.txt", null);
  f.ownerWrite("search/new.txt", `NEEDLE new ${randomUUID()}\n`);
  const second = await f.turn(c.host, c.threadId, commandPrompt(searchCode));
  return { first: first.id, second: second.id };
}, (e, data) => {
  if (dimension === "failure") {
    const a = assertPhaseAnswer(e, data.noMatch, "NO_MATCH", { failure: true, contains: /NO_MATCH/ });
    assert.equal(commandResult(a, { failure: true })[0].exitCode, 1);
    assertPhaseAnswer(e, data.invalid, "INVALID_REGEX", { failure: true, contains: /SyntaxError|regular expression/i });
  } else {
    const check = (id, capture) => {
      const expected = expectedSearch(capture);
      const phase = assertPhaseAnswer(e, id, expected, { json: true });
      assert.deepEqual(JSON.parse(commandResult(phase)[0].aggregatedOutput.trim()), expected);
    };
    check(data.first, e.state.before);
    if (dimension === "lifecycle") {
      check(data.second, e.state.after);
      assert.notDeepEqual(expectedSearch(e.state.before), expectedSearch(e.state.after));
      assert.equal(phaseById(e, data.first).threadId, phaseById(e, data.second).threadId);
    }
  }
});

const edit = (dimension) => registration(async (f) => {
  f.seed({ "value.txt": "start\nrepeat\nrepeat\nend\n", "conflict.txt": "value=2\n" });
  const c = await openThread(f, { sandbox: "workspace-write" });
  if (dimension === "failure") {
    const patch = "*** Begin Patch\n*** Update File: conflict.txt\n@@\n-value=1\n+value=3\n*** End Patch";
    const p = await f.turn(c.host, c.threadId, `Use native apply_patch exactly once with the following deliberately stale patch; do not repair or rewrite the file by other means.\n${patch}\nAfter the actual tool failure reply exactly CONFLICT.`);
    // A positive control is separate from the failed operation's assertion.
    const control = await controlTurn(f, c);
    return { first: p.id, control: control.phase.id };
  }
  const target = "start\nchanged\nrepeat\nend\n";
  const patch = "*** Begin Patch\n*** Update File: value.txt\n@@\n start\n-repeat\n+changed\n repeat\n end\n*** Add File: created.txt\n+created\n*** End Patch";
  f.expectFile("value.txt", target);
  f.expectFile("created.txt", "created\n");
  const first = await f.turn(c.host, c.threadId, `Apply exactly this patch with native apply_patch, no other writes.\n${patch}\nReply exactly EDITED after success.`);
  if (dimension === "normal") return { first: first.id };
  f.expectFile("value.txt", "start\nchanged\nsecond\nend\n");
  const secondPatch = "*** Begin Patch\n*** Update File: value.txt\n@@\n start\n changed\n-repeat\n+second\n end\n*** End Patch";
  const second = await f.turn(c.host, c.threadId, `Use native apply_patch exactly once with this second patch. Preserve all other files.\n${secondPatch}\nReply exactly EDITED_TWICE after success.`);
  return { first: first.id, second: second.id };
}, (e, data) => {
  if (dimension === "failure") {
    const phase = phaseById(e, data.first);
    assert.equal(finalText(phase).trim(), "CONFLICT");
    assert.deepEqual(e.state.before, e.state.after);
    const exchanges = e.http.slice(phase.httpStart, phase.httpEnd);
    const outputs = exchanges.flatMap(({ request }) => Array.isArray(request?.input) ? request.input : [])
      .filter(({ type }) => type === "custom_tool_call_output" || type === "function_call_output");
    assert.ok(outputs.some(({ output }) => /(?:failed|not find|context|verification)/i.test(JSON.stringify(output))), "No actual patch-error output.");
    assert.ok(!completedItems(phase).some(({ type, status }) => type === "fileChange" && status === "completed"), "Stale patch unexpectedly succeeded.");
  } else {
    const first = phaseById(e, data.first);
    assert.equal(finalText(first).trim(), "EDITED");
    assert.ok(completedItems(first).some(({ type, status }) => type === "fileChange" && status === "completed"));
    assert.equal(fileText(first.state.files, "value.txt"), "start\nchanged\nrepeat\nend\n");
    assert.equal(fileText(first.state.files, "created.txt"), "created\n");
    if (dimension === "lifecycle") {
      const second = phaseById(e, data.second);
      assert.equal(first.threadId, second.threadId);
      assert.equal(finalText(second).trim(), "EDITED_TWICE");
      assert.ok(completedItems(second).some(({ type, status }) => type === "fileChange" && status === "completed"));
      assert.equal(fileText(e.state.after, "value.txt"), "start\nchanged\nsecond\nend\n");
    }
  }
});

const notebook = () => ({ nbformat: 4, nbformat_minor: 5, metadata: { preserve: "yes" }, cells: [
  { id: "intro", cell_type: "markdown", metadata: { stable: true }, source: ["ORIGINAL\n"] },
  { id: "code", cell_type: "code", metadata: {}, execution_count: 7, source: ["print(1)\n"], outputs: [{ output_type: "stream", name: "stdout", text: ["1\n"] }] },
] });
const notebooks = (dimension) => registration(async (f) => {
  f.seed({ "fixture.ipynb": dimension === "failure" ? "{corrupt-notebook" : `${JSON.stringify(notebook(), null, 2)}\n` });
  const c = await openThread(f, { sandbox: "workspace-write" });
  if (dimension === "failure") {
    const p = await f.turn(c.host, c.threadId, commandPrompt('JSON.parse(require("node:fs").readFileSync("fixture.ipynb","utf8"));', "On the actual parse failure reply exactly INVALID_NOTEBOOK. Do not recreate the file."));
    return { first: p.id };
  }
  const expected = notebook();
  if (dimension === "normal") expected.cells[0].source = ["UPDATED\n"];
  else expected.cells.push({ id: "inserted", cell_type: "markdown", metadata: {}, source: ["INSERTED\n"] });
  f.expectFile("fixture.ipynb", `${JSON.stringify(expected, null, 2)}\n`);
  const mutate = (expression) => `const fs=require("node:fs");const n=JSON.parse(fs.readFileSync("fixture.ipynb","utf8"));${expression};fs.writeFileSync("fixture.ipynb",JSON.stringify(n,null,2)+"\\n");console.log("NOTEBOOK_OK");`;
  const first = await f.turn(c.host, c.threadId, commandPrompt(mutate(dimension === "normal"
    ? 'n.cells.find(c=>c.id==="intro").source=["UPDATED\\n"]'
    : 'n.cells.push({id:"inserted",cell_type:"markdown",metadata:{},source:["INSERTED\\n"]})')));
  if (dimension === "normal") return { first: first.id };
  expected.cells[2].source = ["EDITED\n"];
  f.expectFile("fixture.ipynb", `${JSON.stringify(expected, null, 2)}\n`);
  const second = await f.turn(c.host, c.threadId, commandPrompt(mutate('n.cells.find(c=>c.id==="inserted").source=["EDITED\\n"]')));
  return { first: first.id, second: second.id };
}, (e, data) => {
  if (dimension === "failure") {
    assertPhaseAnswer(e, data.first, "INVALID_NOTEBOOK", { failure: true, contains: /SyntaxError|JSON/i });
    assert.deepEqual(e.state.before, e.state.after);
  } else {
    assertPhaseAnswer(e, data.first, "NOTEBOOK_OK");
    const expected = notebook();
    if (dimension === "normal") expected.cells[0].source = ["UPDATED\n"];
    else {
      assertPhaseAnswer(e, data.second, "NOTEBOOK_OK");
      assert.equal(phaseById(e, data.first).threadId, phaseById(e, data.second).threadId);
      expected.cells.push({ id: "inserted", cell_type: "markdown", metadata: {}, source: ["EDITED\n"] });
    }
    assert.deepEqual(JSON.parse(fileText(e.state.after, "fixture.ipynb")), expected);
    assert.deepEqual(JSON.parse(fileText(e.state.after, "fixture.ipynb")).cells[1], notebook().cells[1]);
  }
});

export const FILE_DRIVERS = Object.freeze(Object.fromEntries(["normal", "failure", "lifecycle"].flatMap((dimension) => [
  [`file-read.${dimension}`, read(dimension)], [`file-search.${dimension}`, search(dimension)],
  [`file-edit.${dimension}`, edit(dimension)], [`notebooks.${dimension}`, notebooks(dimension)],
])));
