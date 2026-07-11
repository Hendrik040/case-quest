import { describe, it, expect } from "vitest";
import { getTemplate, TILE, type RoomTemplate } from "./templates";
import {
  isTriggerZoneTile,
  enteredTriggerZone,
  isFacingTable,
  meetingStartPayload,
  assignNpcTiles,
  assignFactTiles,
} from "./meetingTrigger";

describe("meetingTrigger helpers", () => {
  const boardroom = getTemplate("boardroom");

  it("isTriggerZoneTile matches only the template's triggerZone tiles", () => {
    const [zoneTile] = boardroom.triggerZone;
    expect(isTriggerZoneTile(boardroom, zoneTile.x, zoneTile.y)).toBe(true);
    expect(isTriggerZoneTile(boardroom, 0, 0)).toBe(false);
  });

  it("a template with no triggerZone never reports a hit", () => {
    const office = getTemplate("office");
    expect(office.triggerZone).toEqual([]);
    expect(isTriggerZoneTile(office, office.playerSpawn.x, office.playerSpawn.y)).toBe(false);
  });

  it("enteredTriggerZone fires only on the false->true edge", () => {
    expect(enteredTriggerZone(false, true)).toBe(true);
    expect(enteredTriggerZone(true, true)).toBe(false); // walking within the zone: no re-fire
    expect(enteredTriggerZone(true, false)).toBe(false); // leaving
    expect(enteredTriggerZone(false, false)).toBe(false);
  });

  it("leave-and-reenter is allowed to fire again (two separate edges)", () => {
    const events: boolean[] = [];
    const path = [false, true, false, true]; // enter, leave, enter again
    let prev = false;
    for (const cur of path) {
      events.push(enteredTriggerZone(prev, cur));
      prev = cur;
    }
    expect(events).toEqual([false, true, false, true]);
  });

  it("isFacingTable is true only when the facing tile is a TABLE tile", () => {
    const tableRow = 5; // makeBoardroom's tableRow
    expect(isFacingTable(boardroom, 6, tableRow)).toBe(true);
    expect(isFacingTable(boardroom, 7, boardroom.playerSpawn.y)).toBe(false);
  });

  it("isFacingTable is false out of bounds (no throw)", () => {
    expect(isFacingTable(boardroom, -1, -1)).toBe(false);
    expect(isFacingTable(boardroom, boardroom.width, boardroom.height)).toBe(false);
  });

  it("meetingStartPayload wraps seated actor ids and defensively copies", () => {
    const seated = ["a1", "a2"];
    const payload = meetingStartPayload(seated);
    expect(payload).toEqual({ actorIds: ["a1", "a2"] });
    payload.actorIds.push("a3");
    expect(seated).toEqual(["a1", "a2"]); // not mutated by the caller's own push
  });

  describe("assignNpcTiles", () => {
    it("is identical to direct poiSlot indexing when count fits the slots", () => {
      const tiles = assignNpcTiles(boardroom, 3);
      expect(tiles).toEqual(boardroom.poiSlots.slice(0, 3));
    });

    it("overflow: 8 actors on the 6-slot boardroom get 8 distinct, unblocked tiles", () => {
      const tiles = assignNpcTiles(boardroom, 8);
      expect(tiles).toHaveLength(8); // nobody dropped
      const keys = new Set(tiles.map((p) => `${p.x},${p.y}`));
      expect(keys.size).toBe(8); // no stacking
      for (const p of tiles) {
        const t = boardroom.tiles[p.y][p.x];
        expect(t).not.toBe(TILE.WALL);
        expect(t).not.toBe(TILE.DESK);
        expect(t).not.toBe(TILE.TABLE);
        expect(t).not.toBe(TILE.DOOR);
      }
      // first 6 are exactly the template's slots, preserving existing behavior
      expect(tiles.slice(0, 6)).toEqual(boardroom.poiSlots);
    });

    it("overflow tiles avoid the player spawn, doorSlots, and triggerZone", () => {
      const tiles = assignNpcTiles(boardroom, 12).slice(6); // just the overflow
      const avoid = new Set(
        [boardroom.playerSpawn, ...boardroom.doorSlots, ...boardroom.triggerZone].map(
          (p) => `${p.x},${p.y}`,
        ),
      );
      for (const p of tiles) expect(avoid.has(`${p.x},${p.y}`)).toBe(false);
    });

    it("is deterministic", () => {
      expect(assignNpcTiles(boardroom, 9)).toEqual(assignNpcTiles(boardroom, 9));
    });
  });

  // B3 fix (M5 Task 5.2 review): fact-orb placement used to be
  // `tpl.poiSlots[(npcCount + i) % poiSlots.length]` — no overflow-safe scan (unlike
  // assignNpcTiles), so a fact orb could land exactly on an already-seated NPC's tile (or
  // stack on another fact orb) whenever npcCount+factCount exceeded poiSlots.length.
  // Confirmed live against the real world file: Kawangware Market (shopfront, 3 poiSlots, 2
  // seated actors, 5 facts) put 3 of 5 orbs on an NPC's tile; the warehouse floor
  // (client_site's old DEFAULT_TEMPLATE fallback, 1 poiSlot, 1 actor, 2 facts) put 100% of
  // orbs AND the actor on the same single tile — a latent soft-lock for any
  // future pure-location fact placed into an overflow slot.
  describe("assignFactTiles", () => {
    it("is byte-identical to the historical (npcCount + i) % poiSlots.length formula when nothing collides", () => {
      // boardroom has 6 poiSlots; 2 NPCs + 2 facts = 4, well within capacity, no wrap.
      const tiles = assignFactTiles(boardroom, 2, 2);
      expect(tiles).toEqual(boardroom.poiSlots.slice(2, 4));
      // Which is exactly the historical formula for i = 0, 1 (no modulo wrap needed).
      expect(tiles).toEqual([0, 1].map((i) => boardroom.poiSlots[(2 + i) % boardroom.poiSlots.length]));
    });

    it("factCount 0 returns an empty array", () => {
      expect(assignFactTiles(boardroom, 3, 0)).toEqual([]);
    });

    it("npcCount 0 places facts directly on the first poiSlots (identical to the old formula's zero-NPC case)", () => {
      expect(assignFactTiles(boardroom, 0, 3)).toEqual(boardroom.poiSlots.slice(0, 3));
    });

    it("overflow: never collides with the actual NPC tiles (the Kawangware Market bug, reproduced against the real shopfront template)", () => {
      const shopfront = getTemplate("shopfront"); // 3 poiSlots
      const npcCount = 2, factCount = 5; // matches case3-m5.world.json exactly
      const npcTiles = assignNpcTiles(shopfront, npcCount);
      const npcKeys = new Set(npcTiles.map((p) => `${p.x},${p.y}`));

      const factTiles = assignFactTiles(shopfront, npcCount, factCount);
      expect(factTiles).toHaveLength(5); // nobody dropped

      const factKeys = new Set(factTiles.map((p) => `${p.x},${p.y}`));
      expect(factKeys.size).toBe(5); // no two facts stack on the same tile
      for (const key of factKeys) expect(npcKeys.has(key)).toBe(false); // no fact on an NPC tile

      for (const p of factTiles) {
        const t = shopfront.tiles[p.y][p.x];
        expect(t).not.toBe(TILE.WALL);
        expect(t).not.toBe(TILE.DESK);
        expect(t).not.toBe(TILE.TABLE);
        expect(t).not.toBe(TILE.DOOR);
      }
    });

    it("total-overflow (1 poiSlot, 1 actor, 2 facts): the old 100%-overlap bug is gone", () => {
      // The exact shape of the warehouse-floor bug reported live against case3-m5.world.json
      // (a 1-poiSlot template — the shape client_site's old DEFAULT_TEMPLATE fallback had —
      // with 1 seated actor and 2 location-only facts): every fact orb AND the actor used to
      // land on the same single tile ({7,4}) under the old `(npcCount+i) % poiSlots.length`
      // formula. Built explicitly here (rather than relying on a real template's incidental
      // shape) to pin the exact pathological case regardless of future template edits.
      const width = 15, height = 11;
      const tiles: number[][] = [];
      for (let y = 0; y < height; y++) {
        const row: number[] = [];
        for (let x = 0; x < width; x++) {
          row.push(x === 0 || y === 0 || x === width - 1 || y === height - 1 ? TILE.WALL : TILE.FLOOR);
        }
        tiles.push(row);
      }
      const singleSlotTpl: RoomTemplate = {
        width, height, tiles,
        playerSpawn: { x: 7, y: 8 },
        poiSlots: [{ x: 7, y: 4 }],
        doorSlots: [{ x: 7, y: 0 }, { x: 0, y: 5 }],
        triggerZone: [],
      };

      const npcTiles = assignNpcTiles(singleSlotTpl, 1);
      const factTiles = assignFactTiles(singleSlotTpl, 1, 2);
      expect(factTiles).toHaveLength(2);

      const allKeys = [...npcTiles, ...factTiles].map((p) => `${p.x},${p.y}`);
      expect(new Set(allKeys).size).toBe(3); // 1 NPC tile + 2 distinct fact tiles, zero overlap
    });

    it("overflow tiles avoid doorSlots, playerSpawn, and the triggerZone", () => {
      const boardroomOverflow = assignFactTiles(boardroom, 6, 6); // all 6 poiSlots taken by NPCs
      const avoid = new Set(
        [boardroom.playerSpawn, ...boardroom.doorSlots, ...boardroom.triggerZone].map(
          (p) => `${p.x},${p.y}`,
        ),
      );
      for (const p of boardroomOverflow) expect(avoid.has(`${p.x},${p.y}`)).toBe(false);
    });

    it("is deterministic", () => {
      expect(assignFactTiles(boardroom, 3, 5)).toEqual(assignFactTiles(boardroom, 3, 5));
    });
  });
});
