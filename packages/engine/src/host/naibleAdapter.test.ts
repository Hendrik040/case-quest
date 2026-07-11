import { describe, it, expect, vi } from "vitest";
import type { World } from "@case-quest/schema";
import {
  buildActorPersonaMap,
  createNaibleAdapter,
  ORCHESTRATOR_ACTOR_ID,
  type FetchLike,
  type FetchLikeResponse,
  type NaibleAdapterConfig,
  type NaibleAdapter,
} from "./naibleAdapter";
import type { MeetingChatChunk } from "../ui/pixel/meetingSay";
import {
  SINGLE_MENTION_SSE,
  ALL_MENTION_SSE,
  HELP_COMMAND_SSE,
  UNRECOGNIZED_PERSONA_SSE,
  MALFORMED_LINE_SSE,
  ERROR_SSE,
} from "./fixtures/sseFrames";
import {
  QUEUED_202_RESPONSE,
  JOB_STATUS_PROCESSING,
  JOB_STATUS_COMPLETED,
  JOB_STATUS_FAILED,
  JOB_RESULT_CHAT,
  JOB_RESULT_GRADING,
  JOB_RESULT_MALFORMED,
  SUBMIT_FOR_GRADING_SIMULATION_COMPLETE,
  SUBMIT_FOR_GRADING_NEXT_SCENE,
  GRADE_PAYLOAD,
  SAVE_MESSAGE_RESPONSE,
  START_SIMULATION_RESPONSE,
} from "./fixtures/jsonResponses";

// ---- test helpers -----------------------------------------------------

function jsonResponse(status: number, body: unknown): FetchLikeResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  };
}

/** Builds a `ReadableStream<Uint8Array>` from a raw SSE string, splitting it
 * into small chunks (deliberately not aligned to `\n\n` boundaries) so the
 * adapter's buffering has to reassemble frames split mid-JSON-object, same
 * as a real TCP stream would deliver them. */
function sseResponse(raw: string, chunkSize = 17): FetchLikeResponse {
  const bytes = new TextEncoder().encode(raw);
  const streamBody = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
  return { status: 200, ok: true, json: async () => ({}), text: async () => raw, body: streamBody };
}

