import { describe, it, expect } from "vitest";
import { auditLines, auditOp, auditTable } from "@/lib/auditLabels";

describe("audit labels", () => {
  it("reads a change as «column: old ← new»", () => {
    expect(auditLines(JSON.stringify({ credit_limit_toman: { old: 1000, new: 5000 } }))).toEqual(["سقف اعتبار (تومان): 1000 ← 5000"]);
  });
  it("shows an insert or delete with the one value it has, and a missing value as a dash", () => {
    expect(auditLines(JSON.stringify({ role: { new: "owner" } }))).toEqual(["نقش: owner"]);
    expect(auditLines(JSON.stringify({ voided_at: { old: null, new: "2026-01-01" } }))).toEqual(["زمان ابطال: — ← 2026-01-01"]);
  });
  it("never throws on bad JSON and falls back to the raw names", () => {
    expect(auditLines("not json")).toEqual([]);
    expect(auditTable("mystery")).toBe("mystery");
    expect(auditOp("update")).toBe("تغییر کرد");
  });
});
