import { describe, it, expect } from "vitest";
import { WorldSchema, type World } from "@case-quest/schema";
import toyJson from "../../public/worlds/wholesale-offer.world.json";
import { GameSession } from "./session";

function newSession(): GameSession {
  const world: World = WorldSchema.parse(toyJson);
  return new GameSession(world);
}

function gatherAll(s: GameSession) {
  s.gatherFactsFromActor("roaster");
  s.gatherFactsFromActor("buyer");
  s.moveTo("back_office");
  s.gatherFactsFromActor("bookkeeper");
}

describe("GameSession — read API", () => {
  it("starts at the start node and its first accessible location", () => {
    const s = newSession();
    expect(s.currentNode().id).toBe("node_the_offer");
    expect(s.currentLocationId()).toBe("roastery_floor");
  });
  it("exposes present NPCs (never the protagonist)", () => {
    const ids = newSession().presentActors().map((a) => a.id).sort();
    expect(ids).toEqual(["bookkeeper", "buyer", "roaster"]);
  });
  it("protagonist() returns the playable protagonist", () => {
    expect(newSession().protagonist().id).toBe("owner");
  });
  it("no facts gathered at start; decision locked", () => {
    const s = newSession();
    expect(s.gatheredFactIds()).toEqual([]);
    expect(s.isDecisionUnlocked("decide_contract")).toBe(false);
  });
  it("objective reports 0 of 3 facts", () => {
    expect(newSession().objective()).toEqual({ nodeTitle: "The Offer on the Table", needed: 3, got: 0 });
  });
});

describe("GameSession — movement + gathering", () => {
  it("moves to an accessible, exit-connected location", () => {
    const s = newSession();
    s.moveTo("back_office");
    expect(s.currentLocationId()).toBe("back_office");
  });
  it("throws moving to a non-exit / inaccessible location", () => {
    const s = newSession();
    expect(() => s.moveTo("nowhere")).toThrow();
  });
  it("talking to an NPC reveals and gathers their node-available fact", () => {
    const s = newSession();
    const res = s.gatherFactsFromActor("roaster");
    expect(res.revealed.map((r) => r.factId)).toEqual(["fact_capacity"]);
    expect(res.revealed[0].line).toContain("500");
    expect(s.isFactGathered("fact_capacity")).toBe(true);
  });
  it("gathering is idempotent", () => {
    const s = newSession();
    s.gatherFactsFromActor("roaster");
    s.gatherFactsFromActor("roaster");
    expect(s.gatheredFactIds().filter((f) => f === "fact_capacity")).toHaveLength(1);
  });
  it("gathering a fact from its source location works", () => {
    const s = newSession();
    s.gatherFactFromLocation("fact_capacity");
    expect(s.isFactGathered("fact_capacity")).toBe(true);
  });
  it("gathering all three facts unlocks the decision", () => {
    const s = newSession();
    gatherAll(s);
    expect(s.isDecisionUnlocked("decide_contract")).toBe(true);
    expect(s.objective()).toEqual({ nodeTitle: "The Offer on the Table", needed: 3, got: 3 });
  });
});

describe("GameSession — decisions + debrief", () => {
  it("throws when choosing a locked decision", () => {
    const s = newSession();
    expect(() => s.chooseOption("decide_contract", "accept", "too early")).toThrow();
  });
  it("accept -> end_overextended", () => {
    const s = newSession();
    gatherAll(s);
    const r = s.chooseOption("decide_contract", "accept", "Growth outweighs the risk.");
    expect(r.endedAt).toBe("ending");
    expect(s.isEnded()).toBe(true);
    expect(s.currentEnding()!.id).toBe("end_overextended");
  });
  it("decline -> end_stable", () => {
    const s = newSession();
    gatherAll(s);
    s.chooseOption("decide_contract", "decline", "Capacity first.");
    expect(s.currentEnding()!.id).toBe("end_stable");
  });
  it("debrief joins objectives and records reasoning", () => {
    const s = newSession();
    gatherAll(s);
    s.chooseOption("decide_contract", "decline", "Protect the roastery.");
    const d = s.debrief()!;
    expect(d.ending.id).toBe("end_stable");
    expect(d.objectives).toHaveLength(1);
    expect(d.objectives[0].objective.id).toBe("lo_capacity_vs_growth");
    expect(d.choices).toEqual([
      { prompt: "Do you accept the grocery chain's wholesale contract?", chosenLabel: "Decline the contract, for now", reasoning: "Protect the roastery." },
    ]);
  });
  it("debrief is null before an ending", () => {
    expect(newSession().debrief()).toBeNull();
  });
});