async function drain(stream: AsyncIterable<MeetingChatChunk>): Promise<MeetingChatChunk[]> {
  const out: MeetingChatChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

const world: World = {
  schema_version: "0.2",
  meta: {
    case_id: "case-1",
    title: "The Wholesale Offer",
    synopsis: "s",
    protagonist_actor_id: "owner",
    start_node_id: "node_1",
  },
  learning_objectives: [],
  actors: [
    { id: "nick", name: "Nick Elliott", role: "npc", is_playable: false, persona: { background: "", personality: "", communication_style: "" }, goals: [], knowledge: [], platform_persona_id: 501 },
    { id: "priya", name: "Priya Shah", role: "npc", is_playable: false, persona: { background: "", personality: "", communication_style: "" }, goals: [], knowledge: [], platform_persona_id: 502 },
    { id: "owner", name: "Owner", role: "protagonist", is_playable: true, persona: { background: "", personality: "", communication_style: "" }, goals: [], knowledge: [] },
  ],
  locations: [],
  facts: [],
  decisions: [],
  nodes: [],
  endings: [],
};

function noSleep(): (ms: number) => Promise<void> {
  return () => Promise.resolve();
}

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

/**
 * Builds an adapter and drives it through a real `start()` (rather than
 * poking private state), so every test exercises the actual method, then
 * hands back only the calls made AFTER `start()` — the ones each test cares
 * about asserting on.
 */
async function startedAdapter(
  handleOther: (url: string, init?: RequestInit) => FetchLikeResponse | Promise<FetchLikeResponse>,
  configOverrides: Partial<NaibleAdapterConfig> = {},
): Promise<{ adapter: NaibleAdapter; calls: RecordedCall[] }> {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = vi.fn(async (url, init) => {
    if (url.endsWith("/api/simulation/start")) return jsonResponse(200, START_SIMULATION_RESPONSE);
    calls.push({ url, init });
    return handleOther(url, init);
  });
  const adapter = createNaibleAdapter({
    baseUrl: "",
    fetch,
    simulationId: 9,
    actorPersonaMap: buildActorPersonaMap(world),
    ...configOverrides,
  });
  await adapter.start();
  return { adapter, calls };
}

function bodyOf(call: RecordedCall | undefined): Record<string, unknown> {
  return JSON.parse((call?.init?.body as string) ?? "{}");
}

// ---- buildActorPersonaMap ----------------------------------------------

describe("buildActorPersonaMap", () => {
  it("maps actorId<->platform_persona_id both ways, skipping actors without one", () => {
    const map = buildActorPersonaMap(world);
    expect(map.actorIdToPersonaId.get("nick")).toBe(501);
    expect(map.actorIdToPersonaId.get("priya")).toBe(502);
    expect(map.actorIdToPersonaId.has("owner")).toBe(false);
    expect(map.personaIdToActorId.get(501)).toBe("nick");
    expect(map.personaIdToActorId.get(502)).toBe("priya");
  });

  it("throws on a crosswalk that claims the same platform_persona_id twice", () => {
    const dup: World = { ...world, actors: [...world.actors, { ...world.actors[0], id: "nick2" }] };
    expect(() => buildActorPersonaMap(dup)).toThrow(/501/);
  });
});

// ---- onSay: single @mention --------------------------------------------

describe("NaibleAdapter.onSay — single-target reply", () => {
  it("streams tokens, resolves actorId via persona_id, and marks the one done frame", async () => {
    const { adapter, calls } = await startedAdapter(() => sseResponse(SINGLE_MENTION_SSE));

    const chunks = await drain(adapter.onSay({ target: { actorId: "nick" }, text: "How's pricing?" }));

    expect(chunks.filter((c) => c.token).map((c) => c.token).join("")).toBe("Margins are tight this quarter.");
    expect(chunks.every((c) => c.actorId === "nick")).toBe(true);
    expect(chunks.filter((c) => c.done).length).toBe(1);
    expect(chunks.at(-1)?.done).toBe(true);

    const sentBody = bodyOf(calls[0]);
    expect(sentBody.message).toBe("@501 How's pricing?");
    expect(sentBody.target_persona_id).toBe(501);
    expect(sentBody.user_progress_id).toBe(777);
  });

  it("throws (without ever calling linear-chat-stream) when the target actor has no crosswalk entry", async () => {
    const { adapter, calls } = await startedAdapter(() => {
      throw new Error("should not be reached");
    });

    await expect(drain(adapter.onSay({ target: { actorId: "owner" }, text: "hi" }))).rejects.toThrow(/owner/);
    expect(calls.length).toBe(0);
  });

  it("throws when start() has not been called yet", async () => {
    const fetch: FetchLike = vi.fn();
    const adapter = createNaibleAdapter({ baseUrl: "", fetch, simulationId: 9, actorPersonaMap: buildActorPersonaMap(world) });
    await expect(drain(adapter.onSay({ target: { actorId: "nick" }, text: "hi" }))).rejects.toThrow(/start/i);
  });
});

// ---- onSay: @all, multi-persona interleaving ---------------------------

describe("NaibleAdapter.onSay — @all target (multi-persona)", () => {
  it("only marks the LAST persona segment's frame as done, so both personas' tokens survive a consumeMeetingChatStream-style break-on-done loop", async () => {
    const { adapter, calls } = await startedAdapter(() => sseResponse(ALL_MENTION_SSE));

    const chunks = await drain(adapter.onSay({ target: "all", text: "Thoughts?" }));

    const doneIdx = chunks.findIndex((c) => c.done);
    expect(doneIdx).toBe(chunks.length - 1); // done is only ever the last chunk
    const actorIds = [...new Set(chunks.map((c) => c.actorId))];
    expect(actorIds.sort()).toEqual(["nick", "priya"]);

    // Simulate the UI's actual consumer, which stops at the first done:true.
    let seenTokens = "";
    for (const c of chunks) {
      if (c.token) seenTokens += c.token;
      if (c.done) break;
    }
    expect(seenTokens).toBe("Sure, let's look at costs.Sales can absorb it.");

    expect(bodyOf(calls[0]).message).toBe("@all Thoughts?");
  });
});

// ---- turnCount / sceneCompleted / nextSceneId meta ---------------------

describe("NaibleAdapter.onSay — meta flags", () => {
  it("forwards sceneCompleted on the chunk that carries it and reports turnCount/nextSceneId via onMeta", async () => {
    const sceneCompletedSse = SINGLE_MENTION_SSE.replace('"scene_completed":false', '"scene_completed":true').replace(
      '"next_scene_id":null',
      '"next_scene_id":13',
    );
    const onMeta = vi.fn();
    const { adapter } = await startedAdapter(() => sseResponse(sceneCompletedSse), { onMeta });

    const chunks = await drain(adapter.onSay({ target: { actorId: "nick" }, text: "wrap it up" }));
    expect(chunks.some((c) => c.sceneCompleted)).toBe(true);
    expect(onMeta).toHaveBeenCalledWith({ turnCount: 4, nextSceneId: 13 });
  });

  it("help-command and unrecognized-persona replies (persona_id: null) fall back to the addressed actorId for a single target, and to a sentinel for @all", async () => {
    const { adapter: adapterSingle } = await startedAdapter(() => sseResponse(HELP_COMMAND_SSE));
    const singleChunks = await drain(adapterSingle.onSay({ target: { actorId: "nick" }, text: "help" }));
    expect(singleChunks.every((c) => c.actorId === "nick")).toBe(true);

    const { adapter: adapterAll } = await startedAdapter(() => sseResponse(UNRECOGNIZED_PERSONA_SSE));
    const allChunks = await drain(adapterAll.onSay({ target: "all", text: "@bogus hi" }));
    expect(allChunks.every((c) => c.actorId === ORCHESTRATOR_ACTOR_ID)).toBe(true);
  });
});

// ---- malformed lines + stream errors -----------------------------------

describe("NaibleAdapter.onSay — malformed lines and stream errors", () => {
  it("skips a malformed SSE line (bad JSON) and an SSE comment line without crashing", async () => {
    const { adapter } = await startedAdapter(() => sseResponse(MALFORMED_LINE_SSE));

    const chunks = await drain(adapter.onSay({ target: { actorId: "nick" }, text: "hi" }));
    expect(chunks.filter((c) => c.token).map((c) => c.token).join("")).toBe("Margins are tight.");
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it("throws through when the backend yields an {error} frame", async () => {
    const { adapter } = await startedAdapter(() => sseResponse(ERROR_SSE));

    await expect(drain(adapter.onSay({ target: { actorId: "nick" }, text: "hi" }))).rejects.toThrow(/timed out/);
  });

  it("releases the ReadableStream reader when the consumer aborts on an {error} frame that is not the stream's final SSE event", async () => {
    // ERROR_SSE/CAPACITY_ERROR_SSE are each a *single* frame, and because
    // withIsLast's one-item lookahead must fetch the NEXT item from the
    // source generator before it can tell the consumer "this one was last",
    // a single-frame stream's source generator is always already fully
    // drained (and its reader-releasing `finally` already run) by the time
    // the consumer ever sees that one frame and throws on it — so those two
    // fixtures alone can't actually exercise the leak. This fixture puts a
    // frame *after* the error frame (never sent by a real backend per
    // chat_handler.py:1048's "error is always the last frame" — but nothing
    // in this module enforces that) so `withIsLast`'s wrapped source is
    // still genuinely suspended mid-stream when `toMeetingChatChunks`
    // throws, reproducing the actual generator-composition teardown gap.
    const rawSse =
      `data: ${JSON.stringify({ content: "partial", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n` +
      `data: ${JSON.stringify({ error: "OpenAI request timed out" })}\n\n` +
      `data: ${JSON.stringify({ content: "never reached", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n`;
    const bytes = new TextEncoder().encode(rawSse);
    const streamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17));
        controller.close();
      },
    });
    const { adapter } = await startedAdapter(() => ({
      status: 200,
      ok: true,
      json: async () => ({}),
      text: async () => rawSse,
      body: streamBody,
    }));

    await expect(drain(adapter.onSay({ target: { actorId: "nick" }, text: "hi" }))).rejects.toThrow(/timed out/);

    expect(streamBody.locked).toBe(false);
  });
});

