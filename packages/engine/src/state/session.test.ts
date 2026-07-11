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
    s.startDecision("decide_contract");
    const r = s.chooseOption("decide_contract", "accept", "Growth outweighs the risk.");
    expect(r.endedAt).toBe("ending");
    expect(s.isEnded()).toBe(true);
    expect(s.currentEnding()!.id).toBe("end_overextended");
  });
  it("decline -> end_stable", () => {
    const s = newSession();
    gatherAll(s);
    s.startDecision("decide_contract");
    s.chooseOption("decide_contract", "decline", "Capacity first.");
    expect(s.currentEnding()!.id).toBe("end_stable");
  });
  it("debrief joins objectives and records reasoning", () => {
    const s = newSession();
    gatherAll(s);
    s.startDecision("decide_contract");
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
  it("rejects mutations after the game has ended", () => {
    const s = newSession();
    gatherAll(s);
    s.startDecision("decide_contract");
    s.chooseOption("decide_contract", "accept", "go");
    expect(() => s.moveTo("roastery_floor")).toThrow();
    expect(() => s.gatherFactsFromActor("roaster")).toThrow();
    expect(() => s.chooseOption("decide_contract", "decline", "again")).toThrow();
  });
});

describe("GameSession — encounter machine", () => {
  it("boots roaming; maybeStartChain queues the start room's agents once", () => {
    const s = newSession();
    expect(s.mode()).toBe("roaming");
    const v = s.maybeStartChain();
    expect(s.mode()).toBe("encounter");
    expect(v?.actorId).toBe("roaster");
    expect(v?.chainLength).toBe(2); // roaster + buyer live on roastery_floor
    expect(v?.topics).toEqual([{ factId: "fact_capacity", label: expect.any(String), asked: false }]);
  });
  it("maybeStartChain is null on revisit and in non-roaming modes", () => {
    const s = newSession();
    s.maybeStartChain();
    expect(s.maybeStartChain()).toBeNull(); // already in encounter
    while (s.encounterMoveOn().next) { /* drain chain */ }
    expect(s.mode()).toBe("roaming");
    expect(s.maybeStartChain()).toBeNull(); // visited
  });
  it("encounterAsk reveals the line, gathers the fact, and marks the topic asked", () => {
    const s = newSession();
    s.maybeStartChain();
    const { line } = s.encounterAsk("fact_capacity");
    expect(line).toContain("500");
    expect(s.isFactGathered("fact_capacity")).toBe(true);
    expect(s.encounterState()?.topics[0].asked).toBe(true);
    expect(() => s.encounterAsk("fact_capacity")).toThrow(); // already asked
    expect(() => s.encounterAsk("fact_cash")).toThrow();     // not this actor's topic
  });
  it("moveOn advances the chain then returns to roaming", () => {
    const s = newSession();
    s.maybeStartChain();
    const step = s.encounterMoveOn();
    expect(step.next?.actorId).toBe("buyer");
    expect(s.encounterMoveOn().next).toBeNull();
    expect(s.mode()).toBe("roaming");
  });
  it("walk-up re-open works after the chain and reuses asked state", () => {
    const s = newSession();
    s.maybeStartChain();
    s.encounterAsk("fact_capacity");
    s.encounterMoveOn(); s.encounterMoveOn();
    const v = s.startEncounterWith("roaster");
    expect(v.chainLength).toBe(1);
    expect(v.topics[0].asked).toBe(true);
    expect(() => s.startEncounterWith("bookkeeper")).toThrow(); // other room
  });
  it("pollDecisionPrompt fires exactly once when the last fact lands", () => {
    const s = newSession();
    s.maybeStartChain();
    s.encounterAsk("fact_capacity");
    s.encounterMoveOn(); // buyer
    s.encounterAsk("fact_contract");
    s.encounterMoveOn();
    expect(s.pollDecisionPrompt()).toBe(false); // 2/3 facts
    s.moveTo("back_office");
    const v = s.maybeStartChain();
    expect(v?.actorId).toBe("bookkeeper");
    s.encounterAsk("fact_cash");
    s.encounterMoveOn();
    expect(s.pollDecisionPrompt()).toBe(true);
    expect(s.pollDecisionPrompt()).toBe(false); // once only
  });
  it("decision flow: start requires unlock, cancel returns to roaming, choose ends", () => {
    const s = newSession();
    expect(() => s.startDecision("decide_contract")).toThrow(); // locked
    s.maybeStartChain(); s.encounterAsk("fact_capacity"); s.encounterMoveOn();
    s.encounterAsk("fact_contract"); s.encounterMoveOn();
    s.moveTo("back_office"); s.maybeStartChain(); s.encounterAsk("fact_cash"); s.encounterMoveOn();
    s.startDecision("decide_contract");
    expect(s.mode()).toBe("decision");
    s.cancelDecision();
    expect(s.mode()).toBe("roaming");
    s.startDecision("decide_contract");
    expect(s.chooseOption("decide_contract", "decline", "capacity first").endedAt).toBe("ending");
    expect(s.mode()).toBe("debrief");
  });
  it("chooseOption throws outside decision mode; encounter calls throw while roaming", () => {
    const s = newSession();
    expect(() => s.encounterAsk("fact_capacity")).toThrow();
    expect(() => s.encounterMoveOn()).toThrow();
    gatherAll(s); // legacy helper still gathers facts directly
    expect(() => s.chooseOption("decide_contract", "decline", "r")).toThrow(/decision/);
  });
});

