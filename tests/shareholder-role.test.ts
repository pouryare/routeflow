import { quickActionsFor } from "@/lib/mobileNav";
import { describe, it, expect, beforeAll } from "vitest";
import { ROLES, homePathFor, hasSyncClient, isShareholderPath, roleLabel, type Role } from "@/lib/roles";

process.env.SESSION_SECRET = "test-secret";

const { proxy } = await import("@/proxy");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
const { appTabs } = await import("@/lib/appNav");
const { NextRequest } = await import("next/server");
const { getDb } = await import("@/lib/db");
const { addShareholder, setShares } = await import("@/lib/repo/shareholders");
const { postCapitalContribution, myShare } = await import("@/lib/repo/profitSplit");

function req(pathname: string, role: Role) {
  const token = createSessionToken({ uid: 1, role, gid: null, oid: 1, tv: 0, name: "t" });
  return new NextRequest(`http://localhost${pathname}`, { headers: { cookie: `${COOKIE_NAME}=${token}` } });
}

describe("the shareholder role", () => {
  it("is a role with a Persian name, a home page of its own and one tab", () => {
    expect(ROLES).toContain("shareholder");
    expect(roleLabel("shareholder")).toBe("شریک");
    expect(homePathFor("shareholder")).toBe("/my-share");
    expect(appTabs({ role: "shareholder" }).filter((t) => t.ready).map((t) => t.href)).toEqual(["/my-share"]);
    expect(hasSyncClient("shareholder")).toBe(false);
  });

  it("is confined by the gate to its own page, its settings and signing out", () => {
    for (const ok of ["/my-share", "/settings/security", "/api/logout", "/api/me", "/password", "/icon.png"]) {
      expect(proxy(req(ok, "shareholder")).status, ok).toBe(200);
      expect(isShareholderPath(ok)).toBe(true);
    }
  });

  it("is refused everywhere else: the sales shell, the books and every API", () => {
    for (const path of ["/sales/today", "/sales", "/accounting/shareholders", "/accounting/trial-balance", "/crm", "/driver", "/map", "/planner", "/sales/admin/users", "/"]) {
      const res = proxy(req(path, "shareholder"));
      expect(res.status, path).toBe(307);
      expect(res.headers.get("location"), path).toContain("/my-share");
    }
    for (const api of ["/api/customers", "/api/accounting/shareholders", "/api/accounting/profit-split", "/api/sales/orders", "/api/sync/pull", "/api/admin/users", "/api/today"]) {
      expect(proxy(req(api, "shareholder")).status, api).toBe(403);
    }
  });

  it("does not look like a path prefix trick", () => {
    expect(isShareholderPath("/my-share-evil")).toBe(false);
    expect(isShareholderPath("/api/meetings")).toBe(false);
    expect(isShareholderPath("/api/me/../customers")).toBe(false);
    expect(isShareholderPath("/api/customers/1.json")).toBe(false); // a file extension does not turn an API path into an asset
    expect(isShareholderPath("/my-share/%2e%2e/sales")).toBe(false);
  });
});

describe("what a shareholder is shown", () => {
  const ctx = { owner: 0, ali: 0, sara: 0 };
  beforeAll(async () => {
    const db = getDb();
    const now = new Date().toISOString();
    ctx.owner = Number((await db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES ('o','x','مالک','owner',1,?,1)").run(now)).lastInsertRowid);
    // The new role can be stored.
    await db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES ('inv','x','سرمایه‌گذار','shareholder',1,?,1)").run(now);
    ctx.ali = await addShareholder(db, { organizationId: 1, name: "علی" });
    ctx.sara = await addShareholder(db, { organizationId: 1, name: "سارا" });
    await setShares(db, { organizationId: 1, groupId: null, validFrom: "2020-01-01", createdBy: ctx.owner, shares: [{ partyId: ctx.ali, percentBp: 7000 }, { partyId: ctx.sara, percentBp: 3000 }] });
    await postCapitalContribution(db, { organizationId: 1, partyId: ctx.ali, amountToman: 5000, method: "CASH", paidOn: "2026-02-01", createdBy: ctx.owner });
    await postCapitalContribution(db, { organizationId: 1, partyId: ctx.sara, amountToman: 999, method: "CASH", paidOn: "2026-02-01", createdBy: ctx.owner });
  });

  it("is that person's own figures only", async () => {
    const mine = await myShare(getDb(), 1, ctx.ali, 1405);
    expect(mine).toMatchObject({ name: "علی", capitalToman: 5000, shares: [{ scope: "کل شرکت", percentBp: 7000 }] });
    const text = JSON.stringify(mine);
    expect(text).not.toContain("سارا");
    expect(text).not.toContain("999");
    expect(text).not.toContain("3000");
  });

  it("is nothing for a party that is not a shareholder of this company", async () => {
    expect(await myShare(getDb(), 1, 999999, 1405)).toBeNull();
    expect(await myShare(getDb(), 2, ctx.ali, 1405)).toBeNull(); // another company's id
  });

  it("is offered no quick action, because every one of them writes", () => {
    expect(quickActionsFor({ role: "shareholder" })).toEqual([]);
  });
});
