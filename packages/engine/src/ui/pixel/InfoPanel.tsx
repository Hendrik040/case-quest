/**
 * Info panels for the encounter diorama (Gen-3 battle-screen idiom):
 * `AgentInfoPanel` (top-left — name + a small role tag) and
 * `PlayerInfoPanel` (name + a "FACTS" progress bar/count + a "CASE" strip
 * below it, both driven by the same `got`/`needed` ratio per the brief).
 * Both pop in via the `cq-panel-pop` scale-in keyframe on mount; the parent
 * (`EncounterScreen`) keys these by `view.actorId` so the pop replays each
 * time the encounter chain advances to a new actor.
 */
export function AgentInfoPanel({ name, role }: { name: string; role: string }) {
  return (
    <div className="cq-info-panel cq-agent-info-panel cq-panel-pop" data-testid="agent-info-panel">
      <div className="cq-info-name">{name.toUpperCase()}</div>
      <div className="cq-info-role">{role}</div>
    </div>
  );
}

export function PlayerInfoPanel({ name, got, needed }: { name: string; got: number; needed: number }) {
  const pct = needed > 0 ? Math.max(0, Math.min(100, (got / needed) * 100)) : 0;
  return (
    <div className="cq-info-panel cq-player-info-panel cq-panel-pop" data-testid="player-info-panel">
      <div className="cq-info-name">{name.toUpperCase()}</div>
      <div className="cq-facts-row">
        <span className="cq-facts-tag">FACTS</span>
        <div className="cq-facts-track" data-testid="facts-bar">
          <div className="cq-facts-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="cq-facts-count">{got}/{needed}</div>
      <div className="cq-case-row">
        <span className="cq-case-label">CASE</span>
        <div className="cq-case-track">
          <div className="cq-case-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
