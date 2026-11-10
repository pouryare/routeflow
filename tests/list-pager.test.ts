import { describe, expect, it } from "vitest";
import { pageWindow } from "@/lib/pageWindow";

// components/mobile/ListPager.tsx draws these slots with HeroUI Pagination.
describe("ListPager page window", () => {
  it("shows every page when there are five or fewer", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it("keeps the first, last and current page in the middle", () => {
    expect(pageWindow(6, 20)).toEqual([1, "gap", 6, "gap", 20]);
  });
  it("shows the three pages at an end instead of a lone gap", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, "gap", 20]);
    expect(pageWindow(3, 20)).toEqual([1, 2, 3, "gap", 20]);
    expect(pageWindow(18, 20)).toEqual([1, "gap", 18, 19, 20]);
    expect(pageWindow(20, 20)).toEqual([1, "gap", 18, 19, 20]);
    expect(pageWindow(4, 6)).toEqual([1, "gap", 4, 5, 6]);
  });
  it("never shows more than five slots, and clamps a page outside the range", () => {
    for (let p = 1; p <= 30; p++) expect(pageWindow(p, 30).length).toBeLessThanOrEqual(5);
    expect(pageWindow(99, 20)).toEqual(pageWindow(20, 20));
  });
});
