import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { validateWorld, WorldSchema, type World } from "@case-quest/schema";
import {
  App,
  type CaseQuestCallbacks,
  type EncounterChatCallback,
  type EncounterChatChunk,
  type EncounterChatMessage,
  type GradePayload,
  type SceneWrapUpResult,
} from "./App";
import "./ui/pixel/theme.css";

// Re-exported for host implementers (the n-aible Next embed's adapter, Task
// 3.3) who need to name these sub-shapes directly — e.g. to type a real
// `onFinalGrade(): Promise<GradePayload>` implementation — not just consume
// them structurally through `CaseQuestCallbacks`.
export type {
  CaseQuestCallbacks,
  EncounterChatCallback,
  EncounterChatChunk,
  EncounterChatMessage,
  GradePayload,
  SceneWrapUpResult,
};
export interface CaseQuestHandle { unmount(): void; }

export function mountCaseQuest(el: HTMLElement, world: unknown, callbacks?: CaseQuestCallbacks): CaseQuestHandle {
  const result = validateWorld(world);
  if (!result.ok) {
    throw new Error(
      "invalid world: " + result.errors.map((e) => `[${e.code}] ${e.path ?? ""} ${e.message}`).join("; ")
    );
  }
  // validateWorld only reports; parse for the typed object App/GameSession use.
  const parsed: World = WorldSchema.parse(world);
  const root: Root = createRoot(el);
  root.render(createElement(App, { world: parsed, callbacks }));
  return { unmount: () => root.unmount() };
}
