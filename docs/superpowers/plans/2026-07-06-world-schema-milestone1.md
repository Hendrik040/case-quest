# Case Quest — `world.json` Schema (Milestone 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@case-quest/schema` — the versioned `world.json` v0.1 contract as Zod-derived TypeScript types plus a two-layer `validateWorld()` validator, with the "The Wholesale Offer" toy world and a realistic world as validated test fixtures.

**Architecture:** A pnpm monorepo whose first package, `packages/schema`, is the shared contract both the future engine and pipeline import. Zod schemas are the single source of truth; TS types are `z.infer`'d from them so the contract and validator cannot drift. `validateWorld()` runs Layer 1 (Zod shape) then Layer 2 (custom graph/semantic checks) and returns `{ ok, errors, warnings }` with actionable messages.

**Tech Stack:** TypeScript, Zod (validation + type inference), Vitest (tests), pnpm workspaces.

## Global Constraints

- Node.js >= 20; package manager **pnpm**; TypeScript ^5.5; **Zod ^3.23** (use the Zod 3 API: `z.object`, `z.enum`, `z.literal`, `z.infer`, `safeParse`); Vitest ^2 for tests.
- `schema_version` is exactly the string `"0.1"`.
- **Zod is the single source of truth.** TS types are `z.infer`'d from the Zod schemas — never hand-maintain a duplicate type definition.
- `LocationType` is a **closed enum** = the engine's tilemap-template contract. Extend only deliberately.
- Fact-gating uses an **explicit set** (`requires_facts`), never a fuzzy count — the engine must stay deterministic.
- The validator must reject invalid worlds with **actionable messages** that name the offending IDs (spec requirement).
- Standing project copy/branding rule (not exercised in M1, but never violate): describe the visual style only as "classic top-down RPG"; never compare to Pokémon; never use trademarked assets or names.
- No secrets committed to the repo.
- Source of truth for the schema shape and the toy world content: `docs/superpowers/specs/2026-07-06-case-quest-world-schema-design.md` (§6 schema, §7 validation, §8 toy world). Where this plan says "copy verbatim from spec §8", copy the exact JSON from that committed file.

---

## File Structure

```
case-quest/
  package.json                       # root workspace, scripts
  pnpm-workspace.yaml                # packages/*
  packages/schema/
    package.json                     # @case-quest/schema
    tsconfig.json
    src/
      schema.ts                      # Zod schemas (SINGLE SOURCE OF TRUTH)
      types.ts                       # z.infer'd TS types + LOCATION_TYPES
      graph.ts                       # buildNodeGraph, reachableFrom helpers
      validate.ts                    # validateWorld() + Issue/ValidationResult + all checks
      index.ts                       # barrel exports
    fixtures/
      wholesale-offer.world.json     # toy world (spec §8)
      realistic-case.world.json      # larger world (Task 8)
    test/
      helpers.ts                     # minimalWorld() builder + clone()
      shape.test.ts                  # Layer 1 tests
      references.test.ts             # Task 4 tests
      graph.test.ts                  # Task 5 + 6 tests
      warnings.test.ts               # Task 7 tests
      fixtures.test.ts               # both example worlds validate clean
```

**Note on invalid fixtures:** the spec envisioned one JSON file per error code. This plan realizes that DRY-er: tests start from the toy world (or a `minimalWorld()` builder), deep-clone, mutate one field, and assert the expected code. This tests every rule without maintaining ~16 near-duplicate JSON files. Each mutation is shown in full.

---

## Task 1: Monorepo + schema package scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`
- Create: `packages/schema/package.json`, `packages/schema/tsconfig.json`
- Create: `packages/schema/src/index.ts`, `packages/schema/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working toolchain — `pnpm -C packages/schema test` and `pnpm -C packages/schema typecheck` both run.

- [ ] **Step 1: Create the root workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`package.json` (root):
```json
{
  "name": "case-quest",
  "private": true,
  "version": "0.0.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "build": "pnpm -r build"
  }
}
```

- [ ] **Step 2: Create the schema package manifest**

`packages/schema/package.json`:
```json
{
  "name": "@case-quest/schema",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist", "fixtures"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0", "@types/node": "^20.0.0" }
}
```

- [ ] **Step 3: Create the TypeScript config**

`packages/schema/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "test", "fixtures"]
}
```

- [ ] **Step 4: Create a placeholder barrel and a smoke test**

`packages/schema/src/index.ts`:
```typescript
export const SCHEMA_VERSION = "0.1" as const;
```

`packages/schema/test/smoke.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION } from "../src/index";

describe("toolchain", () => {
  it("exports the schema version", () => {
    expect(SCHEMA_VERSION).toBe("0.1");
  });
});
```

- [ ] **Step 5: Install and run**

Run: `pnpm install`
Then: `pnpm -C packages/schema test`
Expected: 1 test passes.
Then: `pnpm -C packages/schema typecheck`
Expected: no errors.

- [ ] **Step 6: Commit and push**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo and @case-quest/schema package"
git push
```

---

## Task 2: Zod schema + inferred types

**Files:**
- Create: `packages/schema/src/schema.ts`
- Create: `packages/schema/src/types.ts`
- Modify: `packages/schema/src/index.ts`
- Create: `packages/schema/test/schema-parse.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks except the package.
- Produces: `WorldSchema` (Zod) and the types `World`, `Actor`, `Location`, `Fact`, `Decision`, `DecisionOption`, `StoryNode`, `Ending`, `LearningObjective`, `WorldMeta`, `Provenance`, `Persona`, `ActorDialogue`, `FactSource`, `SpriteHints`, `LocationType`, `ActorRole`; plus the const `LOCATION_TYPES`.

- [ ] **Step 1: Write the failing test**

`packages/schema/test/schema-parse.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { WorldSchema, LOCATION_TYPES } from "../src/schema";

const minimal = {
  schema_version: "0.1",
  meta: { case_id: "c", title: "T", synopsis: "S", protagonist_actor_id: "p", start_node_id: "n1" },
  learning_objectives: [{ id: "lo1", text: "x" }],
  actors: [{ id: "p", name: "P", role: "protagonist", is_playable: true,
    persona: { background: "b", personality: "p", communication_style: "c" }, goals: [], knowledge: [] }],
  locations: [{ id: "loc1", name: "L", type: "office", exits: [] }],
  facts: [],
  decisions: [],
  nodes: [{ id: "n1", title: "N", accessible_locations: ["loc1"], present_actors: [], available_facts: [], live_decisions: [] }],
  endings: [{ id: "e1", title: "E", summary: "s", real_case_comparison: "r", lo_outcomes: [] }],
};

