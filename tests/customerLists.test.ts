import { describe, expect, it } from "vitest";
import { addRecent, pruneIds, toggleId } from "@/lib/customerLists";

describe("addRecent", () => {
  it("puts the newest first", () => {
    expect(addRecent([2, 3], 1)).toEqual([1, 2, 3]);
  });

  it("moves a repeat view to the top instead of duplicating it", () => {
    // Opening the same shop twice in a morning is the normal case, and it must not fill
    // the list with copies of itself.
    expect(addRecent([1, 2, 3], 2)).toEqual([2, 1, 3]);
  });

  it("caps the list, dropping the oldest", () => {
    expect(addRecent([1, 2, 3], 9, 3)).toEqual([9, 1, 2]);
  });
});

describe("toggleId", () => {
  it("pins to the top", () => {
    expect(toggleId([5], 7)).toEqual([7, 5]);
  });

  it("unpins", () => {
    expect(toggleId([7, 5], 7)).toEqual([5]);
  });
});

describe("pruneIds", () => {
  it("drops ids that no longer exist", () => {
    // A customer removed from the source spreadsheet would otherwise sit in the pinned
    // list forever as a row that opens nothing.
    expect(pruneIds([1, 2, 3], new Set([1, 3]))).toEqual([1, 3]);
  });

  it("keeps order", () => {
    expect(pruneIds([3, 1, 2], new Set([1, 2, 3]))).toEqual([3, 1, 2]);
  });
});
