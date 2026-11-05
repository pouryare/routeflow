// SwipeRow's peek hint (lib/peekHint.ts): once per kind of list, only the first row.
import { describe, expect, it } from "vitest";
import { claimPeek } from "@/lib/peekHint";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("peek hint", () => {
  it("plays for the first row of a kind only, and never again once seen", () => {
    const s = mem();
    expect(claimPeek("orders", s)).toBe(true);
    expect(claimPeek("orders", s)).toBe(false);
    expect(claimPeek("tasks", s)).toBe(true);
  });
  it("stays quiet when storage is missing or throws", () => {
    expect(claimPeek("notifications", null)).toBe(false);
  });
});
