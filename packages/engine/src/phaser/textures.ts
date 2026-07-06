import Phaser from "phaser";
import { tileGrid, charGrid, NPC_PALETTES } from "../art/grids";
import { gridToCanvas } from "../art/canvas";

// Registers a rasterized PixelGrid as a Phaser canvas texture, skipping any
// key that already exists — WorldScene calls generatePlaceholderTextures()
// from create(), which re-runs on scene restart, and re-adding a key throws.
function addOnce(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) return;
  scene.textures.addCanvas(key, canvas);
}

export function generatePlaceholderTextures(scene: Phaser.Scene): void {
  addOnce(scene, "tile-floor", gridToCanvas(tileGrid("floor")));
  addOnce(scene, "tile-wall", gridToCanvas(tileGrid("wall")));
  addOnce(scene, "tile-door", gridToCanvas(tileGrid("door")));
  addOnce(scene, "tile-desk", gridToCanvas(tileGrid("desk")));
  addOnce(scene, "sprite-player", gridToCanvas(charGrid("player", 0)));
  NPC_PALETTES.forEach((_, i) => addOnce(scene, `sprite-npc-${i}`, gridToCanvas(charGrid("npc", i))));
}
