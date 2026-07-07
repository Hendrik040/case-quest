import { useCursor } from "./ChoiceBox";
import type { EncounterTopic } from "../../state/session";

/**
 * Gen-3 "moves"-style topic grid (two columns): one entry per
 * `view.topics`, already-asked topics rendered disabled (40% opacity,
 * inert to keyboard/mouse) rather than removed, so the shape of the grid
 * stays stable as the player works through an actor's topics. Escape backs
 * out to the action menu via `onCancel`. Reuses `useCursor` (shared with
 * `ChoiceBox`/`ActionMenu`) for the triangle-cursor navigation, passing
 * `{ columns: 2 }` so Up/Down move a full row (matching the 2-column CSS
 * grid) instead of behaving like Left/Right.
 */
export function TopicsPanel({ topics, onPick, onCancel }: {
  topics: EncounterTopic[];
  onPick: (factId: string) => void;
  onCancel: () => void;
}) {
  const options = topics.map((t) => ({ id: t.factId, label: t.label, disabled: t.asked }));
  const { cursor, setCursor } = useCursor(options, onPick, onCancel, { columns: 2 });

  return (
    <div className="cq-topics-panel" data-testid="topics-panel">
      {options.map((o, i) => (
        <div
          key={o.id}
          className={`cq-topic-option${o.disabled ? " cq-disabled" : ""}${i === cursor ? " cq-active" : ""}`}
          onMouseEnter={() => { if (!o.disabled) setCursor(i); }}
          onClick={() => { if (!o.disabled) onPick(o.id); }}
        >
          <span className="cq-choice-cursor" />
          <span className="cq-topic-label">{o.label}</span>
        </div>
      ))}
    </div>
  );
}
