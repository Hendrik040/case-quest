// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorldSchema, type World } from "@case-quest/schema";
import toyJson from "../../../public/worlds/wholesale-offer.world.json";
import { GameSession } from "../../state/session";
import { MeetingEncounter } from "./MeetingEncounter";

// React 18: flush state updates from effects/handlers deterministically
// instead of warning about act().
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function newSession(): GameSession {
  const world: World = WorldSchema.parse(toyJson);
  return new GameSession(world);
}

const facts = { got: 0, needed: 3, labels: [] as string[] };

// Click by matching an option's rendered text — the kit's option rows are
// plain divs (not <button>s), but `.click()` dispatches a bubbling click
// event that React's delegated listener still picks up, same as it would a
// real mouse click.
function clickByText(container: HTMLElement, testid: string, text: string) {
  const panel = container.querySelector(`[data-testid="${testid}"]`);
  if (!panel) throw new Error(`no element with data-testid="${testid}"`);
  const match = [...panel.querySelectorAll<HTMLElement>("div")].find((el) => el.textContent?.trim() === text);
  if (!match) throw new Error(`no option "${text}" inside "${testid}"`);
  match.click();
}

describe("MeetingEncounter", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders every seated participant's bust and highlights the active speaker", () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onWrapUp={vi.fn()}
        />,
      );
    });
    const busts = container.querySelectorAll('[data-testid^="meeting-bust-"]');
    expect(busts.length).toBe(2);
    const roasterBust = container.querySelector('[data-testid="meeting-bust-roaster"]')!;
    const buyerBust = container.querySelector('[data-testid="meeting-bust-buyer"]')!;
    expect(roasterBust.className).toContain("cq-active-speaker"); // activeActorId defaults to the first participant
    expect(buyerBust.className).not.toContain("cq-active-speaker");
  });

  it("ASK grants the fact through a real GameSession and reveals the dialogue line", () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onWrapUp={vi.fn()}
        />,
      );
    });

    act(() => clickByText(container, "meeting-action-menu", "ASK"));
    expect(container.querySelector('[data-testid="meeting-ask-panel"]')).not.toBeNull();

    expect(session.isFactGathered("fact_capacity")).toBe(false);
    act(() => clickByText(container, "meeting-ask-panel", "Roasting capacity"));

    expect(session.isFactGathered("fact_capacity")).toBe(true);
    expect(session.meetingState()?.topicsByActor.roaster[0].asked).toBe(true);
    // Revealed via the shared "revealing" phase's MessageBox/Typewriter.
    expect(container.querySelector('[data-testid="message-box"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="typewriter"]')).not.toBeNull();
  });

  it("SAY with no host callback falls back to a synchronous canned line", () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onWrapUp={vi.fn()}
        />,
      );
    });

    act(() => clickByText(container, "meeting-action-menu", "SAY"));
    act(() => clickByText(container, "choice-box", "@Sam"));
    expect(container.querySelector('[data-testid="meeting-say-panel"]')).not.toBeNull();

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="meeting-say-textarea"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "What about pricing?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => container.querySelector<HTMLElement>('[data-testid="meeting-say-submit"]')!.click());

    // No `onSay` prop wired — straight to the shared "revealing" phase with a
    // canned line, never `thinking`/`streaming`.
    expect(container.querySelector('[data-testid="meeting-thinking"]')).toBeNull();
    expect(container.querySelector('[data-testid="meeting-stream"]')).toBeNull();
    expect(container.querySelector('[data-testid="typewriter"]')).not.toBeNull();
  });

  it("SAY streams tokens through an injected onSay callback (thinking -> streaming -> revealing)", async () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    async function* fakeStream() {
      yield { actorId: "roaster", token: "Sure" };
      yield { actorId: "roaster", token: ", let's talk.", done: true };
    }
    const onSay = vi.fn().mockReturnValue(fakeStream());

    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onSay={onSay}
          onWrapUp={vi.fn()}
        />,
      );
    });

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

    expect(onSay).toHaveBeenCalledWith({ target: { actorId: "roaster" }, text: "Tell me more" });
    expect(container.querySelector('[data-testid="typewriter"]')).not.toBeNull();
  });

  it("SAY targeted @ALL passes target 'all' to the onSay callback", async () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    async function* fakeStream() {
      yield { actorId: "roaster", token: "We all agree.", done: true };
    }
    const onSay = vi.fn().mockReturnValue(fakeStream());

    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onSay={onSay}
          onWrapUp={vi.fn()}
        />,
      );
    });

    act(() => clickByText(container, "meeting-action-menu", "SAY"));
    act(() => clickByText(container, "choice-box", "@ALL"));
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="meeting-say-textarea"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Thoughts, everyone?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="meeting-say-submit"]')!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSay).toHaveBeenCalledWith({ target: "all", text: "Thoughts, everyone?" });
    expect(container.querySelector('[data-testid="typewriter"]')).not.toBeNull();
  });

  it("SAY recovers from a host stream that throws mid-iteration (no stuck phase, diegetic fallback line)", async () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    async function* brokenStream(): AsyncGenerator<{ actorId: string; token?: string; done?: boolean }> {
      yield { actorId: "roaster", token: "Well" };
      throw new Error("SSE connection dropped");
    }
    const onSay = vi.fn().mockReturnValue(brokenStream());

    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onSay={onSay}
          onWrapUp={vi.fn()}
        />,
      );
    });

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

    // Not stuck in thinking/streaming — landed on the shared revealing phase.
    expect(container.querySelector('[data-testid="meeting-thinking"]')).toBeNull();
    expect(container.querySelector('[data-testid="meeting-stream"]')).toBeNull();
    const typewriter = container.querySelector<HTMLElement>('[data-testid="typewriter"]');
    expect(typewriter).not.toBeNull();
    // Skip the type-out (click = advance-to-fully-typed) and read the line.
    act(() => typewriter!.click());
    expect(typewriter!.textContent).toContain("the line goes quiet");

    // And the player can advance back to the action menu — fully recovered.
    act(() => typewriter!.click());
    expect(container.querySelector('[data-testid="meeting-action-menu"]')).not.toBeNull();
  });

  it("SAY shows the same fallback line when the stream ends with no tokens (empty reply)", async () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    async function* emptyStream() {
      yield { actorId: "roaster", done: true };
    }
    const onSay = vi.fn().mockReturnValue(emptyStream());

    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onSay={onSay}
          onWrapUp={vi.fn()}
        />,
      );
    });

    act(() => clickByText(container, "meeting-action-menu", "SAY"));
    act(() => clickByText(container, "choice-box", "@Sam"));
    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="meeting-say-textarea"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Anything?");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="meeting-say-submit"]')!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const typewriter = container.querySelector<HTMLElement>('[data-testid="typewriter"]');
    expect(typewriter).not.toBeNull();
    act(() => typewriter!.click());
    expect(typewriter!.textContent).toContain("the line goes quiet");
  });

  // Final review (C6 — locked spec decision #2, hybrid conversation): ASK must also
  // reach the persona LLM when a host chat callback is wired — the fact grant stays
  // deterministic (meetingAsk, unconditionally), but the *displayed* reply routes
  // through the same thinking -> streaming -> revealing path as SAY instead of the
  // synchronous canned line.
  it("ASK routes the suggested question through an injected onSay callback (fact still granted deterministically; thinking -> streaming -> revealing)", async () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    async function* fakeStream() {
      yield { actorId: "roaster", token: "Sure" };
      yield { actorId: "roaster", token: ", 500 kilos a week.", done: true };
    }
    const onSay = vi.fn().mockReturnValue(fakeStream());

    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onSay={onSay}
          onWrapUp={vi.fn()}
        />,
      );
    });

    act(() => clickByText(container, "meeting-action-menu", "ASK"));
    expect(session.isFactGathered("fact_capacity")).toBe(false);
    await act(async () => {
      clickByText(container, "meeting-ask-panel", "Roasting capacity");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The deterministic grant happens regardless of the display path.
    expect(session.isFactGathered("fact_capacity")).toBe(true);
    expect(onSay).toHaveBeenCalledWith({ target: { actorId: "roaster" }, text: expect.stringContaining("Roasting capacity") });
    const typewriter = container.querySelector<HTMLElement>('[data-testid="typewriter"]');
    expect(typewriter).not.toBeNull();
    act(() => typewriter!.click());
    expect(typewriter!.textContent).toContain("500 kilos a week");
  });

  it("ASK falls back to the real canned dialogue line (not the generic SAY_QUIET_LINE) when the onSay stream throws mid-iteration", async () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    async function* brokenStream(): AsyncGenerator<{ actorId: string; token?: string; done?: boolean }> {
      yield { actorId: "roaster", token: "Well" };
      throw new Error("SSE connection dropped");
    }
    const onSay = vi.fn().mockReturnValue(brokenStream());

    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onSay={onSay}
          onWrapUp={vi.fn()}
        />,
      );
    });

    act(() => clickByText(container, "meeting-action-menu", "ASK"));
    await act(async () => {
      clickByText(container, "meeting-ask-panel", "Roasting capacity");
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(session.isFactGathered("fact_capacity")).toBe(true); // grant survives the display failure
    const typewriter = container.querySelector<HTMLElement>('[data-testid="typewriter"]');
    expect(typewriter).not.toBeNull();
    act(() => typewriter!.click());
    // The REAL dialogue line (from the toy world's fixture), not the generic filler.
    expect(typewriter!.textContent?.replace(/\s+/g, " ")).toContain("Flat out, we can roast about 500 kilos a week");
    expect(typewriter!.textContent).not.toContain("the line goes quiet");
  });

  it("ASK with no host callback stays the synchronous canned-line path (unaffected)", () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onWrapUp={vi.fn()}
        />,
      );
    });

    act(() => clickByText(container, "meeting-action-menu", "ASK"));
    act(() => clickByText(container, "meeting-ask-panel", "Roasting capacity"));

    expect(container.querySelector('[data-testid="meeting-thinking"]')).toBeNull();
    expect(container.querySelector('[data-testid="meeting-stream"]')).toBeNull();
    const typewriter = container.querySelector<HTMLElement>('[data-testid="typewriter"]');
    expect(typewriter).not.toBeNull();
    act(() => typewriter!.click()); // fully type the current page instantly
    expect(typewriter!.textContent?.replace(/\s+/g, " ")).toContain("Flat out, we can roast about 500 kilos a week");
  });

  // Final review (C4): SAY's stream consumption had no unmount guard — a host stream
  // that resolves/rejects AFTER the component unmounts must neither touch state nor
  // leave the underlying iterator unclosed.
  describe("unmount mid-SAY-stream (C4)", () => {
    /** A fully manual AsyncIterable so the test controls exactly when `next()`
     * resolves and can spy on `return()` (IteratorClose) being called. */
    function controllableStream() {
      let deliver: ((result: IteratorResult<{ actorId: string; token?: string; done?: boolean }>) => void) | null = null;
      const returnSpy = vi.fn(async () => ({ value: undefined, done: true as const }));
      const stream = {
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<{ actorId: string; token?: string; done?: boolean }>>((resolve) => { deliver = resolve; }),
            return: returnSpy,
          };
        },
      };
      return {
        stream,
        pushToken: (token: string) => { deliver?.({ value: { actorId: "roaster", token }, done: false }); deliver = null; },
        returnSpy,
      };
    }

    it("unmounting mid-stream closes the underlying iterator (IteratorClose) instead of leaking it", async () => {
      const session = newSession();
      const view = session.startMeeting(["roaster", "buyer"]);
      const { stream, pushToken, returnSpy } = controllableStream();
      const onSay = vi.fn().mockReturnValue(stream);

      act(() => {
        root.render(
          <MeetingEncounter
            view={view}
            playerName="Maya"
            facts={facts}
            agentSpriteUrl={(i) => `sprite-${i}.png`}
            playerBackUrl="player.png"
            onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
            onSay={onSay}
            onWrapUp={vi.fn()}
          />,
        );
      });

      act(() => clickByText(container, "meeting-action-menu", "SAY"));
      act(() => clickByText(container, "choice-box", "@Sam"));
      const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="meeting-say-textarea"]')!;
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(textarea, "Tell me more");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() => { container.querySelector<HTMLElement>('[data-testid="meeting-say-submit"]')!.click(); });
      expect(container.querySelector('[data-testid="meeting-thinking"]')).not.toBeNull(); // stream hasn't yielded yet

      act(() => root.unmount());
      expect(returnSpy).not.toHaveBeenCalled(); // not yet — the stream never got a chance to notice

      // A token arrives AFTER unmount: consumeMeetingChatStream's next loop iteration
      // must see the cancellation and close the iterator, not keep consuming it.
      await act(async () => {
        pushToken("too late");
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(returnSpy).toHaveBeenCalledTimes(1);
    });

    it("a stream that resolves after unmount does not update state or throw (no post-unmount setState)", async () => {
      const session = newSession();
      const view = session.startMeeting(["roaster", "buyer"]);
      let resolveChunk: ((v: { actorId: string; token?: string; done?: boolean }) => void) | null = null;
      async function* gen(): AsyncGenerator<{ actorId: string; token?: string; done?: boolean }> {
        yield await new Promise((resolve) => { resolveChunk = resolve; });
      }
      const onSay = vi.fn().mockReturnValue(gen());
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        act(() => {
          root.render(
            <MeetingEncounter
              view={view}
              playerName="Maya"
              facts={facts}
              agentSpriteUrl={(i) => `sprite-${i}.png`}
              playerBackUrl="player.png"
              onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
              onSay={onSay}
              onWrapUp={vi.fn()}
            />,
          );
        });

        act(() => clickByText(container, "meeting-action-menu", "SAY"));
        act(() => clickByText(container, "choice-box", "@Sam"));
        const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="meeting-say-textarea"]')!;
        act(() => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
          setter.call(textarea, "Tell me more");
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
        act(() => { container.querySelector<HTMLElement>('[data-testid="meeting-say-submit"]')!.click(); });

        act(() => root.unmount());
        await act(async () => {
          resolveChunk?.({ actorId: "roaster", token: "too late", done: true });
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });

        // No "Can't perform a React state update on an unmounted component" warning —
        // the mounted-ref guard must short-circuit the state setters before React ever
        // sees the call.
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  it("WRAP UP survives a rejecting onSceneWrapUp (fire-and-forget, no unhandled rejection)", async () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    const onWrapUp = vi.fn();
    const onSceneWrapUp = vi.fn().mockRejectedValue(new Error("host down"));
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      act(() => {
        root.render(
          <MeetingEncounter
            view={view}
            playerName="Maya"
            facts={facts}
            agentSpriteUrl={(i) => `sprite-${i}.png`}
            playerBackUrl="player.png"
            onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
            onWrapUp={onWrapUp}
            onSceneWrapUp={onSceneWrapUp}
          />,
        );
      });

      act(() => clickByText(container, "meeting-action-menu", "WRAP UP"));
      await act(async () => {
        clickByText(container, "choice-box", "YES");
        // Let the rejected promise settle (and the unhandledRejection hook
        // fire, if the component failed to catch it).
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(onWrapUp).toHaveBeenCalledTimes(1);
      expect(onSceneWrapUp).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("WRAP UP confirm (YES) fires the onWrapUp callback", () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    const onWrapUp = vi.fn();
    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onWrapUp={onWrapUp}
        />,
      );
    });

    act(() => clickByText(container, "meeting-action-menu", "WRAP UP"));
    act(() => clickByText(container, "choice-box", "YES"));
    expect(onWrapUp).toHaveBeenCalledTimes(1);
  });

  it("WRAP UP confirm (NO) backs out without firing the callback", () => {
    const session = newSession();
    const view = session.startMeeting(["roaster", "buyer"]);
    const onWrapUp = vi.fn();
    act(() => {
      root.render(
        <MeetingEncounter
          view={view}
          playerName="Maya"
          facts={facts}
          agentSpriteUrl={(i) => `sprite-${i}.png`}
          playerBackUrl="player.png"
          onAsk={(actorId, factId) => session.meetingAsk(actorId, factId)}
          onWrapUp={onWrapUp}
        />,
      );
    });

    act(() => clickByText(container, "meeting-action-menu", "WRAP UP"));
    act(() => clickByText(container, "choice-box", "NO"));
    expect(onWrapUp).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="meeting-action-menu"]')).not.toBeNull();
  });
});
