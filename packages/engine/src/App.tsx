import { useEffect, useRef, useState } from "react";
import { validateWorld, WorldSchema, type World } from "@case-quest/schema";
import { GameSession, type DebriefData } from "./state/session";
import { EventBus } from "./bridge/events";
import { createGame } from "./phaser/game";
import { Hud } from "./ui/Hud";
import { DialogueBox } from "./ui/DialogueBox";
import { DecisionScene } from "./ui/DecisionScene";
import { Debrief } from "./ui/Debrief";

const WORLD_URL = "/worlds/wholesale-offer.world.json";

type Dialogue = { name: string; greeting?: string; lines: string[] };

export function App() {
  const parentRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const sessionRef = useRef<GameSession | null>(null);
  const busRef = useRef<EventBus | null>(null);

  const [hud, setHud] = useState({ nodeTitle: "", got: 0, needed: 0, facts: [] as string[] });
  const [dialogue, setDialogue] = useState<Dialogue | null>(null);
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const [debrief, setDebrief] = useState<DebriefData | null>(null);

  useEffect(() => {
    let game: import("phaser").Game | undefined;
    // Guards the async boot against StrictMode's mount→unmount→mount: without
    // it the first mount's game is created after its cleanup already ran,
    // leaving a zombie Phaser instance that swallows keyboard input.
    let cancelled = false;
    (async () => {
      const raw = await (await fetch(WORLD_URL)).json();
      if (cancelled) return;
      const result = validateWorld(raw);
      if (!result.ok) { setErrors(result.errors.map((e) => `[${e.code}] ${e.message}`)); return; }
      const world: World = WorldSchema.parse(raw);
      const session = new GameSession(world);
      const bus = new EventBus();
      sessionRef.current = session;
      busRef.current = bus;
      if (import.meta.env.DEV) (window as unknown as { __cqBus?: EventBus }).__cqBus = bus;

      const refreshHud = () => {
        const o = session.objective();
        setHud({ nodeTitle: o.nodeTitle, got: o.got, needed: o.needed, facts: session.gatheredFactIds() });
      };
      refreshHud();

      bus.on("interact:actor", ({ actorId }) => {
        const res = session.gatherFactsFromActor(actorId);
        const actor = session.presentActors().find((a) => a.id === actorId);
        setDialogue({ name: actor?.name ?? actorId, greeting: res.greeting, lines: res.revealed.map((r) => r.line) });
        refreshHud();
      });
      bus.on("interact:fact", ({ factId }) => {
        session.gatherFactFromLocation(factId);
        refreshHud();
      });
      bus.on("location:changed", () => refreshHud());

      if (!cancelled && parentRef.current) game = createGame(parentRef.current, session, bus);
    })();
    return () => { cancelled = true; game?.destroy(true); };
  }, []);

  const activateDecision = () => {
    const s = sessionRef.current!;
    const d = s.liveDecisions()[0];
    if (d && s.isDecisionUnlocked(d.id)) setDecisionId(d.id);
  };

  const onChoose = (optionId: string, reasoning: string) => {
    const s = sessionRef.current!;
    const r = s.chooseOption(decisionId!, optionId, reasoning);
    setDecisionId(null);
    if (r.endedAt === "ending") setDebrief(s.debrief());
    else busRef.current!.emit("scene:render", {});
  };

  if (errors) {
    return <div style={{ padding: 24 }}><h2>Invalid world.json</h2><ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>;
  }

  const firstDecision = sessionRef.current?.liveDecisions()[0];
  const unlocked = !!firstDecision && sessionRef.current!.isDecisionUnlocked(firstDecision.id);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={parentRef} style={{ width: "100%", height: "100%" }} />
      {!debrief && <Hud {...hud} />}
      {!debrief && unlocked && !decisionId && !dialogue && (
        <button onClick={activateDecision} style={{ position: "absolute", top: 8, right: 8, padding: "8px 12px" }}>
          Make the decision
        </button>
      )}
      {dialogue && <DialogueBox {...dialogue} onClose={() => setDialogue(null)} />}
      {decisionId && firstDecision && (
        <DecisionScene
          prompt={firstDecision.prompt}
          options={firstDecision.options.map((o) => ({ id: o.id, label: o.label }))}
          onChoose={onChoose}
        />
      )}
      {debrief && <Debrief data={debrief} />}
    </div>
  );
}
