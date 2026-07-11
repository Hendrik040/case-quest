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
    w.locations.push({ id: "loc2", name: "Isolated Venue", type: "office", exits: [] });
    w.nodes[0].route_locations = ["loc_street"]; // n1 -> route -> should reach n2's venue, but doesn't
    w.nodes[1].accessible_locations = ["loc2"]; // n2's venue is now unreachable from n1 + loc_street
    expect(codes(w)).toContain("route_unreachable");
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
