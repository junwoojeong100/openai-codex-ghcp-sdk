#!/usr/bin/env node
import { validateDesign } from "./compatibility/design.mjs";
if (process.argv.length > 2) throw new Error("Usage: node scripts/check-scenario-design.mjs");
console.log(JSON.stringify(validateDesign(), null, 2));
