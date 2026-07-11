// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorldSchema, type World } from "@case-quest/schema";
import { App, type CaseQuestCallbacks, type EncounterChatChunk } from "./App";
import type { EventBus } from "./bridge/events";
import type { GameSession } from "./state/session";
import worldJson from "../public/worlds/wholesale-offer.world.json";

const world = WorldSchema.parse(worldJson);

// Dev-mode escape hatch App exposes on `window` (see App.tsx's boot effect,
// gated on `import.meta.env.DEV` — true under vitest, same as lib.test.tsx's
// `__cqBus` usage note) — lets these tests drive the bus the way WorldScene
// normally would, without a real Phaser instance (mocked out below).
function cqBus(): EventBus {
  return (window as unknown as { __cqBus: EventBus }).__cqBus;
}
function cqSession(): GameSession {
  return (window as unknown as { __cqSession: GameSession }).__cqSession;
}

// Click by matching an option's rendered text — mirrors
// MeetingEncounter.test.tsx's helper of the same name (the kit's option rows
// are plain divs, but `.click()` still dispatches a bubbling event React's
// delegated listener picks up).
function clickByText(container: HTMLElement, testid: string, text: string) {
  const panel = container.querySelector(`[data-testid="${testid}"]`);
  if (!panel) throw new Error(`no element with data-testid="${testid}"`);
  const match = [...panel.querySelectorAll<HTMLElement>("div")].find((el) => el.textContent?.trim() === text);
  if (!match) throw new Error(`no option "${text}" inside "${testid}"`);
  match.click();
}

/** Polls (real timers) until `predicate` is true — for asserting on the
 * default mock chat host's real-`setTimeout`-paced token stream, which
 * flushed microtasks alone can't observe. */
async function waitForCondition(predicate: () => boolean, timeoutMs = 3000, stepMs = 20): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitForCondition timed out");
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, stepMs)); });
  }
}

// A two-node world exercising spatial traversal (route_locations + a
// boardroom venue for node_b), mirroring session.test.ts's `routedWorld()`
// fixture — trimmed to just what App's pollSceneActivation-reaction test
// needs (no second decision at node_b).
function routedWorld(): World {
  return WorldSchema.parse({
    schema_version: "0.2",
    meta: {
      case_id: "app-routed-test", title: "Routed Test World",
      synopsis: "Exercises App's pollSceneActivation reaction on arrival.",
      protagonist_actor_id: "player", start_node_id: "node_a",
    },
    learning_objectives: [],
    actors: [
      {
        id: "player", name: "Player", role: "protagonist", is_playable: true,
        persona: { background: "", personality: "", communication_style: "" },
        goals: [], knowledge: [],
      },
      {
        id: "npc_a", name: "Ann", role: "npc", is_playable: false,
        persona: { background: "", personality: "", communication_style: "" },
        goals: [], knowledge: ["fact_a"],
        dialogue: { greeting: "Hi from A", topics: [{ fact_id: "fact_a", line: "Fact A revealed." }] },
      },
    ],
    locations: [
      { id: "loc_a_office", name: "Office A", type: "office", exits: ["loc_street"] },
      { id: "loc_street", name: "Connecting Street", type: "street", exits: ["loc_a_office", "loc_b_venue"] },
      { id: "loc_b_venue", name: "Boardroom B", type: "boardroom", exits: ["loc_street"] },
    ],
    facts: [
      { id: "fact_a", label: "Fact A", content: "content a", sources: [{ actor_id: "npc_a", location_id: "loc_a_office" }] },
    ],
    decisions: [
      {
        id: "decide_a", prompt: "Move to node B?", requires_facts: ["fact_a"],
        options: [{ id: "go_b", label: "Go to node B", consequence_text: "You head to node B.", illuminates: [], leads_to: "node_b" }],
      },
    ],
    nodes: [
      {
        id: "node_a", title: "Node A", accessible_locations: ["loc_a_office"], route_locations: ["loc_street"],
        present_actors: ["npc_a"], available_facts: ["fact_a"], live_decisions: ["decide_a"],
      },
      {
        id: "node_b", title: "Node B", accessible_locations: ["loc_b_venue"],
        present_actors: [], available_facts: [], live_decisions: [],
      },
    ],
    endings: [],
  });
}

