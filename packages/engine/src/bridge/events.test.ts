import { describe, it, expect, vi } from "vitest";
import { EventBus } from "./events";

describe("EventBus", () => {
  it("delivers emitted payloads to subscribers", () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on("interact:actor", fn);
    bus.emit("interact:actor", { actorId: "roaster" });
    expect(fn).toHaveBeenCalledWith({ actorId: "roaster" });
  });
  it("unsubscribe stops delivery", () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on("interact:fact", fn);
    off();
    bus.emit("interact:fact", { factId: "fact_cash" });
    expect(fn).not.toHaveBeenCalled();
  });
});
