// CharCount (components/CharCount.tsx) is the thin view over lib/charCount.ts.
import { describe, it, expect } from "vitest";
import { charCount } from "@/lib/charCount";

describe("letter counter", () => {
  it("counts letters in Persian digits", () => expect(charCount("سلام", 70)).toMatchObject({ label: "۴/۷۰", over: false }));
  it("turns red past the limit", () => expect(charCount("a".repeat(71), 70).over).toBe(true));
  it("fills the ring by share", () => expect(charCount("a".repeat(35), 70).share).toBe(0.5));
});