// Real Phaser cannot boot in jsdom (no WebGL/2D renderer) — mock the
// createGame boundary the same way lib.test.tsx does and let the React tree
// mount for real.
vi.mock("./phaser/game", () => ({
  createGame: vi.fn(() => ({ destroy: vi.fn() })),
}));

// React 18: flag act() usage so state updates from the boot effect are
// flushed deterministically instead of warning.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setSearch(search: string) {
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState(null, "", url);
}

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({ json: async () => worldJson } as Response);
}

// These cover the CQ_WORLD_URL seam (Task 8): the standalone page's own
// fetch branch (App with no `world` prop) reads a `?world=` query param —
// set by scripts/e2e-drive.mjs when CQ_WORLD_URL is set — to fetch an
// arbitrary world file instead of the default wholesale-offer fixture.
describe("App standalone world resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setSearch("");
  });

  it("fetches the default wholesale-offer world when no ?world= override is present", async () => {
    setSearch("");
    const fetchSpy = mockFetch();
    const el = document.createElement("div");
    await act(async () => {
      createRoot(el).render(<App />);
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledWith("/worlds/wholesale-offer.world.json");
  });

  it("fetches the ?world= override URL when present", async () => {
    setSearch("?world=%2Fworlds%2Fcustom.world.json");
    const fetchSpy = mockFetch();
    const el = document.createElement("div");
    await act(async () => {
      createRoot(el).render(<App />);
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledWith("/worlds/custom.world.json");
  });

  it("never fetches (or looks at the query param) when a world is injected directly, the embed path", async () => {
    setSearch("?world=%2Fworlds%2Fcustom.world.json");
    const fetchSpy = mockFetch();
    const el = document.createElement("div");
    await act(async () => {
      createRoot(el).render(<App world={world} />);
      await Promise.resolve();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Task 2.3: encounter:meeting:start -> startMeeting -> mount the "meeting"
// Overlay variant, freezing Phaser via the existing generic world:freeze
// effect (keyed on `overlay.kind !== "none"`, unchanged) — same discipline
// every other overlay kind already gets, no bespoke freeze code needed for
// "meeting". WorldScene is mocked out (no real Phaser instance), so these
// tests drive the bus directly the way WorldScene normally would.
describe("App — meeting overlay wiring (Task 2.3)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  async function mountWorld(w: World, callbacks?: CaseQuestCallbacks) {
    await act(async () => {
      root = createRoot(container);
      root.render(<App world={w} callbacks={callbacks} />);
      await Promise.resolve();
    });
  }

  it("mounts the MeetingEncounter overlay and freezes the stage", async () => {
    await mountWorld(world);
    act(() => cqBus().emit("encounter:meeting:start", { actorIds: ["roaster", "buyer"] }));

    expect(container.querySelector('[data-testid="meeting-encounter"]')).not.toBeNull();
    expect(container.querySelector(".cq-stage")?.className).toContain("cq-frozen");
    expect(cqSession().mode()).toBe("meeting");
  });

  it("ASK grants the fact through the real session and is reflected in the overlay", async () => {
    await mountWorld(world);
    act(() => cqBus().emit("encounter:meeting:start", { actorIds: ["roaster", "buyer"] }));

    act(() => clickByText(container, "meeting-action-menu", "ASK"));
    expect(cqSession().isFactGathered("fact_capacity")).toBe(false);
    act(() => clickByText(container, "meeting-ask-panel", "Roasting capacity"));

    expect(cqSession().isFactGathered("fact_capacity")).toBe(true);
  });

  it("WRAP UP ends the meeting, unmounts the overlay, thaws the stage, and re-runs the decision-prompt check", async () => {
    await mountWorld(world);
    act(() => cqBus().emit("encounter:meeting:start", { actorIds: ["roaster", "buyer"] }));

    act(() => clickByText(container, "meeting-action-menu", "WRAP UP"));
    act(() => clickByText(container, "choice-box", "YES"));

    expect(container.querySelector('[data-testid="meeting-encounter"]')).toBeNull();
    expect(container.querySelector(".cq-stage")?.className).not.toContain("cq-frozen");
    expect(cqSession().mode()).toBe("roaming");
  });

  it("SAY with no injected callbacks defaults to the local mock chat host (meetings feel alive standalone)", async () => {
    await mountWorld(world);
    act(() => cqBus().emit("encounter:meeting:start", { actorIds: ["roaster", "buyer"] }));

    act(() => clickByText(container, "meeting-action-menu", "SAY"));
    act(() => clickByText(container, "choice-box", "@Sam"));
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="meeting-say-textarea"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "What about pricing?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { container.querySelector<HTMLElement>('[data-testid="meeting-say-submit"]')!.click(); });

    // Unlike MeetingEncounter.test.tsx's injected-onSay tests (a synchronous
    // fake async generator), the *default* mock chat host (host/mockChat.ts)
    // paces tokens through a real `setTimeout` — so reaching the shared
    // "revealing" phase here needs real wall-clock time, not just flushed
    // microtasks. Polls (real timers, no fake-timer mode) instead of a fixed
    // sleep so the test is only as slow as the mock actually is.
    await waitForCondition(() => container.querySelector('[data-testid="typewriter"]') !== null);
    expect(container.querySelector('[data-testid="typewriter"]')).not.toBeNull();
  });

  it("routes SAY through the injected onEncounterChat host callback, crosswalking actorId <-> platform_persona_id", async () => {
    const worldWithCrosswalk = WorldSchema.parse({
      ...worldJson,
      actors: (worldJson as { actors: unknown[] }).actors.map((a) =>
        (a as { id: string }).id === "roaster" ? { ...(a as object), platform_persona_id: 101 } : a,
      ),
    });
    async function* fakeStream(): AsyncGenerator<EncounterChatChunk> {
      yield { personaId: 101, token: "Sure, ", turnCount: 1 };
      yield { personaId: 101, token: "let's talk.", done: true, turnCount: 2 };
    }
    const onEncounterChat = vi.fn().mockReturnValue(fakeStream());
    await mountWorld(worldWithCrosswalk, { onEncounterChat });

    act(() => cqBus().emit("encounter:meeting:start", { actorIds: ["roaster", "buyer"] }));
    act(() => clickByText(container, "meeting-action-menu", "SAY"));
    act(() => clickByText(container, "choice-box", "@Sam"));
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="meeting-say-textarea"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Tell me more");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="meeting-say-submit"]')!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onEncounterChat).toHaveBeenCalledWith(expect.objectContaining({
      target: { platformPersonaId: 101 },
      text: "Tell me more",
    }));
    // The Typewriter types the revealed line out over time — click it
    // (advance-to-fully-typed, per Typewriter.tsx) to read the whole line
    // synchronously, same idiom as MeetingEncounter.test.tsx's recovery test.
    const typewriter = container.querySelector<HTMLElement>('[data-testid="typewriter"]');
    expect(typewriter).not.toBeNull();
    act(() => typewriter!.click());
    expect(typewriter!.textContent).toContain("Sure, let's talk.");
  });

  it("WRAP UP fires the injected onSceneWrapUp with the current node's platform_scene_id", async () => {
    const worldWithScene = WorldSchema.parse({ ...worldJson, nodes: (worldJson as { nodes: unknown[] }).nodes.map((n, i) => (i === 0 ? { ...(n as object), platform_scene_id: 7 } : n)) });
    const onSceneWrapUp = vi.fn().mockResolvedValue({ complete: true });
    await mountWorld(worldWithScene, { onSceneWrapUp });

    act(() => cqBus().emit("encounter:meeting:start", { actorIds: ["roaster", "buyer"] }));
    act(() => clickByText(container, "meeting-action-menu", "WRAP UP"));
    await act(async () => {
      clickByText(container, "choice-box", "YES");
      await Promise.resolve();
    });

    expect(onSceneWrapUp).toHaveBeenCalledWith(7);
  });

  // Final review (C2): re-opening and re-wrapping an already-wrapped node used to fire
  // a second onSceneWrapUp (duplicate SUBMIT_FOR_GRADING) — the platform would advance
  // the scene crosswalk a second time while the engine is still on the same node.
  it("does not re-fire onSceneWrapUp for a node whose meeting has already been wrapped up (re-open + re-wrap is a local no-op for the host submit)", async () => {
    const worldWithScene = WorldSchema.parse({ ...worldJson, nodes: (worldJson as { nodes: unknown[] }).nodes.map((n, i) => (i === 0 ? { ...(n as object), platform_scene_id: 7 } : n)) });
    const onSceneWrapUp = vi.fn().mockResolvedValue({ complete: true });
    await mountWorld(worldWithScene, { onSceneWrapUp });

    act(() => cqBus().emit("encounter:meeting:start", { actorIds: ["roaster", "buyer"] }));
    act(() => clickByText(container, "meeting-action-menu", "WRAP UP"));
    await act(async () => {
      clickByText(container, "choice-box", "YES");
      await Promise.resolve();
    });
    expect(onSceneWrapUp).toHaveBeenCalledTimes(1);
    expect(cqSession().hasWrappedUp(cqSession().currentNode().id)).toBe(true);

    // Standalone re-chat stays allowed: re-opening the SAME node's meeting still works.
    act(() => cqBus().emit("encounter:meeting:start", { actorIds: ["roaster", "buyer"] }));
    expect(container.querySelector('[data-testid="meeting-encounter"]')).not.toBeNull();
    act(() => clickByText(container, "meeting-action-menu", "WRAP UP"));
    await act(async () => {
      clickByText(container, "choice-box", "YES");
      await Promise.resolve();
    });

    // Still exactly once — the second wrap-up must not re-submit.
    expect(onSceneWrapUp).toHaveBeenCalledTimes(1);
    expect(cqSession().mode()).toBe("roaming");
  });
});

// Final review (C7): `onFinalGrade` was defined and type-tested but had no caller —
// the debrief never showed the platform's actual score. A decision leading straight to
// an ending (kept minimal — no facts/actors needed) exercises App's debrief-entry path
// end to end.
function endingWorld(): World {
  return WorldSchema.parse({
    schema_version: "0.2",
    meta: {
      case_id: "ending-test", title: "Ending Test",
      synopsis: "Exercises App's onFinalGrade wiring on debrief entry.",
      protagonist_actor_id: "player", start_node_id: "node_a",
    },
    learning_objectives: [{ id: "lo1", text: "objective" }],
    actors: [
      {
        id: "player", name: "Player", role: "protagonist", is_playable: true,
        persona: { background: "", personality: "", communication_style: "" },
        goals: [], knowledge: [],
      },
    ],
    locations: [{ id: "loc_a", name: "Office", type: "office", exits: [] }],
    facts: [],
    decisions: [
      {
        id: "decide", prompt: "Finish?", requires_facts: [],
        options: [{ id: "fin", label: "Finish", consequence_text: "c", illuminates: ["lo1"], leads_to: "end_good" }],
      },
    ],
    nodes: [
      {
        id: "node_a", title: "Node A", accessible_locations: ["loc_a"],
        present_actors: [], available_facts: [], live_decisions: ["decide"],
      },
    ],
    endings: [
      { id: "end_good", title: "Good", summary: "s", real_case_comparison: "r", lo_outcomes: [{ lo_id: "lo1", verdict: "v" }] },
    ],
  });
}

/** Clicks the currently-mounted `Typewriter` until the debrief's terminal panel shows
 * (first click fully types the current page instantly; the next advances/onDone's it —
 * see Typewriter.tsx's `advance`). Mirrors e2e-drive.mjs's `exhaustTypewriter`. */
function exhaustDebrief(container: HTMLElement, maxClicks = 40) {
  for (let i = 0; i < maxClicks; i++) {
    if (container.querySelector('[data-testid="debrief-final"]')) return;
    const tw = container.querySelector<HTMLElement>('[data-testid="typewriter"]');
    if (!tw) throw new Error("exhaustDebrief: no typewriter and no debrief-final");
    act(() => tw.click());
  }
  throw new Error("exhaustDebrief: never reached debrief-final");
}

/**
 * Drives `endingWorld()`'s single zero-fact decision to its ending through the REAL UI
 * (not by calling `session.chooseOption` directly, which would bypass App's own
 * `handleDecisionCommit` — exactly the handler C7's fix lives in): Enter (Rule 7's
 * global shortcut, since the decision is unlocked from boot with zero required facts)
 * -> click through the prompt typewriter -> pick "Finish" -> confirm YES -> submit
 * reasoning. Lands on the "debrief" overlay when this returns.
 */
async function commitEndingDecision(container: HTMLElement) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
  });
  await waitVisible(container, "decision-encounter");
  const tw = container.querySelector<HTMLElement>('[data-testid="typewriter"]')!;
  act(() => tw.click()); // fully type the prompt instantly
  act(() => tw.click()); // advance prompt -> options
  act(() => clickByText(container, "choice-box", "Finish"));
  act(() => clickByText(container, "choice-box", "YES"));
  const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="reasoning-textarea"]')!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(textarea, "This is the defensible call.");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector<HTMLElement>('[data-testid="reasoning-submit"]')!.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitVisible(container: HTMLElement, testid: string, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!container.querySelector(`[data-testid="${testid}"]`)) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitVisible: [data-testid="${testid}"] never appeared`);
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

