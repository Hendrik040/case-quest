import { useEffect, useMemo, useRef, useState } from "react";
import { paginate } from "./paginate";

/**
 * Types `text` out page-by-page (each page = `lines` rows of `cols` chars,
 * per `paginate`). Space/Enter/click: skip the current page to fully typed,
 * or (once fully typed) advance to the next page; after the last page,
 * fires `onDone`.
 *
 * Deviations from the brief's literal snippet (both required by the
 * controller's resolutions, not just style choices):
 *  - `onKey` bails on `e.defaultPrevented` and only calls `preventDefault()`
 *    after acting, so a stacked passive listener can't double-handle one
 *    keystroke (resolution #4).
 *  - the interface comment ("Space/Enter/click advances") requires click
 *    support the snippet's JSX omitted; `advance` is hoisted out of the
 *    effect (via a ref, mirroring the existing `doneRef` pattern) so the
 *    same logic drives both the keydown listener (registered once on
 *    mount) and the container's `onClick`, instead of re-subscribing the
 *    window listener on every typed character.
 *  - `pages[page]` is clamped to the last valid index so a `text` prop
 *    change on an already-mounted instance (fewer pages than before)
 *    can't read past the end of the new `pages` array in the render that
 *    happens before the reset effect runs.
 */
export function Typewriter({ text, cols = 30, lines = 2, speed = 35, onDone, skin = "field" }: {
  text: string; cols?: number; lines?: number; speed?: number; onDone?: () => void; skin?: "field" | "battle";
}) {
  const pages = useMemo(() => paginate(text, cols, lines), [text, cols, lines]);
  const [page, setPage] = useState(0);
  const [chars, setChars] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const safePage = Math.min(page, pages.length - 1);
  const full = pages[safePage].join("\n");
  const typed = chars >= full.length;

  useEffect(() => { setPage(0); setChars(0); }, [text]);
  useEffect(() => {
    if (typed) return;
    const t = setInterval(() => setChars((c) => c + 1), 1000 / speed);
    return () => clearInterval(t);
  }, [typed, speed, safePage, text]);

  const advance = () => {
    if (!typed) { setChars(full.length); return; }
    if (safePage + 1 < pages.length) { setPage(safePage + 1); setChars(0); }
    else doneRef.current?.();
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.defaultPrevented) return;
      if (e.key === " " || e.key === "Enter") { advanceRef.current(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={`cq-typewriter cq-${skin}`}
      data-testid="typewriter"
      onClick={() => advanceRef.current()}
    >
      {full.slice(0, chars)}
      {typed && <span className="cq-advance" data-testid="advance-glyph" />}
    </div>
  );
}