describe("WorldSchema", () => {
  it("accepts a shape-valid minimal world", () => {
    expect(WorldSchema.safeParse(minimal).success).toBe(true);
  });
  it("rejects a wrong schema_version", () => {
    expect(WorldSchema.safeParse({ ...minimal, schema_version: "0.2" }).success).toBe(false);
  });
  it("rejects an unknown location type at the shape layer", () => {
    const bad = structuredClone(minimal);
    bad.locations[0].type = "spaceship";
    expect(WorldSchema.safeParse(bad).success).toBe(false);
  });
  it("exposes the closed LocationType enum", () => {
    expect(LOCATION_TYPES).toContain("factory_floor");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/schema test schema-parse`
Expected: FAIL — cannot find module `../src/schema`.

- [ ] **Step 3: Write the Zod schema**

`packages/schema/src/schema.ts`:
```typescript
import { z } from "zod";

export const LOCATION_TYPES = [
  "office", "boardroom", "factory_floor", "shopfront",
  "warehouse", "client_site", "street", "home",
] as const;

export const ActorRoleSchema = z.enum(["protagonist", "npc"]);

export const PersonaSchema = z.object({
  background: z.string(),
  personality: z.string(),
  communication_style: z.string(),
});

export const ActorDialogueSchema = z.object({
  greeting: z.string().optional(),
  topics: z.array(z.object({ fact_id: z.string(), line: z.string() })).optional(),
});

export const SpriteHintsSchema = z.object({
  palette: z.string().optional(),
  label: z.string().optional(),
});

export const ActorSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: ActorRoleSchema,
  is_playable: z.boolean(),
  persona: PersonaSchema,
  goals: z.array(z.string()),
  knowledge: z.array(z.string()),
  dialogue: ActorDialogueSchema.optional(),
  sprite: SpriteHintsSchema.optional(),
});

export const LocationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(LOCATION_TYPES),
  exits: z.array(z.string()),
  art: z.object({ palette: z.string().optional() }).optional(),
});

export const FactSourceSchema = z.object({
  actor_id: z.string().optional(),
  location_id: z.string().optional(),
});

export const FactSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  content: z.string(),
  sources: z.array(FactSourceSchema),
});

export const DecisionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  consequence_text: z.string(),
  illuminates: z.array(z.string()),
  leads_to: z.string().min(1),
});

export const DecisionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  requires_facts: z.array(z.string()),
  options: z.array(DecisionOptionSchema).min(1),
});

export const StoryNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  accessible_locations: z.array(z.string()),
  present_actors: z.array(z.string()),
  available_facts: z.array(z.string()),
  live_decisions: z.array(z.string()),
});

export const EndingSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  real_case_comparison: z.string(),
  lo_outcomes: z.array(z.object({ lo_id: z.string(), verdict: z.string() })),
});

export const LearningObjectiveSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
});

export const ProvenanceSchema = z.object({
  pipeline_version: z.string().optional(),
  extraction_model: z.string().optional(),
  generated_at: z.string().optional(),
  token_usage: z.object({
    input: z.number(),
    output: z.number(),
    total: z.number().optional(),
  }).optional(),
});

export const WorldMetaSchema = z.object({
  case_id: z.string().min(1),
  title: z.string(),
  synopsis: z.string(),
  protagonist_actor_id: z.string().min(1),
  start_node_id: z.string().min(1),
  source_ref: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
});

export const WorldSchema = z.object({
  schema_version: z.literal("0.1"),
  meta: WorldMetaSchema,
  learning_objectives: z.array(LearningObjectiveSchema),
  actors: z.array(ActorSchema),
  locations: z.array(LocationSchema),
  facts: z.array(FactSchema),
  decisions: z.array(DecisionSchema),
  nodes: z.array(StoryNodeSchema),
  endings: z.array(EndingSchema),
});
```

- [ ] **Step 4: Write the inferred types**

`packages/schema/src/types.ts`:
```typescript
import { z } from "zod";
import {
  WorldSchema, WorldMetaSchema, ProvenanceSchema, LearningObjectiveSchema,
  ActorSchema, PersonaSchema, ActorDialogueSchema, SpriteHintsSchema, ActorRoleSchema,
  LocationSchema, FactSchema, FactSourceSchema, DecisionSchema, DecisionOptionSchema,
  StoryNodeSchema, EndingSchema, LOCATION_TYPES,
} from "./schema";

export type World = z.infer<typeof WorldSchema>;
export type WorldMeta = z.infer<typeof WorldMetaSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type LearningObjective = z.infer<typeof LearningObjectiveSchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type Persona = z.infer<typeof PersonaSchema>;
export type ActorDialogue = z.infer<typeof ActorDialogueSchema>;
export type SpriteHints = z.infer<typeof SpriteHintsSchema>;
export type ActorRole = z.infer<typeof ActorRoleSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type FactSource = z.infer<typeof FactSourceSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;
export type StoryNode = z.infer<typeof StoryNodeSchema>;
export type Ending = z.infer<typeof EndingSchema>;
export type LocationType = (typeof LOCATION_TYPES)[number];
```

- [ ] **Step 5: Update the barrel**

`packages/schema/src/index.ts`:
```typescript
export const SCHEMA_VERSION = "0.1" as const;
export * from "./schema";
export * from "./types";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm -C packages/schema test schema-parse`
Expected: 4 tests PASS.
Then: `pnpm -C packages/schema typecheck`
Expected: no errors.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "feat(schema): add Zod world schema and inferred types"
git push
```

---

## Task 3: `validateWorld` Layer 1 (shape) + result types + toy fixture

**Files:**
- Create: `packages/schema/src/validate.ts`
- Modify: `packages/schema/src/index.ts`
- Create: `packages/schema/fixtures/wholesale-offer.world.json`
- Create: `packages/schema/test/helpers.ts`
- Create: `packages/schema/test/shape.test.ts`

