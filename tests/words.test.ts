import { describe, expect, it } from "vitest";
import { splitWords } from "@/lib/words";

describe("splitWords", () => {
  it("splits a Persian heading into whole words", () => {
    expect(splitWords("نقشه پوشش مشتریان")).toEqual(["نقشه", "پوشش", "مشتریان"]);
  });

  it("ignores extra and surrounding whitespace", () => {
    expect(splitWords("  سلام   دنیا ")).toEqual(["سلام", "دنیا"]);
  });

  it("returns nothing for an empty heading", () => {
    expect(splitWords("")).toEqual([]);
  });
});