describe("GameSession — meeting machine (multi-party)", () => {
  it("startMeeting seats the given actors and builds per-actor topics", () => {
    const s = newSession();
    const v = s.startMeeting(["roaster", "buyer"]);
    expect(s.mode()).toBe("meeting");
    expect(v.participants.map((p) => p.actorId)).toEqual(["roaster", "buyer"]);
    expect(v.participants[0]).toEqual({ actorId: "roaster", name: "Sam", role: expect.any(String), paletteIndex: expect.any(Number) });
    expect(v.activeActorId).toBe("roaster");
    expect(v.topicsByActor.roaster).toEqual([{ factId: "fact_capacity", label: expect.any(String), asked: false }]);
    expect(v.topicsByActor.buyer).toEqual([{ factId: "fact_contract", label: expect.any(String), asked: false }]);
  });

  it("startMeeting throws for an unknown actor id", () => {
    const s = newSession();
    expect(() => s.startMeeting(["roaster", "ghost"])).toThrow();
  });

  it("startMeeting throws with no participants", () => {
    const s = newSession();
    expect(() => s.startMeeting([])).toThrow();
  });

  it("startMeeting throws outside roaming (e.g. mid encounter)", () => {
    const s = newSession();
    s.maybeStartChain();
    expect(s.mode()).toBe("encounter");
    expect(() => s.startMeeting(["roaster", "buyer"])).toThrow();
  });

  it("meetingAsk grants the fact on ask and marks the topic asked", () => {
    const s = newSession();
    s.startMeeting(["roaster", "buyer"]);
    const { line } = s.meetingAsk("roaster", "fact_capacity");
    expect(line).toContain("500");
    expect(s.isFactGathered("fact_capacity")).toBe(true);
    expect(s.meetingState()?.topicsByActor.roaster[0].asked).toBe(true);
  });

  it("meetingAsk throws asking a closed (already-asked) topic", () => {
    const s = newSession();
    s.startMeeting(["roaster", "buyer"]);
    s.meetingAsk("roaster", "fact_capacity");
    expect(() => s.meetingAsk("roaster", "fact_capacity")).toThrow();
  });

  it("meetingAsk throws asking a topic that isn't the given actor's", () => {
    const s = newSession();
    s.startMeeting(["roaster", "buyer"]);
    expect(() => s.meetingAsk("roaster", "fact_contract")).toThrow();
  });

  it("meetingAsk throws for a non-participant actor", () => {
    const s = newSession();
    s.startMeeting(["roaster"]);
    expect(() => s.meetingAsk("buyer", "fact_contract")).toThrow();
  });

  it("meetingSetActive switches the active speaker; throws for a non-participant", () => {
    const s = newSession();
    s.startMeeting(["roaster", "buyer"]);
    s.meetingSetActive("buyer");
    expect(s.meetingState()?.activeActorId).toBe("buyer");
    expect(() => s.meetingSetActive("bookkeeper")).toThrow();
  });

  it("meetingWrapUp returns to roaming and clears meeting state", () => {
    const s = newSession();
    s.startMeeting(["roaster", "buyer"]);
    s.meetingAsk("roaster", "fact_capacity");
    s.meetingWrapUp();
    expect(s.mode()).toBe("roaming");
    expect(s.meetingState()).toBeNull();
    expect(s.isFactGathered("fact_capacity")).toBe(true); // survives wrap-up
  });

  it("meetingAsk/meetingSetActive/meetingWrapUp throw when no meeting is in progress", () => {
    const s = newSession();
    expect(() => s.meetingAsk("roaster", "fact_capacity")).toThrow();
    expect(() => s.meetingSetActive("roaster")).toThrow();
    expect(() => s.meetingWrapUp()).toThrow();
  });

  it("decision prompt does not fire during a meeting but does fire after wrap-up once unlocked", () => {
    const s = newSession();
    s.startMeeting(["roaster", "buyer"]);
    s.meetingAsk("roaster", "fact_capacity");
    s.meetingAsk("buyer", "fact_contract");
    // 2/3 facts gathered; decision would still be locked, but assert the prompt
    // never fires mid-meeting regardless.
    expect(s.pollDecisionPrompt()).toBe(false);
    s.meetingWrapUp();
    expect(s.pollDecisionPrompt()).toBe(false); // still 2/3, locked
    s.moveTo("back_office");
    s.gatherFactsFromActor("bookkeeper"); // fact_cash: 3/3 now
    expect(s.pollDecisionPrompt()).toBe(true);
    expect(s.pollDecisionPrompt()).toBe(false); // once only
  });
});

