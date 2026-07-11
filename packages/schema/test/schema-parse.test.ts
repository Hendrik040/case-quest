import { describe, it, expect } from "vitest";
import { WorldSchema, LOCATION_TYPES, SCHEMA_VERSION } from "../src/schema";

const minimal = {
  schema_version: SCHEMA_VERSION,
  meta: { case_id: "c", title: "T", synopsis: "S", protagonist_actor_id: "p", start_node_id: "n1" },
  learning_objectives: [{ id: "lo1", text: "x" }],
  actors: [{ id: "p", name: "P", role: "protagonist", is_playable: true,
    persona: { background: "b", personality: "p", communication_style: "c" }, goals: [], knowledge: [] }],
  locations: [{ id: "loc1", name: "L", type: "office", exits: [] }],
  facts: [],
  decisions: [],
  nodes: [{ id: "n1", title: "N", accessible_locations: ["loc1"], present_actors: [], available_facts: [], live_decisions: [] }],
  endings: [{ id: "e1", title: "E", summary: "s", real_case_comparison: "r", lo_outcomes: [] }],
};

describe("WorldSchema", () => {
  it("accepts a shape-valid minimal world", () => {
    expect(WorldSchema.safeParse(minimal).success).toBe(true);
  });
  it("rejects a wrong schema_version", () => {
    expect(WorldSchema.safeParse({ ...minimal, schema_version: "0.1-nonexistent" }).success).toBe(false);
  });
  it("rejects an unknown location type at the shape layer", () => {
    const bad = structuredClone(minimal);
    bad.locations[0].type = "spaceship";
    expect(WorldSchema.safeParse(bad).success).toBe(false);
  });
  it("exposes the closed LocationType enum", () => {
    expect(LOCATION_TYPES).toContain("factory_floor");
  });
  it("accepts route_locations + platform_scene_id on a node and platform_persona_id on an actor, and round-trips them", () => {
    const withCrosswalk = structuredClone(minimal);
    withCrosswalk.nodes[0] = {
      ...withCrosswalk.nodes[0],
      route_locations: ["loc-street"],
      platform_scene_id: 12,
    };
    withCrosswalk.actors[0] = {
      ...withCrosswalk.actors[0],
      platform_persona_id: 5,
    };
    const result = WorldSchema.safeParse(withCrosswalk);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nodes[0].route_locations).toEqual(["loc-street"]);
      expect(result.data.nodes[0].platform_scene_id).toBe(12);
      expect(result.data.actors[0].platform_persona_id).toBe(5);
    }
  });
});
