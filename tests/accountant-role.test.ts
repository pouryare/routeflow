import { describe, it, expect } from "vitest";
import { ACCOUNTING_ROLES, ROLE_LABEL, isAccountantPath, homePathFor } from "@/lib/roles";
import { canReadAccounting } from "@/lib/accountingGate";

process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { accountIdByCode } = await import("@/lib/repo/ledger");
const { postManualJournal, reverseManualJournal } = await import("@/lib/repo/manualJournal");
const { appTabs } = await import("@/lib/appNav");
const { proxy } = await import("@/proxy");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { NextRequest } = await import("next/server");

const asAccountant = (p: string) =>
  proxy(new NextRequest(`http://localhost${p}`, { headers: { cookie: `${COOKIE_NAME}=${createSessionToken({ uid: 1, role: "accountant", gid: null, oid: 1, tv: 0, name: "t" })}` } }));

describe("H3 accountant role (gates)", () => {
  it("reads the books but is not an owner", () => {
    expect(ACCOUNTING_ROLES).toContain("accountant");
    expect(ROLE_LABEL.accountant).toBe("حسابدار");
    expect(canReadAccounting("accountant", "/accounting/trial-balance")).toBe(true);
    expect(canReadAccounting("accountant", "/accounting/shareholders")).toBe(false);
    expect(homePathFor("accountant")).toBe("/accounting/journal");
  });
  it("is confined to the books", () => {
    expect(isAccountantPath("/accounting/journal")).toBe(true);
    expect(isAccountantPath("/api/accounting/periods")).toBe(true);
    expect(isAccountantPath("/sales/admin/users")).toBe(false);
    expect(asAccountant("/accounting/trial-balance").status).toBe(200);
    expect(asAccountant("/sales/admin/users").status).toBe(307);
    expect(asAccountant("/api/admin/users").status).toBe(403);
    expect(asAccountant("/api/accounting/periods").status).toBe(200);
    expect(asAccountant("/api/accounting/shareholders").status).toBe(403);
  });
  it("sees only accounting tabs", () => {
    const tabs = appTabs({ role: "accountant" });
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs.every((t) => t.href.startsWith("/accounting/"))).toBe(true);
  });
});

describe("H3 manual entries", () => {
  it("posts a balanced MANUAL entry, refuses bad ones, and reverses only manual entries", async () => {
    const db = getDb();
    await db.prepare(`INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at) VALUES (1,'ac','x','A','accountant',1,'2026-01-01') ON CONFLICT DO NOTHING`).run();
    const cash = (await accountIdByCode("1101"))!;
    const bank = (await accountIdByCode("1102"))!;
    await expect(postManualJournal(1, 1, { debitAccountId: cash, creditAccountId: cash, amountToman: 5, memo: "x" })).rejects.toThrow();
    await expect(postManualJournal(1, 1, { debitAccountId: cash, creditAccountId: bank, amountToman: 5, memo: " " })).rejects.toThrow(/شرح/);
    await expect(postManualJournal(1, 1, { debitAccountId: cash, creditAccountId: bank, amountToman: 1.5, memo: "x" })).rejects.toThrow();
    const id = await postManualJournal(1, 1, { debitAccountId: bank, creditAccountId: cash, amountToman: 700, memo: "کارمزد" });
    const row = (await db.prepare("SELECT source_type, memo FROM journals WHERE id = ?").get(id)) as { source_type: string; memo: string };
    expect(row.source_type).toBe("MANUAL");
    await expect(reverseManualJournal(1, id, 1, "")).rejects.toThrow(/دلیل/);
    const rev = await reverseManualJournal(1, id, 1, "اشتباه");
    expect(rev).toBeGreaterThan(id);
    await expect(reverseManualJournal(1, id, 1, "دوباره")).rejects.toThrow(/قبلاً/);
    await expect(reverseManualJournal(1, rev, 1, "x")).rejects.toThrow(/پیدا نشد/);
  });
});
