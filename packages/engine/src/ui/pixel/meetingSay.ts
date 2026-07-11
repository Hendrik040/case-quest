/**
 * SAY host-bridge seam (M5 Phase 2, prep for Phase 3's real callback). Kept
 * as plain data + pure functions — no React — so both the streaming
 * consumer and the canned fallback are unit-testable without mounting
 * `MeetingEncounter`, and so this module can be swapped for Task 3.1's real
 * `onEncounterChat` contract without touching the component's phase machine.
 *
 * Deliberate departure from the plan's literal `onEncounterChat` signature
 * (`docs/superpowers/plans/2026-07-11-meeting-encounters.md` Task 3.1, which
 * routes by `platformPersonaId`/`platformSceneId`): `MeetingEncounter` only
 * ever sees a `MeetingView` (actorId-keyed), never the World/Actor records
 * that carry `platform_persona_id`. Targeting by `actorId` here keeps this
 * component decoupled from schema internals; whichever task wires the real
 * n-aible adapter in is expected to wrap it in a thin actorId->platform-id
 * adapter rather than pushing that lookup down into this UI layer.
 */

export type MeetingSayTarget = { actorId: string } | "all";

export interface MeetingChatChunk {
  actorId: string;
  token?: string;
  done?: boolean;
  sceneCompleted?: boolean;
}

export interface MeetingChatMessage {
  target: MeetingSayTarget;
  text: string;
}

/** Phase-3 seam: host-provided chat bridge. Absent in standalone/dev use,
 * where `cannedSayLine` supplies a synchronous fallback instead. */
export type MeetingChatCallback = (msg: MeetingChatMessage) => AsyncIterable<MeetingChatChunk>;

/**
 * Drains a `MeetingChatCallback`'s stream, accumulating `token`s into the
 * full reply text and invoking `onProgress` after every token so the caller
 * can render a live typewriter effect. Stops at the first `done: true` chunk
 * (a well-behaved stream should end its iteration there anyway, but a
 * generator that keeps yielding past `done` shouldn't hang the UI on an
 * iterator that never returns). Returns the final text plus whether the host
 * flagged `sceneCompleted` on any chunk.
 *
 * `isCancelled` (final review, C4): an optional cancellation check, polled
 * before every chunk is processed — when it returns true, the loop `break`s
 * immediately (before `onProgress` runs for that chunk), which triggers the
 * language's own IteratorClose semantics on `stream` (a `for await...of` that
 * exits early — via `break`, `return`, or a thrown error — automatically
 * calls the iterator's `.return()`). `naibleAdapter.ts`'s SSE/queue plumbing
 * is already built around exactly this propagating all the way down to
 * releasing the underlying `ReadableStream` reader (see its `withIsLast`
 * doc comment), so a caller (`MeetingEncounter`) that breaks here on unmount
 * gets that cleanup for free — no separate `AbortController` plumbing
 * needed through the `MeetingChatCallback` contract. One known limitation:
 * if the stream is stalled awaiting its NEXT chunk (e.g. a stuck network
 * read) rather than actively yielding, this check can't run until that next
 * chunk arrives (or the stream itself errors/completes) — genuinely
 * unbounded stalls aren't aborted here.
 */
export async function consumeMeetingChatStream(
  stream: AsyncIterable<MeetingChatChunk>,
  onProgress: (partialText: string, chunk: MeetingChatChunk) => void,
  isCancelled?: () => boolean,
): Promise<{ text: string; sceneCompleted: boolean }> {
  let text = "";
  let sceneCompleted = false;
  for await (const chunk of stream) {
    if (isCancelled?.()) break;
    if (chunk.token) text += chunk.token;
    if (chunk.sceneCompleted) sceneCompleted = true;
    onProgress(text, chunk);
    if (chunk.done) break;
  }
  return { text, sceneCompleted };
}

/**
 * Deterministic, network-free stand-in for a persona's reply when no
 * `onSay` host callback is wired (the standalone/dev/e2e path). Named by
 * target rather than content — Task 3.2's `mockChat` is where an
 * in-character paraphrase belongs; this is just enough grammar to keep the
 * Emerald-style text box from going silent.
 */
export function cannedSayLine(targetName: string): string {
  return `${targetName} nods. "Noted — let's keep going."`;
}
