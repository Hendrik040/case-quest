import Phaser from "phaser";
import type { GameSession } from "../state/session";
import type { EventBus } from "../bridge/events";
import { WorldScene } from "./WorldScene";

export function createGame(parent: HTMLElement, session: GameSession, bus: EventBus): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 480,
    height: 352,
    backgroundColor: "#10131a",
    pixelArt: true,
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [WorldScene],
  });
  game.scene.start("world", { session, bus });
  return game;
}
