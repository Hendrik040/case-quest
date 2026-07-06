import { useCursor } from "./ChoiceBox";

export type ActionId = "ask" | "notes" | "moveOn";

const LABELS: Record<ActionId, string> = { ask: "ASK", notes: "NOTES", moveOn: "MOVE ON" };

/**
 * Gen-3 action-menu sub-panel (battle-skin, bottom-right of the message
 * box): ASK / NOTES / MOVE ON. `askDisabled` is set by the caller when
 * `view.topics` is empty (resolution #5) — an actor with no topics at all
 * can't be asked anything, but an actor whose topics are all *asked*
 * still opens the (fully-disabled) topics panel. Reuses `useCursor`
 * (extracted from `ChoiceBox`) for the triangle-cursor keyboard/mouse
 * navigation instead of duplicating it.
 */
export function ActionMenu({ askDisabled, onPick }: {
  askDisabled?: boolean;
  onPick: (action: ActionId) => void;
}) {
  const options: { id: ActionId; label: string; disabled?: boolean }[] = [
    { id: "ask", label: LABELS.ask, disabled: askDisabled },
    { id: "notes", label: LABELS.notes },
    { id: "moveOn", label: LABELS.moveOn },
  ];
  const { cursor, setCursor } = useCursor(options, (id) => onPick(id as ActionId));

  return (
    <div className="cq-action-menu" data-testid="action-menu">
      {options.map((o, i) => (
        <div
          key={o.id}
          className={`cq-action-option${o.disabled ? " cq-disabled" : ""}${i === cursor ? " cq-active" : ""}`}
          onMouseEnter={() => { if (!o.disabled) setCursor(i); }}
          onClick={() => { if (!o.disabled) onPick(o.id); }}
        >
          <span className="cq-choice-cursor" />
          <span className="cq-action-label">{o.label}</span>
        </div>
      ))}
    </div>
  );
}
