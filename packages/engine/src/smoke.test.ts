import { describe, it, expect } from "vitest";
import { validateWorld } from "@case-quest/schema";
import toy from "../public/worlds/wholesale-offer.world.json";

describe("engine can consume the schema package", () => {
  it("the bundled toy world validates clean", () => {
    const r = validateWorld(toy);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
