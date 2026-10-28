import { describe, it, expect, beforeAll } from "vitest";

process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { POST: SPLIT } = await import("@/app/api/accounting/profit-split/route");
const { POST: PAY } = await import("@/app/api/accounting/shareholders/payments/route");
const { POST: RULE } = await import("@/app/api/accounting/cost-rules/route");
const { addShareholder, setShares } = await import("@/lib/repo/shareholders");
const { postJournal, accountIdByCode } = await import("@/lib/repo/ledger");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
import type { Role } from "@/lib/db";

const ctx = { owner: 0, manager: 0, ali: 0 };

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const user = db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES (?, 'x', ?, ?, 1, ?, 1)");
  ctx.owner = Number((await user.run("o", "مالک", "owner", now)).lastInsertRowid);
  ctx.manager = Number((await user.run("m", "مدیر", "group_manager", now)).lastInsertRowid);
  ctx.ali = await addShareholder(db, { organizationId: 1, name: "علی" });
  await setShares(db, { organizationId: 1, groupId: null, validFrom: "2026-01-01", createdBy: ctx.owner, shares: [{ partyId: ctx.ali, percentBp: 10000 }] });
  await postJournal(db, { organizationId: 1, postedAt: "2026-06-01", sourceType: "MANUAL", createdBy: ctx.owner, legs: [
    { accountId: (await accountIdByCode("1201"))!, side: "D", amountToman: 1000 }, { accountId: (await accountIdByCode("4101"))!, side: "C", amountToman: 1000 },
  ] });
});

const cookie = (uid: number, role: Role) => `${COOKIE_NAME}=${createSessionToken({ uid, role, gid: null, oid: 1, tv: 0, name: "t" })}`;
const post = (url: string, c: string | null, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...(c ? { cookie: c } : {}) } });

describe("profit split routes", () => {
  it("are owner only", async () => {
    const m = cookie(ctx.manager, "group_manager");
    expect((await SPLIT(post("/api/accounting/profit-split", m, { year: 1405 }))).status).toBe(403);
    expect((await PAY(post("/api/accounting/shareholders/payments", m, {}))).status).toBe(403);
    expect((await RULE(post("/api/accounting/cost-rules", m, {}))).status).toBe(403);
    expect((await SPLIT(post("/api/accounting/profit-split", null, { year: 1405 }))).status).toBe(401);
  });

  it("previews, then posts, then refuses a second split of the same year", async () => {
    const owner = cookie(ctx.owner, "owner");
    expect((await SPLIT(post("/api/accounting/profit-split", owner, { year: "x" }))).status).toBe(400);
    const preview = await (await SPLIT(post("/api/accounting/profit-split", owner, { year: 1405 }))).json();
    expect(preview.preview.totalProfitToman).toBe(1000);
    expect(preview.preview.lines).toEqual([{ groupId: null, partyId: ctx.ali, name: "علی", amountToman: 1000 }]);
    expect((await SPLIT(post("/api/accounting/profit-split", owner, { year: 1405, commit: true }))).status).toBe(201);
    expect((await SPLIT(post("/api/accounting/profit-split", owner, { year: 1405, commit: true }))).status).toBe(409);
  });

  it("pays an advance and a dividend, refusing a dividend above what is owed", async () => {
    const owner = cookie(ctx.owner, "owner");
    const pay = (kind: string, amount: number) => PAY(post("/api/accounting/shareholders/payments", owner, { party_id: ctx.ali, kind, amount_toman: amount, method: "CASH", paid_on: "2027-04-12" }));
    expect((await pay("dividend", 1001)).status).toBe(409);
    expect((await pay("dividend", 1000)).status).toBe(201);
    expect((await pay("advance", 50)).status).toBe(201);
    expect((await pay("advance", 0)).status).toBe(400);
  });

  it("sets a cost rule", async () => {
    const owner = cookie(ctx.owner, "owner");
    const rent = (await accountIdByCode("5102"))!;
    expect((await RULE(post("/api/accounting/cost-rules", owner, { account_id: rent, mode: "company" }))).status).toBe(200);
    expect((await RULE(post("/api/accounting/cost-rules", owner, { account_id: rent, mode: "x" }))).status).toBe(409);
    expect((await RULE(post("/api/accounting/cost-rules", owner, { account_id: (await accountIdByCode("4101"))!, mode: "company" }))).status).toBe(409);
  });
});
