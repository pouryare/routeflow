import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `api-commission-tiers-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { NextRequest } = await import("next/server");
const { getDb } = await import("@/lib/db");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

let owner = 0;
let manager = 0;
let seller = 0;
let stranger = 0;
let org = 0;
let otherOrg = 0;

const tokenFor = (uid: number, role: "owner" | "group_manager" | "phone_sales") =>
  createSessionToken({ uid, role, gid: null, oid: org, tv: 0, name: "t" });

const GOOD = {
  mode: "marginal",
  metric: "kg",
  tiers: [
    { from_value: 0, to_value: 100, rate_type: "flat", rate_value: 1000 },
    { from_value: 100, to_value: null, rate_type: "flat", rate_value: 2000 },
  ],
};

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const mkOrg = async (name: string, slug: string) =>
    Number(
      (await db.prepare("INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)")
        .run(name, slug, now)).lastInsertRowid,
    );
  org = await mkOrg("Co", `c-${Date.now()}`);
  otherOrg = await mkOrg("Other", `x-${Date.now()}`);
  const group = Number(
    (await db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("شرق", "east", "#0ff", now)).lastInsertRowid,
  );
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,organization_id,created_at) VALUES (?,?,?,?,?,?,?)",
  );
  owner = Number((await u.run(`o${Date.now()}`, "x", "مالک", "owner", null, org, now)).lastInsertRowid);
  manager = Number((await u.run(`m${Date.now()}`, "x", "مدیر", "group_manager", group, org, now)).lastInsertRowid);
  seller = Number((await u.run(`s${Date.now()}`, "x", "فروشنده", "phone_sales", group, org, now)).lastInsertRowid);
  stranger = Number((await u.run(`x${Date.now()}`, "x", "بیگانه", "phone_sales", group, otherOrg, now)).lastInsertRowid);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const post = (token: string, body: unknown) =>
  new NextRequest("http://localhost/api/sales/commission/tiers", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: `${COOKIE_NAME}=${token}` },
    body: JSON.stringify(body),
  });

const del = (token: string, from: string) =>
  new NextRequest(`http://localhost/api/sales/commission/tiers?from=${from}`, {
    method: "DELETE",
    headers: { cookie: `${COOKIE_NAME}=${token}` },
  });

const get = (token: string) =>
  new NextRequest("http://localhost/api/sales/commission/tiers", {
    headers: { cookie: `${COOKIE_NAME}=${token}` },
  });

