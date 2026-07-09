# M4: Case → Game Pipeline — Design

**Date:** 2026-07-09
**Status:** Approved (design conversation 2026-07-09)
**Depends on:** M1 schema (merged), M2 engine MVP, M3 Pokémon presentation (PR #3)

## Goal

A professor uploads the real Case 3 PDF (`n-aible/sample-cases/Case 3 (2).pdf`) on the
existing n-aible platform → the pipeline additionally produces a valid `world.json` v0.1 →
the student sees a "Play as game" option next to the normal simulation and plays it to
debrief in the embedded Case Quest engine.

**Acceptance:** the committed e2e playthrough driver completes (mode=debrief, 0 page
errors) on the *generated* Case 3 world, not the hand-made wholesale-offer world.

## Context

Two codebases:

- **n-aible platform** (`n-aible/n-aible_edtech_sims`, Python/FastAPI + React frontend).
  Its `pdf_processing` pipeline (LlamaParse → GPT-4o extraction → images → Postgres)
  extracts title, personas (Big Five, knowledge areas), student role, scenes, and 5
  learning outcomes. It does **not** extract discrete facts, decisions, locations, story
  nodes, or endings.
- **Case Quest** (this repo, TypeScript). `@case-quest/schema` defines `world.json` v0.1
  (Zod + L2 semantic validation: reachability, fact-solvability, one protagonist, no dead
  ends). `packages/engine` (Phaser + React) plays a world to debrief.

## Decisions made

1. **Keep Python, extend it.** No pipeline rewrite. A new stage converts extraction
   output → `world.json`. Rationale: the pipeline is proven; the gap is a conversion
   layer, not a re-extraction.
2. **New mode alongside.** The existing chat simulation is untouched; the game is an
   opt-in additional mode per case (`game_ready` flag). Zero regression risk.
3. **M4 scope = Case 3 end-to-end.** One real case, full loop. Professor world-editing
   UI, grading integration, case-derived art, multiple cases, and game-mode diversity are
   out of scope (M5+, built on this real case).

## Design

### 1. Pipeline extension (Python, in `n-aible_edtech_sims`)

New `world_generation` module appended to `PDFProcessingPipeline`, running after
personas/scenes/outcomes (it consumes them; nothing existing changes):

- **LLM game-content step** — one GPT extraction taking cleaned case content + extracted
  personas/scenes/outcomes, generating: discrete **facts** (each anchored to a location or
  actor), **decisions** (options with correct/partial mappings to facts and learning
  outcomes), **locations** (rooms derived from case settings), **story nodes** (ordered
  from scenes), **endings**.
- **Deterministic assembler** — plain Python, no LLM: id generation, actor→location
  placement, node-graph wiring, final `world.json` assembly. Unit-testable without API
  calls.
- **Validation gate** — `@case-quest/schema` exports a JSON Schema artifact
  (`zod-to-json-schema`, committed to the repo). Python validates with `jsonschema`, plus
  ports of the two highest-value L2 checks: node reachability and fact-solvability. On
  failure: one bounded LLM repair loop, then fail loudly. An invalid world is never
  persisted.
- **Persistence** — `simulation.world_json` (JSON column) + `game_ready` boolean; exposed
  at `GET /simulations/{id}/world`.

### 2. Engine embedding (TypeScript, in `case-quest`)

- `packages/engine` gains a library build exposing `mountCaseQuest(el, world, callbacks)`;
  the world is injected instead of hard-fetched. Callbacks: at minimum
  `onDebriefComplete(summary)`.
- The n-aible frontend case page adds "Play as game" (visible when `game_ready`), lazy-
  loads the engine bundle, mounts it with the world from the API.
- Standalone Vite dev mode keeps working (fetches the file, calls `mountCaseQuest`).

### 3. Contract & boundaries

- `world.json` v0.1 remains the single contract. Python produces it; TS is the schema
  source of truth. CI check: the committed JSON Schema artifact is regenerated from Zod
  and diffed, so the two sides cannot drift silently.
- No changes to professor upload flow, chat sim, or existing student flows.

### 4. Error handling

- Extraction step returns malformed JSON → retry once with error appended; then fail the
  world stage (case still publishes without game mode; `game_ready=false`).
- Validation failures → one repair loop → fail loudly with the validator's issue list in
  the pipeline progress events/logs.
- Frontend: missing/invalid world at mount → fall back to the normal case page with a
  notice; never a broken game screen.

### 5. Testing

- **Python:** assembler unit tests (deterministic); fixture tests for the extractor
  prompt output shape; one integration test running Case 3 through the full stage against
  the schema gate (recorded LLM fixtures for CI).
- **TS:** existing suite stays green; new tests for `mountCaseQuest` world injection;
  e2e driver runs against the generated Case 3 world as the acceptance gate.
