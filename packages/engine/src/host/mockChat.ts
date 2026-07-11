import type { Actor, World } from "@case-quest/schema";
import type { MeetingChatCallback, MeetingChatChunk, MeetingChatMessage, MeetingSayTarget } from "../ui/pixel/meetingSay";

/**
 * Injectable time seam for the mock's token-pacing "typing" cadence. Must
 * resolve without reading an ambient clock (no `Date.now`) — the delay
 * amount comes entirely from the `ms` argument the caller passes in, so
 * swapping this for a synchronous/no-op implementation in tests can never
 * change *what* streams, only *how fast*.
 */
export type ChatScheduler = (ms: number) => Promise<void>;

const realScheduler: ChatScheduler = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface MockChatOptions {
  /**
   * Delay awaited via `scheduler` before each streamed token (a light
   * typewriter cadence, not a simulated network round-trip). `0` disables
   * pacing entirely — every token is yielded back-to-back with no `await`
   * on the scheduler at all. Default: 30.
   */
  tokenDelayMs?: number;
  /**
   * Injectable seam for `tokenDelayMs`'s delay (see `ChatScheduler`).
   * Defaults to a real `setTimeout`-backed wait, which is fine for the
   * live/dev app but WRONG for tests: a test that leaves this at its
   * default and doesn't fake timers will genuinely wait `tokenDelayMs *
   * tokenCount` real milliseconds per assertion. Inject a scheduler that
   * resolves via microtask (e.g. `async () => {}`) instead, so `await`ing
   * the stream settles instantly with zero real timers in the test.
   */
  scheduler?: ChatScheduler;
}

const DEFAULT_TOKEN_DELAY_MS = 30;

/**
 * Deterministic, network-free stand-in for a real persona-chat host: given
 * an actor persona and whatever text the player ASKed about or SAId, it
 * streams back a short in-character paraphrase, token by token, ending in a
 * `done: true` chunk — satisfying `MeetingChatCallback` /
 * `consumeMeetingChatStream` (see `meetingSay.ts`) so `MeetingEncounter`'s
 * SAY flow behaves exactly as it would against a real host, just without a
 * network hop. Intended as the dev/standalone/e2e default for
 * `MeetingEncounter`'s optional `onSay` prop (wiring that default into
 * `App` is a separate task — this module only exports the factory).
 *
 * Contract of the returned callback:
 *  - `target: { actorId }` replies in that actor's voice; `target: "all"`
 *    picks one NPC actor from `world.actors` to answer on behalf of the room
 *    (deterministically, keyed off the said text — see `resolveResponder`).
 *    Never picks the protagonist for `"all"` (the player *is* the
 *    protagonist; the mock's "room" is everyone else).
 *  - Every chunk of a given stream carries the same `actorId` (the resolved
 *    responder) — this mock only ever has one persona speak per SAY.
 *  - Fully deterministic: the same `(actorId-or-"all", text)` pair, against
 *    the same `world`, always yields the identical token sequence — no
 *    `Math.random`, no `Date.now`. Variation in tone/wording instead comes
 *    from a stable hash of the responder's id, its `persona.personality` +
 *    `persona.communication_style` text (the closest thing this schema has
 *    to "OCEAN" — free-text persona fields, not structured trait scores),
 *    and the said text itself.
 *  - Throws (rejecting the stream on its first pull, never hanging it) if
 *    `target.actorId` doesn't resolve to an actor in `world.actors`, or if
 *    an `"all"` target is asked of a world with zero actors — both are
 *    caller/world-data wiring bugs, not something to paper over. Every
 *    other unexpected condition (never observed in practice, since the
 *    generated reply is always non-empty) still degrades to a `done: true`
 *    chunk with no token rather than an unterminated stream, matching
 *    `consumeMeetingChatStream`'s documented "empty reply" case.
 */