describe("the tiered plan admin API", () => {
  it("an owner can save a plan", async () => {
    const { POST } = await import("@/app/api/sales/commission/tiers/route");
    const res = await POST(post(tokenFor(owner, "owner"), {
      salesperson_user_id: seller, plan: GOOD, valid_from: "2026-01-01",
    }));
    expect(res.status).toBeLessThan(300);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it("an owner can read the plans back", async () => {
    const { GET } = await import("@/app/api/sales/commission/tiers/route");
    const res = await GET(get(tokenFor(owner, "owner")));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { plans: Array<{ metric: string }> };
    expect(json.plans.length).toBeGreaterThan(0);
  });

  it("a rep cannot read or write", async () => {
    const { GET, POST } = await import("@/app/api/sales/commission/tiers/route");
    const t = tokenFor(seller, "phone_sales");
    expect((await GET(get(t))).status).toBe(403);
    expect((await POST(post(t, { salesperson_user_id: seller, plan: GOOD, valid_from: "2026-01-01" }))).status).toBe(403);
  });

  it("a manager is refused — a commission plan is payroll, not territory", async () => {
    const { GET, POST } = await import("@/app/api/sales/commission/tiers/route");
    const t = tokenFor(manager, "group_manager");
    expect((await GET(get(t))).status).toBe(403);
    expect((await POST(post(t, { salesperson_user_id: seller, plan: GOOD, valid_from: "2026-01-01" }))).status).toBe(403);
  });

  it("an unauthenticated caller gets 401", async () => {
    const { GET, POST } = await import("@/app/api/sales/commission/tiers/route");
    expect((await GET(new NextRequest("http://localhost/api/sales/commission/tiers"))).status).toBe(401);
    expect((await POST(post("", {}))).status).toBe(401);
  });

  it("an invalid plan is 422 WITH its Persian message, and writes nothing", async () => {
    const { POST } = await import("@/app/api/sales/commission/tiers/route");
    const gapped = { ...GOOD, tiers: [
      { from_value: 0, to_value: 100, rate_type: "flat", rate_value: 1000 },
      { from_value: 200, to_value: null, rate_type: "flat", rate_value: 2000 },
    ] };
    const res = await POST(post(tokenFor(owner, "owner"), {
      salesperson_user_id: seller, plan: gapped, valid_from: "2030-01-01",
    }));
    expect(res.status).toBe(422);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error.length).toBeGreaterThan(0);
    expect(/[\u0600-\u06FF]/u.test(json.error)).toBe(true);
    const n = await getDb()
      .prepare("SELECT COUNT(*) AS n FROM commission_tiers WHERE valid_from = ?")
      .get("2030-01-01") as { n: number };
    expect(n.n).toBe(0);
  });

  it("a cross-tenant salesperson is 404, not 403 — the org does not exist from here", async () => {
    const { POST } = await import("@/app/api/sales/commission/tiers/route");
    const res = await POST(post(tokenFor(owner, "owner"), {
      salesperson_user_id: stranger, plan: GOOD, valid_from: "2026-02-01",
    }));
    expect(res.status).toBe(404);
  });

  it("an owner may set a plan for another person in the SAME org", async () => {
    const { POST } = await import("@/app/api/sales/commission/tiers/route");
    const res = await POST(post(tokenFor(owner, "owner"), {
      salesperson_user_id: manager, plan: { ...GOOD, metric: "revenue_toman" }, valid_from: "2026-03-01",
    }));
    expect(res.status).toBeLessThan(300);
  });

  it("a company-wide plan (no person) is allowed — that is the default tier set", async () => {
    const { POST } = await import("@/app/api/sales/commission/tiers/route");
    const res = await POST(post(tokenFor(owner, "owner"), {
      salesperson_user_id: null, plan: GOOD, valid_from: "2026-04-01",
    }));
    expect(res.status).toBeLessThan(300);
  });

  it("a bad valid_from is a 400", async () => {
    const { POST } = await import("@/app/api/sales/commission/tiers/route");
    // 2026-02-30 and 2026-04-31 are well-shaped and `Date.parse` accepts them (rolling over into
    // the next month), so only a real calendar check keeps them out of the table.
    for (const bad of ["", "2026", "01-01-2026", "2026-13-01", "2026-02-30", "2026-04-31", "نامعتبر"]) {
      const res = await POST(post(tokenFor(owner, "owner"), {
        salesperson_user_id: seller, plan: GOOD, valid_from: bad,
      }));
      expect(res.status, `accepted valid_from=${bad}`).toBe(400);
    }
  });

  it("DELETE removes a plan from a date onward, and needs a valid date", async () => {
    const { DELETE } = await import("@/app/api/sales/commission/tiers/route");
    const t = tokenFor(owner, "owner");
    expect((await DELETE(del(t, "2026-03-01"))).status).toBeLessThan(300);
    expect((await DELETE(del(t, "not-a-date"))).status).toBe(400);
    expect((await DELETE(del(t, "2026-02-30"))).status).toBe(400);
  });

  it("DELETE is owner-only", async () => {
    const { DELETE } = await import("@/app/api/sales/commission/tiers/route");
    expect((await DELETE(del(tokenFor(manager, "group_manager"), "2026-01-01"))).status).toBe(403);
    expect((await DELETE(new NextRequest("http://localhost/api/sales/commission/tiers?from=2026-01-01", { method: "DELETE" }))).status).toBe(401);
  });

  it("a plan that is not a tiered shape at all is refused, not coerced", async () => {
    const { POST } = await import("@/app/api/sales/commission/tiers/route");
    for (const plan of [null, {}, { mode: "nonsense", metric: "kg", tiers: [] }, { ...GOOD, mode: "cliffy" }]) {
      const res = await POST(post(tokenFor(owner, "owner"), {
        salesperson_user_id: seller, plan, valid_from: "2026-05-01",
      }));
      expect(res.status, `accepted plan=${JSON.stringify(plan)}`).toBe(422);
    }
  });
});
