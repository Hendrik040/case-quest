export function DialogueBox({ name, greeting, lines, onClose }: { name: string; greeting?: string; lines: string[]; onClose: () => void }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "#0d1017ee", borderTop: "2px solid #4caf50", padding: 16 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{name}</div>
      {greeting && <p style={{ margin: "0 0 8px" }}>{greeting}</p>}
      {lines.map((l, i) => <p key={i} style={{ margin: "0 0 6px" }}>{l}</p>)}
      <button onClick={onClose} style={{ marginTop: 8 }}>Continue</button>
    </div>
  );
}
