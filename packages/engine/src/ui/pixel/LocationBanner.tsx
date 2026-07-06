import { useEffect, useRef } from "react";

/** Wood plaque, top-left, slides in and auto-dismisses after 2500ms. */
export function LocationBanner({ title, onDone }: { title: string; onDone: () => void }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const t = setTimeout(() => doneRef.current(), 2500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="cq-location-banner" data-testid="location-banner">
      {title}
    </div>
  );
}
