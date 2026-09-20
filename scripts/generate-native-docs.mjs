#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateReadinessDocumentation } from "./native/documentation.mjs";

export function main(args = process.argv.slice(2)) {
  if (args.length && (args.length !== 1 || args[0] !== "--check")) throw new Error("Usage: node scripts/generate-native-docs.mjs [--check]");
  updateReadinessDocumentation({ check: args[0] === "--check" });
  console.log(args[0] === "--check" ? "Native scenario tables match the current catalog and registry." : "Updated native scenario readiness tables.");
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