// ---- 202 + job_id poll fallback -----------------------------------------

describe("NaibleAdapter.onSay — 202 queue fallback", () => {
  it("polls job status until completed, then replays the queued chunks identically to a direct stream", async () => {
    let statusCalls = 0;
    const { adapter, calls } = await startedAdapter(
      (url) => {
        if (url.endsWith("/api/simulation/linear-chat-stream")) return jsonResponse(202, QUEUED_202_RESPONSE);
        if (url.includes("/status")) {
          statusCalls += 1;
          return jsonResponse(200, statusCalls === 1 ? JOB_STATUS_PROCESSING : JOB_STATUS_COMPLETED);
        }
        if (url.includes("/result")) return jsonResponse(200, JOB_RESULT_CHAT);
        throw new Error(`unexpected url in test: ${url}`);
      },
      { sleep: noSleep() },
    );

    const chunks = await drain(adapter.onSay({ target: { actorId: "nick" }, text: "How's pricing?" }));
    expect(chunks.filter((c) => c.token).map((c) => c.token).join("")).toBe("Margins are tight this quarter.");
    expect(chunks.at(-1)?.done).toBe(true);
    expect(calls.filter((c) => c.url.includes("/status")).length).toBe(2);
    expect(calls.some((c) => c.url.includes(QUEUED_202_RESPONSE.job_id))).toBe(true);
  });

  it("throws when the queued job status comes back failed", async () => {
    const { adapter } = await startedAdapter(
      (url) => {
        if (url.endsWith("/api/simulation/linear-chat-stream")) return jsonResponse(202, QUEUED_202_RESPONSE);
        if (url.includes("/status")) return jsonResponse(200, JOB_STATUS_FAILED);
        throw new Error(`unexpected url in test: ${url}`);
      },
      { sleep: noSleep() },
    );

    await expect(drain(adapter.onSay({ target: { actorId: "nick" }, text: "hi" }))).rejects.toThrow(/failed/i);
  });

  it("throws (rather than silently yielding zero chunks) when the completed job's stored result has no chunks array", async () => {
    const { adapter } = await startedAdapter(
      (url) => {
        if (url.endsWith("/api/simulation/linear-chat-stream")) return jsonResponse(202, QUEUED_202_RESPONSE);
        if (url.includes("/status")) return jsonResponse(200, JOB_STATUS_COMPLETED);
        if (url.includes("/result")) return jsonResponse(200, JOB_RESULT_MALFORMED);
        throw new Error(`unexpected url in test: ${url}`);
      },
      { sleep: noSleep() },
    );

    await expect(drain(adapter.onSay({ target: { actorId: "nick" }, text: "hi" }))).rejects.toThrow(/chunks/);
  });
});

