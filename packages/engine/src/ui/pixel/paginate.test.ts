// packages/engine/src/ui/pixel/paginate.test.ts
import { describe, it, expect } from "vitest";
import { paginate } from "./paginate";

describe("paginate", () => {
  it("wraps words into lines of at most cols chars", () => {
    expect(paginate("one two three four", 9, 2)).toEqual([["one two", "three"], ["four"]]);
  });
  it("puts short text on a single page", () => {
    expect(paginate("Hello", 20, 2)).toEqual([["Hello"]]);
  });
  it("hard-splits words longer than cols", () => {
    expect(paginate("abcdefghij", 4, 2)).toEqual([["abcd", "efgh"], ["ij"]]);
  });
  it("returns one empty page for empty text", () => {
    expect(paginate("", 10, 2)).toEqual([[""]]);
  });
  it("respects the lines-per-page limit", () => {
    const pages = paginate("a b c d e f", 1, 2);
    expect(pages).toEqual([["a", "b"], ["c", "d"], ["e", "f"]]);
  });
  it("clamps degenerate cols/lines instead of hanging", () => {
    expect(paginate("ab", 0, 2)).toEqual([["a", "b"]]);
    expect(paginate("a b", 5, 0)).toEqual([["a b"]]);
  });
});
