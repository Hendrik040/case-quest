// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { mountCaseQuest } from "./lib";
import worldJson from "../public/worlds/wholesale-offer.world.json";

// Real Phaser cannot boot in jsdom (no WebGL/2D renderer); the game object is
// GameSession's concern anyway — mock the createGame boundary and let the
// React tree mount for real.
vi.mock("./phaser/game", () => ({
  createGame: vi.fn(() => ({ destroy: vi.fn() })),
}));

// React 18: flag act() usage so state updates from the boot effect are
// flushed deterministically instead of warning.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("mountCaseQuest", () => {
  it("throws with validation issues on an invalid world", () => {
    expect(() => mountCaseQuest(document.createElement("div"), { nope: true })).toThrow(/schemaVersion|invalid/i);
  });

  it("mounts a valid world and returns an unmount handle", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    let handle!: ReturnType<typeof mountCaseQuest>;
    // createRoot().render commits asynchronously in React 18 — flush via act
    // so the assertion observes the committed tree.
    await act(async () => {
      handle = mountCaseQuest(el, worldJson);
    });
    expect(el.childElementCount).toBeGreaterThan(0);
    act(() => handle.unmount());
    expect(el.childElementCount).toBe(0);
  });
});
