import { describe, it, expect, vi } from "vitest";
import type { Actor, StoryNode, World } from "@case-quest/schema";
import { GameSession } from "../state/session";
import type { MeetingChatChunk } from "../ui/pixel/meetingSay";
import type { EncounterChatCallback, EncounterChatChunk, EncounterChatMessage } from "../App";
import { buildMeetingChatHost } from "./chatAdapter";

/** Minimal, schema-shaped actor builder — mirrors host/mockChat.test.ts's helper. */
function makeActor(id: string, overrides: Partial<{ platform_persona_id: number }> = {}): Actor {
  return {
    id,
    name: id,
    role: "npc",
    is_playable: false,
    persona: { background: "", personality: "Calm.", communication_style: "Even-toned." },
    goals: [],
    knowledge: [],
    platform_persona_id: overrides.platform_persona_id,
  };
}

function makeWorld(actors: Actor[], nodeOverrides: Partial<StoryNode> = {}): World {
  return {
    schema_version: "0.2",
    meta: {
      case_id: "test-case", title: "Test Case", synopsis: "A test world.",
      protagonist_actor_id: "player", start_node_id: "n1",
    },
    learning_objectives: [],
    actors,
    locations: [{ id: "loc1", name: "Loc 1", type: "boardroom", exits: [] }],
    facts: [],
    decisions: [],
    nodes: [{
      id: "n1", title: "Node 1", accessible_locations: ["loc1"],
      present_actors: actors.map((a) => a.id), available_facts: [], live_decisions: [],
      ...nodeOverrides,
    }],
    endings: [],
  };
}

async function drain(stream: AsyncIterable<MeetingChatChunk>): Promise<MeetingChatChunk[]> {
  const chunks: MeetingChatChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const ROASTER = makeActor("roaster", { platform_persona_id: 101 });
const BUYER = makeActor("buyer"); // no crosswalk id yet — Phase 4 not run for this actor

describe("buildMeetingChatHost", () => {
  it("returns the mock chat host directly when no host callback is injected", async () => {
    const session = new GameSession(makeWorld([ROASTER]));
    const say = buildMeetingChatHost(session, undefined);
    const chunks = await drain(say({ target: { actorId: "roaster" }, text: "hi" }));
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.actorId === "roaster")).toBe(true);
  });

  it("translates an actorId target to platformPersonaId and calls the host with nodeId/platformSceneId", async () => {
    const session = new GameSession(makeWorld([ROASTER], { platform_scene_id: 42 }));
    const hostChat = vi.fn<EncounterChatCallback>(async function* (): AsyncGenerator<EncounterChatChunk> {
      yield { personaId: 101, token: "Sure" };
      yield { personaId: 101, token: ", let's talk.", done: true, turnCount: 1 };
    });
    const say = buildMeetingChatHost(session, hostChat);
    const chunks = await drain(say({ target: { actorId: "roaster" }, text: "What about pricing?" }));

    expect(hostChat).toHaveBeenCalledWith({
      nodeId: "n1",
      platformSceneId: 42,
      target: { platformPersonaId: 101 },
      text: "What about pricing?",
    } satisfies EncounterChatMessage);
    expect(chunks).toEqual([
      { actorId: "roaster", token: "Sure" },
      { actorId: "roaster", token: ", let's talk.", done: true },
    ]);
  });

  it("passes an 'all' target through untranslated", async () => {
    const session = new GameSession(makeWorld([ROASTER]));
    const hostChat = vi.fn<EncounterChatCallback>(async function* (): AsyncGenerator<EncounterChatChunk> {
      yield { personaId: 101, token: "We all agree.", done: true };
    });
    const say = buildMeetingChatHost(session, hostChat);
    await drain(say({ target: "all", text: "Thoughts, everyone?" }));

    expect(hostChat).toHaveBeenCalledWith(expect.objectContaining({ target: "all" }));
  });

  it("maps a reply chunk's personaId back to the actor that owns it, even for an 'all' target", async () => {
    const session = new GameSession(makeWorld([ROASTER, makeActor("owner", { platform_persona_id: 7 })]));
    const hostChat = vi.fn<EncounterChatCallback>(async function* (): AsyncGenerator<EncounterChatChunk> {
      yield { personaId: 7, token: "Speaking for the room.", done: true };
    });
    const say = buildMeetingChatHost(session, hostChat);
    const chunks = await drain(say({ target: "all", text: "hi" }));
    expect(chunks[0].actorId).toBe("owner");
  });

  // Minor fix (final-review-minors.json, chatAdapter.ts:40): a live host IS wired, but
  // this actor has no platform_persona_id crosswalk yet — warn loudly (so the gap
  // doesn't go unnoticed once wired to a live backend) and use a plain, obviously-
  // not-fabricated canned line rather than the mock's elaborate in-character prose,
  // which could be mistaken for a real LLM reply.
  it("falls back to a canned line (not the elaborate mock host) for a specific-actor target with no platform_persona_id crosswalk yet, without calling the live host at all, and warns", async () => {
    const session = new GameSession(makeWorld([BUYER]));
    const hostChat = vi.fn<EncounterChatCallback>();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const say = buildMeetingChatHost(session, hostChat);
    const chunks = await drain(say({ target: { actorId: "buyer" }, text: "hi" }));

    expect(hostChat).not.toHaveBeenCalled();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.actorId === "buyer")).toBe(true);
    expect(chunks[chunks.length - 1].done).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("buyer");
    warnSpy.mockRestore();
  });

  it("falls back to the target actor id when a reply chunk's personaId matches no known actor (crosswalk drift)", async () => {
    const session = new GameSession(makeWorld([ROASTER]));
    const hostChat = vi.fn<EncounterChatCallback>(async function* (): AsyncGenerator<EncounterChatChunk> {
      yield { personaId: 999, token: "???", done: true };
    });
    const say = buildMeetingChatHost(session, hostChat);
    const chunks = await drain(say({ target: { actorId: "roaster" }, text: "hi" }));
    expect(chunks[0].actorId).toBe("roaster");
  });
});
