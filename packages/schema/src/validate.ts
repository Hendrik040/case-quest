import { z } from "zod";
import { WorldSchema, LOCATION_TYPES } from "./schema";
import type { World } from "./types";
import { buildNodeGraph, reachableFrom } from "./graph";

export type IssueCode =
  | "shape_invalid"
  | "unknown_location_type"
  | "duplicate_id"
  | "dangling_ref"
  | "protagonist_invalid"
  | "fact_source_empty"
  | "knowledge_mismatch"
  | "start_missing"
  | "no_ending"
  | "graph_cyclic"
  | "unreachable_node"
  | "dead_end_node"
  | "fact_unsolvable"
  | "fact_unobtainable"
  | "route_location_missing"
  | "route_location_invalid_type"
  | "route_unreachable"
  | "objective_unused"
  | "actor_reveals_nothing"
  | "fact_unused";

export interface Issue { code: IssueCode; message: string; path?: string; }
export interface ValidationResult { ok: boolean; errors: Issue[]; warnings: Issue[]; }

function mapZodIssues(err: z.ZodError): Issue[] {
  return err.issues.map((iss): Issue => {
    const path = iss.path.join(".");
    if (iss.code === "invalid_enum_value" && iss.path[0] === "locations" && iss.path[iss.path.length - 1] === "type") {
      return {
        code: "unknown_location_type",
        message: `Unknown location.type at ${path}. Valid types: ${LOCATION_TYPES.join(", ")}.`,
        path,
      };
    }
    return { code: "shape_invalid", message: path ? `${path}: ${iss.message}` : iss.message, path };
  });
}

function checkDuplicateIds(world: World): Issue[] {
  const issues: Issue[] = [];
  const collections: [string, { id: string }[]][] = [
    ["actors", world.actors],
    ["locations", world.locations],
    ["facts", world.facts],
    ["decisions", world.decisions],
    ["learning_objectives", world.learning_objectives],
  ];
  for (const [name, items] of collections) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id)) issues.push({ code: "duplicate_id", message: `Duplicate id "${item.id}" in ${name}.`, path: name });
      seen.add(item.id);
    }
  }
  for (const d of world.decisions) {
    const seen = new Set<string>();
    for (const o of d.options) {
      if (seen.has(o.id)) issues.push({ code: "duplicate_id", message: `Duplicate option id "${o.id}" in decision "${d.id}".`, path: `decisions.${d.id}.options` });
      seen.add(o.id);
    }
  }
  const nodeEndingSeen = new Set<string>();
  for (const n of world.nodes) {
    if (nodeEndingSeen.has(n.id)) issues.push({ code: "duplicate_id", message: `Duplicate node/ending id "${n.id}".`, path: "nodes" });
    nodeEndingSeen.add(n.id);
  }
  for (const e of world.endings) {
    if (nodeEndingSeen.has(e.id)) issues.push({ code: "duplicate_id", message: `Duplicate node/ending id "${e.id}".`, path: "endings" });
    nodeEndingSeen.add(e.id);
  }
  return issues;
}