**Interfaces:**
- Consumes: `WorldSchema`, `LOCATION_TYPES` from Task 2; `World` type.
- Produces: `validateWorld(input: unknown): ValidationResult`; types `Issue`, `IssueCode`, `ValidationResult`; test helpers `toyWorld()` and `clone(x)`.

- [ ] **Step 1: Create the toy fixture**

Create `packages/schema/fixtures/wholesale-offer.world.json` with the **exact JSON copied verbatim from spec §8** (`docs/superpowers/specs/2026-07-06-case-quest-world-schema-design.md`, the fenced ```json block titled "The Wholesale Offer"). Do not paraphrase — copy it exactly.

- [ ] **Step 2: Create test helpers**

`packages/schema/test/helpers.ts`:
```typescript
import toyJson from "../fixtures/wholesale-offer.world.json";
import type { World } from "../src/types";

export function toyWorld(): World {
  return structuredClone(toyJson) as unknown as World;
}

export function clone<T>(x: T): T {
  return structuredClone(x);
}
```

- [ ] **Step 3: Write the failing test**

`packages/schema/test/shape.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import { toyWorld, clone } from "./helpers";

describe("validateWorld — Layer 1 (shape)", () => {
  it("passes the toy world through Layer 1 (no shape errors)", () => {
    const r = validateWorld(toyWorld());
    expect(r.errors.filter((e) => e.code === "shape_invalid")).toHaveLength(0);
  });

  it("rejects a non-object with a shape error", () => {
    const r = validateWorld(42);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "shape_invalid")).toBe(true);
  });

  it("maps an unknown location type to unknown_location_type with valid types listed", () => {
    const w = clone(toyWorld()) as any;
    w.locations[0].type = "spaceship";
    const r = validateWorld(w);
    expect(r.ok).toBe(false);
    const iss = r.errors.find((e) => e.code === "unknown_location_type");
    expect(iss).toBeDefined();
    expect(iss!.message).toContain("factory_floor");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm -C packages/schema test shape`
Expected: FAIL — cannot find module `../src/validate`.

- [ ] **Step 5: Write the Layer 1 validator**

`packages/schema/src/validate.ts`:
```typescript
import { z } from "zod";
import { WorldSchema, LOCATION_TYPES } from "./schema";
import type { World } from "./types";

export type IssueCode =
  | "shape_invalid"
  | "unknown_location_type"
  | "duplicate_id"
  | "dangling_ref"
  | "protagonist_invalid"
  | "fact_source_empty"
  | "knowledge_mismatch"
  | "start_missing"
  | "no_ending"
  | "graph_cyclic"
  | "unreachable_node"
  | "dead_end_node"
  | "fact_unsolvable"
  | "objective_unused"
  | "actor_reveals_nothing"
  | "fact_unused";

export interface Issue { code: IssueCode; message: string; path?: string; }
export interface ValidationResult { ok: boolean; errors: Issue[]; warnings: Issue[]; }

function mapZodIssues(err: z.ZodError): Issue[] {
  return err.issues.map((iss): Issue => {
    const path = iss.path.join(".");
    if (iss.code === "invalid_enum_value" && iss.path[0] === "locations" && iss.path[iss.path.length - 1] === "type") {
      return {
        code: "unknown_location_type",
        message: `Unknown location.type at ${path}. Valid types: ${LOCATION_TYPES.join(", ")}.`,
        path,
      };
    }
    return { code: "shape_invalid", message: path ? `${path}: ${iss.message}` : iss.message, path };
  });
}

export function validateWorld(input: unknown): ValidationResult {
  const parsed = WorldSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: mapZodIssues(parsed.error), warnings: [] };
  }
  const world: World = parsed.data;
  // Layer 2 checks are added in later tasks:
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  return { ok: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 6: Export the validator**

Append to `packages/schema/src/index.ts`:
```typescript
export * from "./validate";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm -C packages/schema test shape`
Expected: 3 tests PASS.

- [ ] **Step 8: Commit and push**

```bash
git add -A
git commit -m "feat(schema): add validateWorld Layer 1 shape validation + toy fixture"
git push
```

---

## Task 4: Layer 2 — reference integrity checks

**Files:**
- Modify: `packages/schema/src/validate.ts`
- Create: `packages/schema/test/references.test.ts`

**Interfaces:**
- Consumes: `World`, `Issue`, `validateWorld` from Task 3.
- Produces: internal check functions `checkDuplicateIds`, `checkReferences`, `checkProtagonist`, `checkFactSources`, `checkStartAndEndings` (called inside `validateWorld`). Emits codes: `duplicate_id`, `dangling_ref`, `protagonist_invalid`, `fact_source_empty`, `knowledge_mismatch`, `start_missing`, `no_ending`.

- [ ] **Step 1: Write the failing tests**

`packages/schema/test/references.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import { toyWorld } from "./helpers";

function codes(w: unknown): string[] {
  return validateWorld(w).errors.map((e) => e.code);
}

describe("Layer 2 — reference integrity", () => {
  it("the toy world has no reference errors", () => {
    expect(validateWorld(toyWorld()).errors).toHaveLength(0);
  });

  it("duplicate_id: two actors sharing an id", () => {
    const w = toyWorld();
    w.actors.push({ ...w.actors[1], name: "Clone" }); // reuse "roaster" id
    expect(codes(w)).toContain("duplicate_id");
  });

  it("dangling_ref: decision requires an unknown fact", () => {
    const w = toyWorld();
    w.decisions[0].requires_facts.push("fact_missing");
    expect(codes(w)).toContain("dangling_ref");
  });

  it("dangling_ref: option leads_to an unknown node/ending", () => {
    const w = toyWorld();
    w.decisions[0].options[0].leads_to = "nowhere";
    expect(codes(w)).toContain("dangling_ref");
  });

  it("protagonist_invalid: protagonist not playable", () => {
    const w = toyWorld();
    const p = w.actors.find((a) => a.id === "owner")!;
    p.is_playable = false;
    expect(codes(w)).toContain("protagonist_invalid");
  });

  it("fact_source_empty: a source with neither actor nor location", () => {
    const w = toyWorld();
    w.facts[0].sources.push({});
    expect(codes(w)).toContain("fact_source_empty");
  });

  it("knowledge_mismatch: actor source not in actor.knowledge", () => {
    const w = toyWorld();
    const roaster = w.actors.find((a) => a.id === "roaster")!;
    roaster.knowledge = []; // roaster is still a source of fact_capacity
    expect(codes(w)).toContain("knowledge_mismatch");
  });

  it("start_missing: start_node_id resolves to nothing", () => {
    const w = toyWorld();
    w.meta.start_node_id = "ghost";
    expect(codes(w)).toContain("start_missing");
  });

  it("no_ending: zero endings", () => {
    const w = toyWorld();
    w.endings = [];
    expect(codes(w)).toContain("no_ending");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/schema test references`
Expected: the mutation tests FAIL (codes not yet emitted); the "no reference errors" test passes.

- [ ] **Step 3: Add the check functions and wire them in**

In `packages/schema/src/validate.ts`, add these functions above `validateWorld`:
```typescript
function checkDuplicateIds(world: World): Issue[] {
  const issues: Issue[] = [];
  const collections: [string, { id: string }[]][] = [
    ["actors", world.actors],
    ["locations", world.locations],
    ["facts", world.facts],
    ["decisions", world.decisions],
    ["learning_objectives", world.learning_objectives],
  ];
  for (const [name, items] of collections) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) issues.push({ code: "duplicate_id", message: `Duplicate id "${item.id}" in ${name}.`, path: name });
      seen.add(item.id);
    }
  }
  for (const d of world.decisions) {
    const seen = new Set<string>();
    for (const o of d.options) {
      if (seen.has(o.id)) issues.push({ code: "duplicate_id", message: `Duplicate option id "${o.id}" in decision "${d.id}".`, path: `decisions.${d.id}.options` });
      seen.add(o.id);
    }
  }
  const nodeEndingSeen = new Set<string>();
  for (const n of world.nodes) {
    if (nodeEndingSeen.has(n.id)) issues.push({ code: "duplicate_id", message: `Duplicate node/ending id "${n.id}".`, path: "nodes" });
    nodeEndingSeen.add(n.id);
  }
  for (const e of world.endings) {
    if (nodeEndingSeen.has(e.id)) issues.push({ code: "duplicate_id", message: `Duplicate node/ending id "${e.id}".`, path: "endings" });
    nodeEndingSeen.add(e.id);
  }
  return issues;
}

function checkReferences(world: World): Issue[] {
  const issues: Issue[] = [];
  const actorIds = new Set(world.actors.map((a) => a.id));
  const locationIds = new Set(world.locations.map((l) => l.id));
  const factIds = new Set(world.facts.map((f) => f.id));
  const loIds = new Set(world.learning_objectives.map((o) => o.id));
  const decisionIds = new Set(world.decisions.map((d) => d.id));
  const nodeIds = new Set(world.nodes.map((n) => n.id));
  const endingIds = new Set(world.endings.map((e) => e.id));
  const nodeOrEnding = new Set([...nodeIds, ...endingIds]);

  const ref = (ok: boolean, msg: string, path: string) => { if (!ok) issues.push({ code: "dangling_ref", message: msg, path }); };

  ref(actorIds.has(world.meta.protagonist_actor_id), `meta.protagonist_actor_id "${world.meta.protagonist_actor_id}" does not match any actor.`, "meta.protagonist_actor_id");

  for (const a of world.actors) {
    for (const fid of a.knowledge) ref(factIds.has(fid), `actor "${a.id}" knowledge references unknown fact "${fid}".`, `actors.${a.id}.knowledge`);
    for (const t of a.dialogue?.topics ?? []) ref(factIds.has(t.fact_id), `actor "${a.id}" dialogue topic references unknown fact "${t.fact_id}".`, `actors.${a.id}.dialogue`);
  }
  for (const l of world.locations) for (const ex of l.exits) ref(locationIds.has(ex), `location "${l.id}" exit references unknown location "${ex}".`, `locations.${l.id}.exits`);
  for (const f of world.facts) for (const s of f.sources) {
    if (s.actor_id !== undefined) ref(actorIds.has(s.actor_id), `fact "${f.id}" source references unknown actor "${s.actor_id}".`, `facts.${f.id}.sources`);
    if (s.location_id !== undefined) ref(locationIds.has(s.location_id), `fact "${f.id}" source references unknown location "${s.location_id}".`, `facts.${f.id}.sources`);
  }
  for (const d of world.decisions) {
    for (const fid of d.requires_facts) ref(factIds.has(fid), `decision "${d.id}" requires unknown fact "${fid}".`, `decisions.${d.id}.requires_facts`);
    for (const o of d.options) {
      for (const lo of o.illuminates) ref(loIds.has(lo), `option "${o.id}" illuminates unknown objective "${lo}".`, `decisions.${d.id}.options.${o.id}.illuminates`);
      ref(nodeOrEnding.has(o.leads_to), `option "${o.id}" leads_to unknown node/ending "${o.leads_to}".`, `decisions.${d.id}.options.${o.id}.leads_to`);
    }
  }
  for (const n of world.nodes) {
    for (const lid of n.accessible_locations) ref(locationIds.has(lid), `node "${n.id}" accessible_locations references unknown location "${lid}".`, `nodes.${n.id}.accessible_locations`);
    for (const aid of n.present_actors) ref(actorIds.has(aid), `node "${n.id}" present_actors references unknown actor "${aid}".`, `nodes.${n.id}.present_actors`);
    for (const fid of n.available_facts) ref(factIds.has(fid), `node "${n.id}" available_facts references unknown fact "${fid}".`, `nodes.${n.id}.available_facts`);
    for (const did of n.live_decisions) ref(decisionIds.has(did), `node "${n.id}" live_decisions references unknown decision "${did}".`, `nodes.${n.id}.live_decisions`);
  }
  for (const e of world.endings) for (const o of e.lo_outcomes) ref(loIds.has(o.lo_id), `ending "${e.id}" lo_outcomes references unknown objective "${o.lo_id}".`, `endings.${e.id}.lo_outcomes`);
  return issues;
}

function checkProtagonist(world: World): Issue[] {
  const issues: Issue[] = [];
  const protagonists = world.actors.filter((a) => a.role === "protagonist");
  if (protagonists.length !== 1) issues.push({ code: "protagonist_invalid", message: `Expected exactly one actor with role "protagonist", found ${protagonists.length}.`, path: "actors" });
  const p = world.actors.find((a) => a.id === world.meta.protagonist_actor_id);
  if (p) {
    if (p.role !== "protagonist") issues.push({ code: "protagonist_invalid", message: `meta.protagonist_actor_id "${p.id}" has role "${p.role}", expected "protagonist".`, path: "meta.protagonist_actor_id" });
    if (!p.is_playable) issues.push({ code: "protagonist_invalid", message: `Protagonist "${p.id}" must have is_playable: true.`, path: `actors.${p.id}.is_playable` });
  }
  return issues;
}

function checkFactSources(world: World): Issue[] {
  const issues: Issue[] = [];
  const actorById = new Map(world.actors.map((a) => [a.id, a]));
  for (const f of world.facts) {
    for (const s of f.sources) {
      if (s.actor_id === undefined && s.location_id === undefined) {
        issues.push({ code: "fact_source_empty", message: `fact "${f.id}" has a source with neither actor_id nor location_id.`, path: `facts.${f.id}.sources` });
      }
      if (s.actor_id !== undefined) {
        const a = actorById.get(s.actor_id);
        if (a && !a.knowledge.includes(f.id)) issues.push({ code: "knowledge_mismatch", message: `fact "${f.id}" lists actor "${s.actor_id}" as a source, but that actor's knowledge does not include it.`, path: `facts.${f.id}.sources` });
      }
    }
  }
  return issues;
}

