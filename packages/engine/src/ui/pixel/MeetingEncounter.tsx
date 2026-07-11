import { useRef, useState } from "react";
import type { MeetingView } from "../../state/session";
import { MessageBox } from "./MessageBox";
import { Typewriter } from "./Typewriter";
import { AgentInfoPanel, PlayerInfoPanel } from "./InfoPanel";
import { ChoiceBox, useCursor } from "./ChoiceBox";
import { NotesPanel } from "./NotesPanel";
import type { EncounterFacts } from "./EncounterScreen";
import { buildMeetingAskOptions, meetingAskDisabled } from "./meetingAskOptions";
import { consumeMeetingChatStream, cannedSayLine, type MeetingChatCallback, type MeetingSayTarget } from "./meetingSay";

export type { MeetingChatCallback, MeetingSayTarget, MeetingChatChunk, MeetingChatMessage } from "./meetingSay";

type Phase =
  | "menu"
  | "ask"
  | "sayTarget"
  | "sayInput"
  | "thinking"
  | "streaming"
  | "revealing"
  | "notes"
  | "wrapConfirm";

/**
 * Diegetic beat for a SAY exchange that yields nothing to show: the host
 * stream threw mid-iteration (network drop, host bug) or completed without
 * a single token. Rendered through the same Emerald-style reveal as any
 * other line — the player lands back on the action menu after it, never a
 * stuck screen.
 */
export const SAY_QUIET_LINE = "...the line goes quiet. Maybe try again.";

const MENU_ACTIONS: { id: "ask" | "say" | "notes" | "wrapUp"; label: string }[] = [
  { id: "ask", label: "ASK" },
  { id: "say", label: "SAY" },
  { id: "notes", label: "NOTES" },
  { id: "wrapUp", label: "WRAP UP" },
];

/**
 * Meeting-scoped sibling of `ActionMenu` — same battle-skin box/cursor idiom
 * reused verbatim (shares `useCursor` + the `cq-action-*` CSS classes) but
 * with the 4 meeting-specific verbs (ASK/SAY/NOTES/WRAP UP) instead of
 * `ActionMenu`'s single-NPC ASK/NOTES/MOVE ON, so `EncounterScreen`'s own
 * `ActionMenu`/`ActionId` union stays untouched.
 */