describe("App — final grade wiring (C7)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  async function mountEndingWorld(callbacks?: CaseQuestCallbacks) {
    await act(async () => {
      root = createRoot(container);
      root.render(<App world={endingWorld()} callbacks={callbacks} />);
      await Promise.resolve();
    });
  }

  it("calls onFinalGrade on entering debrief and renders the returned grade in the terminal panel", async () => {
    const onFinalGrade = vi.fn().mockResolvedValue({ score: 92, maxScore: 100, summary: "Nice work." });
    await mountEndingWorld({ onFinalGrade });

    await commitEndingDecision(container);

    expect(onFinalGrade).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="debrief"]')).not.toBeNull();

    exhaustDebrief(container);
    expect(container.querySelector('[data-testid="debrief-grade"]')?.textContent).toContain("92");
    expect(container.querySelector('[data-testid="debrief-grade"]')?.textContent).toContain("Nice work.");
  });

  it("a rejecting onFinalGrade does not break the debrief (error-tolerant, no unhandled rejection)", async () => {
    const onFinalGrade = vi.fn().mockRejectedValue(new Error("grade service down"));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      await mountEndingWorld({ onFinalGrade });
      await commitEndingDecision(container);

      expect(onFinalGrade).toHaveBeenCalledTimes(1);
      exhaustDebrief(container);
      expect(container.querySelector('[data-testid="debrief-grade"]')).toBeNull();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("without an onFinalGrade callback, the debrief is unchanged (no grade section)", async () => {
    await mountEndingWorld(undefined);
    await commitEndingDecision(container);

    exhaustDebrief(container);
    expect(container.querySelector('[data-testid="debrief-grade"]')).toBeNull();
    expect(container.querySelector('[data-testid="debrief-final"]')).not.toBeNull();
  });
});

