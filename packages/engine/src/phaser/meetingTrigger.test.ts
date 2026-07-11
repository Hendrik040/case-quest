import { describe, it, expect } from "vitest";
import { getTemplate, TILE } from "./templates";
import {
  isTriggerZoneTile,
  enteredTriggerZone,
  isFacingTable,
  meetingStartPayload,
  assignNpcTiles,
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
});
