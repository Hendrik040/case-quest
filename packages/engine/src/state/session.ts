import type {
  World, StoryNode, Location, Actor, Decision, LearningObjective, Ending,
} from "@case-quest/schema";
import { resolvePlacement, venueLocationId } from "./placement";

export interface ChoiceRecord { decisionId: string; optionId: string; reasoning: string; }
export interface DebriefData {
  ending: Ending;
  objectives: { objective: LearningObjective; verdict: string }[];
  choices: { prompt: string; chosenLabel: string; reasoning: string }[];
}
export interface SceneActivation { fromNodeId: string; toNodeId: string; }

export type SessionMode = "roaming" | "encounter" | "decision" | "meeting" | "traversing" | "debrief";
export interface EncounterTopic { factId: string; label: string; asked: boolean; }
export interface EncounterView {
  actorId: string; name: string; role: string; greeting?: string;
  topics: EncounterTopic[]; chainIndex: number; chainLength: number;
}

// Multi-party meeting (M5, Phase 2): a scene's seated participants (venue table/stalls)
// are all "in the room" at once, rather than being asked in a fixed chain like the
// single-NPC encounter. paletteIndex mirrors App.tsx's actorPaletteIndex convention
// (index within the current node's present_actors, mod 4) so the overlay can reuse the
// same bust art without GameSession depending on the UI layer.
export interface MeetingParticipant { actorId: string; name: string; role: string; paletteIndex: number; }
export interface MeetingView {
  participants: MeetingParticipant[];
  activeActorId: string;
  topicsByActor: Record<string, EncounterTopic[]>;
}

export class GameSession {
  private readonly worldRef: World;
  private readonly nodesById: Map<string, StoryNode>;
  private readonly endingsById: Map<string, Ending>;
  private readonly locationsById: Map<string, Location>;
  private readonly actorsById: Map<string, Actor>;
  private readonly decisionsById: Map<string, Decision>;
  private readonly loById: Map<string, LearningObjective>;

  private currentNodeId: string;
  private locationId: string;
  private readonly gathered = new Set<string>();
  private readonly choices: ChoiceRecord[] = [];
  private endingId: string | null = null;

  private internalMode: "roaming" | "encounter" | "decision" | "meeting" = "roaming";
  private chain: string[] = [];
  private chainIdx = 0;
  private readonly visited = new Set<string>();
  private decisionPrompted = false;

  // Meeting sub-state (M5, Phase 2): the seated participants and whichever of them is
  // currently "speaking" in the overlay. Mirrors chain/chainIdx's role for the single-NPC
  // encounter, but there's no chain progression here — the player freely switches active
  // speaker (meetingSetActive) and asks any open topic of any participant (meetingAsk).
  private meetingParticipants: string[] = [];
  private meetingActiveActorId: string | null = null;

  // Traversal sub-state (M5 spatial progression): set by chooseOption when the next node
  // has a venue-typed location. The player keeps walking within the COMPLETED node's world
  // (currentNodeId doesn't change yet) until they reach the next node's venue via moveTo,
  // which triggers arriveAtNextNode(). Traversal is ORTHOGONAL to internalMode: the player
  // is still "roaming" underneath (so route NPC encounters and flavor-fact gathering — the
  // existing mechanics — keep working on route locations, per the design spec's "routes may
  // hold flavor facts and non-scene NPCs but no scene encounters"); mode() reports
  // "traversing" when roaming with a pending traversal. Decisions are explicitly blocked
  // while a traversal is pending. sceneActivation is a one-shot poll flag, mirroring the
  // existing pollDecisionPrompt() idiom, so callers (WorldScene/App, Task 1.6) can detect
  // the transition and emit their own bus event without GameSession depending on
  // bridge/events.ts (GameSession stays network/UI-free).
  private traversal: { toNodeId: string; targetLocationId: string; nextAccessibleLocations: string[] } | null = null;
  private sceneActivation: SceneActivation | null = null;

  constructor(world: World) {
    this.worldRef = world;
    this.nodesById = new Map(world.nodes.map((n) => [n.id, n]));
    this.endingsById = new Map(world.endings.map((e) => [e.id, e]));
    this.locationsById = new Map(world.locations.map((l) => [l.id, l]));
    this.actorsById = new Map(world.actors.map((a) => [a.id, a]));
    this.decisionsById = new Map(world.decisions.map((d) => [d.id, d]));
    this.loById = new Map(world.learning_objectives.map((o) => [o.id, o]));
    this.currentNodeId = world.meta.start_node_id;
    this.locationId = this.currentNode().accessible_locations[0];
  }

