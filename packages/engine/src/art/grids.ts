// Pixel-art data source for the whole engine (Gen-3/GBA idiom): flat fills,
// 2-3 shade cel banding, 1px outlines, dither speckle on ground tiles.
// Pure data — no DOM, no Phaser. Task 4 rasterizes these grids into Phaser
// textures and React <img> data-URLs.

export interface PixelGrid {
  w: number;
  h: number;
  palette: string[];
  rows: string[];
}

// ---- tiny canvas builder --------------------------------------------------
// A Canvas is a mutable 2D char grid ('.' = transparent, '0'-'9' = palette
// index). Shapes are authored as coordinates via these helpers rather than
// literal row strings, which keeps every row exactly grid-width by
// construction and keeps sprite authoring deterministic (no randomness).

type Canvas = string[][];

function blank(w: number, h: number): Canvas {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => "."));
}

function toRows(c: Canvas): string[] {
  return c.map((row) => row.join(""));
}

function px(c: Canvas, x: number, y: number, ch: string): void {
  if (y >= 0 && y < c.length && x >= 0 && x < c[0].length) c[y][x] = ch;
}

function rect(c: Canvas, x0: number, y0: number, x1: number, y1: number, ch: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(c, x, y, ch);
}

function outlineRect(c: Canvas, x0: number, y0: number, x1: number, y1: number, ch: string): void {
  for (let x = x0; x <= x1; x++) { px(c, x, y0, ch); px(c, x, y1, ch); }
  for (let y = y0; y <= y1; y++) { px(c, x0, y, ch); px(c, x1, y, ch); }
}

// Stamps a 1px dark ring on the transparent pixels bordering a filled
// silhouette, so every character/prop shape gets an outline "for free"
// without hand-tracing its perimeter.
function addOutline(c: Canvas, outlineCh: string): void {
  const h = c.length;
  const w = c[0].length;
  const toMark: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (c[y][x] !== ".") continue;
      const hasFilledNeighbor =
        (x > 0 && c[y][x - 1] !== ".") ||
        (x < w - 1 && c[y][x + 1] !== ".") ||
        (y > 0 && c[y - 1][x] !== ".") ||
        (y < h - 1 && c[y + 1][x] !== ".");
      if (hasFilledNeighbor) toMark.push([x, y]);
    }
  }
  for (const [x, y] of toMark) c[y][x] = outlineCh;
}

// ---- tiles (16x16) ---------------------------------------------------------

const FLOOR_PALETTE = ["#98c070", "#a8d078", "#78a050"];
const WALL_PALETTE = ["#9a8fa8", "#867a90", "#3a3448"];
const DOOR_PALETTE = ["#8a6d3b", "#a9835a", "#2a1c10", "#241408"];
const DESK_PALETTE = ["#6d4c41", "#8a6a58", "#4a3328", "#1a1414"];

function floorShape(): Canvas {
  const c = blank(16, 16);
  rect(c, 0, 0, 15, 15, "0");
  // Grass-dot dither: ≥6 speckles in a second shade, plus a few in a third
  // for extra cel-banding variety. Scattered by hand, not on a grid, so the
  // ground reads as textured rather than patterned.
  const lightSpeckle: Array<[number, number]> = [
    [2, 1], [9, 2], [13, 3], [4, 5], [11, 6], [2, 8], [7, 9], [14, 10],
  ];
  for (const [x, y] of lightSpeckle) px(c, x, y, "1");
  const darkSpeckle: Array<[number, number]> = [
    [5, 12], [10, 13], [3, 14], [12, 14],
  ];
  for (const [x, y] of darkSpeckle) px(c, x, y, "2");
  return c;
}

function wallShape(): Canvas {
  const c = blank(16, 16);
  rect(c, 0, 0, 15, 15, "0"); // lighter mauve-grey face
  rect(c, 0, 8, 15, 8, "1"); // panel seam shade (cel banding)
  outlineRect(c, 0, 0, 15, 15, "2"); // dark-hue border (buildings/tiles rule)
  return c;
}

