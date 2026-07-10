#!/usr/bin/env node
// Committed end-to-end playthrough driver for @case-quest/engine.
//
// Boots the dev server's page in headless Chrome and plays a two-room, one-
// decision case start to finish: boot -> location banner -> auto-triggered
// encounter chain (two agents) -> a fact picked up off the world map -> a
// door transit -> a second encounter chain (one agent) -> the decision
// prompt -> the decision encounter (options -> confirm -> written reasoning)
// -> the debrief pages -> the terminal panel. Defaults to the committed
// "wholesale-offer" toy case (roaster, buyer, then bookkeeper); set
// CQ_WORLD_URL to drive a different world of the same shape instead — actor
// and location labels below are read live off `window.__cqSession` rather
// than hardcoded. Screenshots every beat to `e2e-shots/` (gitignored) so a
// human can eyeball the diorama grammar (platforms, panels, message-box
// skins).
//
// Usage:
//   pnpm -C packages/engine dev &            # dev server must already be up
//   pnpm -C packages/engine e2e              # full playthrough
//   pnpm -C packages/engine e2e --smoke      # boot through the first encounter, then stop
//   CQ_WORLD_URL=/worlds/other.world.json pnpm -C packages/engine e2e
//                                             # drive a different world (same
//                                             # two-room / two-chain / one-decision
//                                             # shape); unset, behavior is unchanged.
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
async function getInteractables(page) {
  return page.evaluate(() => window.__cqScene.getInteractables());
}
async function sessionMode(page) {
  return page.evaluate(() => window.__cqSession.mode());
}
async function currentLocationId(page) {
  return page.evaluate(() => window.__cqSession.currentLocationId());
}
/** Actor id of the encounter currently on screen, read live rather than assumed. */
async function currentEncounterActorId(page) {
  return page.evaluate(() => window.__cqSession.encounterState()?.actorId ?? "actor");
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
 * the next advances/`onDone`s). Used for encounter intros/reveals and for
 * the whole debrief beat reel alike.
 */
async function exhaustTypewriter(page, maxPresses = 40) {
  for (let i = 0; i < maxPresses; i++) {
    if ((await testidCount(page, "[data-testid=typewriter]")) === 0) return;
    await press(page, "Space", 130, 130);
  }
  throw new Error("exhaustTypewriter: typewriter never advanced away");
}

/**
 * Drives one full agent turn inside the encounter chain: waits out the intro
 * typewriter, opens ASK, picks the (fixture's single) topic, waits out the
 * reveal typewriter, then navigates the action menu to MOVE ON. Assumes
 * exactly one topic per agent, true for every actor in the wholesale-offer
 * fixture this driver plays by default; a multi-topic actor would need this
 * looped. Screenshot/log labels are read live off `window.__cqSession`
 * (rather than passed in hardcoded) so this needs no changes to drive a
 * `CQ_WORLD_URL`-supplied world with the same shape.
 */
async function runAgentEncounter(page) {
  const actorId = await currentEncounterActorId(page);
  console.log(`talking to ${actorId} ...`);
  await exhaustTypewriter(page); // intro -> menu
  await waitVisible(page, "[data-testid=action-menu]");
  await shot(page, `action-menu-${actorId}`);

  await press(page, "Space"); // ASK (cursor defaults to the first, enabled option)
  await waitVisible(page, "[data-testid=topics-panel]");
  await shot(page, `topics-panel-${actorId}`);

  await press(page, "Space"); // pick the (only) topic
  await waitVisible(page, "[data-testid=typewriter]");
  await page.waitForTimeout(250); // let a few characters type in before the screenshot
  await shot(page, `reveal-${actorId}`);
  await exhaustTypewriter(page); // reveal -> back to menu

  await waitVisible(page, "[data-testid=action-menu]");
  await press(page, "ArrowDown"); // ask -> notes
  await press(page, "ArrowDown"); // notes -> move on
  await press(page, "Space");
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

  await waitVisible(page, "[data-testid=location-banner]");
  await shot(page, `banner-${await currentLocationId(page)}`);

  await waitVisible(page, "[data-testid=encounter]", 6000);
  await shot(page, `encounter-${await currentEncounterActorId(page)}-intro`);

  if (SMOKE) {
    const mode = await sessionMode(page);
    console.log(`SMOKE OK -- mode=${mode}, ${consoleErrors.length} page errors`);
    await browser.close();
    process.exit(consoleErrors.length ? 1 : 0);
    return;
  }

  // --- first room: the auto-chain (wholesale-offer: roaster, then buyer) ------
  await runAgentEncounter(page);
  await runAgentEncounter(page);

  const roomOneId = await currentLocationId(page);
  console.log(`waiting for ${roomOneId} chain to end (back to roaming) ...`);
  await page.waitForFunction(() => window.__cqSession.mode() === "roaming", null, { timeout: 8000 });
  await shot(page, `roaming-${roomOneId}`);

  // --- pick up a fact directly off the map --------------------------------------
  console.log("walking to the fact orb ...");
  const roomInteractables = await getInteractables(page);
  const factOrb = roomInteractables.find((i) => i.kind === "fact");
  if (!factOrb) throw new Error(`expected a fact orb in ${roomOneId}`);
  await approachAndInteract(page, factOrb);
  await waitVisible(page, "[data-testid=field-msg]");
  await page.waitForTimeout(400); // let more of the line type in before the screenshot
  await shot(page, `field-msg-fact-${factOrb.id}`);
  await exhaustTypewriter(page);

  // --- take the door to the next room --------------------------------------------
  console.log("walking to the door ...");
  const door = (await getInteractables(page)).find((i) => i.kind === "door");
  if (!door) throw new Error(`expected a door in ${roomOneId}`);
  await approachAndInteract(page, door);

  await waitVisible(page, "[data-testid=location-banner]");
  await shot(page, `banner-${await currentLocationId(page)}`);

  await waitVisible(page, "[data-testid=encounter]", 6000);
  await runAgentEncounter(page);

  // --- the decision unlocks -------------------------------------------------------
  console.log("waiting for the decision prompt ...");
  await waitVisible(page, "[data-testid=decision-prompt]", 8000);
  await shot(page, "decision-prompt");
  await press(page, "Space"); // DECIDE NOW (cursor defaults to it)

  await waitVisible(page, "[data-testid=decision-encounter]");
  await exhaustTypewriter(page); // prompt -> options
  await waitVisible(page, "[data-testid=choice-box]");
  await shot(page, "decision-options");

  await press(page, "ArrowDown"); // accept -> decline
  await press(page, "Space"); // pick "Decline the contract, for now"

  await waitVisible(page, "[data-testid=choice-box]"); // now the yes/no confirm
  await press(page, "Space"); // confirm YES

  await waitVisible(page, "[data-testid=reasoning-panel]");
  await shot(page, "decision-reasoning-empty");
  await page
    .locator("[data-testid=reasoning-textarea]")
    .fill(
      "We only have three months of runway and the roasting floor tops out at 500kg/week against a 900kg/week ask -- " +
        "growth has to wait until capacity and cash can actually support it.",
    );
  await shot(page, "decision-reasoning-filled");
  await press(page, "Enter"); // submit

  // --- debrief -----------------------------------------------------------------------
  console.log("reading the debrief ...");
  await waitVisible(page, "[data-testid=debrief]");
  await page.waitForTimeout(250);
  await shot(page, "debrief-page");
  await exhaustTypewriter(page, 80);

  await waitVisible(page, "[data-testid=debrief-final]");
  await shot(page, "debrief-final");

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
