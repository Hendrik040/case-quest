import { useEffect, useState } from "react";
import { MessageBox } from "./MessageBox";
import { Typewriter } from "./Typewriter";
import { ChoiceBox } from "./ChoiceBox";
import { AgentInfoPanel } from "./InfoPanel";
import { EncounterDiorama } from "./EncounterScreen";
import { ReasoningPanel } from "./ReasoningPanel";

type Phase = "prompt" | "options" | "confirm" | "reasoning";

/**
 * The "decision boss encounter": the same Gen-3 diorama as `EncounterScreen`
 * (platforms only — no agent/player sprite, since this fight is against the
 * decision itself), an enemy info panel reading "THE DECISION", and a phase
 * machine that walks the player through the prompt, the option list, a
 * YES/NO confirm, and finally a `ReasoningPanel` before calling `onCommit`.
 *
 * Esc cancels (-> `onCancel`, wired by the caller to `session.cancelDecision()`)
 * from `prompt`/`options`/`confirm` — `options` and `confirm` get this for
 * free from `ChoiceBox`'s own Escape handling; `prompt` has no ChoiceBox
 * mounted, so it registers its own single-purpose Escape listener (same
 * repeat/defaultPrevented/preventDefault convention as the rest of the kit).
 * Once inside `ReasoningPanel`, Esc does nothing (a controller refinement of
 * the brief: losing a long typed reasoning to an accidental Esc is worse
 * than not having an escape hatch there).
 */
export function DecisionEncounter({ prompt, options, onCommit, onCancel }: {
  prompt: string;
  options: { id: string; label: string }[];
  onCommit: (optionId: string, reasoning: string) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("prompt");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "prompt") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.defaultPrevented) return;
      if (e.key === "Escape") { onCancel(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onCancel]);

  const handleOptionPick = (id: string) => {
    setSelectedId(id);
    setPhase("confirm");
  };

  const handleConfirmPick = (id: string) => {
    if (id === "yes") setPhase("reasoning");
    else setPhase("options");
  };

  const handleReasoningSubmit = (reasoning: string) => {
    onCommit(selectedId!, reasoning);
  };

  return (
    <div className="cq-encounter" data-testid="decision-encounter">
      <EncounterDiorama />
      <AgentInfoPanel name="THE DECISION" role="" />

      {phase === "prompt" && (
        <MessageBox skin="battle">
          <Typewriter text={prompt} skin="battle" onDone={() => setPhase("options")} />
        </MessageBox>
      )}

      {phase === "options" && (
        <>
          <MessageBox skin="battle">
            <div className="cq-prompt-text">{prompt}</div>
          </MessageBox>
          <ChoiceBox options={options} onPick={handleOptionPick} onCancel={onCancel} />
        </>
      )}

      {phase === "confirm" && (
        <>
          <MessageBox skin="battle">
            <div className="cq-prompt-text">Commit to this?</div>
          </MessageBox>
          <ChoiceBox
            options={[{ id: "yes", label: "YES" }, { id: "no", label: "NO" }]}
            onPick={handleConfirmPick}
            onCancel={onCancel}
          />
        </>
      )}

      {phase === "reasoning" && <ReasoningPanel onSubmit={handleReasoningSubmit} />}
    </div>
  );
}
