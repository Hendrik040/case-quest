import type { ReactNode } from "react";

/** Static skinned container; a `Typewriter` renders inside it. */
export function MessageBox({ skin, children }: { skin: "field" | "battle"; children: ReactNode }) {
  return (
    <div className={`cq-message-box cq-${skin}`} data-testid="message-box">
      {children}
    </div>
  );
}
