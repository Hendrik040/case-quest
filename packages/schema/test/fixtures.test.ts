import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import toy from "../fixtures/wholesale-offer.world.json";
import realistic from "../fixtures/realistic-case.world.json";

describe("example worlds validate clean", () => {
  it("the toy world has zero errors and zero warnings", () => {
    const r = validateWorld(toy);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("the realistic world has zero errors and zero warnings", () => {
    const r = validateWorld(realistic);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
