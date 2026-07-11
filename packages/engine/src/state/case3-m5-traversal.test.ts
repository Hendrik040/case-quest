import { describe, it, expect } from "vitest";
import { WorldSchema, buildNodeGraph, type World } from "@case-quest/schema";
import worldJson from "../../public/worlds/case3-m5.world.json";
import { GameSession, type MeetingView } from "./session";
import { resolveSeating } from "./placement";

// B1 fix (M5 Task 5.2 review): maybeStartChain now returns null at a node's venue whenever
// it has >=1 seated actor — the walk-up multi-party meeting (startMeeting) is THE intended
// interaction there, not the legacy single-actor auto-chain. Drives every seated actor's
// topics through the meeting machine instead, exactly as WorldScene's real triggerZone ->
// `encounter:meeting:start` -> `session.startMeeting` wiring would.
function driveMeetingAtVenue(s: GameSession, world: World): void {
  expect(s.maybeStartChain()).toBeNull();
  const { seatedActorIds } = resolveSeating(world, s.currentNode(), s.currentLocationId());
  const view: MeetingView = s.startMeeting(seatedActorIds);
  for (const participant of view.participants) {
    for (const topic of view.topicsByActor[participant.actorId]) {
      s.meetingAsk(participant.actorId, topic.factId);
    }
  }
  s.meetingWrapUp();
}

// Regression coverage for the Task 5.1 review findings against the REAL, hand-authored
// Case 3 world (not a toy fixture): the reviewer's smoke-test recommendation was "walk
// from node 1's start to the final ending using only moveTo/door-equivalent calls
// alongside the schema validator" — this file is exactly that, plus a static invariant
// that closes the "wrap up before gathering a later-required fact" soft-lock.

const world: World = WorldSchema.parse(worldJson);

// BFS distance from the start node over the story graph (live_decisions -> leads_to),
// used only to order nodes for the "sourced earlier than required" check below —
// mirrors `checkFactSolvability`'s graph traversal rather than assuming JSON array order.
function nodeDistances(w: World): Map<string, number> {
  const { edges } = buildNodeGraph(w);
  const dist = new Map<string, number>([[w.meta.start_node_id, 0]]);
  const queue = [w.meta.start_node_id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of edges.get(cur) ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, dist.get(cur)! + 1);
      queue.push(next);
    }
  }
  return dist;
}

describe("case3-m5 world — no fact sourced only in an earlier node escapes that node's own decision gate", () => {
  it("every fact required by a later node's decision, if sourced exclusively in an earlier node, is also required by that earlier node's own live decision", () => {
    // Otherwise the engine lets a player wrap up / leave the earlier node (via
    // meetingWrapUp or simply choosing that node's decision) without ever being forced
    // to gather the fact — and since that node's actors/locations never reappear, the
    // fact — and the later decision that needs it — becomes permanently unreachable.
    const distance = nodeDistances(world);
    const decisionById = new Map(world.decisions.map((d) => [d.id, d]));
    const nodeByDecision = new Map<string, World["nodes"][number]>();
    for (const n of world.nodes) for (const did of n.live_decisions) nodeByDecision.set(did, n);

    for (const sourceNode of world.nodes) {
      for (const factId of sourceNode.available_facts) {
        for (const d of world.decisions) {
          if (!d.requires_facts.includes(factId)) continue;
          const owningNode = nodeByDecision.get(d.id);
          if (!owningNode || owningNode.id === sourceNode.id) continue;
          const sourceDist = distance.get(sourceNode.id);
          const ownDist = distance.get(owningNode.id);
          if (sourceDist === undefined || ownDist === undefined || sourceDist >= ownDist) continue;

          // factId is sourced in an earlier node than the decision requiring it — every
          // one of the earlier (sourcing) node's own live decisions must also gate on it.
          for (const earlierDecId of sourceNode.live_decisions) {
            const earlierDec = decisionById.get(earlierDecId)!;
            expect(
              earlierDec.requires_facts,
              `fact "${factId}" is available in "${sourceNode.id}" (earlier than "${owningNode.id}", which requires it via decision "${d.id}"), but isn't required by "${sourceNode.id}"'s own decision "${earlierDecId}" — a player can leave "${sourceNode.id}" without ever gathering it.`,
            ).toContain(factId);
          }
        }
      }
    }
  });
});

