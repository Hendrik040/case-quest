import { useEffect, useRef } from "react";

/** Freeze-flavored sweep band carrying `spriteUrl` across the stage (~900ms), then `onDone`. */
export function TransitionBand({ spriteUrl, onDone }: { spriteUrl: string; onDone: () => void }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const t = setTimeout(() => doneRef.current(), 900);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="cq-transition-band" data-testid="transition-band">
      <img className="cq-sprite" src={spriteUrl} alt="" />
    </div>
  );
}
