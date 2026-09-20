import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function redactor(env = process.env, extra = []) {
  const secrets = [...extra, ...Object.entries(env).filter(([name]) => /TOKEN|SECRET|PASSWORD|AUTHORIZATION|API_KEY/i.test(name)).map(([, value]) => value)]
    .filter((value) => typeof value === "string" && value.length >= 8).sort((a, b) => b.length - a.length);
  return (value) => {
    let text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
    return text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b/g, "[REDACTED]");
  };
}

export function freshDirectory(directory) {
  const absolute = path.resolve(directory);
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  fs.mkdirSync(absolute, { mode: 0o700 }); // EEXIST is deliberate: no overwrite/resume.
  return fs.realpathSync(absolute);
}

export function writeJson(file, value, scrub = redactor()) {
  const temporary = `${file}.${randomUUID()}.writing`;
  try {
    fs.writeFileSync(temporary, `${scrub(value)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function artifact(directory, name, value, scrub) {
  assert.equal(path.basename(name), name, "Artifacts must be plain filenames.");
  const bytes = `${scrub(value)}\n`;
  fs.writeFileSync(path.join(directory, name), bytes, { mode: 0o600, flag: "wx" });
  return { path: name, sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) };
}

export function fileState(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return { kind: "symlink", target: fs.readlinkSync(file) };
    if (stat.isDirectory()) return { kind: "directory", mode: stat.mode & 0o777 };
    if (!stat.isFile()) return { kind: "other" };
    return { kind: "file", sha256: sha256(fs.readFileSync(file)), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === "ENOENT") return { kind: "missing" };
    throw error;
  }
}

export function treeState(directory) {
  const files = {};
  const visit = (root) => {
    for (const name of fs.readdirSync(root).sort()) {
      const file = path.join(root, name);
      const stat = fs.lstatSync(file);
      files[path.relative(directory, file).split(path.sep).join("/")] = fileState(file);
      if (stat.isDirectory()) visit(file);
    }
  };
  visit(directory);
  return files;
}

export function sourceManifest(root = ROOT) {
  const sources = ["package.json", "package-lock.json"];
  const visit = (relative) => {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      if (name === ".DS_Store") continue;
      const file = path.join(relative, name);
      const stat = fs.lstatSync(path.join(root, file));
      assert.ok(!stat.isSymbolicLink(), `Implementation input must not be a symlink: ${file}`);
      if (stat.isDirectory()) visit(file);
      else { assert.ok(stat.isFile(), `Unexpected implementation input: ${file}`); sources.push(file); }
    }
  };
  for (const directory of ["src", "scripts", "test", "bin"]) visit(directory);
  return sources.sort().map((file) => ({ path: file.split(path.sep).join("/"),
    sha256: sha256(fs.readFileSync(path.join(root, file))),
    executable: Boolean(fs.statSync(path.join(root, file)).mode & 0o111) }));
}

export function implementationHash(root = ROOT) { return sha256(JSON.stringify(sourceManifest(root))); }

export function verifyArtifact(root, item) {
  assert.ok(item && typeof item.path === "string" && /^[a-f0-9]{64}$/.test(item.sha256) &&
    Number.isSafeInteger(item.bytes) && item.bytes >= 0, "Invalid artifact record.");
  const segments = item.path.split("/");
  assert.ok(!path.isAbsolute(item.path) && segments.every((segment) => segment && segment !== "." && segment !== ".." && !segment.includes("\\")), "Artifact path escapes the result directory.");
  let target = fs.realpathSync(root);
  for (const segment of segments) {
    target = path.join(target, segment);
    assert.ok(!fs.lstatSync(target).isSymbolicLink(), "Evidence must not follow symlinks.");
  }
  assert.ok(fs.lstatSync(target).isFile(), "Evidence must be a regular file.");
  const bytes = fs.readFileSync(target);
  assert.equal(bytes.length, item.bytes, `Evidence length differs: ${item.path}`);
  assert.equal(sha256(bytes), item.sha256, `Evidence hash differs: ${item.path}`);
  return bytes;
}
