import Phaser from "phaser";
import { TILE_SIZE } from "./templates";

const COLORS = {
  floor: 0x2b2f3a, wall: 0x555b6e, door: 0x8a6d3b, desk: 0x6d4c41,
  player: 0x4caf50, npc: 0x42a5f5, fact: 0xffca28,
};

function solidTexture(scene: Phaser.Scene, key: string, color: number): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(color, 1).fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  g.lineStyle(1, 0x000000, 0.25).strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
  g.generateTexture(key, TILE_SIZE, TILE_SIZE);
  g.destroy();
}

function circleTexture(scene: Phaser.Scene, key: string, color: number): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const r = TILE_SIZE / 2 - 2;
  g.fillStyle(color, 1).fillCircle(TILE_SIZE / 2, TILE_SIZE / 2, r);
  g.lineStyle(2, 0x000000, 0.4).strokeCircle(TILE_SIZE / 2, TILE_SIZE / 2, r);
  g.generateTexture(key, TILE_SIZE, TILE_SIZE);
  g.destroy();
}

export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  solidTexture(scene, "tile-floor", COLORS.floor);
  solidTexture(scene, "tile-wall", COLORS.wall);
  solidTexture(scene, "tile-door", COLORS.door);
  solidTexture(scene, "tile-desk", COLORS.desk);
  circleTexture(scene, "sprite-player", COLORS.player);
  circleTexture(scene, "sprite-npc", COLORS.npc);
  circleTexture(scene, "sprite-fact", COLORS.fact);
}
