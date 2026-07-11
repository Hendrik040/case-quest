import { describe, it, expect } from "vitest";
import { SCHEMA_VERSION } from "../src/index";

describe("toolchain", () => {
  it("exports the schema version", () => {
    expect(SCHEMA_VERSION).toBe("0.2");
  });
});
