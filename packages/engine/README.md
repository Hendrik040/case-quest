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
arrow keys to move, **Space** to interact (talk to an NPC, investigate a
`?` pickup, or use an `exit` door).

## Design

The deterministic `GameSession` (`src/state/`) holds all game logic and is
unit-tested without a browser. Phaser (`src/phaser/`) only renders and emits
input; React (`src/ui/`) draws the overlay; they communicate via the typed
`EventBus` (`src/bridge/`). Art is code-generated placeholder ("classic
top-down RPG" style) — swapped for real pixel art in a later milestone.

Doors require the interact key (never trigger on mere proximity) and take
priority over an overlapping pickup, so an exit can't be shadowed. In dev
builds the engine exposes `window.__cqScene` / `window.__cqBus` for automated
verification (stripped from production builds via `import.meta.env.DEV`).

## Test

```bash
pnpm -C packages/engine test        # state core, placement, bridge, templates (Vitest)
pnpm -C packages/engine typecheck
pnpm -C packages/engine build
```

Rendering is verified by launching the app and driving it in a browser
(Playwright); the deterministic state core carries the correctness weight in
unit tests.
