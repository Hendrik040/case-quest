import type { DebriefData } from "../state/session";

export function Debrief({ data }: { data: DebriefData }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "#08090cf7", overflow: "auto", padding: 32 }}>
      <h1 style={{ marginTop: 0 }}>{data.ending.title}</h1>
      <p>{data.ending.summary}</p>
      <h3>What actually happened</h3>
      <p style={{ opacity: 0.9 }}>{data.ending.real_case_comparison}</p>
      <h3>Your decision</h3>
      {data.choices.map((c, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{c.prompt}</div>
          <div>You chose: {c.chosenLabel}</div>
          <div style={{ fontStyle: "italic", opacity: 0.85 }}>“{c.reasoning}”</div>
        </div>
      ))}
      <h3>Learning objectives</h3>
      {data.objectives.map((o) => (
        <div key={o.objective.id} style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>{o.objective.text}</div>
          <div style={{ opacity: 0.9 }}>{o.verdict}</div>
        </div>
      ))}
    </div>
  );
}
