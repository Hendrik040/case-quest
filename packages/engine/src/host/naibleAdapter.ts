/**
 * Real n-aible HTTP/SSE host adapter (M5 Task 3.3).
 *
 * Wires the RATIFIED actorId-keyed contract in `../ui/pixel/meetingSay.ts`
 * (`MeetingChatCallback` / `MeetingChatChunk`) to n-aible's actual
 * `/api/simulation/*` endpoints, exactly as `meetingSay.ts`'s own doc comment
 * anticipates: "whichever task wires the real n-aible adapter in is expected
 * to wrap it in a thin actorId->platform-id adapter rather than pushing that
 * lookup down into this UI layer." This module is that thin adapter.
 *
 * This deliberately does NOT implement the plan's literal `onEncounterChat`
 * sketch (`docs/superpowers/plans/2026-07-11-meeting-encounters.md` Task
 * 3.1 — `personaId`-keyed chunks, `{nodeId, platformSceneId, target:
 * {platformPersonaId}|'all', text}` input). That sketch is for whatever
 * wires `CaseQuestCallbacks` in `App.tsx`/`lib.ts` (untouched by this task —
 * see the task brief). This module's `onSay` is the actorId-keyed seam that
 * actually exists today (`MeetingEncounter`'s `onSay` prop); a future task
 * can trivially wrap `onSay` to satisfy the richer sketch if needed.
 *
 * ## Persona routing
 * Routing is strictly by the schema's `Actor.platform_persona_id` crosswalk
 * field (`buildActorPersonaMap`), never by display name — per the task's
 * explicit instruction. Outgoing messages are given an `@<platform_persona_id>`
 * mention token (chat_handler.py's `@mention` regex, read at
 * `/Users/hendrikkrack/Desktop/n-aible/n-aible_edtech_sims/backend/modules/simulation/handlers/chat_handler.py:163-173`,
 * matches by iterating `personas` and comparing against each persona's
 * simulation-level `id` handle, e.g. "nick_elliott" — NOT this numeric
 * crosswalk id) alongside the (currently backend-unused, see
 * `schemas/dto.py:26`) `target_persona_id` field. **This is a documented
 * assumption, not a verified integration**: it depends on the sibling repo's
 * still-TODO Phase 4 item ("Fix the `@mention` regex ... and prefer id
 * routing from the game client") to actually resolve correctly against a
 * live backend. Until then, an `@<id>` mention against today's chat_handler.py
 * falls through to its "I don't recognize that persona" fallback text rather
 * than reaching the intended persona — harmless (the reply still streams
 * back and resolves through the `persona_id` crosswalk below) but worth
 * knowing. See the task report for the full write-up.
 *
 * Inbound frames resolve back to an `actorId` via `persona_id` (the numeric
 * DB id n-aible actually stamps on every response frame — see
 * `schemas/dto.py:64` `SimulationPersonaResponse.id` and chat_handler.py's
 * `str(persona_id) if persona_id else None`), which is unambiguous and not a
 * documented assumption.
 *
 * ## Transport injection
 * `fetch` is injected (see `FetchLike`) rather than imported so unit tests
 * run against recorded fixtures with zero real network. `FetchLike`'s
 * response shape is a structural subset of the DOM `Response` type, so in
 * production this is just `{ fetch: (url, init) => fetch(url, init) }` (or
 * `fetch` itself, bound) — see the task report for how the Next embed is
 * expected to wire this in. **No live backend run has verified this module
 * end-to-end; treat it as integration UNVERIFIED until exercised against a
 * running n-aible instance.**
 */

import type { World } from "@case-quest/schema";
import type { MeetingChatCallback, MeetingChatChunk, MeetingChatMessage, MeetingSayTarget } from "../ui/pixel/meetingSay";

// ---- crosswalk ----------------------------------------------------------

export interface ActorPersonaMap {
  actorIdToPersonaId: Map<string, number>;
  personaIdToActorId: Map<number, string>;
}