function doorShape(): Canvas {
  const c = blank(16, 16);
  rect(c, 0, 0, 15, 15, "0"); // warm wood frame base
  rect(c, 0, 0, 15, 2, "1"); // top-lit highlight
  rect(c, 2, 3, 13, 15, "2"); // dark opening, flush with the tile bottom
  outlineRect(c, 0, 0, 15, 15, "3"); // dark-hue frame outline
  return c;
}

function deskShape(): Canvas {
  const c = blank(16, 16);
  rect(c, 0, 0, 15, 15, "0"); // desk brown
  rect(c, 0, 0, 15, 2, "1"); // top-lit highlight
  rect(c, 0, 13, 15, 15, "2"); // shadowed bottom edge
  outlineRect(c, 0, 0, 15, 15, "3"); // near-black prop outline
  return c;
}

const TILE_SHAPES = {
  floor: floorShape,
  wall: wallShape,
  door: doorShape,
  desk: deskShape,
} satisfies Record<string, () => Canvas>;

const TILE_PALETTES: Record<keyof typeof TILE_SHAPES, string[]> = {
  floor: FLOOR_PALETTE,
  wall: WALL_PALETTE,
  door: DOOR_PALETTE,
  desk: DESK_PALETTE,
};

export function tileGrid(kind: "floor" | "wall" | "door" | "desk"): PixelGrid {
  return { w: 16, h: 16, palette: TILE_PALETTES[kind], rows: toRows(TILE_SHAPES[kind]()) };
}

// ---- fact pickup (16x16) ---------------------------------------------------
// A Pokéball-like ground item for investigation spots: red top hemisphere,
// white bottom, dark 1px outline (via addOutline), single white specular
// pixel. Distinct silhouette from the floor/wall/door/desk tiles so it reads
// as a "grab this" prop rather than terrain.

const FACT_PALETTE = ["#1a1414", "#d94030", "#f0f0f0", "#ffffff"];

function factOrbShape(): Canvas {
  const c = blank(16, 16);
  const cx = 7.5, cy = 7.5, r = 6.5;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) px(c, x, y, y < cy ? "1" : "2");
    }
  }
  px(c, 5, 4, "3"); // specular highlight, top-left of the red hemisphere
  addOutline(c, "0");
  return c;
}

export function factGrid(): PixelGrid {
  return { w: 16, h: 16, palette: FACT_PALETTE, rows: toRows(factOrbShape()) };
}

// ---- chibi characters (16x24) ---------------------------------------------
// Shared palette slots for both "player" and "npc": 0 outline, 1 skin,
// 2 hair, 3 shirt, 4 shirt shade, 5 pants/shoes.

const PLAYER_PALETTE = ["#1a1414", "#f0c8a0", "#3a2a1a", "#d0483c", "#a83830", "#2e2a26"];

export const NPC_PALETTES: string[][] = [
  ["#1a1414", "#f0c8a0", "#3a2a1a", "#4c6faf", "#3a5688", "#2e2a26"], // brown hair, blue shirt
  ["#1a1414", "#f0c8a0", "#8a3a2a", "#af8a3a", "#8a6a2c", "#2e2a26"], // auburn hair, mustard shirt
  ["#1a1414", "#e0b090", "#1a1a1a", "#af4c6f", "#883a56", "#2e2a26"], // black hair, magenta shirt
  ["#1a1414", "#f0c8a0", "#d0d0d0", "#4caf7a", "#3a8860", "#2e2a26"], // grey hair, teal shirt
];

function clothingPalette(kind: "player" | "npc", paletteIndex: number): string[] {
  if (kind === "player") return PLAYER_PALETTE;
  const idx = ((paletteIndex % NPC_PALETTES.length) + NPC_PALETTES.length) % NPC_PALETTES.length;
  return NPC_PALETTES[idx];
}

