import toyJson from "../fixtures/wholesale-offer.world.json";
import type { World } from "../src/types";

export function toyWorld(): World {
  return structuredClone(toyJson) as unknown as World;
}

export function clone<T>(x: T): T {
  return structuredClone(x);
}

// A tiny valid 2-node branching world used for graph/solvability tests.
export function minimalWorld(): World {
  return {
    schema_version: "0.2",
    meta: { case_id: "min", title: "Min", synopsis: "s", protagonist_actor_id: "owner", start_node_id: "n1" },
    learning_objectives: [{ id: "lo1", text: "objective" }],
    actors: [
      { id: "owner", name: "Owner", role: "protagonist", is_playable: true, persona: { background: "b", personality: "p", communication_style: "c" }, goals: [], knowledge: [] },
      { id: "guide", name: "Guide", role: "npc", is_playable: false, persona: { background: "b", personality: "p", communication_style: "c" }, goals: [], knowledge: ["f1"] },
    ],
    locations: [{ id: "loc1", name: "Room", type: "office", exits: [] }],
    facts: [{ id: "f1", label: "F1", content: "info", sources: [{ actor_id: "guide", location_id: "loc1" }] }],
    decisions: [
      { id: "d1", prompt: "go?", requires_facts: ["f1"], options: [
        { id: "goA", label: "A", consequence_text: "a", illuminates: ["lo1"], leads_to: "n2" },
        { id: "goB", label: "B", consequence_text: "b", illuminates: ["lo1"], leads_to: "end_bad" },
      ] },
      { id: "d2", prompt: "finish?", requires_facts: [], options: [
        { id: "fin", label: "Finish", consequence_text: "c", illuminates: ["lo1"], leads_to: "end_good" },
      ] },
    ],
    nodes: [
      { id: "n1", title: "Start", accessible_locations: ["loc1"], present_actors: ["guide"], available_facts: ["f1"], live_decisions: ["d1"] },
      { id: "n2", title: "Second", accessible_locations: ["loc1"], present_actors: [], available_facts: [], live_decisions: ["d2"] },
    ],
    endings: [
      { id: "end_bad", title: "Bad", summary: "s", real_case_comparison: "r", lo_outcomes: [{ lo_id: "lo1", verdict: "v" }] },
      { id: "end_good", title: "Good", summary: "s", real_case_comparison: "r", lo_outcomes: [{ lo_id: "lo1", verdict: "v" }] },
    ],
  };
}
