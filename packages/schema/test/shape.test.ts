import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import { toyWorld, clone } from "./helpers";

describe("validateWorld — Layer 1 (shape)", () => {
  it("passes the toy world through Layer 1 (no shape errors)", () => {
    const r = validateWorld(toyWorld());
    expect(r.errors.filter((e) => e.code === "shape_invalid")).toHaveLength(0);
  });

  it("rejects a non-object with a shape error", () => {
    const r = validateWorld(42);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "shape_invalid")).toBe(true);
  });

  it("maps an unknown location type to unknown_location_type with valid types listed", () => {
    const w = clone(toyWorld()) as any;
    w.locations[0].type = "spaceship";
    const r = validateWorld(w);
    expect(r.ok).toBe(false);
    const iss = r.errors.find((e) => e.code === "unknown_location_type");
    expect(iss).toBeDefined();
    expect(iss!.message).toContain("factory_floor");
  });
});
