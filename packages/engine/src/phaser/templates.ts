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
    // B2 fix (M5 Task 5.2 review): `street` is a venue-capable type (an outdoor gathering
    // spot, per placement.ts's VENUE_LOCATION_TYPES) but had no triggerZone at all, so a
    // node whose venue is a street could never open the meeting overlay. Row 5 sits in the
    // open "bridge" crossing between the two facade bands (rows 2-3 and 7-8), untouched by
    // either wall band and clear of every poiSlot/doorSlot/spawn — a sensible gathering spot
    // for a walk-up meeting in the middle of the street.
    triggerZone: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
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
    // B2 fix (M5 Task 5.2 review): shopfront had no triggerZone at all, so Kawangware
    // Market (case3-m5.world.json) could never open the meeting overlay — the legacy
    // per-actor auto-chain was the ONLY way to gather facts there. Row 6, directly in front
    // of the vendor poiSlots (row 5), is the natural "walk up to the market stalls" spot.
    triggerZone: [{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }],
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
    // B2 fix (M5 Task 5.2 review): given real trigger geometry defensively, mirroring
    // shopfront/client_site — see the "warehouse" note on templates.test.ts's venue-capable
    // trigger-zone coverage test for why this is safe even though `warehouse` isn't
    // currently in placement.ts's VENUE_LOCATION_TYPES (WorldScene never starts a meeting
    // with zero seated actors). Row 5 sits between the two crate rows (4 and 7), near the
    // worker poi area, clear of every crate/poiSlot/doorSlot/spawn.
    triggerZone: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
  };
}

// Client site: a small negotiation area (a couple of crates/desks flanking a meeting spot)
// — the template case3-m5.world.json's "Warehouse floor" venue (type `client_site`) actually
// resolves to. Before this fix `client_site` had no TEMPLATES entry at all and silently fell
// back to the generic DEFAULT_TEMPLATE (no triggerZone, no meeting-capable geometry) — see
// the Task 5.2 e2e report's finding #2.
function makeClientSite(): RoomTemplate {
  const width = 15, height = 11;
  const tiles = room(width, height);
  const desks = [{ x: 5, y: 4 }, { x: 9, y: 4 }];
  for (const d of desks) tiles[d.y][d.x] = TILE.DESK;
  return {
    width, height, tiles,
    playerSpawn: { x: 7, y: 8 },
    poiSlots: [{ x: 5, y: 5 }, { x: 9, y: 5 }, { x: 7, y: 3 }],
    doorSlots: [{ x: 7, y: 0 }, { x: 0, y: 5 }],
    triggerZone: [{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }],
  };
}

const TEMPLATES: Partial<Record<LocationType, RoomTemplate>> = {
  office: makeTemplate([{ x: 3, y: 3 }, { x: 11, y: 3 }]),
  factory_floor: makeTemplate([{ x: 5, y: 5 }, { x: 9, y: 5 }, { x: 7, y: 6 }]),
  boardroom: makeBoardroom(),
  street: makeStreet(),
  shopfront: makeShopfront(),
  warehouse: makeWarehouse(),
  client_site: makeClientSite(),
};

const DEFAULT_TEMPLATE = makeTemplate([{ x: 7, y: 4 }]);

export function getTemplate(type: LocationType): RoomTemplate {
  return TEMPLATES[type] ?? DEFAULT_TEMPLATE;
}
