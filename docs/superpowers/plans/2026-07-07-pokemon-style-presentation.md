# Pokémon-Style Presentation (M3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-present Case Quest in Pokémon Emerald's grammar: a HUD-less 240×160 tile overworld with grid movement and a locked camera, plus battle-style React encounter scenes (ASK/NOTES/MOVE ON) that auto-chain on scenario entry, a boss-encounter decision, and a debrief that plays as battle text.

**Architecture:** The deterministic `GameSession` gains an encounter state machine (`roaming | encounter | decision | debrief`); Phaser renders only the overworld; all encounter/decision/debrief UI is pixel-skinned React DOM sized by a shared integer zoom factor. Spec: `docs/superpowers/specs/2026-07-07-pokemon-style-presentation-design.md`. Visual reference: `docs/superpowers/research/2026-07-07-pokemon-gen3-presentation-grammar.md`.

**Tech Stack:** TypeScript (strict), Vite, React 18, Phaser 3, Vitest, playwright-core (dev-only, e2e driver).

## Global Constraints

- Run all package commands from the repo root as `pnpm -C packages/engine <cmd>` (`test`, `typecheck`, `build`, `dev`).
- `pnpm -C packages/schema build` must have been run once before engine dev/build.
- No changes to `@case-quest/schema` or any `world.json` — the grammar maps onto existing data.
- Vitest runs in a **node** environment: state/util tests must not touch DOM or Phaser. Browser behavior is verified by the e2e driver (Task 11).
- Logical canvas is 240×160, `TILE_SIZE = 16`; DOM UI is sized in logical pixels multiplied by the shared `zoom` from `src/ui/pixel/scale.ts`.
- Commit after every task with the message given in that task; all commits end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Keep dev hooks (`window.__cqScene`, `window.__cqBus`, `window.__cqSession`) behind `import.meta.env.DEV`.

## Palette (used across Tasks 2, 7, 8; copy exactly)

```ts
// Gen-3-derived UI palette (from the grammar research doc)
export const UI = {
  fieldBoxFill: "#f8f8f0", fieldBoxBorderOuter: "#40c8a8", fieldBoxBorderInner: "#88e0c8",
  fieldText: "#404048",
  battleBoxFill: "#305858", battleBoxBorder: "#e05828", battleBoxBorderDark: "#702810",
  battleText: "#f8f8f8", battleTextShadow: "#303030",
  panelFill: "#f8f0d8", panelBorder: "#405828",
  hpTag: "#f0a028", hpBar: "#58c838", hpTrack: "#404040", expBar: "#3890f0",
  advanceGlyph: "#e03028",
  encounterBg: "#f0ede0", pinstripe: "#e8e0b8", platform: "#d8c890",
  bannerWood: "#a07040", bannerWoodDark: "#705028", bannerText: "#f8f8f8",
  void: "#a0d8d0",
} as const;
```

---

### Task 1: Text pagination utility

**Files:**
- Create: `packages/engine/src/ui/pixel/paginate.ts`
- Test: `packages/engine/src/ui/pixel/paginate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `paginate(text: string, cols: number, lines: number): string[][]` — word-wraps `text` into pages; each page is ≤ `lines` rows of ≤ `cols` chars. Words longer than `cols` are hard-split. Used by `Typewriter.tsx` (Task 7).

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/src/ui/pixel/paginate.test.ts
import { describe, it, expect } from "vitest";
import { paginate } from "./paginate";

describe("paginate", () => {
  it("wraps words into lines of at most cols chars", () => {
    expect(paginate("one two three four", 9, 2)).toEqual([["one two", "three"], ["four"]]);
  });
  it("puts short text on a single page", () => {
    expect(paginate("Hello", 20, 2)).toEqual([["Hello"]]);
  });
  it("hard-splits words longer than cols", () => {
    expect(paginate("abcdefghij", 4, 2)).toEqual([["abcd", "efgh"], ["ij"]]);
  });
  it("returns one empty page for empty text", () => {
    expect(paginate("", 10, 2)).toEqual([[""]]);
  });
  it("respects the lines-per-page limit", () => {
    const pages = paginate("a b c d e f", 1, 2);
    expect(pages).toEqual([["a", "b"], ["c", "d"], ["e", "f"]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/engine test -- paginate`
Expected: FAIL — `Cannot find module './paginate'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/engine/src/ui/pixel/paginate.ts
/** Word-wrap text into pages of `lines` rows × `cols` chars (Gen-3 message box). */
export function paginate(text: string, cols: number, lines: number): string[][] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const rows: string[] = [];
  let current = "";
  const pushRow = () => { rows.push(current); current = ""; };
  for (let word of words) {
    while (word.length > cols) {
      if (current) pushRow();
      rows.push(word.slice(0, cols));
      word = word.slice(cols);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= cols) current += " " + word;
    else { pushRow(); current = word; }
  }
  if (current || rows.length === 0) pushRow();
  const pages: string[][] = [];
  for (let i = 0; i < rows.length; i += lines) pages.push(rows.slice(i, i + lines));
  return pages;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/engine test -- paginate`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/ui/pixel/paginate.ts packages/engine/src/ui/pixel/paginate.test.ts
