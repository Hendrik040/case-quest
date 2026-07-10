# Meeting Encounters & Traversal World — Design (M5)

Date: 2026-07-10
Status: Approved by Hendrik (2026-07-10) — four architecture decisions locked, traversal requirement added.
Branch: `feat/meeting-encounters` (built on `feat/case-to-game-pipeline`, M4)

## Goal

Turn an n-aible case simulation into a walkable Pokémon-style world: each n-aible
**scene** becomes a physical **venue** (building interior or outdoor site) connected by
**traversal routes** (paths, streets, bridges). The player walks from venue to venue in
scene order. Walking up to a scene's venue zone (meeting table, market stalls) opens a
**multi-party conversation encounter** where the player talks to the scene's personas —
live LLM chat through the n-aible backend, presented in the Gen-3 battle grammar.

Reference case: Case 3, KasKazi Network (IMD-3-2016) + its teaching note.

## Locked decisions

1. **Engine drives, n-aible is the brain.** 1:1 mapping n-aible scene ↔ engine story
   node. The engine (deterministic `GameSession`) owns world state, movement, fact
   gathering, decisions. The platform supplies persona chat (LLM), transcript, and
   grading. Ending a meeting fires `SUBMIT_FOR_GRADING` so both sides advance in
   lockstep.
2. **Hybrid conversation.** Pokémon-style ASK menu of suggested questions (derived from
   the node's facts — guarantees solvability) plus a free-text SAY input. Both are sent
   to the persona LLM; suggested asks grant their fact deterministically on ask.
3. **True multi-party table panel.** All scene personas visible in the encounter; the
   player addresses any one (`@persona`) or all (`@all`); replies are attributed to
   their speaker.
4. **Teaching notes become a second pipeline input.** Richer worlds (more locations,
   personas, facts), decision options aligned to the model solution, grading signals
   wired into the platform rubric.

Plus the traversal requirement (Hendrik, 2026-07-10): scenes are separated by walkable
in-between segments — e.g. start in front of the office building, enter, find the
meeting room, hold the meeting, leave the building, walk a street/bridge to the market,
talk to suppliers there, walk on to the next scene. Scene progression is **spatial**:
completing a scene unlocks the route onward; the next scene activates on arrival at its
venue.

## World structure

### Venues, routes, and the overworld

- **Venue** = the location where a scene's encounter happens. Two presentation styles,
  same mechanics: indoor (`boardroom` interior with a meeting table) and outdoor
  (`street`/`shopfront` site, e.g. market stalls where suppliers stand).
- **Route** = one or more connective outdoor locations between consecutive venues
  (street, path, bridge). Routes may hold flavor facts and non-scene NPCs (existing
  mechanics) but no scene encounters.
- Schema needs no new location machinery: venues and routes are locations wired via
  `exits[]`; nodes gate access via `accessible_locations`. Location types already in the
  enum cover it (`office`, `boardroom`, `street`, `shopfront`, `warehouse`, ...).
- New room templates in `packages/engine/src/phaser/templates.ts` (today only `office`
  and `factory_floor` are customized): `boardroom` (meeting table + seats), `street`
  (open path, building facades, optional bridge band), `shopfront` (market stalls),
  `warehouse`. Building entry/exit uses the existing door-tile grammar
  (per the Gen-3 research doc, `docs/superpowers/research/2026-07-07-pokemon-gen3-presentation-grammar.md`).

### Example: Case 3 overworld (generated, not hand-built)

```
[office exterior street] → KasKazi office (Scene 1 meeting: Hussein)
        → street/bridge route → Kawangware market (Scene 2, outdoor: Judy/suppliers)
        → route → warehouse (Scene 3: Wholesaler)
        → route → modern office (Scene 4: Hussein + Judy)
```

### Spatial progression (engine change)

Today `chooseOption(...)` → `leads_to` teleports the player to the next node's first
location. New behavior:

- Completing node N (meeting wrapped up + node's decision made) puts the session in a
  **traversal state**: current node's `accessible_locations` extend with the route
  locations and the next venue (schema: nodes list `route_locations` + next venue in
  `accessible_locations`; the world graph makes the next venue reachable only after
  completion — enforced by a new validator check).
- Arriving at the next venue's trigger zone activates node N+1 (scene intro overlay,
  platform scene already advanced by `SUBMIT_FOR_GRADING` at wrap-up).
- Endings keep current behavior (debrief overlay immediately).
- `checkFactSolvability` (TS + Python parity port) must understand traversal unlock —
  the three-way mirror (`validate.ts` / `validation.py` / `placement.ts`) changes in
  lockstep.

## Meeting-table encounter

### Trigger and placement

- New placement rule in `packages/engine/src/state/placement.ts`: a node's scene
  personas are seated around the venue's table (or stand at stalls for outdoor venues)
  instead of scattering to per-fact home locations. Non-scene actors keep the old rule.
- The venue template exposes a **trigger zone** (tiles adjacent to the table/stalls).
  Entering it (or pressing Space facing it) starts the meeting with the battle
  transition band.

### Encounter UI (`MeetingEncounter` overlay)

New overlay kind alongside the existing single-NPC `EncounterScreen` (which remains for
route NPCs):

- All participant busts rendered (existing 4-palette bust art, `actorPaletteIndex`),
  active speaker highlighted; Emerald-style text box below.
- Player actions: **ASK** (suggested-question menu, grouped per persona, from
  `knowledge ∩ available_facts`), **SAY** (free text, `@persona` / `@all` target
  picker), **NOTES** (existing modal), **WRAP UP** (confirm dialog → ends meeting,
  fires scene submit).
- Async text phases: `thinking` (persona deliberating) and `streaming` (SSE tokens
  drive the typewriter). Falls back to instant canned lines in standalone mode.
- Turn counter HUD chip (from platform `turn_count` / `timeout_turns`); on platform
  auto-advance (turn limit hit), the meeting force-wraps with a system line.

### Fact semantics (deterministic core preserved)

- A fact is granted **on ask** of its suggested question — `GameSession.encounterAsk`
  stays the source of truth; solvability guarantees survive LLM nondeterminism.
- The LLM reply is the in-character delivery; free-text SAY is unscored flavor but
  lands in the platform transcript (graded).
- `GameSession` stays deterministic and network-free: all LLM traffic goes through an
  injected callback at the App/host layer; only the resulting lines feed the UI.

## Platform integration (host bridge)

The engine's `CaseQuestCallbacks` (`packages/engine/src/lib.ts` / `App.tsx`) gains:

```ts
onEncounterChat(msg: {
  nodeId: string; platformSceneId: number;
  target: { platformPersonaId: number } | 'all';
  text: string;               // suggested ask or free text
}): AsyncIterable<{ personaId: number; token?: string; done?: boolean;
                    turnCount?: number; sceneCompleted?: boolean }>
onSceneWrapUp(platformSceneId: number): Promise<{ nextSceneId?: number; complete?: boolean }>
onFinalGrade(): Promise<GradePayload>   // shown in debrief
```

The host adapter (n-aible frontend, "Play as game" embed via `mountCaseQuest`):

- `POST /api/simulation/start` once; holds `user_progress_id`.
- Routes chat through `POST /api/simulation/linear-chat-stream` (SSE over fetch-with-
  cookie through the Next proxy; must handle the 202+job_id queued fallback).
- WRAP UP → `SUBMIT_FOR_GRADING` via `POST /api/simulation/linear-chat`.
- Posts engine-side events the grader should see (decision reasoning, debrief summary)
  via `POST /api/simulation/save-message`.
- `GET /api/simulation/grade` for the final scorecard in the debrief pages.
- Standalone Vite dev = no callbacks → canned lines, no turn limits (today's behavior).

### Platform fixes required (n-aible repo)

1. **@mention regex** in `chat_handler.py` cannot parse apostrophes/spaces
   (`@Ng'ang'a Wanjohi` truncates to `@Ng`). Route by persona **id** from the game
   (new message field or normalized slug), keep the regex for human typing.
2. **ID crosswalk**: `assembler.py` writes `platform_persona_id` on actors and
   `platform_scene_id` on nodes (schema + Python parity port + TS schema additions).
   The engine never matches personas by display name.
3. Verify the Next proxy streams SSE unbuffered; one credentialed cross-port smoke
   test, embed mode is the supported path.

## Pipeline enrichment (n-aible repo, `world_generation`)

- `extraction.py` takes the **teaching note** as a second grounding document:
  personas with true knowledge boundaries (14 candidates identified in research vs 4
  generated today), facts with numbers (~30 vs 5), decision options mapped to the model
  solution (margin-chain → manufacturers as clients; BSR guarantor system; imitability
  via mapping IP), endings' `real_case_comparison` from Cases B/C.
- Location/node caps rise: one venue per scene + route locations + flavor rooms
  (prompt rule 3 changes; validator counts follow).
- Scene → venue assignment: extraction picks each scene's venue type (indoor/outdoor)
  from the scene's setting description; assembler generates connective route locations
  between consecutive venues.
- Teaching-note grading signals flow into the platform `grading_config` rubric for the
  simulation (already supported by the platform data model).

## Error handling

- Chat stream failure / 202-queue timeout → encounter shows a "connection lost" system
  line, retry action; facts already granted are unaffected (deterministic core).
- Platform scene desync (e.g. auto-advance while roaming): host adapter reconciles on
  every `done` event via `turn_count`/`scene_completed`; engine force-wraps if the
  platform closed the scene.
- Auth expiry mid-session → host adapter re-login + resume via
  `GET /api/simulation/progress`.
- World generation failure keeps existing behavior: `game_ready=False`, case publishes
  without game.

## Testing

- **Engine unit** (vitest): traversal unlock, grouped placement, meeting chain,
  fact-on-ask, force-wrap on turn limit; `GameSession` never touches the network.
- **Schema**: crosswalk fields, traversal reachability check, solvability with
  route-gated venues (TS + Python parity, drift test).
- **Integration smoke**: credentialed SSE through the Next proxy (one script).
- **E2E gate**: extended world-agnostic Playwright driver plays a full multi-scene
  world — walk → meeting (mock or live backend) → wrap-up → traversal → next venue →
  decision → debrief with grade panel.

## Build order (each phase shippable)

1. **Venues & traversal** — boardroom/street/shopfront templates, grouped seating,
   trigger zone, spatial progression, validator updates (canned lines; playable
   immediately).
2. **Multi-party encounter UI** — `MeetingEncounter` overlay, ASK/SAY/NOTES/WRAP UP,
   async streaming phases (still canned lines behind a fake async iterator).
3. **Host bridge** — callbacks, n-aible adapter, mention/id fixes, crosswalk,
   lockstep advancement, grade in debrief.
4. **Pipeline enrichment** — teaching-note ingestion, venue assignment, raised caps,
   rubric wiring; regenerate Case 3 world.
5. **E2E + polish** — extended driver, force-wrap edge cases, docs.

## Out of scope (M6+)

- Case-derived art (building facades per industry, persona portraits from image_url).
- Code-challenge scene type (`scene_type: 'code_challenge'`).
- Multiplayer/cohort features; professor authoring UI for venue/route layout.
- Voice, sound, music.

## Key files

Engine: `packages/engine/src/state/session.ts`, `state/placement.ts`,
`phaser/templates.ts`, `phaser/WorldScene.ts`, `ui/pixel/EncounterScreen.tsx`,
`App.tsx`, `lib.ts`, `bridge/events.ts`, `art/grids.ts`.
Schema: `packages/schema/src/schema.ts`, `validate.ts`, `graph.ts`.
Platform (n-aible repo, branch `feat/case-quest-world-generation`):
`backend/modules/world_generation/{extraction,assembler,validation,service}.py`,
`backend/modules/simulation/handlers/chat_handler.py`,
`backend/modules/simulation/router.py`, frontend game embed.
Research grounding: workflow run `wf_f7c2b4b4-117` (session transcript dir),
`docs/superpowers/research/2026-07-07-pokemon-gen3-presentation-grammar.md`.
