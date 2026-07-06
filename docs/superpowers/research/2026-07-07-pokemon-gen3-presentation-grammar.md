# POKÉMON GEN 3 (EMERALD) PRESENTATION GRAMMAR
Derived from 144s capture. Native resolution: 240x160 (GBA), 16x16 tile grid, ~15x10 tiles visible. All coordinates below assume the 240x160 native canvas; upscale with nearest-neighbor integer scaling only.

---

## 1. OVERWORLD

**Camera**
- Hard-locked on the player: player sprite renders at exact screen center at all times (all 12 batches agree, zero exceptions in tile-based scenes).
- World scrolls under the player, tile-to-tile, with smooth per-pixel interpolation between grid cells (movement is grid-committed: one input = one full 16px tile of travel).
- Camera never leads, lags, or eases. When the map edge is exceeded, render flat solid void color (pale cyan seen at map boundary) — no border art.
- One exception class: bespoke cutscenes (cable car ride) use hand-authored side-view parallax scenes (sky gradient / mountain ridge / forest layers) with the player composited into a vehicle sprite. Treat as separate scene type, not camera behavior.

**Tiles**
- 16x16 tiles, flat color, 2–3 shade cel banding, heavy dither/speckle texture for ground variation (grass dot speckle, sand pebbles, cobblestone pebble dots).
- Animated tiles: water (2+ frame cycle alternating diagonal white wave-crest pattern and lighter dotted pattern), waterfalls, sparkles in caves, flowers. Animate on a global tile clock (~2–4 frame loops).
- Water reads in two blues: lighter periwinkle for shallow, darker stepped patches for deep. Shallow shelf ring around islands is a distinct light-grey/blue tile.
- Terrain features are grid objects: jump ledges (brown lip strips, one-way), white stair/ramp tiles, tall grass tufts (encounter tiles), tilled soil, item Pokéballs as ground sprites.

**Sprites**
- Player/NPCs: ~16x24 — one tile wide, 1.5 tiles tall; feet anchored to their tile, head overlapping the tile above (draw order: sprite renders above the tile behind it).
- 4 facing directions, 3-frame walk cycle. Distinct sprite sets for: walk, bike, surf (sitting pose on a mount sprite), fishing NPCs, seated/soaking NPCs.
- 1px dark (near-black or dark-hue) outlines, 2–3 step cel shading, big-head chibi proportions. Character sprites more saturated than terrain so they pop.
- Feedback sprites: white dust/rustle puff at feet when entering grass; "!" reaction bubble (white rounded square, thick black border, bold black "!") above NPC head for trainer notice; drop shadows under parasols/objects; wave-ring shadows around rocks in water.

**Weather / area overlays** (drawn above tiles, below UI)
- Rain: diagonal pale-blue/white streaks.
- Falling ash: white specks drifting over the whole map; ash routes also recolor the tileset near-monochrome white/beige.
- Fog: full-screen white translucent overlay desaturating everything (Mt. Pyre).
- Blowing sand: horizontal specks.

**Location banner (area-name popup)**
- Slides in at top-left on area entry, auto-dismisses. Three skins observed:
  - Wooden signboard: wood-plank texture, nailed darker border, white pixel caps with dark outline ("VERDANTURF TOWN", "ROUTE 114", "DEWFORD TOWN", "MAUVILLE CITY").
  - Pale-green rounded rectangle, textured fill, white outlined caps ("NEW MAUVILLE").
  - Grey stone plaque with ragged torn edges ("SKY PILLAR").
- Skin is themed per location type (town/route = wood, facility = green panel, ruin = stone).

**HUD: none.** The overworld screen is 100% world, zero persistent chrome. All UI is transient (banners, dialogue, choice boxes).

---

## 2. ENCOUNTER TRANSITION

Two distinct battle-entry grammars observed; also the warp transition for comparison.

**Wild encounter (f026, single mid-frame capture — timing partially inferred):**
1. Overworld freezes and desaturates.
2. A solid light-blue horizontal letterbox band covering the middle third of the screen slides in horizontally, filled with short white horizontal speed-streak lines.
3. The wild Pokémon's sprite rides centered in the band, dashing across.
4. Cut to composed battle scene. Total sequence completes within <1s of sampled gap on either side, so budget ~0.8–1.2s.
- Implementation: freeze framebuffer → desaturate → animate band+sprite across ~30–45 frames → hard cut to battle intro.

**Trainer battle intro (f043→f044, cut happened between 1s samples, so transition ≤1s):**
1. Hard/fast cut from overworld to battle backdrop (any flash/wipe was shorter than 1s — uncertainty: a brief flash may exist between samples; a full-screen whiteout is confirmed for warps, likely similar here).
2. Enemy trainer full-body sprite on the upper-right platform; player back sprite lower-left.
3. Party lineup ribbons slide in (~1s): 6 Poké Ball icons per side riding thin dark-green tapered ribbon strips — player row upper-left, enemy row mid-right. Ball states: filled red = healthy, grey = fainted, empty ring = no Pokémon.
4. "LEADER X would like to battle!" types out in battle message box (~1s).
5. Send-out (~1s): trainer sprite shifts into throw pose, ball sprite arcs toward platform center, lineup ribbons slide off-screen; text "sent out SPINDA!".
6. Enemy Pokémon appears on platform; enemy info box pops in upper-left.
- Observed timing from consecutive seconds: ribbons-in at 44s, settled+text at 45s, throw/send-out at 46s, Pokémon+info box at 47s → roughly 1s per beat, ~3–4s total intro.

**Area warp (for reuse):** full-screen whiteout flash (1 frame sample fully white at f110), then the new map redraws — caught half-drawn (top 45% new map, bottom black) at f111, fully drawn at f112. Budget: ~0.5s white → ~0.5s reveal.

**Battle exit:** hard cut back to overworld (f047 battle → f048 gym interior between samples), no captured fade. Defeated trainer sprite slides in from the right screen edge onto the enemy platform before victory dialogue (f124).

---

## 3. BATTLE SCENE LAYOUT

Side-on staged diorama on 240x160. All batches with battle frames (37-48, 121-132, 133-144) agree exactly.

**Background**
- Plain pale field: off-white/cream/parchment, with thin cream/yellow horizontal pinstripes across the top band only. Deliberately washed out so saturated combatant sprites pop.

**Platforms & sprites**
- Enemy: sprite stands upper-RIGHT, centered on a large tan/khaki/pale oval ground ellipse (platform roughly in the right half, vertical center around y≈35–45% of screen).
- Player: Pokémon back sprite lower-LEFT on its own tan oval, cropped/near the screen's bottom-left, partially clipped by screen edge. Back sprite is larger scale than enemy sprite (closer to camera).
- Double battle: two ally back sprites share the lower-left; both enemy trainers/Pokémon share one wide oval on the right.

**Enemy info box — upper-LEFT**
- Rounded panel (dark-green border/frame on cream, with drop shadow).
- Row 1: NAME left-aligned + gender icon, "Lv##" right-aligned.
- Row 2: small orange/yellow "HP" capsule tag + green HP bar in a dark track. NO numeric HP.

**Player info box — mid-RIGHT** (directly above the message box, slightly larger than enemy box)
- Cream rounded rectangle, dark-green border.
- Row 1: NAME left / "Lv##" right.
- Row 2: orange "HP" tag + green HP bar.
- Row 3: numeric "current/max" (e.g. "135/135") right-aligned under the bar.
- Bottom edge: thin blue EXP gauge strip running along the panel's bottom, labeled "EXP".

**Battle message box — full-width bottom (~25% height)**
- Muted dark slate-teal fill, thick red-orange rounded border with a thin dark outer outline.
- White pixel text with dark drop shadow/outline, max 2 lines, typewriter reveal, red advance glyph inline at end of last line.

**Action menu:** not captured in any frame (uncertainty). Standard Gen 3 places FIGHT/BAG/POKéMON/RUN in a 2x2 grid in the right portion of the bottom box — implement per convention, unverified by this footage.

---

## 4. DIALOGUE GRAMMAR

**Overworld box (universal — story dialogue, signs, field-move announcements, item pickups all share it):**
- Bottom-anchored rounded rectangle, ~90% screen width, ~25% screen height, small margin of visible map on left/right/bottom.
- Solid white (slightly off-white) interior; thick 2-tone mint/teal-green border (bright teal outer ring, lighter inner ring, subtle drop edge).
- Text: dark-gray Gen 3 proportional-width pixel font, subtle shadow, max 2 lines, left-aligned with generous padding.
- Typewriter reveal, letter-by-letter (many frames caught mid-word).
- Advance/pause indicator: small red glyph appearing INLINE immediately after the last printed character (not in the box corner). In this capture it's a heart shape (romhack/custom cursor replacing the stock blinking red down-arrow — implement as a swappable inline glyph that blinks).
- No portraits, no nameplate. Speaker identified inline: "MR. BRINEY: Ahoy!..." Proper nouns/keywords in ALL CAPS (ROXANNE, SLATEPORT, POKéMON).

**Battle box:** same footprint and behavior, different skin — dark teal fill, red-orange border, white text with dark shadow, same inline red advance glyph.

**YES/NO choice box:** separate small white sub-box floating above-right of the dialogue box, gray 3D-beveled border, vertical options, solid black right-pointing triangle cursor at the selected row.

**Grammar rules to implement:**
- One page = up to 2 lines. Print → show inline advance glyph → wait for input → clear box → next page.
- Field actions announce through the same box ("MARILL used WATERFALL", "HEEBIE picked the 2 LEPPA BERRIES").
- Dialogue never coexists with a location banner; banners are map-level, dialogue is interaction-level.