function chibiBody(): Canvas {
  const c = blank(16, 24);
  // Head: 8px-tall bowl-cut hair over a skin face, rows 0-7.
  rect(c, 5, 0, 10, 0, "2");
  rect(c, 4, 1, 11, 1, "2");
  rect(c, 3, 2, 12, 2, "2");
  rect(c, 3, 3, 4, 6, "2");
  rect(c, 11, 3, 12, 6, "2");
  rect(c, 5, 2, 10, 6, "1");
  // Eyes: 1px wide x 2px tall dark marks.
  px(c, 6, 4, "0"); px(c, 6, 5, "0");
  px(c, 9, 4, "0"); px(c, 9, 5, "0");
  rect(c, 4, 7, 11, 7, "1"); // chin/jaw
  // Body: shirt torso, rows 8-16.
  rect(c, 4, 8, 11, 9, "3"); // shoulders
  rect(c, 5, 10, 10, 15, "3"); // torso
  rect(c, 5, 16, 10, 16, "4"); // hem shade
  rect(c, 4, 11, 4, 13, "1"); // left hand
  rect(c, 11, 11, 11, 13, "1"); // right hand
  // Legs/feet, rows 17-23 (feet on the bottom row).
  rect(c, 5, 17, 10, 21, "5");
  rect(c, 5, 22, 7, 23, "5");
  rect(c, 8, 22, 10, 23, "5");
  return c;
}

export function charGrid(kind: "player" | "npc", paletteIndex: number): PixelGrid {
  const shape = chibiBody();
  addOutline(shape, "0");
  return { w: 16, h: 24, palette: clothingPalette(kind, paletteIndex), rows: toRows(shape) };
}

// ---- encounter sprites (48x48 / 56x40) -------------------------------------

function agentBust(): Canvas {
  const c = blank(48, 48);
  // Head/hair, rows 0-23.
  rect(c, 16, 0, 31, 1, "2");
  rect(c, 13, 2, 34, 4, "2");
  rect(c, 11, 5, 36, 9, "2");
  rect(c, 11, 10, 14, 21, "2");
  rect(c, 33, 10, 36, 21, "2");
  rect(c, 15, 8, 32, 21, "1"); // face
  rect(c, 19, 13, 21, 16, "0"); // left eye
  rect(c, 26, 13, 28, 16, "0"); // right eye
  rect(c, 17, 22, 30, 23, "1"); // chin taper
  // Shoulders/chest, rows 24-47.
  rect(c, 8, 24, 39, 27, "3"); // shoulders
  rect(c, 20, 24, 27, 26, "4"); // collar accent
  rect(c, 4, 28, 43, 44, "3"); // chest
  rect(c, 4, 45, 43, 47, "4"); // hem shade
  return c;
}

function playerBackShape(): Canvas {
  const c = blank(56, 40);
  // Back of the head, hair only — no face, per the encounter "near camera" framing.
  rect(c, 20, 0, 35, 1, "2");
  rect(c, 16, 2, 39, 5, "2");
  rect(c, 13, 6, 42, 19, "2");
  rect(c, 15, 20, 40, 22, "2"); // neck taper
  rect(c, 26, 6, 29, 19, "4"); // center hair shade band (cel banding)
  // Shoulders/back, rows 23-39.
  rect(c, 6, 23, 49, 27, "3");
  rect(c, 2, 28, 53, 39, "3");
  rect(c, 2, 36, 53, 39, "4"); // lower back shade
  return c;
}

export function bigGrid(kind: "agent" | "playerBack", paletteIndex: number): PixelGrid {
  if (kind === "agent") {
    const shape = agentBust();
    addOutline(shape, "0");
    return { w: 48, h: 48, palette: clothingPalette("npc", paletteIndex), rows: toRows(shape) };
  }
  const shape = playerBackShape();
  addOutline(shape, "0");
  return { w: 56, h: 40, palette: PLAYER_PALETTE, rows: toRows(shape) };
}