function checkStartAndEndings(world: World): Issue[] {
  const issues: Issue[] = [];
  const nodeIds = new Set(world.nodes.map((n) => n.id));
  if (!nodeIds.has(world.meta.start_node_id)) issues.push({ code: "start_missing", message: `meta.start_node_id "${world.meta.start_node_id}" does not match any node.`, path: "meta.start_node_id" });
  if (world.endings.length === 0) issues.push({ code: "no_ending", message: `World has no endings; at least one is required.`, path: "endings" });
  return issues;
}
```

Then update `validateWorld`'s Layer 2 section:
```typescript
  const errors: Issue[] = [
    ...checkDuplicateIds(world),
    ...checkReferences(world),
    ...checkProtagonist(world),
    ...checkFactSources(world),
    ...checkStartAndEndings(world),
  ];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/schema test references`
Expected: all tests PASS.
Then: `pnpm -C packages/schema test shape` — still PASS.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "feat(schema): add Layer 2 reference-integrity validation"
git push
```

---

## Task 5: Layer 2 — graph structure checks

**Files:**
- Create: `packages/schema/src/graph.ts`
- Modify: `packages/schema/src/validate.ts`
- Modify: `packages/schema/src/index.ts`
- Create: `packages/schema/test/helpers.ts` (extend with `minimalWorld`)
- Create: `packages/schema/test/graph.test.ts`