---

## 5. MENUS / OTHER UI SEEN

Sparse — this capture is almost menu-free:
- YES/NO choice sub-box (above).
- Location banners (3 skins, section 1).
- Party lineup ribbons in battle intro (6-ball rows over tapered dark-green strips).
- "!" notice bubble (world-space emote).
- NOT seen: start menu, bag, party screen, PC boxes, shop UI, battle action/move menus, save dialog. Implement from Gen 3 convention if needed; unverified here.

---

## 6. ART STYLE & PALETTE

- Bright, saturated, high-key pastel GBA palette. Flat fills only — no gradients, no anti-aliasing, no lighting; crisp nearest-neighbor pixels.
- Outlines: 1px dark on everything (near-black for characters/props, dark-hue for tiles/buildings). Shading: flat 2–3 step cel banding, top-lit.
- Per-biome color identity (strong, deliberate): mint/seafoam greens (grass) with darker speckle; periwinkle→cornflower blue water with white/lighter wave hatching; warm tans/sandy yellows (paths, beaches, piers); mauve/red-brown rock and cliffs; salmon-pink+maroon (lava cave), vivid orange lava; pale mint+white (ice cave); near-monochrome white/beige (ash routes) where the player is the only saturated element; golden wood browns (interiors/secret base).
- Accent reds used sparingly and consistently: Pokémon Center roofs, "GYM"/"MART"/"P.C" signage, advance glyph.
- UI language: rounded-corner panels, flat fills, thick colored borders, drop shadows. Overworld UI accent = mint/teal on white; battle UI = teal fill + red-orange border + white text; info panels = cream + dark green.
- Battle scenes intentionally invert the saturation relationship: pale desaturated backdrop, saturated sprites.

---

## 7. VIDEO TIMELINE

Note: footage is fast-forwarded compilation footage (YouTube video with emulator chrome, plus a streamer overlay at the end); locations jump between seconds without in-game fades.

- **1–4s** — Rustboro Gym interior, Roxanne dialogue (overworld box grammar).
- **5–9s** — Boat travel cutscene-in-overworld: continuous scrolling down river/sea to Slateport beach.
- **10–12s** — Mr. Briney beach dialogue.
- **13–24s** — Dewford: beach, town, Pokémon Center, shoreline, tall-grass corridors. Pure HUD-less roaming.
- **25s** — Route with fences/item ball.
- **26s** — WILD ENCOUNTER TRANSITION: desaturated freeze + light-blue speed-streak band carrying Lombre sprite.
- **27–29s** — Foggy Mt. Pyre exterior: Rock Smash debris burst, "!" bubble.
- **30–31s** — Surfing open water.
- **32–33s** — Cable-car bespoke parallax cutscene.
- **34–36s** — Mt. Pyre landing + dialogue.
- **37–43s** — Routes, Mauville plazas, cycling road, New Mauville interior (green banner popup).
- **44–47s** — TRAINER BATTLE vs Leader Norman: ribbons in (44), challenge text (45), send-out throw (46), Spinda + enemy info box (47). ~1s per beat.
- **48–53s** — Petalburg Gym interior dialogue, city exterior, sign reading.
- **54–56s** — Surfing by fishing pier (idle water animation showcase).
- **57–60s** — WATERFALL HM: announcement box (57), pale-blue speed-line band effect mid-climb (58–59, ~2s), resolved on waterfall (60).
- **61–72s** — Biome tour: water gorge, green routes, rainy tall-grass field, sparkling red cave, Verdanturf (wood banner), ash town, Route 114 (wood banner).
- **73–84s** — Lavaridge hot spring, ash-grass routes with rustle puffs, log bridge over waterfall (idle 81–84).
- **85–96s** — Dept-store rooftop (map-edge void visible), Mauville, Fortree treehouses, Route 113 ash maze. Off-camera warps between samples.
- **97–108s** — Ash route, surfing, Pacifidlog stilt village, mountain route to glass facility.
- **109s** — Rainy canyon. **110–111s** — WARP TRANSITION: full whiteout, then half-redrawn frame. **112s** — Sky Pillar (stone plaque banner).
- **113–120s** — Desert/Mirage Tower, lava cave meteorite dialogue, ice cave, island Hunter's House + sign box.
- **121–122s** — Dome building, docked ferry.
- **123–127s** — BATTLE AFTERMATH vs Leader Juan: victory text (123), Juan slides in from right (124), victory speech pages (125–127). Full battle layout geometry visible (info boxes, HP numerals, EXP bar).
- **128–129s** — Double battle intro (player+Steven vs Maxie+Tabitha), roster ribbons + text.
- **130–131s** — Spliced anime footage (non-game, ignore).
- **132–137s** — Cave, boulder route, berry picking with YES/NO box, island berry tree (typewriter caught at "A thick").
- **138–140s** — Secret Base interior with placed decorations (stream-edit zoom, not game).
- **141–144s** — Static wild/link battle frame (Tauros vs ARKTICIDE) inside streamer overlay — cleanest reference for full battle composition geometry.

**Disagreements/uncertainty:** none material between batches. Open items: battle action menu never shown; the exact frame-level flash preceding trainer battles fell between samples; the red heart advance glyph is a custom skin of the stock blinking down-arrow (implement as configurable); some footage is a romhack (custom Pokémon names "THOROS"/"ARKTICIDE") but presentation grammar is stock Emerald throughout.",
    "timeline": "001s [dialogue-overworld] Gym interior (Rustboro Gym, Pokémon Ruby/Sapphire/Emerald on GBA) viewed top-down; Roxanne stands behind a yellow desk on a raised platform at top-center with a rotating badge emblem above her, player sprite directly below facing up. Dialogue box spans the bottom ~25% of the screen: white rounded-rectangle interior with a thick mint/teal-green border, dark-gray pixel text 'Hello, I am ROXANNE, the RUSTBORO POKéMON GYM LEADER.' with a small red downward heart-shaped continue indicator after the text. Floor is a pale pink/cream cross-pattern tile.