describe("case3-m5 world — full walkthrough via real moveTo/door traversal (M5 Task 5.1 review)", () => {
  // Drives GameSession exactly like a thorough player would: talk to every present actor
  // and visit every fact spot at each node BEFORE choosing that node's decision, and walk
  // only through doors resolvePlacement would actually render (i.e. only ever moveTo a
  // location in session.accessibleLocations()). Exercises the doorTargets route-union fix
  // and the traversal-walkable-set (next node's full accessible_locations) fix together,
  // on the actual authored location graph — not a hand-built two-node fixture.

  it("plays the whole world start to an ending, gathering every listed fact along the way, using only real moveTo calls", () => {
    const s = new GameSession(world);

    // --- Node 1: node-kaskazi-office ---
    expect(s.currentNode().id).toBe("node-kaskazi-office");
    // Hussein is seated at the venue (boardroom); walk there and hold the meeting.
    s.moveTo("loc-kaskazi-boardroom");
    driveMeetingAtVenue(s, world);

    // Koech (route NPC) sits on the route to Kawangware: walk the route.
    s.moveTo("loc-kaskazi-hq");
    s.moveTo("loc-nairobi-river-bridge");
    s.moveTo("loc-kawangware-entrance");
    const view = s.maybeStartChain(); // non-venue location: legacy chain unaffected by B1
    expect(view?.actorId).toBe("actor-koech");
    for (const topic of view!.topics) s.encounterAsk(topic.factId);
    while (s.encounterMoveOn().next) { /* drain */ }

    expect(s.isDecisionUnlocked("dec-frame-the-plan")).toBe(true);
    s.startDecision("dec-frame-the-plan");
    s.chooseOption("dec-frame-the-plan", "opt-lead-market-size", "test reasoning");
    expect(s.mode()).toBe("traversing");

    // Walk the rest of the route into node 2's venue (a door render + moveTo per hop).
    s.moveTo("loc-kawangware-market");
    expect(s.pollSceneActivation()).toEqual({ fromNodeId: "node-kaskazi-office", toNodeId: "node-kawangware-market" });
    expect(s.currentNode().id).toBe("node-kawangware-market");

    // --- Node 2: node-kawangware-market ---
    // Grouped venue seating: judy + mama-wanjiru at the market stalls (newspaper-vendor is a
    // route NPC, excluded — held separately on the back lane below).
    driveMeetingAtVenue(s, world);
    // Newspaper vendor is a route NPC on the back lane.
    s.moveTo("loc-kawangware-backlane");
    const backlaneView = s.maybeStartChain(); // non-venue location: legacy chain unaffected by B1
    expect(backlaneView?.actorId).toBe("actor-newspaper-vendor");
    for (const topic of backlaneView!.topics) s.encounterAsk(topic.factId);
    while (s.encounterMoveOn().next) { /* drain */ }

    expect(s.isDecisionUnlocked("dec-choose-clients")).toBe(true);
    s.startDecision("dec-choose-clients");
    s.chooseOption("dec-choose-clients", "opt-court-manufacturers", "test reasoning");
    expect(s.mode()).toBe("traversing");

    // Walk the route into the warehouse: back lane -> industrial avenue -> warehouse
    // exterior (a non-venue intermediate accessible_location of node 3, reachable only
    // via the traversal-walkable-set fix) -> warehouse floor (the venue).
    s.moveTo("loc-industrial-avenue");
    s.moveTo("loc-warehouse-exterior"); // non-venue hop into node 3's own accessible_locations
    expect(s.mode()).toBe("traversing"); // arrival not yet triggered
    expect(s.currentNode().id).toBe("node-kawangware-market");
    s.moveTo("loc-warehouse-floor");
    expect(s.pollSceneActivation()).toEqual({ fromNodeId: "node-kawangware-market", toNodeId: "node-warehouse-negotiation" });
    expect(s.currentNode().id).toBe("node-warehouse-negotiation");

    // --- Node 3: node-warehouse-negotiation --- (Otieno, seated alone at the client_site venue)
    driveMeetingAtVenue(s, world);
    // fact-dead-stock-risk is a location-only fact spot at the warehouse exterior.
    s.moveTo("loc-warehouse-exterior");
    s.gatherFactFromLocation("fact-dead-stock-risk");
    // fact-key-accounts-context is a location-only fact spot on the CBD avenue route.
    s.moveTo("loc-cbd-avenue");
    s.gatherFactFromLocation("fact-key-accounts-context");

    expect(s.isDecisionUnlocked("dec-secure-wholesaler")).toBe(true);
    s.startDecision("dec-secure-wholesaler");
    s.chooseOption("dec-secure-wholesaler", "opt-add-alongside", "test reasoning");
    expect(s.mode()).toBe("traversing");

    // Walk into the modern office: CBD avenue -> modern office (non-venue hop) -> modern boardroom (venue).
    s.moveTo("loc-modern-office"); // non-venue hop into node 4's own accessible_locations
    expect(s.mode()).toBe("traversing");
    expect(s.currentNode().id).toBe("node-warehouse-negotiation");
    s.moveTo("loc-modern-boardroom");
    expect(s.pollSceneActivation()).toEqual({ fromNodeId: "node-warehouse-negotiation", toNodeId: "node-modern-office-decision" });
    expect(s.currentNode().id).toBe("node-modern-office-decision");

    // --- Node 4: node-modern-office-decision --- (hussein + judy grouped at the modern boardroom)
    driveMeetingAtVenue(s, world);

    expect(s.isDecisionUnlocked("dec-finalize-business-model")).toBe(true);
    s.startDecision("dec-finalize-business-model");
    const result = s.chooseOption("dec-finalize-business-model", "opt-organized-network", "test reasoning");
    expect(result.endedAt).toBe("ending");
    expect(s.isEnded()).toBe(true);
    expect(s.currentEnding()!.id).toBe("end-organized-network");

    const debrief = s.debrief();
    expect(debrief?.ending.id).toBe("end-organized-network");
    expect(debrief?.objectives).toHaveLength(5);
  });
});
