# Case Quest — Engine MVP (Milestone 2) Design

- **Status:** Draft for review
- **Date:** 2026-07-06
- **Scope:** Milestone 2 only — a web game client that renders a validated `world.json` as a playable top-down game, proven end-to-end on the toy world. No pipeline, no live API dialogue, no final art.
- **Depends on:** `@case-quest/schema` (Milestone 1, merged to `main`).

---

## 1. Purpose & scope

Turn the contract into something playable. The engine loads a `world.json`, validates it with `@case-quest/schema`, and lets a student play it: walk a top-down map, talk to NPCs, gather facts, make the fact-gated decision, and see a debrief. The engine knows nothing about any specific case — it is a generic interpreter of the world schema.

**Success criterion:** the complete "Wholesale Offer" toy world plays start to finish in a browser — move between both locations, talk to all three NPCs to gather their facts, watch the decision unlock once all three are gathered, choose an option (capturing free-text reasoning), branch to one of the two endings, and read the debrief mapped to the learning objective.

**In scope:** deterministic game-state core, Phaser tile rendering + movement, React UI overlay (HUD, dialogue, decision, debrief), programmatic placeholder art, loading + validating a `world.json` at runtime, unit tests for the state core.

**Out of scope (later milestones):** the ETL pipeline (M3), live API-backed NPC dialogue (M4), commissioned pixel art (M5), multiple playable protagonists, and persistent per-student progress.

---

## 2. Design decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| E1 | **Game framework** | **Phaser 3** (^3.90) | Strongest stability/performance of the web 2D options; native Tiled tilemap loading (`this.load.tilemapTiledJSON`) fits our template model; arcade physics for top-down movement + tile collision; largest ecosystem and best AI-assist accuracy. Kaplay is lighter but under-performs and is aimed at jams/prototypes; Excalibur is smaller. (See §12 sources.) |
| E2 | **Logic/render split** | **Pure deterministic state core, separate from Phaser.** | The game logic (nodes, fact-gating, transitions, debrief) lives in a framework-agnostic module that is fully unit-testable without a browser — our "deterministic engine" principle. Phaser only renders and emits input events. |
| E3 | **UI** | **React overlay (DOM) over the Phaser canvas.** | Dialogue boxes, the decision scene (with free-text reasoning capture), the HUD, and the debrief are DOM/React; Phaser owns only the tile map + sprites + movement. Cleaner to build and style than in-canvas UI. |
| E4 | **Art (MVP)** | **Original, code-generated placeholder textures.** | Generated in-engine via Phaser `Graphics.generateTexture` (distinct tiles per type; simple labeled character sprites). Zero external assets → zero licensing/IP risk, fully honoring "original or licensed, never Pokémon/trademarked." Real pixel art is an M5 swap. Style is described only as "classic top-down RPG." |
| E5 | **Scope** | **Play the *complete* toy world**, not the brief's 1-NPC minimum. | Same small size, but exercises the real promise: two locations, three NPCs, fact-gated decision, two-ending branch, debrief. |
| E6 | **Placement resolution** | **Derive spatial placement deterministically from the abstract schema.** | The schema has node-level `present_actors`/`available_facts` and fact `sources`, but no explicit "who stands where." The engine resolves placement from fact sources (see §5.3), so no schema change is needed. |
| E7 | **Runtime world loading** | **`fetch()` a `world.json`, then `validateWorld()` before playing.** | Proves the real "valid world.json in → playable game out" loop and reuses M1's validator as the runtime gate. The toy world ships in `public/worlds/`. |

---

## 3. Architecture

New package `packages/engine/` — **Vite + React 18 + TypeScript + Phaser 3**, depending on the workspace package `@case-quest/schema`.

```
packages/engine/
  package.json          @case-quest/engine (private)
  vite.config.ts
  tsconfig.json
  index.html
  public/worlds/wholesale-offer.world.json   (the world to load; copied from schema fixtures)
  src/
    main.tsx            React root
    App.tsx             loads + validates world.json, constructs GameSession, mounts Phaser + UI
    state/
      session.ts        GameSession — the pure deterministic core (§4)
      placement.ts      resolvePlacement(world, nodeId) — deterministic NPC/fact placement (§5.3)
      session.test.ts   unit tests against the toy fixture
    phaser/
      game.ts           Phaser.Game config + boot
      WorldScene.ts     renders current location, movement, interaction zones; emits events
      textures.ts       programmatic placeholder tile/sprite texture generation
    ui/
      Hud.tsx           objective + gathered-facts progress
      DialogueBox.tsx   NPC dialogue display
      DecisionScene.tsx prompt + options + free-text reasoning capture
      Debrief.tsx       ending summary, real-case comparison, per-objective outcomes
    bridge/
      events.ts         typed event bus (Phaser ↔ React ↔ GameSession)
```

