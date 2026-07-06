import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import { minimalWorld } from "./helpers";

function codes(w: unknown): string[] {
  return validateWorld(w).errors.map((e) => e.code);
}

describe("Layer 2 — graph structure", () => {
  it("minimalWorld validates clean", () => {
    expect(validateWorld(minimalWorld()).ok).toBe(true);
    expect(validateWorld(minimalWorld()).warnings).toHaveLength(0);
  });

  it("dead_end_node: a reachable node with no onward decision", () => {
    const w = minimalWorld();
    w.decisions[0].options[1].leads_to = "n3"; // goB -> n3
    w.nodes.push({ id: "n3", title: "Dead", accessible_locations: ["loc1"], present_actors: [], available_facts: [], live_decisions: [] });
    expect(codes(w)).toContain("dead_end_node");
  });

  it("unreachable_node: a node nothing leads to", () => {
    const w = minimalWorld();
    w.nodes.push({ id: "orphan", title: "Orphan", accessible_locations: ["loc1"], present_actors: [], available_facts: [], live_decisions: ["d2"] });
    expect(codes(w)).toContain("unreachable_node");
  });

  it("graph_cyclic: an option loops back to an ancestor", () => {
    const w = minimalWorld();
    w.decisions[1].options[0].leads_to = "n1"; // n2 -> n1, cycle
    expect(codes(w)).toContain("graph_cyclic");
  });
});
