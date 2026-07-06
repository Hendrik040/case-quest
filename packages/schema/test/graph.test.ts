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

describe("Layer 2 — fact solvability", () => {
  it("fact_unsolvable: a required fact is only reachable on a later/other branch", () => {
    const w = minimalWorld();
    // Remove f1 from the start node and make it discoverable only at n2 (after d1).
    w.nodes[0].available_facts = [];         // n1 no longer offers f1
    w.nodes[1].available_facts = ["f1"];     // n2 offers f1
    // d1 (live at n1) still requires f1 -> unlockable only with info you can't have yet.
    const r = validateWorld(w);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("fact_unsolvable");
    const iss = r.errors.find((e) => e.code === "fact_unsolvable")!;
    expect(iss.message).toContain("f1");
    expect(iss.message).toContain("n1");
  });

  it("does not flag a fact available at the decision's own node", () => {
    const r = validateWorld(minimalWorld()); // f1 is available at n1 where d1 lives
    expect(r.errors.some((e) => e.code === "fact_unsolvable")).toBe(false);
  });
});
