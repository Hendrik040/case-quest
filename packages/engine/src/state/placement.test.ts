import { describe, it, expect } from "vitest";
import { WorldSchema, type World } from "@case-quest/schema";
import toyJson from "../../public/worlds/wholesale-offer.world.json";
import { resolvePlacement, homeLocationForActor } from "./placement";

const world: World = WorldSchema.parse(toyJson);
const node = world.nodes.find((n) => n.id === "node_the_offer")!;

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
});
