import { describe, it, expect, beforeAll } from "vitest";

process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/accounting/shareholders/route");
const { POST: POST_SHARES } = await import("@/app/api/accounting/shareholders/shares/route");
const { POST: POST_FORM } = await import("@/app/api/accounting/legal-form/route");
const { sharesAt, legalFormOf } = await import("@/lib/repo/shareholders");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
import type { Role } from "@/lib/db";

const ctx = { owner: 0, manager: 0, seller: 0, group: 0 };

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  ctx.group = Number((await db.prepare("INSERT INTO groups (name, slug, color, active, created_at, organization_id) VALUES ('شرق','east','#0ff',1,?,1)").run(now)).lastInsertRowid);
  const user = db.prepare("INSERT INTO users (username, password_hash, display_name, role, active, created_at, organization_id) VALUES (?, 'x', ?, ?, 1, ?, 1)");
  ctx.owner = Number((await user.run("o", "مالک", "owner", now)).lastInsertRowid);
  ctx.manager = Number((await user.run("m", "مدیر", "group_manager", now)).lastInsertRowid);
  ctx.seller = Number((await user.run("s", "فروشنده", "phone_sales", now)).lastInsertRowid);
});

const cookie = (uid: number, role: Role) =>
  `${COOKIE_NAME}=${createSessionToken({ uid, role, gid: null, oid: 1, tv: 0, name: "t" })}`;
const req = (url: string, c: string | null, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(c ? { cookie: c } : {}) },
  });

describe("shareholders", () => {
  it("is owner only", async () => {
    expect((await GET(req("/api/accounting/shareholders", null))).status).toBe(401);
    expect((await GET(req("/api/accounting/shareholders", cookie(ctx.manager, "group_manager")))).status).toBe(403);
    expect((await POST(req("/api/accounting/shareholders", cookie(ctx.seller, "phone_sales"), { name: "x" }))).status).toBe(403);
  });

  it("adds shareholders, one of them linked to a user, and refuses a duplicate link", async () => {
    const owner = cookie(ctx.owner, "owner");
    const a = await POST(req("/api/accounting/shareholders", owner, { name: "علی" }));
    expect(a.status).toBe(201);
    expect((await POST(req("/api/accounting/shareholders", owner, { name: "سارا", user_id: ctx.manager }))).status).toBe(201);
    expect((await POST(req("/api/accounting/shareholders", owner, { name: "سارا دوم", user_id: ctx.manager }))).status).toBe(409);
    expect((await POST(req("/api/accounting/shareholders", owner, { name: "  " }))).status).toBe(409);
    const { shareholders } = await (await GET(req("/api/accounting/shareholders", owner))).json();
    expect(shareholders.map((s: { name: string }) => s.name)).toEqual(["علی", "سارا"]);
  });

  it("takes a set only when it totals 100%, and finds the set in force by date", async () => {
    const owner = cookie(ctx.owner, "owner");
    const [ali, sara] = (await (await GET(req("/api/accounting/shareholders", owner))).json()).shareholders.map((s: { id: number }) => s.id);
    const set = (valid_from: string, a: number, b: number, group_id?: number) =>
      POST_SHARES(req("/api/accounting/shareholders/shares", owner, { valid_from, group_id, shares: [{ party_id: ali, percent: a }, { party_id: sara, percent: b }] }));

    expect((await set("2026-01-01", 60, 30)).status).toBe(409); // 90%
    expect((await set("2026-01-01", 60, 40)).status).toBe(201);
    expect((await set("2026-07-01", 50, 50)).status).toBe(201);
    expect((await set("2026-07-01", 33.33, 66.67)).status).toBe(201); // same date replaces

    const db = getDb();
    expect(await sharesAt(db, 1, null, "2025-12-31")).toEqual([]);
    expect(await sharesAt(db, 1, null, "2026-03-01")).toEqual([{ partyId: ali, percentBp: 6000 }, { partyId: sara, percentBp: 4000 }]);
    expect(await sharesAt(db, 1, null, "2026-07-01")).toEqual([{ partyId: ali, percentBp: 3333 }, { partyId: sara, percentBp: 6667 }]);

    // A group has its own scope.
    expect(await sharesAt(db, 1, ctx.group, "2026-08-01")).toEqual([]);
    expect((await set("2026-01-01", 100, 0, ctx.group)).status).toBe(201);
    expect(await sharesAt(db, 1, ctx.group, "2026-08-01")).toEqual([{ partyId: ali, percentBp: 10000 }, { partyId: sara, percentBp: 0 }]);
  });

  it("refuses an unknown shareholder", async () => {
    const owner = cookie(ctx.owner, "owner");
    const r = await POST_SHARES(req("/api/accounting/shareholders/shares", owner, { valid_from: "2026-01-01", shares: [{ party_id: 999999, percent: 100 }] }));
    expect(r.status).toBe(409);
  });

  it("sets the legal form", async () => {
    const owner = cookie(ctx.owner, "owner");
    expect(await legalFormOf(getDb(), 1)).toBe("unregistered");
    expect((await POST_FORM(req("/api/accounting/legal-form", owner, { legal_form: "registered" }))).status).toBe(200);
    expect(await legalFormOf(getDb(), 1)).toBe("registered");
    expect((await POST_FORM(req("/api/accounting/legal-form", owner, { legal_form: "x" }))).status).toBe(409);
    expect((await POST_FORM(req("/api/accounting/legal-form", cookie(ctx.manager, "group_manager"), { legal_form: "registered" }))).status).toBe(403);
  });
});