describe("GameSession — multi-node decision path", () => {
  // Hand-built minimal two-node world (not the toy world.json) to exercise the
  // endedAt:"node" branch of chooseOption: node A's only decision leads to
  // node B (another StoryNode), not straight to an ending.
  function twoNodeWorld(): World {
    return WorldSchema.parse({
      schema_version: "0.2",
      meta: {
        case_id: "multi-node-test",
        title: "Multi-Node Test World",
        synopsis: "A minimal two-node world for exercising the endedAt:\"node\" transition.",
        protagonist_actor_id: "player",
        start_node_id: "node_a",
      },
      learning_objectives: [],
      actors: [
        {
          id: "player", name: "Player", role: "protagonist", is_playable: true,
          persona: { background: "", personality: "", communication_style: "" },
          goals: [], knowledge: [],
        },
        {
          id: "npc_a", name: "Ann", role: "npc", is_playable: false,
          persona: { background: "", personality: "", communication_style: "" },
          goals: [], knowledge: ["fact_a"],
          dialogue: { greeting: "Hi from A", topics: [{ fact_id: "fact_a", line: "Fact A revealed." }] },
        },
        {
          id: "npc_b", name: "Ben", role: "npc", is_playable: false,
          persona: { background: "", personality: "", communication_style: "" },
          goals: [], knowledge: ["fact_b"],
          dialogue: { greeting: "Hi from B", topics: [{ fact_id: "fact_b", line: "Fact B revealed." }] },
        },
      ],
      locations: [
        { id: "loc_a", name: "Location A", type: "office", exits: [] },
        { id: "loc_b", name: "Location B", type: "office", exits: [] },
      ],
      facts: [
        { id: "fact_a", label: "Fact A", content: "content a", sources: [{ actor_id: "npc_a", location_id: "loc_a" }] },
        { id: "fact_b", label: "Fact B", content: "content b", sources: [{ actor_id: "npc_b", location_id: "loc_b" }] },
      ],
      decisions: [
        {
          id: "decide_a", prompt: "Move to node B?", requires_facts: ["fact_a"],
          options: [{ id: "go_b", label: "Go to node B", consequence_text: "You head to node B.", illuminates: [], leads_to: "node_b" }],
        },
        {
          id: "decide_b", prompt: "Finish?", requires_facts: ["fact_b"],
          options: [{ id: "finish", label: "Finish", consequence_text: "You finish.", illuminates: [], leads_to: "end_final" }],
        },
      ],
      nodes: [
        { id: "node_a", title: "Node A", accessible_locations: ["loc_a"], present_actors: ["npc_a"], available_facts: ["fact_a"], live_decisions: ["decide_a"] },
        { id: "node_b", title: "Node B", accessible_locations: ["loc_b"], present_actors: ["npc_b"], available_facts: ["fact_b"], live_decisions: ["decide_b"] },
      ],
      endings: [
        { id: "end_final", title: "The End", summary: "You reached the end.", real_case_comparison: "n/a", lo_outcomes: [] },
      ],
    });
  }

  it("leads_to another node: relocates, resets roaming/visited/decisionPrompted, and the new node re-arms", () => {
    const s = new GameSession(twoNodeWorld());

    const view = s.maybeStartChain();
    expect(view?.actorId).toBe("npc_a");
    s.encounterAsk("fact_a");
    s.encounterMoveOn();
    expect(s.pollDecisionPrompt()).toBe(true);

    s.startDecision("decide_a");
    const r = s.chooseOption("decide_a", "go_b", "moving on");

    expect(r.endedAt).toBe("node");
    expect(s.mode()).toBe("roaming");
    expect(s.currentNode().id).toBe("node_b");
    expect(s.currentLocationId()).toBe("loc_b"); // node B's first accessible location

    // visited was cleared, so node B's own room auto-chain can arm again
    const nextView = s.maybeStartChain();
    expect(nextView).not.toBeNull();
    expect(nextView?.actorId).toBe("npc_b");

    // decisionPrompted was reset, so the next node's decision can prompt again
    s.encounterAsk("fact_b");
    s.encounterMoveOn();
    expect(s.pollDecisionPrompt()).toBe(true);
  });
});

