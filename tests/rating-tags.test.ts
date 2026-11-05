import { describe, expect, it } from "vitest";
import { DEFAULT_RATING_TAGS, parseRatingTags, readRatingTags, tagsForStars } from "@/lib/ratingTags";

describe("rating tags", () => {
  const tags = { good: ["خوب"], low: ["بد"] };

  it("offers good tags for high stars, low for low, both in between, none before stars", () => {
    expect(tagsForStars(tags, [5, 4, 4])).toEqual(["خوب"]);
    expect(tagsForStars(tags, [1, 2, 2])).toEqual(["بد"]);
    expect(tagsForStars(tags, [3, 3, 3])).toEqual(["خوب", "بد"]);
    expect(tagsForStars(tags, [null, undefined])).toEqual([]);
  });

  it("cleans the owner's lists and refuses bad ones", () => {
    expect(parseRatingTags({ good: ["  جای   خوب ", "", "جای خوب"], low: [] })).toEqual({ good: ["جای خوب"], low: [] });
    expect(parseRatingTags({ good: ["الف، ب"], low: [] })).toBeNull();
    expect(parseRatingTags({ good: ["x".repeat(31)], low: [] })).toBeNull();
    expect(parseRatingTags({ good: Array.from({ length: 13 }, (_, i) => `t${i}`), low: [] })).toBeNull();
    expect(parseRatingTags({ good: "x", low: [] })).toBeNull();
  });

  it("reads the stored column, falling back to the defaults", () => {
    expect(readRatingTags(null)).toBe(DEFAULT_RATING_TAGS);
    expect(readRatingTags("not json")).toBe(DEFAULT_RATING_TAGS);
    expect(readRatingTags(JSON.stringify(tags))).toEqual(tags);
  });
});
