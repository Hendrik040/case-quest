export interface EnginePayloads {
  "interact:actor": { actorId: string };
  "interact:fact": { factId: string };
  "location:changed": { locationId: string };
  "scene:render": Record<string, never>;
  "world:freeze": { frozen: boolean };
  // Emitted by WorldScene when the player walks into a boardroom/venue
  // triggerZone tile, or presses Space/interact facing the table — actorIds
  // are the node's seated actors at that venue (resolveSeating), in
  // present_actors order. Phase 2 (App/meeting overlay) consumes this; until
  // then it's fine for nothing to be listening.
  "encounter:meeting:start": { actorIds: string[] };
  // Emitted (Task 2.3+) when GameSession.pollSceneActivation() reports a
  // traversal→next-node transition, mirroring SceneActivation's shape.
  "scene:activate": { fromNodeId: string; toNodeId: string };
}
export type EngineEvent = keyof EnginePayloads;
type Handler<E extends EngineEvent> = (payload: EnginePayloads[E]) => void;

export class EventBus {
  private handlers = new Map<EngineEvent, Set<Handler<EngineEvent>>>();

  on<E extends EngineEvent>(event: E, handler: Handler<E>): () => void {
    let set = this.handlers.get(event);
    if (!set) { set = new Set(); this.handlers.set(event, set); }
    set.add(handler as Handler<EngineEvent>);
    return () => { set!.delete(handler as Handler<EngineEvent>); };
  }

  emit<E extends EngineEvent>(event: E, payload: EnginePayloads[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of set) (h as Handler<E>)(payload);
  }
}
