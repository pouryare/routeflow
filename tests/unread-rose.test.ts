import { describe, it, expect } from "vitest";
import { unreadRose } from "@/lib/unreadRose";

describe("the bell swings only for news", () => {
  it("not for the first count after the page loads", () => expect(unreadRose(null, 3)).toBe(false));
  it("not when the count stays or falls (notifications were read)", () => {
    expect(unreadRose(3, 3)).toBe(false);
    expect(unreadRose(3, 0)).toBe(false);
  });
  it("yes when it goes up", () => expect(unreadRose(0, 1)).toBe(true));
});
