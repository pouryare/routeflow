// FieldShapeHint (components/FieldShapeHint.tsx) is the thin view over lib/fieldShape.ts.
import { describe, it, expect } from "vitest";
import { phoneHint } from "@/lib/fieldShape";

describe("live phone check", () => {
  it("says nothing on an empty field", () => expect(phoneHint("  ")).toBeNull());
  it("counts what is missing while typing", () => expect(phoneHint("۰۹۱۲")).toEqual({ tone: "bad", text: "۷ رقم دیگر" }));
  it("ticks a whole number, Persian or Latin digits", () => {
    expect(phoneHint("۰۹۱۲۳۴۵۶۷۸۹")?.tone).toBe("ok");
    expect(phoneHint("+98 912 345 6789")?.tone).toBe("ok");
  });
  it("too long is wrong, not still typing", () => expect(phoneHint("091234567890")?.text).toMatch(/درست نیست/));
});
