/**
 * Recorded-shape JSON fixtures for `naibleAdapter.ts` (non-SSE endpoints and
 * the 202+job_id queue fallback). See `sseFrames.ts` for the "not a live
 * capture" caveat that applies to this whole task — every shape below is
 * assembled from source read at
 * `/Users/hendrikkrack/Desktop/n-aible/n-aible_edtech_sims/backend`
 * (read-only) as it stood on 2026-07-11; provenance cited per fixture.
 */

/** router.py:104-112 — `/linear-chat-stream` and `/grade` both return this
 * shape (with a 202 status) when `should_use_queue()` decides to queue the
 * request instead of processing it inline. */
export const QUEUED_202_RESPONSE = {
  job_id: "8f14e45f-ceea-467e-9b74-9c1b3f7c1a1e",
  session_id: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7",
  status: "queued",
  message: "Request queued for processing. Poll /api/simulation/job/{job_id}/status for updates.",
};

/** simulation_queue_service.py:222-251 (`get_job_status`) with the `user_id`
 * key stripped by router.py:462-465 before the client ever sees it. */
export const JOB_STATUS_PROCESSING = {
  job_id: "8f14e45f-ceea-467e-9b74-9c1b3f7c1a1e",
  status: "processing",
  created_at: "2026-07-11T04:00:00",
  queue_position: null,
  session_id: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7",
};

export const JOB_STATUS_COMPLETED = {
  job_id: "8f14e45f-ceea-467e-9b74-9c1b3f7c1a1e",
  status: "completed",
  created_at: "2026-07-11T04:00:00",
  queue_position: null,
  session_id: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7",
  has_result: true,
};

/** simulation_queue_service.py:241-249 — the `error` key is only populated
 * from the stored result when status is "failed". */
export const JOB_STATUS_FAILED = {
  job_id: "8f14e45f-ceea-467e-9b74-9c1b3f7c1a1e",
  status: "failed",
  created_at: "2026-07-11T04:00:00",
  queue_position: null,
  session_id: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7",
  error: "Job data not found after multiple dequeue attempts",
};

/** tasks.py:178-181 (`{"chunks": [...], "success": True}` for a `job_type ==
 * "chat"` job — each entry of `chunks` is one raw `"data: ...\n\n"` SSE
 * frame string, byte-identical to what the live stream would have produced)
 * plus simulation_queue_service.py:289-291 (`get_job_result` adds `user_id`
 * / `session_id`) with `user_id` stripped by router.py:492-493. Built from
 * the same frames as `SINGLE_MENTION_SSE` in sseFrames.ts. */
export const JOB_RESULT_CHAT = {
  chunks: [
    `data: ${JSON.stringify({ content: "Margins ", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n`,
    `data: ${JSON.stringify({ content: "are tight this quarter.", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n`,
    `data: ${JSON.stringify({
      done: true,
      persona_name: "Nick Elliott",
      persona_id: "501",
      scene_completed: false,
      next_scene_id: null,
      turn_count: 4,
      full_content: "Margins are tight this quarter.",
    })}\n\n`,
  ],
  success: true,
  session_id: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7",
};

/** tasks.py:71-74 (`{"grading": <full grading payload>, "success": True}`
 * for a `job_type == "grading"` job). The nested payload matches
 * `GRADE_PAYLOAD` below (grading_service.py:335-340). */
export const JOB_RESULT_GRADING = {
  grading: {
    overall_score: 78,
    overall_feedback: "Solid grasp of unit economics; pricing rationale needs more evidence.",
    scenes: [{ scene_id: 12, scene_title: "The Wholesale Offer", score: 78, feedback: "Good use of margin data." }],
    rubric_total_points: 100,
  },
  success: true,
  session_id: "a1b2c3d4-e5f6-4789-a0b1-c2d3e4f5a6b7",
};

/** service.py:150-159 — `SUBMIT_FOR_GRADING` when the scene just completed
 * was the last one (`progression_result['simulation_complete']` true). */
export const SUBMIT_FOR_GRADING_SIMULATION_COMPLETE = {
  message: "🎉 **Congratulations! You have completed the entire simulation.**",
  scene_id: 12,
  scene_completed: true,
  next_scene_id: null,
  persona_name: "System",
  persona_id: null,
  turn_count: 9,
  simulation_complete: true,
};

/** service.py:226-236 — `SUBMIT_FOR_GRADING` for a normal (non-final) scene
 * transition; `next_scene` carries the full next-scene object built at
 * service.py:209-224 but the adapter only needs `next_scene_id` for the
 * `SceneWrapUpResult` it returns. */
export const SUBMIT_FOR_GRADING_NEXT_SCENE = {
  message: "🎉 **Scene Submitted!** Moving to next scene:\n\n**The Buyer's Counter**\n\n**Objective:** Negotiate terms",
  scene_id: 13,
  scene_completed: true,
  next_scene_id: 13,
  next_scene: { id: 13, title: "The Buyer's Counter" },
  persona_name: "System",
  persona_id: null,
  turn_count: 0,
  scene_intro_message: "You walk into the buyer's office...",
};

/** grading_service.py:335-340 — the full grading payload returned directly
 * (HTTP 200, not queued) by `GET /api/simulation/grade`. */
export const GRADE_PAYLOAD = {
  overall_score: 82,
  overall_feedback: "Strong negotiation instincts; justify the discount with cost data next time.",
  scenes: [
    { scene_id: 12, scene_title: "The Wholesale Offer", score: 85, feedback: "Cited margin figures accurately." },
    { scene_id: 13, scene_title: "The Buyer's Counter", score: 79, feedback: "Conceded too quickly on price." },
  ],
  rubric_total_points: 100,
};

/** service.py:370 — `save_message`'s return shape. */
export const SAVE_MESSAGE_RESPONSE = { id: 4021, message_order: 15, status: "saved" };

/** service.py (start_simulation delegates to lifecycle_service; response
 * shape is `SimulationStartResponse`, schemas/dto.py:96-107). */
export const START_SIMULATION_RESPONSE = {
  user_progress_id: 777,
  simulation: { id: 9, title: "The Wholesale Offer" },
  current_scene: { id: 12, title: "The Wholesale Offer" },
  simulation_status: "in_progress",
  conversation_history: [],
  is_resuming: false,
  all_scenes: [{ id: 12 }, { id: 13 }],
  turn_count: 0,
  completed_scene_ids: [],
  sandbox_id: null,
};
