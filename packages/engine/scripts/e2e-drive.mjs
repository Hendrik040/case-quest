#!/usr/bin/env node
// Committed end-to-end playthrough driver for @case-quest/engine.
//
// World-agnostic: instead of a fixed script of beats, the driver runs a
// state-driven strategy loop off the DEV handles (`window.__cqSession`,
// `window.__cqScene`) until the session reaches debrief:
//
//   while mode() !== "debrief":
//     - an encounter on screen  -> exhaust every unasked topic, then MOVE ON
//     - a decision prompt       -> enter it (DECIDE NOW)
//     - a decision encounter    -> pick the FIRST option (deterministic),
//                                  confirm YES, submit a generic reasoning line
//     - a field message         -> advance it away
//     - roaming, no overlay     -> gather any ungathered fact orb here, talk to
//                                  any actor with unasked available facts, else
//                                  take a door toward the nearest unvisited
//                                  location; with nothing left, press Enter if
//                                  the first live decision is unlocked
//   then advance the debrief reel to the terminal panel.
//
// A hard cap on strategy steps fails the run loudly instead of wandering
// forever on an unwinnable world. Defaults to the committed
// "wholesale-offer" toy case; set CQ_WORLD_URL to drive any other valid
// world.json v0.1 world — nothing below knows any world's actors, rooms,
// chain lengths, or option order. Screenshots every beat to `e2e-shots/`
// (gitignored) so a human can eyeball the diorama grammar (platforms,
// panels, message-box skins).
//
// Usage:
//   pnpm -C packages/engine dev &            # dev server must already be up
//   pnpm -C packages/engine e2e              # full playthrough
//   pnpm -C packages/engine e2e --smoke      # boot through the first beat, then stop
//   CQ_WORLD_URL=/worlds/other.world.json pnpm -C packages/engine e2e
//                                             # drive a different world; unset,
//                                             # behavior is unchanged.
//
// Hard-won rules baked into the helpers below (see README's "e2e" section):
//  - Launch real installed Chrome (`channel: "chrome"`) — no bundled Chromium
//    download needed.
//  - Never `keyboard.press()` a game key. Phaser's keyboard plugin (and this
//    kit's own `window` keydown listeners) can miss an instantaneous
//    down/up pair, and Phaser ignores OS auto-repeat outright — every press
//    is a distinct `down()` -> hold -> `up()`.
//  - Movement is grid-committed (~220ms tween per tile; input is ignored
//    mid-tween). `WorldScene.stepTo` sets the logical tile the *instant* a
//    step begins, well before the tween finishes, so holding a direction and
//    polling `__cqScene.getPlayerTile()` for the tile to change (then
//    releasing) is both correct and fast — no fixed sleep-and-hope.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = join(__dirname, "..", "e2e-shots");
const BASE_URL = process.env.CQ_E2E_URL ?? "http://localhost:5173";
// When set, drive the standalone page against this world instead of its
// default (public/worlds/wholesale-offer.world.json). Threaded through as a
// `?world=` query param that App.tsx's standalone fetch branch honors
// (dev/test-only seam — see App.tsx's resolveWorldUrl); unset, the driven
// page's boot is byte-identical to before this flag existed.
const CQ_WORLD_URL = process.env.CQ_WORLD_URL;
const GOTO_URL = CQ_WORLD_URL ? `${BASE_URL}?world=${encodeURIComponent(CQ_WORLD_URL)}` : BASE_URL;
const SMOKE = process.argv.includes("--smoke");

// Hard cap on strategy-loop iterations (each iteration dispatches one action:
// an encounter turn, an orb pickup, a door transit, an overlay advance, ...).
// The wholesale-offer fixture finishes in ~15; anything past this cap means
// the driver is wandering (an unwinnable world, or a bug) — fail loudly.
const MAX_STEPS = 400;
// Generic, world-agnostic reasoning line for the decision's ReasoningPanel
// (which requires non-empty trimmed text before Enter submits).
const REASONING_LINE =
  "Weighing everything gathered so far, this option is the most defensible call available right now.";

mkdirSync(SHOTS_DIR, { recursive: true });

let shotIndex = 0;
async function shot(page, name) {
  const file = join(SHOTS_DIR, `${String(++shotIndex).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  shot: ${file}`);
}

