import { useMemo, useState } from "react";
import type { DebriefData } from "../../state/session";
import type { GradePayload } from "../../App";
import { MessageBox } from "./MessageBox";
import { Typewriter } from "./Typewriter";

/**
 * Builds the ordered reel of battle-skin typewriter "beats" for a debrief:
 * ending title -> summary -> "What actually happened" + the real-case
 * comparison -> one beat per choice (its prompt, the chosen label, and the
 * player's own reasoning) -> one beat per learning objective (its text and
 * verdict). Each beat is handed to `Typewriter` as a single string; long
 * beats simply paginate across more than one typed page (via `paginate`),
 * same as any other message-box text in the kit.
 */
function buildBeats(data: DebriefData): string[] {
  const choiceBeats = data.choices.map(
    (c) => `${c.prompt} You chose: ${c.chosenLabel}. ${c.reasoning}`,
  );
  const objectiveBeats = data.objectives.map((o) => `${o.objective.text} ${o.verdict}`);
  return [
    data.ending.title,
    data.ending.summary,
    `What actually happened: ${data.ending.real_case_comparison}`,
    ...choiceBeats,
    ...objectiveBeats,
  ];
}

/**
 * The post-ending debrief: a chain of battle-skin typewriter pages (advanced
 * by the player exactly like any other `Typewriter`, via Space/Enter/click)
 * followed by a final, static field-skin panel restating the ending title
 * plus "THE END". That final panel is a terminal screen — once reached, no
 * further keydown/click handling is wired up (there is nothing left for the
 * player to advance to).
 *
 * `grade` (final review, C7): the platform's scorecard, when App has an
 * `onFinalGrade` host callback wired and it has resolved by the time the
 * player reaches the terminal panel — absent otherwise (no callback, or the
 * fetch just hasn't settled yet/failed), in which case the terminal panel
 * renders exactly as it always has. Deliberately minimal: an on-grammar
 * score line plus whatever free-text feedback the platform sent, not a full
 * rubric breakdown (the engine doesn't know the rubric's shape).
 */
export function DebriefPages({ data, grade }: { data: DebriefData; grade?: GradePayload }) {
  const beats = useMemo(() => buildBeats(data), [data]);
  const [index, setIndex] = useState(0);
  const done = index >= beats.length;

  return (
    <div className="cq-debrief" data-testid="debrief">
      {!done && (
        <MessageBox skin="battle">
          <Typewriter
            key={index}
            text={beats[index]}
            skin="battle"
            onDone={() => setIndex((i) => i + 1)}
          />
        </MessageBox>
      )}

      {done && (
        <div className="cq-debrief-final" data-testid="debrief-final">
          <div className="cq-debrief-final-title">{data.ending.title}</div>
          {grade && (
            <div className="cq-debrief-grade" data-testid="debrief-grade">
              {typeof grade.score === "number" && (
                <div className="cq-debrief-grade-score">
                  Platform score: {grade.score}
                  {typeof grade.maxScore === "number" ? ` / ${grade.maxScore}` : ""}
                </div>
              )}
              {grade.summary && <div className="cq-debrief-grade-summary">{grade.summary}</div>}
            </div>
          )}
          <div className="cq-debrief-final-tag">THE END</div>
        </div>
      )}
    </div>
  );
}
