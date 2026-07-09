# M4: Case → Game Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Professor uploads Case 3 PDF on the n-aible platform → pipeline emits a valid `world.json` v0.1 → student plays it to debrief in the embedded Case Quest engine.

**Architecture:** Python pipeline gains a `world_generation` stage (LLM game-content step + deterministic assembler + schema validation gate) that runs after the existing extraction. Case Quest's engine becomes mountable as a library (`mountCaseQuest(el, world, callbacks)`) and is embedded behind a "Play as game" entry. `world.json` v0.1 stays the single contract; a committed JSON Schema artifact (generated from Zod) is validated on both sides.

**Tech Stack:** TS: Zod, zod-to-json-schema, Vite lib mode, Vitest, playwright-core. Python: FastAPI, SQLAlchemy, OpenAI GPT-4o, `jsonschema`, pytest.

**Repos:**
- CQ = `/Users/hendrikkrack/Desktop/case-quest` (branch `feat/case-to-game-pipeline`)
- NA = `/Users/hendrikkrack/Desktop/n-aible/n-aible_edtech_sims` (create branch `feat/case-quest-world-generation`)

## Global Constraints

- `world.json` `schemaVersion` is exactly `"0.1"` (`SCHEMA_VERSION` in CQ `packages/schema/src/schema.ts`).
- An invalid world is NEVER persisted; on failure `game_ready=false` and the case publishes normally.
- No behavior change to existing NA flows (professor upload, chat sim, autofill). The world stage is additive and failure-isolated.
- CQ gates per task: `pnpm -C packages/<pkg> test && pnpm -C packages/<pkg> typecheck && pnpm -C packages/<pkg> build`.
- NA gates per task: `pytest backend/tests/modules/world_generation -v` (plus any touched module's tests).
- Node ≥20; NA backend Python env is managed with `uv` (see NA `pyproject.toml`).

---

### Task 1: JSON Schema artifact from Zod (CQ)

**Files:**
- Create: `packages/schema/scripts/export-json-schema.ts`
- Create: `packages/schema/artifacts/world.schema.json` (generated, committed)
- Test: `packages/schema/src/artifact.test.ts`
- Modify: `packages/schema/package.json` (add `zod-to-json-schema` dep, `artifact` script)

**Interfaces:**
- Produces: committed artifact `packages/schema/artifacts/world.schema.json` — JSON Schema draft-07 of `WorldSchema`. Regenerated via `pnpm -C packages/schema artifact`. Task 5 (Python validation) consumes a copy of this file.

- [ ] **Step 1: Add dependency + script**

```bash
cd /Users/hendrikkrack/Desktop/case-quest && pnpm -C packages/schema add -D zod-to-json-schema tsx
```

In `packages/schema/package.json` scripts: `"artifact": "tsx scripts/export-json-schema.ts"`.

- [ ] **Step 2: Write failing drift test**

```ts
// packages/schema/src/artifact.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { WorldSchema } from "./schema";

describe("world.schema.json artifact", () => {
  it("matches the current Zod WorldSchema (run `pnpm artifact` if this fails)", () => {
    const artifact = JSON.parse(
      readFileSync(join(__dirname, "../artifacts/world.schema.json"), "utf8")
    );
    const fresh = zodToJsonSchema(WorldSchema, { name: "World", $refStrategy: "none" });
    expect(artifact).toEqual(JSON.parse(JSON.stringify(fresh)));
  });
});
```

- [ ] **Step 3: Run test — expect FAIL** (`ENOENT` on artifacts file): `pnpm -C packages/schema test`

- [ ] **Step 4: Write the exporter and generate**

```ts
// packages/schema/scripts/export-json-schema.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { WorldSchema } from "../src/schema";

const out = zodToJsonSchema(WorldSchema, { name: "World", $refStrategy: "none" });
const dir = join(__dirname, "../artifacts");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "world.schema.json"), JSON.stringify(out, null, 2) + "\n");
console.log("wrote artifacts/world.schema.json");
```

Run: `pnpm -C packages/schema artifact`

- [ ] **Step 5: Gates pass, commit**

`pnpm -C packages/schema test && pnpm -C packages/schema typecheck && pnpm -C packages/schema build`
Commit: `feat(schema): export committed JSON Schema artifact with drift test`

---

### Task 2: `mountCaseQuest` library entry (CQ)

**Files:**
- Create: `packages/engine/src/lib.ts`
- Modify: `packages/engine/src/App.tsx` (accept injected `world` prop; keep fetch fallback for standalone dev)
- Modify: `packages/engine/src/main.tsx` (standalone mode fetches then mounts via the same path)
- Modify: `packages/engine/vite.config.ts` (add lib build via `build --config` or env-switched lib mode, entry `src/lib.ts`, name `CaseQuest`, formats `['es']`, externalize nothing — self-contained bundle)
- Test: `packages/engine/src/lib.test.tsx`

**Interfaces:**
- Produces:
```ts
export interface CaseQuestCallbacks { onDebriefComplete?: (summary: { endingId: string; factsGathered: number; choices: string[] }) => void; }
export interface CaseQuestHandle { unmount(): void; }
export function mountCaseQuest(el: HTMLElement, world: unknown, callbacks?: CaseQuestCallbacks): CaseQuestHandle;
```
`world` is validated inside with `validateWorld`; invalid input throws `Error` with the issue list joined — the host page catches and falls back (Task 7).

- [ ] **Step 1: Write failing tests**

```tsx
// packages/engine/src/lib.test.tsx
import { describe, expect, it } from "vitest";
import { mountCaseQuest } from "./lib";
import worldJson from "../public/worlds/wholesale-offer.world.json";

describe("mountCaseQuest", () => {
  it("throws with validation issues on an invalid world", () => {
    expect(() => mountCaseQuest(document.createElement("div"), { nope: true })).toThrow(/schemaVersion|invalid/i);
  });
  it("mounts a valid world and returns an unmount handle", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const handle = mountCaseQuest(el, worldJson);
    expect(el.childElementCount).toBeGreaterThan(0);
    handle.unmount();
    expect(el.childElementCount).toBe(0);
  });
});
```

Note: the mount test runs in jsdom; Phaser boot inside App must tolerate jsdom (it already does in existing App tests — follow the same canvas-mock setup used there; check `packages/engine/vitest` setup files and reuse).

- [ ] **Step 2: Run — expect FAIL** (`lib.ts` missing): `pnpm -C packages/engine test`

- [ ] **Step 3: Implement**

`App.tsx`: add props `{ world?: World; callbacks?: CaseQuestCallbacks }`. In the boot effect: if `props.world` present, skip fetch and use it (already validated); else current `fetch(WORLD_URL)` path. Where the debrief overlay is entered, call `callbacks?.onDebriefComplete` with `{ endingId, factsGathered, choices }` pulled from `GameSession` (`session.debrief()` DebriefData already carries these — reuse its fields, do not recompute).

```ts
// packages/engine/src/lib.ts
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { validateWorld, type World } from "@case-quest/schema";
import App from "./App";

export interface CaseQuestCallbacks {
  onDebriefComplete?: (summary: { endingId: string; factsGathered: number; choices: string[] }) => void;
}
export interface CaseQuestHandle { unmount(): void; }

export function mountCaseQuest(el: HTMLElement, world: unknown, callbacks?: CaseQuestCallbacks): CaseQuestHandle {
  const result = validateWorld(world);
  if (!result.ok) {
    throw new Error("invalid world: " + result.errors.map((e) => `${e.code} ${e.path ?? ""} ${e.message}`).join("; "));
  }
  const root: Root = createRoot(el);
  root.render(createElement(App, { world: world as World, callbacks }));
  return { unmount: () => root.unmount() };
}
```

(Adjust `validateWorld` result field names to the actual `ValidationResult` shape in `packages/schema/src/validate.ts` — `{ ok, errors, warnings }`, where issues have `code`/`message`; read the file first.)

- [ ] **Step 4: Lib build config** — vite lib mode entry `src/lib.ts` producing `dist/case-quest.es.js`; add script `"build:lib": "vite build --mode lib"` switched in `vite.config.ts` on `mode === "lib"`. Standalone `pnpm build` unchanged.

- [ ] **Step 5: Gates + e2e regression** — `pnpm -C packages/engine test && typecheck && build && build:lib`; with dev server up: `pnpm -C packages/engine e2e` must still complete to debrief. Commit: `feat(engine): mountCaseQuest library entry with injected world`

---

### Task 3: World assembler, deterministic core (NA)

**Files:**
- Create: `backend/modules/world_generation/__init__.py`, `assembler.py`, `schemas.py`
- Create: copy of CQ artifact → `backend/modules/world_generation/world.schema.json`
- Test: `backend/tests/modules/world_generation/test_assembler.py`

**Interfaces:**
- Consumes: `GameContent` (pydantic, defined here in `schemas.py`) — the LLM step's output (Task 4 fills it): `facts: list[GCFact]`, `decisions: list[GCDecision]`, `locations: list[GCLocation]`, `story_nodes: list[GCStoryNode]`, `endings: list[GCEnding]`, plus existing `AIExtractionResult` fields passed alongside.
- Produces: `assemble_world(extraction: AIExtractionResult, content: GameContent) -> dict` — a `world.json`-shaped dict: stable slug ids (`loc-`, `actor-`, `fact-`, `dec-`, `node-`, `end-` prefixes), actors placed in home locations, node graph wired in story order, exactly one protagonist from `student_role`.

- [ ] **Step 1: Write failing tests** — build a small in-memory `GameContent` fixture (2 locations, 2 actors + protagonist, 3 facts, 1 decision requiring 2 facts, 2 nodes, 2 endings); assert: `schemaVersion == "0.1"`; all referenced ids exist; exactly one actor `playable: true`; decision's `requiredFactIds` ⊆ emitted fact ids; node graph edges follow story order.
- [ ] **Step 2: Run — expect FAIL** (module missing): `pytest backend/tests/modules/world_generation/test_assembler.py -v`
- [ ] **Step 3: Implement `schemas.py` + `assembler.py`** — pure functions, no I/O, no LLM. Mirror CQ field names exactly: open CQ `packages/schema/src/schema.ts` and copy the property names verbatim (`schemaVersion`, `meta`, `locations`, `actors`, `facts`, `decisions`, `storyNodes`, `endings`, and their nested keys). Slugify with `re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")`; dedupe with `-2`, `-3` suffixes.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(world-generation): deterministic world.json assembler`

---

### Task 4: LLM game-content extraction (NA)

**Files:**
- Create: `backend/modules/world_generation/extraction.py`
- Test: `backend/tests/modules/world_generation/test_extraction.py`
- Create fixture: `backend/tests/modules/world_generation/fixtures/game_content_sample.json`

**Interfaces:**
- Consumes: `cleaned_content: str`, `title: str`, `personas_result`, `scenes_result`, `learning_outcomes` (the pipeline's existing in-memory results — see `pipeline.py:371-379` for their shapes).
- Produces: `async def extract_game_content(content, title, personas, scenes, outcomes) -> GameContent` — single GPT-4o JSON-only call following the house pattern in `backend/modules/pdf_processing/ai_extraction_service.py` (sync client in `run_in_executor`, semaphore-gated, `response_format={"type": "json_object"}`). On malformed JSON: retry once with the parse error appended to the prompt; then raise `GameContentExtractionError`.

- [ ] **Step 1: Write failing tests** — mock the OpenAI client (patch the same seam `ai_extraction_service` tests patch — read `backend/tests/modules/pdf_processing/test_ai_extraction_service.py` first and copy its mocking approach). Cases: (a) fixture JSON parses into `GameContent`; (b) first response malformed → retried → second parses; (c) both malformed → `GameContentExtractionError`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Prompt requirements (verbatim into the system prompt): every fact anchored to exactly one location or actor by name; each decision lists required facts by fact title and maps each option to `correct | partial | wrong` and to learning outcomes; locations derived from case settings (3–6); story nodes ordered from the provided scenes; 2–3 endings. Output strict JSON matching `GameContent`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(world-generation): GPT game-content extraction with bounded retry`

---

### Task 5: Validation gate + repair loop (NA)

**Files:**
- Create: `backend/modules/world_generation/validation.py`
- Test: `backend/tests/modules/world_generation/test_validation.py`
- Modify: `backend/pyproject.toml`-managed deps: add `jsonschema` (via `uv add jsonschema` in NA root)

**Interfaces:**
- Consumes: assembled world `dict`; artifact `world.schema.json` (copied in Task 3).
- Produces:
  - `validate_world_dict(world: dict) -> list[str]` — empty list = valid. Runs: (1) `jsonschema.validate` against the artifact; (2) node reachability from the start node (port the BFS from CQ `packages/schema/src/graph.ts`); (3) fact-solvability: for every decision, its required facts are gatherable on every path reaching that decision's node (port the check from CQ `packages/schema/src/validate.ts` — read it and mirror the algorithm, don't invent one).
  - `async def repair_world(world: dict, issues: list[str], content: GameContent) -> dict` — ONE LLM call: world + issues → corrected `GameContent`, re-assembled via Task 3's `assemble_world`. Caller re-validates; if still invalid raise `WorldValidationError(issues)`.