// --- low-level input helpers -------------------------------------------------

/** Never keyboard.press() a game key: hold long enough for Phaser/React to observe it. */
async function press(page, key, holdMs = 140, settleMs = 140) {
  await page.keyboard.down(key);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(key);
  if (settleMs) await page.waitForTimeout(settleMs);
}

function sameTile(a, b) {
  return !!a && !!b && a.tx === b.tx && a.ty === b.ty;
}

async function getPlayerTile(page) {
  return page.evaluate(() => window.__cqScene.getPlayerTile());
}
async function getRoomGrid(page) {
  return page.evaluate(() => window.__cqScene.getRoomGrid());
}
async function sessionMode(page) {
  return page.evaluate(() => window.__cqSession.mode());
}
async function currentLocationId(page) {
  return page.evaluate(() => window.__cqSession.currentLocationId());
}

/**
 * One live snapshot for the strategy loop: the session's mode/position plus
 * which overlays are on screen right now (by testid — cheaper and racier-
 * proof than six separate locator round-trips).
 */
async function readState(page) {
  return page.evaluate(() => {
    const has = (t) => !!document.querySelector(`[data-testid="${t}"]`);
    const s = window.__cqSession;
    return {
      mode: s.mode(),
      nodeId: s.currentNode().id,
      locationId: s.currentLocationId(),
      overlays: {
        transition: has("transition-band"),
        encounter: has("encounter"),
        fieldMsg: has("field-msg"),
        decisionPrompt: has("decision-prompt"),
        decisionEncounter: has("decision-encounter"),
        debrief: has("debrief"),
      },
    };
  });
}
function anyOverlay(state) {
  return Object.values(state.overlays).some(Boolean);
}

/**
 * Holds one arrow key until the player's logical tile changes — grid-
 * committed movement updates `tx/ty` the instant a step *begins* (see
 * `WorldScene.stepTo`), well before its ~220ms tween finishes — or until
 * `maxHold` elapses (a blocked step "just turns": the tile never changes).
 * Always releases the key before returning, then settles past the tween so
 * the next decision reads a `moving === false` world.
 */
async function walkStep(page, dir, { minHold = 150, maxHold = 900, poll = 40, settle = 160 } = {}) {
  const before = await getPlayerTile(page);
  await page.keyboard.down(dir);
  await page.waitForTimeout(minHold);
  let after = await getPlayerTile(page);
  let waited = minHold;
  while (sameTile(after, before) && waited < maxHold) {
    await page.waitForTimeout(poll);
    waited += poll;
    after = await getPlayerTile(page);
  }
  await page.keyboard.up(dir);
  await page.waitForTimeout(settle);
  return !sameTile(after, before);
}

// --- pathfinding over WorldScene's live blocked-grid -------------------------

const DIRS = [
  { dx: 0, dy: -1, key: "ArrowUp" },
  { dx: 0, dy: 1, key: "ArrowDown" },
  { dx: -1, dy: 0, key: "ArrowLeft" },
  { dx: 1, dy: 0, key: "ArrowRight" },
];

/** BFS over `grid.blocked`; returns an ordered list of arrow-key names, or null if unreachable. */
function bfsPath(grid, start, goal) {
  if (start.tx === goal.tx && start.ty === goal.ty) return [];
  const key = (t) => `${t.tx},${t.ty}`;
  const seen = new Set([key(start)]);
  const prev = new Map();
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const d of DIRS) {
      const nx = cur.tx + d.dx;
      const ny = cur.ty + d.dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      if (grid.blocked[ny][nx]) continue;
      const nk = `${nx},${ny}`;
      if (seen.has(nk)) continue;
      seen.add(nk);
      prev.set(nk, { from: cur, dirKey: d.key });
      if (nx === goal.tx && ny === goal.ty) {
        const path = [];
        let ck = nk;
        while (ck !== key(start)) {
          const p = prev.get(ck);
          path.push(p.dirKey);
          ck = key(p.from);
        }
        return path.reverse();
      }
      queue.push({ tx: nx, ty: ny });
    }
  }
  return null;
}

