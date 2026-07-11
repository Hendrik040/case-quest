# Meeting Encounters & Traversal — Implementation Plan (M5)

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans to
> implement task-by-task. Steps use `- [ ]` for tracking.
>
> **NOTE (2026-07-11):** written while the repo was TCC-locked, so exact code signatures below
> are reconstructed from the spec + the files read pre-lock (`session.ts`, `placement.ts`,
> `templates.ts`) + the research phase. **Before coding, re-read each cited file** and confirm
> the interface names/lines — they are marked _(confirm)_ where I could not re-verify tonight.
> Once Desktop access is restored, copy this file to
> `docs/superpowers/plans/2026-07-11-meeting-encounters.md` and commit.

**Goal:** Turn an n-aible case into a walkable multi-scene world where the player walks
between venues via traversal routes and holds multi-party LLM meetings, graded through the
platform.

**Architecture:** Engine drives (1:1 n-aible scene ↔ engine story node); n-aible supplies
persona chat + grading. Conversation is hybrid (ASK menu + free-text SAY). Meetings are true
multi-party. Teaching notes enrich the generation pipeline. Progression is spatial.

**Tech Stack:** TypeScript, Zod (schema), Phaser 3 + React + Vite (engine), Vitest, Playwright
(e2e); Python/FastAPI + GPT (pipeline, sibling repo).

## Global Constraints

- `GameSession` stays **deterministic and network-free**. All LLM traffic goes through an
  injected host callback at the App layer; only resulting lines feed the UI.
- A fact is granted **on ask** of its suggested question — never by parsing LLM prose.
  Solvability guarantees (`checkFactSolvability`) must survive.
- The three-way parity mirror changes in lockstep, each by explicit comment:
  `packages/schema/src/validate.ts` ↔ n-aible `backend/modules/world_generation/validation.py`
  ↔ `packages/engine/src/state/placement.ts`.
- Schema changes bump `SCHEMA_VERSION` and regenerate the draft-07 artifact (drift test must
  pass). TS types and the Python port stay in sync.
- TDD: failing test → run (see it fail) → minimal impl → run (pass) → commit. Frequent commits.
- Gates per phase: `pnpm -C packages/schema build`; `pnpm -C packages/engine test run &&
  typecheck && build`; e2e where relevant.

---

## Phase 1 — Venues, room templates & traversal

### Task 1.1: Schema — add `route_locations` + crosswalk fields

**Files:** Modify `packages/schema/src/schema.ts` _(confirm StoryNodeSchema/ActorSchema
shape)_; Test `packages/schema/src/__tests__/schema.test.ts` _(confirm test path)_.

**Produces:** `StoryNode.route_locations?: string[]`; `StoryNode.platform_scene_id?: number`;
`Actor.platform_persona_id?: number`. Bumped `SCHEMA_VERSION`.

- [ ] Write failing test: a world whose node has `route_locations: ["loc-street"]` and
  `platform_scene_id: 12`, and an actor with `platform_persona_id: 5`, parses and round-trips.
- [ ] Run → fail (unknown keys / type error).
- [ ] Add optional fields to `StoryNodeSchema` and `ActorSchema`; bump `SCHEMA_VERSION`;
  re-export the draft-07 artifact (`packages/schema/scripts/export-json-schema.ts`).
- [ ] Run schema tests + drift test → pass. Commit `feat(schema): route_locations + platform id crosswalk`.

### Task 1.2: Validator — traversal reachability

**Files:** Modify `packages/schema/src/validate.ts` and/or `graph.ts` _(confirm graph checks)_;
Test alongside existing validate tests.

**Semantics:** every id in a node's `route_locations` must exist and be an outdoor type
(`street`/`shopfront`/`client_site`); the next node's venue must be reachable via
`route_locations` ∪ `exits`. `checkFactSolvability` must treat route locations as
in-node-accessible for facts sourced there.

- [ ] Failing test: node with a dangling `route_locations` id → error `route_location_missing`;
  a fact sourced only in a route location is still solvable.
- [ ] Run → fail.
- [ ] Implement the check (mirror comment pointing at `validation.py` + `placement.ts`).
- [ ] Run → pass. Commit.

### Task 1.3: Engine — new room templates (boardroom/street/shopfront/warehouse)

**Files:** Modify `packages/engine/src/phaser/templates.ts` (has `TILE`, `RoomTemplate`,
`makeTemplate`, `TEMPLATES`, `getTemplate` — read in full tonight); add a `TABLE` tile.

**Produces:** `TEMPLATES.boardroom` (central table of `TABLE` tiles, seats/poiSlots around it),
`TEMPLATES.street` (open path + facades + optional bridge band), `TEMPLATES.shopfront` (market
stalls as poiSlots), `TEMPLATES.warehouse`. A `triggerZone: Point[]` field on `RoomTemplate`
marking tiles that open a meeting.

