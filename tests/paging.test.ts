import { describe, it, expect } from "vitest";
import { pagingFor, requestedPage, pageHref } from "@/lib/paging";

describe("pagingFor", () => {
  it("defaults to page 1 for missing or junk input", () => {
    for (const raw of [undefined, "", "abc", "-3", "1.5", "0"]) {
      expect(pagingFor(raw, 250, 100).page, String(raw)).toBe(1);
    }
  });
  it("computes offset and page count", () => {
    expect(pagingFor("2", 250, 100)).toEqual({ page: 2, pageCount: 3, offset: 100, limit: 100 });
  });
  it("clamps a page past the end to the last page", () => {
    expect(pagingFor("99", 250, 100)).toMatchObject({ page: 3, offset: 200 });
  });
  it("an empty list is one empty page, not zero pages", () => {
    expect(pagingFor(undefined, 0, 100)).toEqual({ page: 1, pageCount: 1, offset: 0, limit: 100 });
  });
  it("exact multiples do not add a phantom page", () => {
    expect(pagingFor("2", 200, 100).pageCount).toBe(2);
  });
});

describe("requestedPage", () => {
  it("reads a positive integer and nothing else", () => {
    expect(requestedPage("4")).toBe(4);
    expect(requestedPage("0")).toBe(1);
    expect(requestedPage("x")).toBe(1);
    expect(requestedPage(undefined)).toBe(1);
  });
});

describe("pageHref", () => {
  it("keeps filters, drops empties, omits page 1", () => {
    expect(pageHref("/accounting/journal", { period: "1405-06", source: "" }, 1)).toBe("/accounting/journal?period=1405-06");
    expect(pageHref("/accounting/journal", { period: "1405-06" }, 3)).toBe("/accounting/journal?period=1405-06&page=3");
    expect(pageHref("/accounting/journal", {}, 1)).toBe("/accounting/journal");
  });
  it("encodes values", () => {
    expect(pageHref("/x", { source: "a b&c" }, 2)).toBe("/x?source=a+b%26c&page=2");
  });
});
