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
