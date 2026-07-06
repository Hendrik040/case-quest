# Milestone 3: Pokémon-Style Presentation — Design

**Date:** 2026-07-07
**Status:** Approved (flow + state machine approved explicitly; rendering/testing
sections pre-approved by user for overnight implementation)
**Reference:** `docs/superpowers/research/2026-07-07-pokemon-gen3-presentation-grammar.md`
(frame-by-frame analysis of a Pokémon Emerald gameplay capture supplied by the user)

## Goal

Re-present Case Quest in the visual and interaction grammar of Pokémon Emerald
(GBA, Gen 3): a HUD-less tile overworld you walk around, and battle-style
**encounter scenes** for talking to agents. Entering a scenario chains you
through its agents like back-to-back trainer battles; the case decision is a
boss encounter; the debrief plays as end-of-battle text.

User decisions captured during brainstorming:

| Question | Decision |
| --- | --- |
| Encounter trigger | **Auto-sequence on first room entry** (plus walk-up + Space to re-open any agent) |
| Inside an encounter | **Battle menu with topics**: ASK / NOTES / MOVE ON |
| Visual scope | **Full Gen-3 overworld** (grid movement, locked camera, pixel tiles, banners, no HUD) |
| Decision & debrief | **Boss encounter** + debrief as battle text pages |
| Architecture | **Option A**: Phaser overworld, pure-React encounter screens |

## Experience flow

1. **Overworld (roaming).** Grid-committed movement: one input = one full tile
   of travel, tweened; camera hard-locked so the player renders at exact screen
   center at all times (void color beyond map edges — no clamping). No
   persistent HUD; the screen is 100% world. Entering a location slides a wooden
   location banner in at top-left, auto-dismissing after ~2.5s.
2. **Scenario entry.** The first time the player enters a room containing
   agents, the encounter chain triggers after the banner: the overworld freezes
   and desaturates, a light-blue speed-streak band sweeps across carrying the
   agent's sprite (~1s total), then the encounter scene appears.