**Interfaces:**
- Consumes: `World` type.
- Produces: `buildNodeGraph(world): NodeGraph` (`{ nodeIds: Set<string>; endingIds: Set<string>; edges: Map<string, string[]> }`) and `reachableFrom(start, edges, skip?): Set<string>` in `graph.ts`; check function `checkGraph` emitting `dead_end_node`, `unreachable_node`, `graph_cyclic`; test helper `minimalWorld(): World`.

- [ ] **Step 1: Add the graph helpers**

`packages/schema/src/graph.ts`:
```typescript
import type { World } from "./types";

export interface NodeGraph {
  nodeIds: Set<string>;
  endingIds: Set<string>;
  edges: Map<string, string[]>; // story node id -> target ids (node or ending)
}

export function buildNodeGraph(world: World): NodeGraph {
  const nodeIds = new Set(world.nodes.map((n) => n.id));
  const endingIds = new Set(world.endings.map((e) => e.id));
  const decisionById = new Map(world.decisions.map((d) => [d.id, d]));
  const edges = new Map<string, string[]>();
  for (const n of world.nodes) {
    const targets: string[] = [];
    for (const did of n.live_decisions) {
      const d = decisionById.get(did);
      if (!d) continue;
      for (const o of d.options) targets.push(o.leads_to);
    }
    edges.set(n.id, targets);
  }
  return { nodeIds, endingIds, edges };
}

export function reachableFrom(start: string, edges: Map<string, string[]>, skip: Set<string> = new Set()): Set<string> {
  const seen = new Set<string>();
  if (skip.has(start)) return seen;
  seen.add(start);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const next of edges.get(cur) ?? []) {
      if (skip.has(next) || seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}
```

- [ ] **Step 2: Extend test helpers with `minimalWorld`**

Append to `packages/schema/test/helpers.ts`:
```typescript
import type { World } from "../src/types";

// A tiny valid 2-node branching world used for graph/solvability tests.
export function minimalWorld(): World {
  return {
    schema_version: "0.1",
    meta: { case_id: "min", title: "Min", synopsis: "s", protagonist_actor_id: "owner", start_node_id: "n1" },
    learning_objectives: [{ id: "lo1", text: "objective" }],
    actors: [
      { id: "owner", name: "Owner", role: "protagonist", is_playable: true, persona: { background: "b", personality: "p", communication_style: "c" }, goals: [], knowledge: [] },
      { id: "guide", name: "Guide", role: "npc", is_playable: false, persona: { background: "b", personality: "p", communication_style: "c" }, goals: [], knowledge: ["f1"] },
    ],
    locations: [{ id: "loc1", name: "Room", type: "office", exits: [] }],
    facts: [{ id: "f1", label: "F1", content: "info", sources: [{ actor_id: "guide", location_id: "loc1" }] }],
    decisions: [
      { id: "d1", prompt: "go?", requires_facts: ["f1"], options: [
        { id: "goA", label: "A", consequence_text: "a", illuminates: ["lo1"], leads_to: "n2" },
        { id: "goB", label: "B", consequence_text: "b", illuminates: ["lo1"], leads_to: "end_bad" },
      ] },
      { id: "d2", prompt: "finish?", requires_facts: [], options: [
        { id: "fin", label: "Finish", consequence_text: "c", illuminates: ["lo1"], leads_to: "end_good" },
      ] },
    ],
    nodes: [
      { id: "n1", title: "Start", accessible_locations: ["loc1"], present_actors: ["guide"], available_facts: ["f1"], live_decisions: ["d1"] },
      { id: "n2", title: "Second", accessible_locations: ["loc1"], present_actors: [], available_facts: [], live_decisions: ["d2"] },
    ],
    endings: [
      { id: "end_bad", title: "Bad", summary: "s", real_case_comparison: "r", lo_outcomes: [{ lo_id: "lo1", verdict: "v" }] },
      { id: "end_good", title: "Good", summary: "s", real_case_comparison: "r", lo_outcomes: [{ lo_id: "lo1", verdict: "v" }] },
    ],
  };
}
```

