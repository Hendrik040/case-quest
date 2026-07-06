import type { World } from "./types";

export interface NodeGraph {
  nodeIds: Set<string>;
  endingIds: Set<string>;
  edges: Map<string, string[]>; // story node id -> target ids (node or ending)
}

export function buildNodeGraph(world: World): NodeGraph {
  const nodeIds = new Set(world.nodes.map((n) => n.id));
  const endingIds = new Set(world.endings.map((e) => e.id));
  const decisionById = new Map(world.decisions.map((d) => [d.id, d]));
  const edges = new Map<string, string[]>();
  for (const n of world.nodes) {
    const targets: string[] = [];
    for (const did of n.live_decisions) {
      const d = decisionById.get(did);
      if (!d) continue;
      for (const o of d.options) targets.push(o.leads_to);
    }
    edges.set(n.id, targets);
  }
  return { nodeIds, endingIds, edges };
}

export function reachableFrom(start: string, edges: Map<string, string[]>, skip: Set<string> = new Set()): Set<string> {
  const seen = new Set<string>();
  if (skip.has(start)) return seen;
  seen.add(start);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const next of edges.get(cur) ?? []) {
      if (skip.has(next) || seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}
