import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import { minimalWorld } from "./helpers";

function codes(w: unknown): string[] {
  return validateWorld(w).errors.map((e) => e.code);
}

describe("Layer 2 — route_locations (traversal reachability)", () => {
  it("route_location_missing: a dangling id in route_locations", () => {
    const w = minimalWorld();
    w.nodes[0].route_locations = ["ghost_loc"];
    expect(codes(w)).toContain("route_location_missing");
  });

  it("a fact sourced only in a route location is still solvable", () => {
    const w = minimalWorld();
    w.locations.push({ id: "loc_route", name: "Street", type: "street", exits: [] });
    w.nodes[0].route_locations = ["loc_route"];
    w.facts[0].sources = [{ location_id: "loc_route" }]; // f1 only obtainable via the route location
    const r = validateWorld(w);
    expect(r.errors.map((e) => e.code)).not.toContain("fact_unobtainable");
    expect(r.errors.map((e) => e.code)).not.toContain("fact_unsolvable");
    expect(r.ok).toBe(true);
  });

  it("route_location_invalid_type: a route location that isn't an outdoor type", () => {
    const w = minimalWorld();
    w.locations.push({ id: "loc_indoor", name: "Back Room", type: "office", exits: [] });
    w.nodes[0].route_locations = ["loc_indoor"];
    expect(codes(w)).toContain("route_location_invalid_type");
  });

  it("accepts each outdoor type as a valid route location", () => {
    for (const type of ["street", "shopfront", "client_site"] as const) {
      const w = minimalWorld();
      w.locations.push({ id: "loc_out", name: "Outside", type, exits: [] });
      w.nodes[0].route_locations = ["loc_out"];
      const r = validateWorld(w);
      expect(r.errors.map((e) => e.code)).not.toContain("route_location_invalid_type");
      expect(r.errors.map((e) => e.code)).not.toContain("route_location_missing");
    }
  });

  it("an empty route_locations array is a no-op", () => {
    const w = minimalWorld();
    w.nodes[0].route_locations = [];
    const r = validateWorld(w);
    expect(r.errors.map((e) => e.code)).not.toContain("route_location_missing");
    expect(r.errors.map((e) => e.code)).not.toContain("route_location_invalid_type");
    expect(r.errors.map((e) => e.code)).not.toContain("route_unreachable");
  });

  it("route_unreachable: route_locations declared but the next node's venue isn't connected via exits", () => {
    const w = minimalWorld();
    w.locations.push({ id: "loc_street", name: "Street", type: "street", exits: [] }); // no exit onward
    // Engine parity: a next node with NO venue-typed accessible_location never actually
    // traverses at all (session.ts's chooseOption immediately teleports instead — see the
    // two new tests below), so this fixture must give n2 a real venue type to still be
    // testing "declared but unreachable" rather than "there was never anything to reach".
    w.locations.push({ id: "loc2", name: "Isolated Venue", type: "boardroom", exits: [] });
    w.nodes[0].route_locations = ["loc_street"]; // n1 -> route -> should reach n2's venue, but doesn't
    w.nodes[1].accessible_locations = ["loc2"]; // n2's venue is now unreachable from n1 + loc_street
    expect(codes(w)).toContain("route_unreachable");
  });

  // Final review (C3): checkRouteLocations's BFS must mirror the engine's ACTUAL walkable
  // set (GameSession.walkableLocationIds() while traversing — accessible∪route for the
  // current node, unioned with the next node's full accessible_locations) — not arbitrary
  // world connectivity. These two reproduce the breaches the pre-fix validator missed.
  it("route_unreachable: a path that exists in the raw location graph but passes through a location outside the engine's walkable set doesn't count (unrestricted-BFS breach)", () => {
    const w = minimalWorld();
    // loc_street (n1's route) -> loc_hidden -> loc_market (n2's venue). loc_hidden is in
    // NEITHER n1's accessible∪route set NOR n2's accessible_locations — GameSession.moveTo
    // would reject stepping there, so this path doesn't exist in play even though the raw
    // location graph connects straight through it.
    w.locations.push({ id: "loc_street", name: "Street", type: "street", exits: ["loc_hidden"] });
    w.locations.push({ id: "loc_hidden", name: "Hidden Alley", type: "office", exits: ["loc_market"] });
    w.locations.push({ id: "loc_market", name: "Market", type: "shopfront", exits: ["loc_hidden"] });
    w.nodes[0].route_locations = ["loc_street"];
    w.nodes[1].accessible_locations = ["loc_market"];
    expect(codes(w)).toContain("route_unreachable");
  });

  it("route_unreachable: reaching a non-venue accessible_location of the next node isn't enough if its actual venue is disconnected (any-of-accessible-locations breach)", () => {
    const w = minimalWorld();
    // loc_yard is reachable and IS one of n2's accessible_locations, but it isn't the
    // venue — loc_boardroom (the first venue-typed accessible_location, per
    // placement.ts's venueLocationId) is exit-disconnected. The old check accepted ANY of
    // nextNode.accessible_locations; the fix requires reaching the specific venue.
    w.locations.push({ id: "loc_street", name: "Street", type: "street", exits: ["loc_yard"] });
    w.locations.push({ id: "loc_yard", name: "Yard", type: "office", exits: [] });
    w.locations.push({ id: "loc_boardroom", name: "Boardroom", type: "boardroom", exits: [] });
    w.nodes[0].route_locations = ["loc_street"];
    w.nodes[1].accessible_locations = ["loc_yard", "loc_boardroom"];
    expect(codes(w)).toContain("route_unreachable");
  });

  it("no route_unreachable for a next node with no venue-typed accessible_location at all (engine teleports immediately, no walking required)", () => {
    const w = minimalWorld();
    // n2 keeps its default accessible_locations (["loc1"], type "office" — no venue type).
    // GameSession.chooseOption's own venueLocationId check means this case never creates a
    // walking traversal in the first place (immediate teleport, per the "Fallback rule" in
    // session.ts) — so unreachability here is not a real soft-lock and must not be flagged.
    w.locations.push({ id: "loc_street", name: "Street", type: "street", exits: [] });
    w.nodes[0].route_locations = ["loc_street"];
    const r = validateWorld(w);
    expect(r.errors.map((e) => e.code)).not.toContain("route_unreachable");
  });

  it("no route_unreachable when the next venue is reachable only through a route location's exits", () => {
    const w = minimalWorld();
    // n1's venue is loc1 (office). n2's venue is loc_market — NOT in n1's accessible set.
    // The only way there is on foot: route loc_street -> exit -> loc_market. This proves
    // both that route_locations seed the BFS and that their exits are followed.
    w.locations.push({ id: "loc_street", name: "Street", type: "street", exits: ["loc_market"] });
    w.locations.push({ id: "loc_market", name: "Market", type: "shopfront", exits: ["loc_street"] });
    w.nodes[0].route_locations = ["loc_street"];
    w.nodes[1].accessible_locations = ["loc_market"];
    const r = validateWorld(w);
    expect(r.errors.map((e) => e.code)).not.toContain("route_unreachable");
  });

  it("route_unreachable when the route location's exit chain to the next venue is broken", () => {
    const w = minimalWorld();
    // Same layout, but loc_street's exit onward is severed.
    w.locations.push({ id: "loc_street", name: "Street", type: "street", exits: [] });
    w.locations.push({ id: "loc_market", name: "Market", type: "shopfront", exits: ["loc_street"] });
    w.nodes[0].route_locations = ["loc_street"];
    w.nodes[1].accessible_locations = ["loc_market"];
    expect(codes(w)).toContain("route_unreachable");
  });
});
