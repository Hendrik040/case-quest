export function Hud({ nodeTitle, got, needed, facts }: { nodeTitle: string; got: number; needed: number; facts: string[] }) {
  return (
    <div style={{ position: "absolute", top: 8, left: 8, background: "#0009", padding: "8px 12px", borderRadius: 8, maxWidth: 260 }}>
      <div style={{ fontWeight: 600 }}>{nodeTitle}</div>
      <div style={{ fontSize: 12, opacity: 0.85 }}>Facts gathered: {got} / {needed}</div>
      <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 12 }}>
        {facts.map((f) => <li key={f}>{f}</li>)}
      </ul>
    </div>
  );
}