002s [dialogue-overworld] Nearly identical to f001: same gym interior with Roxanne behind the desk at top-center, player below, and the same teal-bordered white dialogue box at the bottom with the Roxanne introduction line and red heart continue arrow. Only the video-player mouse cursor position differs.
003s [dialogue-overworld] Same gym scene and Roxanne dialogue box, but the video is zoomed/cropped and slightly blurred (the capture is mid-zoom on the video player, with a 'Play (K)' tooltip and cursor over the play button bottom-left). Dialogue box still bottom-anchored, white with teal border, red heart indicator.
004s [dialogue-overworld] Same gym scene, next line of dialogue mid-typewriter: 'I became a GYM LEADER so that I' on the first line of the box with the second line still empty and no continue indicator yet (text still printing). Box is the same bottom-anchored white rounded panel with thick teal border; frame is zoomed so the box bleeds off the left edge.
005s [overworld] Zoomed overworld shot: a small white ferry/boat sprite (Mr. Briney's boat) travels north up a river channel between a sandy beach on the left and a raised brown cliff topped with dense rows of dark-green trees on the right; blue wave-textured water tiles, a blue-roofed structure edge at bottom-left. Top-down camera centered on the boat, no HUD of any kind.
006s [overworld] Boat continues along the water past a town edge: on the left a building with a blue shingled roof and yellow door, wooden pier planks (vertical tan slats) jutting into the water below the boat, a small gray sign/machine tile, sand paths, and cliff+trees upper-right. Same clean HUD-less top-down view, boat sprite slightly left of center.
007s [overworld] Almost the same composition as f006 one step later; a small NPC sprite (brown-haired girl in green) now appears at the bottom-left corner of the frame on the sand. Boat still mid-water left of center, pier and blue-roofed house on the left, cliff/trees upper-right.
008s [overworld] Open-water crossing: the boat sprite sits dead-center on a large field of blue diagonal-wave water tiles, sand banks at the top edge and a beach entering from the right with a large red-and-white beach umbrella and an NPC in a pink inner tube beneath it (Slateport beach approach). Full 4:3 game view inside the video player, no UI.
009s [overworld] Player character has disembarked and stands centered on the sand of Slateport beach facing up/away from the water; the boat sprite is docked just below at the shoreline. Beach furniture visible at top (folding chairs, umbrella shadow, an inflatable green lilo at upper-right). Scalloped white foam edging where sand meets water.
010s [dialogue-overworld] Same beach scene with Mr. Briney's sprite now standing directly below the player; dialogue box at the bottom shows only the speaker name 'MR. BRINEY' on the first line (text mid-print), white rounded panel with thick teal-green border, second line empty, no continue indicator yet.
011s [dialogue-overworld] Beach scene continues; dialogue box now reads 'MR. BRINEY: Ahoy! We've made land in SLATEPORT!' across two lines with the red heart-shaped continue indicator at the end of line two. Speaker name is inline with the text (prefix + colon), not in a separate name plate.
012s [dialogue-overworld] Next dialogue page mid-typewriter: 'I suppose you're going to visit CAPT. STERN and de' — text cut off mid-word as it prints, no continue indicator yet. Same bottom teal-bordered white box over the beach scene, player and Briney sprites unchanged at center.
013s [overworld] Zoomed-in beach overworld: periwinkle water with diagonal wave hatching fills the left third, sandy tan beach on the right with a green/white parasol casting a round shadow, two slatted lounge racks, a sailor NPC, and the player (brown hair, green/white bandana) standing at the shoreline. A video-player scrub bar with red progress sits along the bottom edge (capture artifact, not game UI).
014s [overworld] Same Dewford beach slightly zoomed out: wavy blue water left, sand right, green/white parasol center and orange/white parasol upper-right, lounge racks, sailor NPC center, player character to his left. Black pillarbox band and desktop wallpaper visible at the right edge of the game window; white OS cursor overlaid.
015s [overworld] Town overworld: light-gray cobblestone paths crossing pale-green speckled grass blocks, a purple-roofed and a yellow building on the left with a small sign tile, another sign lower-right, the red/orange striped roof of a Pokémon Center entering at upper-right, a blue awning at bottom. Player sprite walks centered; a black-haired NPC stands lower-left. Camera locked to player, roughly centered.
016s [overworld] Town overworld with the Pokémon Center fully visible upper-right: red/orange striped dome roof, white Poke Ball emblem on a red band, glass door and windows, small red 'P.C' sign on the facade, gray stone fence running down its right side. Player centered on the cobblestone path, grass blocks around, sign post and blue-roofed building at bottom.
017s [overworld] Camera has scrolled up: wide cobblestone plaza across the middle, player centered standing on a grass block, Pokémon Center now lower-right, a round green bush and the corner of a red-roofed building (Gym/Mart) at top-left. Same locked, player-centered camera.
018s [overworld] Coastal edge of town: a horizontal channel of wavy blue water bounded by brown rocky cliff faces, trees on the upper sand terrace, a wooden pier with planks and an NPC at left, a blue-tile-roofed house bottom-center, player centered on the sand. Frame is slightly soft/blurry from video scaling, not an in-game effect.
019s [overworld] Full emulator window in view: Dewford Town with a large tan wooden signboard upper-left reading 'DEWFORD TOWN' in dark serif-pixel capitals, a plank pier with a fisherman NPC, water upper-right, blue-roofed house center-right, a red-hatted NPC and green-clothed NPC, a 'GYM' signed building bottom-left, trees and a boulder right. Player stands left of the house. Black pillarboxes flank the 4:3 game area.
020s [overworld] Shoreline overworld: an L-shaped pale-green grass platform edged with brown dirt cliff and a row of white step/ledge tiles, surrounded by blue diagonal-wave water containing several gray rocks with wave shadows. Pokémon Center facade (red striped awning, white wall with blue trim) clipped at top-left; player centered near the platform's right edge.
021s [overworld] Nearly identical to f020: same grass platform over water with scattered rocks, Pokémon Center corner top-left, player centered standing still facing down. Effectively an idle frame; camera unchanged.
022s [overworld] Narrow vertical grass corridor flanked on both sides by blue water: pale-green path bordered by brown dirt cliff edges topped with white ledge tiles, dotted with dark-green tall-grass tufts. Player sprite dead-center walking downward through the grass. Strong vertical symmetry; camera centered.
023s [overworld] Same grass corridor scrolled slightly: denser tall-grass tufts above and around the centered player, white ledge tiles stepping along both cliff borders, water on both flanks. Player mid-step in the grass (possible wild-encounter grass, but no encounter triggers in-frame).
024s [overworld] Continuation of the corridor one step later: identical composition — centered player in tall grass, white-topped cliff ledges on both sides, wavy water fields left and right, small grass patch upper-left. No UI overlays anywhere in the sequence.
025s [overworld] Top-down overworld route: a vertical mint-green grass path flanked by wavy periwinkle water on the left, dark-green bush clusters dotting the path, and white rectangular fence posts running along brown cliff edges on both sides of the path. Player sprite (Brendan, white-green hat) stands dead center; a Pokéball item sprite sits on a small grass island upper-left across the water. Camera is locked centered on the player, no HUD.
026s [transition] Wild-encounter intro caught mid-frame: the screen is split into three horizontal bands. Top and bottom thirds show the current overworld (pale rocky Mt. Pyre exterior) frozen and desaturated; the middle third is a solid light-blue letterbox strip with short white horizontal speed-streak lines, and a Lombre sprite (green body, lily-pad hat, red bill) is centered in the strip as if dashing across. No info boxes or HP bars yet.
027s [overworld] Foggy, washed-out pale-green rocky mountain exterior (Mt. Pyre area): rows of studded climbable rock wall across the upper half, scattered white boulder clusters below. Center of screen: a Youngster NPC (red/white cap) on the left, a brown Strength-style boulder in the middle, and the player plus a red-haired girl companion overlapping on the right. Everything has a hazy white fog overlay.
028s [overworld] Same foggy Mt. Pyre scene one second later: the lower boulder is mid-Rock-Smash — a cloud of brown dust/debris particles bursts below the remaining rock between the Youngster and the girl companion. Otherwise identical layout and camera.
029s [overworld] Same scene: a reaction bubble — a white rounded square with thick black border containing a bold black "!" — pops up directly above the Youngster's head (classic trainer-notice/surprise emote). Boulder still sits between him and the girl companion; fog overlay unchanged.
030s [overworld] Surfing on open water: the whole screen is periwinkle-blue water with a darker diagonal hatch texture; brown rocky mound islets anchor the corners and gray rocks with dark shadow rings dot the edges. Player rides a round black surf Pokémon blob at dead center; two Swimmer NPC heads bob in the water to the right (one red-haired, one in a blue cap).
031s [overworld] Shoreline: water fills the left half, land the right half. Player surfs at the water's edge left of center; on land are a red-dressed NPC and a blonde NPC in red, tan sand patches, dense rows of bushy trees along the right edge, a brown cliff top-left, and a Pokéball item sprite at top-center on the grass. Camera still player-centered.
032s [cutscene] Side-view cable-car cutscene: blue sky gradient at top, gray mountain-ridge horizon, dense conifer forest across the lower half, tan dirt slope lower-left. A lavender pylon pole runs vertically at the left third; a steel cable crosses diagonally from upper-left to mid-right; a yellow gondola hangs from it center-right with the player character visible face-on in its window. Fully bespoke scene art, not tile-based overworld.
033s [cutscene] Same cable-car scene one second later: the parallax has scrolled so the lavender pylon (now showing its curved top arm) is near screen center, and the yellow gondola with the player inside has drifted slightly left/down along the cable. Same sky/mountain/forest backdrop layers.
034s [overworld] Overworld at a paved landing: a wide white/gray stone path at bottom-center bordered by white posts, flanked by wavy blue water with rocks lower-left and lower-right. Terraced mauve-brown cliffs with white staircases climb the upper half, mint grass on the ledges, a blue railing fence top-left, round trees top-center. Player stands center; a red-dressed girl NPC is on the path lower-left, a signpost sits right of the path, and a hiker-type NPC is at the top-right edge.
035s [overworld] Same paved landing, camera shifted down a tile: the player and the red-haired companion NPC now stand side by side on the white stone path just left of the signpost; stairs and cliff terraces above, water with rocks flanking below. No HUD.
036s [dialogue-overworld] Dialogue over the same landing scene: a rounded-corner white message box occupies the bottom ~25% of the screen, spanning nearly full width with small side margins, framed by a thick bright aqua/teal gradient border. Dark charcoal proportional-width text reads "Ahead looms MT. PYRE…" followed inline by a solid red heart glyph (sitting where Gen 3's inline advance cursor appears, right after the last character). Text sits on the top line of a two-line box; no portrait, no nameplate.
037s [dialogue-overworld] Top-down overworld route: pale-green dotted grass, brown rocky cliff ledges, white stone stairway up the center, water in the bottom corners, a small sign, and two 16x24-ish character sprites (red-clothed player + green-haired NPC) standing side by side mid-screen. Dialogue box spans the bottom ~25% of the screen: white rounded rectangle with a bright mint/aqua-green double border, dark-gray pixel text reading 'It is a natural monument to the spi' (mid-typewriter).
038s [overworld] Overworld town scene (Mauville-style): yellow brick house with pink doors and gray tiled roof on the left, a large pale blue-white paved building/plaza structure on the right, white picket fences, bushy trees. Player sprite on a bike, centered on screen, camera locked to player. No UI overlays.
039s [overworld] Overworld: player on bike riding across a large light blue-white paved plaza with rounded blue-trimmed edges; two dense rows of dark/light green trees along the top, sandy beach strip at far left, white fence posts. Player sprite centered; no HUD.
040s [overworld] Overworld: player standing centered on a wide pale paved plaza (dismounted, standing sprite), continuous hedge of trees across the top and right edge, blue-trimmed plaza structures at the bottom. Clean screen, no UI.
041s [overworld] Overworld cycling-road segment: a vertical white striped road/bridge runs down the center flanked by blue guard rails and support pillars, water below on both sides, tree rows and white fences left and right, a brown cliff bottom-right. Player on bike centered; a second cyclist NPC sprite is entering at the bottom-center edge.
042s [overworld] Indoor overworld (New Mauville): gray-green tiled floor, beige counters/shelves with items, a lime-green vertical pipe/light on the right, small blue circular button/switch on the floor, stairway tile top-center. Player sprite centered. Area-name banner top-left: pale-green rounded rectangle with textured fill and white outlined caps text 'NEW MAUVILLE' (location popup).
043s [overworld] Same New Mauville interior one step later: camera has scrolled with the centered player; 'NEW MAUVILLE' banner still displayed top-left. Tiled floor, machine shelves top, blue floor switch lower-center, green pipe right.
044s [dialogue-battle] Trainer-battle intro, mid-animation: full-body sprite of Norman (red jacket) stands upper-right on a large tan oval platform; player's back-view sprite (May) lower-left on her own tan oval platform; background is cream/white with thin horizontal stripes. Party-ball indicators are sliding in on thin dark-green ribbon strips (one ball upper-left over the left strip, two balls mid-right over the enemy strip). Battle text box bottom: muted teal fill, thick red-orange rounded border, white text with dark drop shadow: 'LEADER NORMAN / would like to'.
045s [dialogue-battle] Battle intro settled: same composition; player's party lineup upper-left (6 ball icons: 2 empty rings + 4 filled red balls) sitting above a dark-green tapered ribbon; enemy party lineup (6 balls, one grayed) mid-right above its ribbon. Text now complete: 'LEADER NORMAN would like to battle!' with a small red heart-shaped advance/pause glyph at the end of the line.
046s [dialogue-battle] Send-out animation: Norman's sprite shifted right in a throwing pose with a red/white Poke Ball at his feet and a small ball sprite flying left toward the platform center; player's party ball row visibly sliding off to the left. Text box: 'LEADER NORMAN sent / out SPINDA!'.
047s [battle] Enemy Pokemon on field: Spinda sprite upper-right centered on the tan oval platform. Enemy info box upper-left: dark-green rounded panel with drop shadow containing name 'SPINDA' + gender/ball icon on the left, 'Lv27' right-aligned, and below it an HP bar (yellow-orange 'HP' tag, green fill in a dark track). Player back sprite still lower-left; enemy party ball row still visible mid-right. Battle text box (teal fill, red-orange border) still reads 'LEADER NORMAN sent out SPINDA!'.
048s [dialogue-overworld] Indoor gym scene (Petalburg Gym look): yellow tiled floor, brown paneled back wall with two doorways and a potted plant, two silver trophy pedestals flanking the room; Norman's overworld NPC sprite faces the player who stands directly below him, both center-screen. Overworld-style dialogue box at bottom: white rounded rectangle with mint-green glowing border, dark-gray text 'I'm surprised that you managed to get here by yourself.' ending in the small red heart advance glyph.
049s [dialogue-overworld] Interior of Petalburg Gym: pale-yellow tiled floor, wood-paneled back wall with two gray doors and a centered plant/statue alcove, two silver trash-can-like pillars flanking the room. Player character stands center facing an NPC (Norman, dark hair, white coat) directly above him. Bottom dialogue box reads 'Oh, I see. / You're with your POKeMON.' with a small red heart-shaped advance indicator at the end of line 2.
050s [dialogue-overworld] Identical gym-interior scene to f049. Dialogue box now shows mid-typewriter text 'Hm… Then I guess you're going to / become a TRAINER like' with no advance indicator yet (text still printing).
051s [overworld] Petalburg City exterior, top-down camera roughly centered on player: gray/blue Gym building with red 'GYM' lettering upper-left, blue pond upper-right, red-roofed Pokemon Center with Poke Ball emblem and 'P.C' sign lower-right, sandy tan footpaths crossing seafoam-green grass, dark-green hedges. Player stands beside the small square GYM signpost; a brown-clad NPC with a hat stands to the right. No UI overlay at all — the full screen is map.
052s [dialogue-overworld] Same Petalburg exterior, player now facing the gym signpost. Bottom dialogue box (sign reading) shows 'PETALBURG CITY POKeMON GYM / LEADER: N' mid-typewriter. Box covers roughly the bottom quarter of the game screen, overlapping the Pokemon Center roof.
053s [dialogue-overworld] Continuation of the sign text: 'LEADER: NORMAN / "A man in pursuit' still printing. Scene and box geometry identical to f052 — box floats with visible map margin on left/right/bottom edges.
054s [overworld] Ocean route while surfing: vast flat light-blue water with thin white diagonal wave streaks, tan wooden pier/boardwalk planks forming an L on the upper-right, a small green island in the top-left corner. Two fisherman NPCs (red caps, yellow vests) stand on the pier with lines cast into the water. Player sprite rides a small pink/white Pokemon just below-left of the pier corner, near screen center. No HUD.
055s [overworld] Nearly identical surfing frame to f054; only sub-pixel animation differences in the water streaks and the surf Pokemon's bob cycle. Player still centered just below the pier junction.
056s [overworld] Third consecutive surfing frame, same composition; the surf mount's sprite frame has shifted slightly (bobbing animation). Demonstrates idle water animation: white streak positions vary frame to frame.
057s [dialogue-overworld] Base of a waterfall inside a rocky gorge: dark purple-gray cliff columns on both sides, a wide light-blue waterfall sheet filling the top-center, textured dark-blue water below where the player surfs on a black round mount, dead center. A glowing yellow item/root is embedded in the right cliff. Bottom dialogue box reads 'MARILL used WATERFALL' on one line with the second line empty — the HM field-move announcement uses the same box style as story dialogue.
058s [transition] Waterfall-climb effect caught mid-frame: the screen is split into three horizontal bands — a thin strip of the waterfall/cliff scene at top, a large flat pale-blue band with short white horizontal dash streaks filling the middle (fast vertical camera pan / speed-line effect), and a strip of cave floor with a water pool at the bottom. No sprites or UI visible; pure motion-blur transition.
059s [transition] Waterfall climb resolving: the normal scene (cliffs, waterfall, player on surf mount at center) is back, but a large pale-blue rectangle with white dash streaks still covers the right half of the screen — the speed-line effect overlay dissipating mid-frame. Player sprite sits at the waterfall's base center.
060s [overworld] Post-climb: player on the black surf mount is halfway up the white waterfall sheet, centered on screen; purple-gray cliff walls frame both sides, textured blue water at the bottom, glowing yellow object in the right wall. Effect overlay fully gone; clean overworld rendering.
061s [overworld] Player is surfing: a small trainer sprite riding a round dark Pokemon, dead-center of the screen on blue water with repeating horizontal wave-line tiles. Gray-purple rocky cliff walls frame the left and right edges; a lighter, pale-blue shallow/current channel runs vertically through the middle; a small waterfall and splash tile sit at the lower-right cliff. No HUD or UI elements.
062s [overworld] Walking through a green route: mint-green ground with sparse light-dot texture, rows of large round dark-green trees along the top and left, a brown jump-ledge strip right of center, and a field of small dark-green bushes/grass tufts lower-left. Player sprite (white-and-green hat, red/black clothes) is slightly left of screen center, walking. No UI.
063s [overworld] Same green route one step later; the camera has scrolled with the player, who remains locked at screen center. Ledge now upper-left of the player, tree wall on the upper-right, bush patches lower-left and mid-right. Classic center-locked tile-scrolling camera, no UI.
064s [overworld] Continuing north on the route: player centered facing up, brown ledges at top-left and bottom-center, tree rows top and bottom-left, dark bush strips mid-left and mid-right. Demonstrates the grid-tile layout (~16px tiles upscaled) and the always-centered player camera.
065s [overworld] Dense tall-grass field (Route 119 style): nearly the whole screen is animated tall-grass tiles in layered greens with darker horizontal band rows; two vertical light-green cut paths at top. Diagonal pale-blue streaks across the screen are a rain weather effect caught mid-fall. Player sprite center; an NPC boy in a green hat stands lower-center.
066s [overworld] Same tall-grass area: player (green-hat sprite, appears mid-step with a thin white motion streak to his right) slightly left of center, vertical light-green path segment to his lower-right, rain streak visible at mid-left. Whole screen is tall-grass texture, no UI.
067s [overworld] Cave interior (Fiery Path style): terraced dark-red rock walls with pale salmon-pink floor plateaus, all speckled with small white sparkle dots. Yellow-tan striped ladder/step objects with dark blue outlines sit at upper-right, center-above-player, and two on the right side. Player sprite centered just below a ladder object. No UI.
068s [overworld] Same red cave scrolled down: multiple yellow striped ladder objects scattered (top-center, upper-left, mid-right, lower-right), a row of white bumpy tiles along the bottom-left edge, player centered walking. Same salmon floor / maroon wall terracing with white speckles.
069s [overworld] Town scene with a location banner: a wooden signboard graphic occupying the top-left quadrant reads 'VERDANTURF TOWN' in white pixel caps with dark outline on a wood-plank texture with nailed border — this is the on-map area sign, not a dialogue box. Two houses with green corrugated roofs and tan log walls (left and right-center), a white fence, hedges/trees bottom and right, flower boxes bottom-center, a two-flower plant lower-left. Player sprite is center screen beside the right house.
070s [overworld] Ash-covered town (Fallarbor style): dusty mauve-brown ground, dark tilled-soil plots with green sprouts (left), a light sandy path band across the top, a round crater depression below-center, and a building with an orange slatted roof and a green machine on top at right. An NPC girl in a yellow dress and a small blue Pokemon stand upper-right; player sprite centered. No UI.
071s [overworld] Same ash town scrolled: two dark soil plots with sprout clusters left-of-center (player standing between them), sandy path with glowing pale border upper-right, crater lower-right of center, orange crate-roof building at right edge, tree cluster bottom-left, a small sign object at the very top-right corner. No UI.
072s [overworld] Route entrance with location banner: wooden plank sign graphic top-left reading 'ROUTE 114' in white outlined pixel caps. Below/right: same ash-dusted ground, two tilled sprout plots lower-left, sandy path band mid-right, buildings and gray sign/mailbox objects along the top-right, orange crate structure bottom-right. Player centered facing down.
073s [overworld] Top-down overworld of a mountain town (Lavaridge-style): a square hot-spring pool bordered by dark rocks sits center, with the player (white/green hat sprite) and two elderly NPC sprites soaking inside, sparkle tiles on the water. Right edge shows a Pokemon Center with red tiled roof, round Pokeball emblem, and a red 'P' sign; left half is a large reddish-brown ridged cliff face; sandy ground below with two oval sand-pit tiles and three more NPCs. No HUD or text boxes; the game screen is pillarboxed inside a video player window with a desktop cursor visible upper-right.
074s [overworld] Nearly identical to f073: same hot-spring town scene, player still in the pool with two elderly NPCs, Pokemon Center on the right, red cliff wall on the left, NPCs standing on the sand below. Only tiny sparkle/animation differences on the water tiles; camera has not moved.
075s [overworld] Route overworld: player sprite dead-center walking through olive/khaki dark-grass rows with a white dust/rustle puff animation at their feet and teal ash-covered grass tufts beside them. A dirt path with raised ledge border runs across the upper-left, a Pokeball item sprite sits on the path top-center-left, a small blue-roofed sign/machine and rocks upper-right, pale-green grass patch right edge, and a large pink craggy mountain slope fills the bottom third.
076s [overworld] Same route scrolled slightly: player center-left in dark grass with the white rustle puff, a horizontal row of bright teal ash-grass tufts extending right of the player. Round green trees cluster upper-left and lower-left, the ledge path and Pokeball item now upper-center, sign object at far upper-right, pink rocky mountain mass lower-right.
077s [overworld] Route continues: player center amid dark-grass rows facing the long teal ash-grass strip stretching to the right edge. Tree clusters upper-left and lower-left, path border tiles along the left and top with the Pokeball item now top-right, two grey rocks below-center, pink mountain in lower-right corner. Camera tracks the player, keeping them near screen center.
078s [overworld] Route overworld: player center with rustle-puff animation entering teal grass; two identical small-girl NPC sprites (red bows, yellow/orange dresses) stand side by side just below-center. A row of round trees lines the top edge, a large pink rock outcrop occupies the right-center, another rock lower-left, and a Pokeball item pokes in at the far right edge.
079s [overworld] Same area one step later: player center-left half-hidden in teal ash-grass with the white puff sprite, the two red-bow girl NPCs now right-of-center, dense tree block upper-left, dark-grass rows across the lower half, pink cliff sliver at the far right edge.
080s [overworld] Route/town edge: a grey-green two-story house with lattice-framed walls, orange awning window, and green door occupies the lower-left; tree row above it. Player is center walking through teal grass with rustle puff, more teal grass strip continuing to the upper-right, dark-grass field lower-right, pink rock corner bottom-right. Everything is dusted with white specks (falling volcanic ash effect over the whole map).
081s [overworld] New scene: a horizontal log bridge spans the full screen width across a vertical blue river with a waterfall at top-center; player stands at the exact center of the bridge. Brown cliff walls top corners with square cave/vent openings, tall green pine-like trees flank both sides over pale mint grass, a flower patch upper-left, and a grey/green rock sits lower-right. Classic centered-camera composition, no HUD.
082s [overworld] Same bridge scene as f081, essentially static: player centered on the log bridge over the river/waterfall, identical layout; only water animation frames differ.
083s [overworld] Same bridge-over-waterfall scene, player still centered on the bridge; water tiles show a different animation phase (wave rows shifted). No movement, UI, or text.
084s [overworld] Same bridge scene, fourth consecutive static frame: player centered on the log bridge, waterfall above, pine trees and cliffs framing both sides, rock lower-right. Player appears idle (possibly a pause in input).
085s [overworld] Interior/rooftop floor of a department store: cream-grey floor tiles with a repeating green diamond motif, two yellow planter boxes with bushes on the left wall, purple benches mid-floor, vending-machine alcoves along the top wall, and an orange-railed balustrade running horizontally across the frame separating the roof from the building facade below (pale blue windows visible underneath). Player sprite (small chibi, brown hair, green bow/bandana) is center; NPCs: man in green suit upper-left, girl in red center-right. Camera is top-down 3/4, centered on the player.
086s [overworld] Same rooftop scrolled right one tile-row: two vending machines top-center, a grey elevator/escalator structure upper-right, purple benches flanking the player, woman in red standing by two purple seats at far right. Player sprite center-bottom next to the railing; same diamond-pattern floor and orange railing with facade/windows below.
087s [overworld] Rooftop continues scrolling right toward the map edge: elevator structure top-center, blonde NPC in red at left, woman in red/yellow beside two purple seats right of the player. Right third of the screen is flat pale-cyan void beyond the map boundary, showing the map simply ends (no border art). Railing and lower facade with two windows still visible along the bottom.
088s [overworld] Rooftop, camera shifted up-left: two teal-fronted vending machines top-left on a raised step, large grey elevator/kiosk block center, player sprite center standing directly above a woman in red near two blue seats, boy in red by a bench at left. Bottom strip shows the dotted building facade; right side again pale-cyan off-map void.
089s [overworld] Mauville City exterior: large wood-textured signboard reading 'MAUVILLE CITY' in white pixel capitals occupying the upper-left (map signage, not a UI popup), Pokémon Center top-center with red/orange striped dome roof, Poké Ball emblem, and red 'P.C' sign, rows of parked bicycles behind a log fence top-right. Pale mint grass with light-grey speckled paths in a cross pattern; NPC woman in pink left beside a small grey sign kiosk, player center on the path, boy NPC lower-right, pink and blue corrugated rooftops along the bottom edge.
090s [overworld] Mauville City, camera scrolled slightly down-right: MAUVILLE CITY sign still upper-left, Pokémon Center top-center, bikes top-right, and a blue-roofed building with a giant white Poké Ball motif (bike shop/gym style) lower-right next to a long pink-roofed building bottom-center. Five visible NPCs (pink dress, swimmer at far left edge, dark-haired man lower-left, boy in green right); player at exact screen center; log-post fencing and red flowers bottom-left.
091s [overworld] Fortree City: dense bushy tree tiles frame the whole scene in saturated green, Poké Mart on the left with blue awning roof, Poké Ball emblem, and red 'MART' sign, and a yellow wooden treehouse platform upper-right with a dark doorway, ladder down, and a man NPC standing on the deck. Player sprite center on grass, hiker-style NPC just below-right, another NPC half-visible at top edge; white picket-style fence pieces at far right.
092s [overworld] Fortree City scrolled up: grey PC/notice kiosk upper-left, old man NPC in purple above the player, player center facing up, MART lower-left, treehouse with ladder and boy NPC on the deck at right, hiker NPC bottom-center, and a rope/vine tree passage visible top-right. Everything nested in the thick green tree-wall tileset.
093s [overworld] Fortree City, camera moved up-left: another treehouse's platform edge at very top, sign kiosk mid-left, old man NPC center-left, MART bottom-left, yellow treehouse center-right with boy NPC on its deck and ladder below, player half-visible at bottom edge. A vertical vine/tree door passage sits in the tree mass upper-right; palette is deep greens with sandy-yellow wood.
094s [overworld] Fortree City near the Pokémon Center: red/orange dome-roofed Pokémon Center with Poké Ball emblem and 'P.C' sign upper-left, treehouse walkways with yellow planks and ladder along the top, player sprite center standing among tree tiles, grey sign kiosk mid-left, old man NPC lower-center, corner of a blue Poké Ball-motif roof bottom-left. Tree-hollow door passages embedded in the foliage right side.
095s [overworld] Route 113 ash fields: almost monochrome white/pale-beige terrain of ash-covered ground, ledges, and frosted-looking trees arranged as a maze of ridges and stair cuts. The glass workshop building (octagonal base with a dusty pyramid glass roof) sits lower-left; a doorway/steps structure pokes in at top-left. Player sprite is a small dot dead-center, the only strongly colored element on screen.
096s [overworld] Route 113, scrolled down-left: glass workshop now mid-left showing its dark double-door entrance, player center walking right, carved staircases up the ash ledges center and right, tan ridge walls snaking vertically on the right half. Same washed-out white/khaki ash palette with the player's green/brown sprite as the sole accent.
097s [overworld] Top-down overworld of an ash-covered route: pale beige/white ash blankets the ground and diagonal terraced ridges of ash-dusted grass form a maze. A house with a pointed brown/mauve roof and double door sits upper-left. Player sprite (green-and-white hat, red/brown hair) stands dead-center of the screen. No HUD elements at all; game area is pillarboxed with black bars left/right inside the emulator window.
098s [overworld] Same ash route, camera scrolled with the player still locked at screen center. Zig-zag ash-covered ledges/slopes with stepped diagonal edges dominate; lower-right shows reddish-pink ash-covered plant tiles. Thin blue-outlined ledge/fence tiles at upper-right and left edge. No UI.
099s [overworld] Player is surfing: the character rides a round dark Pokémon/surf blob at screen center on open water. Water fills ~90% of the frame with a repeating diagonal white-crested wave texture in two blues (lighter periwinkle with darker blue stepped patches indicating deep water). Ash-covered shoreline occupies the top-right corner; a small round grey rock floats lower-right. No HUD.
100s [overworld] Surfing continues; the water texture is caught in a different animation state — a lighter lavender-blue with a fine dotted/sparkle pattern instead of wave crests. Player on surf mount slightly left of center, a grey boulder in the water immediately to its right, ash-covered cliff shore with dark red rim in the top-right quadrant.
101s [overworld] Surfing on full-screen wave-textured water (diagonal white-crest pattern back again, with darker stepped deep-water patches). Player centered on the surf mount; a round rock sits top-center and a sliver of ash shoreline peeks at the top-right corner. No UI.
102s [overworld] A stilt village on water (Pacifidlog-style): octagonal huts with layered green thatched roofs sit on mustard-yellow plank platforms floating on blue wave-textured water, connected by narrow brown plank walkways with post rails. Player stands center on a walkway; an NPC girl (brown hair, yellow dress) stands upper-right beside a hut. A brown rock lower-left and a sandy shoal strip along the bottom.
103s [overworld] Same stilt village, camera advanced: two thatched-roof huts flank the player left and right, each on its yellow plank platform with a small dock step at its bottom edge. Player centered on a vertical plank bridge; the yellow-dressed NPC stands just right of center in front of the right hut. Horizontal walkways cross at lower-left and lower-right.
104s [overworld] Stilt village with a Pokémon Center visible top-center: cream/white building with a red 'P.C' roof sign and a small blue notice board beside it, pink-haired NPC standing on its platform. Player centered on the plank path below; the yellow-dressed NPC now lower-right beside a hut; two thatched huts in the lower half. Walkways radiate left and right.
105s [overworld] Rocky mountain route: craggy red-brown cliff walls, mint-green speckled grass, pale sand patches, and wide white/grey stepped stair-ramps cut into the cliffs (top-center and bottom-left). A grey house with a ribbed red roof and orange door sits at the right edge; an NPC boy stands upper-left next to a white boulder; small red-flower bushes dot the map. Player centered.
106s [overworld] Same mountain route, closer to the red-roofed grey house (now center-right, with a dark window and orange door). Player stands immediately left of the house. White stair-ramps at top-center and bottom-left corner, sand patch left edge, a large round green tree and flower bushes lower-right. Cliffs frame the top and bottom.
107s [overworld] Player centered climbing a white stepped stair path between brown cliff walls; another stair flight above. A small blue signboard with a graphic sits top-center-right; sand patches top-center and lower-left; the red-roofed house now lower-right. Flower bushes on both sides of the player.
108s [overworld] Player stands on a sand patch at the top of two white stair flights before a large facility building spanning the top of the screen: olive-grey walls with pillars, rows of blue glass window panes, and a central glass double-door entrance. A blue signboard stands right of the player; brown cliffs flank left and right, flower bushes at mid-height, and a red/grey pipe-like barrier bottom-right. No HUD.
109s [overworld] Top-down overworld in a rainy tan/sandy canyon: a dark-brown cave facade with a face-like carved entrance sits top-center, round boulders scattered on both sides, a purple-brown cliff wall along the left edge, and a large rock outcrop bottom-right. Player sprite (brown-clothed with green pack/hair) stands dead center; diagonal white-and-blue rain streaks overlay the whole scene. No HUD or text.
110s [transition] Entire game viewport is solid white — a whiteout flash caught mid-frame during an area change (between the rainy canyon and the Sky Pillar exterior). Only the emulator's black pillarbox bars and window chrome remain visible.
111s [transition] Screen redrawing after the area change: only the top ~45% of the viewport shows the new map (grey-lavender stone wall with vertical rope/chain tile pattern, dark doorway recess top-center, player standing on a tan doormat), while the entire bottom half is still black — caught mid-redraw/scroll-in.
112s [overworld] Sky Pillar exterior fully drawn: grey-lavender patterned wall fills the frame, dark navy doorway top-center, player centered below it, tan doormat tile lower-center. A location banner occupies the upper-left: a grey stone-textured plaque with ragged/torn edges and 'SKY PILLAR' in white pixel capitals.
113s [overworld] Desert overworld: pale sandy dunes with dotted sand texture and faint dune-edge outlines fill the screen; a sand-colored ruined tower (Mirage Tower style) with a dark eroded entrance stands upper-left, and a purple-brown rock wall juts in from the lower-left. Player sprite centered, walking. Blowing-sand specks overlay the scene; no UI.
114s [dialogue-overworld] Volcanic cave interior (dark red-brown ribbed rock left, bright orange lava field filling the right third) with white ash/ember specks falling; player faces a small blue-grey machine sprite mid-screen. Dialogue box anchored at the bottom, spanning nearly full width and ~25% of height: rounded-corner white panel inside a bright teal/mint border, dark-grey pixel text mid-typewriter reading 'A METEORITE is fitt'.
115s [dialogue-overworld] Same lava-cave scene one second later; the bottom dialogue box now shows the full two-line message 'A METEORITE is fitted on a mysterious machine...' followed by a small red advance/pause glyph inline at the end of the text. Same teal-bordered, white-filled rounded box at bottom.
116s [overworld] Ice cave overworld: pale mint-green floor with white ice patches and stair-like ledges, mauve-grey rock walls winding through the room, a Poke Ball item sprite upper-center-right, and three cream-colored rock/nugget objects along the right edge. Player sprite centered facing down. No UI.
117s [overworld] Same ice cave one step later: identical layout (Poke Ball upper-right area, cream rocks right edge, mint floor with white ice-slide strips lower-center), player still screen-centered but turned/walking — camera follows player so the map shifted slightly.
118s [overworld] Ocean route: animated blue wave-pattern water covers most of the frame, with a light-grey shallow-water shelf ring around a small sand island upper-center. On the island sits a red-tile-roofed wooden house with a red door and a white sign out front; player stands on the sand just below/left of the house. No UI.
119s [overworld] Same island house from a shifted camera position (house now upper-left): red-roofed cabin, red door, window, white sign to its right; player on the sand at the island's right edge facing the sign. Wave-textured deep water surrounds the shallow-water ring. No UI.
120s [dialogue-overworld] Player reads the sign next to the island house: bottom-anchored dialogue box (white rounded panel, bright teal border, spanning nearly full width, ~25% of screen height) displays 'HUNTER'S HOUSE' in dark-grey pixel capitals on the first line; no advance arrow visible yet. Overworld with house upper-left and water everywhere else remains behind the box.
121s [overworld] Top-down Gen-III (Emerald-style) overworld: player sprite (green bandana) centered, standing at the entrance of a large beige domed multi-story building with light-blue windows (gym/institution). Dark evergreen tree column on the left edge, pink-brown rock outcrop lower-left, sandy tan path patch center, bright tall-grass patch bottom-right, all on a pale mint-green ground tile. A small sign object sits right of the door. No HUD; screen letterboxed with black pillarbox bars inside the emulator frame.
122s [overworld] Overworld ocean route: player centered on a tiny light-blue shallow-water shelf next to a docked cream-colored ferry/ship and a sign; deep-blue wavy water fills the lower two-thirds, with brown conical rocks and gray boulder clusters along the top shoreline. Camera locked on player; classic 16px-tile GBA look.
123s [dialogue-battle] Battle victory frame: player's Electrode back sprite (red/white ball) lower-left on a tan oval platform; enemy side empty (defeated), only the tan enemy platform upper-right remains on an off-white background with cream pinstripes at top. Player info box mid-right: cream rounded rectangle, dark-green border, 'ELECTRODE Lv51', orange HP tag + full green HP bar, '135/135', blue EXP bar along box bottom. Bottom dialogue box (teal fill, thick red-orange rounded border) reads 'Player defeated LEADER JUAN!' with a blinking red heart-shaped advance indicator.
124s [transition] Mid-animation battle frame: defeated Gym Leader Juan's full-body sprite caught sliding in from the right screen edge (half clipped off-screen) toward the enemy platform. Electrode back sprite lower-left and its info box (ELECTRODE Lv51, 135/135, EXP bar) unchanged; the bottom teal/red dialogue box is present but empty, awaiting text.
125s [dialogue-battle] Post-battle trainer speech: Juan (blue coat, purple pants) now stands fully on the tan enemy platform upper-right; Electrode back sprite lower-left; player info box mid-right. Dialogue box typing out 'Ahahaha, excellent! / Very well, you are the' in white pixel font with dark drop shadow, two lines, no advance arrow yet (typewriter in progress).
126s [dialogue-battle] Same composition as f125 with the line completed: 'Ahahaha, excellent! / Very well, you are the winner.' followed by the red heart advance indicator. Juan on enemy platform upper-right, Electrode back sprite lower-left, info box mid-right showing full HP.
127s [dialogue-battle] Same battle layout, next dialogue page mid-typewriter: 'From you, I sense the brilliant shine / of skill that wil'. Juan sprite upper-right, Electrode back sprite lower-left, ELECTRODE Lv51 info box with HP 135/135 and EXP bar mid-right.
128s [battle] Double-battle intro (Mossdeep Space Center scene): ally back sprites lower-left — player (May, green bandana) far left and Steven (silver hair, black suit) center-left — facing Magma Leader Maxie (dynamic pose) and Magma Admin Tabitha standing together on one wide tan oval platform on the right. Background is off-white with pale yellow pinstripes at the very top. Bottom dialogue box present but still empty.
129s [dialogue-battle] Same 2v2 intro one beat later: trainer party rosters have slid in — a row of 4 Poke Ball icons above a dark horizontal line upper-left (ally side) and 6 ball icons above a line mid-right (enemy side). Dialogue box reads 'MAGMA LEADER MAXIE and / MAGMA ADMIN TABITHA' with the red heart advance indicator. All four trainer sprites still on screen.
130s [cutscene] Spliced anime footage (not game rendering): close-up of Ash Ketchum grinning and gripping a Poke Ball, over a vertical green speed-line background. Soft full-color video, 4:3 with black pillarboxing — completely different fidelity from the pixel-art game frames.
131s [cutscene] Anime footage continues: Ash mid-leap/throw, body twisted with arm extended upward, against the same green vertical speed-line background. Motion-blurred cel animation, no game UI.
132s [overworld] Back to game overworld, cave/mountain interior: brown speckled rocky floor tiles, two ledge/rock formations with rope-ladder-like faces upper-left, a rectangular blue water pool lower-left, vertical rocky ridge columns on the right, and a dark purple void strip along the right map edge. Player sprite (green bandana) centered; camera locked on player; no HUD.
133s [overworld] Top-down GBA overworld (Gen 3 Hoenn style) of a rocky desert route: tan ground speckled with pebbles, three large brown boulder formations stacked vertically on the left, a striated cliff wall running down the right edge with a dark purple shadow strip beside it. Player sprite (small character with green hair/hat, ~16x24 px feel) stands dead-center of the screen; no HUD or UI overlays at all.
134s [overworld] Same rocky route one step later: camera has scrolled with the player (player still pixel-locked at screen center), revealing an extra boulder formation immediately to the player's right. Identical palette and layout, no UI.
135s [dialogue-overworld] Berry-picking scene on a green route (trees, pink flowers, a brown soil patch with a blossoming berry plant; NPC in red on left, gray-haired NPC near player). Dialogue box anchored at the bottom spanning nearly full width: white rounded interior with a thick mint/teal-green border, dark gray Gen-3 pixel font reading 'Do you want to pick the LEPPA BERRIES?'. A separate small YES/NO choice box floats mid-right over the map: white fill, gray 3D-beveled border, black triangular cursor pointing at YES.
136s [dialogue-overworld] Same scene one beat later; choice box is gone and the bottom teal-bordered white dialogue box now shows a single line: 'HEEBIE picked the 2 LEPPA BERRIES.' (HEEBIE is the player name). Overworld still visible behind the box.
137s [dialogue-overworld] Tiny island overworld: animated wavy blue water tiles fill the screen, a small grass islet in the center holds a large dark-green berry tree, a wooden sign, and the player facing it. Bottom dialogue box (same white-with-teal-border style) caught mid-typewriter showing only 'A thick' — clear evidence of letter-by-letter text reveal.
138s [overworld] Secret Base interior (Gen 3): horizontal wooden log-plank floor, dense green hedge walls forming corridors, decorations placed on the floor — a Treecko doll on a yellow stand (left), a red doll on a red stand (center), a large glassy blue orb ornament, a grassy mat, and a PC device upper-right next to the player. Game viewport is letterboxed smaller inside the video frame (stream edit zoom), no in-game UI.
139s [overworld] Same Secret Base from a different position: a large sparkly glass ball ornament with yellow stars top-center, a blue doll on a stand left, three Poke Ball cushions in a row on the floor, a red doll far right, player standing mid-screen on a yellow stand tile. Video viewport has shifted right within the black letterbox (stream-edit pan, not an in-game effect).
140s [overworld] Secret Base again with the video viewport smaller and pushed further right — the streamer's editing is zooming/panning the captured game window; in-game content (star orb ornament, blue doll, Poke Ball cushions, player on yellow stand) is unchanged, still no HUD.
141s [dialogue-battle] Full stream layout revealed: livechat panel left, webcam bottom-left, donation banners bottom, game window center-right showing a Gen-3 battle. Composition: enemy info box top-left (name 'THOROS' + gender icon + 'Lv50', orange 'HP' tag with green bar); enemy sprite (Tauros) upper-right standing on a pale oval ground ellipse; player's Pokemon (small green Larvitar-like sprite) lower-left on its own ellipse; player info box mid-right reading 'ARKTICIDE Lv50' with green HP bar, numeric '124/165', and a blue EXP strip along its bottom edge labeled 'EXP'. Battle message box spans the bottom: dark slate-teal fill, orange/red outer border, large white outlined text caught mid-typewriter: 'ARKTICIDE made'. Background art is a washed-out pale field.
142s [dialogue-battle] Identical battle frame to f141 (Tauros upper-right with top-left info box, green Pokemon lower-left with mid-right info box showing 124/165 HP and EXP bar, bottom teal message box with orange border still reading 'ARKTICIDE made'); only the streamer webcam thumbnail has changed.
143s [dialogue-battle] Same paused-looking battle screen again: enemy Tauros Lv50 upper-right on ground ellipse, enemy info panel top-left, player Pokemon bottom-left, player panel mid-right (ARKTICIDE Lv50, 124/165, EXP bar), bottom message box mid-sentence. Stream overlay elements (chat, webcam, banners) around it.
144s [dialogue-battle] Final frame of the batch, unchanged battle composition: enemy top-left info box / upper-right sprite, player lower-left sprite / mid-right info box with HP numerals and EXP strip, full-width bottom message box in dark teal with orange-red border showing typewriter text 'ARKTICIDE made'."
  },
  "workflowProgress": [
    {
      "type": "workflow_phase",
      "index": 1,
      "title": "Analyze frames"
    },
    {
      "type": "workflow_phase",
      "index": 2,
      "title": "Synthesize"
    },
    {
      "type": "workflow_agent",
      "index": 1,
      "label": "frames 1-12",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "a3ad76b1c59a7494e",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971803,
      "queuedAt": 1783376971792,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 1-12 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f001.png
/tmp/poke-frames/f002.png
/tmp/poke-frames/f003.png
/tmp/poke-frames/f004.png
/tmp/poke-frames/f005.png
/tmp/poke-frames/f006.png
/tmp/poke-frames/f007.png
/tmp/poke-frames/f008.png
/tmp/poke-fr…",
      "lastProgressAt": 1783377055668,
      "tokens": 23669,
      "toolCalls": 13,
      "durationMs": 83865,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f001.png","mode":"dialogue-overworld","description":"Gym interior (Rustboro Gym, Pokémon Ruby/Sapphire/Emerald on GBA) viewed top-down; Roxanne stands behind a yellow desk on a raised platform at top-center with a rotating badge emblem above her, player sprite directly below facing up. Dialogue box spans the bottom ~25% of the screen: white rounded-rectangle in…"
    },
    {
      "type": "workflow_agent",
      "index": 2,
      "label": "frames 13-24",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "a88a126f4efa0b86a",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971803,
      "queuedAt": 1783376971792,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 13-24 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f013.png
/tmp/poke-frames/f014.png
/tmp/poke-frames/f015.png
/tmp/poke-frames/f016.png
/tmp/poke-frames/f017.png
/tmp/poke-frames/f018.png
/tmp/poke-frames/f019.png
/tmp/poke-frames/f020.png
/tmp/poke-f…",
      "lastProgressAt": 1783377070920,
      "tokens": 23678,
      "toolCalls": 13,
      "durationMs": 99117,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f013.png","mode":"overworld","description":"Zoomed-in beach overworld: periwinkle water with diagonal wave hatching fills the left third, sandy tan beach on the right with a green/white parasol casting a round shadow, two slatted lounge racks, a sailor NPC, and the player (brown hair, green/white bandana) standing at the shoreline. A video-player scrub bar with…"
    },
    {
      "type": "workflow_agent",
      "index": 3,
      "label": "frames 25-36",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "afe32f6089c3e1e9e",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971803,
      "queuedAt": 1783376971792,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 25-36 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f025.png
/tmp/poke-frames/f026.png
/tmp/poke-frames/f027.png
/tmp/poke-frames/f028.png
/tmp/poke-frames/f029.png
/tmp/poke-frames/f030.png
/tmp/poke-frames/f031.png
/tmp/poke-frames/f032.png
/tmp/poke-f…",
      "lastProgressAt": 1783377108725,
      "tokens": 24789,
      "toolCalls": 13,
      "durationMs": 136922,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f025.png","mode":"overworld","description":"Top-down overworld route: a vertical mint-green grass path flanked by wavy periwinkle water on the left, dark-green bush clusters dotting the path, and white rectangular fence posts running along brown cliff edges on both sides of the path. Player sprite (Brendan, white-green hat) stands dead center; a Pokéball item s…"
    },
    {
      "type": "workflow_agent",
      "index": 4,
      "label": "frames 37-48",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "ab0762d5ec344b44b",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971803,
      "queuedAt": 1783376971793,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 37-48 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f037.png
/tmp/poke-frames/f038.png
/tmp/poke-frames/f039.png
/tmp/poke-frames/f040.png
/tmp/poke-frames/f041.png
/tmp/poke-frames/f042.png
/tmp/poke-frames/f043.png
/tmp/poke-frames/f044.png
/tmp/poke-f…",
      "lastProgressAt": 1783377071501,
      "tokens": 23667,
      "toolCalls": 13,
      "durationMs": 99698,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f037.png","mode":"dialogue-overworld","description":"Top-down overworld route: pale-green dotted grass, brown rocky cliff ledges, white stone stairway up the center, water in the bottom corners, a small sign, and two 16x24-ish character sprites (red-clothed player + green-haired NPC) standing side by side mid-screen. Dialogue box spans the bottom ~25% of the sc…"
    },
    {
      "type": "workflow_agent",
      "index": 5,
      "label": "frames 49-60",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "ac873fe97b4b8f17e",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971804,
      "queuedAt": 1783376971793,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 49-60 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f049.png
/tmp/poke-frames/f050.png
/tmp/poke-frames/f051.png
/tmp/poke-frames/f052.png
/tmp/poke-frames/f053.png
/tmp/poke-frames/f054.png
/tmp/poke-frames/f055.png
/tmp/poke-frames/f056.png
/tmp/poke-f…",
      "lastProgressAt": 1783377048418,
      "tokens": 23645,
      "toolCalls": 13,
      "durationMs": 76614,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f049.png","mode":"dialogue-overworld","description":"Interior of Petalburg Gym: pale-yellow tiled floor, wood-paneled back wall with two gray doors and a centered plant/statue alcove, two silver trash-can-like pillars flanking the room. Player character stands center facing an NPC (Norman, dark hair, white coat) directly above him. Bottom dialogue box reads 'Oh…"
    },
    {
      "type": "workflow_agent",
      "index": 6,
      "label": "frames 61-72",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "a7a63afc8f5379ae9",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971804,
      "queuedAt": 1783376971793,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 61-72 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f061.png
/tmp/poke-frames/f062.png
/tmp/poke-frames/f063.png
/tmp/poke-frames/f064.png
/tmp/poke-frames/f065.png
/tmp/poke-frames/f066.png
/tmp/poke-frames/f067.png
/tmp/poke-frames/f068.png
/tmp/poke-f…",
      "lastProgressAt": 1783377069357,
      "tokens": 23665,
      "toolCalls": 13,
      "durationMs": 97553,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f061.png","mode":"overworld","description":"Player is surfing: a small trainer sprite riding a round dark Pokemon, dead-center of the screen on blue water with repeating horizontal wave-line tiles. Gray-purple rocky cliff walls frame the left and right edges; a lighter, pale-blue shallow/current channel runs vertically through the middle; a small waterfall and …"
    },
    {
      "type": "workflow_agent",
      "index": 7,
      "label": "frames 73-84",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "a1698be96cec72961",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971804,
      "queuedAt": 1783376971793,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 73-84 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f073.png
/tmp/poke-frames/f074.png
/tmp/poke-frames/f075.png
/tmp/poke-frames/f076.png
/tmp/poke-frames/f077.png
/tmp/poke-frames/f078.png
/tmp/poke-frames/f079.png
/tmp/poke-frames/f080.png
/tmp/poke-f…",
      "lastProgressAt": 1783377050300,
      "tokens": 23676,
      "toolCalls": 13,
      "durationMs": 78496,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f073.png","mode":"overworld","description":"Top-down overworld of a mountain town (Lavaridge-style): a square hot-spring pool bordered by dark rocks sits center, with the player (white/green hat sprite) and two elderly NPC sprites soaking inside, sparkle tiles on the water. Right edge shows a Pokemon Center with red tiled roof, round Pokeball emblem, and a red …"
    },
    {
      "type": "workflow_agent",
      "index": 8,
      "label": "frames 85-96",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "ae2a647b0fda15206",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971804,
      "queuedAt": 1783376971793,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 85-96 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f085.png
/tmp/poke-frames/f086.png
/tmp/poke-frames/f087.png
/tmp/poke-frames/f088.png
/tmp/poke-frames/f089.png
/tmp/poke-frames/f090.png
/tmp/poke-frames/f091.png
/tmp/poke-frames/f092.png
/tmp/poke-f…",
      "lastProgressAt": 1783377085091,
      "tokens": 23701,
      "toolCalls": 13,
      "durationMs": 113287,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f085.png","mode":"overworld","description":"Interior/rooftop floor of a department store: cream-grey floor tiles with a repeating green diamond motif, two yellow planter boxes with bushes on the left wall, purple benches mid-floor, vending-machine alcoves along the top wall, and an orange-railed balustrade running horizontally across the frame separating the ro…"
    },
    {
      "type": "workflow_agent",
      "index": 9,
      "label": "frames 97-108",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "afa8ff36acc82d189",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971804,
      "queuedAt": 1783376971793,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 97-108 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f097.png
/tmp/poke-frames/f098.png
/tmp/poke-frames/f099.png
/tmp/poke-frames/f100.png
/tmp/poke-frames/f101.png
/tmp/poke-frames/f102.png
/tmp/poke-frames/f103.png
/tmp/poke-frames/f104.png
/tmp/poke-…",
      "lastProgressAt": 1783377067469,
      "tokens": 23658,
      "toolCalls": 13,
      "durationMs": 95665,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f097.png","mode":"overworld","description":"Top-down overworld of an ash-covered route: pale beige/white ash blankets the ground and diagonal terraced ridges of ash-dusted grass form a maze. A house with a pointed brown/mauve roof and double door sits upper-left. Player sprite (green-and-white hat, red/brown hair) stands dead-center of the screen. No HUD elemen…"
    },
    {
      "type": "workflow_agent",
      "index": 10,
      "label": "frames 109-120",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "ab0816d4631de4045",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971804,
      "queuedAt": 1783376971793,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 109-120 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f109.png
/tmp/poke-frames/f110.png
/tmp/poke-frames/f111.png
/tmp/poke-frames/f112.png
/tmp/poke-frames/f113.png
/tmp/poke-frames/f114.png
/tmp/poke-frames/f115.png
/tmp/poke-frames/f116.png
/tmp/poke…",
      "lastProgressAt": 1783377071071,
      "tokens": 23669,
      "toolCalls": 13,
      "durationMs": 99267,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f109.png","mode":"overworld","description":"Top-down overworld in a rainy tan/sandy canyon: a dark-brown cave facade with a face-like carved entrance sits top-center, round boulders scattered on both sides, a purple-brown cliff wall along the left edge, and a large rock outcrop bottom-right. Player sprite (brown-clothed with green pack/hair) stands dead center;…"
    },
    {
      "type": "workflow_agent",
      "index": 11,
      "label": "frames 121-132",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "a2807892e25be1484",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971804,
      "queuedAt": 1783376971793,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 121-132 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f121.png
/tmp/poke-frames/f122.png
/tmp/poke-frames/f123.png
/tmp/poke-frames/f124.png
/tmp/poke-frames/f125.png
/tmp/poke-frames/f126.png
/tmp/poke-frames/f127.png
/tmp/poke-frames/f128.png
/tmp/poke…",
      "lastProgressAt": 1783377083388,
      "tokens": 23687,
      "toolCalls": 13,
      "durationMs": 111584,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f121.png","mode":"overworld","description":"Top-down Gen-III (Emerald-style) overworld: player sprite (green bandana) centered, standing at the entrance of a large beige domed multi-story building with light-blue windows (gym/institution). Dark evergreen tree column on the left edge, pink-brown rock outcrop lower-left, sandy tan path patch center, bright tall-g…"
    },
    {
      "type": "workflow_agent",
      "index": 12,
      "label": "frames 133-144",
      "phaseIndex": 1,
      "phaseTitle": "Analyze frames",
      "agentId": "a723bb4eb93f79d2a",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783376971805,
      "queuedAt": 1783376971793,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "promptPreview": "You are analyzing frames from a screen-captured Pokémon gameplay video (1 frame per second, seconds 133-144 of the video). Read ALL of these image files with the Read tool, in order:
/tmp/poke-frames/f133.png
/tmp/poke-frames/f134.png
/tmp/poke-frames/f135.png
/tmp/poke-frames/f136.png
/tmp/poke-frames/f137.png
/tmp/poke-frames/f138.png
/tmp/poke-frames/f139.png
/tmp/poke-frames/f140.png
/tmp/poke…",
      "lastProgressAt": 1783377076003,
      "tokens": 23669,
      "toolCalls": 13,
      "durationMs": 104197,
      "resultPreview": "{"frames":[{"file":"/tmp/poke-frames/f133.png","mode":"overworld","description":"Top-down GBA overworld (Gen 3 Hoenn style) of a rocky desert route: tan ground speckled with pebbles, three large brown boulder formations stacked vertically on the left, a striated cliff wall running down the right edge with a dark purple shadow strip beside it. Player sprite (small character with green hair/hat, ~16…"
    },
    {
      "type": "workflow_agent",
      "index": 13,
      "label": "synthesize grammar report",
      "phaseIndex": 2,
      "phaseTitle": "Synthesize",
      "agentId": "acd6df09c2ed20648",
      "model": "claude-fable-5",
      "state": "done",
      "startedAt": 1783377108727,
      "queuedAt": 1783377108727,
      "attempt": 1,
      "promptPreview": "Below are per-batch summaries and a per-second timeline from a 144-second Pokémon gameplay capture. Synthesize a definitive "presentation grammar" report a game developer can implement from, with sections:
1. OVERWORLD: camera, tiles, sprites, movement presentation
2. ENCOUNTER TRANSITION: what happens visually when a battle starts (effects, order, rough timing inferred from consecutive seconds)
3…",
      "lastProgressAt": 1783377193502,
      "tokens": 39812,
      "toolCalls": 0,
      "durationMs": 84775,
      "resultPreview": "# POKÉMON GEN 3 (EMERALD) PRESENTATION GRAMMAR
Derived from 144s capture. Native resolution: 240x160 (GBA), 16x16 tile grid, ~15x10 tiles visible. All coordinates below assume the 240x160 native canvas; upscale with nearest-neighbor integer scaling only.

---

## 1. OVERWORLD

**Camera**
- Hard-locked on the player: player sprite renders at exact screen center at all times (all 12 batches agree, z…"
    }
  ],
  "totalTokens": 324985,
  "totalToolCalls": 156
