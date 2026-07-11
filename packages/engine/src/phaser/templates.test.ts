import { describe, it, expect } from "vitest";
import type { LocationType } from "@case-quest/schema";
import { getTemplate, TILE } from "./templates";
import { VENUE_LOCATION_TYPES } from "../state/placement";

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

  // B2 fix (M5 Task 5.2 review): every venue-capable location type (placement.ts's
  // VENUE_LOCATION_TYPES — boardroom, street, shopfront, client_site) must have a
  // non-empty, walkable, non-colliding triggerZone, or the walk-up multi-party meeting can
  // never open there at all. `client_site` has no dedicated TEMPLATES entry — it falls
  // through `getTemplate`'s DEFAULT_TEMPLATE fallback unless one is added; this list is
  // exactly what closes that gap. `warehouse` is included too even though it isn't
  // currently venue-capable per placement.ts: the Task 5.2 e2e report's finding #2 named it
  // alongside shopfront as a template with no trigger geometry at all, and giving it real
  // geometry defensively (in case a future world's designers add it to
  // VENUE_LOCATION_TYPES, or a location typed "warehouse" is otherwise treated as a venue)
  // costs nothing: WorldScene.fireMeetingStart no-ops whenever there are zero seated
  // actors, so a walkable trigger zone on a template that's never actually a venue today is
  // inert, not a live hazard.
  describe("every venue-capable template (+ warehouse, defensively) has real trigger geometry", () => {
    const typesToCheck = [...VENUE_LOCATION_TYPES, "warehouse"] as LocationType[];

    for (const type of typesToCheck) {
      it(`${type}: non-empty triggerZone, walkable, and non-colliding with poiSlots/doorSlots/spawn`, () => {
        const t = getTemplate(type);
        expect(t.triggerZone.length).toBeGreaterThan(0);

        const blocked = new Set([TILE.WALL, TILE.DESK, TILE.TABLE, TILE.DOOR] as number[]);
        for (const p of t.triggerZone) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThan(t.width);
          expect(p.y).toBeLessThan(t.height);
          expect(blocked.has(t.tiles[p.y][p.x])).toBe(false);
        }

        const avoid = new Set(
          [t.playerSpawn, ...t.poiSlots, ...t.doorSlots].map((p) => `${p.x},${p.y}`),
        );
        for (const p of t.triggerZone) expect(avoid.has(`${p.x},${p.y}`)).toBe(false);
      });
    }

    it("client_site no longer falls back to the generic DEFAULT_TEMPLATE (which has no triggerZone)", () => {
      const clientSite = getTemplate("client_site");
      const fallback = getTemplate("home"); // home has no dedicated entry either — the real fallback shape
      expect(clientSite.triggerZone.length).toBeGreaterThan(0);
      expect(fallback.triggerZone).toEqual([]);
    });
  });
});