  // --- read API ---
  world(): World { return this.worldRef; }

  currentNode(): StoryNode {
    const n = this.nodesById.get(this.currentNodeId);
    if (!n) throw new Error(`unknown node ${this.currentNodeId}`);
    return n;
  }
  currentLocationId(): string { return this.locationId; }
  accessibleLocations(): Location[] {
    return this.walkableLocationIds().map((id) => this.locationsById.get(id)!).filter(Boolean);
  }

  // Review fix (M5 Task 5.1 review): a node's route_locations are ALWAYS part of its
  // walkable footprint, not just while a traversal is pending — they mirror the
  // accessible∪route union `homeLocationForActor`/`checkFactSolvability`'s `gatherableAt`
  // already use unconditionally (see the three-way parity mirror in placement.ts). A
  // route NPC/fact can be the sole source for a fact THIS node's own live decision
  // requires (e.g. a BSR encountered on the street outside the office); gating
  // route_locations behind an already-chosen decision would make that fact — and hence
  // the decision itself — permanently unreachable.
  //
  // While traversing, the walkable set additionally extends with the NEXT node's full
  // accessible_locations (not merely its single venue): the route may only connect to a
  // non-venue location of the next node (e.g. a warehouse yard/building lobby in front
  // of the actual meeting room), and the player must be able to walk through it to reach
  // the venue. Arrival is still gated on reaching the specific venue (`targetLocationId`,
  // see `moveTo`), not merely any of the next node's locations.
  private walkableLocationIds(): string[] {
    const node = this.currentNode();
    const base = [...node.accessible_locations, ...(node.route_locations ?? [])];
    if (this.traversal) {
      return [...new Set([...base, ...this.traversal.nextAccessibleLocations])];
    }
    return [...new Set(base)];
  }
  presentActors(): Actor[] {
    return this.currentNode().present_actors.map((id) => this.actorsById.get(id)!).filter(Boolean);
  }
  protagonist(): Actor {
    return this.actorsById.get(this.worldRef.meta.protagonist_actor_id)!;
  }
  gatheredFactIds(): string[] { return [...this.gathered]; }
  isFactGathered(factId: string): boolean { return this.gathered.has(factId); }
  liveDecisions(): Decision[] {
    return this.currentNode().live_decisions.map((id) => this.decisionsById.get(id)!).filter(Boolean);
  }
  isDecisionUnlocked(decisionId: string): boolean {
    const d = this.decisionsById.get(decisionId);
    if (!d) return false;
    return d.requires_facts.every((f) => this.gathered.has(f));
  }
  objective(): { nodeTitle: string; needed: number; got: number } {
    const node = this.currentNode();
    const d = this.liveDecisions()[0];
    const needed = d ? d.requires_facts.length : 0;
    const got = d ? d.requires_facts.filter((f) => this.gathered.has(f)).length : 0;
    return { nodeTitle: node.title, needed, got };
  }

  // --- encounter machine ---
  mode(): SessionMode {
    if (this.isEnded()) return "debrief";
    // "traversing" is derived: roaming with a pending traversal. Encounters opened on a
    // route report "encounter" as usual, and closing them re-surfaces as "traversing".
    if (this.internalMode === "roaming" && this.traversal) return "traversing";
    return this.internalMode;
  }

  // One-shot poll for the traversal→next-node transition, mirroring pollDecisionPrompt()'s
  // idiom: returns the transition exactly once, then clears it. WorldScene/App (Task 1.6)
  // is expected to translate a non-null result into a `scene:activate` bus event.
  pollSceneActivation(): SceneActivation | null {
    const activation = this.sceneActivation;
    this.sceneActivation = null;
    return activation;
  }

  private topicsForActor(actor: Actor): EncounterTopic[] {
    const available = new Set(this.currentNode().available_facts);
    return actor.knowledge
      .filter((factId) => available.has(factId))
      .map((factId) => {
        const fact = this.worldRef.facts.find((f) => f.id === factId)!;
        return { factId, label: fact.label, asked: this.gathered.has(factId) };
      });
  }

