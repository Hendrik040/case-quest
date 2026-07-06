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

export function validateWorld(input: unknown): ValidationResult {
  const parsed = WorldSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: mapZodIssues(parsed.error), warnings: [] };
  }
  const world: World = parsed.data;
  // Layer 2 checks are added in later tasks:
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  return { ok: errors.length === 0, errors, warnings };
}
