// packages/engine/src/art/canvas.ts
import type { PixelGrid } from "./grids";

export function gridToCanvas(g: PixelGrid): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = g.w; c.height = g.h;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const ch = g.rows[y][x];
      if (ch === ".") continue;
      ctx.fillStyle = g.palette[Number(ch)];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

export function gridToDataURL(g: PixelGrid): string {
  return gridToCanvas(g).toDataURL();
}
