import { describe, it, expect } from "vitest";
import { uuidv7, uuidv7Time, UUIDV7_RE } from "@/lib/offline/uuidv7";

describe("uuidv7", () => {
  it("has the RFC-9562 shape", () => {
    for (let i = 0; i < 50; i++) expect(uuidv7()).toMatch(UUIDV7_RE);
  });

  it("packs the injected millisecond and reads it back", () => {
    const t = 1_767_225_600_000; // 2026-01-01T00:00:00Z
    expect(uuidv7Time(uuidv7(t))).toBe(t);
  });

  it("sorts by time -- an id 2 ms later is strictly greater as a string", () => {
    const a = uuidv7(1_000_000_000_000);
    const b = uuidv7(1_000_000_000_002);
    expect(a < b).toBe(true);
  });

  it("does not collide across many draws in the same millisecond", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(uuidv7(1_700_000_000_000));
    expect(seen.size).toBe(5000);
  });
});
