import { describe, it, expect } from "vitest";
import { tileGrid, charGrid, bigGrid, NPC_PALETTES } from "./grids";

const kinds = ["floor", "wall", "door", "desk"] as const;

describe("pixel grids", () => {
  it("tiles are 16x16 with consistent row widths", () => {
    for (const k of kinds) {
      const g = tileGrid(k);
      expect(g.w).toBe(16); expect(g.h).toBe(16);
      expect(g.rows).toHaveLength(16);
      for (const r of g.rows) expect(r).toHaveLength(16);
    }
  });
  it("char sprites are 16x24 and use only palette indices or transparency", () => {
    const g = charGrid("player", 0);
    expect(g.w).toBe(16); expect(g.h).toBe(24);
    for (const r of g.rows) for (const c of r) {
      if (c !== ".") expect(Number(c)).toBeLessThan(g.palette.length);
    }
  });
  it("npc palettes vary sprites deterministically", () => {
    const a = charGrid("npc", 0), b = charGrid("npc", 1);
    expect(a.palette).not.toEqual(b.palette);
    expect(charGrid("npc", 0)).toEqual(charGrid("npc", 0));
    expect(NPC_PALETTES.length).toBeGreaterThanOrEqual(4);
  });
  it("big sprites have the agreed dimensions", () => {
    const agent = bigGrid("agent", 0);
    expect(agent.w).toBe(48); expect(agent.h).toBe(48);
    const back = bigGrid("playerBack", 0);
    expect(back.w).toBe(56); expect(back.h).toBe(40);
  });
});
