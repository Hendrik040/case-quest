import { z } from "zod";
import {
  WorldSchema, WorldMetaSchema, ProvenanceSchema, LearningObjectiveSchema,
  ActorSchema, PersonaSchema, ActorDialogueSchema, SpriteHintsSchema, ActorRoleSchema,
  LocationSchema, FactSchema, FactSourceSchema, DecisionSchema, DecisionOptionSchema,
  StoryNodeSchema, EndingSchema, LOCATION_TYPES,
} from "./schema";

export type World = z.infer<typeof WorldSchema>;
export type WorldMeta = z.infer<typeof WorldMetaSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type LearningObjective = z.infer<typeof LearningObjectiveSchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type Persona = z.infer<typeof PersonaSchema>;
export type ActorDialogue = z.infer<typeof ActorDialogueSchema>;
export type SpriteHints = z.infer<typeof SpriteHintsSchema>;
export type ActorRole = z.infer<typeof ActorRoleSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type FactSource = z.infer<typeof FactSourceSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;
export type StoryNode = z.infer<typeof StoryNodeSchema>;
export type Ending = z.infer<typeof EndingSchema>;
export type LocationType = (typeof LOCATION_TYPES)[number];