describe("GameSession — spatial traversal (route locations + venue)", () => {
  // A two-node world where node_b has a venue-typed location (boardroom), and node_a
  // has a route_location (a street) linking node_a's office to node_b's venue. Exercises
  // the traversing sub-state: chooseOption no longer teleports outright when the next node
  // has a venue; the player must walk the route to trigger node activation.
  function routedWorld(): World {
    return WorldSchema.parse({
      schema_version: "0.2",
      meta: {
        case_id: "routed-test",
        title: "Routed Test World",
        synopsis: "A minimal two-node world exercising spatial traversal via route_locations.",
        protagonist_actor_id: "player",
        start_node_id: "node_a",
      },
      learning_objectives: [],
      actors: [
        {
          id: "player", name: "Player", role: "protagonist", is_playable: true,
          persona: { background: "", personality: "", communication_style: "" },
          goals: [], knowledge: [],
        },
        {
          id: "npc_a", name: "Ann", role: "npc", is_playable: false,
          persona: { background: "", personality: "", communication_style: "" },
          goals: [], knowledge: ["fact_a"],
          dialogue: { greeting: "Hi from A", topics: [{ fact_id: "fact_a", line: "Fact A revealed." }] },
        },
        {
          id: "npc_b", name: "Ben", role: "npc", is_playable: false,
          persona: { background: "", personality: "", communication_style: "" },
          goals: [], knowledge: ["fact_b"],
          dialogue: { greeting: "Hi from B", topics: [{ fact_id: "fact_b", line: "Fact B revealed." }] },
        },
        {
          // Non-scene route NPC: home resolves to loc_street (fact_route sourced there;
          // loc_street is in node_a's route_locations, part of the accessible∪route union
          // used by homeLocationForActor).
          id: "npc_route", name: "Rya", role: "npc", is_playable: false,
          persona: { background: "", personality: "", communication_style: "" },
          goals: [], knowledge: ["fact_route"],
          dialogue: { greeting: "Hi from the street", topics: [{ fact_id: "fact_route", line: "Route flavor revealed." }] },
        },
      ],
      locations: [
        { id: "loc_a_office", name: "Office A", type: "office", exits: ["loc_street"] },
        { id: "loc_street", name: "Connecting Street", type: "street", exits: ["loc_a_office", "loc_b_venue", "loc_dead_end"] },
        { id: "loc_dead_end", name: "Dead End Alley", type: "street", exits: ["loc_street"] },
        { id: "loc_b_venue", name: "Boardroom B", type: "boardroom", exits: ["loc_street"] },
      ],
      facts: [
        { id: "fact_a", label: "Fact A", content: "content a", sources: [{ actor_id: "npc_a", location_id: "loc_a_office" }] },
        { id: "fact_b", label: "Fact B", content: "content b", sources: [{ actor_id: "npc_b", location_id: "loc_b_venue" }] },
        { id: "fact_route", label: "Route Flavor", content: "street gossip", sources: [{ actor_id: "npc_route", location_id: "loc_street" }] },
      ],
      decisions: [
        {
          id: "decide_a", prompt: "Move to node B?", requires_facts: ["fact_a"],
          options: [{ id: "go_b", label: "Go to node B", consequence_text: "You head to node B.", illuminates: [], leads_to: "node_b" }],
        },
        {
          id: "decide_b", prompt: "Finish?", requires_facts: ["fact_b"],
          options: [{ id: "finish", label: "Finish", consequence_text: "You finish.", illuminates: [], leads_to: "end_final" }],
        },
      ],
      nodes: [
        {
          id: "node_a", title: "Node A", accessible_locations: ["loc_a_office"], route_locations: ["loc_street"],
          present_actors: ["npc_a", "npc_route"], available_facts: ["fact_a", "fact_route"], live_decisions: ["decide_a"],
        },
        {
          id: "node_b", title: "Node B", accessible_locations: ["loc_b_venue"],
          present_actors: ["npc_b"], available_facts: ["fact_b"], live_decisions: ["decide_b"],
        },
      ],
      endings: [
        { id: "end_final", title: "The End", summary: "You reached the end.", real_case_comparison: "n/a", lo_outcomes: [] },
      ],
    });
  }

  function reachDecisionA(s: GameSession) {
    s.maybeStartChain();
    s.encounterAsk("fact_a");
    s.encounterMoveOn();
    s.startDecision("decide_a");
  }

  it("chooseOption enters traversing (not an immediate teleport) when the next node has a venue", () => {
    const s = new GameSession(routedWorld());
    reachDecisionA(s);
    const r = s.chooseOption("decide_a", "go_b", "moving on");

    expect(r.endedAt).toBe("node");
    expect(s.mode()).toBe("traversing");
    // still physically in node_a's world, at the same location, until arrival
    expect(s.currentNode().id).toBe("node_a");
    expect(s.currentLocationId()).toBe("loc_a_office");
    // walkable set now includes node_a's route location + node_b's venue
    const ids = s.accessibleLocations().map((l) => l.id).sort();
    expect(ids).toEqual(["loc_a_office", "loc_b_venue", "loc_street"]);
  });

  it("moving through the route and arriving at the next venue activates node B and reports the transition", () => {
    const s = new GameSession(routedWorld());
    reachDecisionA(s);
    s.chooseOption("decide_a", "go_b", "moving on");

    s.moveTo("loc_street");
    expect(s.mode()).toBe("traversing");
    expect(s.pollSceneActivation()).toBeNull(); // not there yet

    s.moveTo("loc_b_venue");
    expect(s.currentNode().id).toBe("node_b");
    expect(s.currentLocationId()).toBe("loc_b_venue");
    expect(s.mode()).toBe("roaming");
    expect(s.pollSceneActivation()).toEqual({ fromNodeId: "node_a", toNodeId: "node_b" });
    expect(s.pollSceneActivation()).toBeNull(); // one-shot, like pollDecisionPrompt

    // node B re-arms normally after arrival
    const view = s.maybeStartChain();
    expect(view?.actorId).toBe("npc_b");
  });

  it("rejects moving to a location outside the extended walkable set mid-traversal", () => {
    const s = new GameSession(routedWorld());
    reachDecisionA(s);
    s.chooseOption("decide_a", "go_b", "moving on");
    s.moveTo("loc_street");
    // loc_dead_end is exit-connected from loc_street but is neither node_a's accessible/route
    // location nor node_b's venue — must stay rejected even while traversing.
    expect(() => s.moveTo("loc_dead_end")).toThrow();
  });

  it("route NPC encounter mid-traversal works (existing mechanics) and returns to traversing", () => {
    const s = new GameSession(routedWorld());
    reachDecisionA(s);
    s.chooseOption("decide_a", "go_b", "moving on");
    s.moveTo("loc_street");
    expect(s.mode()).toBe("traversing");

    // Walk-up encounter with the non-scene route NPC via the existing single-NPC flow.
    const v = s.startEncounterWith("npc_route");
    expect(s.mode()).toBe("encounter");
    expect(v.actorId).toBe("npc_route");
    const { line } = s.encounterAsk("fact_route");
    expect(line).toContain("Route flavor");
    expect(s.isFactGathered("fact_route")).toBe(true);

    // Closing the encounter returns to traversing (arrival still pending), not plain roaming.
    expect(s.encounterMoveOn().next).toBeNull();
    expect(s.mode()).toBe("traversing");
    expect(s.currentNode().id).toBe("node_a"); // no teleport
    expect(s.pollSceneActivation()).toBeNull();

    // The pending traversal target survived the encounter: arrival still activates node B.
    s.moveTo("loc_b_venue");
    expect(s.currentNode().id).toBe("node_b");
    expect(s.mode()).toBe("roaming");
    expect(s.pollSceneActivation()).toEqual({ fromNodeId: "node_a", toNodeId: "node_b" });
  });

  it("maybeStartChain fires at a route location mid-traversal without re-teleporting", () => {
    const s = new GameSession(routedWorld());
    reachDecisionA(s);
    s.chooseOption("decide_a", "go_b", "moving on");
    s.moveTo("loc_street");

    const v = s.maybeStartChain();
    expect(v?.actorId).toBe("npc_route");
    expect(s.mode()).toBe("encounter");
    while (s.encounterMoveOn().next) { /* drain chain */ }
    expect(s.mode()).toBe("traversing");
    expect(s.currentNode().id).toBe("node_a");
    expect(s.currentLocationId()).toBe("loc_street");
  });

  it("gathering a flavor fact from a route location works mid-traversal", () => {
    const s = new GameSession(routedWorld());
    reachDecisionA(s);
    s.chooseOption("decide_a", "go_b", "moving on");
    s.moveTo("loc_street");
    s.gatherFactFromLocation("fact_route");
    expect(s.isFactGathered("fact_route")).toBe(true);
    expect(s.mode()).toBe("traversing");
  });

  it("decisions stay blocked mid-traversal; scene activation happens only on arrival", () => {
    const s = new GameSession(routedWorld());
    reachDecisionA(s);
    s.chooseOption("decide_a", "go_b", "moving on");
    expect(s.mode()).toBe("traversing");
    expect(() => s.startDecision("decide_b")).toThrow();
    expect(s.pollDecisionPrompt()).toBe(false);
    expect(s.pollSceneActivation()).toBeNull(); // nothing activates before arrival
  });
});