/**
 * Derives the actorId<->platform_persona_id crosswalk from a World's actors.
 * Actors without a `platform_persona_id` (e.g. the protagonist, or an actor
 * a Case 3-style pipeline hasn't crosswalked yet) are simply absent from
 * both maps rather than erroring — only a genuinely ambiguous crosswalk
 * (two actors claiming the same platform id) is a hard failure, since that
 * would silently misroute one persona's replies to the wrong bust.
 */
export function buildActorPersonaMap(world: World): ActorPersonaMap {
  const actorIdToPersonaId = new Map<string, number>();
  const personaIdToActorId = new Map<number, string>();
  for (const actor of world.actors) {
    const personaId = actor.platform_persona_id;
    if (personaId === undefined) continue;
    const claimedBy = personaIdToActorId.get(personaId);
    if (claimedBy !== undefined) {
      throw new Error(
        `naibleAdapter: platform_persona_id ${personaId} is claimed by both actors "${claimedBy}" and "${actor.id}" — the crosswalk must be 1:1`,
      );
    }
    actorIdToPersonaId.set(actor.id, personaId);
    personaIdToActorId.set(personaId, actor.id);
  }
  return { actorIdToPersonaId, personaIdToActorId };
}

/** Sentinel actorId for chunks the backend didn't attribute to any crosswalked
 * persona (orchestrator/system text — `persona_id: null` in the wire frame,
 * e.g. the `help` command reply or an "I don't recognize that persona"
 * fallback). Only reachable for `target: "all"`; a single-target message
 * falls back to the addressed actorId instead (see `resolveActorId`) since
 * `consumeMeetingChatStream` doesn't currently branch on `actorId` at all —
 * this only matters once the UI grows per-bubble-per-actor rendering. */
export const ORCHESTRATOR_ACTOR_ID = "__orchestrator__";

// ---- transport ------------------------------------------------------------

/**
 * Structural subset of the DOM `Response` type. Real usage can pass
 * `globalThis.fetch` directly (its return value satisfies this shape); tests
 * pass a fixture-backed fake with zero real network.
 */
export interface FetchLikeResponse {
  readonly status: number;
  readonly ok: boolean;
  json(): Promise<unknown>;
  text(): Promise<string>;
  readonly body: ReadableStream<Uint8Array> | null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<FetchLikeResponse>;

// ---- backend wire shapes (not exported — internal parsing detail) --------

/** One parsed `data: {...}` SSE payload. Every field is optional: chat_handler.py
 * yields several distinct shapes (token frame, per-persona done frame, help-command
 * done frame, error frame) that only share a subset of keys — see fixtures/sseFrames.ts
 * for the exact recorded shapes and their chat_handler.py provenance. */
interface BackendFrame {
  content?: string;
  done?: boolean;
  persona_name?: string | null;
  persona_id?: string | null;
  scene_completed?: boolean;
  next_scene_id?: number | null;
  turn_count?: number;
  full_content?: string;
  error?: string;
}

/** Splits one raw SSE event body (the text between two `\n\n`s, or the final
 * trailing fragment) into its `data:` lines and JSON-parses each payload.
 * Non-`data:` lines (SSE comments like `: keep-alive`, blank lines, other
 * fields) and lines whose payload fails to parse are silently skipped —
 * "malformed SSE lines (skip, don't crash)" per the task brief. */
function parseSseEventLines(rawEvent: string): BackendFrame[] {
  const frames: BackendFrame[] = [];
  for (const line of rawEvent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice("data:".length).trim();
    if (!payload) continue;
    try {
      frames.push(JSON.parse(payload) as BackendFrame);
    } catch {
      continue;
    }
  }
  return frames;
}

/** Replays the queued-job `chunks` array (each entry already a full raw
 * `"data: ...\n\n"` string — see fixtures/jsonResponses.ts `JOB_RESULT_CHAT`
 * provenance) through the same frame parser the live stream uses. */
async function* framesFromRawChunks(rawChunks: string[]): AsyncGenerator<BackendFrame> {
  for (const raw of rawChunks) {
    for (const frame of parseSseEventLines(raw)) yield frame;
  }
}

/** Reads a live `text/event-stream` body, reassembling frames that a real
 * TCP stream may split mid-JSON-object across separate `reader.read()`
 * chunks, and splitting on the SSE event delimiter (`\n\n`). */
async function* framesFromStream(body: ReadableStream<Uint8Array>): AsyncGenerator<BackendFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim().length > 0) for (const frame of parseSseEventLines(buffer)) yield frame;
        return;
      }
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        for (const frame of parseSseEventLines(rawEvent)) yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Pairs each item from `source` with whether it was the LAST item yielded,
 * via one-item lookahead. Used to tell a genuinely final backend frame
 * (stream really is over) apart from an intra-stream per-persona `done:
 * true` segment boundary (`@all`/multi-mention reply with more personas
 * still to come) — both look identical field-for-field on the wire; only
 * stream exhaustion disambiguates them. */