async function walkPath(page, dirs) {
  for (const dir of dirs) {
    let ok = await walkStep(page, dir);
    for (let retry = 0; !ok && retry < 2; retry++) ok = await walkStep(page, dir);
    if (!ok) throw new Error(`walkPath: stuck trying to step ${dir}`);
  }
}

function inBounds(t, grid) {
  return t.tx >= 0 && t.ty >= 0 && t.tx < grid.width && t.ty < grid.height;
}

/**
 * The (up to four) ways to approach `target` — one per cardinal side. Each
 * option's `anchor` is two tiles out and `adjacent` is one tile out; walking
 * to `anchor` and then taking exactly one more step (`key`, toward `target`)
 * lands on `adjacent` *and* leaves the player facing `target` — with no
 * separate "bump into it to turn" press needed, and critically without ever
 * stepping onto `target` itself. That last part matters: fact-orb and door
 * tiles are handled differently by `WorldScene.isBlocked` (a door sits on a
 * wall tile and blocks; a fact orb does not), so a naive "walk toward it"
 * would happily walk right past/onto an orb. Anchoring two tiles out and
 * taking one final, deliberate step sidesteps both cases uniformly.
 */
function approachOptions(target, grid) {
  const sides = [
    { anchor: { tx: target.tx, ty: target.ty + 2 }, adjacent: { tx: target.tx, ty: target.ty + 1 }, key: "ArrowUp" },
    { anchor: { tx: target.tx, ty: target.ty - 2 }, adjacent: { tx: target.tx, ty: target.ty - 1 }, key: "ArrowDown" },
    { anchor: { tx: target.tx + 2, ty: target.ty }, adjacent: { tx: target.tx + 1, ty: target.ty }, key: "ArrowLeft" },
    { anchor: { tx: target.tx - 2, ty: target.ty }, adjacent: { tx: target.tx - 1, ty: target.ty }, key: "ArrowRight" },
  ];
  return sides.filter(
    (s) =>
      inBounds(s.anchor, grid) &&
      inBounds(s.adjacent, grid) &&
      !grid.blocked[s.anchor.ty][s.anchor.tx] &&
      !grid.blocked[s.adjacent.ty][s.adjacent.tx],
  );
}

/** Walk to, and face, `target` (an entry from `getInteractables()`), then press Space to interact with it. */
async function approachAndInteract(page, target) {
  const grid = await getRoomGrid(page);
  const tile = await getPlayerTile(page);
  const options = approachOptions(target, grid);
  let chosen = null;
  let path = null;
  for (const opt of options) {
    const p = bfsPath(grid, tile, opt.anchor);
    if (p) {
      chosen = opt;
      path = p;
      break;
    }
  }
  if (!chosen) throw new Error(`no reachable approach to ${target.kind}:${target.id}`);
  await walkPath(page, path);
  const stepped = await walkStep(page, chosen.key); // anchor -> adjacent; also sets facing toward target
  if (!stepped) throw new Error(`approach step blocked for ${target.kind}:${target.id}`);
  await press(page, "Space");
}

// --- UI helpers ---------------------------------------------------------------

/**
 * Most overlay root nodes are themselves the positioned/sized element (e.g.
 * `.cq-encounter`, `.cq-action-menu`) and Playwright's `visible` state is the
 * right check. `field-msg` and `decision-prompt`, though, are plain `<div>`s
 * whose only children (`MessageBox`/`ChoiceBox`) are `position: absolute` —
 * so the wrapper itself collapses to a zero-height box (its children are
 * positioned against `.cq-stage`, not it) and Playwright's strict
 * `visible` check calls that "hidden" even though the real content is
 * rendered and on-screen. Not a product bug (nothing a player sees is
 * affected), just a testability nuance of an untouched wrapper div — so
 * these two testids are waited for via `attached` instead of `visible`.
 */
const ATTACHED_ONLY = new Set(["[data-testid=field-msg]", "[data-testid=decision-prompt]"]);

async function waitVisible(page, selector, timeout = 10000) {
  const state = ATTACHED_ONLY.has(selector) ? "attached" : "visible";
  await page.locator(selector).first().waitFor({ state, timeout });
}

async function testidCount(page, selector) {
  return page.locator(selector).count();
}

