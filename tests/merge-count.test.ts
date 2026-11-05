import { describe, it, expect } from "vitest";
import { foldAmounts, withCount } from "@/lib/mergeCount";

describe("matching messages join into one card", () => {
  it("one message keeps its words", () => expect(withCount("ثبت شد", 1)).toBe("ثبت شد"));
  it("a repeat shows ×N in Persian digits", () => expect(withCount("ثبت شد", 3)).toBe("ثبت شد ×۳"));
  it("folded pings count and add up", () =>
    expect(foldAmounts([{ total_toman: 12_000_000 }, { total_toman: 24_000_000 }])).toEqual({ count: 2, total: 36_000_000 }));
});
