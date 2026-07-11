/**
 * Recorded-shape SSE fixtures for `naibleAdapter.ts`.
 *
 * These are NOT captured from a live run (Task 3.3 has no live backend — see the
 * adapter module doc and the task report for the "integration UNVERIFIED" flag).
 * Each string below is hand-assembled to byte-for-byte match the `f"data:
 * {json.dumps({...})}\n\n"` frames actually emitted by the n-aible backend, with
 * every key/value pulled from the source read for this task. Provenance is cited
 * per fixture as `<file>:<line>` against
 * `/Users/hendrikkrack/Desktop/n-aible/n-aible_edtech_sims/backend` (read-only;
 * nothing there was modified) as it stood on 2026-07-11.
 */

/**
 * Single `@mention` persona reply: three token frames then one final frame.
 * chat_handler.py:735 (token frame shape, inside the persona chat_stream loop)
 * chat_handler.py:788 (final frame shape — done/scene_completed/next_scene_id/
 * turn_count/full_content — emitted once, then the handler `return`s at :791).
 */
export const SINGLE_MENTION_SSE =
  `data: ${JSON.stringify({ content: "Margins ", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n` +
  `data: ${JSON.stringify({ content: "are tight ", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n` +
  `data: ${JSON.stringify({ content: "this quarter.", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n` +
  `data: ${JSON.stringify({
    done: true,
    persona_name: "Nick Elliott",
    persona_id: "501",
    scene_completed: false,
    next_scene_id: null,
    turn_count: 4,
    full_content: "Margins are tight this quarter.",
  })}\n\n`;

/**
 * `@all` reply: two personas streamed sequentially (the backend starts both
 * LLM calls in parallel but still drains one persona's tokens fully before
 * the next — see chat_handler.py:296-354), each with its own token frames
 * (chat_handler.py:321) and its own `done:true` segment frame
 * (chat_handler.py:326). Only the SECOND persona's frame is the true end of
 * the HTTP stream — chat_handler.py:955-961 confirms no additional frame is
 * yielded after the per-persona loop for `@all`.
 */
export const ALL_MENTION_SSE =
  `data: ${JSON.stringify({ content: "Sure, ", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n` +
  `data: ${JSON.stringify({ content: "let's look at costs.", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n` +
  `data: ${JSON.stringify({
    done: true,
    persona_name: "Nick Elliott",
    persona_id: "501",
    scene_completed: false,
    next_scene_id: null,
    turn_count: 5,
    full_content: "Sure, let's look at costs.",
  })}\n\n` +
  `data: ${JSON.stringify({ content: "Sales ", done: false, persona_name: "Priya Shah", persona_id: "502" })}\n\n` +
  `data: ${JSON.stringify({ content: "can absorb it.", done: false, persona_name: "Priya Shah", persona_id: "502" })}\n\n` +
  `data: ${JSON.stringify({
    done: true,
    persona_name: "Priya Shah",
    persona_id: "502",
    scene_completed: false,
    next_scene_id: null,
    turn_count: 6,
    full_content: "Sales can absorb it.",
  })}\n\n`;

/**
 * `help` command reply: char-by-char frames (chat_handler.py:147) then a
 * final frame with `persona_id: None` and no scene_completed/turn_count/
 * full_content keys at all (chat_handler.py:150) — the adapter must treat
 * every backend-frame field as optional.
 */
export const HELP_COMMAND_SSE =
  `data: ${JSON.stringify({ content: "*", done: false })}\n\n` +
  `data: ${JSON.stringify({ content: "*", done: false })}\n\n` +
  `data: ${JSON.stringify({ done: true, persona_name: "ChatOrchestrator", persona_id: null })}\n\n`;

/**
 * Unrecognized-persona fallback: char frames tagged `persona_name:
 * "ChatOrchestrator"` / `persona_id: null` (chat_handler.py:839-844) followed
 * by the shared final-metadata frame at chat_handler.py:1041 (reached because
 * `persona_id` is falsy, per the routing at :911).
 */
export const UNRECOGNIZED_PERSONA_SSE =
  `data: ${JSON.stringify({ content: "I", done: false, persona_name: "ChatOrchestrator", persona_id: null })}\n\n` +
  `data: ${JSON.stringify({ content: " don't", done: false, persona_name: "ChatOrchestrator", persona_id: null })}\n\n` +
  `data: ${JSON.stringify({
    done: true,
    persona_name: "ChatOrchestrator",
    persona_id: null,
    scene_completed: false,
    next_scene_id: null,
    turn_count: 2,
    full_content: "I don't recognize that persona.",
  })}\n\n`;

/**
 * Same single-mention reply as `SINGLE_MENTION_SSE` but with one garbage
 * line spliced into the middle of the SSE body — not a captured backend
 * behavior (chat_handler.py never emits invalid JSON), but a deliberate
 * fixture-only stress case for the brief's "malformed SSE lines (skip,
 * don't crash)" requirement. Also includes a bare SSE comment line (`:
 * keep-alive`), which real proxies/load balancers do inject to hold
 * connections open.
 */
export const MALFORMED_LINE_SSE =
  `data: ${JSON.stringify({ content: "Margins ", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n` +
  `: keep-alive\n\n` +
  `data: {not valid json at all\n\n` +
  `data: ${JSON.stringify({ content: "are tight.", done: false, persona_name: "Nick Elliott", persona_id: "501" })}\n\n` +
  `data: ${JSON.stringify({
    done: true,
    persona_name: "Nick Elliott",
    persona_id: "501",
    scene_completed: false,
    next_scene_id: null,
    turn_count: 4,
    full_content: "Margins are tight.",
  })}\n\n`;

/**
 * Error frame: chat_handler.py:1048 (top-level `except Exception` handler —
 * always the last frame of the stream, since the generator has nothing left
 * to yield afterward).
 */
export const ERROR_SSE = `data: ${JSON.stringify({ error: "OpenAI request timed out" })}\n\n`;

/**
 * Capacity-rejection frame, thrown before chat_handler.py is even reached
 * (service.py:266-271) — a different error shape (`code` + `message` in
 * addition to `error`) that the adapter must still surface as a stream error.
 */
export const CAPACITY_ERROR_SSE = `data: ${JSON.stringify({
  error: "Simulation system is at capacity. Please wait a moment and try again.",
  code: "SIMULATION_STREAMS_AT_CAPACITY",
  message: "Too many users are using the simulation right now. Please wait a few seconds and try again.",
})}\n\n`;
