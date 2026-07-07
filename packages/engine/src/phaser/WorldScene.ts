import Phaser from "phaser";
import type { GameSession } from "../state/session";
import type { EventBus } from "../bridge/events";
import { resolvePlacement } from "../state/placement";
import { getTemplate, TILE, TILE_SIZE, type RoomTemplate } from "./templates";
import { generatePlaceholderTextures } from "./textures";

const MOVE_DURATION_MS = 220;

type Direction = "up" | "down" | "left" | "right";
const DIRECTION_DELTA: Record<Direction, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

// 16x16 props (tiles, doors, fact orbs) center on the tile; the 16x24
// character sprites use origin (0.5, 0.75) so their feet sit on the tile —
// this offsets their anchor point down from tile-center accordingly.
function tileCenter(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
}
function characterFoot(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + 12 };
}

interface Interactable { tx: number; ty: number; kind: "actor" | "fact" | "door"; id: string; }

export class WorldScene extends Phaser.Scene {
  private session!: GameSession;
  private bus!: EventBus;
  private player?: Phaser.GameObjects.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private interactables: Interactable[] = [];
  private rendered: Phaser.GameObjects.GameObject[] = [];
  private tpl: RoomTemplate | null = null;

  // Grid-committed movement state: tx/ty is the player's logical tile (set
  // the instant a step begins, not when the tween finishes), facing is the
  // last direction pressed (used to resolve the interaction tile), moving
  // guards against overlapping tweens, frozen is driven by bus "world:freeze".
  private tx = 0;
  private ty = 0;
  private facing: Direction = "down";
  private moving = false;
  private frozen = false;

  // Latches a Space press/release that lands entirely within a single
  // update() call while frozen/moving was blocking input, so a step-time
  // (or freeze-window) tap of the interact key isn't lost to Key.onUp
  // clearing Phaser's internal `_justDown` flag before we ever read it.
  private interactQueued = false;

  constructor() { super("world"); }

  init(data: { session: GameSession; bus: EventBus }) {
    this.session = data.session;
    this.bus = data.bus;
  }

  create() {
    generatePlaceholderTextures(this);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.renderLocation();
    this.bus.on("scene:render", () => this.renderLocation());
    this.bus.on("world:freeze", ({ frozen }) => {
      this.frozen = frozen;
      // Clear the latch (and reset Phaser's own key state) on BOTH edges: a
      // press queued right before we freeze must not fire once an overlay
      // owns input, and — just as importantly — the Space/Enter press that
      // *dismisses* an overlay and thaws the world must not replay here as
      // a fresh world interact.
      this.interactQueued = false;
      this.interactKey.reset();
    });
    if (import.meta.env.DEV) (window as unknown as { __cqScene?: WorldScene }).__cqScene = this;
  }

  /** Dev/test helper: the player's current world position. */
  getPlayerPos(): { x: number; y: number } | null {
    return this.player ? { x: this.player.x, y: this.player.y } : null;
  }

  /** Dev/test helper: the player's current logical tile. */
  getPlayerTile(): { tx: number; ty: number } | null {
    return this.player ? { tx: this.tx, ty: this.ty } : null;
  }

  private clear() {
    this.rendered.forEach((o) => o.destroy());
    this.rendered = [];
    this.interactables = [];
  }

