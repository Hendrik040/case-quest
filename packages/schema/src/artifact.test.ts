import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { WorldSchema } from "./schema";

describe("world.schema.json artifact", () => {
  it("matches the current Zod WorldSchema (run `pnpm artifact` if this fails)", () => {
    const artifact = JSON.parse(
      readFileSync(join(__dirname, "../artifacts/world.schema.json"), "utf8")
    );
    const fresh = zodToJsonSchema(WorldSchema, { name: "World", $refStrategy: "none" });
    expect(artifact).toEqual(JSON.parse(JSON.stringify(fresh)));
  });
});
