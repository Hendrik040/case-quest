import { useState, type KeyboardEvent } from "react";

/**
 * Field-skin panel (white fill, teal border — the kit's "field" palette)
 * hosting a real, pixel-styled `<textarea>` for the player's written
 * reasoning behind a decision. Autofocuses on mount. Enter (without Shift)
 * submits once the trimmed text is non-empty; Shift+Enter inserts a normal
 * newline. The textarea calls `stopPropagation()` on every keydown so the
 * kit's `window`-level handlers (ChoiceBox/Typewriter/etc.) never see the
 * player's typing as game input. Per the controller's refinement of the
 * brief, this panel has no Escape handling at all — losing a long typed
 * reasoning to an accidental Esc would be worse than not offering a
 * cancel-from-here escape hatch.
 */
export function ReasoningPanel({ onSubmit }: { onSubmit: (reasoning: string) => void }) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="cq-reasoning-panel" data-testid="reasoning-panel">
      <div className="cq-reasoning-title">Explain your reasoning</div>
      <textarea
        className="cq-reasoning-textarea"
        data-testid="reasoning-textarea"
        autoFocus
        rows={4}
        placeholder="Why did you choose this?"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="cq-reasoning-submit"
        data-testid="reasoning-submit"
        disabled={!canSubmit}
        onClick={submit}
      >
        COMMIT
      </button>
    </div>
  );
}
