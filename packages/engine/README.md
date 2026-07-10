# @case-quest/engine

A Vite + React + Phaser 3 client that plays any valid Case Quest `world.json`.
It loads a world, validates it with `@case-quest/schema`, and renders it as a
Pokémon-Emerald-style game: walk the map, get pulled into an encounter with
each NPC in a location, ask them about the facts they know, gather facts left
on the map, unlock the fact-gated decision, choose (capturing your written
reasoning), and read the debrief.

## Run

```bash
pnpm -C packages/schema build   # engine imports the built schema package
pnpm -C packages/engine dev     # play at the printed localhost URL
```

Loads `public/worlds/wholesale-offer.world.json` (the toy world).

### Controls

- **Arrow keys** — move (grid-committed: each press/hold steps one 16px tile,
  ~220ms per step) in the overworld; move the cursor in any menu/grid
  (ASK/NOTES/MOVE ON, a topic grid, a decision's options).
- **Space** — context-sensitive: in the overworld, interact with whatever
  you're facing (talk to an NPC, investigate a `?` fact pickup, or use a
  door — all three require a deliberate press, never mere proximity); in a
  dialogue box, type out the current page instantly, or advance to the
  next page/close the box once fully typed.
- **Enter** — same as Space inside menus/typewriters; also a global shortcut
  to jump straight into the first unlocked decision while roaming (skipping
  the "a decision has become clear" prompt); submits the decision's written
  reasoning (Shift+Enter for a literal newline instead).
- **Escape** — back out of a topics grid to the action menu, or cancel out
  of a decision's prompt/options/confirm step (not available once you've
  reached the reasoning box — losing typed reasoning to an accidental Esc
  would be worse than not having the escape hatch there).

## Design

The deterministic `GameSession` (`src/state/`) holds all game logic — the
roaming/encounter/decision/debrief state machine, fact gathering, and the
encounter chain — and is unit-tested without a browser. Phaser
(`src/phaser/WorldScene`) only renders the map and emits input events; React
(`src/ui/pixel/`) draws every overlay (location banner, transition band,
encounter screen, decision encounter, debrief pages); they communicate via
the typed `EventBus` (`src/bridge/`). Art is code-generated placeholder
("classic top-down RPG" / Gen-3 battle-screen style) — swapped for real pixel
art in a later milestone.

Entering an unvisited location with NPCs present auto-triggers its encounter
chain (freeze + grayscale the world, sweep in a transition band, then the
first agent's encounter screen); doors and fact pickups still require the
interact key aimed at the facing tile, never mere proximity, so an exit or a
`?` can't be triggered by walking past it. The auto-chain is best-effort: it
fires after a ~1.2s entry window, and if you start another interaction during
that window it yields — every agent stays reachable regardless by walking up
and pressing Space. In dev builds the engine exposes
`window.__cqScene`, `window.__cqSession`, and `window.__cqBus` for automated
verification (stripped from production builds via `import.meta.env.DEV`).

## Test

```bash
pnpm -C packages/engine test        # state core, placement, bridge, templates, UI paginate (Vitest)
pnpm -C packages/engine typecheck
pnpm -C packages/engine build
```

## E2E playthrough

```bash
pnpm -C packages/schema build
(pnpm -C packages/engine dev &) && sleep 3   # dev server must be up first
pnpm -C packages/engine e2e                  # plays the whole case, screenshots every beat
pnpm -C packages/engine e2e --smoke          # boot through the first beat, then stop
CQ_WORLD_URL=/worlds/other.world.json pnpm -C packages/engine e2e
                                             # play a different world (any valid v0.1)
```

`scripts/e2e-drive.mjs` (headless real Chrome via `playwright-core`, no
bundled Chromium download) plays any valid world.json v0.1 world start to
finish with a world-agnostic strategy loop driven by live session state
(`window.__cqSession` / `window.__cqScene`): encounters exhaust every unasked
topic then MOVE ON; roaming gathers ungathered fact orbs, talks to actors
that can still reveal something, and takes doors toward the nearest
unvisited location; a decision prompt is always entered, picking the FIRST
option with a generic reasoning line; the debrief reel is advanced to the
terminal panel. A hard step cap fails the run loudly instead of wandering an
unwinnable world forever. It then asserts
`window.__cqSession.mode() === "debrief"` with zero page errors. Defaults to
the committed "wholesale-offer" fixture (`CQ_WORLD_URL` overrides — see
above); screenshots land in `e2e-shots/` (gitignored) so a human can eyeball
the diorama grammar (platforms, panels, message-box skins).

Two techniques the driver relies on, hard-won by driving this UI:

- **Never `keyboard.press()` a game key.** Phaser's keyboard manager (and
  this kit's own `window` keydown handlers) can miss an instantaneous
  down/up pair, and ignores OS auto-repeat outright — every press is a
  distinct `down()` → hold ~130-150ms → `up()`.
- **Movement is grid-committed and polled, not timed.** `WorldScene.stepTo`
  updates the player's logical tile the instant a step *begins*, well
  before its ~220ms tween finishes, so the driver holds a direction and
  polls `__cqScene.getPlayerTile()` for the tile to change (then releases)
  instead of blind-waiting a fixed duration. `__cqScene.getRoomGrid()` and
  `__cqScene.getInteractables()` (dev-only, alongside `getPlayerTile()`)
  let the driver do its own BFS pathfinding to any NPC/fact/door without
  hardcoding template geometry.

Rendering is verified by launching the app and driving it in a real browser;
the deterministic state core carries the correctness weight in unit tests.
