import type { World, StoryNode } from "@case-quest/schema";

// Traversal semantics (M5 meeting encounters): route_locations are walkable, in-node
// locations for a scene (streets/paths between the scene's venue and the next one), so a
// route NPC's fact-sourced home can legitimately be a route location, not just an
// accessible_location.
//
// Three-way parity mirror: this "accessible ∪ route" reachable set must match
// `packages/schema/src/validate.ts`'s `checkFactSolvability` (`gatherableAt`, which unions
// `accessible_locations` with `route_locations`) and n-aible
// `backend/modules/world_generation/validation.py` (Phase 4).
export function homeLocationForActor(world: World, node: StoryNode, actorId: string): string {
  const actor = world.actors.find((a) => a.id === actorId);
  const fallback = node.accessible_locations[0];
  if (!actor) return fallback;
  const available = new Set(node.available_facts);
  const accessible = new Set([...node.accessible_locations, ...(node.route_locations ?? [])]);
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

// A node's "venue" is where its scene encounter (meeting/table, market stalls) happens:
// the FIRST venue-typed entry of accessible_locations, in order — the first location
// whose type is an indoor meeting venue (`boardroom`) or one of the outdoor venue types
// (`street`/`shopfront`/`client_site`); undefined if none match. Nothing in the schema
// forces authors to list the venue first, so a lobby/office at index 0 must not silently
// disable grouped seating.
//
// Three-way parity mirror: this venue rule and the grouped-seating behavior it drives
// (see `resolveSeating` below) must be ported to n-aible
// `backend/modules/world_generation/validation.py` (Phase 4) and mirrors the outdoor route
// types enumerated in `packages/schema/src/validate.ts`'s `OUTDOOR_ROUTE_TYPES`.
// Exported (M5 Task 5.2 review, B2 fix) so templates.test.ts can assert every venue-capable
// type has real trigger-zone geometry, without duplicating this list out of sync.
export const VENUE_LOCATION_TYPES = new Set(["boardroom", "street", "shopfront", "client_site"]);

export function venueLocationId(world: World, node: StoryNode): string | undefined {
  for (const lid of node.accessible_locations) {
    const location = world.locations.find((l) => l.id === lid);
    if (location && VENUE_LOCATION_TYPES.has(location.type)) return lid;
  }
  return undefined;
}

/**
 * All of a node's present_actors are seated together at the node's venue (a boardroom
 * table or outdoor stalls), except route NPCs — actors whose home resolves to one of the
 * node's route_locations stay put on the route rather than being swept into the venue.
 * Locations that aren't the node's venue seat no one (grouped seating only applies there;
 * non-venue locations keep the existing per-actor home-location rule in resolvePlacement).
 */
export function resolveSeating(
  world: World,
  node: StoryNode,
  locationId: string,
): { seatedActorIds: string[] } {
  const venue = venueLocationId(world, node);
  if (locationId !== venue) return { seatedActorIds: [] };
  const routeLocations = new Set(node.route_locations ?? []);
  const seatedActorIds = node.present_actors.filter(
    (id) => !routeLocations.has(homeLocationForActor(world, node, id)),
  );
  return { seatedActorIds };
}

/**
 * `walkableIds`, if given, overrides the accessible∪route default used to filter a
 * location's exits down to valid doorTargets. Review fix (M5 Task 5.1 review): the
 * doorTargets computation used to filter exits against `node.accessible_locations`
 * alone, silently dropping any exit into a `route_location` — the same
 * accessible∪route union `homeLocationForActor` already applies (see its doc comment
 * and the three-way parity mirror above) is required here too, or a route-only exit
 * (e.g. a boardroom whose sole exit is a street) renders zero doors and the player can
 * never leave. Callers that need the SESSION's actual (traversal-extended) walkable
 * set — which can reach beyond this single node's own accessible∪route locations,
 * e.g. mid-traversal into the next node's other accessible_locations — pass it
 * explicitly (see `WorldScene.renderLocation`, which passes
 * `GameSession.accessibleLocations()`); this keeps `resolvePlacement` a pure function
 * of its explicit inputs rather than reaching into session/traversal state itself.
 */
export function resolvePlacement(
  world: World,
  node: StoryNode,
  locationId: string,
  walkableIds?: string[],
): { npcIds: string[]; factSpotIds: string[]; doorTargets: string[] } {
  const venue = venueLocationId(world, node);
  const npcIds =
    locationId === venue
      ? resolveSeating(world, node, locationId).seatedActorIds
      : node.present_actors.filter((id) => homeLocationForActor(world, node, id) === locationId);

  const factSpotIds = node.available_facts.filter((factId) => {
    const fact = world.facts.find((f) => f.id === factId);
    return !!fact && fact.sources.some((s) => s.location_id === locationId);
  });

  const location = world.locations.find((l) => l.id === locationId);
  const walkable = new Set(walkableIds ?? [...node.accessible_locations, ...(node.route_locations ?? [])]);
  const doorTargets = (location?.exits ?? []).filter((t) => walkable.has(t) && t !== locationId);

  return { npcIds, factSpotIds, doorTargets };
}
