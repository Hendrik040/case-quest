import type { RoomTemplate } from "./templates";
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
