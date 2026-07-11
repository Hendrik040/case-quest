import { describe, it, expect } from "vitest";
import { getTemplate } from "./templates";
import {
  isTriggerZoneTile,
  enteredTriggerZone,
  isFacingTable,
  meetingStartPayload,
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
});
