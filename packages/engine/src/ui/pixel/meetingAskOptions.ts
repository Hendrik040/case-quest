import type { MeetingView } from "../../state/session";

export interface MeetingAskOption {
  id: string;
  label: string;
  disabled?: boolean;
  /** Non-selectable persona header row (skipped by `useCursor`, never `onPick`-able). */
  header?: boolean;
  /** The participant this topic belongs to; absent on header rows. */
  actorId?: string;
}

/**
 * Flattens `view.topicsByActor` into one persona-grouped list: a disabled
 * header row per participant (their name, uppercased — mirrors
 * `AgentInfoPanel`'s convention) followed by their open/asked topics.
 * `useCursor` already treats `disabled` entries as unselectable-but-skippable,
 * so a header needs no special-casing beyond `disabled: true` — the cursor
 * simply steps over it to the first real topic, same as an already-asked
 * topic. A participant with zero topics still gets a header (its topics
 * region is just empty), matching `EncounterScreen`'s resolution #5: absence
 * of topics is rendered, not hidden.
 */
export function buildMeetingAskOptions(view: MeetingView): MeetingAskOption[] {
  const options: MeetingAskOption[] = [];
  for (const p of view.participants) {
    options.push({ id: `header:${p.actorId}`, label: p.name.toUpperCase(), header: true, disabled: true });
    const topics = view.topicsByActor[p.actorId] ?? [];
    for (const t of topics) {
      options.push({ id: t.factId, label: t.label, disabled: t.asked, actorId: p.actorId });
    }
  }
  return options;
}

/** ASK is only fully disabled when every participant has zero topics at all
 * (mirrors `EncounterScreen`'s `askDisabled` resolution #5) — a meeting where
 * every open topic has merely been asked already still opens a (disabled)
 * grid rather than hiding ASK outright. */
export function meetingAskDisabled(view: MeetingView): boolean {
  return view.participants.every((p) => (view.topicsByActor[p.actorId] ?? []).length === 0);
}
