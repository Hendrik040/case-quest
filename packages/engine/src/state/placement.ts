import type { World, StoryNode } from "@case-quest/schema";

export function homeLocationForActor(world: World, node: StoryNode, actorId: string): string {
  const actor = world.actors.find((a) => a.id === actorId);
  const fallback = node.accessible_locations[0];
  if (!actor) return fallback;
  const available = new Set(node.available_facts);
  const accessible = new Set(node.accessible_locations);
  for (const factId of actor.knowledge) {
    if (!available.has(factId)) continue;
    const fact = world.facts.find((f) => f.id === factId);
    if (!fact) continue;
    for (const src of fact.sources) {
      if (src.location_id && accessible.has(src.location_id)) return src.location_id;
    }
  }
  return fallback;
}

export function resolvePlacement(
  world: World,
  node: StoryNode,
  locationId: string,
): { npcIds: string[]; factSpotIds: string[]; doorTargets: string[] } {
  const npcIds = node.present_actors.filter((id) => homeLocationForActor(world, node, id) === locationId);

  const factSpotIds = node.available_facts.filter((factId) => {
    const fact = world.facts.find((f) => f.id === factId);
    return !!fact && fact.sources.some((s) => s.location_id === locationId);
  });

  const location = world.locations.find((l) => l.id === locationId);
  const accessible = new Set(node.accessible_locations);
  const doorTargets = (location?.exits ?? []).filter((t) => accessible.has(t) && t !== locationId);

  return { npcIds, factSpotIds, doorTargets };
}
