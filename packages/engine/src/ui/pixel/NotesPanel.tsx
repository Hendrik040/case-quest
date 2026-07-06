import { useEffect, useRef } from "react";

/**
 * Field-skin overlay listing gathered fact labels (`facts.labels`), or a
 * "No facts yet." placeholder when empty. Dismisses on Space/Enter/Escape
 * (via a `window` keydown listener, same `defaultPrevented`-guard
 * convention as the rest of the kit) or a click anywhere on the panel. The
 * close callback is held in a ref (mirroring `LocationBanner`/
 * `TransitionBand`'s `doneRef` pattern) so the listener is registered once
 * on mount rather than re-subscribing on every parent re-render.
 */
export function NotesPanel({ labels, onClose }: { labels: string[]; onClose: () => void }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === " " || e.key === "Enter" || e.key === "Escape") { closeRef.current(); e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="cq-notes-panel" data-testid="notes-panel" onClick={() => closeRef.current()}>
      <div className="cq-notes-title">NOTES</div>
      {labels.length === 0 ? (
        <div className="cq-notes-empty">No facts yet.</div>
      ) : (
        <ul className="cq-notes-list">
          {labels.map((label, i) => <li key={i}>{label}</li>)}
        </ul>
      )}
    </div>
  );
}
