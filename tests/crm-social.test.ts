import { describe, expect, it } from "vitest";
import { normInstagram, instagramUrl } from "@/lib/crm/social";

describe("Instagram page keys", () => {
  it.each(["Kababi.Nayeb", "@Kababi.Nayeb", "instagram.com/Kababi.Nayeb", "https://www.instagram.com/Kababi.Nayeb/?hl=fa"])("normalizes %s", raw => {
    expect(normInstagram(raw)).toBe("kababi.nayeb");
  });
  it.each([null, "", "کافه", "https://evil.test/instagram.com/cafe", "https://instagram.com.evil.test/cafe", "https://instagram.com/p/abc", "https://instagram.com/cafe/reels", "https://instagram.com@evil.test/cafe", "a b", "a".repeat(31)])("rejects non-page input %s", raw => {
    expect(normInstagram(raw)).toBeNull();
  });
  it("builds a page link", () => expect(instagramUrl("cafe_lamiz")).toBe("https://instagram.com/cafe_lamiz"));
});
