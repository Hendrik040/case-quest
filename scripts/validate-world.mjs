#!/usr/bin/env node
// Validates a world.json file against @case-quest/schema's WorldSchema + validateWorld.
//
// Usage:
//   node scripts/validate-world.mjs <path-to-world.json> [...more paths]
//
// Prints every schema/graph/solvability error and warning with its Issue code,
// then exits non-zero if any world had errors. Requires `pnpm -C packages/schema
// build` to have run first (imports from packages/schema/dist, not src).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WorldSchema, validateWorld } from "../packages/schema/dist/index.js";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: node scripts/validate-world.mjs <path-to-world.json> [...]");
  process.exit(2);
}

function parseWorld(path) {
  const raw = readFileSync(path, "utf-8");
  const json = JSON.parse(raw);
  return WorldSchema.safeParse(json);
}

let anyErrors = false;

for (const path of paths) {
  const absPath = resolve(path);
  console.log(`\n=== ${path} ===`);

  const parsed = parseWorld(absPath);
  if (!parsed.success) {
    anyErrors = true;
    console.log(`shape_invalid: world does not match WorldSchema (${parsed.error.issues.length} issue(s)):`);
    for (const issue of parsed.error.issues) {
      console.log(`  [shape_invalid] ${issue.path.join(".")}: ${issue.message}`);
    }
    continue;
  }

  const raw = readFileSync(absPath, "utf-8");
  const result = validateWorld(JSON.parse(raw));

  if (result.errors.length === 0) {
    console.log(`OK — 0 errors, ${result.warnings.length} warning(s).`);
  } else {
    anyErrors = true;
    console.log(`FAILED — ${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
  }

  for (const issue of result.errors) {
    console.log(`  ERROR [${issue.code}]${issue.path ? ` (${issue.path})` : ""}: ${issue.message}`);
  }
  for (const issue of result.warnings) {
    console.log(`  WARN  [${issue.code}]${issue.path ? ` (${issue.path})` : ""}: ${issue.message}`);
  }
}

process.exit(anyErrors ? 1 : 0);
