import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROOT } from "../scripts/verification/util.mjs";
import { CATALOG, SCENARIOS } from "../scripts/verification/catalog.mjs";
import { parseArguments } from "../scripts/verify.mjs";

const guides = ["README.md", "README_KO.md",
  ...fs.readdirSync(path.join(ROOT, "docs")).filter(file => file.endsWith(".md")).map(file => `docs/${file}`),
  "docs/validation/README.md", "docs/validation/README_KO.md"];
const documents = new Map(guides.map(file => [file, fs.readFileSync(path.join(ROOT, file), "utf8")]));
const parsers = { verify: parseArguments };

function markdownParts(text) {
  const blocks = [];
  const prose = text.replace(/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm, (_match, _fence, language, body) => {
    blocks.push({ language: language.trim(), body });
    return "";
  });
  return { prose, blocks };
}

function anchors(text) {
  const { prose } = markdownParts(text), ids = new Set(), headings = new Set();
  for (const [, heading] of prose.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    const base = heading.toLowerCase().replace(/<[^>]*>/g, "")
      .replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, "").replace(/\s/g, "-");
    let id = base, suffix = 0;
    while (headings.has(id)) id = `${base}-${++suffix}`;
    headings.add(id); ids.add(id);
  }
  for (const [, id] of prose.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) ids.add(id);
  return ids;
}

function checkLinks(file, text) {
  const prose = markdownParts(text).prose.replace(/`[^`\n]+`/g, "");
  for (const [, link] of prose.matchAll(/\]\(([^\s)]+)\)/g)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(link)) continue;
    const [target, fragment] = link.split("#");
    const resolved = target ? path.resolve(ROOT, path.dirname(file), decodeURIComponent(target)) : path.join(ROOT, file);
    const relative = path.relative(ROOT, resolved);
    assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`), `${file}: link leaves the repository: ${link}`);
    assert.ok(fs.existsSync(resolved), `${file}: missing link target: ${link}`);
    if (fragment && resolved.endsWith(".md")) {
      assert.ok(anchors(fs.readFileSync(resolved, "utf8")).has(decodeURIComponent(fragment)), `${file}: missing section: ${link}`);
    }
  }
}

function npmExamples(text) {
  return [...text.replace(/\\\r?\n[ \t]*/g, " ").matchAll(/\bnpm run ([\w:-]+)(?:[ \t]+--[ \t]+([^`\r\n]+))?/g)]
    .map(([, script, args]) => ({ script, args: args?.trim().split(/\s+/) ?? [] }));
}

test("documentation link checks include translated headings and explicit IDs, not fenced examples", () => {
  const text = "# Setup (advanced)\n# Setup (advanced)\n# `CODEX_BIN`\n# 모델 선택\n<a id=\"c01\"></a>\n```sh\n# not a heading\n[example](missing.md)\n```\n";
  assert.deepEqual([...anchors(text)], ["setup-advanced", "setup-advanced-1", "codex_bin", "모델-선택", "c01"]);
  assert.doesNotThrow(() => checkLinks("README.md", "```text\n[example](missing.md)\n```\n`[example](missing.md)`"));
  assert.throws(() => checkLinks("README.md", "[broken](missing-guide.md)"), /missing link target/);
  assert.throws(() => checkLinks("README.md", "[broken](#missing-section)"), /missing section/);
  assert.doesNotThrow(() => checkLinks("README.md", "[setup](README_KO.md#%EB%B9%A0%EB%A5%B8-%EC%8B%9C%EC%9E%91)"));
});

test("current guides and verification indexes have valid local files and section links", () => {
  for (const [file, text] of documents) checkLinks(file, text);
});

test("documented npm scripts exist and literal runner arguments pass their real parsers", () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const checked = new Set();
  for (const [file, text] of documents) {
    for (const { script, args } of npmExamples(text)) {
      assert.ok(Object.hasOwn(scripts, script), `${file}: unknown npm script ${script}`);
      if (!Object.hasOwn(parsers, script)) continue;
      assert.doesNotThrow(() => parsers[script](args), `${file}: npm run ${script} -- ${args.join(" ")}`);
      checked.add(script);
    }
  }
  assert.deepEqual([...checked].sort(), Object.keys(parsers).sort());
});

test("English and Korean guides document the same npm commands and runner options", () => {
  for (const [file, text] of documents) {
    if (file.endsWith("_KO.md")) continue;
    const translated = file.replace(/\.md$/, "_KO.md");
    assert.ok(documents.has(translated), `${file}: missing Korean guide`);
    assert.deepEqual(npmExamples(documents.get(translated)), npmExamples(text), `${file}: translated commands differ`);
  }
});

test("Bash and sh examples parse without executing setup, servers or live checks", () => {
  for (const [file, text] of documents) {
    for (const { language, body } of markdownParts(text).blocks) {
      if (!["bash", "sh"].includes(language)) continue;
      const result = spawnSync("bash", ["--noprofile", "--norc", "-n"], {
        input: body, encoding: "utf8", timeout: 5000, env: { ...process.env, BASH_ENV: "/dev/null" },
      });
      assert.equal(result.status, 0, `${file}: ${result.stderr || result.error?.message}`);
    }
  }
});

test("one bilingual guide describes every essential scenario and one full-pass rule", () => {
  for (const language of ["", "_KO"]) {
    const document = documents.get(`docs/VERIFICATION${language}.md`);
    assert.ok(document.includes(CATALOG.id));
    assert.ok(document.includes(`${CATALOG.totalCases}/${CATALOG.totalCases}`));
    for (const scenario of SCENARIOS) assert.ok(document.includes(`| ${scenario.id} |`));
    assert.ok(document.includes("verification.json"));
  }
  const { scripts } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(scripts.verify, "node scripts/verify.mjs");
  for (const retired of ["test:compatibility", "test:stability", "test:soak", "test:terminal", "test:tui", "diagnose:opus", "docs:scenarios"]) {
    assert.ok(!Object.hasOwn(scripts, retired), retired);
  }
});