**Unit boundaries.** `state/` depends on nothing but `@case-quest/schema` types. `phaser/` and `ui/` both depend on `state/` and talk through `bridge/`. `state/` never imports Phaser or React. This keeps the logic testable and each unit focused.

---

## 4. The deterministic state core (`GameSession`)

Constructed from a **validated** `World`. All game logic lives here; it is synchronous, deterministic, and unit-tested. Proposed API:

```typescript
class GameSession {
  constructor(world: World); // starts at world.meta.start_node_id; currentLocation = start node's first accessible_location; gathered = {}

  // --- current state (read) ---
  currentNode(): StoryNode;
  currentLocationId(): string;
  accessibleLocations(): Location[];              // current node's accessible_locations, resolved
  presentActors(): Actor[];                       // NPCs in current node (never the protagonist)
  protagonist(): Actor;
  gatheredFactIds(): string[];
  isFactGathered(factId: string): boolean;
  liveDecisions(): Decision[];                    // current node's live_decisions, resolved
  isDecisionUnlocked(decisionId: string): boolean; // requires_facts ⊆ gathered
  objective(): { nodeTitle: string; needed: number; got: number }; // HUD data for the next decision

  // --- actions (mutate; all deterministic) ---
  moveTo(locationId: string): void;              // target must be an exit of the current location AND in accessibleLocations(); else throws
  gatherFactsFromActor(actorId: string): { greeting?: string; revealed: { factId: string; line: string }[] };
      // reveals the actor's knowledge facts that are in the current node's available_facts; idempotent
  gatherFactFromLocation(factId: string): void;  // fact must have current location as a source & be available here; idempotent
  chooseOption(decisionId: string, optionId: string, reasoning: string): { endedAt: "node" | "ending" };
      // requires the decision unlocked; records reasoning; follows option.leads_to; updates node or ends the game

  // --- terminal ---
  isEnded(): boolean;
  currentEnding(): Ending | null;
  debrief(): DebriefData | null;                 // for the reached ending
  history(): { decisionId: string; optionId: string; reasoning: string }[];
}

interface DebriefData {
  ending: Ending;
  objectives: { objective: LearningObjective; verdict: string }[]; // ending.lo_outcomes joined to learning_objectives
  choices: { prompt: string; chosenLabel: string; reasoning: string }[]; // from history + decisions
}
```

Invariants: `chooseOption` throws if the decision isn't unlocked or the option is unknown; `moveTo` throws on an inaccessible location; gathering is idempotent (adding a known fact is a no-op). Because the input world is pre-validated, the core assumes referential integrity (no dangling IDs).

---

## 5. Rendering & templates (Phaser)

### 5.1 Movement
Top-down, 4-directional arcade-physics movement (arrow/WASD). The player sprite collides with wall tiles. A camera follows the player.

### 5.2 Per-`LocationType` templates
Each `LocationType` maps to a small hand-defined tile layout (a grid of tile indices) that the engine renders — for the MVP toy world, the two needed types: `factory_floor` and `office`. A template is a fixed-size room (e.g., 15×11 tiles) with a floor, wall border, a door tile per exit, and a few furniture tiles for character. Templates are plain data (arrays), rendered with a programmatic tileset (§5.4). Adding a new `LocationType` later means adding one template entry.

### 5.3 Placement resolution (`resolvePlacement`)
Given the current node, decide where NPCs, fact-pickups, and exits appear in the current location:
- **Fact-pickups:** for each fact in the node's `available_facts` that lists the current location in its `sources[].location_id`, place an investigable object at a template "point-of-interest" slot.
- **NPCs:** place a present actor in a location if one of the actor's `knowledge` facts (that is available in this node) has that location as a `sources[].location_id`. An actor with no location-anchored fact (e.g., the buyer, whose fact is actor-sourced only) is placed in the node's **first** `accessible_location` (deterministic default).
- **Exits:** for each `exit` of the current location that is also in the node's `accessible_locations`, place a door zone leading there (for the MVP two-location world, one door each way). Walking onto a door zone calls `session.moveTo(target)` and re-renders.
Facts are gatherable via **any** of their sources — talking to a source actor or investigating a source location both gather the fact (idempotent). This is generic and, for the toy world, lets a player gather each fact by either mechanism.

