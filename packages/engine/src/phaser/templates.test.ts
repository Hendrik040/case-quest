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

  it("boardroom has a central table, seats, and a trigger zone", () => {
    const t = getTemplate("boardroom");
    expect(t.poiSlots.length).toBeGreaterThanOrEqual(3);
    expect(t.triggerZone.length).toBeGreaterThan(0);
    // table tiles are impassable, same as desks/walls
    let sawTable = false;
    for (const row of t.tiles) {
      for (const tile of row) {
        if (tile === TILE.TABLE) sawTable = true;
      }
    }
    expect(sawTable).toBe(true);
    // trigger zone tiles must be walkable floor, not table/wall
    for (const p of t.triggerZone) {
      const tile = t.tiles[p.y][p.x];
      expect(tile).not.toBe(TILE.TABLE);
      expect(tile).not.toBe(TILE.WALL);
    }
    // spawn is walkable
    expect(t.tiles[t.playerSpawn.y][t.playerSpawn.x]).not.toBe(TILE.TABLE);
    expect(t.tiles[t.playerSpawn.y][t.playerSpawn.x]).not.toBe(TILE.WALL);
  });

  it("street has an open path and building facades", () => {
    const t = getTemplate("street");
    expect(t.tiles.length).toBeGreaterThan(0);
    expect(t.poiSlots.length).toBeGreaterThan(0);
    expect(t.doorSlots.length).toBeGreaterThan(0);
    expect(t.tiles[t.playerSpawn.y][t.playerSpawn.x]).not.toBe(TILE.WALL);
  });

  it("shopfront has market stalls as poiSlots", () => {
    const t = getTemplate("shopfront");
    expect(t.poiSlots.length).toBeGreaterThan(0);
    expect(t.tiles[t.playerSpawn.y][t.playerSpawn.x]).not.toBe(TILE.WALL);
  });

  it("warehouse returns a sensible walkable room", () => {
    const t = getTemplate("warehouse");
    expect(t.tiles.length).toBeGreaterThan(0);
    expect(t.poiSlots.length).toBeGreaterThan(0);
    expect(t.doorSlots.length).toBeGreaterThan(0);
    expect(t.tiles[t.playerSpawn.y][t.playerSpawn.x]).not.toBe(TILE.WALL);
  });

  it("existing templates default to an empty triggerZone", () => {
    expect(getTemplate("office").triggerZone).toEqual([]);
    expect(getTemplate("factory_floor").triggerZone).toEqual([]);
  });
});
