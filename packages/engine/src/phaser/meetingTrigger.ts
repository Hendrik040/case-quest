import type { Point, RoomTemplate } from "./templates";
import { TILE } from "./templates";
import type { SessionMode } from "../state/session";

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

// Final review (C1): one-frame race between fireMeetingStart (fired from a tween
// onComplete, which Phaser's Systems.step runs BEFORE scene.update() in the very same
// frame — see node_modules/phaser/src/scene/Systems.js) and the world:freeze bus event
// that would otherwise block further input (React's effect flush lands strictly after
// this frame). A Space press/release latched mid-tween (interactQueued) survives into
// this same frame's update() and can re-fire interact() right after the meeting opens,
// hitting the now-seated actor's tile (or the isFacingTable branch) and throwing through
// GameSession's roaming-only guards (startEncounterWith/startMeeting). Belt-and-suspenders
// fix: WorldScene.fireMeetingStart() clears interactQueued (and resets the key) directly,
// AND interact() no-ops outright whenever a meeting is already active — this predicate is
// the second half, kept here as a pure/testable seam since WorldScene itself has no
// dedicated unit tests (Phaser can't run under jsdom/vitest).
//
// Deliberately meeting-only, not "not roaming": `session.mode()` reports "traversing"
// (not "roaming") whenever a walking traversal is pending, but the player is still plain
// roaming underneath — route NPCs, fact orbs, and doors must all stay interactable while
// traversing, so this must NOT suppress interact() there.
export function suppressesInteract(mode: SessionMode): boolean {
  return mode === "meeting";
}

// Final review (C2): the AUTOMATIC walk-up-to-the-table trigger (WorldScene.stepTo's
// tween onComplete, on the zone-entry edge) must not silently re-open a meeting whose
// node has already been wrapped up — leaving and re-entering the venue, or walking back
// into a completed node's venue mid-traversal (the old venue stays in the walkable
// union), would otherwise re-fire `encounter:meeting:start` and, through App's handler,
// re-run WRAP UP's SUBMIT_FOR_GRADING for the same node a second time. The OTHER call
// site of fireMeetingStart — interact()'s isFacingTable branch, a deliberate Space press
// while facing the table — is a manual re-open the player can always choose, and is NOT
// gated by this (see WorldScene.ts's interact(), which calls fireMeetingStart directly,
// unguarded by wrapped state).
export function shouldAutoOpenMeeting(enteredZone: boolean, alreadyWrappedUp: boolean): boolean {
  return enteredZone && !alreadyWrappedUp;
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

// B3 fix (M5 Task 5.2 review): fact-orb placement used to be
// `tpl.poiSlots[(npcCount + i) % poiSlots.length]` in WorldScene.renderLocation — no
// overflow-safe scan, unlike assignNpcTiles, so a fact orb could land exactly on an
// already-seated NPC's tile (or stack on another fact orb) whenever npcCount + factCount
// exceeded poiSlots.length (confirmed live against case3-m5.world.json: Kawangware Market
// put 3 of 5 orbs on an NPC tile; the warehouse floor put both orbs AND the actor on one
// tile — a latent soft-lock for a pure location-only fact).
//
// assignNpcTiles(tpl, n) already builds exactly the deterministic sequence this needs —
// poiSlots in order, then a row-major free-tile scan for anything beyond poiSlots.length,
// skipping walls/desks/tables/doors and every already-claimed tile — so NPC tile i (for any
// i < n) is assignNpcTiles(tpl, n)[i] regardless of how large n is. Facts simply continue
// that SAME sequence from index npcCount: assignNpcTiles(tpl, npcCount + factCount) is that
// sequence's first (npcCount + factCount) entries, and slicing off the first npcCount of
// them (already reserved for NPCs) leaves exactly the fact tiles, guaranteed distinct from
// every NPC tile and from each other.
//
// This is provably byte-identical to the historical formula whenever nothing collides: if
// npcCount + factCount <= poiSlots.length, assignNpcTiles returns poiSlots.slice(0, npcCount
// + factCount) directly (no wrap), so slice(npcCount) is poiSlots[npcCount..npcCount+factCount-1]
// — exactly `poiSlots[(npcCount + i) % poiSlots.length]` for i = 0..factCount-1, since no
// index ever reaches poiSlots.length and the modulo is a no-op.
export function assignFactTiles(tpl: RoomTemplate, npcCount: number, factCount: number): Point[] {
  return assignNpcTiles(tpl, npcCount + factCount).slice(npcCount);
}