function MeetingActionMenu({ askDisabled, onPick }: {
  askDisabled: boolean;
  onPick: (action: "ask" | "say" | "notes" | "wrapUp") => void;
}) {
  const options = MENU_ACTIONS.map((a) => ({ ...a, disabled: a.id === "ask" && askDisabled }));
  const { cursor, setCursor } = useCursor(options, (id) => onPick(id as typeof options[number]["id"]));
  return (
    <div className="cq-action-menu" data-testid="meeting-action-menu">
      {options.map((o, i) => (
        <div
          key={o.id}
          className={`cq-action-option${o.disabled ? " cq-disabled" : ""}${i === cursor ? " cq-active" : ""}`}
          onMouseEnter={() => { if (!o.disabled) setCursor(i); }}
          onClick={() => { if (!o.disabled) onPick(o.id); }}
        >
          <span className="cq-choice-cursor" />
          <span className="cq-action-label">{o.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * ASK panel: `buildMeetingAskOptions` flattens `topicsByActor` into one
 * persona-grouped list (disabled header row per participant, then their
 * topics) — reuses `useCursor`'s existing disabled-is-skippable behavior for
 * the headers rather than adding a second interaction mode.
 */
function MeetingAskPanel({ view, onPick, onCancel }: {
  view: MeetingView;
  onPick: (actorId: string, factId: string) => void;
  onCancel: () => void;
}) {
  const options = buildMeetingAskOptions(view);
  const { cursor, setCursor } = useCursor(options, (id) => {
    const opt = options.find((o) => o.id === id);
    if (opt?.actorId) onPick(opt.actorId, id);
  }, onCancel);
  return (
    <div className="cq-topics-panel cq-meeting-ask-panel" data-testid="meeting-ask-panel">
      {options.map((o, i) => (
        <div
          key={o.id}
          className={`cq-topic-option${o.header ? " cq-meeting-ask-header" : ""}${o.disabled ? " cq-disabled" : ""}${i === cursor ? " cq-active" : ""}`}
          onMouseEnter={() => { if (!o.disabled) setCursor(i); }}
          onClick={() => { if (!o.disabled && o.actorId) onPick(o.actorId, o.id); }}
        >
          {!o.header && <span className="cq-choice-cursor" />}
          <span className="cq-topic-label">{o.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Free-text SAY input — same field-skin textarea/submit idiom as
 * `ReasoningPanel` (autofocus, Enter-submits/Shift+Enter-newline,
 * `stopPropagation` so the kit's window-level keydown listeners never see
 * the player's typing), under meeting-scoped class/testid names since its
 * content (a chat line, not decision reasoning) is semantically different. */
function MeetingSayInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0;
  const submittedRef = useRef(false);

  const submit = () => {
    if (!canSubmit || submittedRef.current) return;
    submittedRef.current = true;
    onSubmit(trimmed);
  };

  return (
    <div className="cq-reasoning-panel cq-meeting-say-panel" data-testid="meeting-say-panel">
      <div className="cq-reasoning-title">Say something...</div>
      <textarea
        className="cq-reasoning-textarea"
        data-testid="meeting-say-textarea"
        autoFocus
        rows={3}
        placeholder="Type your message"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.repeat) return;
          if (e.key === "Enter" && !e.shiftKey) { submit(); e.preventDefault(); }
        }}
      />
      <button
        type="button"
        className="cq-reasoning-submit"
        data-testid="meeting-say-submit"
        disabled={!canSubmit || submittedRef.current}
        onClick={submit}
      >
        SEND
      </button>
    </div>
  );
}

/**
 * Multi-party ("meeting") counterpart to `EncounterScreen`: every seated
 * participant's bust renders at once (no chain — the player picks who to
 * address), the currently active speaker is highlighted, and the same
 * Emerald text box/typewriter/notes idioms are reused underneath. Actions:
 *
 *   ASK   -> grouped-by-persona topic grid (`MeetingAskPanel`); picking an
 *            open topic calls `onAsk` and reveals its line.
 *   SAY   -> pick a target (`@persona` or `@all`), type free text; with
 *            `onSay` wired this streams a reply token-by-token through
 *            `thinking` -> `streaming` -> `revealing`; without it, a
 *            synchronous canned line goes straight to `revealing`.
 *   NOTES -> the existing `NotesPanel` modal, unchanged.
 *   WRAP UP -> YES/NO confirm; YES calls the required `onWrapUp` (the
 *            caller's job — Task 2.3 — is to have that call
 *            `session.meetingWrapUp()` and dismiss the overlay) and,
 *            best-effort, the optional host-bridge `onSceneWrapUp`.
 *
 * `revealing` is shared by both ASK's dialogue-line reveal and SAY's final
 * text (streamed or canned) — same `Typewriter`/pagination/advance-glyph
 * behavior either way, so there's exactly one "type this line out, then
 * press to continue" implementation in this file.
 */
export function MeetingEncounter({
  view, playerName, facts, agentSpriteUrl, playerBackUrl, onAsk, onSetActive, onSay, onWrapUp, onSceneWrapUp,
}: {
  view: MeetingView;
  playerName: string;
  facts: EncounterFacts;
  /** Bust art only varies by palette index (0-3) — see `App.tsx`'s
   * `agentSpriteDataUrl` cache; the caller passes that lookup in directly
   * rather than this component owning a second cache. */
  agentSpriteUrl: (paletteIndex: number) => string;
  playerBackUrl: string;
  onAsk: (actorId: string, factId: string) => { line: string };
  /** Optional: clicking a bust sets it active in the session too. Purely
   * cosmetic (which bust is highlighted) — ASK/SAY already address a
   * specific persona regardless of "active" speaker. */
  onSetActive?: (actorId: string) => void;
  /** Phase-3 seam (see `meetingSay.ts`): when absent, SAY falls back to a
   * synchronous canned line instead of thinking/streaming. */
  onSay?: MeetingChatCallback;
  onWrapUp: () => void;
  /** Optional host-bridge hook fired best-effort alongside `onWrapUp` (not
   * awaited before dismissing — a network call shouldn't be able to hang the
   * confirm). This is a zero-arg thunk, not the literal Task 3.1
   * `onSceneWrapUp(platformSceneId?): Promise<{nextSceneId?; complete?}>`
   * contract: resolving `platformSceneId` needs the World/StoryNode record
   * this component never sees (only `MeetingView`, actorId-keyed). Whoever
   * wires the real host callback in (Task 2.3/3.1) is expected to close over
   * the session/world and pass a thunk here, e.g. `() =>
   * callbacks.onSceneWrapUp?.(currentNode().platform_scene_id)`. */
  onSceneWrapUp?: () => Promise<unknown>;
}) {
  const [phase, setPhase] = useState<Phase>("menu");
  const [revealLine, setRevealLine] = useState("");
  const [streamText, setStreamText] = useState("");
  const [sayTarget, setSayTarget] = useState<MeetingSayTarget | null>(null);

  const askDisabled = meetingAskDisabled(view);

  const handleMenuPick = (action: "ask" | "say" | "notes" | "wrapUp") => {
    if (action === "ask") setPhase("ask");
    else if (action === "say") setPhase("sayTarget");
    else if (action === "notes") setPhase("notes");
    else setPhase("wrapConfirm");
  };

  const handleAskPick = (actorId: string, factId: string) => {
    const { line } = onAsk(actorId, factId);
    onSetActive?.(actorId);
    setRevealLine(line);
    setPhase("revealing");
  };

  const sayTargetOptions = [
    ...view.participants.map((p) => ({ id: p.actorId, label: `@${p.name}` })),
    { id: "all", label: "@ALL" },
  ];
  const handleSayTargetPick = (id: string) => {
    const target: MeetingSayTarget = id === "all" ? "all" : { actorId: id };
    setSayTarget(target);
    if (typeof target === "object") onSetActive?.(target.actorId);
    setPhase("sayInput");
  };

  const handleSaySubmit = (text: string) => {
    const target = sayTarget!;
    if (onSay) {
      setStreamText("");
      setPhase("thinking");
      let firstToken = true;
      // Every failure mode funnels into the shared "revealing" phase with a
      // diegetic fallback line — a host stream that throws mid-iteration, an
      // `onSay` that throws synchronously, or a stream that ends without a
      // single token must never strand the player in thinking/streaming,
      // which render no menu and no cancel affordance.
      try {
        consumeMeetingChatStream(onSay({ target, text }), (partial) => {
          if (firstToken) { firstToken = false; setPhase("streaming"); }
          setStreamText(partial);
        }).then(
          ({ text: finalText }) => setRevealLine(finalText.trim().length > 0 ? finalText : SAY_QUIET_LINE),
          () => setRevealLine(SAY_QUIET_LINE),
        ).then(() => setPhase("revealing"));
      } catch {
        setRevealLine(SAY_QUIET_LINE);
        setPhase("revealing");
      }
    } else {
      const targetName = target === "all" ? "Everyone" : view.participants.find((p) => p.actorId === target.actorId)?.name ?? "They";
      setRevealLine(cannedSayLine(targetName));
      setPhase("revealing");
    }
  };

  const handleWrapConfirmPick = (id: string) => {
    if (id !== "yes") { setPhase("menu"); return; }
    onWrapUp();
    // Fire-and-forget by design (a network call must not hang the confirm),
    // so a rejection has nowhere to land — swallow it explicitly rather than
    // leaking an unhandled rejection from a click handler.
    onSceneWrapUp?.().catch(() => {});
  };

  return (
    <div className="cq-encounter cq-meeting" data-testid="meeting-encounter">
      <div className="cq-meeting-busts" data-testid="meeting-busts">
        {view.participants.map((p) => (
          <div
            key={p.actorId}
            className={`cq-meeting-bust${p.actorId === view.activeActorId ? " cq-active-speaker" : ""}`}
            data-testid={`meeting-bust-${p.actorId}`}
            onClick={() => onSetActive?.(p.actorId)}
          >
            <img className="cq-sprite cq-meeting-bust-sprite" src={agentSpriteUrl(p.paletteIndex)} alt={p.name} />
            <span className="cq-meeting-bust-name">{p.name}</span>
          </div>
        ))}
      </div>

      <img className="cq-sprite cq-player-sprite" src={playerBackUrl} alt={playerName} />

      {(() => {
        const active = view.participants.find((p) => p.actorId === view.activeActorId);
        return active ? <AgentInfoPanel key={active.actorId} name={active.name} role={active.role} /> : null;
      })()}
      <PlayerInfoPanel name={playerName} got={facts.got} needed={facts.needed} />

      {phase === "menu" && (
        <>
          <MessageBox skin="battle">
            <div className="cq-prompt-text">What will you do?</div>
          </MessageBox>
          <MeetingActionMenu askDisabled={askDisabled} onPick={handleMenuPick} />
        </>
      )}

      {phase === "ask" && (
        <MeetingAskPanel view={view} onPick={handleAskPick} onCancel={() => setPhase("menu")} />
      )}

      {phase === "sayTarget" && (
        <ChoiceBox options={sayTargetOptions} onPick={handleSayTargetPick} onCancel={() => setPhase("menu")} />
      )}

      {phase === "sayInput" && <MeetingSayInput onSubmit={handleSaySubmit} />}

      {phase === "thinking" && (
        <MessageBox skin="battle">
          <div className="cq-typewriter cq-battle" data-testid="meeting-thinking">...</div>
        </MessageBox>
      )}

      {phase === "streaming" && (
        <MessageBox skin="battle">
          <div className="cq-typewriter cq-battle" data-testid="meeting-stream">{streamText}</div>
        </MessageBox>
      )}

      {phase === "revealing" && (
        <MessageBox skin="battle">
          <Typewriter text={revealLine} skin="battle" onDone={() => setPhase("menu")} />
        </MessageBox>
      )}

      {phase === "notes" && <NotesPanel labels={facts.labels} onClose={() => setPhase("menu")} />}

      {phase === "wrapConfirm" && (
        <>
          <MessageBox skin="battle">
            <div className="cq-prompt-text">Wrap up this meeting?</div>
          </MessageBox>
          <ChoiceBox
            options={[{ id: "yes", label: "YES" }, { id: "no", label: "NO" }]}
            onPick={handleWrapConfirmPick}
            onCancel={() => setPhase("menu")}
          />
        </>
      )}
    </div>
  );
}
