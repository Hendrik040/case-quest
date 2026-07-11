import { describe, it, expect } from "vitest";
import { consumeMeetingChatStream, cannedSayLine, type MeetingChatChunk } from "./meetingSay";

async function* gen(chunks: MeetingChatChunk[]): AsyncIterable<MeetingChatChunk> {
  for (const c of chunks) yield c;
}

describe("consumeMeetingChatStream", () => {
  it("accumulates tokens in order and reports progress after each", () => {
    const progress: string[] = [];
    return consumeMeetingChatStream(
      gen([{ actorId: "roaster", token: "Well" }, { actorId: "roaster", token: ", " }, { actorId: "roaster", token: "sure.", done: true }]),
      (partial) => progress.push(partial),
    ).then((result) => {
      expect(progress).toEqual(["Well", "Well, ", "Well, sure."]);
      expect(result).toEqual({ text: "Well, sure.", sceneCompleted: false });
    });
  });

  it("stops at the first done:true chunk even if the iterator yields more", async () => {
    const progress: string[] = [];
    const result = await consumeMeetingChatStream(
      gen([
        { actorId: "roaster", token: "ok", done: true },
        { actorId: "roaster", token: "should not appear" },
      ]),
      (partial) => progress.push(partial),
    );
    expect(result.text).toBe("ok");
    expect(progress).toEqual(["ok"]);
  });

  it("propagates sceneCompleted when any chunk sets it", async () => {
    const result = await consumeMeetingChatStream(
      gen([{ actorId: "roaster", token: "done here", sceneCompleted: true, done: true }]),
      () => {},
    );
    expect(result.sceneCompleted).toBe(true);
  });

  it("handles a stream with no tokens at all (empty reply)", async () => {
    const result = await consumeMeetingChatStream(gen([{ actorId: "roaster", done: true }]), () => {});
    expect(result).toEqual({ text: "", sceneCompleted: false });
  });
});

describe("cannedSayLine", () => {
  it("is a deterministic, non-empty line mentioning the target", () => {
    expect(cannedSayLine("Sam")).toContain("Sam");
    expect(cannedSayLine("Sam")).toBe(cannedSayLine("Sam"));
  });
});
