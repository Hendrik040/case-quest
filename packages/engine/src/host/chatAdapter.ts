import type { World } from "@case-quest/schema";
import type { GameSession } from "../state/session";
import { cannedSayLine, type MeetingChatCallback, type MeetingChatChunk, type MeetingChatMessage, type MeetingSayTarget } from "../ui/pixel/meetingSay";
import type { EncounterChatCallback } from "../App";
import { createMockChatHost } from "./mockChat";

/**
 * Adapts the platform-id-keyed `onEncounterChat` host callback (Task 3.1's
 * `CaseQuestCallbacks`, defined in `App.tsx`) to the actorId-keyed
 * `MeetingChatCallback` that `MeetingEncounter` actually speaks (the Task
 * 2.2 ratified seam — see `ui/pixel/meetingSay.ts`'s doc comment).
 * `MeetingEncounter` never imports schema/session types; this module is the
 * crosswalk's sole home, using `Actor.platform_persona_id` /
 * `StoryNode.platform_scene_id` (both optional fields — see `schema.ts`).
 *
 * When `hostChat` is absent (standalone/dev, no injected callbacks — or the
 * Next embed simply didn't wire one), this returns the local mock chat host
 * directly (Task 3.2's `createMockChatHost`), so meetings feel alive without
 * a network hop.
 *
 * When `hostChat` *is* present, this falls back to the mock **per message**
 * (not for the whole session) whenever the crosswalk can't resolve: a
 * specific-actor target whose actor has no `platform_persona_id` yet (the
 * world hasn't been through Phase 4's pipeline enrichment), or — belt and
 * braces — a host reply chunk whose `personaId` doesn't match any known
 * actor (crosswalk drift). This keeps a partially-crosswalked world usable
 * instead of failing the whole meeting outright.
 */
export function buildMeetingChatHost(session: GameSession, hostChat: EncounterChatCallback | undefined): MeetingChatCallback {
  const world = session.world();
  const mock = createMockChatHost(world);
  if (!hostChat) return mock;

  return async function* adapted(msg: MeetingChatMessage): AsyncGenerator<MeetingChatChunk> {
    const target = resolvePlatformTarget(world, msg.target);
    if (target === null) {
      // Minor fix (final-review-minors.json, chatAdapter.ts:40): a LIVE host chat
      // callback is wired, but this actor has no platform_persona_id crosswalk yet
      // (the world hasn't been through Phase 4's enrichment). Silently degrading to
      // the FULL mock chat host here would render an elaborate, in-character-sounding
      // paraphrase indistinguishable from a real LLM reply — worth a loud warning (so
      // a crosswalk gap doesn't go unnoticed once wired to a live backend) and a
      // plain, obviously-not-fabricated line instead of the mock's more elaborate
      // prose. (`resolvePlatformTarget` only ever returns null for a specific-actor
      // target — "all" always resolves — so `msg.target` here is always `{actorId}`.)
      const actorId = (msg.target as { actorId: string }).actorId;
      const name = world.actors.find((a) => a.id === actorId)?.name ?? actorId;
      console.warn(
        `chatAdapter: actor "${actorId}" has no platform_persona_id crosswalk yet — using a canned line instead of the live host for this message`,
      );
      yield { actorId, token: cannedSayLine(name), done: true };
      return;
    }
    const node = session.currentNode();
    const stream = hostChat({ nodeId: node.id, platformSceneId: node.platform_scene_id, target, text: msg.text });
    for await (const chunk of stream) {
      yield {
        actorId: resolveActorId(world, chunk.personaId, msg.target),
        token: chunk.token,
        done: chunk.done,
        sceneCompleted: chunk.sceneCompleted,
      };
    }
  };
}

function resolvePlatformTarget(world: World, target: MeetingSayTarget): { platformPersonaId: number } | "all" | null {
  if (target === "all") return "all";
  const actor = world.actors.find((a) => a.id === target.actorId);
  if (actor?.platform_persona_id === undefined) return null;
  return { platformPersonaId: actor.platform_persona_id };
}

/**
 * Reverse crosswalk: which actor does this reply chunk's `personaId` belong
 * to? Falls back to the message's own target (the addressed actor, for a
 * specific-actor SAY) or the first NPC in the world (for `"all"`) if the
 * host's `personaId` doesn't match anything known — a wiring drift between
 * the platform and this world's crosswalk shouldn't strand the reply with no
 * bust to attribute it to.
 */
function resolveActorId(world: World, personaId: number, fallbackTarget: MeetingSayTarget): string {
  const byPersona = world.actors.find((a) => a.platform_persona_id === personaId);
  if (byPersona) return byPersona.id;
  if (fallbackTarget !== "all") return fallbackTarget.actorId;
  return world.actors.find((a) => a.role === "npc")?.id ?? world.actors[0].id;
}
