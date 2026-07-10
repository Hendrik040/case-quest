// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { WorldSchema } from "@case-quest/schema";
import { App } from "./App";
import worldJson from "../public/worlds/wholesale-offer.world.json";

const world = WorldSchema.parse(worldJson);

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