3. **Encounter scene.** Trainer-battle beats (~1s each): agent sprite slides in
   on the right platform, info boxes pop in, intro line types out ("SAM wants
   to talk!"). Then the action menu:
   - **ASK** — the agent's dialogue topics listed like battle moves. Picking
     one types the fact line into the message box and logs the fact. Used
     topics gray out.
   - **NOTES** — pixel panel listing all facts gathered so far (replaces the
     old HUD fact log).
   - **MOVE ON** — next agent in the chain, or (after the last) a hard cut
     back to the overworld, per the grammar.
4. **Re-visits.** A room's chain auto-triggers only once. Walking up to an
   agent and pressing Space re-opens their single encounter at any time.
5. **Decision.** When the last required fact is gathered, a YES/NO choice box
   asks "Make the decision now?". Decline → keep roaming; a dialogue line
   explains that Enter re-opens it. Accept → **boss encounter**: the decision
   prompt types out in the battle message box, options appear as a move-style
   choice grid, reasoning is typed into a pixel-styled text panel, and the
   debrief plays as end-of-battle text pages with the ending title as the
   "victory screen" headline, followed by objective verdict pages.

## Architecture

Unchanged three-layer split; the deterministic core carries all correctness.

```
GameSession (deterministic, unit-tested)  ←acts/reads→  Phaser WorldScene (overworld only)
        ↑ reads                                          ↕ EventBus
React overlay: banner, transition band, EncounterScreen, DecisionEncounter, DebriefPages
```

### Encounter state machine (GameSession)

New session `mode`: `roaming | encounter | decision | debrief`.

- `enterLocation(locId)` — existing move logic, plus: on *first* entry to a
  location with present actors, queue those actors and switch to
  `encounter` mode (`chain` = queued actor ids).
- `encounterState()` — read view: active actor (id/name/role), phase
  (`intro | menu | topics | revealing | notes`), topics with
  `asked: boolean`, current revealed line, chain position.
- `encounterAsk(topicId)` — consumes a topic, gathers its fact (reusing
  existing fact-gathering rules), returns the line to type out.
- `encounterMoveOn()` — advance the chain; on empty chain returns to
  `roaming` and reports whether the decision just unlocked (drives the
  YES/NO prompt).
- `startEncounterWith(actorId)` — walk-up re-open (single-agent chain).
- `startDecision(decisionId)` / existing `chooseOption()` → `debrief` mode.

Mode transitions are session-internal; Phaser/React only render the current
mode and emit inputs. No `world.json` schema changes: locations are the
scenarios, `actors` the encounters, `dialogue.topics` the moves.

### Overworld (Phaser)

- **Logical canvas 240×160, TILE_SIZE 16** (Gen-3 native), integer zoom
  (nearest-neighbor, `pixelArt: true`) chosen to fit the window; room
  templates keep tile coordinates, so mostly a constant change.
- **Grid movement**: buffered input; each step tweens 16px in ~220ms; holding
  a key chains steps; collisions checked against the tile grid before a step
  (replaces free-velocity physics movement). Turn-in-place on a short tap is
  optional polish, not required.
- **Camera**: exact-center follow, `roundPixels`, no bounds clamp; canvas
  background = void color.
- **Textures** (code-generated, Gen-3-styled): 16×16 tiles — speckled
  grass/floor (2–3 shade cel banding + dither dots), dark-hue-outlined walls,
  door tiles; 16×24 chibi character sprites with 1px dark outlines and a
  distinct palette per role; larger front-view agent sprites (~48px) and a
  player back-view sprite (~64px) for encounter scenes. The texture generator
  moves to a pure module that returns canvases so Phaser registers them as
  textures and React embeds them as data-URLs — one source of truth for art.
- **Transition**: on chain start Phaser pauses; the canvas element gets a CSS
  `grayscale` filter (freeze + desaturate); React animates the speed-streak
  band (CSS repeating-gradient streaks) carrying the agent sprite across;
  encounter screen mounts underneath the band's exit. Budget ~1s.
- **Location banner**: React, wood-plank styling, slides in top-left on
  `location:changed`, auto-dismisses. Suppressed while a dialogue/encounter
  is active (grammar: banners are map-level).

### Encounter layer (React, pixel-skinned DOM)

All encounter UI is DOM, sized via a shared `--px` CSS variable equal to the
canvas zoom so DOM pixels match canvas pixels; `image-rendering: pixelated`
on sprite images; bundled pixel font (OFL-licensed, checked into the repo)
with monospace fallback.

- **EncounterScreen**: full-viewport layer. Cream background, pale-yellow
  pinstripe band at top. Tan CSS-ellipse platforms: agent sprite upper-right
  (smaller, "far"), player back sprite lower-left (larger, "near", clipped by
  the screen edge).
- **Info panels**: agent box upper-left (cream, dark-green border): NAME +
  role tag. Player box mid-right: name + **FACTS bar** (green bar = facts
  gathered / needed — the HP-bar analog) + numeric `got/needed` + a thin blue
  strip along the bottom labeled CASE (progress to decision unlock — the EXP
  analog).
- **Message box**: full-width bottom ~25% height, dark slate-teal fill, thick
  red-orange rounded border, white pixel text with dark shadow, typewriter
  reveal (~35 chars/s), max 2 lines per page with word-wrap pagination, red
  inline blinking advance glyph, Space/Enter/click to advance.
- **Action menu**: Gen-3 style grid in the right half of the bottom box
  (ASK / NOTES / MOVE ON), black triangle cursor, arrow keys + Space, mouse
  hover/click both work. ASK opens the move-list style topics panel (asked
  topics grayed; Esc cancels back).
- **Decision boss encounter**: same screen with "THE DECISION" as the
  opponent; options in the move grid; a confirm YES/NO box; then a
  pixel-styled reasoning textarea panel (white, teal border) with a Commit
  button (Enter). Feeds the existing `chooseOption()`.
- **DebriefPages**: ending title as large headline beat, then summary, "what
  actually happened", choices with reasoning, and objective verdicts as
  successive message-box pages; ends on a static summary panel.

Old `Hud`, `DialogueBox`, `DecisionScene`, `Debrief` components are replaced
by the new pixel UI set.

### Input map

Arrows = move / menu navigation · Space = interact / advance / confirm ·
Esc/X = cancel · Enter = open unlocked decision (and Commit in the reasoning
panel).

## Error handling

- Invalid `world.json` keeps the existing validation-error screen.
- Session action methods throw on illegal transitions (e.g. `encounterAsk`
  while roaming) — same discipline as existing session methods; UI can only
  emit inputs valid for the rendered mode.
- A location with zero agents never enters `encounter` mode; re-entry never
  re-queues met agents.

## Testing

- **Session unit tests** (bulk of correctness, headless): chain queues on
  first entry only; ask consumes topic + gathers fact exactly once; moveOn
  advances/exits; walk-up re-open; decision unlock reporting; boss decision →
  debrief; illegal-transition throws.
- **Pagination/typewriter**: pure `paginate(text, cols, lines)` function,
  unit-tested.
- **Texture module**: returns canvases of expected sizes for every key.
- **E2E**: the Playwright driver from M2 verification is committed as
  `packages/engine/scripts/e2e-drive.mjs` and extended to play the full new
  loop (enter room → auto chain → ask all topics → move on → decision boss →
  debrief) with screenshots; run against `pnpm dev`.
- `pnpm test`, `pnpm typecheck`, `pnpm build` all green.

## Out of scope (later milestones)

Water/tile animation loops, weather overlays, audio, bike/surf movement,
real commissioned pixel art (generator output remains placeholder-quality,
but now in the Gen-3 style), START menu, saving.
