# Case Quest — Engine MVP (Milestone 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@case-quest/engine` — a Vite + React + Phaser 3 web client that loads a validated `world.json` and renders it as a playable top-down game, proven end-to-end on the toy world.

**Architecture:** A pure, deterministic `GameSession` state core (no Phaser/React, fully unit-tested) drives everything. Phaser renders the current location from per-`LocationType` templates and emits input events over a typed bridge; React renders the HUD/dialogue/decision/debrief overlay. The app loads `world.json`, validates it with `@case-quest/schema`, then plays.

**Tech Stack:** TypeScript, Vite, React 18, Phaser 3, Vitest, `@case-quest/schema` (workspace).

## Global Constraints

- Node.js >= 20; package manager **pnpm**; TypeScript ^5.5; **Phaser ^3.90**; **React ^18.3**; **Vite ^5**; Vitest for tests.
- The engine depends on the workspace package **`@case-quest/schema`** (`workspace:*`); it must be built (`pnpm -C packages/schema build`) so its `dist/` resolves.
- **The `state/` core imports ONLY `@case-quest/schema` types — never Phaser or React.** It is synchronous and deterministic.
- The engine **only plays worlds that pass `validateWorld`**; on validation failure it renders the errors instead of the game (fail loud).
- **Art is original, code-generated placeholder only** (Phaser `generateTexture`) — no external image assets. Describe the style only as "classic top-down RPG"; never Pokémon, ripped tilesets, names, or trademarked motifs.
- The toy world ships at `packages/engine/public/worlds/wholesale-offer.world.json`, copied verbatim from `packages/schema/fixtures/wholesale-offer.world.json`.
- Source of truth for the design: `docs/superpowers/specs/2026-07-06-case-quest-engine-mvp-design.md` (§4 GameSession API, §5.3 placement rules).

---

## File Structure

```
packages/engine/
  package.json          @case-quest/engine (private)
  vite.config.ts        React plugin + Vitest config
  tsconfig.json
  index.html
  public/worlds/wholesale-offer.world.json   (copied from schema fixtures)
  src/
    main.tsx            React root
    App.tsx             load+validate world, construct GameSession, mount Phaser + overlay
    state/
      session.ts        GameSession + DebriefData/ChoiceRecord types (pure)
      session.test.ts   unit tests (Vitest)
      placement.ts      resolvePlacement + homeLocationForActor (pure)
      placement.test.ts unit tests
    bridge/
      events.ts         EventBus typed emitter
      events.test.ts    unit tests
    phaser/
      templates.ts      getTemplate(locationType) -> RoomTemplate (pure data + lookup)
      templates.test.ts unit tests
      textures.ts       generatePlaceholderTextures(scene) (render-only)
      WorldScene.ts     the Phaser scene (render-only)
      game.ts           createGame(parent, session, bus)
    ui/
      Hud.tsx  DialogueBox.tsx  DecisionScene.tsx  Debrief.tsx
  README.md
```

Testable/pure units (state, placement, bridge, templates) are TDD'd. Render units (textures, WorldScene, game, ui, App) are implemented and verified by launching the app (Task 10).

---

## Task 1: Scaffold the engine package

