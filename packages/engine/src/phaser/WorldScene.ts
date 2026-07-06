import Phaser from "phaser";
import type { GameSession } from "../state/session";
import type { EventBus } from "../bridge/events";
import { resolvePlacement } from "../state/placement";
import { getTemplate, TILE, TILE_SIZE } from "./templates";
import { generatePlaceholderTextures } from "./textures";

const SPEED = 160;
const INTERACT_RADIUS = 40;

interface Interactable { x: number; y: number; kind: "actor" | "fact" | "door"; id: string; }

export class WorldScene extends Phaser.Scene {
  private session!: GameSession;
  private bus!: EventBus;
  private player?: Phaser.Physics.Arcade.Sprite;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private interactables: Interactable[] = [];
  private rendered: Phaser.GameObjects.GameObject[] = [];

  constructor() { super("world"); }

  init(data: { session: GameSession; bus: EventBus }) {
    this.session = data.session;
    this.bus = data.bus;
  }

  create() {
    generatePlaceholderTextures(this);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.walls = this.physics.add.staticGroup();
    this.renderLocation();
    this.bus.on("scene:render", () => this.renderLocation());
  }

  private clear() {
    this.rendered.forEach((o) => o.destroy());
    this.rendered = [];
    this.walls.clear(true, true);
    this.interactables = [];
  }

  private renderLocation() {
    this.clear();
    const loc = this.session.accessibleLocations().find((l) => l.id === this.session.currentLocationId())!;
    const tpl = getTemplate(loc.type);
    const tileKey = (t: number) =>
      t === TILE.WALL ? "tile-wall" : t === TILE.DOOR ? "tile-door" : t === TILE.DESK ? "tile-desk" : "tile-floor";

    for (let y = 0; y < tpl.height; y++) {
      for (let x = 0; x < tpl.width; x++) {
        const t = tpl.tiles[y][x];
        const cx = x * TILE_SIZE + TILE_SIZE / 2, cy = y * TILE_SIZE + TILE_SIZE / 2;
        this.rendered.push(this.add.image(cx, cy, tileKey(t)));
        if (t === TILE.WALL) {
          const w = this.walls.create(cx, cy, "tile-wall") as Phaser.Physics.Arcade.Sprite;
          w.refreshBody();
        }
      }
    }

    const node = this.session.currentNode();
    const world = this.session.world();
    const placement = resolvePlacement(world, node, loc.id);

    const label = (x: number, y: number, text: string) => {
      this.rendered.push(
        this.add.text(x, y - TILE_SIZE * 0.7, text, { fontSize: "12px", color: "#ffffff", backgroundColor: "#00000088" }).setOrigin(0.5),
      );
    };

    placement.npcIds.forEach((actorId, i) => {
      const slot = tpl.poiSlots[i % tpl.poiSlots.length];
      const px = slot.x * TILE_SIZE + TILE_SIZE / 2, py = slot.y * TILE_SIZE + TILE_SIZE / 2;
      this.rendered.push(this.add.image(px, py, "sprite-npc"));
      const actor = this.session.presentActors().find((a) => a.id === actorId);
      label(px, py, actor?.name ?? actorId);
      this.interactables.push({ x: px, y: py, kind: "actor", id: actorId });
    });

    placement.factSpotIds.forEach((factId, i) => {
      const slot = tpl.poiSlots[(placement.npcIds.length + i) % tpl.poiSlots.length];
      const px = slot.x * TILE_SIZE + TILE_SIZE / 2, py = slot.y * TILE_SIZE + TILE_SIZE / 2;
      this.rendered.push(this.add.image(px, py, "sprite-fact"));
      label(px, py, "?");
      this.interactables.push({ x: px, y: py, kind: "fact", id: factId });
    });

    placement.doorTargets.forEach((target, i) => {
      const slot = tpl.doorSlots[i % tpl.doorSlots.length];
      const px = slot.x * TILE_SIZE + TILE_SIZE / 2, py = slot.y * TILE_SIZE + TILE_SIZE / 2;
      this.rendered.push(this.add.image(px, py, "tile-door"));
      label(px, py, "exit");
      this.interactables.push({ x: px, y: py, kind: "door", id: target });
    });

    const spawn = tpl.playerSpawn;
    const sx = spawn.x * TILE_SIZE + TILE_SIZE / 2, sy = spawn.y * TILE_SIZE + TILE_SIZE / 2;
    if (!this.player) {
      this.player = this.physics.add.sprite(sx, sy, "sprite-player");
      this.player.setCollideWorldBounds(true);
      this.cameras.main.startFollow(this.player);
    } else {
      this.player.setPosition(sx, sy);
    }
    this.physics.add.collider(this.player, this.walls);
    this.physics.world.setBounds(0, 0, tpl.width * TILE_SIZE, tpl.height * TILE_SIZE);
    this.bus.emit("location:changed", { locationId: loc.id });
  }

  update() {
    if (!this.player) return;
    this.player.setVelocity(0);
    if (this.cursors.left.isDown) this.player.setVelocityX(-SPEED);
    else if (this.cursors.right.isDown) this.player.setVelocityX(SPEED);
    if (this.cursors.up.isDown) this.player.setVelocityY(-SPEED);
    else if (this.cursors.down.isDown) this.player.setVelocityY(SPEED);

    const near = this.nearestInteractable();
    if (near && near.kind === "door") {
      this.session.moveTo(near.id);
      this.bus.emit("scene:render", {});
      return;
    }
    if (near && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      if (near.kind === "actor") this.bus.emit("interact:actor", { actorId: near.id });
      else if (near.kind === "fact") this.bus.emit("interact:fact", { factId: near.id });
    }
  }

  private nearestInteractable(): Interactable | null {
    if (!this.player) return null;
    let best: Interactable | null = null;
    let bestD = INTERACT_RADIUS;
    for (const it of this.interactables) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, it.x, it.y);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }
}
