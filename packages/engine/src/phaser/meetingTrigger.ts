import type { Point, RoomTemplate } from "./templates";
import { TILE } from "./templates";

// Pure helpers for the walk-up meeting trigger (Task 1.6), extracted out of
// WorldScene so the "did we just enter the zone" / "are we facing the table"
// logic is unit-testable without a Phaser scene.

export function isTriggerZoneTile(tpl: RoomTemplate, tx: number, ty: number): boolean {
  return tpl.triggerZone.some((p) => p.x === tx && p.y === ty);
}

// True only on the step that *enters* the zone (wasInZone false, isInZone
// true) — walking between two trigger tiles, or standing still inside it,
// must not re-fire. Leaving and re-entering fires again, by design.
export function enteredTriggerZone(wasInZone: boolean, isInZone: boolean): boolean {
  return isInZone && !wasInZone;
}

export function isFacingTable(tpl: RoomTemplate, facingTx: number, facingTy: number): boolean {
  if (facingTx < 0 || facingTy < 0 || facingTx >= tpl.width || facingTy >= tpl.height) return false;
  return tpl.tiles[facingTy][facingTx] === TILE.TABLE;
}

/** Assembles the `encounter:meeting:start` payload from the venue's seated actors. */
export function meetingStartPayload(seatedActorIds: string[]): { actorIds: string[] } {
  return { actorIds: [...seatedActorIds] };
}

// Deterministic NPC tile assignment (review fix, Task 1.6): the old
// `poiSlots[i % poiSlots.length]` wrap stacked two actors on one tile as soon
// as a location had more NPCs than the template had slots. For
// i < poiSlots.length the assignment is byte-identical to the old behavior
// (slot i, no wrap possible); overflow actors instead take the first free
// walkable tiles in a row-major scan of the grid — skipping blocked tiles
// (WALL/DESK/TABLE, plus DOOR so nobody stands "in" a doorway), every poiSlot
// (used or not, so a fact orb placed on a later slot isn't shadowed),
// doorSlots, the player spawn, the triggerZone, and tiles already assigned.
// Purely a function of (template, count): deterministic, no stacking, no
// dropped actors. (A room with fewer free tiles than actors would fall back
// to wrapping rather than dropping anyone, but every template is 15x11 with
// a large open floor, so that path is pathological-only.)
export function assignNpcTiles(tpl: RoomTemplate, count: number): Point[] {
  const tiles: Point[] = tpl.poiSlots.slice(0, count).map((p) => ({ ...p }));
  if (tiles.length >= count) return tiles;

  const key = (x: number, y: number) => `${x},${y}`;
  const occupied = new Set<string>();
  for (const p of tpl.poiSlots) occupied.add(key(p.x, p.y));
  for (const p of tpl.doorSlots) occupied.add(key(p.x, p.y));
  for (const p of tpl.triggerZone) occupied.add(key(p.x, p.y));
  occupied.add(key(tpl.playerSpawn.x, tpl.playerSpawn.y));

  for (let y = 0; y < tpl.height && tiles.length < count; y++) {
    for (let x = 0; x < tpl.width && tiles.length < count; x++) {
      const t = tpl.tiles[y][x];
      if (t === TILE.WALL || t === TILE.DESK || t === TILE.TABLE || t === TILE.DOOR) continue;
      if (occupied.has(key(x, y))) continue;
      occupied.add(key(x, y));
      tiles.push({ x, y });
    }
  }
  while (tiles.length < count) tiles.push({ ...tpl.poiSlots[tiles.length % tpl.poiSlots.length] });
  return tiles;
}