/**
 * Presses Space repeatedly until the typewriter currently on screen is gone
 * (the overlay moved to a phase with no `Typewriter` mounted) — handles
 * single- and multi-page beats uniformly, since a beat that paginates just
 * needs more presses (first press of a page finishes typing it instantly;
 * the next advances/`onDone`s). Used for encounter intros/reveals, field
 * messages, and the whole debrief beat reel alike.
 */
async function exhaustTypewriter(page, maxPresses = 40) {
  for (let i = 0; i < maxPresses; i++) {
    if ((await testidCount(page, "[data-testid=typewriter]")) === 0) return;
    await press(page, "Space", 130, 130);
  }
  throw new Error("exhaustTypewriter: typewriter never advanced away");
}

// --- world-agnostic strategy -----------------------------------------------------

/**
 * A room was just entered (or the game just booted): the location banner is
 * up and — if this (node, location) hosts NPCs and hasn't been visited —
 * `App` will auto-start an encounter chain ~1200ms in (then a transition
 * band, then the encounter). Poll until some overlay appears or the window
 * comfortably passes with nothing, so the roaming logic never starts walking
 * into a world that's about to freeze under it.
 */
async function waitForOverlayOrSettle(page, timeoutMs = 3000, poll = 150) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await readState(page);
    if (anyOverlay(state) || Date.now() >= deadline) return state;
    await page.waitForTimeout(poll);
  }
}

/**
 * One actor's turn inside an encounter (chain or single): advance the intro
 * typewriter to the action menu, ASK every topic that isn't already asked
 * (the cursor always boots on the first *enabled* entry — for the action
 * menu that's ASK whenever any topic exists, and for the topics grid the
 * first unasked topic — so plain Space presses stay deterministic), then
 * navigate to MOVE ON. With the cursor on the first enabled action, one
 * ArrowUp wraps to the last action (MOVE ON) whether or not ASK is disabled.
 */
async function runEncounterTurn(page) {
  const view = await page.evaluate(() => window.__cqSession.encounterState());
  if (!view) return; // the chain advanced between reads; the loop re-dispatches
  console.log(`encounter: ${view.actorId} (${view.chainIndex + 1}/${view.chainLength})`);
  await exhaustTypewriter(page); // intro -> menu
  await waitVisible(page, "[data-testid=action-menu]");
  await shot(page, `action-menu-${view.actorId}`);

  for (let asks = 0; ; asks++) {
    if (asks > 60) throw new Error(`encounter with ${view.actorId}: topics never exhausted`);
    const topics = await page.evaluate(() => window.__cqSession.encounterState()?.topics ?? []);
    if (!topics.some((t) => !t.asked)) break;
    await press(page, "Space"); // ASK (first enabled action)
    await waitVisible(page, "[data-testid=topics-panel]");
    if (asks === 0) await shot(page, `topics-panel-${view.actorId}`);
    await press(page, "Space"); // pick the first unasked topic
    await waitVisible(page, "[data-testid=typewriter]");
    await page.waitForTimeout(250); // let a few characters type in before the screenshot
    if (asks === 0) await shot(page, `reveal-${view.actorId}`);
    await exhaustTypewriter(page); // reveal -> back to menu
    await waitVisible(page, "[data-testid=action-menu]");
  }

  await press(page, "ArrowUp"); // first enabled action -> wraps to MOVE ON
  await press(page, "Space");
  await page.waitForTimeout(250);
}

/**
 * The decision encounter: prompt typewriter -> option list -> confirm ->
 * reasoning. Deterministic, world-agnostic picks: the FIRST option (the
 * cursor boots there) and YES on the confirm (ditto), with a generic
 * non-empty reasoning line.
 */
async function runDecisionEncounter(page) {
  await waitVisible(page, "[data-testid=decision-encounter]");
  await exhaustTypewriter(page); // prompt -> options
  await waitVisible(page, "[data-testid=choice-box]");
  await shot(page, "decision-options");
  await press(page, "Space"); // pick the FIRST option

  await waitVisible(page, "[data-testid=choice-box]"); // the yes/no confirm
  await press(page, "Space"); // confirm YES

  await waitVisible(page, "[data-testid=reasoning-panel]");
  await page.locator("[data-testid=reasoning-textarea]").fill(REASONING_LINE);
  await shot(page, "decision-reasoning");
  await press(page, "Enter"); // submit
  await page.waitForTimeout(300); // let the commit render (debrief or the next node's room)
}

