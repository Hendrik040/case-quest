import { useEffect, useRef, useState, type CSSProperties } from "react";
import { validateWorld, WorldSchema, type World } from "@case-quest/schema";
import { GameSession, type DebriefData, type EncounterView } from "./state/session";
import { EventBus } from "./bridge/events";
import { createGame } from "./phaser/game";
import { zoom } from "./ui/pixel/scale";
import { MessageBox } from "./ui/pixel/MessageBox";
import { Typewriter } from "./ui/pixel/Typewriter";
import { ChoiceBox } from "./ui/pixel/ChoiceBox";
import { LocationBanner } from "./ui/pixel/LocationBanner";
import { TransitionBand } from "./ui/pixel/TransitionBand";
import { EncounterScreen, type EncounterFacts } from "./ui/pixel/EncounterScreen";
import { DecisionEncounter } from "./ui/pixel/DecisionEncounter";
import { DebriefPages } from "./ui/pixel/DebriefPages";
import { gridToDataURL } from "./art/canvas";
import { bigGrid } from "./art/grids";

const WORLD_URL = "/worlds/wholesale-offer.world.json";

// Dev/test-only seam: the standalone page's own fetch branch below (never
// reached by the mountCaseQuest embed, which always passes `world` and so
// never calls this) honors a `?world=<url>` query param, letting the
// committed e2e driver (scripts/e2e-drive.mjs, via CQ_WORLD_URL) point the
// driven page at an arbitrary world file instead of the default
// wholesale-offer fixture. Gated on `import.meta.env.DEV` (true for both
// `vite dev` and the vitest default mode, false for a `vite build` of the
// standalone app) so it's inert in production; irrelevant either way to the
// lib build, which never reaches this function.
function resolveWorldUrl(): string {
  if (import.meta.env.DEV) {
    const override = new URLSearchParams(window.location.search).get("world");
    if (override) return override;
  }
  return WORLD_URL;
}

// Host-page callbacks for library embeds (see src/lib.ts). Defined here (not
// lib.ts) so App can type its props without importing its own consumer.
export interface CaseQuestCallbacks {
  onDebriefComplete?: (summary: { endingId: string; factsGathered: number; choices: string[] }) => void;
}

export interface AppProps {
  /** Pre-validated world injected by mountCaseQuest; when absent, App fetches WORLD_URL (standalone dev). */
  world?: World;
  callbacks?: CaseQuestCallbacks;
}

// How long the field hint sits before we check whether the chain that just
// wrapped up unlocked a decision (the banner itself keeps animating for the
// full 2500ms independently — see `LocationBanner`).
const CHAIN_CHECK_DELAY_MS = 1200;
const DECISION_HINT = "Press ENTER when you are ready to decide.";

type Overlay =
  | { kind: "none" }
  | { kind: "transition"; view: EncounterView }
  | { kind: "encounter"; view: EncounterView }
  | { kind: "fieldMsg"; text: string; then?: () => void }
  | { kind: "decisionPrompt" }
  | { kind: "decision" }
  | { kind: "debrief"; data: DebriefData };

// The agent bust sprite only varies by palette index (0-3), never by actor
// identity beyond that — cache the four possible data-URLs once at module
// scope so every consumer (transition band + encounter screen) reuses the
// same <img src> for a given actor instead of re-rasterizing a canvas.
const agentSpriteCache = new Map<number, string>();
function agentSpriteDataUrl(paletteIndex: number): string {
  let url = agentSpriteCache.get(paletteIndex);
  if (url === undefined) {
    url = gridToDataURL(bigGrid("agent", paletteIndex));
    agentSpriteCache.set(paletteIndex, url);
  }
  return url;
}
const PLAYER_BACK_URL = gridToDataURL(bigGrid("playerBack", 0));

// Resolution #2: standardize on the actor's index within the *current
// node's* present_actors list (mod 4) so the same actor keeps one color
// everywhere (WorldScene's NPC sprite, the transition band, the encounter
// screen) instead of per-location placement order.
function actorPaletteIndex(session: GameSession, actorId: string): number {
  return session.currentNode().present_actors.indexOf(actorId) % 4;
}

function currentLocationTitle(session: GameSession): string {
  const loc = session.accessibleLocations().find((l) => l.id === session.currentLocationId());
  return loc?.name ?? session.currentNode().title;
}

function computeEncounterFacts(session: GameSession): EncounterFacts {
  const objective = session.objective();
  const labels = session
    .gatheredFactIds()
    .map((id) => session.world().facts.find((f) => f.id === id)?.label ?? id);
  return { got: objective.got, needed: objective.needed, labels };
}