  private buildEncounterView(): EncounterView {
    const actorId = this.chain[this.chainIdx];
    const actor = this.actorsById.get(actorId)!;
    return {
      actorId,
      name: actor.name,
      role: actor.role,
      greeting: actor.dialogue?.greeting,
      topics: this.topicsForActor(actor),
      chainIndex: this.chainIdx,
      chainLength: this.chain.length,
    };
  }

  maybeStartChain(): EncounterView | null {
    if (this.internalMode !== "roaming") return null;
    const key = `${this.currentNodeId}:${this.locationId}`;
    const alreadyVisited = this.visited.has(key);
    this.visited.add(key);
    if (alreadyVisited) return null;
    const { npcIds } = resolvePlacement(this.worldRef, this.currentNode(), this.locationId);
    if (npcIds.length === 0) return null;
    this.chain = npcIds;
    this.chainIdx = 0;
    this.internalMode = "encounter";
    return this.buildEncounterView();
  }

  startEncounterWith(actorId: string): EncounterView {
    this.assertActive();
    if (this.internalMode !== "roaming") throw new Error("cannot start an encounter outside roaming");
    const { npcIds } = resolvePlacement(this.worldRef, this.currentNode(), this.locationId);
    if (!npcIds.includes(actorId)) throw new Error(`"${actorId}" is not present at "${this.locationId}"`);
    this.chain = [actorId];
    this.chainIdx = 0;
    this.internalMode = "encounter";
    return this.buildEncounterView();
  }

  encounterState(): EncounterView | null {
    if (this.internalMode !== "encounter") return null;
    return this.buildEncounterView();
  }

  encounterAsk(factId: string): { line: string } {
    this.assertActive();
    if (this.internalMode !== "encounter") throw new Error("no encounter in progress");
    const view = this.buildEncounterView();
    const topic = view.topics.find((t) => t.factId === factId);
    if (!topic || topic.asked) throw new Error(`"${factId}" is not an open topic here`);
    const actor = this.actorsById.get(view.actorId)!;
    const dialogueTopic = actor.dialogue?.topics?.find((t) => t.fact_id === factId);
    const fact = this.worldRef.facts.find((f) => f.id === factId);
    const line = dialogueTopic?.line ?? (fact ? `${fact.label}: ${fact.content}` : factId);
    this.gathered.add(factId);
    return { line };
  }

  encounterMoveOn(): { next: EncounterView | null } {
    this.assertActive();
    if (this.internalMode !== "encounter") throw new Error("no encounter in progress");
    this.chainIdx += 1;
    if (this.chainIdx >= this.chain.length) {
      this.internalMode = "roaming";
      this.chain = [];
      this.chainIdx = 0;
      return { next: null };
    }
    return { next: this.buildEncounterView() };
  }

  // --- meeting machine (M5, Phase 2: multi-party venue encounters) ---
  private buildMeetingView(): MeetingView {
    const topicsByActor: Record<string, EncounterTopic[]> = {};
    const participants = this.meetingParticipants.map((actorId) => {
      const actor = this.actorsById.get(actorId)!;
      topicsByActor[actorId] = this.topicsForActor(actor);
      return {
        actorId,
        name: actor.name,
        role: actor.role,
        paletteIndex: this.currentNode().present_actors.indexOf(actorId) % 4,
      };
    });
    return { participants, activeActorId: this.meetingActiveActorId!, topicsByActor };
  }

  startMeeting(actorIds: string[]): MeetingView {
    this.assertActive();
    if (this.internalMode !== "roaming") throw new Error("cannot start a meeting outside roaming");
    if (actorIds.length === 0) throw new Error("a meeting requires at least one participant");
    // Participants must be present in the CURRENT node, not merely exist in the world:
    // paletteIndex derives from present_actors order, so a world-valid-but-absent actor
    // would silently yield paletteIndex -1 (indexOf miss). Fail loudly instead — a wrong
    // node/venue mapping in the trigger wiring should be a debuggable throw, not bad art.
    const present = new Set(this.currentNode().present_actors);
    for (const id of actorIds) {
      if (!this.actorsById.has(id)) throw new Error(`unknown actor "${id}"`);
      if (!present.has(id)) throw new Error(`"${id}" is not present in node "${this.currentNodeId}"`);
    }
    // Duplicate ids are rejected (not deduped): a duplicated id means the caller's
    // seating data is wrong, and silently collapsing it would mask that bug the same
    // way a silent -1 paletteIndex would.
    if (new Set(actorIds).size !== actorIds.length) throw new Error("duplicate actor ids in meeting participants");
    this.meetingParticipants = [...actorIds];
    this.meetingActiveActorId = actorIds[0];
    this.internalMode = "meeting";
    return this.buildMeetingView();
  }