/** Advance the debrief beat reel (length scales with the world) to the terminal panel. */
async function runDebrief(page) {
  console.log("reading the debrief ...");
  await waitVisible(page, "[data-testid=debrief]");
  await page.waitForTimeout(250);
  await shot(page, "debrief-page");
  await exhaustTypewriter(page, 200);
  await waitVisible(page, "[data-testid=debrief-final]");
  await shot(page, "debrief-final");
}

/**
 * BFS over the current node's location-exit graph from `from` to the nearest
 * location whose room key isn't in `visitedRooms`; returns the first hop's
 * location id (a door in the current room leads to it, by construction of
 * `resolvePlacement`'s doorTargets), or null when every reachable location
 * has been visited.
 */
function nextHopToUnvisited(info, visitedRooms) {
  const seen = new Set([info.locationId]);
  const queue = [{ id: info.locationId, firstHop: null }];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of info.exits[cur.id] ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const firstHop = cur.firstHop ?? next;
      if (!visitedRooms.has(`${info.nodeId}:${next}`)) return firstHop;
      queue.push({ id: next, firstHop });
    }
  }
  return null;
}

/**
 * One roaming action, in priority order: gather an ungathered fact orb in
 * this room; talk to an actor who can still reveal an available, ungathered
 * fact (normally the auto-chain already covered everyone — this is the
 * fallback when it couldn't run); take a door toward the nearest unvisited
 * location; with nothing left to explore, press Enter (the engine's global
 * shortcut) if the first live decision is unlocked. Returns false when
 * there is truly nothing to do — the caller treats that as a stuck world.
 */
async function roamingAction(page, visitedRooms) {
  const info = await page.evaluate(() => {
    const s = window.__cqSession;
    const world = s.world();
    const node = s.currentNode();
    const accessible = node.accessible_locations;
    const exits = {};
    for (const lid of accessible) {
      const loc = world.locations.find((l) => l.id === lid);
      exits[lid] = (loc?.exits ?? []).filter((e) => accessible.includes(e));
    }
    const first = s.liveDecisions()[0];
    return {
      nodeId: node.id,
      locationId: s.currentLocationId(),
      exits,
      decisionUnlocked: !!first && s.isDecisionUnlocked(first.id),
      interactables: window.__cqScene.getInteractables().map((it) => {
        if (it.kind === "fact") return { ...it, exhausted: s.isFactGathered(it.id) };
        if (it.kind === "actor") {
          const actor = world.actors.find((a) => a.id === it.id);
          const open = (actor?.knowledge ?? []).filter(
            (f) => node.available_facts.includes(f) && !s.isFactGathered(f),
          );
          return { ...it, exhausted: open.length === 0 };
        }
        return { ...it, exhausted: false }; // door — visited tracking is driver-side
      }),
    };
  });

  const orb = info.interactables.find((it) => it.kind === "fact" && !it.exhausted);
  if (orb) {
    console.log(`gathering fact orb ${orb.id} ...`);
    await approachAndInteract(page, orb);
    await waitVisible(page, "[data-testid=field-msg]");
    await page.waitForTimeout(300); // let more of the line type in before the screenshot
    await shot(page, `field-msg-${orb.id}`);
    return true;
  }

  const npc = info.interactables.find((it) => it.kind === "actor" && !it.exhausted);
  if (npc) {
    console.log(`approaching ${npc.id} directly ...`);
    await approachAndInteract(page, npc);
    await waitVisible(page, "[data-testid=encounter]", 8000); // transition band -> encounter
    return true;
  }

  const hop = nextHopToUnvisited(info, visitedRooms);
  if (hop) {
    const door = info.interactables.find((it) => it.kind === "door" && it.id === hop);
    if (!door) throw new Error(`no door toward "${hop}" in ${info.locationId}`);
    console.log(`taking the door to ${hop} ...`);
    await approachAndInteract(page, door);
    await waitVisible(page, "[data-testid=location-banner]");
    return true;
  }

  if (info.decisionUnlocked) {
    console.log("decision unlocked -- entering it via Enter ...");
    await press(page, "Enter");
    await waitVisible(page, "[data-testid=decision-encounter]");
    return true;
  }

  return false;
}