// Task 1.5's BINDING for Task 2.3: after a traversal `moveTo` lands on the
// next node's venue, App must poll `session.pollSceneActivation()` (mirroring
// the existing `pollDecisionPrompt` idiom) and react — re-emitting
// `scene:render` + refreshing the `LocationBanner` for the new node's venue.
// No new scene-intro overlay, per the brief.
describe("App — scene-activation reaction on traversal arrival (Task 2.3 binding)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it("emits scene:activate and refreshes the location banner when arriving at the next node's venue", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App world={routedWorld()} />);
      await Promise.resolve();
    });

    const session = cqSession();
    const bus = cqBus();
    const activations: unknown[] = [];
    bus.on("scene:activate", (payload) => activations.push(payload));

    // Complete node A's decision to enter the traversing sub-state.
    act(() => {
      session.maybeStartChain();
      session.encounterAsk("fact_a");
      session.encounterMoveOn();
      session.startDecision("decide_a");
      session.chooseOption("decide_a", "go_b", "moving on");
    });
    expect(session.mode()).toBe("traversing");

    // Walking the route location doesn't activate node B yet.
    act(() => {
      session.moveTo("loc_street");
      bus.emit("location:changed", { locationId: "loc_street" });
    });
    expect(activations).toEqual([]);
    expect(container.querySelector('[data-testid="location-banner"]')?.textContent).toBe("Connecting Street");

    // Arriving at node B's venue does.
    act(() => {
      session.moveTo("loc_b_venue");
      bus.emit("location:changed", { locationId: "loc_b_venue" });
    });

    expect(activations).toEqual([{ fromNodeId: "node_a", toNodeId: "node_b" }]);
    expect(session.currentNode().id).toBe("node_b");
    expect(container.querySelector('[data-testid="location-banner"]')?.textContent).toBe("Boardroom B");
  });
});

