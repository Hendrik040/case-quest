import { describe, it, expect } from "vitest";
import { WorldSchema, LOCATION_TYPES } from "../src/schema";

const minimal = {
  schema_version: "0.1",
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
    expect(WorldSchema.safeParse({ ...minimal, schema_version: "0.2" }).success).toBe(false);
  });
  it("rejects an unknown location type at the shape layer", () => {
    const bad = structuredClone(minimal);
    bad.locations[0].type = "spaceship";
    expect(WorldSchema.safeParse(bad).success).toBe(false);
  });
  it("exposes the closed LocationType enum", () => {
    expect(LOCATION_TYPES).toContain("factory_floor");
  });
});
