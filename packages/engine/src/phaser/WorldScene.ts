import Phaser from "phaser";
import type { GameSession } from "../state/session";
import type { EventBus } from "../bridge/events";
import { resolvePlacement, resolveSeating } from "../state/placement";
import { getTemplate, TILE, TILE_SIZE, type RoomTemplate } from "./templates";
import { generatePlaceholderTextures } from "./textures";
import { isTriggerZoneTile, enteredTriggerZone, isFacingTable, meetingStartPayload } from "./meetingTrigger";

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

  // Meeting-trigger state (Task 1.6): the node's seated actors at the current
  // (venue) location, and whether the player's logical tile is currently
  // inside the template's triggerZone — tracked so we fire on the
  // enter-the-zone edge only (see meetingTrigger.ts), not every frame spent
  // standing in it.
  private seatedActorIds: string[] = [];
  private inTriggerZone = false;

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
    // Seam fix (Task 11 playthrough): both calls above default to
    // `enableCapture: true`, which makes Phaser's *own* `window` keydown
    // listener (registered here, at scene boot — always before any of the
    // pixel kit's `window` keydown listeners, which only attach once an
    // overlay mounts) call `event.preventDefault()` on every Space/Arrow
    // press, unconditionally, regardless of `frozen`. Every kit component
    // (Typewriter, ChoiceBox, ActionMenu, TopicsPanel, NotesPanel,
    // DecisionEncounter's Escape handler, App's Enter shortcut) guards on
    // `if (e.defaultPrevented) return;`, so with captures left on, every one
    // of those `defaultPrevented` before it ever reached the UI: the entire
    // keyboard-driven overlay UI was inert. WorldScene reads key state by
    // polling (`isDown` / `JustDown`) every frame, which capture status
    // never affected either way — so dropping the captures costs this scene
    // nothing while unblocking every overlay above it.
    this.input.keyboard!.clearCaptures();
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

  /** Dev/test helper: the current room's interactables (NPCs, fact orbs, doors), by tile. */
  getInteractables(): Interactable[] {
    return this.interactables.map((it) => ({ ...it }));
  }

  /**
   * Dev/test helper: a blocked/walkable snapshot of the current room, sized
   * to the active template — lets an external driver (e.g. the e2e script)
   * do its own pathfinding without hardcoding template geometry.
   */
  getRoomGrid(): { width: number; height: number; blocked: boolean[][] } | null {
    if (!this.tpl) return null;
    const { width, height } = this.tpl;
    const blocked: boolean[][] = [];
    for (let y = 0; y < height; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < width; x++) row.push(this.isBlocked(x, y));
      blocked.push(row);
    }
    return { width, height, blocked };
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
    // Seam fix (Task 11 playthrough): the camera follows the player with no
    // bounds, and every room template (240x176 logical px) is taller than
    // the 240x160 canvas — so centering on the player at their (7,8) spawn,
    // just two tiles off the south wall, immediately scrolls ~44px of raw
    // `backgroundColor` "void" into view below the map. Clamping to the
    // room's own pixel rect keeps the camera from ever scrolling past an
    // edge, in either room.
    this.cameras.main.setBounds(0, 0, tpl.width * TILE_SIZE, tpl.height * TILE_SIZE);
    const tileKey = (t: number) =>
      t === TILE.WALL ? "tile-wall" :
      t === TILE.DOOR ? "tile-door" :
      t === TILE.DESK ? "tile-desk" :
      t === TILE.TABLE ? "tile-table" :
      "tile-floor";

    for (let y = 0; y < tpl.height; y++) {
      for (let x = 0; x < tpl.width; x++) {
        const { x: cx, y: cy } = tileCenter(x, y);
        this.rendered.push(this.add.image(cx, cy, tileKey(tpl.tiles[y][x])));
      }
    }

    // Trigger zone: rendered as a subtle tint over the floor tiles it sits on
    // (drawn after the base tile pass, so it layers on top), marking the
    // walk-up-to-the-table meeting encounter zone.
    for (const tz of tpl.triggerZone) {
      const { x: cx, y: cy } = tileCenter(tz.x, tz.y);
      this.rendered.push(this.add.image(cx, cy, "tile-trigger"));
    }

    const node = this.session.currentNode();
    const world = this.session.world();
    const placement = resolvePlacement(world, node, loc.id);
    this.seatedActorIds = resolveSeating(world, node, loc.id).seatedActorIds;

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
    // A fresh room-render always starts outside the zone from the trigger's
    // point of view: spawn tiles are never authored inside a triggerZone
    // (see templates.test.ts), and this resets the latch on scene:render.
    this.inTriggerZone = isTriggerZoneTile(tpl, spawn.x, spawn.y);
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
    if (tile === TILE.WALL || tile === TILE.DESK || tile === TILE.TABLE) return true;
    return this.interactables.some((it) => it.kind === "actor" && it.tx === tx && it.ty === ty);
  }

  private stepTo(tx: number, ty: number): void {
    this.moving = true;
    this.tx = tx;
    this.ty = ty;
    const wasInZone = this.inTriggerZone;
    this.inTriggerZone = !!this.tpl && isTriggerZoneTile(this.tpl, tx, ty);
    const { x, y } = characterFoot(tx, ty);
    this.tweens.add({
      targets: this.player,
      x, y,
      duration: MOVE_DURATION_MS,
      onComplete: () => {
        this.moving = false;
        // Re-check `frozen` at completion time, not just at step-start: an
        // overlay can freeze the world mid-tween, and world:freeze discipline
        // means no fresh encounter should open once the world is frozen.
        if (!this.frozen && enteredTriggerZone(wasInZone, this.inTriggerZone)) this.fireMeetingStart();
      },
    });
  }

  private fireMeetingStart(): void {
    this.bus.emit("encounter:meeting:start", meetingStartPayload(this.seatedActorIds));
  }

  private interact(): void {
    const { dx, dy } = DIRECTION_DELTA[this.facing];
    const ftx = this.tx + dx, fty = this.ty + dy;
    const target = this.interactables.find((it) => it.tx === ftx && it.ty === fty);
    if (target) {
      if (target.kind === "actor") this.bus.emit("interact:actor", { actorId: target.id });
      else if (target.kind === "fact") this.bus.emit("interact:fact", { factId: target.id });
      else if (target.kind === "door") {
        this.session.moveTo(target.id);
        this.bus.emit("scene:render", {});
        this.bus.emit("location:changed", { locationId: target.id });
      }
      return;
    }
    if (this.tpl && isFacingTable(this.tpl, ftx, fty)) this.fireMeetingStart();
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
