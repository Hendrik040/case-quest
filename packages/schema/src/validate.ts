import { z } from "zod";
import { WorldSchema, LOCATION_TYPES } from "./schema";
import type { World } from "./types";

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
  ];
  const warnings: Issue[] = [];
  return { ok: errors.length === 0, errors, warnings };
}