### 5.4 Programmatic placeholder art
On boot, generate textures with `Graphics.generateTexture`: floor, wall, door, and furniture tiles (distinct colors/borders), and character sprites (a simple body shape tinted per actor, with the actor's name label rendered above via a Phaser text object). No external image files. Clearly a placeholder; swapped for real art in M5.

### 5.5 Interaction
Walking adjacent to an NPC or fact-pickup and pressing a key (e.g., Space/E) emits an interaction event over the bridge; React renders the resulting dialogue/pickup. Walking onto a door moves locations.

---

## 6. UI overlay (React) & the event bridge

React renders above the canvas and subscribes to the bridge:
- **`Hud`** — the current objective (node title) and fact progress ("2 of 3 facts gathered"), plus a list of gathered facts.
- **`DialogueBox`** — shows an NPC's greeting and the line(s) revealing their fact(s) when the player talks to them.
- **`DecisionScene`** — appears when the player activates an **unlocked** decision: shows the prompt, the options, and a **free-text reasoning field** the student must fill before confirming; on confirm, calls `session.chooseOption(...)`.
- **`Debrief`** — on reaching an ending, shows the ending summary, the real-case comparison, and each learning objective with its outcome verdict, plus a recap of the choice(s) and the student's reasoning.

**Bridge (`bridge/events.ts`)** — a small typed emitter. Phaser emits `interact:actor`, `interact:fact`, `decision:activate`, `location:changed`; React (via `App`) calls `GameSession` and emits back `dialogue:show`, `decision:show`, `hud:update`, `debrief:show`. The bridge decouples the renderer from the DOM UI and keeps `GameSession` the single source of truth.

---

## 7. Data flow

1. `App` `fetch`es `/worlds/wholesale-offer.world.json`.
2. `validateWorld(raw)` (from `@case-quest/schema`). On error, render the validation errors instead of the game (fail loud — the engine only plays valid worlds).
3. `WorldSchema.parse(raw)` → typed `World`; construct `GameSession`.
4. Boot Phaser; `WorldScene` renders the start node's first location via its template + `resolvePlacement`.
5. Player explores → interactions call `GameSession` (gather facts) → HUD updates.
6. When a decision's `requires_facts` are all gathered, activating it opens `DecisionScene`.
7. Choosing an option records reasoning and transitions via `GameSession.chooseOption`; a node target re-renders the scene, an ending target shows `Debrief`.

---

## 8. Testing

- **State core (`session.test.ts`, Vitest):** against the toy fixture — starting state; `moveTo` between the two locations; gathering each fact via actor and via location; the decision is locked until all three facts are gathered then unlocks; `chooseOption("decide_contract","accept",…)` ends at `end_overextended` and `"decline"` at `end_stable`; `debrief()` joins `lo_outcomes` to the learning objective and includes the reasoning; error cases (choosing a locked decision, moving to an inaccessible location) throw.
- **Placement (`placement`):** unit-tested — roaster resolves to `roastery_floor`, bookkeeper to `back_office`, buyer to the first accessible location; fact-pickups land at their source locations.
- **Rendering:** verified by actually launching the app (via the run/verify skills) and screenshotting a playthrough — canvas rendering is not meaningfully unit-testable. The state core carries the correctness weight.

**Definition of done:** the engine package builds, the state-core + placement unit tests pass, and a manual playthrough of the toy world completes both endings with a correct debrief.

---

## 9. Deliverables

The `packages/engine/` package per §3, the passing unit suite, the toy world under `public/worlds/`, and a short `packages/engine/README.md` documenting `pnpm -C packages/engine dev` to play it. Build on a `feat/engine-mvp` branch off `main`, with the same parallel-CodeRabbit-review flow used in M1, and merge (keeping the branch) when green and reviewed.

---

## 10. Out of scope for M2 (later, additive)

- **Live NPC dialogue** (M4) — MVP dialogue is the schema's pre-generated `actor.dialogue`; the API-backed, knowledge-constrained, injection-guarded mode comes later.
- **The ETL pipeline** (M3) — MVP loads a hand-authored/fixture world.
- **Real pixel art** (M5) — MVP art is code-generated placeholder.
- **Persistent progress / instructor dashboard**, **multiple playable protagonists**, **per-node actor disposition changes**.

---

## 11. Open questions

None blocking. The template visual detail (furniture, exact tile dimensions) is an implementation choice within §5.2 and does not affect the schema or the state core.

---

## 12. Sources (framework research)

- Phaser vs Kaplay vs Excalibur — 2D web game framework comparison (phaser.io, 2026): https://phaser.io/news/2026/04/phaser-vs-kaplay-vs-excalibur-2d-web-game-framework
- "I Tried 3 Web Game Frameworks" (jslegenddev): https://jslegenddev.substack.com/p/i-tried-3-web-game-frameworks-so
- JS game rendering benchmark: https://github.com/Shirajuki/js-game-rendering-benchmark
- Phaser 3.90 documentation (tilemap loading, arcade physics) via Context7.