// ---- start / onSceneWrapUp / onFinalGrade -------------------------------

describe("NaibleAdapter.start", () => {
  it("POSTs simulation_id and holds user_progress_id for later calls", async () => {
    const fetch: FetchLike = vi.fn(async () => jsonResponse(200, START_SIMULATION_RESPONSE));
    const adapter = createNaibleAdapter({ baseUrl: "", fetch, simulationId: 9, actorPersonaMap: buildActorPersonaMap(world) });

    const result = await adapter.start();
    expect(result.userProgressId).toBe(777);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/simulation/start");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ simulation_id: 9 });
  });

  it("throws on a non-2xx response", async () => {
    const fetch: FetchLike = vi.fn(async () => jsonResponse(500, { detail: "boom" }));
    const adapter = createNaibleAdapter({ baseUrl: "", fetch, simulationId: 9, actorPersonaMap: buildActorPersonaMap(world) });
    await expect(adapter.start()).rejects.toThrow(/500/);
  });
});

describe("NaibleAdapter.onSceneWrapUp", () => {
  it("maps a next-scene transition to {nextSceneId, complete: false}", async () => {
    const { adapter, calls } = await startedAdapter(() => jsonResponse(200, SUBMIT_FOR_GRADING_NEXT_SCENE));

    const result = await adapter.onSceneWrapUp(12);
    expect(result).toEqual({ nextSceneId: 13, complete: false });
    expect(bodyOf(calls[0])).toEqual({ user_progress_id: 777, message: "SUBMIT_FOR_GRADING", scene_id: 12 });
  });

  it("maps the final-scene transition to {nextSceneId: undefined, complete: true}", async () => {
    const { adapter } = await startedAdapter(() => jsonResponse(200, SUBMIT_FOR_GRADING_SIMULATION_COMPLETE));

    const result = await adapter.onSceneWrapUp(12);
    expect(result).toEqual({ nextSceneId: undefined, complete: true });
  });

  it("throws when start() has not been called yet", async () => {
    const fetch: FetchLike = vi.fn();
    const adapter = createNaibleAdapter({ baseUrl: "", fetch, simulationId: 9, actorPersonaMap: buildActorPersonaMap(world) });
    await expect(adapter.onSceneWrapUp(12)).rejects.toThrow(/start/i);
  });
});