  private renderLocation() {
    this.clear();
    const loc = this.session.accessibleLocations().find((l) => l.id === this.session.currentLocationId())!;
    const tpl = getTemplate(loc.type);
    this.tpl = tpl;
    const tileKey = (t: number) =>
      t === TILE.WALL ? "tile-wall" : t === TILE.DOOR ? "tile-door" : t === TILE.DESK ? "tile-desk" : "tile-floor";

    for (let y = 0; y < tpl.height; y++) {
      for (let x = 0; x < tpl.width; x++) {
        const { x: cx, y: cy } = tileCenter(x, y);
        this.rendered.push(this.add.image(cx, cy, tileKey(tpl.tiles[y][x])));
      }
    }

    const node = this.session.currentNode();
    const world = this.session.world();
    const placement = resolvePlacement(world, node, loc.id);

    placement.npcIds.forEach((actorId, i) => {
      const slot = tpl.poiSlots[i % tpl.poiSlots.length];
      const { x, y } = characterFoot(slot.x, slot.y);
      // Palette index keyed by the actor's position in the node's
      // `present_actors` list (not placement order): App uses the same
      // formula for the transition band / encounter screen sprite, so a
      // given actor keeps one color everywhere they appear.
      const paletteIdx = node.present_actors.indexOf(actorId) % 4;
      this.rendered.push(this.add.sprite(x, y, `sprite-npc-${paletteIdx}`).setOrigin(0.5, 0.75));
      this.interactables.push({ tx: slot.x, ty: slot.y, kind: "actor", id: actorId });
    });

    placement.factSpotIds.forEach((factId, i) => {
      const slot = tpl.poiSlots[(placement.npcIds.length + i) % tpl.poiSlots.length];
      const { x, y } = tileCenter(slot.x, slot.y);
      this.rendered.push(this.add.image(x, y, "sprite-fact"));
      this.interactables.push({ tx: slot.x, ty: slot.y, kind: "fact", id: factId });
    });

    placement.doorTargets.forEach((target, i) => {
      const slot = tpl.doorSlots[i % tpl.doorSlots.length];
      const { x, y } = tileCenter(slot.x, slot.y);
      this.rendered.push(this.add.image(x, y, "tile-door"));
      this.interactables.push({ tx: slot.x, ty: slot.y, kind: "door", id: target });
    });

    const spawn = tpl.playerSpawn;
    this.tx = spawn.x;
    this.ty = spawn.y;
    this.moving = false;
    const { x: sx, y: sy } = characterFoot(spawn.x, spawn.y);
    if (!this.player) {
      this.player = this.add.sprite(sx, sy, "sprite-player").setOrigin(0.5, 0.75);
      this.player.setDepth(10); // keep the player above tiles re-drawn on room change
      this.cameras.main.startFollow(this.player, true);
    } else {
      this.tweens.killTweensOf(this.player);
      this.player.setPosition(sx, sy);
    }
  }

  private readDirection(): Direction | null {
    if (this.cursors.left.isDown) return "left";
    if (this.cursors.right.isDown) return "right";
    if (this.cursors.up.isDown) return "up";
    if (this.cursors.down.isDown) return "down";
    return null;
  }

  private isBlocked(tx: number, ty: number): boolean {
    if (!this.tpl) return true;
    if (tx < 0 || ty < 0 || tx >= this.tpl.width || ty >= this.tpl.height) return true;
    const tile = this.tpl.tiles[ty][tx];
    if (tile === TILE.WALL || tile === TILE.DESK) return true;
    return this.interactables.some((it) => it.kind === "actor" && it.tx === tx && it.ty === ty);
  }

  private stepTo(tx: number, ty: number): void {
    this.moving = true;
    this.tx = tx;
    this.ty = ty;
    const { x, y } = characterFoot(tx, ty);
    this.tweens.add({
      targets: this.player,
      x, y,
      duration: MOVE_DURATION_MS,
      onComplete: () => { this.moving = false; },
    });
  }

  private interact(): void {
    const { dx, dy } = DIRECTION_DELTA[this.facing];
    const ftx = this.tx + dx, fty = this.ty + dy;
    const target = this.interactables.find((it) => it.tx === ftx && it.ty === fty);
    if (!target) return;
    if (target.kind === "actor") this.bus.emit("interact:actor", { actorId: target.id });
    else if (target.kind === "fact") this.bus.emit("interact:fact", { factId: target.id });
    else if (target.kind === "door") {
      this.session.moveTo(target.id);
      this.bus.emit("scene:render", {});
      this.bus.emit("location:changed", { locationId: target.id });
    }
  }

  update() {
    // Latch the edge every frame, before the early return: Key.onUp clears
    // Phaser's internal `_justDown` flag unconditionally, so a press+release
    // that happens entirely within a frozen/moving frame would otherwise
    // never be observed by JustDown once we're free to act again.
    this.interactQueued ||= Phaser.Input.Keyboard.JustDown(this.interactKey);

    if (!this.player || this.frozen || this.moving) return;

    const dir = this.readDirection();
    if (dir) {
      this.facing = dir;
      const { dx, dy } = DIRECTION_DELTA[dir];
      const targetTx = this.tx + dx, targetTy = this.ty + dy;
      if (!this.isBlocked(targetTx, targetTy)) this.stepTo(targetTx, targetTy);
    }

    if (this.interactQueued) {
      this.interactQueued = false;
      this.interact();
    }
  }
}
