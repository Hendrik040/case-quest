import { describe, it, expect } from "vitest";
import { buildMeetingAskOptions, meetingAskDisabled } from "./meetingAskOptions";
import type { MeetingView } from "../../state/session";

function view(overrides?: Partial<MeetingView>): MeetingView {
  return {
    participants: [
      { actorId: "roaster", name: "Sam", role: "Roaster", paletteIndex: 0 },
      { actorId: "buyer", name: "Priya", role: "Buyer", paletteIndex: 1 },
    ],
    activeActorId: "roaster",
    topicsByActor: {
      roaster: [{ factId: "fact_capacity", label: "Capacity", asked: false }],
      buyer: [{ factId: "fact_contract", label: "Contract", asked: true }],
    },
    ...overrides,
  };
}

describe("buildMeetingAskOptions", () => {
  it("emits a disabled header per participant followed by their topics", () => {
    const options = buildMeetingAskOptions(view());
    expect(options).toEqual([
      { id: "header:roaster", label: "SAM", header: true, disabled: true },
      { id: "fact_capacity", label: "Capacity", disabled: false, actorId: "roaster" },
      { id: "header:buyer", label: "PRIYA", header: true, disabled: true },
      { id: "fact_contract", label: "Contract", disabled: true, actorId: "buyer" },
    ]);
  });

  it("still emits a header for a participant with zero topics", () => {
    const options = buildMeetingAskOptions(view({ topicsByActor: { roaster: [], buyer: [] } }));
    expect(options).toEqual([
      { id: "header:roaster", label: "SAM", header: true, disabled: true },
      { id: "header:buyer", label: "PRIYA", header: true, disabled: true },
    ]);
  });
});

describe("meetingAskDisabled", () => {
  it("is false when at least one participant has a topic (even if all asked)", () => {
    expect(meetingAskDisabled(view())).toBe(false);
    expect(meetingAskDisabled(view({
      topicsByActor: {
        roaster: [{ factId: "fact_capacity", label: "Capacity", asked: true }],
        buyer: [],
      },
    }))).toBe(false);
  });

  it("is true only when every participant has zero topics", () => {
    expect(meetingAskDisabled(view({ topicsByActor: { roaster: [], buyer: [] } }))).toBe(true);
  });
});