- [ ] Failing test: `getTemplate("boardroom")` returns a template with ≥3 `poiSlots` and a
  non-empty `triggerZone`; table tiles are impassable.
- [ ] Run → fail.
- [ ] Add `TABLE` to `TILE`; extend `RoomTemplate` with `triggerZone`; author the templates.
- [ ] Run → pass. Commit `feat(engine): boardroom/street/shopfront/warehouse templates`.

### Task 1.4: Placement — grouped seating for scene personas

**Files:** Modify `packages/engine/src/state/placement.ts` (`homeLocationForActor`,
`resolvePlacement`).

**Produces:** when a location is a node's venue (type `boardroom` or the node's designated
outdoor venue), **all** `present_actors` for that node resolve there (seated), instead of
scattering by fact-source. Non-scene actors keep the existing rule. Add
`resolveSeating(world, node, locationId): { seatedActorIds: string[] }`.

- [ ] Failing test: node with 3 present actors + a boardroom venue → all 3 seated at the
  boardroom; a route NPC stays at the route.
- [ ] Run → fail. Implement (mirror comment). Run → pass. Commit.

### Task 1.5: Session — spatial progression (traversal state)

**Files:** Modify `packages/engine/src/state/session.ts` (`chooseOption`, add traversal state).

**Current:** `chooseOption` teleports to `nextNode.accessible_locations[0]`.
**New:** on node completion, enter a `traversing` sub-state: extend accessible locations with
the completed node's `route_locations` + the next venue; the player must `moveTo` the next
venue; arriving there activates node N+1 (fires a `scene:activate` event). Endings unchanged.

- [ ] Failing test: complete node 1 → `mode()` allows moving onto a route location → arriving
  at node 2's venue sets `currentNode` to node 2 and emits activation.
- [ ] Run → fail. Implement. Run → pass. Commit `feat(engine): spatial scene progression via routes`.

### Task 1.6: WorldScene — walk-up trigger + route rendering

**Files:** Modify `packages/engine/src/phaser/WorldScene.ts` _(confirm render/interaction)_ and
`bridge/events.ts` (add `encounter:meeting:start`, `scene:activate`).

- [ ] Render the new templates; place seated actors at poiSlots; render `triggerZone`.
- [ ] Entering the trigger zone (or Space facing the table) emits `encounter:meeting:start`
  with the node's seated actor ids.
- [ ] Manual/e2e check the world boots and the trigger fires. Commit.

---

## Phase 2 — Multi-party meeting encounter UI

### Task 2.1: Session — multi-participant encounter view

**Files:** `packages/engine/src/state/session.ts` — extend `EncounterView` (currently single
`actorId` + `topics`) to a meeting shape.

**Produces:** `MeetingView { participants: {actorId,name,role,paletteIndex}[]; activeActorId;
topicsByActor: Record<string, EncounterTopic[]>; }`; `startMeeting(actorIds)`,
`meetingAsk(actorId, factId)` (grants fact on ask, returns `{line}` from dialogue/fallback),
`meetingSetActive(actorId)`, `meetingWrapUp()`.

- [ ] Failing tests for each method (fact granted on ask; wrap-up returns to roaming; asking a
  closed topic throws). Run → fail. Implement. Run → pass. Commit.

### Task 2.2: React — `MeetingEncounter` overlay

**Files:** Create `packages/engine/src/ui/pixel/MeetingEncounter.tsx`; modify `App.tsx` (add a
`meeting` variant to the Overlay union _(confirm union)_) and `lib.ts`.

**Behavior:** all participant busts (reuse `actorPaletteIndex`/bust art), active-speaker
highlight, Emerald text box. Actions: **ASK** (menu grouped per persona from
`topicsByActor`), **SAY** (free text + `@persona`/`@all` target picker), **NOTES** (existing
modal), **WRAP UP** (confirm → `meetingWrapUp` + host `onSceneWrapUp`). Async phases `thinking`
and `streaming` (token typewriter); synchronous canned fallback when no host callback.

- [ ] Component test (render + ASK grants fact + WRAP UP fires callback). Run → fail.
  Implement. Run → pass. Commit `feat(engine): multi-party meeting encounter UI`.

### Task 2.3: Wire trigger → overlay

- [ ] `App.tsx` handles `encounter:meeting:start` → `startMeeting` → mount overlay; freeze
  Phaser via existing `world:freeze` discipline. Commit.

---

## Phase 3 — Host bridge seam + local mock chat

### Task 3.1: Callback contract

**Files:** `packages/engine/src/lib.ts` (`CaseQuestCallbacks`), `App.tsx`.

