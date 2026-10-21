import { describe, it, expect } from "vitest";
import { autoOpenFlow } from "@/lib/flows/autoOpen";

describe("opening a page's flow from a link", () => {
  it("opens when the parameter is 1", () => {
    expect(autoOpenFlow("new", "?new=1")).toEqual({ key: 1, open: true });
    expect(autoOpenFlow("quick", "?customer=5&quick=1")).toEqual({ key: 1, open: true });
  });
  it("stays closed otherwise, so an ordinary visit never pops a sheet", () => {
    expect(autoOpenFlow("new", "")).toEqual({ key: 0, open: false });
    expect(autoOpenFlow("new", "?new=0")).toEqual({ key: 0, open: false });
    expect(autoOpenFlow("new", "?other=1")).toEqual({ key: 0, open: false });
    expect(autoOpenFlow("new", "?new=true")).toEqual({ key: 0, open: false });
  });
});