export function App({ world: injectedWorld, callbacks }: AppProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const busRef = useRef<EventBus | null>(null);

  const [overlay, setOverlay] = useState<Overlay>({ kind: "none" });
  const [bannerTitle, setBannerTitle] = useState<string | null>(null);
  // Kept in sync with `overlay` on every render so the chain-check timer
  // (below) can read the *live* overlay without closing over a stale value.
  const overlayRef = useRef<Overlay>(overlay);
  overlayRef.current = overlay;
  // Handle for the pending chain-check timeout — so a fresh location can
  // cancel a still-pending check from a previous one, and unmount can clear
  // it outright.
  const chainTimerRef = useRef<number | null>(null);

  // Rule 5: unlock check — after a return-to-roaming or a field-message
  // dismissal, see whether the first live decision just became reachable.
  const checkUnlock = () => {
    const session = sessionRef.current;
    if (session && session.pollDecisionPrompt()) setOverlay({ kind: "decisionPrompt" });
  };

  // Rule 4 (boot + location flow): show the banner, then — 1200ms later,
  // independent of the banner's own 2500ms dismissal — check whether this
  // room starts an encounter chain.
  const showLocationBanner = () => {
    const session = sessionRef.current;
    if (!session) return;
    setBannerTitle(currentLocationTitle(session));
    if (chainTimerRef.current !== null) window.clearTimeout(chainTimerRef.current);
    chainTimerRef.current = window.setTimeout(() => {
      chainTimerRef.current = null;
      // If some other overlay (e.g. a fact-orb fieldMsg) is already live,
      // don't clobber it — the chain simply won't auto-trigger for this
      // room entry; the player can still walk up to agents directly.
      if (overlayRef.current.kind !== "none") return;
      const view = session.maybeStartChain();
      if (view) setOverlay({ kind: "transition", view });
    }, CHAIN_CHECK_DELAY_MS);
  };

  useEffect(() => {
    let game: import("phaser").Game | undefined;
    // Guards the async boot against StrictMode's mount→unmount→mount: without
    // it the first mount's game is created after its cleanup already ran,
    // leaving a zombie Phaser instance that swallows keyboard input.
    let cancelled = false;
    (async () => {
      let world: World;
      if (injectedWorld) {
        // Library mode: mountCaseQuest already validated + parsed this world.
        world = injectedWorld;
      } else {
        const raw = await (await fetch(resolveWorldUrl())).json();
        if (cancelled) return;
        const result = validateWorld(raw);
        if (!result.ok) { setErrors(result.errors.map((e) => `[${e.code}] ${e.message}`)); return; }
        world = WorldSchema.parse(raw);
      }
      const session = new GameSession(world);
      const bus = new EventBus();
      sessionRef.current = session;
      busRef.current = bus;
      if (import.meta.env.DEV) {
        (window as unknown as { __cqBus?: EventBus }).__cqBus = bus;
        (window as unknown as { __cqSession?: GameSession }).__cqSession = session;
      }

      bus.on("interact:actor", ({ actorId }) => {
        const view = session.startEncounterWith(actorId);
        setOverlay({ kind: "transition", view });
      });
      bus.on("interact:fact", ({ factId }) => {
        session.gatherFactFromLocation(factId);
        const label = session.world().facts.find((f) => f.id === factId)?.label ?? factId;
        const text = `${session.protagonist().name.toUpperCase()} found ${label}!`;
        setOverlay({ kind: "fieldMsg", text, then: checkUnlock });
      });
      bus.on("location:changed", () => showLocationBanner());

      if (!cancelled && parentRef.current) game = createGame(parentRef.current, session, bus);
      showLocationBanner();
    })();
    return () => {
      cancelled = true;
      game?.destroy(true);
      if (chainTimerRef.current !== null) window.clearTimeout(chainTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rule 9: freeze discipline in one place — any overlay other than "none"
  // freezes the world (grayscale filter + WorldScene input lock); returning
  // to "none" thaws it. fieldMsg/decisionPrompt overlay the live world in
  // spirit, but still must freeze: window keydown handlers preventDefault(),
  // but Phaser's own keyboard plugin still observes the keydown, so an
  // un-frozen WorldScene would replay the same Space/Enter press.
  useEffect(() => {
    busRef.current?.emit("world:freeze", { frozen: overlay.kind !== "none" });
  }, [overlay.kind]);

  // Seam fix (Task 11 playthrough): `LocationBanner` dismisses itself on its
  // own 2500ms timer, independent of the chain-check at 1200ms — so on any
  // location whose first visit auto-triggers an encounter (both rooms in the
  // toy world do), the banner (z-index 30, higher than everything in
  // `.cq-encounter`) was still mounted and visually on top of the transition
  // band/encounter screen for the ~400ms tail of its own timer. Once another
  // overlay takes the screen, the "you've arrived" banner has done its job —
  // drop it immediately instead of waiting out its timer.
  useEffect(() => {
    if (overlay.kind !== "none") setBannerTitle(null);
  }, [overlay.kind]);

  // Rule 7: global Enter shortcut — only while roaming with no overlay up
  // and the first live decision already unlocked.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented) return;
      if (e.key !== "Enter") return;
      const session = sessionRef.current;
      if (!session || overlay.kind !== "none" || session.mode() !== "roaming") return;
      const first = session.liveDecisions()[0];
      if (first && session.isDecisionUnlocked(first.id)) {
        session.startDecision(first.id);
        setOverlay({ kind: "decision" });
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay.kind]);

  // Rule 6: encounter move-on — advance the chain in-place, or return to
  // roaming and run the unlock check.
  const handleMoveOn = () => {
    const session = sessionRef.current!;
    const r = session.encounterMoveOn();
    if (r.next) setOverlay({ kind: "encounter", view: r.next });
    else { setOverlay({ kind: "none" }); checkUnlock(); }
  };

  // Ask refreshes the encounter view in place so a re-opened topics grid
  // reflects the fact just gathered (its `asked` flag flips true) — without
  // this, the topic could be picked again and `encounterAsk` would throw.
  const handleAsk = (factId: string): { line: string } => {
    const session = sessionRef.current!;
    const result = session.encounterAsk(factId);
    const fresh = session.encounterState();
    if (fresh) setOverlay({ kind: "encounter", view: fresh });
    return result;
  };

  const handleDecisionPromptPick = (id: string) => {
    const session = sessionRef.current!;
    if (id === "yes") {
      const first = session.liveDecisions()[0];
      session.startDecision(first.id);
      setOverlay({ kind: "decision" });
    } else {
      setOverlay({ kind: "fieldMsg", text: DECISION_HINT });
    }
  };

  // Rule 8: decision commit / cancel.
  const handleDecisionCommit = (optionId: string, reasoning: string) => {
    const session = sessionRef.current!;
    const decision = session.liveDecisions()[0];
    const r = session.chooseOption(decision.id, optionId, reasoning);
    if (r.endedAt === "ending") {
      const data = session.debrief()!;
      setOverlay({ kind: "debrief", data });
      // Reuse DebriefData fields — endingId and chosen labels come straight
      // from session.debrief(); the fact count is the session's gathered set.
      callbacks?.onDebriefComplete?.({
        endingId: data.ending.id,
        factsGathered: session.gatheredFactIds().length,
        choices: data.choices.map((c) => c.chosenLabel),
      });
      return;
    }
    // "node": chooseOption already moved the session to the new node's first
    // location — tell WorldScene to redraw that room (it only ever redraws
    // on "scene:render"), then run the usual banner + chain-check sequence.
    setOverlay({ kind: "none" });
    busRef.current!.emit("scene:render", {});
    showLocationBanner();
  };

  const handleDecisionCancel = () => {
    sessionRef.current!.cancelDecision();
    setOverlay({ kind: "fieldMsg", text: DECISION_HINT });
  };

  if (errors) {
    return <div style={{ padding: 24 }}><h2>Invalid world.json</h2><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>;
  }

  const session = sessionRef.current;
  const px = zoom();
  const stageStyle: CSSProperties = {
    position: "relative",
    width: 240 * px,
    height: 160 * px,
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className={`cq-stage${overlay.kind !== "none" ? " cq-frozen" : ""}`} style={stageStyle}>
        <div ref={parentRef} style={{ position: "absolute", inset: 0 }} />

        {bannerTitle !== null && (
          <LocationBanner key={bannerTitle} title={bannerTitle} onDone={() => setBannerTitle(null)} />
        )}

        {session && overlay.kind === "transition" && (
          <TransitionBand
            spriteUrl={agentSpriteDataUrl(actorPaletteIndex(session, overlay.view.actorId))}
            onDone={() => setOverlay({ kind: "encounter", view: overlay.view })}
          />
        )}

        {session && overlay.kind === "encounter" && (
          <EncounterScreen
            view={overlay.view}
            playerName={session.protagonist().name}
            facts={computeEncounterFacts(session)}
            agentSpriteUrl={agentSpriteDataUrl(actorPaletteIndex(session, overlay.view.actorId))}
            playerBackUrl={PLAYER_BACK_URL}
            onAsk={handleAsk}
            onMoveOn={handleMoveOn}
          />
        )}

        {overlay.kind === "fieldMsg" && (
          <div data-testid="field-msg">
            <MessageBox skin="field">
              <Typewriter
                key={overlay.text}
                text={overlay.text}
                skin="field"
                onDone={() => {
                  const then = overlay.then;
                  setOverlay({ kind: "none" });
                  then?.();
                }}
              />
            </MessageBox>
          </div>
        )}

        {overlay.kind === "decisionPrompt" && (
          <div data-testid="decision-prompt">
            <MessageBox skin="field">
              <div className="cq-typewriter cq-field">A decision has become clear.</div>
            </MessageBox>
            <ChoiceBox
              options={[{ id: "yes", label: "DECIDE NOW" }, { id: "no", label: "NOT YET" }]}
              onPick={handleDecisionPromptPick}
            />
          </div>
        )}

        {session && overlay.kind === "decision" && (() => {
          const decision = session.liveDecisions()[0];
          return (
            <DecisionEncounter
              prompt={decision.prompt}
              options={decision.options.map((o) => ({ id: o.id, label: o.label }))}
              onCommit={handleDecisionCommit}
              onCancel={handleDecisionCancel}
            />
          );
        })()}

        {overlay.kind === "debrief" && <DebriefPages data={overlay.data} />}
      </div>
    </div>
  );
}