git commit -m "feat(engine): message-box pagination utility"
```

---

### Task 2: Pixel-art grid generator (pure data)

**Files:**
- Create: `packages/engine/src/art/grids.ts`
- Test: `packages/engine/src/art/grids.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface PixelGrid { w: number; h: number; palette: string[]; rows: string[] }` — `rows[y][x]` is a palette index char `'0'-'9'` or `'.'` for transparent.
  - `tileGrid(kind: "floor" | "wall" | "door" | "desk"): PixelGrid` — 16×16.
  - `charGrid(kind: "player" | "npc", paletteIndex: number): PixelGrid` — 16×24 chibi, front-facing, 1px dark outline. `paletteIndex` picks a clothing color set so agents differ.
  - `bigGrid(kind: "agent" | "playerBack", paletteIndex: number): PixelGrid` — 48×48 front sprite / 56×40 player back-view.
  - `NPC_PALETTES: string[][]` — at least 4 clothing palettes.

These grids are the single source of art truth; Task 4 rasterizes them for both Phaser textures and React `<img>` data-URLs.

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/src/art/grids.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/engine test -- grids`
Expected: FAIL — `Cannot find module './grids'`

- [ ] **Step 3: Implement**

Author `grids.ts` with hand-drawn pixel rows in the Gen-3 idiom (flat fills, 2–3 shades, 1px dark outline, speckle dither on floor). The exact pixels are the implementer's craft; the *shape contract* is fixed by the test. Requirements beyond the test: `wall` must read as a solid border tile (dark-hue outline, lighter face), `door` as a doorway (dark opening + frame), `floor` gets ≥6 scattered speckle pixels in a second shade, chibi chars have a 7–8px head with 2px eyes, and `playerBack` reads as the back of a head + shoulders (it sits "near camera" in encounters). Use string rows, e.g.:

```ts
// Style sample — the full file defines every sprite this way.
const FLOOR: PixelGrid = {
  w: 16, h: 16,
  palette: ["#98c070", "#88b060", "#78a050"],
  rows: [
    "0000000000000000",
    "0001000000020000",
    // …14 more 16-char rows with sparse 1/2 speckles on 0 ground…
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/engine test -- grids`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/art/grids.ts packages/engine/src/art/grids.test.ts
git commit -m "feat(engine): Gen-3-style pixel-art grids (tiles, chibi chars, encounter sprites)"
```

---

### Task 3: Encounter state machine in GameSession

**Files:**
- Modify: `packages/engine/src/state/session.ts`
- Test: `packages/engine/src/state/session.test.ts` (append new describe blocks)

**Interfaces:**
- Consumes: `resolvePlacement(world, node, locationId)` from `./placement` (already exists; returns `{ npcIds, factSpotIds, doorTargets }`).
- Produces (exact API used by Tasks 6, 8, 9, 11):

```ts
export type SessionMode = "roaming" | "encounter" | "decision" | "debrief";
export interface EncounterTopic { factId: string; label: string; asked: boolean; }
export interface EncounterView {
  actorId: string; name: string; role: string; greeting?: string;
  topics: EncounterTopic[]; chainIndex: number; chainLength: number;
}
// methods on GameSession:
mode(): SessionMode
maybeStartChain(): EncounterView | null
startEncounterWith(actorId: string): EncounterView
encounterState(): EncounterView | null
encounterAsk(factId: string): { line: string }
encounterMoveOn(): { next: EncounterView | null }
pollDecisionPrompt(): boolean            // true exactly once, when first decision becomes unlocked
startDecision(decisionId: string): void
cancelDecision(): void
```

Semantics (from the spec):
- Private state: `internalMode: "roaming" | "encounter" | "decision" = "roaming"`, `chain: string[] = []`, `chainIdx = 0`, `visited = new Set<string>()` (keys `${nodeId}:${locationId}`), `decisionPrompted = false`.
- `mode()`: `isEnded() ? "debrief" : internalMode`.
- `maybeStartChain()`: only in `roaming`; no-op (null) if the `${nodeId}:${locationId}` key was visited; marks visited either way; queues `resolvePlacement(...).npcIds`; empty queue → null; else `internalMode = "encounter"`.
- Topics for the active actor: `actor.knowledge` filtered to `currentNode().available_facts`, mapped to `{ factId, label: fact.label, asked: this.gathered.has(factId) }` (asked == gathered — no extra bookkeeping).
- `encounterAsk(factId)`: throws unless in `encounter` mode and `factId` is an unasked topic of the active actor; gathers the fact; returns the topic `line` (fallback `` `${fact.label}: ${fact.content}` `` as in `gatherFactsFromActor`).
- `encounterMoveOn()`: throws unless in `encounter`; advances `chainIdx`; past the end → `internalMode = "roaming"`, `next: null`.
- `pollDecisionPrompt()`: returns true iff the first live decision is unlocked and `decisionPrompted` is false, then sets it — callable from any mode; App calls it whenever play returns to roaming.
- `startEncounterWith(actorId)`: throws unless `roaming` and the actor is placed in the current location; single-actor chain; does NOT touch `visited`.
- `startDecision(id)`: throws unless `roaming` + decision live + unlocked; `cancelDecision()` returns to roaming.
- `chooseOption(...)` (existing): additionally requires `internalMode === "decision"` and on `endedAt: "node"` resets `internalMode = "roaming"`, clears `visited`, and resets `decisionPrompted` (new scenario = new chains).
- Constructor: unchanged (the boot chain is triggered by App calling `maybeStartChain()`).

- [ ] **Step 1: Write the failing tests** (append to `session.test.ts`)

```ts
describe("GameSession — encounter machine", () => {
  it("boots roaming; maybeStartChain queues the start room's agents once", () => {
    const s = newSession();
    expect(s.mode()).toBe("roaming");
    const v = s.maybeStartChain();
    expect(s.mode()).toBe("encounter");
    expect(v?.actorId).toBe("roaster");
    expect(v?.chainLength).toBe(2); // roaster + buyer live on roastery_floor
    expect(v?.topics).toEqual([{ factId: "fact_capacity", label: expect.any(String), asked: false }]);
  });
  it("maybeStartChain is null on revisit and in non-roaming modes", () => {
    const s = newSession();
    s.maybeStartChain();
    expect(s.maybeStartChain()).toBeNull(); // already in encounter
    while (s.encounterMoveOn().next) { /* drain chain */ }
    expect(s.mode()).toBe("roaming");
    expect(s.maybeStartChain()).toBeNull(); // visited
  });
  it("encounterAsk reveals the line, gathers the fact, and marks the topic asked", () => {
    const s = newSession();
    s.maybeStartChain();
    const { line } = s.encounterAsk("fact_capacity");
    expect(line).toContain("500");
    expect(s.isFactGathered("fact_capacity")).toBe(true);
    expect(s.encounterState()?.topics[0].asked).toBe(true);
    expect(() => s.encounterAsk("fact_capacity")).toThrow(); // already asked
    expect(() => s.encounterAsk("fact_cash")).toThrow();     // not this actor's topic
  });
  it("moveOn advances the chain then returns to roaming", () => {
    const s = newSession();
    s.maybeStartChain();
    const step = s.encounterMoveOn();
    expect(step.next?.actorId).toBe("buyer");
    expect(s.encounterMoveOn().next).toBeNull();
    expect(s.mode()).toBe("roaming");
  });
  it("walk-up re-open works after the chain and reuses asked state", () => {
    const s = newSession();
    s.maybeStartChain();
    s.encounterAsk("fact_capacity");
    s.encounterMoveOn(); s.encounterMoveOn();
    const v = s.startEncounterWith("roaster");
    expect(v.chainLength).toBe(1);
    expect(v.topics[0].asked).toBe(true);
    expect(() => s.startEncounterWith("bookkeeper")).toThrow(); // other room
  });
  it("pollDecisionPrompt fires exactly once when the last fact lands", () => {
    const s = newSession();
    s.maybeStartChain();
    s.encounterAsk("fact_capacity");
    s.encounterMoveOn(); // buyer
    s.encounterAsk("fact_contract");
    s.encounterMoveOn();
    expect(s.pollDecisionPrompt()).toBe(false); // 2/3 facts
    s.moveTo("back_office");
    const v = s.maybeStartChain();
    expect(v?.actorId).toBe("bookkeeper");
    s.encounterAsk("fact_cash");
    s.encounterMoveOn();
    expect(s.pollDecisionPrompt()).toBe(true);
    expect(s.pollDecisionPrompt()).toBe(false); // once only
  });
  it("decision flow: start requires unlock, cancel returns to roaming, choose ends", () => {
    const s = newSession();
    expect(() => s.startDecision("decide_contract")).toThrow(); // locked
    s.maybeStartChain(); s.encounterAsk("fact_capacity"); s.encounterMoveOn();
    s.encounterAsk("fact_contract"); s.encounterMoveOn();
    s.moveTo("back_office"); s.maybeStartChain(); s.encounterAsk("fact_cash"); s.encounterMoveOn();
    s.startDecision("decide_contract");
    expect(s.mode()).toBe("decision");
    s.cancelDecision();
    expect(s.mode()).toBe("roaming");
    s.startDecision("decide_contract");
    expect(s.chooseOption("decide_contract", "decline", "capacity first").endedAt).toBe("ending");
    expect(s.mode()).toBe("debrief");
  });
  it("chooseOption throws outside decision mode; encounter calls throw while roaming", () => {
    const s = newSession();
    expect(() => s.encounterAsk("fact_capacity")).toThrow();
    expect(() => s.encounterMoveOn()).toThrow();
    gatherAll(s); // legacy helper still gathers facts directly
    expect(() => s.chooseOption("decide_contract", "decline", "r")).toThrow(/decision/);
  });
});
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `pnpm -C packages/engine test -- session`
Expected: FAIL — `s.mode is not a function` (existing 17 tests still pass)