  meetingState(): MeetingView | null {
    if (this.internalMode !== "meeting") return null;
    return this.buildMeetingView();
  }

  meetingAsk(actorId: string, factId: string): { line: string } {
    this.assertActive();
    if (this.internalMode !== "meeting") throw new Error("no meeting in progress");
    if (!this.meetingParticipants.includes(actorId)) throw new Error(`"${actorId}" is not a meeting participant`);
    const actor = this.actorsById.get(actorId)!;
    const topic = this.topicsForActor(actor).find((t) => t.factId === factId);
    if (!topic || topic.asked) throw new Error(`"${factId}" is not an open topic for "${actorId}"`);
    const dialogueTopic = actor.dialogue?.topics?.find((t) => t.fact_id === factId);
    const fact = this.worldRef.facts.find((f) => f.id === factId);
    const line = dialogueTopic?.line ?? (fact ? `${fact.label}: ${fact.content}` : factId);
    this.gathered.add(factId);
    return { line };
  }

  meetingSetActive(actorId: string): void {
    this.assertActive();
    if (this.internalMode !== "meeting") throw new Error("no meeting in progress");
    if (!this.meetingParticipants.includes(actorId)) throw new Error(`"${actorId}" is not a meeting participant`);
    this.meetingActiveActorId = actorId;
  }

  meetingWrapUp(): void {
    this.assertActive();
    if (this.internalMode !== "meeting") throw new Error("no meeting in progress");
    this.internalMode = "roaming";
    this.meetingParticipants = [];
    this.meetingActiveActorId = null;
  }

  pollDecisionPrompt(): boolean {
    // Decisions never prompt while an encounter/decision/meeting overlay is up, or
    // mid-traversal — only once the session is plainly roaming (or traversing, which is
    // handled by the traversal check below).
    if (this.internalMode !== "roaming") return false;
    if (this.traversal) return false; // decisions never prompt mid-traversal
    if (this.decisionPrompted) return false;
    const first = this.liveDecisions()[0];
    if (!first || !this.isDecisionUnlocked(first.id)) return false;
    this.decisionPrompted = true;
    return true;
  }

  startDecision(decisionId: string): void {
    this.assertActive();
    if (this.traversal) throw new Error("cannot start a decision while traversing");
    if (this.internalMode !== "roaming") throw new Error("cannot start a decision outside roaming");
    if (!this.currentNode().live_decisions.includes(decisionId)) throw new Error(`decision "${decisionId}" is not live here`);
    if (!this.isDecisionUnlocked(decisionId)) throw new Error(`decision "${decisionId}" is locked`);
    this.internalMode = "decision";
  }

  cancelDecision(): void {
    this.assertActive();
    if (this.internalMode !== "decision") throw new Error("no decision in progress");
    this.internalMode = "roaming";
  }

  // --- actions ---
  private assertActive(): void {
    if (this.endingId !== null) throw new Error("the game has ended");
  }

  moveTo(locationId: string): void {
    this.assertActive();
    const current = this.locationsById.get(this.locationId)!;
    const accessible = this.walkableLocationIds().includes(locationId);
    const connected = current.exits.includes(locationId);
    if (!accessible || !connected) {
      throw new Error(`cannot move to "${locationId}" from "${this.locationId}"`);
    }
    this.locationId = locationId;
    if (this.traversal && locationId === this.traversal.targetLocationId) {
      this.arriveAtNextNode();
    }
  }

  // Arrival at the traversal target: activates node N+1 exactly like the pre-traversal
  // teleport did (roaming, visited/decisionPrompted reset), plus records the one-shot
  // sceneActivation transition for pollSceneActivation().
  private arriveAtNextNode(): void {
    const fromNodeId = this.currentNodeId;
    const toNodeId = this.traversal!.toNodeId;
    this.currentNodeId = toNodeId;
    this.internalMode = "roaming";
    this.traversal = null;
    this.visited.clear();
    this.decisionPrompted = false;
    this.sceneActivation = { fromNodeId, toNodeId };
  }