async function* withIsLast<T>(source: AsyncGenerator<T>): AsyncGenerator<[T, boolean]> {
  // The `finally` here is load-bearing, not decorative: `for await...of` (and
  // any early `break`/`return`/thrown error from a consumer) closes ONLY the
  // generator instance it's directly iterating — i.e. `IteratorClose` calls
  // `.return()` on *this* generator, not transitively on `source`. Without
  // this `finally`, a consumer that stops early (e.g. `toMeetingChatChunks`
  // throwing on an `{error}` frame that isn't `source`'s truly final item)
  // would tear down `withIsLast` but abandon `source` mid-suspension,
  // permanently skipping `framesFromStream`'s `finally { reader.releaseLock();
  // }` and leaking the locked stream reader. Calling `source.return?.()` here
  // propagates the closure down, same as `yield*` delegation would.
  let current: IteratorResult<T> | undefined;
  try {
    current = await source.next();
    while (!current.done) {
      const next = await source.next();
      yield [current.value, next.done === true];
      current = next;
    }
  } finally {
    if (!current?.done) await source.return?.(undefined);
  }
}

function resolveActorId(
  frame: BackendFrame,
  target: MeetingSayTarget,
  personaIdToActorId: Map<number, string>,
): string {
  if (frame.persona_id !== null && frame.persona_id !== undefined) {
    const numeric = Number(frame.persona_id);
    if (!Number.isNaN(numeric)) {
      const actorId = personaIdToActorId.get(numeric);
      if (actorId !== undefined) return actorId;
    }
  }
  return target === "all" ? ORCHESTRATOR_ACTOR_ID : target.actorId;
}

/**
 * Translates parsed backend frames into `MeetingChatChunk`s. Only the chunk
 * built from the stream's truly final frame carries `done: true` —
 * `consumeMeetingChatStream` (meetingSay.ts) stops at the first `chunk.done`,
 * so marking every persona-segment boundary `done` would silently drop every
 * persona after the first in an `@all`/multi-mention reply.
 */
async function* toMeetingChatChunks(
  frames: AsyncGenerator<BackendFrame>,
  opts: {
    target: MeetingSayTarget;
    personaIdToActorId: Map<number, string>;
    onMeta?: (meta: { turnCount?: number; nextSceneId?: number | null }) => void;
  },
): AsyncGenerator<MeetingChatChunk> {
  for await (const [frame, isLastFrame] of withIsLast(frames)) {
    if (frame.error) throw new Error(`naibleAdapter: n-aible stream reported an error: ${frame.error}`);
    const actorId = resolveActorId(frame, opts.target, opts.personaIdToActorId);
    if (frame.content) {
      const chunk: MeetingChatChunk = { actorId, token: frame.content };
      if (frame.scene_completed) chunk.sceneCompleted = true;
      yield chunk;
    }
    if (frame.done) {
      opts.onMeta?.({ turnCount: frame.turn_count, nextSceneId: frame.next_scene_id });
      const chunk: MeetingChatChunk = { actorId, done: isLastFrame };
      if (frame.scene_completed) chunk.sceneCompleted = true;
      yield chunk;
    }
  }
}

// ---- queue (202 + job_id) fallback ---------------------------------------

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

