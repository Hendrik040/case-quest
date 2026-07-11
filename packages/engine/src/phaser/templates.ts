import type { LocationType } from "@case-quest/schema";

export const TILE = { FLOOR: 0, WALL: 1, DOOR: 2, DESK: 3, TABLE: 4 } as const;
export const TILE_SIZE = 16;

export interface Point { x: number; y: number; }
export interface RoomTemplate {
  width: number;
  height: number;
  tiles: number[][];
  playerSpawn: Point;
  poiSlots: Point[];   // where NPCs / fact-spots are placed
  doorSlots: Point[];  // where exits are placed
  triggerZone: Point[]; // tiles that, when stepped on, open a meeting encounter
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
    triggerZone: [],
  };
}

// Boardroom: a long conference table down the middle row, seats (poiSlots) flanking it
// on both sides, and a triggerZone in the approach corridor south of the table — walking
// up to the table is meant to open the multi-party meeting encounter (wired in Task 1.6).
function makeBoardroom(): RoomTemplate {
  const width = 15, height = 11;
  const tiles = room(width, height);
  const tableRow = 5;
  const tableCols = [5, 6, 7, 8, 9];
  for (const x of tableCols) tiles[tableRow][x] = TILE.TABLE;
  return {
    width, height, tiles,
    playerSpawn: { x: 7, y: 8 },
    poiSlots: [
      { x: 5, y: 4 }, { x: 7, y: 4 }, { x: 9, y: 4 }, // north side seats
      { x: 5, y: 6 }, { x: 7, y: 6 }, { x: 9, y: 6 }, // south side seats
    ],
    doorSlots: [{ x: 7, y: 0 }, { x: 0, y: 5 }],
    triggerZone: [{ x: 6, y: 7 }, { x: 7, y: 7 }, { x: 8, y: 7 }],
  };
}

// Street: an open outdoor path with building facades flanking it on the north and south
// sides, doors set into the facades, and a wide open crossing down the middle (the
// "bridge band") for through-traffic between locations.
function makeStreet(): RoomTemplate {
  const width = 15, height = 11;
  const tiles = room(width, height);
  const facadeCols = [2, 3, 4, 5, 9, 10, 11, 12];
  for (const x of facadeCols) {
    tiles[2][x] = TILE.WALL;
    tiles[3][x] = TILE.WALL;
    tiles[7][x] = TILE.WALL;
    tiles[8][x] = TILE.WALL;
  }
  return {
    width, height, tiles,
    playerSpawn: { x: 7, y: 9 },
    poiSlots: [{ x: 7, y: 4 }, { x: 7, y: 6 }, { x: 1, y: 5 }],
    doorSlots: [{ x: 3, y: 3 }, { x: 11, y: 8 }],
    triggerZone: [],
  };
}

// Shopfront: market stalls (DESK tiles as counters) with vendor poiSlots standing
// just behind each one.
function makeShopfront(): RoomTemplate {
  const width = 15, height = 11;
  const tiles = room(width, height);
  const stallCols = [3, 7, 11];
  for (const x of stallCols) tiles[4][x] = TILE.DESK;
  return {
    width, height, tiles,
    playerSpawn: { x: 7, y: 8 },
    poiSlots: stallCols.map((x) => ({ x, y: 5 })),
    doorSlots: [{ x: 7, y: 0 }, { x: 0, y: 5 }],
    triggerZone: [],
  };
}

// Warehouse: a large open floor with scattered crates (DESK tiles) and worker poiSlots.
function makeWarehouse(): RoomTemplate {
  const width = 15, height = 11;
  const tiles = room(width, height);
  const crates = [{ x: 4, y: 4 }, { x: 10, y: 4 }, { x: 4, y: 7 }, { x: 10, y: 7 }];
  for (const c of crates) tiles[c.y][c.x] = TILE.DESK;
  return {
    width, height, tiles,
    playerSpawn: { x: 7, y: 9 },
    poiSlots: [{ x: 7, y: 3 }, { x: 2, y: 6 }, { x: 12, y: 6 }],
    doorSlots: [{ x: 7, y: 0 }, { x: 0, y: 5 }],
    triggerZone: [],
  };
}

const TEMPLATES: Partial<Record<LocationType, RoomTemplate>> = {
  office: makeTemplate([{ x: 3, y: 3 }, { x: 11, y: 3 }]),
  factory_floor: makeTemplate([{ x: 5, y: 5 }, { x: 9, y: 5 }, { x: 7, y: 6 }]),
  boardroom: makeBoardroom(),
  street: makeStreet(),
  shopfront: makeShopfront(),
  warehouse: makeWarehouse(),
};

const DEFAULT_TEMPLATE = makeTemplate([{ x: 7, y: 4 }]);

export function getTemplate(type: LocationType): RoomTemplate {
  return TEMPLATES[type] ?? DEFAULT_TEMPLATE;
}