// ---- scene-id state tracking: setCurrentScene / onSceneWrapUp fallback --
//
// `setCurrentScene` is the load-bearing state channel the module doc comment
// describes ("composing code ... is expected to call this whenever a meeting
// encounter mounts/transitions"). Nothing above exercises it: no test calls
// `setCurrentScene`, and every `onSceneWrapUp` call above passes an explicit
// scene id. These tests close that gap.

describe("NaibleAdapter — scene-id state tracking (setCurrentScene / onSceneWrapUp fallback)", () => {
  it("setCurrentScene(id) makes subsequent onSay requests carry that scene_id (and none carry it before setCurrentScene is called)", async () => {
    const { adapter, calls } = await startedAdapter(() => sseResponse(SINGLE_MENTION_SSE));

    await drain(adapter.onSay({ target: { actorId: "nick" }, text: "first" }));
    expect(bodyOf(calls[0])).not.toHaveProperty("scene_id");

    adapter.setCurrentScene(12);
    await drain(adapter.onSay({ target: { actorId: "nick" }, text: "second" }));
    expect(bodyOf(calls[1]).scene_id).toBe(12);
  });

  it("onSceneWrapUp() falls back to the scene set via setCurrentScene when no explicit sceneId is given", async () => {
    const { adapter, calls } = await startedAdapter(() => jsonResponse(200, SUBMIT_FOR_GRADING_NEXT_SCENE));
    adapter.setCurrentScene(12);

    const result = await adapter.onSceneWrapUp();
    expect(result).toEqual({ nextSceneId: 13, complete: false });
    expect(bodyOf(calls[0])).toEqual({ user_progress_id: 777, message: "SUBMIT_FOR_GRADING", scene_id: 12 });
  });

  it("onSceneWrapUp(explicitId) overrides the current-scene state, even when explicitId is falsy (0) — guards against a `??`-to-`||` regression", async () => {
    const { adapter, calls } = await startedAdapter(() => jsonResponse(200, SUBMIT_FOR_GRADING_NEXT_SCENE));
    adapter.setCurrentScene(12);

    await adapter.onSceneWrapUp(0);
    expect(bodyOf(calls[0])).toEqual({ user_progress_id: 777, message: "SUBMIT_FOR_GRADING", scene_id: 0 });
  });

  it("omits scene_id entirely from onSceneWrapUp's request when neither an explicit sceneId nor setCurrentScene has ever been provided", async () => {
    const { adapter, calls } = await startedAdapter(() => jsonResponse(200, SUBMIT_FOR_GRADING_NEXT_SCENE));

    await adapter.onSceneWrapUp();
    expect(bodyOf(calls[0])).toEqual({ user_progress_id: 777, message: "SUBMIT_FOR_GRADING" });
  });
});

