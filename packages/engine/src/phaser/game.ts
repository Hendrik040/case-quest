import Phaser from "phaser";
import type { GameSession } from "../state/session";
import type { EventBus } from "../bridge/events";
import { WorldScene } from "./WorldScene";
import { zoom } from "../ui/pixel/scale";

export function createGame(parent: HTMLElement, session: GameSession, bus: EventBus): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 240,
    height: 160,
    // TODO(Task 7): replace with UI.void (same hex) once ui/pixel/palette.ts
    // lands — that file doesn't exist yet at this point in the plan.
    backgroundColor: "#a0d8d0",
    pixelArt: true,
    roundPixels: true,
    // NOTE (concern, do not remove yet): WorldScene.ts still drives movement
    // and collision through this.physics (physics.add.staticGroup/sprite/
    // collider, physics.world.setBounds). Task 5 rewrites WorldScene to
    // grid-tweened movement and drops arcade physics entirely — only then
    // should this config be deleted.
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scale: { mode: Phaser.Scale.NONE, zoom: zoom() },
    scene: [WorldScene],
  });
  game.scene.start("world", { session, bus });
  return game;
}
