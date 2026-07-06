import Phaser from "phaser";
import type { GameSession } from "../state/session";
import type { EventBus } from "../bridge/events";
import { WorldScene } from "./WorldScene";
import { zoom } from "../ui/pixel/scale";
import { UI } from "../ui/pixel/palette";

export function createGame(parent: HTMLElement, session: GameSession, bus: EventBus): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 240,
    height: 160,
    backgroundColor: UI.void,
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.NONE, zoom: zoom() },
    scene: [WorldScene],
  });
  game.scene.start("world", { session, bus });
  return game;
}
