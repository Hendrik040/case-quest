import { useEffect, useState } from "react";
import type { EncounterView } from "../../state/session";
import { MessageBox } from "./MessageBox";
import { Typewriter } from "./Typewriter";
import { AgentInfoPanel, PlayerInfoPanel } from "./InfoPanel";
import { ActionMenu, type ActionId } from "./ActionMenu";
import { TopicsPanel } from "./TopicsPanel";
import { NotesPanel } from "./NotesPanel";

type Phase = "intro" | "menu" | "topics" | "revealing" | "notes";

export interface EncounterFacts { got: number; needed: number; labels: string[]; }

/**
 * Shared diorama backdrop — the enemy + player platforms — reused by both
 * this screen and `DecisionEncounter` (the "boss fight" against a decision
 * has no agent/player sprites of its own, but sits on the same platforms).
 */
export function EncounterDiorama() {
  return (
    <>
      <div className="cq-platform cq-enemy-platform" />
      <div className="cq-platform cq-player-platform" />
    </>
  );
}

/**
 * Pokemon-Emerald-style encounter diorama: enemy platform + agent sprite
 * (top), player platform + back sprite (bottom-left), info panels, and a
 * bottom UI band that cycles through the phase machine:
 *
 *   intro (slide-in + greeting typewriter)
 *     -> menu (ASK / NOTES / MOVE ON)
 *     -> topics (topic grid; Esc backs out to menu)
 *     -> revealing (typed answer; onDone returns to menu)
 *   notes is a modal detour off menu (any of Space/Enter/Escape/click closes it).
 *
 * A new `view.actorId` (the chain advancing to the next actor) resets the
 * whole machine back to `intro` so the slide-in beat replays (resolution
 * #3) — everything else about a phase change is driven by user input.
 */
export function EncounterScreen({
  view, playerName, facts, agentSpriteUrl, playerBackUrl, onAsk, onMoveOn,
}: {
  view: EncounterView;
  playerName: string;
  facts: EncounterFacts;
  agentSpriteUrl: string;
  playerBackUrl: string;
  onAsk: (factId: string) => { line: string };
  onMoveOn: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [revealLine, setRevealLine] = useState("");

  useEffect(() => {
    setPhase("intro");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.actorId]);

  const introText = view.greeting ?? `${view.name.toUpperCase()} wants to talk!`;
  // Resolution #5: only an actor with zero topics ever disables ASK; an
  // actor whose topics are all asked still opens a (fully-disabled) grid.
  const askDisabled = view.topics.length === 0;

  const handleMenuPick = (action: ActionId) => {
    if (action === "ask") setPhase("topics");
    else if (action === "notes") setPhase("notes");
    else onMoveOn();
  };

  const handleTopicPick = (factId: string) => {
    const { line } = onAsk(factId);
    setRevealLine(line);
    setPhase("revealing");
  };

  return (
    <div className="cq-encounter" data-testid="encounter">
      <EncounterDiorama />

      <img
        key={`agent-sprite-${view.actorId}`}
        className="cq-sprite cq-enemy-sprite cq-slide-in"
        src={agentSpriteUrl}
        alt={view.name}
      />
      <img className="cq-sprite cq-player-sprite" src={playerBackUrl} alt={playerName} />

      <AgentInfoPanel key={`agent-info-${view.actorId}`} name={view.name} role={view.role} />
      <PlayerInfoPanel
        key={`player-info-${view.actorId}`}
        name={playerName}
        got={facts.got}
        needed={facts.needed}
      />

      {phase === "intro" && (
        <MessageBox skin="battle">
          <Typewriter key={`intro-${view.actorId}`} text={introText} skin="battle" onDone={() => setPhase("menu")} />
        </MessageBox>
      )}

      {phase === "menu" && (
        <>
          <MessageBox skin="battle">
            <div className="cq-prompt-text">What will you do?</div>
          </MessageBox>
          <ActionMenu askDisabled={askDisabled} onPick={handleMenuPick} />
        </>
      )}

      {phase === "topics" && (
        <TopicsPanel topics={view.topics} onPick={handleTopicPick} onCancel={() => setPhase("menu")} />
      )}

      {phase === "revealing" && (
        <MessageBox skin="battle">
          <Typewriter text={revealLine} skin="battle" onDone={() => setPhase("menu")} />
        </MessageBox>
      )}

      {phase === "notes" && <NotesPanel labels={facts.labels} onClose={() => setPhase("menu")} />}
    </div>
  );
}