describe("NaibleAdapter.onFinalGrade", () => {
  it("GETs /grade directly and maps the payload to camelCase GradePayload", async () => {
    const { adapter, calls } = await startedAdapter(() => jsonResponse(200, GRADE_PAYLOAD));

    const grade = await adapter.onFinalGrade();
    expect(grade).toEqual({
      overallScore: 82,
      overallFeedback: GRADE_PAYLOAD.overall_feedback,
      scenes: GRADE_PAYLOAD.scenes,
      rubricTotalPoints: 100,
    });
    expect(calls[0].url).toBe("/api/simulation/grade?user_progress_id=777");
  });

  it("posts decision reasoning via save-message before fetching the grade", async () => {
    const { adapter, calls } = await startedAdapter((url) => {
      if (url.endsWith("/api/simulation/save-message")) return jsonResponse(200, SAVE_MESSAGE_RESPONSE);
      if (url.startsWith("/api/simulation/grade")) return jsonResponse(200, GRADE_PAYLOAD);
      throw new Error(`unexpected url: ${url}`);
    });

    await adapter.onFinalGrade({ platformSceneId: 13, text: "Chose to hold the price line." });
    expect(calls[0].url).toBe("/api/simulation/save-message");
    expect(calls[1].url).toMatch(/^\/api\/simulation\/grade/);
    expect(bodyOf(calls[0])).toEqual({
      user_progress_id: 777,
      scene_id: 13,
      sender_name: "Student",
      message_content: "Chose to hold the price line.",
      message_type: "system",
    });
  });

  it("follows the 202+job_id poll fallback for a queued grading job", async () => {
    const { adapter } = await startedAdapter(
      (url) => {
        if (url.startsWith("/api/simulation/grade")) return jsonResponse(202, QUEUED_202_RESPONSE);
        if (url.includes("/status")) return jsonResponse(200, JOB_STATUS_COMPLETED);
        if (url.includes("/result")) return jsonResponse(200, JOB_RESULT_GRADING);
        throw new Error(`unexpected url: ${url}`);
      },
      { sleep: noSleep() },
    );

    const grade = await adapter.onFinalGrade();
    expect(grade.overallScore).toBe(78);
    expect(grade.overallFeedback).toBe(JOB_RESULT_GRADING.grading.overall_feedback);
  });

  it("throws (rather than fabricating a zero grade) when the completed job's stored result has no grading object", async () => {
    const { adapter } = await startedAdapter(
      (url) => {
        if (url.startsWith("/api/simulation/grade")) return jsonResponse(202, QUEUED_202_RESPONSE);
        if (url.includes("/status")) return jsonResponse(200, JOB_STATUS_COMPLETED);
        if (url.includes("/result")) return jsonResponse(200, JOB_RESULT_MALFORMED);
        throw new Error(`unexpected url: ${url}`);
      },
      { sleep: noSleep() },
    );

    await expect(adapter.onFinalGrade()).rejects.toThrow(/grading/);
  });

  it("throws when start() has not been called yet", async () => {
    const fetch: FetchLike = vi.fn();
    const adapter = createNaibleAdapter({ baseUrl: "", fetch, simulationId: 9, actorPersonaMap: buildActorPersonaMap(world) });
    await expect(adapter.onFinalGrade()).rejects.toThrow(/start/i);
  });
});