  gatherFactsFromActor(actorId: string): { greeting?: string; revealed: { factId: string; line: string }[] } {
    this.assertActive();
    const actor = this.actorsById.get(actorId);
    if (!actor) throw new Error(`unknown actor ${actorId}`);
    const available = new Set(this.currentNode().available_facts);
    const revealed: { factId: string; line: string }[] = [];
    for (const factId of actor.knowledge) {
      if (!available.has(factId)) continue;
      const topic = actor.dialogue?.topics?.find((t) => t.fact_id === factId);
      const fact = this.worldRef.facts.find((f) => f.id === factId);
      const line = topic?.line ?? (fact ? `${fact.label}: ${fact.content}` : factId);
      revealed.push({ factId, line });
      this.gathered.add(factId);
    }
    return { greeting: actor.dialogue?.greeting, revealed };
  }

  gatherFactFromLocation(factId: string): void {
    this.assertActive();
    const fact = this.worldRef.facts.find((f) => f.id === factId);
    if (!fact) throw new Error(`unknown fact ${factId}`);
    const availableHere = this.currentNode().available_facts.includes(factId);
    const sourcedHere = fact.sources.some((s) => s.location_id === this.locationId);
    if (!availableHere || !sourcedHere) {
      throw new Error(`fact "${factId}" is not investigable at "${this.locationId}"`);
    }
    this.gathered.add(factId);
  }

  // --- decisions + terminal ---
  chooseOption(decisionId: string, optionId: string, reasoning: string): { endedAt: "node" | "ending" } {
    this.assertActive();
    if (this.internalMode !== "decision") throw new Error("no decision in progress");
    const node = this.currentNode();
    if (!node.live_decisions.includes(decisionId)) throw new Error(`decision "${decisionId}" is not live here`);
    if (!this.isDecisionUnlocked(decisionId)) throw new Error(`decision "${decisionId}" is locked`);
    const decision = this.decisionsById.get(decisionId)!;
    const option = decision.options.find((o) => o.id === optionId);
    if (!option) throw new Error(`unknown option "${optionId}"`);
    this.choices.push({ decisionId, optionId, reasoning });
    if (this.endingsById.has(option.leads_to)) {
      this.endingId = option.leads_to;
      return { endedAt: "ending" };
    }
    const completedNode = node;
    const nextNode = this.nodesById.get(option.leads_to)!;
    const venue = venueLocationId(this.worldRef, nextNode);
    if (!venue) {
      // Fallback rule: no venue-typed location in the next node (e.g. pre-traversal worlds
      // like wholesale-offer) → keep the original immediate-teleport behavior unchanged.
      this.currentNodeId = nextNode.id;
      this.locationId = nextNode.accessible_locations[0];
      this.internalMode = "roaming";
      this.visited.clear();
      this.decisionPrompted = false;
    } else if (this.locationId === venue) {
      // Defensive edge case: the player already happens to be standing on the next node's
      // venue location (e.g. a shared location id across nodes) — arrive immediately rather
      // than requiring a no-op moveTo that would never come.
      this.currentNodeId = nextNode.id;
      this.internalMode = "roaming";
      this.visited.clear();
      this.decisionPrompted = false;
      this.sceneActivation = { fromNodeId: completedNode.id, toNodeId: nextNode.id };
    } else {
      this.traversal = {
        toNodeId: nextNode.id,
        targetLocationId: venue,
        nextAccessibleLocations: [...nextNode.accessible_locations],
      };
      // Underneath, the player keeps roaming the completed node's (extended) world;
      // mode() derives "traversing" from the pending traversal.
      this.internalMode = "roaming";
    }
    return { endedAt: "node" };
  }

  isEnded(): boolean { return this.endingId !== null; }
  currentEnding(): Ending | null { return this.endingId ? this.endingsById.get(this.endingId) ?? null : null; }
  history(): ChoiceRecord[] { return [...this.choices]; }

  debrief(): DebriefData | null {
    const ending = this.currentEnding();
    if (!ending) return null;
    const objectives = ending.lo_outcomes.map((o) => ({
      objective: this.loById.get(o.lo_id)!,
      verdict: o.verdict,
    }));
    const choices = this.choices.map((c) => {
      const decision = this.decisionsById.get(c.decisionId)!;
      const option = decision.options.find((o) => o.id === c.optionId)!;
      return { prompt: decision.prompt, chosenLabel: option.label, reasoning: c.reasoning };
    });
    return { ending, objectives, choices };
  }
}
