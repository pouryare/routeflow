import { describe, expect, it } from "vitest";
import { pullOffset, pullReady } from "@/lib/pullToRefresh";

describe("pull to refresh", () => {
  it("follows the finger at half speed", () => {
    expect(pullOffset(80)).toBe(40);
  });
  it("never goes up and stops at the maximum", () => {
    expect(pullOffset(-30)).toBe(0);
    expect(pullOffset(1000)).toBe(96);
  });
  it("refreshes only past the trigger", () => {
    expect(pullReady(pullOffset(100))).toBe(false);
    expect(pullReady(pullOffset(140))).toBe(true);
  });
});