- [ ] **Step 1: Write failing tests** — (a) Task 3's fixture world validates clean; (b) world with a dangling `requiredFactIds` entry → schema-or-semantic issue reported; (c) unreachable node reported; (d) repair path: mock LLM returns fixed content → second validation clean; (e) repair fails → `WorldValidationError`.
- [ ] **Step 2: Run — expect FAIL.** / **Step 3: Implement.** / **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(world-generation): schema + semantic validation gate with one-shot repair`

---

### Task 6: Pipeline wiring + persistence + API (NA)

**Files:**
- Create: `backend/modules/world_generation/service.py`
- Modify: `backend/modules/pdf_processing/pipeline.py` (call world stage at the end of `process_full` and `process_full_with_progress`, wrapped in try/except so failure never fails the case)
- Modify: `backend/common/db/models/publishing/simulation.py` (add `world_json = Column(JSON, nullable=True)`, `game_ready = Column(Boolean, nullable=False, server_default="false")`) + an Alembic migration if NA uses Alembic — check `backend/` for `alembic.ini`/migrations dir and follow the house pattern; if schema is managed by `init-db.sql`, update that instead.
- Modify: the simulation read router (find the module serving `GET /simulations/{id}` under `backend/modules/` — likely `publishing` or `simulation`; add `GET /simulations/{id}/world` returning 404 when `game_ready` is false)
- Test: `backend/tests/modules/world_generation/test_service.py`

**Interfaces:**
- Produces: `async def generate_and_store_world(db, simulation_id, extraction, content_inputs) -> bool` — runs extract → assemble → validate(+repair) → persists `world_json`, sets `game_ready=True`, returns `True`; on ANY exception logs, sets `game_ready=False`, returns `False`.

- [ ] **Step 1: Write failing tests** — happy path persists + flags; extraction error → `game_ready=False` and simulation otherwise intact; endpoint returns the JSON when ready, 404 when not.
- [ ] **Step 2: Run — expect FAIL.** / **Step 3: Implement + wire into `pipeline.py`.** / **Step 4: Run full NA touched-module tests — expect PASS** (`pytest backend/tests/modules/world_generation backend/tests/modules/pdf_processing -v`).
- [ ] **Step 5: Commit** `feat(pipeline): world generation stage, world_json persistence, /world endpoint`

---

### Task 7: "Play as game" frontend embed (NA)

**Files:**
- Create: copy of CQ lib bundle → NA `frontend` static assets (exact target dir: follow how NA frontend serves static JS; read `frontend/` build setup first), or add `@case-quest/engine` via file dependency if the frontend build allows.
- Create: `frontend/src/.../PlayAsGame.tsx` (path per NA frontend conventions — mirror where the existing simulation launch UI lives; find it by grepping the frontend for the student case page component)
- Test: component test per NA frontend's existing test setup (if the frontend has no test harness, verify by hand in Step 4 and say so in the report).

**Interfaces:**
- Consumes: `GET /simulations/{id}/world`; `mountCaseQuest(el, world, { onDebriefComplete })` from the Task 2 bundle.
- Produces: a button/tab on the case page, rendered only when the simulation payload has `game_ready: true`; clicking lazy-imports the engine bundle, fetches the world, mounts full-viewport with a close control that calls `handle.unmount()`. Any error (fetch, validation throw) → dismisses to the normal case page with a toast/notice.

- [ ] **Step 1: Locate the student case page component and the API client; write the component with lazy `import()` of the engine bundle.**
- [ ] **Step 2: Wire visibility off `game_ready`.**
- [ ] **Step 3: Error fallback: try/catch around fetch + mount; on error render nothing extra, show notice.**
- [ ] **Step 4: Verify in the running platform (dev servers up): case without world → no button; case with world → game mounts and plays.**
- [ ] **Step 5: Commit** `feat(frontend): Play as game embed for game-ready cases`

---

### Task 8: Case 3 end-to-end acceptance (both repos)

**Files:**
- Create: CQ `packages/engine/scripts/` — no new driver; re-point existing `e2e-drive.mjs` via env var `CQ_WORLD_URL` (add support: default stays the wholesale-offer page).
- Create: NA `backend/scripts/run_case3_world.py` — CLI: run the full pipeline on `/Users/hendrikkrack/Desktop/n-aible/sample-cases/Case 3 (2).pdf` (real LLM calls), print validation result, dump `case3.world.json`.

**Steps:**
- [ ] **Step 1: Run the Case 3 script; iterate on prompt (Task 4) until validation is clean.** Budget: if 3 prompt iterations don't converge, stop and report the failing issues rather than loosening the validator.
- [ ] **Step 2: Copy `case3.world.json` into CQ `packages/engine/public/worlds/`; run the standalone engine + `pnpm e2e` against it (via `CQ_WORLD_URL`). Expected: PLAYTHROUGH COMPLETE, mode=debrief, 0 page errors.** The driver is world-agnostic (BFS off live room grids) but may need topic/decision heuristics generalized — fix driver, not world.
- [ ] **Step 3: Full-platform check: upload Case 3 through the professor flow in the running NA app, confirm `game_ready`, click Play as game, play the opening minute by hand/driver.**
- [ ] **Step 4: Commit both repos** (`test(e2e): accept generated Case 3 world`, `feat: Case 3 world generation verified end-to-end`) **and update CQ README + NA `architecture.md` with the new stage.**

## Self-Review

- Spec coverage: pipeline extension (T3–6), engine embedding (T2, T7), contract/artifact + drift CI (T1), error handling (T4 retry, T5 repair, T6 isolation, T7 fallback), testing + acceptance (T8). Covered.
- Placeholders: NA-side exact paths for router/frontend are discover-first instructions by design (unknown codebase conventions) — each names the discovery step and the pattern to copy.
- Type consistency: `GameContent`/`assemble_world`/`validate_world_dict`/`generate_and_store_world`/`mountCaseQuest` signatures consistent across tasks.
