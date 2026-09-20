#!/usr/bin/env node
import { updateDocumentation } from "./compatibility/documentation.mjs";
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--check")) throw new Error("Use --check or no arguments");
updateDocumentation({ check: args[0] === "--check" });
console.log(args[0] ? "Core-10 documents match the contract." : "Updated core-10 scenario documents.");