- [ ] **Step 3: Implement the machine in `session.ts`** exactly per the Interfaces block above. Import `resolvePlacement` from `./placement`. Add the guard to `chooseOption` (`if (this.internalMode !== "decision") throw new Error("no decision in progress")`) *after* `assertActive()`, and the roaming/visited/prompt reset on `endedAt: "node"`. Keep `gatherFactsFromActor`/`gatherFactFromLocation` unchanged (legacy API used by tests and field pickups).

  **Legacy-test migration (required):** existing describe blocks call `chooseOption` directly after `gatherAll(s)`; the new guard breaks them. Update every legacy `chooseOption` call site in `session.test.ts` to call `s.startDecision("decide_contract")` first (after facts are gathered). Do not weaken the guard to avoid this.

- [ ] **Step 4: Run tests to verify everything passes**

Run: `pnpm -C packages/engine test -- session`
Expected: PASS (17 legacy + 8 new)

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/state/session.ts packages/engine/src/state/session.test.ts
git commit -m "feat(engine): encounter state machine (chain, ask, move-on, decision modes)"
```

---

### Task 4: Rasterizer + Phaser texture/scale rework

**Files:**
- Create: `packages/engine/src/art/canvas.ts`
- Modify: `packages/engine/src/phaser/textures.ts` (rewrite to consume grids)
- Modify: `packages/engine/src/phaser/templates.ts` (`TILE_SIZE = 16`)
- Create: `packages/engine/src/ui/pixel/scale.ts`
- Modify: `packages/engine/src/phaser/game.ts` (240×160 + integer zoom)

**Interfaces:**
- Consumes: `PixelGrid`, `tileGrid`, `charGrid`, `bigGrid`, `NPC_PALETTES` (Task 2).
- Produces:
  - `gridToCanvas(g: PixelGrid): HTMLCanvasElement` and `gridToDataURL(g: PixelGrid): string` in `art/canvas.ts`.
  - `generatePlaceholderTextures(scene)` keeps its name/signature but now registers: `tile-floor`, `tile-wall`, `tile-door`, `tile-desk`, `sprite-player`, and `sprite-npc-0`…`sprite-npc-3` (16×24 via `charGrid("npc", i)`), using `scene.textures.addCanvas(key, gridToCanvas(...))`.
  - `zoom(): number` in `ui/pixel/scale.ts`: `Math.max(2, Math.min(Math.floor(window.innerWidth / 240), Math.floor(window.innerHeight / 160)))`, memoized once; also sets `--px` on `document.documentElement`.
  - `createGame` config becomes: `width: 240, height: 160, backgroundColor: UI.void, pixelArt: true, roundPixels: true, scale: { mode: Phaser.Scale.NONE, zoom: zoom() }`; **remove the arcade physics config** (Task 5 removes its use).

- [ ] **Step 1: Implement all five files.** `canvas.ts`:

```ts
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
```

- [ ] **Step 2: Verify suite + typecheck stay green** (templates test exists; TILE_SIZE change must not break placement tests)

Run: `pnpm -C packages/engine test && pnpm -C packages/engine typecheck`
Expected: PASS. If a template/bridge test hardcodes 32, update it to `TILE_SIZE`.

- [ ] **Step 3: Commit**

```bash
git add packages/engine/src/art packages/engine/src/phaser packages/engine/src/ui/pixel/scale.ts
git commit -m "feat(engine): grid rasterizer, Gen-3 textures, 240x160 canvas with integer zoom"
```

---

### Task 5: Grid movement + locked camera in WorldScene

**Files:**
- Modify: `packages/engine/src/phaser/WorldScene.ts` (rewrite movement/interaction)

**Interfaces:**
- Consumes: templates (`getTemplate`, `TILE`, `TILE_SIZE`), textures (Task 4), `resolvePlacement`, EventBus.
- Produces (used by Tasks 6 and 11):
  - Emits **unchanged** events: `interact:actor`, `interact:fact`, `location:changed`; handles `scene:render` as today.
  - Listens for new bus event `world:freeze` `{ frozen: boolean }` — when frozen: ignore all input in `update()`.
  - Dev helper kept: `getPlayerPos()`; new dev helper `getPlayerTile(): { tx: number; ty: number } | null`.

Implementation rules:
- Drop arcade physics entirely (no `physics.add`, no `walls` group; delete the collider). Player becomes `this.add.sprite`.
- Track `tx/ty` tile coords; spawn at `tpl.playerSpawn`. Sprite origin `(0.5, 0.75)` so the 16×24 body's feet sit on the tile; position = `(tx*16+8, ty*16+12)`.
- `update()`: if frozen or a move tween is active, return. Read cursors → direction; compute target tile; blocked if outside the template or tile is `TILE.WALL`/`TILE.DESK`, or an NPC occupies it; blocked → face only. Otherwise tween to the target tile over 220ms (`this.tweens.add`), clearing the moving flag on complete.
- Interact (Space, `JustDown`): look up the interactable on the **facing tile** (store interactables with `tx/ty` now). Door → `session.moveTo(target)` + `bus.emit("scene:render", {})` + `bus.emit("location:changed", { locationId: target })` (move `location:changed` emission out of `renderLocation` if it is there — exactly one emission per door use, none on re-render).
- NPCs render with `sprite-npc-${i % 4}`; drop the floating text labels (Gen-3 has none; names appear in encounters).
- Camera: `this.cameras.main.startFollow(this.player, true)`; no bounds (void shows at edges).
- Keep `window.__cqScene` dev hook.

- [ ] **Step 1: Rewrite the scene per the rules above.**
- [ ] **Step 2: Verify** `pnpm -C packages/engine test && pnpm -C packages/engine typecheck` — PASS (scene has no unit tests; e2e covers it in Task 11).
- [ ] **Step 3: Smoke-run** `pnpm -C packages/engine dev`, load `http://localhost:5173`, confirm in the browser console that `__cqScene.getPlayerTile()` changes with arrow keys. (Use the Task 11 driver early if no display is available: `node packages/engine/scripts/e2e-drive.mjs --smoke` after Task 11; otherwise defer.)
- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/phaser/WorldScene.ts
git commit -m "feat(engine): grid-committed movement, facing-tile interaction, locked camera"
```

---

### Task 6: Event payloads + App orchestration for modes

**Files:**
- Modify: `packages/engine/src/bridge/events.ts` (add `world:freeze`)
- Modify: `packages/engine/src/App.tsx` (full rewrite of the overlay orchestration)
- Delete: `packages/engine/src/ui/Hud.tsx`, `packages/engine/src/ui/DialogueBox.tsx` usages from App (files removed in Task 9 cleanup)

**Interfaces:**
- Consumes: session machine (Task 3), `zoom()` (Task 4), pixel components (Tasks 7–9 — until they exist, App may not compile; **execute Tasks 6–9 as one commit series in order, committing at Task 9**; typecheck gates the combined commit).
- Produces: the mode-driven React tree and the orchestration callbacks the components receive (exact props in Tasks 7–9). App-level state:

```ts
type Overlay =
  | { kind: "none" }
  | { kind: "transition"; view: EncounterView }        // band sweeping
  | { kind: "encounter"; view: EncounterView }
  | { kind: "fieldMsg"; text: string; then?: () => void }
  | { kind: "decisionPrompt" }                          // YES/NO box
  | { kind: "decision" }
  | { kind: "debrief"; data: DebriefData };