- [ ] **Step 3: Write the failing tests**

`packages/schema/test/graph.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import { minimalWorld } from "./helpers";

function codes(w: unknown): string[] {
  return validateWorld(w).errors.map((e) => e.code);
}

describe("Layer 2 — graph structure", () => {
  it("minimalWorld validates clean", () => {
    expect(validateWorld(minimalWorld()).ok).toBe(true);
    expect(validateWorld(minimalWorld()).warnings).toHaveLength(0);
  });

  it("dead_end_node: a reachable node with no onward decision", () => {
    const w = minimalWorld();
    w.decisions[0].options[1].leads_to = "n3"; // goB -> n3
    w.nodes.push({ id: "n3", title: "Dead", accessible_locations: ["loc1"], present_actors: [], available_facts: [], live_decisions: [] });
    expect(codes(w)).toContain("dead_end_node");
  });

  it("unreachable_node: a node nothing leads to", () => {
    const w = minimalWorld();
    w.nodes.push({ id: "orphan", title: "Orphan", accessible_locations: ["loc1"], present_actors: [], available_facts: [], live_decisions: ["d2"] });
    expect(codes(w)).toContain("unreachable_node");
  });

  it("graph_cyclic: an option loops back to an ancestor", () => {
    const w = minimalWorld();
    w.decisions[1].options[0].leads_to = "n1"; // n2 -> n1, cycle
    expect(codes(w)).toContain("graph_cyclic");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm -C packages/schema test graph`
Expected: the three mutation tests FAIL (codes not emitted yet).

- [ ] **Step 5: Add `checkGraph` and wire it in**

In `packages/schema/src/validate.ts`, add the import at the top:
```typescript
import { buildNodeGraph, reachableFrom } from "./graph";
```
Add the function:
```typescript
function checkGraph(world: World): Issue[] {
  const issues: Issue[] = [];
  const { nodeIds, endingIds, edges } = buildNodeGraph(world);

  for (const n of world.nodes) {
    const outs = edges.get(n.id) ?? [];
    if (outs.length === 0) issues.push({ code: "dead_end_node", message: `node "${n.id}" has no live decision leading onward (dead end).`, path: `nodes.${n.id}` });
  }

  if (nodeIds.has(world.meta.start_node_id)) {
    const reached = reachableFrom(world.meta.start_node_id, edges);
    for (const id of [...nodeIds, ...endingIds]) {
      if (!reached.has(id)) issues.push({ code: "unreachable_node", message: `node/ending "${id}" is not reachable from start "${world.meta.start_node_id}".`, path: "nodes" });
    }
  }

  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, WHITE);
  const dfs = (id: string): boolean => {
    color.set(id, GREY);
    for (const next of edges.get(id) ?? []) {
      if (!nodeIds.has(next)) continue; // endings are sinks
      const c = color.get(next);
      if (c === GREY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const id of nodeIds) {
    if (color.get(id) === WHITE && dfs(id)) {
      issues.push({ code: "graph_cyclic", message: `The story node graph contains a cycle (beats must move forward).`, path: "nodes" });
      break;
    }
  }
  return issues;
}
```
Add `...checkGraph(world),` to the `errors` array in `validateWorld`.

- [ ] **Step 6: Export graph helpers**

Append to `packages/schema/src/index.ts`:
```typescript
export * from "./graph";
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm -C packages/schema test graph`
Expected: all PASS.
Then: `pnpm -C packages/schema test` — all prior suites still PASS.

- [ ] **Step 8: Commit and push**

```bash
git add -A
git commit -m "feat(schema): add Layer 2 graph structure validation (cycles, reachability, dead ends)"
git push
```

---

## Task 6: Layer 2 — fact-solvability (soft-lock prevention)

**Files:**
- Modify: `packages/schema/src/validate.ts`
- Modify: `packages/schema/test/graph.test.ts`

**Interfaces:**
- Consumes: `buildNodeGraph`, `reachableFrom` (Task 5); `World`.
- Produces: check function `checkFactSolvability` emitting `fact_unsolvable`.

- [ ] **Step 1: Write the failing test**

Append to `packages/schema/test/graph.test.ts`:
```typescript
describe("Layer 2 — fact solvability", () => {
  it("fact_unsolvable: a required fact is only reachable on a later/other branch", () => {
    const w = minimalWorld();
    // Remove f1 from the start node and make it discoverable only at n2 (after d1).
    w.nodes[0].available_facts = [];         // n1 no longer offers f1
    w.nodes[1].available_facts = ["f1"];     // n2 offers f1
    // d1 (live at n1) still requires f1 -> unlockable only with info you can't have yet.
    const r = validateWorld(w);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("fact_unsolvable");
    const iss = r.errors.find((e) => e.code === "fact_unsolvable")!;
    expect(iss.message).toContain("f1");
    expect(iss.message).toContain("n1");
  });

  it("does not flag a fact available at the decision's own node", () => {
    const r = validateWorld(minimalWorld()); // f1 is available at n1 where d1 lives
    expect(r.errors.some((e) => e.code === "fact_unsolvable")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/schema test graph`
Expected: the `fact_unsolvable` test FAILS (code not emitted).

- [ ] **Step 3: Add `checkFactSolvability` and wire it in**

