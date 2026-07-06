# @case-quest/schema

The `world.json` v0.1 contract for Case Quest: Zod schemas, `z.infer`'d TypeScript
types, and a two-layer `validateWorld()` validator. This package decouples the Case
Pipeline (which produces `world.json`) from the Game Engine (which consumes it) — it
is the single artifact both sides agree on, and the acceptance gate for pipeline output.

## Usage

```typescript
import { validateWorld, WorldSchema, type World } from "@case-quest/schema";

const input: unknown = JSON.parse(raw);
const result = validateWorld(input);

if (!result.ok) {
  for (const e of result.errors) console.error(`[${e.code}] ${e.message}${e.path ? ` (${e.path})` : ""}`);
  throw new Error("Invalid world.json");
}
for (const w of result.warnings) console.warn(`[${w.code}] ${w.message}`);

// Shape already validated; parse once more to obtain the typed value.
const world: World = WorldSchema.parse(input);
```

`validateWorld(input)` returns `{ ok, errors, warnings }`:

- **Layer 1** (Zod) checks shape, types, enums, and `schema_version === "0.1"`.
- **Layer 2** checks semantics: duplicate/dangling IDs, exactly one playable
  protagonist, fact-source integrity, an acyclic reachable node graph with no dead
  ends, and **fact-solvability** — a decision's required facts must be discoverable on
  *every* path that reaches it, so no player can hit a decision they can never unlock.

Errors reject the world; warnings (an unused objective or fact, an NPC who can reveal
nothing where they stand) flag suspect content without rejecting it.

## Fixtures

- `fixtures/wholesale-offer.world.json` — the toy world ("The Wholesale Offer"): one
  fact-gated decision branching to two endings.
- `fixtures/realistic-case.world.json` — a larger market-entry world with a three-node
  branching graph and three endings.

Both validate with zero errors and zero warnings; `test/fixtures.test.ts` asserts it.

## Development

```bash
pnpm -C packages/schema test        # run the suite (Vitest)
pnpm -C packages/schema typecheck   # type-check src + tests
pnpm -C packages/schema build       # emit dist/ (entry: dist/index.js)
```