function checkReferences(world: World): Issue[] {
  const issues: Issue[] = [];
  const actorIds = new Set(world.actors.map((a) => a.id));
  const locationIds = new Set(world.locations.map((l) => l.id));
  const factIds = new Set(world.facts.map((f) => f.id));
  const loIds = new Set(world.learning_objectives.map((o) => o.id));
  const decisionIds = new Set(world.decisions.map((d) => d.id));
  const nodeIds = new Set(world.nodes.map((n) => n.id));
  const endingIds = new Set(world.endings.map((e) => e.id));
  const nodeOrEnding = new Set([...nodeIds, ...endingIds]);

  const ref = (ok: boolean, msg: string, path: string) => { if (!ok) issues.push({ code: "dangling_ref", message: msg, path }); };

  ref(actorIds.has(world.meta.protagonist_actor_id), `meta.protagonist_actor_id "${world.meta.protagonist_actor_id}" does not match any actor.`, "meta.protagonist_actor_id");

  for (const a of world.actors) {
    for (const fid of a.knowledge) ref(factIds.has(fid), `actor "${a.id}" knowledge references unknown fact "${fid}".`, `actors.${a.id}.knowledge`);
    for (const t of a.dialogue?.topics ?? []) ref(factIds.has(t.fact_id), `actor "${a.id}" dialogue topic references unknown fact "${t.fact_id}".`, `actors.${a.id}.dialogue`);
  }
  for (const l of world.locations) for (const ex of l.exits) ref(locationIds.has(ex), `location "${l.id}" exit references unknown location "${ex}".`, `locations.${l.id}.exits`);
  for (const f of world.facts) for (const s of f.sources) {
    if (s.actor_id !== undefined) ref(actorIds.has(s.actor_id), `fact "${f.id}" source references unknown actor "${s.actor_id}".`, `facts.${f.id}.sources`);
    if (s.location_id !== undefined) ref(locationIds.has(s.location_id), `fact "${f.id}" source references unknown location "${s.location_id}".`, `facts.${f.id}.sources`);
  }
  for (const d of world.decisions) {
    for (const fid of d.requires_facts) ref(factIds.has(fid), `decision "${d.id}" requires unknown fact "${fid}".`, `decisions.${d.id}.requires_facts`);
    for (const o of d.options) {
      for (const lo of o.illuminates) ref(loIds.has(lo), `option "${o.id}" illuminates unknown objective "${lo}".`, `decisions.${d.id}.options.${o.id}.illuminates`);
      ref(nodeOrEnding.has(o.leads_to), `option "${o.id}" leads_to unknown node/ending "${o.leads_to}".`, `decisions.${d.id}.options.${o.id}.leads_to`);
    }
  }
  for (const n of world.nodes) {
    for (const lid of n.accessible_locations) ref(locationIds.has(lid), `node "${n.id}" accessible_locations references unknown location "${lid}".`, `nodes.${n.id}.accessible_locations`);
    for (const aid of n.present_actors) ref(actorIds.has(aid), `node "${n.id}" present_actors references unknown actor "${aid}".`, `nodes.${n.id}.present_actors`);
    for (const fid of n.available_facts) ref(factIds.has(fid), `node "${n.id}" available_facts references unknown fact "${fid}".`, `nodes.${n.id}.available_facts`);
    for (const did of n.live_decisions) ref(decisionIds.has(did), `node "${n.id}" live_decisions references unknown decision "${did}".`, `nodes.${n.id}.live_decisions`);
  }
  for (const e of world.endings) for (const o of e.lo_outcomes) ref(loIds.has(o.lo_id), `ending "${e.id}" lo_outcomes references unknown objective "${o.lo_id}".`, `endings.${e.id}.lo_outcomes`);
  return issues;
}

function checkProtagonist(world: World): Issue[] {
  const issues: Issue[] = [];
  const protagonists = world.actors.filter((a) => a.role === "protagonist");
  if (protagonists.length !== 1) issues.push({ code: "protagonist_invalid", message: `Expected exactly one actor with role "protagonist", found ${protagonists.length}.`, path: "actors" });
  const p = world.actors.find((a) => a.id === world.meta.protagonist_actor_id);
  if (p) {
    if (p.role !== "protagonist") issues.push({ code: "protagonist_invalid", message: `meta.protagonist_actor_id "${p.id}" has role "${p.role}", expected "protagonist".`, path: "meta.protagonist_actor_id" });
    if (!p.is_playable) issues.push({ code: "protagonist_invalid", message: `Protagonist "${p.id}" must have is_playable: true.`, path: `actors.${p.id}.is_playable` });
  }
  return issues;
}

function checkFactSources(world: World): Issue[] {
  const issues: Issue[] = [];
  const actorById = new Map(world.actors.map((a) => [a.id, a]));
  for (const f of world.facts) {
    for (const s of f.sources) {
      if (s.actor_id === undefined && s.location_id === undefined) {
        issues.push({ code: "fact_source_empty", message: `fact "${f.id}" has a source with neither actor_id nor location_id.`, path: `facts.${f.id}.sources` });
      }
      if (s.actor_id !== undefined) {
        const a = actorById.get(s.actor_id);
        if (a && !a.knowledge.includes(f.id)) issues.push({ code: "knowledge_mismatch", message: `fact "${f.id}" lists actor "${s.actor_id}" as a source, but that actor's knowledge does not include it.`, path: `facts.${f.id}.sources` });
      }
    }
  }
  return issues;
}

function checkStartAndEndings(world: World): Issue[] {
  const issues: Issue[] = [];
  const nodeIds = new Set(world.nodes.map((n) => n.id));
  if (!nodeIds.has(world.meta.start_node_id)) issues.push({ code: "start_missing", message: `meta.start_node_id "${world.meta.start_node_id}" does not match any node.`, path: "meta.start_node_id" });
  if (world.endings.length === 0) issues.push({ code: "no_ending", message: `World has no endings; at least one is required.`, path: "endings" });
  return issues;
}

