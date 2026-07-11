import { describe, it, expect, vi } from "vitest";
import type { World, Actor } from "@case-quest/schema";
import { consumeMeetingChatStream, type MeetingChatChunk } from "../ui/pixel/meetingSay";
import { createMockChatHost } from "./mockChat";

/** Minimal, schema-shaped actor builder — only the fields `mockChat` reads. */
function makeActor(id: string, overrides: Partial<{
  role: "npc" | "protagonist";
  personality: string;
  communication_style: string;
}> = {}): Actor {
  return {
    id,
    name: id,
    role: overrides.role ?? "npc",
    is_playable: false,
    persona: {
      background: "",
      personality: overrides.personality ?? "Calm and measured.",
      communication_style: overrides.communication_style ?? "Even-toned.",
    },
    goals: [],
    knowledge: [],
  };
}

function makeWorld(actors: Actor[]): World {
  return {
    schema_version: "0.2",
    meta: {
      case_id: "test-case",
      title: "Test Case",
      synopsis: "A test world.",
      protagonist_actor_id: actors[0]?.id ?? "owner",
      start_node_id: "n1",
    },
    learning_objectives: [],
    actors,
    locations: [],
    facts: [],
    decisions: [],
    nodes: [],
    endings: [],
  };
}

async function drain(stream: AsyncIterable<MeetingChatChunk>): Promise<MeetingChatChunk[]> {
  const chunks: MeetingChatChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const ROASTER = makeActor("roaster", {
  personality: "Practical, protective of quality, wary of overpromising.",
  communication_style: "Blunt, concrete, talks in numbers.",
});
const BUYER = makeActor("buyer", {
  personality: "Friendly but firm; she has targets to hit.",
  communication_style: "Polished, persuasive, precise on terms.",
});

describe("createMockChatHost", () => {
  it("streams tokens for the targeted actor, ending with a done chunk", async () => {
    const host = createMockChatHost(makeWorld([ROASTER]), { tokenDelayMs: 0 });
    const chunks = await drain(host({ target: { actorId: "roaster" }, text: "What about pricing?" }));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.actorId === "roaster")).toBe(true);
    expect(chunks.slice(0, -1).every((c) => !c.done)).toBe(true);
    expect(chunks[chunks.length - 1].done).toBe(true);

    const full = chunks.map((c) => c.token ?? "").join("");
    expect(full.trim().length).toBeGreaterThan(0);
  });

  it("integrates with consumeMeetingChatStream to produce a non-empty final reply", async () => {
    const host = createMockChatHost(makeWorld([ROASTER]), { tokenDelayMs: 0 });
    const progress: string[] = [];
    const result = await consumeMeetingChatStream(
      host({ target: { actorId: "roaster" }, text: "Can we hit volume next quarter?" }),
      (partial) => progress.push(partial),
    );
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(result.text);
    expect(result.sceneCompleted).toBe(false);
  });

  it("is fully deterministic: same actor + text yields the identical token sequence every time", async () => {
    const host = createMockChatHost(makeWorld([ROASTER]), { tokenDelayMs: 0 });
    const runOnce = async () => (await drain(
      host({ target: { actorId: "roaster" }, text: "Can we hit volume next quarter?" }),
    )).map((c) => c.token);
    expect(await runOnce()).toEqual(await runOnce());
  });

  it("varies wording by persona: identical said-text, different actors, different replies", async () => {
    const host = createMockChatHost(makeWorld([ROASTER, BUYER]), { tokenDelayMs: 0 });
    const replyFor = async (actorId: string) => (await drain(
      host({ target: { actorId }, text: "What about pricing?" }),
    )).map((c) => c.token ?? "").join("");

    const roasterReply = await replyFor("roaster");
    const buyerReply = await replyFor("buyer");
    expect(roasterReply).not.toBe(buyerReply);
  });

  it("varies wording by said-text for the same actor", async () => {
    const host = createMockChatHost(makeWorld([ROASTER]), { tokenDelayMs: 0 });
    const replyFor = async (text: string) => (await drain(
      host({ target: { actorId: "roaster" }, text }),
    )).map((c) => c.token ?? "").join("");

    expect(await replyFor("What about pricing?")).not.toBe(await replyFor("What about capacity?"));
  });

  it("resolves an 'all' target deterministically to one of the world's NPC actors, never the protagonist", async () => {
    const owner = makeActor("owner", { role: "protagonist" });
    const host = createMockChatHost(makeWorld([owner, ROASTER, BUYER]), { tokenDelayMs: 0 });
    const firstActorIdFor = async () => (await drain(host({ target: "all", text: "Thoughts, everyone?" })))[0].actorId;

    const first = await firstActorIdFor();
    const second = await firstActorIdFor();
    expect(first).toBe(second);
    expect(["roaster", "buyer"]).toContain(first);
  });

  it("rejects a target actorId absent from the world (caller wiring bug), never hanging the stream", async () => {
    const host = createMockChatHost(makeWorld([ROASTER]), { tokenDelayMs: 0 });
    const stream = host({ target: { actorId: "ghost" }, text: "hi" });
    await expect(drain(stream)).rejects.toThrow(/ghost/);
  });

  it("throws for an 'all' target when the world has no actors at all", async () => {
    const host = createMockChatHost(makeWorld([]), { tokenDelayMs: 0 });
    const stream = host({ target: "all", text: "hi" });
    await expect(drain(stream)).rejects.toThrow();
  });

  it("skips the injected scheduler entirely when tokenDelayMs is 0", async () => {
    const scheduler = vi.fn(async () => {});
    const host = createMockChatHost(makeWorld([ROASTER]), { scheduler, tokenDelayMs: 0 });
    const chunks = await drain(host({ target: { actorId: "roaster" }, text: "Ping" }));
    expect(scheduler).not.toHaveBeenCalled();
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("never touches a real timer: an injected scheduler resolving via microtask completes the stream even under fake timers", async () => {
    vi.useFakeTimers();
    try {
      const schedulerCalls: number[] = [];
      const scheduler = vi.fn(async (ms: number) => { schedulerCalls.push(ms); });
      const host = createMockChatHost(makeWorld([ROASTER]), { scheduler, tokenDelayMs: 25 });
      const chunks = await drain(host({ target: { actorId: "roaster" }, text: "Ping" }));
      expect(schedulerCalls.length).toBe(chunks.length);
      expect(schedulerCalls.every((ms) => ms === 25)).toBe(true);
      expect(chunks[chunks.length - 1].done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