**Files:**
- Create: `packages/engine/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `public/worlds/wholesale-offer.world.json`, `src/smoke.test.ts`

**Interfaces:**
- Consumes: `@case-quest/schema` (built).
- Produces: a runnable Vite app + Vitest wired; `pnpm -C packages/engine test`, `typecheck`, `build` all work.

- [ ] **Step 1: Ensure the schema package is built**

Run: `pnpm -C packages/schema build`
Expected: `packages/schema/dist/index.js` exists.

- [ ] **Step 2: Create the package manifest**

`packages/engine/package.json`:
```json
{
  "name": "@case-quest/engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@case-quest/schema": "workspace:*",
    "phaser": "^3.90.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 3: Create Vite + Vitest config**

`packages/engine/vite.config.ts`:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create tsconfig**

`packages/engine/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create the HTML entry and React root**

`packages/engine/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Case Quest</title>
    <style>
      html, body, #root { margin: 0; height: 100%; background: #10131a; color: #e6e6e6; font-family: system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/engine/src/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`packages/engine/src/App.tsx` (placeholder for now; wired in Task 9):
```tsx
export function App() {
  return <div style={{ padding: 24 }}>Case Quest — engine booting…</div>;
}
```

- [ ] **Step 6: Copy the toy world into public**

Run: `mkdir -p packages/engine/public/worlds && cp packages/schema/fixtures/wholesale-offer.world.json packages/engine/public/worlds/wholesale-offer.world.json`
Expected: the file exists under `packages/engine/public/worlds/`.

- [ ] **Step 7: Write a smoke test**

`packages/engine/src/smoke.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateWorld } from "@case-quest/schema";
import toy from "../public/worlds/wholesale-offer.world.json";

describe("engine can consume the schema package", () => {
  it("the bundled toy world validates clean", () => {
    const r = validateWorld(toy);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
```

- [ ] **Step 8: Install, test, typecheck, build**

Run: `pnpm install`
Run: `pnpm -C packages/engine test`
Expected: 1 test passes.
Run: `pnpm -C packages/engine typecheck`
Expected: no errors.
Run: `pnpm -C packages/engine build`
Expected: Vite build succeeds (dist/ emitted).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore(engine): scaffold @case-quest/engine (Vite + React + Phaser + Vitest)"
```

---

## Task 2: GameSession — construction + read API

**Files:**
- Create: `packages/engine/src/state/session.ts`
- Create: `packages/engine/src/state/session.test.ts`

**Interfaces:**
- Consumes: `World, StoryNode, Location, Actor, Decision, LearningObjective, Ending` from `@case-quest/schema`.
- Produces: `class GameSession` with the read API below; types `DebriefData`, `ChoiceRecord`. Later tasks add mutating/terminal methods to this same class.

- [ ] **Step 1: Write the failing test**

`packages/engine/src/state/session.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { WorldSchema, type World } from "@case-quest/schema";
import toyJson from "../../public/worlds/wholesale-offer.world.json";
import { GameSession } from "./session";

function newSession(): GameSession {
  const world: World = WorldSchema.parse(toyJson);
  return new GameSession(world);
}

describe("GameSession — read API", () => {
  it("starts at the start node and its first accessible location", () => {
    const s = newSession();
    expect(s.currentNode().id).toBe("node_the_offer");
    expect(s.currentLocationId()).toBe("roastery_floor");
  });
  it("exposes present NPCs (never the protagonist)", () => {
    const ids = newSession().presentActors().map((a) => a.id).sort();
    expect(ids).toEqual(["bookkeeper", "buyer", "roaster"]);
  });
  it("protagonist() returns the playable protagonist", () => {
    expect(newSession().protagonist().id).toBe("owner");
  });
  it("no facts gathered at start; decision locked", () => {
    const s = newSession();
    expect(s.gatheredFactIds()).toEqual([]);
    expect(s.isDecisionUnlocked("decide_contract")).toBe(false);
  });
  it("objective reports 0 of 3 facts", () => {
    expect(newSession().objective()).toEqual({ nodeTitle: "The Offer on the Table", needed: 3, got: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/engine test session`
Expected: FAIL — cannot find `./session`.

- [ ] **Step 3: Implement the read API**

`packages/engine/src/state/session.ts`:
```typescript
import type {
  World, StoryNode, Location, Actor, Decision, LearningObjective, Ending,
} from "@case-quest/schema";

export interface ChoiceRecord { decisionId: string; optionId: string; reasoning: string; }
export interface DebriefData {
  ending: Ending;
  objectives: { objective: LearningObjective; verdict: string }[];
  choices: { prompt: string; chosenLabel: string; reasoning: string }[];
}

export class GameSession {
  private readonly world: World;
  private readonly nodesById: Map<string, StoryNode>;
  private readonly endingsById: Map<string, Ending>;
  private readonly locationsById: Map<string, Location>;
  private readonly actorsById: Map<string, Actor>;
  private readonly decisionsById: Map<string, Decision>;
  private readonly loById: Map<string, LearningObjective>;

  private currentNodeId: string;
  private locationId: string;
  private readonly gathered = new Set<string>();
  private readonly choices: ChoiceRecord[] = [];
  private endingId: string | null = null;

  constructor(world: World) {
    this.world = world;
    this.nodesById = new Map(world.nodes.map((n) => [n.id, n]));
    this.endingsById = new Map(world.endings.map((e) => [e.id, e]));
    this.locationsById = new Map(world.locations.map((l) => [l.id, l]));
    this.actorsById = new Map(world.actors.map((a) => [a.id, a]));
    this.decisionsById = new Map(world.decisions.map((d) => [d.id, d]));
    this.loById = new Map(world.learning_objectives.map((o) => [o.id, o]));
    this.currentNodeId = world.meta.start_node_id;
    this.locationId = this.currentNode().accessible_locations[0];
  }

  currentNode(): StoryNode {
    const n = this.nodesById.get(this.currentNodeId);
    if (!n) throw new Error(`unknown node ${this.currentNodeId}`);
    return n;
  }
  currentLocationId(): string { return this.locationId; }
  accessibleLocations(): Location[] {
    return this.currentNode().accessible_locations.map((id) => this.locationsById.get(id)!).filter(Boolean);
  }
  presentActors(): Actor[] {
    return this.currentNode().present_actors.map((id) => this.actorsById.get(id)!).filter(Boolean);
  }
  protagonist(): Actor {
    return this.actorsById.get(this.world.meta.protagonist_actor_id)!;
  }
  gatheredFactIds(): string[] { return [...this.gathered]; }
  isFactGathered(factId: string): boolean { return this.gathered.has(factId); }
  liveDecisions(): Decision[] {
    return this.currentNode().live_decisions.map((id) => this.decisionsById.get(id)!).filter(Boolean);
  }
  isDecisionUnlocked(decisionId: string): boolean {
    const d = this.decisionsById.get(decisionId);
    if (!d) return false;
    return d.requires_facts.every((f) => this.gathered.has(f));
  }
  objective(): { nodeTitle: string; needed: number; got: number } {
    const node = this.currentNode();
    const d = this.liveDecisions()[0];
    const needed = d ? d.requires_facts.length : 0;
    const got = d ? d.requires_facts.filter((f) => this.gathered.has(f)).length : 0;
    return { nodeTitle: node.title, needed, got };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/engine test session`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): GameSession read API (nodes, actors, facts, objective)"
```

---

## Task 3: GameSession — movement + fact gathering

**Files:**
- Modify: `packages/engine/src/state/session.ts`
- Modify: `packages/engine/src/state/session.test.ts`

**Interfaces:**
- Consumes: the GameSession from Task 2.
- Produces: `moveTo(locationId)`, `gatherFactsFromActor(actorId): { greeting?: string; revealed: { factId: string; line: string }[] }`, `gatherFactFromLocation(factId)`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/src/state/session.test.ts`:
```typescript
describe("GameSession — movement + gathering", () => {
  it("moves to an accessible, exit-connected location", () => {
    const s = newSession();
    s.moveTo("back_office");
    expect(s.currentLocationId()).toBe("back_office");
  });
  it("throws moving to a non-exit / inaccessible location", () => {
    const s = newSession();
    expect(() => s.moveTo("nowhere")).toThrow();
  });
  it("talking to an NPC reveals and gathers their node-available fact", () => {
    const s = newSession();
    const res = s.gatherFactsFromActor("roaster");
    expect(res.revealed.map((r) => r.factId)).toEqual(["fact_capacity"]);
    expect(res.revealed[0].line).toContain("500");
    expect(s.isFactGathered("fact_capacity")).toBe(true);
  });
  it("gathering is idempotent", () => {
    const s = newSession();
    s.gatherFactsFromActor("roaster");
    s.gatherFactsFromActor("roaster");
    expect(s.gatheredFactIds().filter((f) => f === "fact_capacity")).toHaveLength(1);
  });
  it("gathering a fact from its source location works", () => {
    const s = newSession();
    s.gatherFactFromLocation("fact_capacity"); // roastery_floor is a source of fact_capacity
    expect(s.isFactGathered("fact_capacity")).toBe(true);
  });
  it("gathering all three facts unlocks the decision", () => {
    const s = newSession();
    s.gatherFactsFromActor("roaster");
    s.gatherFactsFromActor("buyer");
    s.moveTo("back_office");
    s.gatherFactsFromActor("bookkeeper");
    expect(s.isDecisionUnlocked("decide_contract")).toBe(true);
    expect(s.objective()).toEqual({ nodeTitle: "The Offer on the Table", needed: 3, got: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/engine test session`
Expected: the new tests FAIL (methods undefined).

- [ ] **Step 3: Implement movement + gathering**

Add these methods inside the `GameSession` class in `packages/engine/src/state/session.ts` (before the closing brace):
```typescript
  moveTo(locationId: string): void {
    const node = this.currentNode();
    const current = this.locationsById.get(this.locationId)!;
    const accessible = node.accessible_locations.includes(locationId);
    const connected = current.exits.includes(locationId);
    if (!accessible || !connected) {
      throw new Error(`cannot move to "${locationId}" from "${this.locationId}"`);
    }
    this.locationId = locationId;
  }

  gatherFactsFromActor(actorId: string): { greeting?: string; revealed: { factId: string; line: string }[] } {
    const actor = this.actorsById.get(actorId);
    if (!actor) throw new Error(`unknown actor ${actorId}`);
    const available = new Set(this.currentNode().available_facts);
    const revealed: { factId: string; line: string }[] = [];
    for (const factId of actor.knowledge) {
      if (!available.has(factId)) continue;
      const topic = actor.dialogue?.topics?.find((t) => t.fact_id === factId);
      const fact = this.world.facts.find((f) => f.id === factId);
      const line = topic?.line ?? (fact ? `${fact.label}: ${fact.content}` : factId);
      revealed.push({ factId, line });
      this.gathered.add(factId);
    }
    return { greeting: actor.dialogue?.greeting, revealed };
  }

  gatherFactFromLocation(factId: string): void {
    const fact = this.world.facts.find((f) => f.id === factId);
    if (!fact) throw new Error(`unknown fact ${factId}`);
    const availableHere = this.currentNode().available_facts.includes(factId);
    const sourcedHere = fact.sources.some((s) => s.location_id === this.locationId);
    if (!availableHere || !sourcedHere) {
      throw new Error(`fact "${factId}" is not investigable at "${this.locationId}"`);
    }
    this.gathered.add(factId);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/engine test session`
Expected: all session tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): GameSession movement and fact gathering"
```

---

## Task 4: GameSession — decisions, endings, debrief

**Files:**
- Modify: `packages/engine/src/state/session.ts`
- Modify: `packages/engine/src/state/session.test.ts`

**Interfaces:**
- Consumes: GameSession from Task 3.
- Produces: `chooseOption(decisionId, optionId, reasoning): { endedAt: "node" | "ending" }`, `isEnded()`, `currentEnding()`, `debrief(): DebriefData | null`, `history(): ChoiceRecord[]`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine/src/state/session.test.ts`:
```typescript
function gatherAll(s: GameSession) {
  s.gatherFactsFromActor("roaster");
  s.gatherFactsFromActor("buyer");
  s.moveTo("back_office");
  s.gatherFactsFromActor("bookkeeper");
}

describe("GameSession — decisions + debrief", () => {
  it("throws when choosing a locked decision", () => {
    const s = newSession();
    expect(() => s.chooseOption("decide_contract", "accept", "too early")).toThrow();
  });
  it("accept -> end_overextended", () => {
    const s = newSession();
    gatherAll(s);
    const r = s.chooseOption("decide_contract", "accept", "Growth outweighs the risk.");
    expect(r.endedAt).toBe("ending");
    expect(s.isEnded()).toBe(true);
    expect(s.currentEnding()!.id).toBe("end_overextended");
  });
  it("decline -> end_stable", () => {
    const s = newSession();
    gatherAll(s);
    s.chooseOption("decide_contract", "decline", "Capacity first.");
    expect(s.currentEnding()!.id).toBe("end_stable");
  });
  it("debrief joins objectives and records reasoning", () => {
    const s = newSession();
    gatherAll(s);
    s.chooseOption("decide_contract", "decline", "Protect the roastery.");
    const d = s.debrief()!;
    expect(d.ending.id).toBe("end_stable");
    expect(d.objectives).toHaveLength(1);
    expect(d.objectives[0].objective.id).toBe("lo_capacity_vs_growth");
    expect(d.choices).toEqual([
      { prompt: "Do you accept the grocery chain's wholesale contract?", chosenLabel: "Decline the contract, for now", reasoning: "Protect the roastery." },
    ]);
  });
  it("debrief is null before an ending", () => {
    expect(newSession().debrief()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/engine test session`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement decisions + terminal**

Add inside the `GameSession` class in `packages/engine/src/state/session.ts`:
```typescript
  chooseOption(decisionId: string, optionId: string, reasoning: string): { endedAt: "node" | "ending" } {
    const node = this.currentNode();
    if (!node.live_decisions.includes(decisionId)) throw new Error(`decision "${decisionId}" is not live here`);
    if (!this.isDecisionUnlocked(decisionId)) throw new Error(`decision "${decisionId}" is locked`);
    const decision = this.decisionsById.get(decisionId)!;
    const option = decision.options.find((o) => o.id === optionId);
    if (!option) throw new Error(`unknown option "${optionId}"`);
    this.choices.push({ decisionId, optionId, reasoning });
    if (this.endingsById.has(option.leads_to)) {
      this.endingId = option.leads_to;
      return { endedAt: "ending" };
    }
    this.currentNodeId = option.leads_to;
    this.locationId = this.currentNode().accessible_locations[0];
    return { endedAt: "node" };
  }

  isEnded(): boolean { return this.endingId !== null; }
  currentEnding(): Ending | null { return this.endingId ? this.endingsById.get(this.endingId) ?? null : null; }
  history(): ChoiceRecord[] { return [...this.choices]; }

  debrief(): DebriefData | null {
    const ending = this.currentEnding();
    if (!ending) return null;
    const objectives = ending.lo_outcomes.map((o) => ({
      objective: this.loById.get(o.lo_id)!,
      verdict: o.verdict,
    }));
    const choices = this.choices.map((c) => {
      const decision = this.decisionsById.get(c.decisionId)!;
      const option = decision.options.find((o) => o.id === c.optionId)!;
      return { prompt: decision.prompt, chosenLabel: option.label, reasoning: c.reasoning };
    });
    return { ending, objectives, choices };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/engine test session`
Expected: all session tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): GameSession decisions, endings, and debrief"
```

---

## Task 5: Placement resolution

**Files:**
- Create: `packages/engine/src/state/placement.ts`
- Create: `packages/engine/src/state/placement.test.ts`

**Interfaces:**
- Consumes: `World, StoryNode` from `@case-quest/schema`.
- Produces: `homeLocationForActor(world, node, actorId): string`; `resolvePlacement(world, node, locationId): { npcIds: string[]; factSpotIds: string[]; doorTargets: string[] }`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/state/placement.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { WorldSchema, type World } from "@case-quest/schema";
import toyJson from "../../public/worlds/wholesale-offer.world.json";
import { resolvePlacement, homeLocationForActor } from "./placement";

const world: World = WorldSchema.parse(toyJson);
const node = world.nodes.find((n) => n.id === "node_the_offer")!;

describe("placement", () => {
  it("anchors NPCs by their fact's source location", () => {
    expect(homeLocationForActor(world, node, "roaster")).toBe("roastery_floor");
    expect(homeLocationForActor(world, node, "bookkeeper")).toBe("back_office");
  });
  it("defaults a location-less NPC to the first accessible location", () => {
    expect(homeLocationForActor(world, node, "buyer")).toBe("roastery_floor");
  });
  it("resolves the roastery floor: roaster + buyer, capacity fact spot, door to back office", () => {
    const p = resolvePlacement(world, node, "roastery_floor");
    expect(p.npcIds.sort()).toEqual(["buyer", "roaster"]);
    expect(p.factSpotIds).toEqual(["fact_capacity"]);
    expect(p.doorTargets).toEqual(["back_office"]);
  });
  it("resolves the back office: bookkeeper, cash fact spot, door to roastery floor", () => {
    const p = resolvePlacement(world, node, "back_office");
    expect(p.npcIds).toEqual(["bookkeeper"]);
    expect(p.factSpotIds).toEqual(["fact_cash"]);
    expect(p.doorTargets).toEqual(["roastery_floor"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/engine test placement`
Expected: FAIL — cannot find `./placement`.

- [ ] **Step 3: Implement placement**

`packages/engine/src/state/placement.ts`:
```typescript
import type { World, StoryNode } from "@case-quest/schema";

export function homeLocationForActor(world: World, node: StoryNode, actorId: string): string {
  const actor = world.actors.find((a) => a.id === actorId);
  const fallback = node.accessible_locations[0];
  if (!actor) return fallback;
  const available = new Set(node.available_facts);
  const accessible = new Set(node.accessible_locations);
  for (const factId of actor.knowledge) {
    if (!available.has(factId)) continue;
    const fact = world.facts.find((f) => f.id === factId);
    if (!fact) continue;
    for (const src of fact.sources) {
      if (src.location_id && accessible.has(src.location_id)) return src.location_id;
    }
  }
  return fallback;
}

export function resolvePlacement(
  world: World,
  node: StoryNode,
  locationId: string,
): { npcIds: string[]; factSpotIds: string[]; doorTargets: string[] } {
  const npcIds = node.present_actors.filter((id) => homeLocationForActor(world, node, id) === locationId);

  const factSpotIds = node.available_facts.filter((factId) => {
    const fact = world.facts.find((f) => f.id === factId);
    return !!fact && fact.sources.some((s) => s.location_id === locationId);
  });

  const location = world.locations.find((l) => l.id === locationId);
  const accessible = new Set(node.accessible_locations);
  const doorTargets = (location?.exits ?? []).filter((t) => accessible.has(t) && t !== locationId);

  return { npcIds, factSpotIds, doorTargets };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/engine test placement`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): deterministic NPC/fact/door placement resolution"
```

---

## Task 6: Typed event bridge

**Files:**
- Create: `packages/engine/src/bridge/events.ts`
- Create: `packages/engine/src/bridge/events.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type EngineEvent`, `interface EnginePayloads`, `class EventBus` with `on(event, handler): () => void`, `emit(event, payload): void`.

- [ ] **Step 1: Write the failing test**

`packages/engine/src/bridge/events.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { EventBus } from "./events";

describe("EventBus", () => {
  it("delivers emitted payloads to subscribers", () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on("interact:actor", fn);
    bus.emit("interact:actor", { actorId: "roaster" });
    expect(fn).toHaveBeenCalledWith({ actorId: "roaster" });
  });
  it("unsubscribe stops delivery", () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on("interact:fact", fn);
    off();
    bus.emit("interact:fact", { factId: "fact_cash" });
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/engine test events`
Expected: FAIL — cannot find `./events`.

- [ ] **Step 3: Implement the bus**

`packages/engine/src/bridge/events.ts`:
```typescript
export interface EnginePayloads {
  "interact:actor": { actorId: string };
  "interact:fact": { factId: string };
  "decision:activate": { decisionId: string };
  "location:changed": { locationId: string };
  "scene:render": Record<string, never>;
}
export type EngineEvent = keyof EnginePayloads;
type Handler<E extends EngineEvent> = (payload: EnginePayloads[E]) => void;

export class EventBus {
  private handlers = new Map<EngineEvent, Set<Handler<EngineEvent>>>();

  on<E extends EngineEvent>(event: E, handler: Handler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) { set = new Set(); this.handlers.set(event, set); }
    set.add(handler as Handler<EngineEvent>);
    return () => { set!.delete(handler as Handler<EngineEvent>); };
  }

  emit<E extends EngineEvent>(event: E, payload: EnginePayloads[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) (h as Handler<E>)(payload);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/engine test events`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): typed event bridge (Phaser <-> React)"
```

---

## Task 7: Room templates + placeholder textures

**Files:**
- Create: `packages/engine/src/phaser/templates.ts`
- Create: `packages/engine/src/phaser/templates.test.ts`
- Create: `packages/engine/src/phaser/textures.ts`

**Interfaces:**
- Consumes: `LocationType` from `@case-quest/schema`.
- Produces: `TILE` constants; `interface RoomTemplate { width; height; tiles: number[][]; playerSpawn; poiSlots; doorSlots }`; `getTemplate(type): RoomTemplate`; `TILE_SIZE`. And `generatePlaceholderTextures(scene)` (render-only).

- [ ] **Step 1: Write the failing test**

`packages/engine/src/phaser/templates.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { getTemplate, TILE } from "./templates";

describe("getTemplate", () => {
  it("returns a bordered room for a known type", () => {
    const t = getTemplate("office");
    expect(t.height).toBe(t.tiles.length);
    expect(t.width).toBe(t.tiles[0].length);
    // top-left corner is a wall (bordered room)
    expect(t.tiles[0][0]).toBe(TILE.WALL);
    // has at least one interior floor tile
    expect(t.tiles[1][1]).toBe(TILE.FLOOR);
    expect(t.poiSlots.length).toBeGreaterThan(0);
    expect(t.doorSlots.length).toBeGreaterThan(0);
  });
  it("returns a template for factory_floor too", () => {
    expect(getTemplate("factory_floor").tiles.length).toBeGreaterThan(0);
  });
  it("falls back to a default room for an unmapped type", () => {
    // @ts-expect-error intentionally unmapped
    const t = getTemplate("warehouse_unknown");
    expect(t.tiles.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/engine test templates`
Expected: FAIL — cannot find `./templates`.

- [ ] **Step 3: Implement templates**

`packages/engine/src/phaser/templates.ts`:
```typescript
import type { LocationType } from "@case-quest/schema";

export const TILE = { FLOOR: 0, WALL: 1, DOOR: 2, DESK: 3 } as const;
export const TILE_SIZE = 32;

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
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row.push(border ? TILE.WALL : TILE.FLOOR);
    }
    tiles.push(row);
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/engine test templates`
Expected: 3 tests PASS.

- [ ] **Step 5: Implement placeholder textures (render-only, no test)**

`packages/engine/src/phaser/textures.ts`:
```typescript
import Phaser from "phaser";
import { TILE_SIZE } from "./templates";

const COLORS = {
  floor: 0x2b2f3a, wall: 0x555b6e, door: 0x8a6d3b, desk: 0x6d4c41,
  player: 0x4caf50, npc: 0x42a5f5, fact: 0xffca28,
};

function solidTexture(scene: Phaser.Scene, key: string, color: number, border = 0x00000033): void {
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
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): room templates and code-generated placeholder textures"
```

---

## Task 8: Phaser WorldScene + game boot (render layer)

**Files:**
- Create: `packages/engine/src/phaser/WorldScene.ts`
- Create: `packages/engine/src/phaser/game.ts`

**Interfaces:**
- Consumes: `GameSession` (Tasks 2–4), `resolvePlacement` (Task 5), `EventBus` (Task 6), `getTemplate`/`TILE`/`TILE_SIZE`/`generatePlaceholderTextures` (Task 7).
- Produces: `class WorldScene extends Phaser.Scene`; `createGame(parent: HTMLElement, session: GameSession, bus: EventBus): Phaser.Game`. Not unit-tested; verified in Task 10.

- [ ] **Step 1: Implement the scene**

`packages/engine/src/phaser/WorldScene.ts`:
```typescript
import Phaser from "phaser";
import type { GameSession } from "../state/session";
import type { EventBus } from "../bridge/events";
import { resolvePlacement } from "../state/placement";
import { getTemplate, TILE, TILE_SIZE } from "./templates";
import { generatePlaceholderTextures } from "./textures";

const SPEED = 160;
const INTERACT_RADIUS = 40;

export class WorldScene extends Phaser.Scene {
  private session!: GameSession;
  private bus!: EventBus;
  private player!: Phaser.Physics.Arcade.Sprite;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private interactables: { x: number; y: number; kind: "actor" | "fact" | "door"; id: string }[] = [];
  private rendered: Phaser.GameObjects.GameObject[] = [];

  constructor() { super("world"); }

  init(data: { session: GameSession; bus: EventBus }) {
    this.session = data.session;
    this.bus = data.bus;
  }

  create() {
    generatePlaceholderTextures(this);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.interactKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.walls = this.physics.add.staticGroup();
    this.renderLocation();
    this.bus.on("scene:render", () => this.renderLocation());
  }

  private clear() {
    this.rendered.forEach((o) => o.destroy());
    this.rendered = [];
    this.walls.clear(true, true);
    this.interactables = [];
  }

  private renderLocation() {
    this.clear();
    const loc = this.session.accessibleLocations().find((l) => l.id === this.session.currentLocationId())!;
    const tpl = getTemplate(loc.type);
    const tileKey = (t: number) =>
      t === TILE.WALL ? "tile-wall" : t === TILE.DOOR ? "tile-door" : t === TILE.DESK ? "tile-desk" : "tile-floor";

    for (let y = 0; y < tpl.height; y++) {
      for (let x = 0; x < tpl.width; x++) {
        const t = tpl.tiles[y][x];
        const img = this.add.image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, tileKey(t));
        this.rendered.push(img);
        if (t === TILE.WALL) {
          const w = this.walls.create(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, "tile-wall");
          w.refreshBody();
        }
      }
    }

    const node = this.session.currentNode();
    const world = (this.session as unknown as { world: import("@case-quest/schema").World }).world;
    const placement = resolvePlacement(world, node, loc.id);

    const label = (x: number, y: number, text: string) => {
      const t = this.add.text(x, y - TILE_SIZE * 0.7, text, { fontSize: "12px", color: "#fff", backgroundColor: "#0008" }).setOrigin(0.5);
      this.rendered.push(t);
    };

    placement.npcIds.forEach((actorId, i) => {
      const slot = tpl.poiSlots[i % tpl.poiSlots.length];
      const px = slot.x * TILE_SIZE + TILE_SIZE / 2, py = slot.y * TILE_SIZE + TILE_SIZE / 2;
      const s = this.add.image(px, py, "sprite-npc");
      const actor = this.session.presentActors().find((a) => a.id === actorId);
      this.rendered.push(s);
      label(px, py, actor?.name ?? actorId);
      this.interactables.push({ x: px, y: py, kind: "actor", id: actorId });
    });

    placement.factSpotIds.forEach((factId, i) => {
      const slot = tpl.poiSlots[(placement.npcIds.length + i) % tpl.poiSlots.length];
      const px = slot.x * TILE_SIZE + TILE_SIZE / 2, py = slot.y * TILE_SIZE + TILE_SIZE / 2;
      const s = this.add.image(px, py, "sprite-fact");
      this.rendered.push(s);
      label(px, py, "?");
      this.interactables.push({ x: px, y: py, kind: "fact", id: factId });
    });

    placement.doorTargets.forEach((target, i) => {
      const slot = tpl.doorSlots[i % tpl.doorSlots.length];
      const px = slot.x * TILE_SIZE + TILE_SIZE / 2, py = slot.y * TILE_SIZE + TILE_SIZE / 2;
      const d = this.add.image(px, py, "tile-door");
      this.rendered.push(d);
      label(px, py, "exit");
      this.interactables.push({ x: px, y: py, kind: "door", id: target });
    });

    const spawn = tpl.playerSpawn;
    if (!this.player) {
      this.player = this.physics.add.sprite(spawn.x * TILE_SIZE + TILE_SIZE / 2, spawn.y * TILE_SIZE + TILE_SIZE / 2, "sprite-player");
      this.player.setCollideWorldBounds(true);
      this.cameras.main.startFollow(this.player);
    } else {
      this.player.setPosition(spawn.x * TILE_SIZE + TILE_SIZE / 2, spawn.y * TILE_SIZE + TILE_SIZE / 2);
    }
    this.physics.add.collider(this.player, this.walls);
    this.physics.world.setBounds(0, 0, tpl.width * TILE_SIZE, tpl.height * TILE_SIZE);
    this.bus.emit("location:changed", { locationId: loc.id });
  }

  update() {
    if (!this.player) return;
    const v = SPEED;
    this.player.setVelocity(0);
    if (this.cursors.left.isDown) this.player.setVelocityX(-v);
    else if (this.cursors.right.isDown) this.player.setVelocityX(v);
    if (this.cursors.up.isDown) this.player.setVelocityY(-v);
    else if (this.cursors.down.isDown) this.player.setVelocityY(v);

    const near = this.nearestInteractable();
    if (near && near.kind === "door") {
      // Doors trigger on contact.
      this.session.moveTo(near.id);
      this.bus.emit("scene:render", {});
      return;
    }
    if (near && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      if (near.kind === "actor") this.bus.emit("interact:actor", { actorId: near.id });
      else if (near.kind === "fact") this.bus.emit("interact:fact", { factId: near.id });
    }
  }

  private nearestInteractable() {
    let best: (typeof this.interactables)[number] | null = null;
    let bestD = INTERACT_RADIUS;
    for (const it of this.interactables) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, it.x, it.y);
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }
}
```

Note: `WorldScene` reads the `World` via the session (the session holds it). To expose it cleanly rather than the cast above, add a `world()` getter to `GameSession` in `state/session.ts`:
```typescript
  world(): World { return this.worldRef; }
```
and store `private readonly worldRef: World = world;` in the constructor, then replace the cast in `renderLocation` with `const world = this.session.world();`. Do this now.

- [ ] **Step 2: Add the `world()` getter to GameSession**

In `packages/engine/src/state/session.ts`, add to the constructor body `this.worldRef = world;`, add the field `private readonly worldRef: World;`, and add the method:
```typescript
  world(): World { return this.worldRef; }
```
Then in `WorldScene.renderLocation`, replace:
```typescript
    const world = (this.session as unknown as { world: import("@case-quest/schema").World }).world;
```
with:
```typescript
    const world = this.session.world();
```

- [ ] **Step 3: Implement game boot**

`packages/engine/src/phaser/game.ts`:
```typescript
import Phaser from "phaser";
import type { GameSession } from "../state/session";
import type { EventBus } from "../bridge/events";
import { WorldScene } from "./WorldScene";

export function createGame(parent: HTMLElement, session: GameSession, bus: EventBus): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 480,
    height: 352,
    backgroundColor: "#10131a",
    pixelArt: true,
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [WorldScene],
  });
  game.scene.start("world", { session, bus });
  return game;
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm -C packages/engine typecheck`
Expected: no errors. (State/placement/bridge/templates tests still pass: `pnpm -C packages/engine test`.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(engine): Phaser WorldScene (render, movement, interaction) + game boot"
```

---

## Task 9: React UI overlay + App wiring

**Files:**
- Create: `packages/engine/src/ui/Hud.tsx`, `DialogueBox.tsx`, `DecisionScene.tsx`, `Debrief.tsx`
- Modify: `packages/engine/src/App.tsx`

**Interfaces:**
- Consumes: `GameSession`, `EventBus`, `createGame`.
- Produces: the playable app. Verified in Task 10.

- [ ] **Step 1: Implement the UI components**

`packages/engine/src/ui/Hud.tsx`:
```tsx
export function Hud({ nodeTitle, got, needed, facts }: { nodeTitle: string; got: number; needed: number; facts: string[] }) {
  return (
    <div style={{ position: "absolute", top: 8, left: 8, background: "#0009", padding: "8px 12px", borderRadius: 8, maxWidth: 260 }}>
      <div style={{ fontWeight: 600 }}>{nodeTitle}</div>
      <div style={{ fontSize: 12, opacity: 0.85 }}>Facts gathered: {got} / {needed}</div>
      <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12 }}>
        {facts.map((f) => <li key={f}>{f}</li>)}
      </ul>
    </div>
  );
}
```

`packages/engine/src/ui/DialogueBox.tsx`:
```tsx
export function DialogueBox({ name, greeting, lines, onClose }: { name: string; greeting?: string; lines: string[]; onClose: () => void }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "#0d1017ee", borderTop: "2px solid #4caf50", padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{name}</div>
      {greeting && <p style={{ margin: "0 0 8px" }}>{greeting}</p>}
      {lines.map((l, i) => <p key={i} style={{ margin: "0 0 6px" }}>{l}</p>)}
      <button onClick={onClose} style={{ marginTop: 8 }}>Continue</button>
    </div>
  );
}
```

`packages/engine/src/ui/DecisionScene.tsx`:
```tsx
import { useState } from "react";

export function DecisionScene({ prompt, options, onChoose }: {
  prompt: string;
  options: { id: string; label: string }[];
  onChoose: (optionId: string, reasoning: string) => void;
}) {
  const [optionId, setOptionId] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const canConfirm = optionId !== null && reasoning.trim().length > 0;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#08090cf2", display: "flex", flexDirection: "column", justifyContent: "center", padding: 32 }}>
      <h2 style={{ marginTop: 0 }}>{prompt}</h2>
      {options.map((o) => (
        <label key={o.id} style={{ display: "block", margin: "6px 0", cursor: "pointer" }}>
          <input type="radio" name="opt" checked={optionId === o.id} onChange={() => setOptionId(o.id)} /> {o.label}
        </label>
      ))}
      <textarea
        placeholder="Explain your reasoning…"
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
        rows={4}
        style={{ marginTop: 12, background: "#161a22", color: "#e6e6e6", border: "1px solid #333", borderRadius: 6, padding: 8 }}
      />
      <button disabled={!canConfirm} onClick={() => onChoose(optionId!, reasoning)} style={{ marginTop: 12, padding: "8px 16px" }}>
        Commit decision
      </button>
    </div>
  );
}
```

`packages/engine/src/ui/Debrief.tsx`:
```tsx
import type { DebriefData } from "../state/session";

export function Debrief({ data }: { data: DebriefData }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#08090cf7", overflow: "auto", padding: 32 }}>
      <h1 style={{ marginTop: 0 }}>{data.ending.title}</h1>
      <p>{data.ending.summary}</p>
      <h3>What actually happened</h3>
      <p style={{ opacity: 0.9 }}>{data.ending.real_case_comparison}</p>
      <h3>Your decision</h3>
      {data.choices.map((c, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{c.prompt}</div>
          <div>You chose: {c.chosenLabel}</div>
          <div style={{ fontStyle: "italic", opacity: 0.85 }}>“{c.reasoning}”</div>
        </div>
      ))}
      <h3>Learning objectives</h3>
      {data.objectives.map((o) => (
        <div key={o.objective.id} style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{o.objective.text}</div>
          <div style={{ opacity: 0.9 }}>{o.verdict}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire the App**

Replace `packages/engine/src/App.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { validateWorld, WorldSchema, type World } from "@case-quest/schema";
import { GameSession, type DebriefData } from "./state/session";
import { EventBus } from "./bridge/events";
import { createGame } from "./phaser/game";
import { Hud } from "./ui/Hud";
import { DialogueBox } from "./ui/DialogueBox";
import { DecisionScene } from "./ui/DecisionScene";
import { Debrief } from "./ui/Debrief";

const WORLD_URL = "/worlds/wholesale-offer.world.json";

type Dialogue = { name: string; greeting?: string; lines: string[] };

export function App() {
  const parentRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const busRef = useRef<EventBus | null>(null);

  const [hud, setHud] = useState({ nodeTitle: "", got: 0, needed: 0, facts: [] as string[] });
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [debrief, setDebrief] = useState<DebriefData | null>(null);

  useEffect(() => {
    let game: import("phaser").Game | undefined;
    (async () => {
      const raw = await (await fetch(WORLD_URL)).json();
      const result = validateWorld(raw);
      if (!result.ok) { setErrors(result.errors.map((e) => `[${e.code}] ${e.message}`)); return; }
      const world: World = WorldSchema.parse(raw);
      const session = new GameSession(world);
      const bus = new EventBus();
      sessionRef.current = session;
      busRef.current = bus;

      const refreshHud = () => {
        const o = session.objective();
        setHud({ nodeTitle: o.nodeTitle, got: o.got, needed: o.needed, facts: session.gatheredFactIds() });
      };
      refreshHud();

      bus.on("interact:actor", ({ actorId }) => {
        const res = session.gatherFactsFromActor(actorId);
        const actor = session.presentActors().find((a) => a.id === actorId);
        setDialogue({ name: actor?.name ?? actorId, greeting: res.greeting, lines: res.revealed.map((r) => r.line) });
        refreshHud();
      });
      bus.on("interact:fact", ({ factId }) => {
        session.gatherFactFromLocation(factId);
        refreshHud();
      });
      bus.on("location:changed", () => refreshHud());

      if (parentRef.current) game = createGame(parentRef.current, session, bus);
    })();
    return () => { game?.destroy(true); };
  }, []);

  const activateDecision = () => {
    const s = sessionRef.current!;
    const d = s.liveDecisions()[0];
    if (d && s.isDecisionUnlocked(d.id)) setDecisionId(d.id);
  };

  const onChoose = (optionId: string, reasoning: string) => {
    const s = sessionRef.current!;
    const r = s.chooseOption(decisionId!, optionId, reasoning);
    setDecisionId(null);
    if (r.endedAt === "ending") setDebrief(s.debrief());
    else busRef.current!.emit("scene:render", {});
  };

  if (errors) {
    return <div style={{ padding: 24 }}><h2>Invalid world.json</h2><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>;
  }

  const unlocked = sessionRef.current?.liveDecisions()[0]
    && sessionRef.current.isDecisionUnlocked(sessionRef.current.liveDecisions()[0].id);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={parentRef} style={{ width: "100%", height: "100%" }} />
      {!debrief && <Hud {...hud} />}
      {!debrief && unlocked && !decisionId && !dialogue && (
        <button onClick={activateDecision} style={{ position: "absolute", top: 8, right: 8, padding: "8px 12px" }}>
          Make the decision
        </button>
      )}
      {dialogue && <DialogueBox {...dialogue} onClose={() => setDialogue(null)} />}
      {decisionId && sessionRef.current && (
        <DecisionScene
          prompt={sessionRef.current.liveDecisions()[0].prompt}
          options={sessionRef.current.liveDecisions()[0].options.map((o) => ({ id: o.id, label: o.label }))}
          onChoose={onChoose}
        />
      )}
      {debrief && <Debrief data={debrief} />}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm -C packages/engine typecheck`
Expected: no errors.
Run: `pnpm -C packages/engine build`
Expected: Vite build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(engine): React UI overlay (HUD, dialogue, decision, debrief) + App wiring"
```

---

## Task 10: Integration playthrough + README + final green

**Files:**
- Create: `packages/engine/README.md`

- [ ] **Step 1: Launch and play through the toy world**

Run: `pnpm -C packages/engine dev`
Then use the run/verify skills to drive a browser: load the app, walk to the roaster and buyer (gather two facts), take the door to the back office, talk to the bookkeeper (third fact), confirm the HUD shows 3/3, click "Make the decision", pick an option, type reasoning, commit, and confirm the debrief renders with the ending, real-case comparison, choice, reasoning, and objective verdict. Verify BOTH endings by replaying (accept → Overextended, decline → Stable). Capture a screenshot of a debrief.
Expected: full playthrough works; both endings reachable; debrief correct.

- [ ] **Step 2: Write the README**

`packages/engine/README.md`:
```markdown
# @case-quest/engine

A Vite + React + Phaser 3 client that plays any valid Case Quest `world.json`.
It loads a world, validates it with `@case-quest/schema`, and renders it as a
top-down game: walk the map, talk to NPCs to gather facts, unlock the fact-gated
decision, choose (capturing your reasoning), and read the debrief.

## Run

```bash
pnpm -C packages/schema build   # engine imports the built schema package
pnpm -C packages/engine dev     # play at the printed localhost URL
```

Loads `public/worlds/wholesale-offer.world.json` (the toy world). Controls:
arrow keys to move, Space to interact, walk into a door to change rooms.

## Design

The deterministic `GameSession` (`src/state/`) holds all game logic and is
unit-tested without a browser. Phaser (`src/phaser/`) only renders and emits
input; React (`src/ui/`) draws the overlay; they communicate via the typed
`EventBus` (`src/bridge/`). Art is code-generated placeholder ("classic
top-down RPG" style) — swapped for real pixel art in a later milestone.

## Test

```bash
pnpm -C packages/engine test        # state core, placement, bridge, templates
pnpm -C packages/engine typecheck
pnpm -C packages/engine build
```
```

- [ ] **Step 3: Final green sweep**

Run: `pnpm -C packages/engine test`
Expected: all suites pass (session, placement, events, templates, smoke).
Run: `pnpm -C packages/engine typecheck` — no errors.
Run: `pnpm -C packages/engine build` — succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(engine): README; verified toy-world playthrough (both endings)"
```

---

## Self-Review

**Spec coverage** (spec §→task):
- §3 architecture / package layout → Task 1 + file structure.
- §4 GameSession API (read/actions/terminal/debrief) → Tasks 2, 3, 4 (+ `world()` getter in Task 8).
- §5.1 movement, §5.5 interaction → Task 8.
- §5.2 templates → Task 7; §5.3 placement resolution → Task 5; §5.4 placeholder textures → Task 7.
- §6 React overlay + bridge → Tasks 6 (bridge) and 9 (UI).
- §7 data flow (fetch → validate → parse → session → render → decide → debrief) → Task 9 App.
- §8 testing (state core + placement unit tests; manual render verify) → Tasks 2–7 + Task 10.
- §2 decisions: Phaser (E1) Task 8, logic/render split (E2) Tasks 2–4 vs 8, React overlay (E3) Task 9, code-gen art (E4) Task 7, full-toy-world scope (E5) Task 10, placement (E6) Task 5, fetch+validate (E7) Task 9.
- Global constraints: state core imports only schema (Tasks 2–5 import only `@case-quest/schema`); engine plays only valid worlds (Task 9 fail-loud); art original code-gen (Task 7).

**Placeholder scan:** No "TBD/TODO". Every code step shows complete code. The only intentional forward-reference (WorldScene reading the world) is resolved within Task 8 Step 2 by adding `GameSession.world()`.

**Type consistency:** `GameSession` methods (`currentNode`, `currentLocationId`, `accessibleLocations`, `presentActors`, `protagonist`, `gatheredFactIds`, `isFactGathered`, `liveDecisions`, `isDecisionUnlocked`, `objective`, `moveTo`, `gatherFactsFromActor`, `gatherFactFromLocation`, `chooseOption`, `isEnded`, `currentEnding`, `debrief`, `history`, `world`) are used identically across Tasks 2–9. `DebriefData` shape matches its use in `Debrief.tsx` and Task 4 tests. `EventBus.on/emit` and `EnginePayloads` keys (`interact:actor`, `interact:fact`, `location:changed`, `scene:render`) match Tasks 8–9. `resolvePlacement` return `{ npcIds, factSpotIds, doorTargets }` matches Task 8 usage. `getTemplate`/`TILE`/`TILE_SIZE`/`RoomTemplate` match Task 8.
