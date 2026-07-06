import { describe, it, expect } from "vitest";
import { getTemplate, TILE } from "./templates";

describe("getTemplate", () => {
  it("returns a bordered room for a known type", () => {
    const t = getTemplate("office");
    expect(t.height).toBe(t.tiles.length);
    expect(t.width).toBe(t.tiles[0].length);
    expect(t.tiles[0][0]).toBe(TILE.WALL);
    expect(t.tiles[1][1]).toBe(TILE.FLOOR);
    expect(t.poiSlots.length).toBeGreaterThan(0);
    expect(t.doorSlots.length).toBeGreaterThan(0);
  });
  it("returns a template for factory_floor too", () => {
    expect(getTemplate("factory_floor").tiles.length).toBeGreaterThan(0);
  });
  it("falls back to a default room for an unmapped type", () => {
    // @ts-expect-error intentionally unmapped
    const t = getTemplate("warehouse_unknown");
    expect(t.tiles.length).toBeGreaterThan(0);
  });
});
