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

describe("Layer 2 — fact gatherability (source must be reachable in the node)", () => {
  it("fact_unobtainable: the required fact's only source actor is absent from present_actors", () => {
    // The exact generated-world shape that slipped through: the node lists the
    // fact in available_facts and its live decision requires it, but the fact's
    // only source is an actor who is not in the node's present_actors.
    const w = minimalWorld();
    w.facts[0].sources = [{ actor_id: "guide" }]; // actor-only source
    w.nodes[0].present_actors = []; // guide is not present at n1
    const r = validateWorld(w);
    expect(r.ok).toBe(false);
    const iss = r.errors.find((e) => e.code === "fact_unobtainable")!;
    expect(iss.message).toBe(
      `decision "d1" in node "n1" requires fact "f1", which is listed in the node's available_facts but cannot be gathered there — no source actor is in present_actors and no source location is in accessible_locations.`,
    );
    expect(iss.path).toBe("nodes.n1.live_decisions");
  });

  it("fact_unobtainable: the required fact's only source location is not accessible", () => {
    const w = minimalWorld();
    w.locations.push({ id: "loc2", name: "Vault", type: "office", exits: [] });
    w.facts[0].sources = [{ location_id: "loc2" }]; // location-only source
    // n1's accessible_locations is [loc1]; loc2 is out of reach.
    const r = validateWorld(w);
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("fact_unobtainable");
  });

  it("gatherable via a present source actor alone", () => {
    const w = minimalWorld();
    w.facts[0].sources = [{ actor_id: "guide" }]; // guide is present at n1
    const r = validateWorld(w);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("gatherable via an accessible source location alone", () => {
    const w = minimalWorld();
    w.facts[0].sources = [{ location_id: "loc1" }];
    w.nodes[0].present_actors = []; // no actor needed
    const r = validateWorld(w);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("an unobtainable listing upstream does not count as a provider (fact_unsolvable)", () => {
    const w = minimalWorld();
    w.facts[0].sources = [{ actor_id: "guide" }];
    w.nodes[0].present_actors = []; // n1 lists f1 but cannot provide it
    w.decisions[0].requires_facts = []; // d1 no longer needs f1
    w.decisions[1].requires_facts = ["f1"]; // d2 at n2 needs it, n2 doesn't list it
    const r = validateWorld(w);
    expect(r.ok).toBe(false);
    const iss = r.errors.find((e) => e.code === "fact_unsolvable")!;
    expect(iss.message).toContain(`node "n2"`);
    expect(iss.message).toContain(`"f1"`);
  });

  it("a listed-but-ungatherable fact at the decision's node is fine when gathered on every path", () => {
    const w = minimalWorld();
    w.facts[0].sources = [{ actor_id: "guide" }]; // guide is present at n1 only
    w.decisions[1].requires_facts = ["f1"]; // d2 at n2 needs f1
    w.nodes[1].available_facts = ["f1"]; // n2 lists it but guide is absent there
    // Every path to n2 passes n1, where f1 is gatherable.
    const r = validateWorld(w);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
