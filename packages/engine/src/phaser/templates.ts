import type { LocationType } from "@case-quest/schema";

export const TILE = { FLOOR: 0, WALL: 1, DOOR: 2, DESK: 3 } as const;
export const TILE_SIZE = 16;

export interface Point { x: number; y: number; }
export interface RoomTemplate {
  width: number;
  height: number;
  tiles: number[][];
  playerSpawn: Point;
  poiSlots: Point[];   // where NPCs / fact-spots are placed
  doorSlots: Point[];  // where exits are placed
}

// Build a W x H room with a wall border and a floor interior.
function room(width: number, height: number): number[][] {
  const tiles: number[][] = [];
  for (let y = 0; y < height; y++) {
    const rowTiles: number[] = [];
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      rowTiles.push(border ? TILE.WALL : TILE.FLOOR);
    }
    tiles.push(rowTiles);
  }
  return tiles;
}

function makeTemplate(desks: Point[]): RoomTemplate {
  const width = 15, height = 11;
  const tiles = room(width, height);
  for (const d of desks) tiles[d.y][d.x] = TILE.DESK;
  return {
    width, height, tiles,
    playerSpawn: { x: 7, y: 8 },
    poiSlots: [{ x: 4, y: 3 }, { x: 10, y: 3 }, { x: 7, y: 2 }],
    doorSlots: [{ x: 7, y: 0 }, { x: 0, y: 5 }],
  };
}

const TEMPLATES: Partial<Record<LocationType, RoomTemplate>> = {
  office: makeTemplate([{ x: 3, y: 3 }, { x: 11, y: 3 }]),
  factory_floor: makeTemplate([{ x: 5, y: 5 }, { x: 9, y: 5 }, { x: 7, y: 6 }]),
};

const DEFAULT_TEMPLATE = makeTemplate([{ x: 7, y: 4 }]);

export function getTemplate(type: LocationType): RoomTemplate {
  return TEMPLATES[type] ?? DEFAULT_TEMPLATE;
}
