import type {
  World, StoryNode, Location, Actor, Decision, LearningObjective, Ending,
} from "@case-quest/schema";
import { resolvePlacement } from "./placement";

export interface ChoiceRecord { decisionId: string; optionId: string; reasoning: string; }
export interface DebriefData {
  ending: Ending;
  objectives: { objective: LearningObjective; verdict: string }[];
  choices: { prompt: string; chosenLabel: string; reasoning: string }[];
}

export type SessionMode = "roaming" | "encounter" | "decision" | "debrief";
export interface EncounterTopic { factId: string; label: string; asked: boolean; }
export interface EncounterView {
  actorId: string; name: string; role: string; greeting?: string;
  topics: EncounterTopic[]; chainIndex: number; chainLength: number;
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

  private internalMode: "roaming" | "encounter" | "decision" = "roaming";
  private chain: string[] = [];
  private chainIdx = 0;
  private readonly visited = new Set<string>();
  private decisionPrompted = false;

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
    return this.currentNode().accessible_locations.map((id) => this.locationsById.get(id)!).filter(Boolean);
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
  mode(): SessionMode { return this.isEnded() ? "debrief" : this.internalMode; }

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

  pollDecisionPrompt(): boolean {
    if (this.decisionPrompted) return false;
    const first = this.liveDecisions()[0];
    if (!first || !this.isDecisionUnlocked(first.id)) return false;
    this.decisionPrompted = true;
    return true;
  }

  startDecision(decisionId: string): void {
    this.assertActive();
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
    const node = this.currentNode();
    const current = this.locationsById.get(this.locationId)!;
    const accessible = node.accessible_locations.includes(locationId);
    const connected = current.exits.includes(locationId);
    if (!accessible || !connected) {
      throw new Error(`cannot move to "${locationId}" from "${this.locationId}"`);
    }
    this.locationId = locationId;
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
    this.currentNodeId = option.leads_to;
    this.locationId = this.currentNode().accessible_locations[0];
    this.internalMode = "roaming";
    this.visited.clear();
    this.decisionPrompted = false;
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
