import { describe, it, expect } from "vitest";
import { HOLD_MS, holdProgress, startsHold } from "@/lib/holdPress";

describe("hold to confirm", () => {
  it("fills from 0 to 1 over the hold time and stays inside that range", () => {
    expect(holdProgress(0)).toBe(0);
    expect(holdProgress(HOLD_MS / 2)).toBe(0.5);
    expect(holdProgress(HOLD_MS)).toBe(1);
    expect(holdProgress(HOLD_MS * 3)).toBe(1);
    expect(holdProgress(-5)).toBe(0);
  });
  it("a zero hold time is already done", () => {
    expect(holdProgress(0, 0)).toBe(1);
  });
  it("Space and Enter start a hold once; a key repeat does not", () => {
    expect(startsHold(" ", false)).toBe(true);
    expect(startsHold("Enter", false)).toBe(true);
    expect(startsHold("Enter", true)).toBe(false);
    expect(startsHold("a", false)).toBe(false);
  });
});
// HoldButton and OtpInput are the thin views over lib/holdPress.ts and lib/stepUp.ts normaliseCode (tests/hold-press.test.ts, tests/step-up.test.ts).