// Task 3.1 acceptance: "type-level + unit test with a fake async iterator".
// The type-level half is the `satisfies`/annotation below compiling at all —
// a signature drift in `CaseQuestCallbacks` (App.tsx) would fail `tsc`, not
// just this assertion. The unit-test half drains a fake async iterator
// through the real contract shape end-to-end.
describe("CaseQuestCallbacks contract (Task 3.1)", () => {
  it("onEncounterChat/onSceneWrapUp/onFinalGrade satisfy the plan's literal shape and are runnable", async () => {
    const callbacks: CaseQuestCallbacks = {
      async *onEncounterChat(msg): AsyncGenerator<EncounterChatChunk> {
        expect(msg.nodeId).toBe("node_x");
        expect(msg.target).toEqual("all");
        yield { personaId: 5, token: "Hello" };
        yield { personaId: 5, token: " there.", done: true, turnCount: 2, sceneCompleted: true };
      },
      async onSceneWrapUp(platformSceneId) {
        return { nextSceneId: platformSceneId !== undefined ? platformSceneId + 1 : undefined, complete: true };
      },
      async onFinalGrade() {
        return { score: 92, maxScore: 100, summary: "Nice work." };
      },
    };

    const chunks: EncounterChatChunk[] = [];
    for await (const chunk of callbacks.onEncounterChat!({ nodeId: "node_x", target: "all", text: "hi" })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([
      { personaId: 5, token: "Hello" },
      { personaId: 5, token: " there.", done: true, turnCount: 2, sceneCompleted: true },
    ]);

    await expect(callbacks.onSceneWrapUp!(7)).resolves.toEqual({ nextSceneId: 8, complete: true });
    await expect(callbacks.onSceneWrapUp!(undefined)).resolves.toEqual({ nextSceneId: undefined, complete: true });
    await expect(callbacks.onFinalGrade!()).resolves.toMatchObject({ score: 92, maxScore: 100 });
  });
});