**Produces:**
```ts
onEncounterChat?(msg: { nodeId: string; platformSceneId?: number;
  target: { platformPersonaId: number } | 'all'; text: string; }):
  AsyncIterable<{ personaId: number; token?: string; done?: boolean;
                 turnCount?: number; sceneCompleted?: boolean }>
onSceneWrapUp?(platformSceneId?: number): Promise<{ nextSceneId?: number; complete?: boolean }>
onFinalGrade?(): Promise<GradePayload>
```
- [ ] Type-level + unit test with a fake async iterator. Implement. Commit.

### Task 3.2: Local mock persona chat (so meetings feel alive standalone)

**Files:** Create `packages/engine/src/host/mockChat.ts`; default it in dev.

- [ ] Given an actor persona + the asked fact's content, stream a short in-character
  paraphrase token-by-token (deterministic; vary tone by OCEAN text). No network.
- [ ] Test: yields tokens then `done`. Implement. Commit `feat(engine): local mock persona chat`.

### Task 3.3: Real n-aible HTTP/SSE adapter (code-complete, flagged unverified)

**Files:** Create `packages/engine/src/host/naibleAdapter.ts` (used only by the Next embed).

- [ ] `start()` → `POST /api/simulation/start`; hold `user_progress_id`.
- [ ] `onEncounterChat` → `POST /api/simulation/linear-chat-stream` (SSE over fetch-with-cookie
  through the Next proxy; parse `data:` events; handle `202+job_id` poll fallback). Route by
  **persona id**, not name.
- [ ] `onSceneWrapUp` → `POST /api/simulation/linear-chat` `SUBMIT_FOR_GRADING`.
- [ ] `onFinalGrade` → `GET /api/simulation/grade`. Post decision reasoning via `save-message`.
- [ ] Unit-test parsing with recorded fixtures. **Mark integration UNVERIFIED** until run
  against a live backend. Commit.

---

## Phase 4 — Pipeline enrichment (sibling repo, unverified without API keys)

**Files:** n-aible `backend/modules/world_generation/{extraction,assembler,validation}.py`;
`backend/modules/simulation/handlers/chat_handler.py`.

- [ ] Add the **teaching note** as a second grounding document in `extraction.py` SYSTEM_PROMPT.
- [ ] Raise the 3–6 location cap to allow one venue per scene + route locations + flavor rooms.
- [ ] Emit `platform_persona_id` / `platform_scene_id` in `assembler.py`; add `route_locations`
  + venue-type selection per scene.
- [ ] Port the traversal validator check into `validation.py` (parity).
- [ ] Fix the `@mention` regex `@([\w().\-&]+)` to handle apostrophes/spaces, and prefer id
  routing from the game client.
- [ ] `pytest`; regenerate Case 3 world; validate. **Needs `OPENAI_API_KEY` + `LLAMAPARSE_API_KEY`.**

---

## Phase 5 — Rich hand-authored Case 3 world + E2E + gates

### Task 5.1: Author `case3-m5.world.json`
Multi-building walkable world grounded in the case research: KasKazi office (Scene 1: Hussein) →
street/bridge route → Kawangware market (Scene 2, outdoor: suppliers/Judy) → route → warehouse
(Scene 3: wholesaler) → route → modern office (Scene 4: Hussein+Judy) → decision → 2 endings.
Facts carry real numbers (100,000 kiosks, Ksh 7.5B/month, 40 kiosks/day → ~200 BSRs, Ksh 15,000
guarantor). Decisions map to the model solution (manufacturers as clients; guarantor system).
- [ ] Validate with the schema; fix until clean. Commit.

### Task 5.2: Extend `scripts/e2e-drive.mjs`
- [ ] Drive: boot → walk to venue → meeting (mock) → ASK all required facts → WRAP UP →
  traverse route → next venue → … → decision → debrief with grade panel. Assert 0 page errors,
  `mode=debrief`. Screenshots → `e2e-shots/`.
- [ ] Run full gates. Commit `test(e2e): multi-scene traversal + meeting playthrough`.

---

## Self-review notes
- Spec coverage: venues/routes (P1), multi-party UI (P2), host bridge + hybrid chat (P2/P3),
  teaching-note pipeline (P4), spatial progression (P1.5), grading write-back (P3.3) — all
  mapped. ✅
- Determinism invariant preserved: fact-on-ask in `meetingAsk`, LLM only for delivery. ✅
- Parity mirror flagged in every schema/placement task. ✅
- Open confirmations (do first): exact `EncounterView`/Overlay union/`CaseQuestCallbacks`/
  `WorldScene` interaction signatures — re-read the files; the signature-gathering step could
  not complete tonight (TCC lock).
