import { z } from "zod";

/** The one and only source of truth for the schema version. */
export const SCHEMA_VERSION = "0.1" as const;

export const LOCATION_TYPES = [
  "office", "boardroom", "factory_floor", "shopfront",
  "warehouse", "client_site", "street", "home",
] as const;

export const ActorRoleSchema = z.enum(["protagonist", "npc"]);

export const PersonaSchema = z.object({
  background: z.string(),
  personality: z.string(),
  communication_style: z.string(),
});

export const ActorDialogueSchema = z.object({
  greeting: z.string().optional(),
  topics: z.array(z.object({ fact_id: z.string(), line: z.string() })).optional(),
});

export const SpriteHintsSchema = z.object({
  palette: z.string().optional(),
  label: z.string().optional(),
});

export const ActorSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: ActorRoleSchema,
  is_playable: z.boolean(),
  persona: PersonaSchema,
  goals: z.array(z.string()),
  knowledge: z.array(z.string()),
  dialogue: ActorDialogueSchema.optional(),
  sprite: SpriteHintsSchema.optional(),
});

export const LocationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(LOCATION_TYPES),
  exits: z.array(z.string()),
  art: z.object({ palette: z.string().optional() }).optional(),
});

export const FactSourceSchema = z.object({
  actor_id: z.string().optional(),
  location_id: z.string().optional(),
});

export const FactSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  content: z.string(),
  sources: z.array(FactSourceSchema),
});

export const DecisionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  consequence_text: z.string(),
  illuminates: z.array(z.string()),
  leads_to: z.string().min(1),
});

export const DecisionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  requires_facts: z.array(z.string()),
  options: z.array(DecisionOptionSchema).min(1),
});

export const StoryNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  accessible_locations: z.array(z.string()),
  present_actors: z.array(z.string()),
  available_facts: z.array(z.string()),
  live_decisions: z.array(z.string()),
});

export const EndingSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  real_case_comparison: z.string(),
  lo_outcomes: z.array(z.object({ lo_id: z.string(), verdict: z.string() })),
});

export const LearningObjectiveSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
});

export const ProvenanceSchema = z.object({
  pipeline_version: z.string().optional(),
  extraction_model: z.string().optional(),
  generated_at: z.string().optional(),
  token_usage: z.object({
    input: z.number(),
    output: z.number(),
    total: z.number().optional(),
  }).optional(),
});

export const WorldMetaSchema = z.object({
  case_id: z.string().min(1),
  title: z.string(),
  synopsis: z.string(),
  protagonist_actor_id: z.string().min(1),
  start_node_id: z.string().min(1),
  source_ref: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
});

export const WorldSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  meta: WorldMetaSchema,
  learning_objectives: z.array(LearningObjectiveSchema),
  actors: z.array(ActorSchema),
  locations: z.array(LocationSchema),
  facts: z.array(FactSchema),
  decisions: z.array(DecisionSchema),
  nodes: z.array(StoryNodeSchema),
  endings: z.array(EndingSchema),
});
