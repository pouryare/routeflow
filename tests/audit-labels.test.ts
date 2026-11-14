import { describe, it, expect } from "vitest";
import { auditLines, auditOp, auditTable } from "@/lib/auditLabels";

describe("audit labels", () => {
  it("reads a change as «column: old ← new»", () => {
    expect(auditLines(JSON.stringify({ credit_limit_toman: { old: 1000, new: 5000 } }))).toEqual(["سقف اعتبار (تومان): 1000 ← 5000"]);
  });
  it("shows an insert or delete with the one value it has, and a missing value as a dash", () => {
    expect(auditLines(JSON.stringify({ role: { new: "owner" } }))).toEqual(["نقش: مالک"]);
    expect(auditLines(JSON.stringify({ voided_at: { old: null, new: "2026-01-01" } }))).toEqual(["زمان ابطال: — ← 2026-01-01"]);
  });
  it("never throws on bad JSON and falls back to the raw names", () => {
    expect(auditLines("not json")).toEqual([]);
    expect(auditTable("mystery")).toBe("mystery");
    expect(auditOp("update")).toBe("تغییر کرد");
  });
});

describe("audit labels, readable (T6)", () => {
  it("shows names for ids, switches as yes or no, and Persian labels for roles and stages", async () => {
    const { auditRefs } = await import("@/lib/auditLabels");
    const changes = JSON.stringify({ owner_user_id: { old: 3, new: 4 }, role: { old: "phone_sales", new: "owner" }, hard_credit_block: { old: 0, new: 1 }, lifecycle: { old: "lead", new: "active" } });
    const names = { user: new Map([[3, "رضا"], [4, "سارا"]]) };
    expect(auditLines(changes, names)).toEqual(["مالک: رضا ← سارا", "نقش: فروش تلفنی ← مالک", "مسدودی اعتبار: خیر ← بله", "مرحلهٔ مشتری: سرنخ ← فعال"]);
    expect(auditRefs(changes)).toEqual([{ kind: "user", id: 3 }, { kind: "user", id: 4 }]);
  });
  it("falls back to the number when a name is gone, and reads the two-step switch", () => {
    expect(auditLines(JSON.stringify({ owner_user_id: { new: 99 } }), { user: new Map() })).toEqual(["مالک: #99"]);
    expect(auditLines(JSON.stringify({ totp_enabled_at: { old: null, new: "2026-01-01T00:00:00Z" } }))).toEqual(["ورود دومرحله‌ای: خاموش ← روشن"]);
  });
});
