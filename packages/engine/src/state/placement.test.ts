import { describe, it, expect } from "vitest";
import { WorldSchema, type World } from "@case-quest/schema";
import toyJson from "../../public/worlds/wholesale-offer.world.json";
import { resolvePlacement, homeLocationForActor, resolveSeating } from "./placement";

const world: World = WorldSchema.parse(toyJson);
const node = world.nodes.find((n) => n.id === "node_the_offer")!;

function buildVenueWorld(): { world: World; node: World["nodes"][number] } {
  const raw = {
    schema_version: "0.2",
    meta: {
      case_id: "venue-toy",
      title: "Venue Toy",
      synopsis: "A toy world for grouped venue seating.",
      protagonist_actor_id: "player",
      start_node_id: "node_meeting",
    },
    learning_objectives: [],
    actors: [
      { id: "player", name: "Player", role: "protagonist", is_playable: true, persona: { background: "", personality: "", communication_style: "" }, goals: [], knowledge: [] },
      { id: "alice", name: "Alice", role: "npc", is_playable: false, persona: { background: "", personality: "", communication_style: "" }, goals: [], knowledge: [] },
      { id: "bob", name: "Bob", role: "npc", is_playable: false, persona: { background: "", personality: "", communication_style: "" }, goals: [], knowledge: [] },
      { id: "carol", name: "Carol", role: "npc", is_playable: false, persona: { background: "", personality: "", communication_style: "" }, goals: [], knowledge: [] },
      { id: "vendor", name: "Vendor", role: "npc", is_playable: false, persona: { background: "", personality: "", communication_style: "" }, goals: [], knowledge: ["fact_street_gossip"] },
    ],
    locations: [
      { id: "hq_boardroom", name: "HQ Boardroom", type: "boardroom", exits: ["street_outside"] },
      { id: "street_outside", name: "Street Outside", type: "street", exits: ["hq_boardroom"] },
    ],
    facts: [
      { id: "fact_street_gossip", label: "Street gossip", content: "Word on the street.", sources: [{ actor_id: "vendor", location_id: "street_outside" }] },
    ],
    decisions: [],
    nodes: [
      {
        id: "node_meeting",
        title: "The Meeting",
        accessible_locations: ["hq_boardroom"],
        route_locations: ["street_outside"],
        present_actors: ["alice", "bob", "carol", "vendor"],
        available_facts: ["fact_street_gossip"],
        live_decisions: [],
      },
    ],
    endings: [],
  };
  const parsed = WorldSchema.parse(raw);
  return { world: parsed, node: parsed.nodes.find((n) => n.id === "node_meeting")! };
}

describe("placement", () => {
  it("anchors NPCs by their fact's source location", () => {
    expect(homeLocationForActor(world, node, "roaster")).toBe("roastery_floor");
    expect(homeLocationForActor(world, node, "bookkeeper")).toBe("back_office");
  });
  it("defaults a location-less NPC to the first accessible location", () => {
    expect(homeLocationForActor(world, node, "buyer")).toBe("roastery_floor");
  });
  it("resolves the roastery floor: roaster + buyer, capacity fact spot, door to back office", () => {
    const p = resolvePlacement(world, node, "roastery_floor");
    expect(p.npcIds.sort()).toEqual(["buyer", "roaster"]);
    expect(p.factSpotIds).toEqual(["fact_capacity"]);
    expect(p.doorTargets).toEqual(["back_office"]);
  });
  it("resolves the back office: bookkeeper, cash fact spot, door to roastery floor", () => {
    const p = resolvePlacement(world, node, "back_office");
    expect(p.npcIds).toEqual(["bookkeeper"]);
    expect(p.factSpotIds).toEqual(["fact_cash"]);
    expect(p.doorTargets).toEqual(["roastery_floor"]);
  });

  describe("grouped venue seating", () => {
    it("seats all of a node's present actors together at the node's boardroom venue, excluding route NPCs", () => {
      const { world: vWorld, node: vNode } = buildVenueWorld();
      const { seatedActorIds } = resolveSeating(vWorld, vNode, "hq_boardroom");
      expect(seatedActorIds.sort()).toEqual(["alice", "bob", "carol"]);
    });
    it("resolvePlacement's npcIds at the venue matches the grouped seating", () => {
      const { world: vWorld, node: vNode } = buildVenueWorld();
      const p = resolvePlacement(vWorld, vNode, "hq_boardroom");
      expect(p.npcIds.sort()).toEqual(["alice", "bob", "carol"]);
    });
    it("keeps a route NPC at the route location instead of pulling it into the venue", () => {
      const { world: vWorld, node: vNode } = buildVenueWorld();
      expect(homeLocationForActor(vWorld, vNode, "vendor")).toBe("street_outside");
      const venueSeating = resolveSeating(vWorld, vNode, "hq_boardroom");
      expect(venueSeating.seatedActorIds).not.toContain("vendor");
      const routePlacement = resolvePlacement(vWorld, vNode, "street_outside");
      expect(routePlacement.npcIds).toEqual(["vendor"]);
    });
    it("seats no one at a non-venue location", () => {
      const { world: vWorld, node: vNode } = buildVenueWorld();
      expect(resolveSeating(vWorld, vNode, "street_outside")).toEqual({ seatedActorIds: [] });
    });
  });
});
