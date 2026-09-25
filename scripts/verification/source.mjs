import fs from "node:fs";
import path from "node:path";
import { ROOT, safeRead, sha } from "./util.mjs";

export function sourceManifest(root = ROOT) {
  const files = [];
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const file = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Source symlinks are not supported: ${file}`);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && (/\.(mjs|html|py)$/.test(entry.name) || relative === "bin")) files.push(file);
    }
  };
  for (const directory of ["src", "scripts", "test", "bin"]) walk(directory);
  files.push("package.json", "package-lock.json");
  return Object.fromEntries(files.sort().map(file => {
    const bytes = safeRead(path.join(root, file));
    return [file, { sha256: sha(bytes), bytes: bytes.length }];
  }));
}

export const implementationHash = () => sha(JSON.stringify(sourceManifest()));

export function snapshotSources(directory) {
  const manifest = sourceManifest();
  for (const file of Object.keys(manifest)) {
    const target = path.join(directory, "source-snapshot", file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), target, fs.constants.COPYFILE_EXCL);
  }
  return manifest;
}

export function verifyFrozenSources(directory, manifest) {
  const expected = sourceManifest();
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) return false;
  return Object.entries(manifest).every(([file, metadata]) => {
    const target = path.join(directory, "source-snapshot", file);
    for (let parent = path.dirname(target); parent !== directory; parent = path.dirname(parent)) {
      if (fs.lstatSync(parent).isSymbolicLink()) throw new Error("Symlink in frozen source path");
    }
    const bytes = safeRead(target);
    return bytes.length === metadata.bytes && sha(bytes) === metadata.sha256;
  });
}
