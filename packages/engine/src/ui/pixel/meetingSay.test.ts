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

  // Final review (C4): unmount-mid-stream cancellation seam.
  describe("isCancelled cancellation (C4)", () => {
    it("stops consuming (and stops reporting progress) once isCancelled returns true", async () => {
      const progress: string[] = [];
      let cancelled = false;
      const result = await consumeMeetingChatStream(
        gen([
          { actorId: "roaster", token: "Well" },
          { actorId: "roaster", token: ", sure." },
          { actorId: "roaster", token: " more!", done: true },
        ]),
        (partial) => {
          progress.push(partial);
          if (partial === "Well") cancelled = true; // cancel right after the first chunk
        },
        () => cancelled,
      );
      expect(progress).toEqual(["Well"]); // the second chunk was never reported
      expect(result.text).toBe("Well"); // stopped before accumulating further tokens
    });

    it("calling .return() on the underlying iterator (IteratorClose) happens when a cancelled loop breaks early", async () => {
      const returnSpy = { called: false };
      const stream: AsyncIterable<MeetingChatChunk> = {
        [Symbol.asyncIterator]() {
          let i = 0;
          const chunks: MeetingChatChunk[] = [{ actorId: "roaster", token: "a" }, { actorId: "roaster", token: "b" }];
          return {
            next: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }),
            return: async () => { returnSpy.called = true; return { value: undefined, done: true as const }; },
          };
        },
      };
      await consumeMeetingChatStream(stream, () => {}, () => true); // cancelled from the very first chunk
      expect(returnSpy.called).toBe(true);
    });

    it("without isCancelled, behaves exactly as before (no cancellation checks)", async () => {
      const result = await consumeMeetingChatStream(
        gen([{ actorId: "roaster", token: "hi", done: true }]),
        () => {},
      );
      expect(result.text).toBe("hi");
    });
  });
});

describe("cannedSayLine", () => {
  it("is a deterministic, non-empty line mentioning the target", () => {
    expect(cannedSayLine("Sam")).toContain("Sam");
    expect(cannedSayLine("Sam")).toBe(cannedSayLine("Sam"));
  });
});