async function postJson(fetchFn: FetchLike, url: string, body: unknown): Promise<FetchLikeResponse> {
  return fetchFn(url, { method: "POST", credentials: "include", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

async function getJson(fetchFn: FetchLike, url: string): Promise<FetchLikeResponse> {
  return fetchFn(url, { method: "GET", credentials: "include", headers: { Accept: "application/json" } });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `/api/simulation/job/{jobId}/status` until it settles, then fetches
 * `/result`. Shared by the `linear-chat-stream` and `grade` 202 fallbacks —
 * both endpoints degrade to the same Redis-queue job under load (router.py
 * `should_use_queue()`), and both jobs' results are read the same way
 * (`/job/{id}/status` then `/job/{id}/result`), only their payload shape
 * differs (`{chunks}` vs `{grading}` — see tasks.py:71-74/178-181), which
 * callers unwrap themselves.
 */
async function pollJobResult(
  fetchFn: FetchLike,
  baseUrl: string,
  jobId: string,
  pollIntervalMs: number,
  pollMaxAttempts: number,
  sleep: (ms: number) => Promise<void>,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
    await sleep(pollIntervalMs);
    const statusRes = await getJson(fetchFn, joinUrl(baseUrl, `/api/simulation/job/${jobId}/status`));
    if (!statusRes.ok) throw new Error(`naibleAdapter: job ${jobId} status check failed (HTTP ${statusRes.status})`);
    const status = (await statusRes.json()) as { status?: string; error?: string };
    if (status.status === "completed") {
      const resultRes = await getJson(fetchFn, joinUrl(baseUrl, `/api/simulation/job/${jobId}/result`));
      if (!resultRes.ok) throw new Error(`naibleAdapter: job ${jobId} result fetch failed (HTTP ${resultRes.status})`);
      return (await resultRes.json()) as Record<string, unknown>;
    }
    if (status.status === "failed") {
      throw new Error(`naibleAdapter: queued job ${jobId} failed: ${status.error ?? "unknown error"}`);
    }
    // "pending" | "processing" (or an unrecognized status) — keep polling.
  }
  throw new Error(`naibleAdapter: queued job ${jobId} did not complete after ${pollMaxAttempts} polls`);
}

async function resolveQueuedJob(
  res: FetchLikeResponse,
  fetchFn: FetchLike,
  baseUrl: string,
  pollIntervalMs: number,
  pollMaxAttempts: number,
  sleep: (ms: number) => Promise<void>,
): Promise<Record<string, unknown>> {
  const queued = (await res.json()) as { job_id?: string };
  if (!queued.job_id) throw new Error("naibleAdapter: 202 response was missing job_id");
  return pollJobResult(fetchFn, baseUrl, queued.job_id, pollIntervalMs, pollMaxAttempts, sleep);
}

// ---- public config / result types ----------------------------------------

export interface NaibleAdapterConfig {
  /** Origin the Next proxy serves `/api/simulation/*` from; "" for
   * same-origin (the expected embed case). */
  baseUrl: string;
  fetch: FetchLike;
  simulationId: number;
  actorPersonaMap: ActorPersonaMap;
  /** Poll cadence for the 202+job_id queue fallback. Default 1500ms. */
  pollIntervalMs?: number;
  /** Give up after this many polls (default 20 — ~30s at the default
   * cadence) rather than polling forever against a stuck job. */
  pollMaxAttempts?: number;
  /** Injectable delay for the poll loop — tests pass a no-op so fixture
   * runs don't actually wait. Defaults to a real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Side-channel for `turn_count`/`next_scene_id`, which `MeetingChatChunk`
   * (meetingSay.ts, RATIFIED) has no field for — see the module doc. */
  onMeta?: (meta: { turnCount?: number; nextSceneId?: number | null }) => void;
}

export interface StartResult {
  userProgressId: number;
  /** Full parsed `SimulationStartResponse` body, for callers that need more
   * than the id (e.g. `current_scene`/`all_scenes` to seed `setCurrentScene`). */
  body: Record<string, unknown>;
}

export interface SceneWrapUpResult {
  nextSceneId?: number;
  complete?: boolean;
}

export interface DecisionReasoning {
  /** `save-message` requires a `scene_id` (schemas/dto.py:29-36's
   * `SaveMessageRequest` has no default) — the wrap-up decision is recorded
   * against the scene it was made in. */
  platformSceneId: number;
  text: string;
  senderName?: string;
}

export interface GradePayload {
  overallScore: number;
  overallFeedback: string;
  scenes: unknown[];
  rubricTotalPoints: number;
}

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_POLL_MAX_ATTEMPTS = 20;

/**
 * Stateful host-bridge adapter: one instance per active simulation run. Holds
 * `user_progress_id` (from `start()`) and the current `platform_scene_id`
 * (from `setCurrentScene`) so `onSay`'s fixed `MeetingChatCallback` signature
 * — which has no room for either — still has what it needs to build each
 * request.
 */
export class NaibleAdapter {
  private userProgressId: number | undefined;
  private currentPlatformSceneId: number | undefined;
  private readonly fetchFn: FetchLike;
  private readonly baseUrl: string;
  private readonly simulationId: number;
  private readonly actorIdToPersonaId: Map<string, number>;
  private readonly personaIdToActorId: Map<number, string>;
  private readonly pollIntervalMs: number;
  private readonly pollMaxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onMeta?: (meta: { turnCount?: number; nextSceneId?: number | null }) => void;

  constructor(config: NaibleAdapterConfig) {
    this.fetchFn = config.fetch;
    this.baseUrl = config.baseUrl;
    this.simulationId = config.simulationId;
    this.actorIdToPersonaId = config.actorPersonaMap.actorIdToPersonaId;
    this.personaIdToActorId = config.actorPersonaMap.personaIdToActorId;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollMaxAttempts = config.pollMaxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
    this.sleep = config.sleep ?? defaultSleep;
    this.onMeta = config.onMeta;
  }

  /** `POST /api/simulation/start`; holds `user_progress_id` for every other method. */
  async start(): Promise<StartResult> {
    const res = await postJson(this.fetchFn, joinUrl(this.baseUrl, "/api/simulation/start"), {
      simulation_id: this.simulationId,
    });
    if (!res.ok) throw new Error(`naibleAdapter: start failed (HTTP ${res.status})`);
    const body = (await res.json()) as Record<string, unknown>;
    const userProgressId = body.user_progress_id;
    if (typeof userProgressId !== "number") {
      throw new Error("naibleAdapter: start response was missing a numeric user_progress_id");
    }
    this.userProgressId = userProgressId;
    return { userProgressId, body };
  }

  /** Tracks which scene subsequent `onSay`/`onSceneWrapUp` calls target — the
   * composing code (App.tsx/lib.ts, out of scope for this task) is expected
   * to call this whenever a meeting encounter mounts/transitions. */
  setCurrentScene(platformSceneId: number | undefined): void {
    this.currentPlatformSceneId = platformSceneId;
  }

  /** The RATIFIED `meetingSay.ts` seam: `MeetingEncounter`'s `onSay` prop. */
  onSay: MeetingChatCallback = (msg) => this.sayStream(msg);

  private async *sayStream(msg: MeetingChatMessage): AsyncGenerator<MeetingChatChunk> {
    if (this.userProgressId === undefined) {
      throw new Error("naibleAdapter: start() must complete before onSay can be used");
    }

    let targetPersonaId: number | undefined;
    let mentionToken: string;
    if (msg.target === "all") {
      mentionToken = "@all";
    } else {
      targetPersonaId = this.actorIdToPersonaId.get(msg.target.actorId);
      if (targetPersonaId === undefined) {
        throw new Error(`naibleAdapter: no platform_persona_id crosswalked for actor "${msg.target.actorId}"`);
      }
      mentionToken = `@${targetPersonaId}`;
    }

    const body: Record<string, unknown> = {
      user_progress_id: this.userProgressId,
      message: `${mentionToken} ${msg.text}`,
    };
    if (this.currentPlatformSceneId !== undefined) body.scene_id = this.currentPlatformSceneId;
    if (targetPersonaId !== undefined) body.target_persona_id = targetPersonaId;

    const res = await postJson(this.fetchFn, joinUrl(this.baseUrl, "/api/simulation/linear-chat-stream"), body);

    let frames: AsyncGenerator<BackendFrame>;
    if (res.status === 202) {
      const result = await resolveQueuedJob(res, this.fetchFn, this.baseUrl, this.pollIntervalMs, this.pollMaxAttempts, this.sleep);
      const rawChunks = Array.isArray(result.chunks)
        ? (result.chunks as unknown[]).filter((c): c is string => typeof c === "string")
        : [];
      frames = framesFromRawChunks(rawChunks);
    } else if (res.ok) {
      if (!res.body) throw new Error("naibleAdapter: linear-chat-stream response had no readable body");
      frames = framesFromStream(res.body);
    } else {
      throw new Error(`naibleAdapter: linear-chat-stream failed (HTTP ${res.status})`);
    }

    yield* toMeetingChatChunks(frames, { target: msg.target, personaIdToActorId: this.personaIdToActorId, onMeta: this.onMeta });
  }

  /** `POST /api/simulation/linear-chat` with `SUBMIT_FOR_GRADING`. */
  async onSceneWrapUp(platformSceneId?: number): Promise<SceneWrapUpResult> {
    if (this.userProgressId === undefined) {
      throw new Error("naibleAdapter: start() must complete before onSceneWrapUp can be used");
    }
    const sceneId = platformSceneId ?? this.currentPlatformSceneId;
    const res = await postJson(this.fetchFn, joinUrl(this.baseUrl, "/api/simulation/linear-chat"), {
      user_progress_id: this.userProgressId,
      message: "SUBMIT_FOR_GRADING",
      ...(sceneId !== undefined ? { scene_id: sceneId } : {}),
    });
    if (!res.ok) throw new Error(`naibleAdapter: SUBMIT_FOR_GRADING failed (HTTP ${res.status})`);
    const responseBody = (await res.json()) as { next_scene_id?: number | null; simulation_complete?: boolean };
    return {
      nextSceneId: responseBody.next_scene_id ?? undefined,
      complete: responseBody.simulation_complete === true,
    };
  }

  /**
   * `GET /api/simulation/grade`. When `decisionReasoning` is given, first
   * `POST /api/simulation/save-message` so the player's rationale for their
   * final decision is on record alongside the AI grade (per the task brief).
   */
  async onFinalGrade(decisionReasoning?: DecisionReasoning): Promise<GradePayload> {
    if (this.userProgressId === undefined) {
      throw new Error("naibleAdapter: start() must complete before onFinalGrade can be used");
    }
    if (decisionReasoning) {
      const saveRes = await postJson(this.fetchFn, joinUrl(this.baseUrl, "/api/simulation/save-message"), {
        user_progress_id: this.userProgressId,
        scene_id: decisionReasoning.platformSceneId,
        sender_name: decisionReasoning.senderName ?? "Student",
        message_content: decisionReasoning.text,
        message_type: "system",
      });
      if (!saveRes.ok) {
        throw new Error(`naibleAdapter: save-message (decision reasoning) failed (HTTP ${saveRes.status})`);
      }
    }

    const res = await getJson(this.fetchFn, joinUrl(this.baseUrl, `/api/simulation/grade?user_progress_id=${this.userProgressId}`));
    let payload: Record<string, unknown>;
    if (res.status === 202) {
      const result = await resolveQueuedJob(res, this.fetchFn, this.baseUrl, this.pollIntervalMs, this.pollMaxAttempts, this.sleep);
      payload = (result.grading as Record<string, unknown> | undefined) ?? {};
    } else if (res.ok) {
      payload = (await res.json()) as Record<string, unknown>;
    } else {
      throw new Error(`naibleAdapter: grade fetch failed (HTTP ${res.status})`);
    }

    return {
      overallScore: Number(payload.overall_score ?? 0),
      overallFeedback: String(payload.overall_feedback ?? ""),
      scenes: Array.isArray(payload.scenes) ? (payload.scenes as unknown[]) : [],
      rubricTotalPoints: Number(payload.rubric_total_points ?? 100),
    };
  }
}

export function createNaibleAdapter(config: NaibleAdapterConfig): NaibleAdapter {
  return new NaibleAdapter(config);
}