```

Orchestration rules:
- Boot: after `createGame`, show `LocationBanner`, then after 1200ms call `session.maybeStartChain()`; a non-null view → freeze (`bus.emit("world:freeze", { frozen: true })` + add `.cq-frozen` class to the stage div) → `{ kind: "transition", view }`; `TransitionBand.onDone` → `{ kind: "encounter", view }`.
- `location:changed` → same banner + chain sequence.
- `interact:actor` → `session.startEncounterWith(actorId)` → freeze → transition → encounter.
- `interact:fact` → `session.gatherFactFromLocation(factId)` → `{ kind: "fieldMsg", text: \`${session.protagonist().name.toUpperCase()} found ${label}!\` }` → on dismiss, unlock check (below).
- Encounter `onMoveOn`: `session.encounterMoveOn()`; `next` → new intro beats in-place (`{ kind: "encounter", view: next }` with re-run intro); `null` → thaw (unfreeze both), then unlock check.
- Unlock check (single helper): `if (session.pollDecisionPrompt()) setOverlay({ kind: "decisionPrompt" })`.
- decisionPrompt YES → `session.startDecision(d.id)` → `{ kind: "decision" }`; NO → `{ kind: "fieldMsg", text: "Press ENTER when you are ready to decide." }`.
- Global keydown: Enter while roaming + first decision unlocked → `startDecision` (guard `session.mode() === "roaming"`).
- Decision commit → `session.chooseOption(...)`; `endedAt: "ending"` → `{ kind: "debrief", data: session.debrief()! }`; `"node"` → thaw + banner for the new location.
- Stage layout: one `div.stage` of exactly `240*zoom() × 160*zoom()` px, centered; canvas parent and every overlay live inside it. Dev hook: `window.__cqSession = session`.
- The old `<Hud/>`, `<DialogueBox/>`, `<DecisionScene/>`, `<Debrief/>` render paths are deleted.

- [ ] **Step 1: Add `"world:freeze": { frozen: boolean }` to `EnginePayloads`.**
- [ ] **Step 2: Rewrite App.tsx** to the state machine above (components imported from `./ui/pixel/` per Tasks 7–9).
- [ ] **Step 3: continue to Task 7** (combined commit at Task 9).

---

### Task 7: Pixel UI kit (theme, typewriter, boxes, banner, band)

**Files:**
- Create: `packages/engine/src/ui/pixel/theme.css`
- Create: `packages/engine/src/ui/pixel/palette.ts` (the `UI` const from Global Constraints)
- Create: `packages/engine/src/ui/pixel/Typewriter.tsx`
- Create: `packages/engine/src/ui/pixel/MessageBox.tsx`
- Create: `packages/engine/src/ui/pixel/ChoiceBox.tsx`
- Create: `packages/engine/src/ui/pixel/LocationBanner.tsx`
- Create: `packages/engine/src/ui/pixel/TransitionBand.tsx`
- Modify: `packages/engine/src/main.tsx` (import `./ui/pixel/theme.css`)

**Interfaces (exact props consumed by Tasks 6, 8, 9):**

```ts
// Typewriter: types pages out; Space/Enter/click advances; fires onDone after last page.
<Typewriter text={string} cols={30} lines={2} speed={35} onDone={() => void} skin={"field" | "battle"} />
// MessageBox: static container with the skin borders; Typewriter renders inside it.
<MessageBox skin={"field" | "battle"}>{children}</MessageBox>
// ChoiceBox: vertical options, triangle cursor, arrows+Space & mouse; Esc = onCancel (optional).
<ChoiceBox options={{ id: string; label: string; disabled?: boolean }[]} onPick={(id) => void} onCancel={() => void | undefined} />
// LocationBanner: wood plaque top-left; auto-dismisses after 2500ms.
<LocationBanner title={string} onDone={() => void} />
// TransitionBand: freeze-flavored sweep carrying spriteUrl; ~900ms; then onDone.
<TransitionBand spriteUrl={string} onDone={() => void} />
```

Styling rules (theme.css): everything sized with `calc(var(--px) * N)`; `image-rendering: pixelated` on all `img.cq-sprite`; field skin = `UI.fieldBoxFill` fill + 2-ring teal border (outer `fieldBoxBorderOuter` 2px·px, inner `fieldBoxBorderInner` 1px·px) + border-radius 4px·px; battle skin = `battleBoxFill` + 3px·px `battleBoxBorder` ring inside 1px·px `battleBoxBorderDark`; message boxes are absolutely positioned bottom, width `calc(var(--px) * 232)`, height `calc(var(--px) * 40)`; text uses the pixel font stack `"Press Start 2P", "Courier New", monospace` at `calc(var(--px) * 6)` font-size for field text and `calc(var(--px) * 7)` for battle text with `text-shadow: calc(var(--px)*1px) calc(var(--px)*1px) UI.battleTextShadow`. Advance glyph: inline `▼`-shaped CSS triangle in `UI.advanceGlyph`, 500ms blink keyframe. Banner: wood gradient (`repeating-linear-gradient` plank lines in `bannerWood`/`bannerWoodDark`), slide-in from left 300ms. Band: full-stage-height 33% strip, `#a8d8f0` fill, `repeating-linear-gradient(90deg, rgba(255,255,255,.9) 0 8px, transparent 8px 28px)` streaks, translateX sweep keyframe 900ms carrying the sprite `<img>`; `.cq-frozen canvas { filter: grayscale(0.75); }`.

Keyboard handling: `Typewriter` and `ChoiceBox` attach `window` keydown listeners while mounted; they must `stopPropagation`-guard so only the top overlay reacts — App mounts exactly one interactive overlay at a time (its `Overlay` union guarantees this).

The pixel font: download once during this task —
`curl -fsSL -o packages/engine/public/fonts/PressStart2P.woff2 https://github.com/google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf` converted is unnecessary; instead reference the TTF directly via `@font-face { font-family: "Press Start 2P"; src: url("/fonts/PressStart2P-Regular.ttf"); }` and also commit `OFL.txt` from the same directory. **If the download fails (offline), skip the file and keep the monospace fallback — do not block the task.**

- [ ] **Step 1: Implement all components + css.** Typewriter core:

```tsx
// packages/engine/src/ui/pixel/Typewriter.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { paginate } from "./paginate";

export function Typewriter({ text, cols = 30, lines = 2, speed = 35, onDone, skin = "field" }: {
  text: string; cols?: number; lines?: number; speed?: number; onDone?: () => void; skin?: "field" | "battle";
}) {
  const pages = useMemo(() => paginate(text, cols, lines), [text, cols, lines]);
  const [page, setPage] = useState(0);
  const [chars, setChars] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const full = pages[page].join("\n");
  const typed = chars >= full.length;

  useEffect(() => { setPage(0); setChars(0); }, [text]);
  useEffect(() => {
    if (typed) return;
    const t = setInterval(() => setChars((c) => c + 1), 1000 / speed);
    return () => clearInterval(t);
  }, [typed, speed, page, text]);

  useEffect(() => {
    const advance = () => {
      if (!typed) { setChars(full.length); return; }       // skip to full page
      if (page + 1 < pages.length) { setPage(page + 1); setChars(0); }
      else doneRef.current?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); advance(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typed, page, pages.length, full.length]);

  return (
    <div className={`cq-typewriter cq-${skin}`} data-testid="typewriter">
      {full.slice(0, chars)}
      {typed && <span className="cq-advance" data-testid="advance-glyph" />}
    </div>
  );
}
```

`ChoiceBox` mirrors this pattern with an index cursor (`ArrowUp/ArrowDown`, wraps; Space/Enter picks; Escape cancels; `onMouseEnter` moves cursor, click picks; disabled options render at 40% opacity and are skipped by the cursor). `LocationBanner`/`TransitionBand` are presentational with a `setTimeout` for `onDone`. Every interactive component gets a `data-testid`: `choice-box`, `location-banner`, `transition-band`.

- [ ] **Step 2: continue to Task 8** (combined commit at Task 9).

---

### Task 8: EncounterScreen (diorama, info panels, action menu, topics, notes)

**Files:**
- Create: `packages/engine/src/ui/pixel/EncounterScreen.tsx`
- Create: `packages/engine/src/ui/pixel/InfoPanel.tsx`
- Create: `packages/engine/src/ui/pixel/ActionMenu.tsx`
- Create: `packages/engine/src/ui/pixel/TopicsPanel.tsx`
- Create: `packages/engine/src/ui/pixel/NotesPanel.tsx`

**Interfaces:**

```tsx
<EncounterScreen
  view={EncounterView}
  playerName={string}
  facts={{ got: number; needed: number; labels: string[] }}   // labels = gathered fact labels for NOTES
  agentSpriteUrl={string} playerBackUrl={string}
  onAsk={(factId: string) => { line: string }}                 // App wraps session.encounterAsk
  onMoveOn={() => void}
/>
```

Internal phase machine: `intro` (agent slides in right→platform 500ms; info panels pop; greeting or `"${NAME} wants to talk!"` types in battle skin) → `menu` (ActionMenu: ASK / NOTES / MOVE ON) → `topics` (TopicsPanel: move-grid of `view.topics`, asked ⇒ disabled; Esc back) → `revealing` (Typewriter with the returned line; onDone → back to `menu`) → NOTES opens `NotesPanel` (field-skin panel listing `facts.labels`, any key closes) → MOVE ON calls `onMoveOn` immediately.

Layout (logical px → multiply by `--px` in CSS): stage-filling absolute layer, background `UI.encounterBg` with a 24px-tall pinstripe band at top (`repeating-linear-gradient(0deg…)` in `UI.pinstripe`); enemy platform ellipse 88×20 centered at (168, 62) with the 48×48 agent sprite bottom-anchored on it; player platform ellipse 96×22 at (56, 130) with the 56×40 back sprite; agent info panel at (8, 8) 92×24 (`panelFill`/`panelBorder`, NAME + small role tag); player info panel at (140, 92) 92×32: name row, FACTS tag (`hpTag` colored) + bar (`hpBar` on `hpTrack`, width = got/needed), numeric `got/needed`, bottom `expBar` strip labeled CASE (width = got/needed too). Message box + menu occupy the bottom 40px: menu is a 72px-wide battle-skin sub-panel on the right of the message box when in `menu` phase (Gen-3 action-menu position). `data-testid`s: `encounter`, `action-menu`, `topics-panel`, `notes-panel`, `facts-bar`.

- [ ] **Step 1: Implement the five components** per the layout/phase specs. ActionMenu reuses ChoiceBox internals (extract a shared `useCursor(options)` hook inside `ChoiceBox.tsx` and import it — do not duplicate the key handling).
- [ ] **Step 2: continue to Task 9** (combined commit at Task 9).

---

### Task 9: Decision boss encounter + debrief pages + legacy UI removal

**Files:**
- Create: `packages/engine/src/ui/pixel/DecisionEncounter.tsx`
- Create: `packages/engine/src/ui/pixel/ReasoningPanel.tsx`
- Create: `packages/engine/src/ui/pixel/DebriefPages.tsx`
- Delete: `packages/engine/src/ui/Hud.tsx`, `packages/engine/src/ui/DialogueBox.tsx`, `packages/engine/src/ui/DecisionScene.tsx`, `packages/engine/src/ui/Debrief.tsx`

**Interfaces:**

```tsx
<DecisionEncounter
  prompt={string}
  options={{ id: string; label: string }[]}
  onCommit={(optionId: string, reasoning: string) => void}
  onCancel={() => void}          // Esc before commit → session.cancelDecision()
/>
// phases: prompt types out (battle skin, "THE DECISION" in the enemy info panel slot)
// → options ChoiceBox → confirm ChoiceBox (YES/NO: "Commit to this?") → ReasoningPanel → onCommit

<ReasoningPanel onSubmit={(reasoning: string) => void} />
// field-skin panel with a real <textarea> (pixel-styled, autofocus); Enter (without Shift) submits
// when non-empty; the textarea stops propagation so global key handlers don't fire.

<DebriefPages data={DebriefData} />
// battle-skin Typewriter pages in order: ending title → summary → "What actually happened:" +
// real_case_comparison → per choice: prompt + "You chose: LABEL" + reasoning → per objective:
// text + verdict → final static field-skin panel: ending title + "THE END".
// data-testid: debrief
```

Reuse the EncounterScreen diorama for DecisionEncounter with the agent slot empty (platform only) and enemy info panel text "THE DECISION".

- [ ] **Step 1: Implement the three components; delete the four legacy files.**
- [ ] **Step 2: Full gate for Tasks 6–9**

Run: `pnpm -C packages/engine test && pnpm -C packages/engine typecheck && pnpm -C packages/engine build`
Expected: all PASS; build emits without warnings about missing imports.

- [ ] **Step 3: Commit (Tasks 6–9 series)**

```bash
git add packages/engine/src
git commit -m "feat(engine): Pokémon-style presentation — mode orchestration, pixel UI kit, encounter/decision/debrief screens"
```

---

### Task 10: Field pickups + banner/freeze polish pass

**Files:**
- Modify: `packages/engine/src/App.tsx` (fieldMsg for `interact:fact`, decisionPrompt ChoiceBox wiring, Enter shortcut)
- Modify: `packages/engine/src/ui/pixel/theme.css` (any spacing fixes found while smoke-testing)

This task exists because Tasks 6–9 land the structure; this one plays the game and fixes integration seams (overlay z-order, key-event double-firing, banner overlapping the band, frozen-class lingering after thaw). It has no new interfaces.

- [ ] **Step 1: Smoke-play** with `pnpm -C packages/engine dev` (or the Task 11 driver's `--smoke` mode): boot chain triggers with banner→band→encounter; ASK/NOTES/MOVE ON all work by keyboard and mouse; fact pickup shows the field message; the YES/NO prompt appears exactly once; Esc cancels the decision; Enter reopens it.
- [ ] **Step 2: Fix every seam found; re-run** `pnpm -C packages/engine test && pnpm -C packages/engine typecheck`.
- [ ] **Step 3: Commit**

```bash
git add packages/engine/src
git commit -m "fix(engine): integration polish for encounter flow (overlay order, input focus, freeze/thaw)"
```

---

### Task 11: E2E driver + full playthrough verification

**Files:**
- Create: `packages/engine/scripts/e2e-drive.mjs`
- Modify: `packages/engine/package.json` (add `"playwright-core": "^1.45.0"` to devDependencies; script `"e2e": "node scripts/e2e-drive.mjs"`)
- Modify: `packages/engine/README.md` (controls + e2e section)

**Interfaces:**
- Consumes: dev hooks `window.__cqScene` (`getPlayerTile()`), `window.__cqSession` (`mode()`), and the `data-testid`s from Tasks 7–9.
- Produces: `pnpm -C packages/engine e2e` → plays the entire case and writes screenshots to `packages/engine/e2e-shots/` (gitignored).

Driver requirements (port the proven M2 techniques — these are hard-won):
- Launch `chromium.launch({ channel: "chrome", headless: true })`; viewport ≥ 960×640.
- **Never use `keyboard.press()` for game keys** — Phaser drops instant down/up pairs. Always `keyboard.down(k)` → `waitForTimeout(120–150)` → `keyboard.up(k)`.
- Wait for boot via `page.waitForFunction(() => window.__cqScene && window.__cqSession)`.
- Sequence: boot → banner screenshot → wait `[data-testid=encounter]` (auto chain) → for each agent: ASK → each topic → advance typewriter pages with held Space → MOVE ON → back in roaming, walk to the door with held arrow keys using `getPlayerTile()` deltas (grid: one held-250ms press ≈ one tile) → Space → office chain → after last fact the YES/NO prompt appears → pick YES → decision: cursor to "Decline the contract, for now" → confirm YES → `page.fill` the reasoning textarea → Enter → advance debrief pages → final screenshot → assert `window.__cqSession.mode() === "debrief"` and `console --errors` style check (`page.on("pageerror")` buffer empty).
- `--smoke` flag: stop after the first encounter screenshot (used by earlier tasks).
- Exit non-zero on any failed wait so it can gate CI later.

- [ ] **Step 1: Write the driver; add the devDependency** (`pnpm -C packages/engine add -D playwright-core`).
- [ ] **Step 2: Run the full e2e** with the dev server up:

```bash
pnpm -C packages/schema build && (pnpm -C packages/engine dev &) && sleep 3
pnpm -C packages/engine e2e
```

Expected: `PLAYTHROUGH COMPLETE — mode=debrief, 0 page errors` and ~10 screenshots in `packages/engine/e2e-shots/`. **Read the screenshots** — verify diorama layout matches the grammar (platforms, panels, message box skins).

- [ ] **Step 3: Fix anything the screenshots reveal; re-run until clean.**
- [ ] **Step 4: Update README (controls: arrows/Space/Esc/Enter; e2e usage), add `e2e-shots/` to `.gitignore`.**
- [ ] **Step 5: Final gate + commit**

```bash
pnpm -C packages/engine test && pnpm -C packages/engine typecheck && pnpm -C packages/engine build
git add packages/engine
git commit -m "feat(engine): e2e playthrough driver + M3 verification"
```
