import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { STEP_UP_ACTIONS, isStepUpAction, needsStepUp, mintTrust, readTrust, normaliseCode, TRUST_MINUTES } from "@/lib/stepUp";

const key = crypto.randomBytes(32);

describe("who is asked", () => {
  it("asks managers and owners for every action", () => {
    for (const role of ["owner", "platform_owner", "group_manager", "rep_manager"]) {
      for (const a of Object.keys(STEP_UP_ACTIONS)) expect(needsStepUp(role, a as never)).toBe(true);
    }
  });
  it("asks other roles only when they edit or delete a recorded payment", () => {
    for (const role of ["phone_sales", "field_rep", "delivery_driver"]) {
      expect(needsStepUp(role, "payment_edit")).toBe(true);
      expect(needsStepUp(role, "price_change")).toBe(false);
      expect(needsStepUp(role, "discount_decide")).toBe(false);
    }
  });
  it("knows its actions", () => {
    expect(isStepUpAction("payment_edit")).toBe(true);
    expect(isStepUpAction("toString")).toBe(false);
    expect(isStepUpAction(5)).toBe(false);
  });
});

describe("trusted window", () => {
  const now = 1_800_000_000_000;
  it("trusts the same person for ten minutes", () => {
    const c = mintTrust(key, 7, 3, now);
    expect(readTrust(key, c, 7, 3, now + (TRUST_MINUTES * 60_000 - 1))).not.toBeNull();
    expect(readTrust(key, c, 7, 3, now + TRUST_MINUTES * 60_000 + 1)).toBeNull();
  });
  it("refuses another person, a signed-out token version, a forged or damaged cookie", () => {
    const c = mintTrust(key, 7, 3, now);
    expect(readTrust(key, c, 8, 3, now)).toBeNull();
    expect(readTrust(key, c, 7, 4, now)).toBeNull();
    expect(readTrust(crypto.randomBytes(32), c, 7, 3, now)).toBeNull();
    expect(readTrust(key, c.slice(0, -2) + "xx", 7, 3, now)).toBeNull();
    expect(readTrust(key, "garbage", 7, 3, now)).toBeNull();
    expect(readTrust(key, undefined, 7, 3, now)).toBeNull();
  });
});

describe("normaliseCode", () => {
  it("accepts Persian and Arabic-Indic digits, spaces and dashes", () => {
    expect(normaliseCode("۱۲۳ ۴۵۶")).toBe("123456");
    expect(normaliseCode("٠٩٨-٧٦٥")).toBe("098765");
    expect(normaliseCode("ab12c-d3")).toBe("ab12c" + "d3");
  });
});
