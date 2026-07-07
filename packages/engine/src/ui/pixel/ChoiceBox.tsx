import { useEffect, useState } from "react";

export type ChoiceOption = { id: string; label: string; disabled?: boolean };

/**
 * Cursor-navigation core shared by every pixel-kit selection list/grid
 * (`ChoiceBox`, and Task 8's `ActionMenu`/`TopicsPanel`): tracks which
 * option index is "active" among `options` (matched by `.id`, skipping any
 * `.disabled` entries when moving), wraps at the ends, and wires one
 * `window` keydown listener for Up/Left (-1) and Down/Right (+1) movement,
 * Space/Enter (pick the active option via `onPick`), and Escape
 * (`onCancel`, if given). Follows the kit's `defaultPrevented`-guard /
 * act-then-`preventDefault` convention so only the top overlay reacts to a
 * keystroke. Left/Right are accepted alongside Up/Down (a superset of the
 * original vertical-list-only behavior) so a 2-column grid like
 * `TopicsPanel` can reuse this same hook instead of layering a second
 * listener on top of it. Callers still own rendering and mouse handling
 * (hover -> `setCursor`, click -> `onPick` directly).
 *
 * An optional `columns` (default 1) switches Up/Down to a true row-major
 * grid stride: Left/Right always step the flat index by ±1, but Up/Down
 * step by ±`columns` so they move a full row (Gen 3's move-grid behavior)
 * instead of behaving like Left/Right. In grid mode, a step that lands on a
 * disabled option keeps stepping by the same stride until it finds an
 * enabled option or runs out of range, in which case the cursor stays put
 * (no wrap-around in grid mode). `columns === 1` (the `ChoiceBox`/
 * `ActionMenu` default) keeps the original flat wrap-around behavior
 * unchanged.
 */
export function useCursor<T extends { id: string; disabled?: boolean }>(
  options: T[],
  onPick: (id: string) => void,
  onCancel?: () => void,
  gridOptions?: { columns?: number },
): { cursor: number; setCursor: (index: number) => void } {
  const columns = gridOptions?.columns ?? 1;
  const enabledIndices = options.reduce<number[]>((acc, o, i) => {
    if (!o.disabled) acc.push(i);
    return acc;
  }, []);
  const [cursor, setCursor] = useState(enabledIndices[0] ?? 0);

  // Defensive: if `options` changes under a mounted instance and the cursor
  // now sits on a disabled (or missing) entry, snap it to the first enabled
  // option rather than leaving the cursor stuck somewhere inert.
  useEffect(() => {
    if (options[cursor]?.disabled) {
      const next = enabledIndices[0];
      if (next !== undefined) setCursor(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const moveCursor = (dir: 1 | -1, axis: "row" | "col" = "col") => {
    if (enabledIndices.length === 0) return;
    if (columns > 1) {
      const step = axis === "row" ? dir * columns : dir;
      let next = cursor + step;
      while (next >= 0 && next < options.length && options[next]?.disabled) {
        next += step;
      }
      if (next >= 0 && next < options.length) setCursor(next);
      // else: stepped out of range — no wrap in grid mode, cursor stays put.
      return;
    }
    const pos = enabledIndices.indexOf(cursor);
    const nextPos = pos === -1 ? 0 : (pos + dir + enabledIndices.length) % enabledIndices.length;
    setCursor(enabledIndices[nextPos]);
  };

  const pick = () => {
    const opt = options[cursor];
    if (opt && !opt.disabled) onPick(opt.id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.defaultPrevented) return;
      if (e.key === "ArrowLeft") { moveCursor(-1, "col"); e.preventDefault(); }
      else if (e.key === "ArrowRight") { moveCursor(1, "col"); e.preventDefault(); }
      else if (e.key === "ArrowUp") { moveCursor(-1, "row"); e.preventDefault(); }
      else if (e.key === "ArrowDown") { moveCursor(1, "row"); e.preventDefault(); }
      else if (e.key === " " || e.key === "Enter") { pick(); e.preventDefault(); }
      else if (e.key === "Escape" && onCancel) { onCancel(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, options, onCancel, columns]);

  return { cursor, setCursor };
}

/**
 * Vertical option list with a triangle cursor. ArrowUp/ArrowDown move the
 * cursor (wrapping, skipping disabled options); Space/Enter picks; Escape
 * calls `onCancel` (if provided); mouse hover moves the cursor and click
 * picks. Disabled options render at 40% opacity and are inert to both the
 * keyboard cursor and mouse.
 */
export function ChoiceBox({ options, onPick, onCancel }: {
  options: ChoiceOption[];
  onPick: (id: string) => void;
  onCancel?: () => void;
}) {
  const { cursor, setCursor } = useCursor(options, onPick, onCancel);

  return (
    <div className="cq-choice-box" data-testid="choice-box">
      {options.map((o, i) => (
        <div
          key={o.id}
          className={`cq-choice-option${o.disabled ? " cq-disabled" : ""}${i === cursor ? " cq-active" : ""}`}
          onMouseEnter={() => { if (!o.disabled) setCursor(i); }}
          onClick={() => { if (!o.disabled) onPick(o.id); }}
        >
          <span className="cq-choice-cursor" />
          <span className="cq-choice-label">{o.label}</span>
        </div>
      ))}
    </div>
  );
}
