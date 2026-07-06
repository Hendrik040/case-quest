import { useState } from "react";

export function DecisionScene({ prompt, options, onChoose }: {
  prompt: string;
  options: { id: string; label: string }[];
  onChoose: (optionId: string, reasoning: string) => void;
}) {
  const [optionId, setOptionId] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const canConfirm = optionId !== null && reasoning.trim().length > 0;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#08090cf2", display: "flex", flexDirection: "column", justifyContent: "center", padding: 32 }}>
      <h2 style={{ marginTop: 0 }}>{prompt}</h2>
      {options.map((o) => (
        <label key={o.id} style={{ display: "block", margin: "6px 0", cursor: "pointer" }}>
          <input type="radio" name="opt" checked={optionId === o.id} onChange={() => setOptionId(o.id)} /> {o.label}
        </label>
      ))}
      <textarea
        placeholder="Explain your reasoning…"
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
        rows={4}
        style={{ marginTop: 12, background: "#161a22", color: "#e6e6e6", border: "1px solid #333", borderRadius: 6, padding: 8 }}
      />
      <button disabled={!canConfirm} onClick={() => onChoose(optionId!, reasoning)} style={{ marginTop: 12, padding: "8px 16px" }}>
        Commit decision
      </button>
    </div>
  );
}