export function createMockChatHost(world: World, options: MockChatOptions = {}): MeetingChatCallback {
  const tokenDelayMs = options.tokenDelayMs ?? DEFAULT_TOKEN_DELAY_MS;
  const scheduler = options.scheduler ?? realScheduler;

  return async function* mockChatHost(msg: MeetingChatMessage): AsyncGenerator<MeetingChatChunk> {
    const actor = resolveResponder(world, msg.target, msg.text);
    const tokens = tokenizeReply(buildReply(actor, msg.text));

    if (tokens.length === 0) {
      yield { actorId: actor.id, done: true };
      return;
    }

    for (let i = 0; i < tokens.length; i += 1) {
      if (tokenDelayMs > 0) await scheduler(tokenDelayMs);
      const isLast = i === tokens.length - 1;
      yield isLast
        ? { actorId: actor.id, token: tokens[i], done: true }
        : { actorId: actor.id, token: tokens[i] };
    }
  };
}

/**
 * Picks who "speaks" for a given SAY target. `{ actorId }` is a direct
 * lookup (throws if unknown — a mistargeted SAY is a wiring bug upstream,
 * not something this mock should quietly paper over with a canned voice).
 * `"all"` has no single addressee, so this mock deterministically picks one
 * NPC to represent the room — keyed off the said text via `hash32`, so
 * different remarks can draw different responders without ever being
 * random. Falls back to any actor (including the protagonist) only if the
 * world truly has no NPCs, and throws if it has no actors at all.
 */
function resolveResponder(world: World, target: MeetingSayTarget, text: string): Actor {
  if (target !== "all") {
    const actor = world.actors.find((a) => a.id === target.actorId);
    if (!actor) throw new Error(`mockChat: no actor "${target.actorId}" in this world`);
    return actor;
  }
  const npcs = world.actors.filter((a) => a.role === "npc");
  const pool = npcs.length > 0 ? npcs : world.actors;
  if (pool.length === 0) throw new Error("mockChat: world has no actors to respond as");
  return pool[hash32(`all::${text}`) % pool.length];
}

const OPENERS = ["Look,", "Well,", "Right —", "Honestly,", "So,", "Okay,", "Sure —", "Hm —"] as const;
const REFLECTORS: readonly ((gist: string) => string)[] = [
  (g) => `about "${g}"`,
  (g) => `on "${g}"`,
  (g) => `regarding "${g}"`,
  (g) => `on that — "${g}"`,
];
const CLOSERS = [
  "let me put it plainly.",
  "here's where I stand.",
  "that's fair to raise.",
  "I hear you.",
  "that's the honest answer.",
  "for what it's worth.",
] as const;

/**
 * Builds the full (pre-tokenized) reply text: an opener + a quoted gist of
 * what was asked/said + a closer, all picked deterministically from `seed`.
 * This is a heuristic mock, not real NLG — it exists to make a standalone
 * meeting feel populated, not to pass as an LLM.
 */
function buildReply(actor: Actor, saidText: string): string {
  const seed = hash32(`${actor.id}::${actor.persona.personality}::${actor.persona.communication_style}::${saidText}`);
  const opener = pick(OPENERS, seed);
  const reflect = pick(REFLECTORS, seed >>> 5)(gist(saidText));
  const closer = pick(CLOSERS, seed >>> 11);
  return `${opener} ${reflect}, ${closer}`;
}

function pick<T>(options: readonly T[], seed: number): T {
  return options[seed % options.length];
}

/** Trims trailing sentence punctuation and clips long input to a short quoted snippet. */
function gist(text: string): string {
  const trimmed = text.trim().replace(/[?!.]+$/, "");
  const MAX_LEN = 40;
  const clipped = trimmed.length > MAX_LEN ? `${trimmed.slice(0, MAX_LEN).trimEnd()}…` : trimmed;
  return clipped.toLowerCase();
}

/** Splits a reply into stream tokens (one per word, leading space preserved on all but the first) so `tokens.join("")` round-trips the original spacing. */
function tokenizeReply(reply: string): string[] {
  const words = reply.split(/\s+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w : ` ${w}`));
}

/** Deterministic 32-bit FNV-1a string hash — the sole source of "randomness" in this module (no `Math.random`, no `Date.now`), so identical inputs always seed identical output. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
