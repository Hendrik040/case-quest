import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { WorldSchema } from "../src/schema";

const __dirname = join(fileURLToPath(import.meta.url), "..");
const out = zodToJsonSchema(WorldSchema, { name: "World", $refStrategy: "none" });
const dir = join(__dirname, "../artifacts");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "world.schema.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote artifacts/world.schema.json");