// --- main ----------------------------------------------------------------------

const consoleErrors = [];

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
  });

  console.log(`booting ${GOTO_URL} ${SMOKE ? "(smoke)" : "(full playthrough)"} ...`);
  await page.goto(GOTO_URL);
  await page.waitForFunction(() => window.__cqScene && window.__cqSession, null, { timeout: 30000 });
  await page.mouse.click(500, 350); // defensive focus, mirrors the M2 driver
  await page.waitForTimeout(300);

  // Boot is racy on a cold dev server: `__cqScene` is only set once Phaser's
  // scene creates, and if that takes longer than the 1200ms chain-check the
  // location banner has already yielded to the transition band / encounter by
  // the time the handles resolve. Accept any first sign of the UI instead of
  // demanding the banner specifically; the strategy loop dispatches on live
  // state from here anyway.
  await page.waitForFunction(
    () =>
      !!document.querySelector(
        "[data-testid=location-banner], [data-testid=transition-band], [data-testid=encounter]," +
          " [data-testid=field-msg], [data-testid=decision-prompt], [data-testid=decision-encounter], [data-testid=debrief]",
      ),
    null,
    { timeout: 15000 },
  );
  await shot(page, `boot-${await currentLocationId(page)}`);

  if (SMOKE) {
    const settled = await waitForOverlayOrSettle(page);
    await shot(page, "smoke-first-beat");
    console.log(`SMOKE OK -- mode=${settled.mode}, ${consoleErrors.length} page errors`);
    await browser.close();
    process.exit(consoleErrors.length ? 1 : 0);
    return;
  }

  // --- strategy loop: play whatever this world is until it debriefs -------------
  const visitedRooms = new Set();
  let lastRoomKey = null;

  for (let step = 1; ; step++) {
    if (step > MAX_STEPS) {
      throw new Error(`step cap exceeded (${MAX_STEPS}) -- the driver is wandering; is this world winnable?`);
    }
    const state = await readState(page);
    if (state.mode === "debrief") {
      await runDebrief(page);
      break;
    }
    if (state.overlays.transition) {
      await page.waitForTimeout(300); // the band advances itself into the encounter
      continue;
    }
    if (state.overlays.encounter) {
      await runEncounterTurn(page);
      continue;
    }
    if (state.overlays.decisionEncounter) {
      await runDecisionEncounter(page);
      continue;
    }
    if (state.overlays.decisionPrompt) {
      console.log("decision prompt -- entering the decision ...");
      await shot(page, "decision-prompt");
      await press(page, "Space"); // DECIDE NOW (the cursor boots on it)
      continue;
    }
    if (state.overlays.fieldMsg) {
      await exhaustTypewriter(page);
      continue;
    }

    // Roaming with no overlay. On first sight of a room, give its auto-chain
    // check time to fire before walking anywhere.
    const roomKey = `${state.nodeId}:${state.locationId}`;
    if (roomKey !== lastRoomKey) {
      lastRoomKey = roomKey;
      visitedRooms.add(roomKey);
      await shot(page, `roaming-${state.locationId}`);
      const settled = await waitForOverlayOrSettle(page);
      if (anyOverlay(settled)) continue;
    }
    const acted = await roamingAction(page, visitedRooms);
    if (!acted) {
      throw new Error(
        `stuck in ${roomKey}: no ungathered facts, no askable actors, no unvisited locations, and no unlocked decision`,
      );
    }
  }

  const mode = await sessionMode(page);
  console.log(`final mode: ${mode}`);
  if (consoleErrors.length) {
    console.log("PAGE ERRORS:\n" + consoleErrors.join("\n"));
  }

  await browser.close();

  if (mode !== "debrief" || consoleErrors.length) {
    console.error(`PLAYTHROUGH FAILED -- mode=${mode}, ${consoleErrors.length} page errors`);
    process.exit(1);
  }
  console.log(`PLAYTHROUGH COMPLETE -- mode=${mode}, ${consoleErrors.length} page errors`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error("PLAYTHROUGH FAILED:", err);
  if (consoleErrors.length) console.error("PAGE ERRORS:\n" + consoleErrors.join("\n"));
  process.exit(1);
});
