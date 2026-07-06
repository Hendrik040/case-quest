import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import { toyWorld } from "./helpers";

function warnCodes(w: unknown): string[] {
  return validateWorld(w).warnings.map((x) => x.code);
}

describe("Layer 2 — warnings", () => {
  it("the toy world has no warnings", () => {
    expect(validateWorld(toyWorld()).warnings).toHaveLength(0);
  });

  it("objective_unused: an objective no option/ending illuminates", () => {
    const w = toyWorld();
    w.learning_objectives.push({ id: "lo_orphan", text: "unused" });
    expect(warnCodes(w)).toContain("objective_unused");
  });

  it("fact_unused: a fact required by no decision", () => {
    const w = toyWorld();
    w.facts.push({ id: "fact_extra", label: "Extra", content: "trivia", sources: [{ location_id: "back_office" }] });
    expect(warnCodes(w)).toContain("fact_unused");
  });

  it("actor_reveals_nothing: a present actor who can reveal none of the node's facts", () => {
    const w = toyWorld();
    // Add a bystander present in the node but holding no fact available there.
    w.actors.push({ id: "bystander", name: "Bystander", role: "npc", is_playable: false,
      persona: { background: "b", personality: "p", communication_style: "c" }, goals: [], knowledge: [] });
    w.nodes[0].present_actors.push("bystander");
    expect(warnCodes(w)).toContain("actor_reveals_nothing");
  });
});