In `packages/schema/src/validate.ts`, add:
```typescript
function checkFactSolvability(world: World): Issue[] {
  const issues: Issue[] = [];
  const { nodeIds, edges } = buildNodeGraph(world);
  const start = world.meta.start_node_id;
  if (!nodeIds.has(start)) return issues; // start_missing reported elsewhere

  const decisionById = new Map(world.decisions.map((d) => [d.id, d]));
  const providers = new Map<string, Set<string>>();
  for (const n of world.nodes) for (const fid of n.available_facts) {
    if (!providers.has(fid)) providers.set(fid, new Set());
    providers.get(fid)!.add(n.id);
  }

  for (const n of world.nodes) {
    for (const did of n.live_decisions) {
      const d = decisionById.get(did);
      if (!d) continue;
      for (const fid of d.requires_facts) {
        const provs = providers.get(fid) ?? new Set<string>();
        if (provs.has(n.id)) continue; // available at the decision's own node
        // If n is still reachable with all provider nodes removed, some path avoids the fact.
        const reachedAvoiding = reachableFrom(start, edges, provs);
        if (reachedAvoiding.has(n.id)) {
          issues.push({
            code: "fact_unsolvable",
            message: `decision "${d.id}" in node "${n.id}" requires fact "${fid}", but that fact is not guaranteed discoverable on every path to "${n.id}" — a player could reach the decision without it.`,
            path: `nodes.${n.id}.live_decisions`,
          });
        }
      }
    }
  }
  return issues;
}
```
Add `...checkFactSolvability(world),` to the `errors` array in `validateWorld`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/schema test graph`
Expected: all PASS.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "feat(schema): add Layer 2 fact-solvability check (prevents decision soft-locks)"
git push
```

---

## Task 7: Layer 2 — warnings

**Files:**
- Modify: `packages/schema/src/validate.ts`
- Create: `packages/schema/test/warnings.test.ts`

**Interfaces:**
- Consumes: `World`, `validateWorld`.
- Produces: check function `checkWarnings` emitting `objective_unused`, `fact_unused`, `actor_reveals_nothing`, wired into the `warnings` array.

- [ ] **Step 1: Write the failing tests**

`packages/schema/test/warnings.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import { toyWorld } from "./helpers";

function warnCodes(w: unknown): string[] {
  return validateWorld(w).warnings.map((x) => x.code);
}

describe("Layer 2 — warnings", () => {
  it("the toy world has no warnings", () => {
    expect(validateWorld(toyWorld()).warnings).toHaveLength(0);
  });

  it("objective_unused: an objective no option/ending illuminates", () => {
    const w = toyWorld();
    w.learning_objectives.push({ id: "lo_orphan", text: "unused" });
    expect(warnCodes(w)).toContain("objective_unused");
  });

  it("fact_unused: a fact required by no decision", () => {
    const w = toyWorld();
    w.facts.push({ id: "fact_extra", label: "Extra", content: "trivia", sources: [{ location_id: "back_office" }] });
    expect(warnCodes(w)).toContain("fact_unused");
  });

  it("actor_reveals_nothing: a present actor who can reveal none of the node's facts", () => {
    const w = toyWorld();
    // Add a bystander present in the node but holding no fact available there.
    w.actors.push({ id: "bystander", name: "Bystander", role: "npc", is_playable: false,
      persona: { background: "b", personality: "p", communication_style: "c" }, goals: [], knowledge: [] });
    w.nodes[0].present_actors.push("bystander");
    expect(warnCodes(w)).toContain("actor_reveals_nothing");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/schema test warnings`
Expected: the three mutation tests FAIL.

- [ ] **Step 3: Add `checkWarnings` and wire it in**

In `packages/schema/src/validate.ts`, add:
```typescript
function checkWarnings(world: World): Issue[] {
  const issues: Issue[] = [];

  const illuminated = new Set<string>();
  for (const d of world.decisions) for (const o of d.options) for (const lo of o.illuminates) illuminated.add(lo);
  for (const e of world.endings) for (const o of e.lo_outcomes) illuminated.add(o.lo_id);
  for (const o of world.learning_objectives) {
    if (!illuminated.has(o.id)) issues.push({ code: "objective_unused", message: `learning objective "${o.id}" is not illuminated by any option or ending.`, path: `learning_objectives.${o.id}` });
  }

  const requiredFacts = new Set<string>();
  for (const d of world.decisions) for (const fid of d.requires_facts) requiredFacts.add(fid);
  for (const f of world.facts) {
    if (!requiredFacts.has(f.id)) issues.push({ code: "fact_unused", message: `fact "${f.id}" is required by no decision.`, path: `facts.${f.id}` });
  }

  const actorById = new Map(world.actors.map((a) => [a.id, a]));
  for (const n of world.nodes) {
    const avail = new Set(n.available_facts);
    for (const aid of n.present_actors) {
      const a = actorById.get(aid);
      if (!a) continue;
      const revealsSomething = a.knowledge.some((fid) => avail.has(fid));
      if (!revealsSomething) issues.push({ code: "actor_reveals_nothing", message: `actor "${aid}" is present in node "${n.id}" but can reveal none of its available_facts.`, path: `nodes.${n.id}.present_actors` });
    }
  }
  return issues;
}
```
Update the `warnings` line in `validateWorld`:
```typescript
  const warnings: Issue[] = [...checkWarnings(world)];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/schema test warnings`
Expected: all PASS.
Then: `pnpm -C packages/schema test` — every suite PASS.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "feat(schema): add Layer 2 warnings (unused objective/fact, mute actor)"
git push
```

---

## Task 8: Realistic example world + README + final green sweep

**Files:**
- Create: `packages/schema/fixtures/realistic-case.world.json`
- Create: `packages/schema/test/fixtures.test.ts`
- Create: `packages/schema/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a larger validated world fixture and package documentation.

- [ ] **Step 1: Write the failing fixtures test**

`packages/schema/test/fixtures.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import toy from "../fixtures/wholesale-offer.world.json";
import realistic from "../fixtures/realistic-case.world.json";

describe("example worlds validate clean", () => {
  it("the toy world has zero errors and zero warnings", () => {
    const r = validateWorld(toy);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("the realistic world has zero errors and zero warnings", () => {
    const r = validateWorld(realistic);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/schema test fixtures`
Expected: FAIL — cannot find `../fixtures/realistic-case.world.json`.

- [ ] **Step 3: Author the realistic world fixture**