function checkGraph(world: World): Issue[] {
  const issues: Issue[] = [];
  const { nodeIds, endingIds, edges } = buildNodeGraph(world);

  for (const n of world.nodes) {
    const outs = edges.get(n.id) ?? [];
    if (outs.length === 0) issues.push({ code: "dead_end_node", message: `node "${n.id}" has no live decision leading onward (dead end).`, path: `nodes.${n.id}` });
  }

  if (nodeIds.has(world.meta.start_node_id)) {
    const reached = reachableFrom(world.meta.start_node_id, edges);
    for (const id of [...nodeIds, ...endingIds]) {
      if (!reached.has(id)) issues.push({ code: "unreachable_node", message: `node/ending "${id}" is not reachable from start "${world.meta.start_node_id}".`, path: "nodes" });
    }
  }

  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, WHITE);
  const dfs = (id: string): boolean => {
    color.set(id, GREY);
    for (const next of edges.get(id) ?? []) {
      if (!nodeIds.has(next)) continue; // endings are sinks
      const c = color.get(next);
      if (c === GREY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const id of nodeIds) {
    if (color.get(id) === WHITE && dfs(id)) {
      issues.push({ code: "graph_cyclic", message: `The story node graph contains a cycle (beats must move forward).`, path: "nodes" });
      break;
    }
  }
  return issues;
}

// Traversal semantics (M5 meeting encounters): route_locations connect a node's venue
// to the next node's venue on foot. Opt-in — only nodes that declare route_locations
// are subject to the reachability check below.
//
// Three-way parity mirror: this rule must be ported to n-aible
// `backend/modules/world_generation/validation.py` (Phase 4) and is consumed by
// `packages/engine/src/state/placement.ts`, which resolves route_locations into a
// node's walkable accessible set during traversal.
const OUTDOOR_ROUTE_TYPES = ["street", "shopfront", "client_site"] as const;

function checkRouteLocations(world: World): Issue[] {
  const issues: Issue[] = [];
  const locationById = new Map(world.locations.map((l) => [l.id, l]));
  const nodeById = new Map(world.nodes.map((n) => [n.id, n]));
  const decisionById = new Map(world.decisions.map((d) => [d.id, d]));

  const locationEdges = new Map(world.locations.map((l) => [l.id, l.exits]));
  const reachableLocations = (seeds: Iterable<string>): Set<string> => {
    const seen = new Set<string>(seeds);
    const stack = [...seen];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const next of locationEdges.get(cur) ?? []) {
        if (!seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    return seen;
  };

  for (const n of world.nodes) {
    const routeLocs = n.route_locations ?? [];
    for (const lid of routeLocs) {
      const loc = locationById.get(lid);
      if (!loc) {
        issues.push({ code: "route_location_missing", message: `node "${n.id}" route_locations references unknown location "${lid}".`, path: `nodes.${n.id}.route_locations` });
        continue;
      }
      if (!(OUTDOOR_ROUTE_TYPES as readonly string[]).includes(loc.type)) {
        issues.push({ code: "route_location_invalid_type", message: `node "${n.id}" route_locations location "${lid}" has type "${loc.type}", expected an outdoor type (${OUTDOOR_ROUTE_TYPES.join(", ")}).`, path: `nodes.${n.id}.route_locations` });
      }
    }

    if (routeLocs.length === 0) continue; // traversal semantics are opt-in

    const reached = reachableLocations([...n.accessible_locations, ...routeLocs]);
    for (const did of n.live_decisions) {
      const d = decisionById.get(did);
      if (!d) continue;
      for (const o of d.options) {
        const nextNode = nodeById.get(o.leads_to);
        if (!nextNode) continue; // endings have no venue; dangling refs reported elsewhere
        const venueReachable = nextNode.accessible_locations.some((lid) => reached.has(lid));
        if (!venueReachable) {
          issues.push({
            code: "route_unreachable",
            message: `node "${n.id}" declares route_locations but none connect (via exits) to node "${o.leads_to}"'s accessible_locations; the next venue is unreachable from "${n.id}".`,
            path: `nodes.${n.id}.route_locations`,
          });
        }
      }
    }
  }
  return issues;
}

function checkFactSolvability(world: World): Issue[] {
  const issues: Issue[] = [];
  const { nodeIds, edges } = buildNodeGraph(world);
  const start = world.meta.start_node_id;
  if (!nodeIds.has(start)) return issues; // start_missing reported elsewhere

  const decisionById = new Map(world.decisions.map((d) => [d.id, d]));
  const factById = new Map(world.facts.map((f) => [f.id, f]));

  // Mirrors the engine's placement resolution: a fact is gatherable in a node
  // iff the node lists it in available_facts AND at least one of its sources
  // is reachable there — a source location in accessible_locations ∪
  // route_locations (fact spot; route locations count as in-node-accessible per
  // the traversal mirror above) or a source actor in present_actors (dialogue).
  //
  // Three-way parity mirror: route_locations inclusion here must be ported to
  // n-aible `backend/modules/world_generation/validation.py` (Phase 4) and
  // matches `packages/engine/src/state/placement.ts`'s gathering resolution.
  const gatherableAt = (n: World["nodes"][number], fid: string): boolean => {
    if (!n.available_facts.includes(fid)) return false;
    const f = factById.get(fid);
    if (!f) return false;
    const locations = new Set([...n.accessible_locations, ...(n.route_locations ?? [])]);
    const actors = new Set(n.present_actors);
    return f.sources.some(
      (s) =>
        (s.location_id !== undefined && locations.has(s.location_id)) ||
        (s.actor_id !== undefined && actors.has(s.actor_id)),
    );
  };

  const providers = new Map<string, Set<string>>();
  for (const n of world.nodes) for (const fid of n.available_facts) {
    if (!gatherableAt(n, fid)) continue;
    if (!providers.has(fid)) providers.set(fid, new Set());
    providers.get(fid)!.add(n.id);
  }

  for (const n of world.nodes) {
    for (const did of n.live_decisions) {
      const d = decisionById.get(did);
      if (!d) continue;
      for (const fid of d.requires_facts) {
        const provs = providers.get(fid) ?? new Set<string>();
        if (provs.has(n.id)) continue; // gatherable at the decision's own node
        // If n is still reachable with all provider nodes removed, some path avoids the fact.
        const reachedAvoiding = reachableFrom(start, edges, provs);
        if (!reachedAvoiding.has(n.id)) continue; // every path passes a provider
        if (n.available_facts.includes(fid)) {
          issues.push({
            code: "fact_unobtainable",
            message: `decision "${d.id}" in node "${n.id}" requires fact "${fid}", which is listed in the node's available_facts but cannot be gathered there — no source actor is in present_actors and no source location is in accessible_locations or route_locations.`,
            path: `nodes.${n.id}.live_decisions`,
          });
        } else {
          issues.push({
            code: "fact_unsolvable",
            message: `decision "${d.id}" in node "${n.id}" requires fact "${fid}", but that fact is not guaranteed discoverable on every path to "${n.id}" — a player could reach the decision without it.`,
            path: `nodes.${n.id}.live_decisions`,
          });
        }
      }
    }
  }
  return issues;
}

function checkWarnings(world: World): Issue[] {
  const issues: Issue[] = [];

  const illuminated = new Set<string>();
  for (const d of world.decisions) for (const o of d.options) for (const lo of o.illuminates) illuminated.add(lo);
  for (const e of world.endings) for (const o of e.lo_outcomes) illuminated.add(o.lo_id);
  for (const o of world.learning_objectives) {
    if (!illuminated.has(o.id)) issues.push({ code: "objective_unused", message: `learning objective "${o.id}" is not illuminated by any option or ending.`, path: `learning_objectives.${o.id}` });
  }

  const requiredFacts = new Set<string>();
  for (const d of world.decisions) for (const fid of d.requires_facts) requiredFacts.add(fid);
  for (const f of world.facts) {
    if (!requiredFacts.has(f.id)) issues.push({ code: "fact_unused", message: `fact "${f.id}" is required by no decision.`, path: `facts.${f.id}` });
  }

  const actorById = new Map(world.actors.map((a) => [a.id, a]));
  for (const n of world.nodes) {
    const avail = new Set(n.available_facts);
    for (const aid of n.present_actors) {
      const a = actorById.get(aid);
      if (!a) continue;
      const revealsSomething = a.knowledge.some((fid) => avail.has(fid));
      if (!revealsSomething) issues.push({ code: "actor_reveals_nothing", message: `actor "${aid}" is present in node "${n.id}" but can reveal none of its available_facts.`, path: `nodes.${n.id}.present_actors` });
    }
  }
  return issues;
}

export function validateWorld(input: unknown): ValidationResult {
  const parsed = WorldSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: mapZodIssues(parsed.error), warnings: [] };
  }
  const world: World = parsed.data;
  const errors: Issue[] = [
    ...checkDuplicateIds(world),
    ...checkReferences(world),
    ...checkProtagonist(world),
    ...checkFactSources(world),
    ...checkStartAndEndings(world),
    ...checkGraph(world),
    ...checkRouteLocations(world),
    ...checkFactSolvability(world),
  ];
  const warnings: Issue[] = [...checkWarnings(world)];
  return { ok: errors.length === 0, errors, warnings };
}
