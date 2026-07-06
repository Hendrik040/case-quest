import { describe, it, expect } from "vitest";
import { validateWorld } from "../src/validate";
import { toyWorld } from "./helpers";

function codes(w: unknown): string[] {
  return validateWorld(w).errors.map((e) => e.code);
}

describe("Layer 2 — reference integrity", () => {
  it("the toy world has no reference errors", () => {
    expect(validateWorld(toyWorld()).errors).toHaveLength(0);
  });

  it("duplicate_id: two actors sharing an id", () => {
    const w = toyWorld();
    w.actors.push({ ...w.actors[1], name: "Clone" }); // reuse "roaster" id
    expect(codes(w)).toContain("duplicate_id");
  });

  it("dangling_ref: decision requires an unknown fact", () => {
    const w = toyWorld();
    w.decisions[0].requires_facts.push("fact_missing");
    expect(codes(w)).toContain("dangling_ref");
  });

  it("dangling_ref: option leads_to an unknown node/ending", () => {
    const w = toyWorld();
    w.decisions[0].options[0].leads_to = "nowhere";
    expect(codes(w)).toContain("dangling_ref");
  });

  it("protagonist_invalid: protagonist not playable", () => {
    const w = toyWorld();
    const p = w.actors.find((a) => a.id === "owner")!;
    p.is_playable = false;
    expect(codes(w)).toContain("protagonist_invalid");
  });

  it("fact_source_empty: a source with neither actor nor location", () => {
    const w = toyWorld();
    w.facts[0].sources.push({});
    expect(codes(w)).toContain("fact_source_empty");
  });

  it("knowledge_mismatch: actor source not in actor.knowledge", () => {
    const w = toyWorld();
    const roaster = w.actors.find((a) => a.id === "roaster")!;
    roaster.knowledge = []; // roaster is still a source of fact_capacity
    expect(codes(w)).toContain("knowledge_mismatch");
  });

  it("start_missing: start_node_id resolves to nothing", () => {
    const w = toyWorld();
    w.meta.start_node_id = "ghost";
    expect(codes(w)).toContain("start_missing");
  });

  it("no_ending: zero endings", () => {
    const w = toyWorld();
    w.endings = [];
    expect(codes(w)).toContain("no_ending");
  });
});