Create `packages/schema/fixtures/realistic-case.world.json`: a larger world modeling a market-entry case (protagonist = a CEO). Requirements it MUST satisfy so it validates clean (verify each against Task 4–7 rules as you write):
- `schema_version: "0.1"`.
- 2–3 learning objectives, each illuminated by at least one option or ending.
- 4–5 actors: exactly one `role: "protagonist"` with `is_playable: true` (referenced by `meta.protagonist_actor_id`); the rest NPCs, each with a non-empty `knowledge` list; every actor listed as a fact source must include that fact in its `knowledge`.
- 3–4 locations, `type` drawn only from `LOCATION_TYPES`, `exits` all resolving.
- 4–6 facts, each with ≥1 source (actor and/or location) that resolves; every fact required by at least one decision (no `fact_unused` warning).
- 2–3 decisions; each `requires_facts` discoverable at its own node or a guaranteed-earlier node (no `fact_unsolvable`); every option `leads_to` a real node or ending.
- 3–4 story nodes forming an acyclic graph from `meta.start_node_id`; every non-ending node has ≥1 onward decision; every node/ending reachable from start.
- 2–3 endings, each with `lo_outcomes` referencing real objectives.
- Every `present_actor` in a node can reveal at least one of that node's `available_facts` (no `actor_reveals_nothing`).

Model it on a real-style case (you may invent an original one, e.g. a mid-market retailer deciding whether to enter e-commerce). Keep all names original — no trademarked companies or characters.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/schema test fixtures`
Expected: both tests PASS. If the realistic world reports issues, fix the fixture (the validator is correct — the fixture must conform) until `errors` and `warnings` are both empty.

- [ ] **Step 5: Write the package README**

Create `packages/schema/README.md`:
````markdown
# @case-quest/schema

The `world.json` v0.1 contract for Case Quest: Zod schemas, `z.infer`'d TypeScript
types, and a two-layer `validateWorld()` validator. This package decouples the Case
Pipeline (which produces `world.json`) from the Game Engine (which consumes it).

## Usage

```typescript
import { validateWorld, WorldSchema, type World } from "@case-quest/schema";

const result = validateWorld(JSON.parse(raw));
if (!result.ok) {
  for (const e of result.errors) console.error(`[${e.code}] ${e.message}`);
  throw new Error("Invalid world.json");
}
const world: World = result.parsedOrThrow; // or re-parse with WorldSchema
```

`validateWorld(input)` returns `{ ok, errors, warnings }`:
- **Layer 1** (Zod) checks shape, types, enums, and `schema_version === "0.1"`.
- **Layer 2** checks semantics: duplicate/dangling IDs, exactly one playable
  protagonist, fact-source integrity, an acyclic reachable node graph with no
  dead ends, and **fact-solvability** (a decision's required facts must be
  discoverable on every path that reaches it — no soft-locks).

Errors reject the world; warnings (unused objective/fact, an NPC who can reveal
nothing where they stand) flag suspect content without rejecting it.

## Fixtures

- `fixtures/wholesale-offer.world.json` — the toy world ("The Wholesale Offer").
- `fixtures/realistic-case.world.json` — a larger market-entry world.

Both validate with zero errors and zero warnings; the test suite asserts it.

## Development

```bash
pnpm -C packages/schema test        # run the suite
pnpm -C packages/schema typecheck   # type-check
pnpm -C packages/schema build       # emit dist/
```
````

Note: the README's `result.parsedOrThrow` line is illustrative pseudocode; if you want a typed parsed value, call `WorldSchema.parse(input)` after `validateWorld` reports `ok`. (No code depends on a `parsedOrThrow` field — do not add one unless a later milestone needs it.)

- [ ] **Step 6: Final green sweep**

Run: `pnpm -C packages/schema test`
Expected: every suite PASS.
Run: `pnpm -C packages/schema typecheck`
Expected: no errors.
Run: `pnpm -C packages/schema build`
Expected: `dist/` emitted, no errors.

- [ ] **Step 7: Commit and push**

```bash
git add -A
git commit -m "feat(schema): add realistic example world, fixtures test, and package README"
git push
```

---

## Self-Review

**Spec coverage** (spec §1–§10 → task):
- §6 schema (all entities) → Task 2 (`schema.ts`, `types.ts`).
- §7 Layer 1 shape + `unknown_location_type` → Task 3.
- §7 errors `duplicate_id`, `dangling_ref`, `protagonist_invalid`, `fact_source_empty`, `knowledge_mismatch`, `start_missing`, `no_ending` → Task 4.
- §7 errors `graph_cyclic`, `unreachable_node`, `dead_end_node` → Task 5.
- §7 error `fact_unsolvable` (dominator/every-path semantics) → Task 6.
- §7 warnings `objective_unused`, `actor_reveals_nothing`, `fact_unused` → Task 7.
- §8 toy world fixture → Task 3; validates clean → Task 8.
- §9 deliverables (schema, validator, two example worlds, tests) → Tasks 2–8; realistic world + README → Task 8.
- §3 principle "requires_facts is an explicit set" → enforced by schema (Task 2) and solvability check (Task 6).
- §4 "validator is the pipeline's Load gate" → `validateWorld` is the reusable entry point (Task 3+), documented in README (Task 8).

**Placeholder scan:** no "TBD/TODO/implement later". The realistic fixture (Task 8) is specified by explicit conformance requirements plus a concrete example premise, not left vague. The README's `parsedOrThrow` is explicitly flagged as illustrative with the real alternative given.

**Type consistency:** `validateWorld`, `Issue`, `IssueCode`, `ValidationResult`, `buildNodeGraph`, `reachableFrom`, `NodeGraph`, and all check-function names (`checkDuplicateIds`, `checkReferences`, `checkProtagonist`, `checkFactSources`, `checkStartAndEndings`, `checkGraph`, `checkFactSolvability`, `checkWarnings`) are consistent across tasks. Types (`World`, `Actor`, …) are used identically where referenced. `LOCATION_TYPES` const and `LocationType` type names match spec §6.

**Note on validator ordering:** Layer 2 checks run only after Layer 1 passes, so all check functions receive a shape-valid `World`. When a shape error exists, `validateWorld` returns early with only Layer 1 issues — Layer 2 codes won't appear alongside `shape_invalid`. Tests account for this by mutating otherwise-valid worlds (structure stays valid; one semantic field breaks).
