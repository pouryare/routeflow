import { describe, it, expect } from "vitest";
import { viewingText } from "@/components/ViewingChip";

describe("who else has this open (L6)", () => {
  it("says nothing when you are the only one", () => {
    expect(viewingText([], 1, "order")).toBeNull();
    expect(viewingText([{ id: 1, name: "سارا" }], 1, "order")).toBeNull();
  });
  it("names the other person, or the first and how many more", () => {
    expect(viewingText([{ id: 1, name: "سارا" }, { id: 2, name: "مدیر" }], 1, "order")).toBe("مدیر هم این سفارش را باز کرده است");
    expect(viewingText([{ id: 2, name: "مدیر" }, { id: 3, name: "رضا" }, { id: 4, name: "مینا" }], 1, "run")).toBe(
      "مدیر و ۲ نفر دیگر هم این مسیر را باز کرده‌اند"
    );
  });
});
