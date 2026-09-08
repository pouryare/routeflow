import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-comapi-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { setRate } = await import("@/lib/commissionLedger");
const { GET } = await import("@/app/api/sales/commission/route");
const { POST: POST_RATE } = await import("@/app/api/sales/commission/rates/route");
const { POST: POST_PAYMENT } = await import("@/app/api/sales/commission/payments/route");
const { POST: POST_OVERRIDE } = await import("@/app/api/sales/commission/manager-overrides/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");
import type { Role } from "@/lib/db";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = {
  east: 0,
  west: 0,
  owner: 0,
  eastManager: 0,
  nazanin: 0,
  yasamin: 0,
  westSeller: 0,
  driver: 0,
};

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const group = db.prepare(
    "INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)"
  );
  ctx.east = Number(group.run("شرق", "east", "#0ff", now).lastInsertRowid);
  ctx.west = Number(group.run("غرب", "west", "#f0f", now).lastInsertRowid);

  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, ?)"
  );
  ctx.owner = Number(user.run("o", "مالک", "owner", null, now).lastInsertRowid);
  ctx.eastManager = Number(user.run("em", "مدیر شرق", "group_manager", ctx.east, now).lastInsertRowid);
  ctx.nazanin = Number(user.run("nazanin", "نازنین", "salesperson", ctx.east, now).lastInsertRowid);
  ctx.yasamin = Number(user.run("yasamin", "یاسمین", "salesperson", ctx.east, now).lastInsertRowid);
  ctx.westSeller = Number(user.run("w", "فروشنده غرب", "salesperson", ctx.west, now).lastInsertRowid);
  ctx.driver = Number(user.run("d", "راننده", "driver", ctx.east, now).lastInsertRowid);

  setRate(db, { rate_per_kg_toman: 2000, valid_from: "2026-01-01", created_by: ctx.owner });
});

function cookieFor(uid: number, role: Role, gid: number | null) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role, gid, oid: 1, tv: 0, name: "t" })}`;
}

const AS = {
  owner: () => cookieFor(ctx.owner, "owner", null),
  eastManager: () => cookieFor(ctx.eastManager, "group_manager", ctx.east),
  nazanin: () => cookieFor(ctx.nazanin, "salesperson", ctx.east),
  driver: () => cookieFor(ctx.driver, "driver", ctx.east),
};

const get = (cookie: string | null, qs = "") =>
  new NextRequest(`http://localhost/api/sales/commission${qs}`, {
    headers: cookie ? { cookie } : {},
  });

const post = (url: string, cookie: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", cookie },
  });

describe("GET /api/sales/commission", () => {
  it("refuses an anonymous caller", async () => {
    expect((await GET(get(null))).status).toBe(401);
  });

  it("refuses a driver", async () => {
    expect((await GET(get(AS.driver()))).status).toBe(403);
  });

  it("gives an owner every salesperson", async () => {
    const { statements } = await (await GET(get(AS.owner()))).json();
    const names = statements.map((s: { display_name: string }) => s.display_name);
    expect(names).toContain("نازنین");
    expect(names).toContain("فروشنده غرب");
  });

  it("gives a manager only their own group's salespeople", async () => {
    const { statements } = await (await GET(get(AS.eastManager()))).json();
    const names = statements.map((s: { display_name: string }) => s.display_name);
    expect(names).toContain("نازنین");
    expect(names).not.toContain("فروشنده غرب");
  });

  it("gives a salesperson only their own statement", async () => {
    // Someone else's earnings are the clearest example of data that is inside your
    // group and still none of your business.
    const { statements } = await (await GET(get(AS.nazanin()))).json();
    expect(statements).toHaveLength(1);
    expect(statements[0].display_name).toBe("نازنین");
  });
});

describe("POST /api/sales/commission/rates", () => {
  const body = { rate_per_kg_toman: 2500, valid_from: "2026-06-01" };

  it("lets an owner set a rate", async () => {
    const res = await POST_RATE(post("/api/sales/commission/rates", AS.owner(), body));
    expect(res.status).toBe(201);
  });

  it("refuses a manager", async () => {
    // A rate is payroll. Territory does not carry it.
    expect((await POST_RATE(post("/api/sales/commission/rates", AS.eastManager(), body))).status).toBe(403);
  });

  it("refuses a salesperson setting their own rate", async () => {
    expect((await POST_RATE(post("/api/sales/commission/rates", AS.nazanin(), body))).status).toBe(403);
  });

  it("rejects a fractional rate", async () => {
    const res = await POST_RATE(
      post("/api/sales/commission/rates", AS.owner(), { ...body, rate_per_kg_toman: 2500.5 })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a malformed date", async () => {
    const res = await POST_RATE(
      post("/api/sales/commission/rates", AS.owner(), { ...body, valid_from: "۱۴۰۵/۰۳/۱۱" })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a rate for somebody who is not a salesperson", async () => {
    const res = await POST_RATE(
      post("/api/sales/commission/rates", AS.owner(), { ...body, salesperson_user_id: ctx.driver })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sales/commission/payments", () => {
  const body = () => ({
    salesperson_user_id: ctx.nazanin,
    amount_toman: 500000,
    paid_on: "2026-08-01",
  });

  it("lets an owner record a payment", async () => {
    const res = await POST_PAYMENT(post("/api/sales/commission/payments", AS.owner(), body()));
    expect(res.status).toBe(201);
  });

  it("refuses a manager", async () => {
    expect(
      (await POST_PAYMENT(post("/api/sales/commission/payments", AS.eastManager(), body()))).status
    ).toBe(403);
  });

  it("refuses a salesperson recording their own payment", async () => {
    expect(
      (await POST_PAYMENT(post("/api/sales/commission/payments", AS.nazanin(), body()))).status
    ).toBe(403);
  });

  it("records who entered it", async () => {
    await POST_PAYMENT(post("/api/sales/commission/payments", AS.owner(), body()));
    const row = getDb()
      .prepare("SELECT created_by FROM commission_payments ORDER BY id DESC LIMIT 1")
      .get() as { created_by: number };
    expect(row.created_by).toBe(ctx.owner);
  });

  it("rejects a payment to somebody who is not a salesperson", async () => {
    const res = await POST_PAYMENT(
      post("/api/sales/commission/payments", AS.owner(), {
        ...body(),
        salesperson_user_id: ctx.driver,
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a fractional amount", async () => {
    const res = await POST_PAYMENT(
      post("/api/sales/commission/payments", AS.owner(), { ...body(), amount_toman: 1.5 })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sales/commission/rates -- kind: driver", () => {
  const body = { kind: "driver", rate_per_kg_toman: 700, valid_from: "2026-06-01" };

  it("lets an owner set a driver rate", async () => {
    const res = await POST_RATE(post("/api/sales/commission/rates", AS.owner(), body));
    expect(res.status).toBe(201);
  });

  it("refuses a manager", async () => {
    expect((await POST_RATE(post("/api/sales/commission/rates", AS.eastManager(), body))).status).toBe(403);
  });

  it("rejects a driver rate aimed at a سالسپرسون account", async () => {
    const res = await POST_RATE(
      post("/api/sales/commission/rates", AS.owner(), { ...body, driver_user_id: ctx.nazanin })
    );
    expect(res.status).toBe(400);
  });

  it("does not write into the فروشنده rate table", async () => {
    const before = (getDb().prepare("SELECT COUNT(*) AS n FROM commission_rates").get() as { n: number }).n;
    await POST_RATE(post("/api/sales/commission/rates", AS.owner(), body));
    const after = (getDb().prepare("SELECT COUNT(*) AS n FROM commission_rates").get() as { n: number }).n;
    expect(after).toBe(before);
  });
});

describe("POST /api/sales/commission/manager-overrides", () => {
  const body = { override_pct: 12, valid_from: "2026-06-01" };

  it("lets an owner set a manager override", async () => {
    const res = await POST_OVERRIDE(post("/api/sales/commission/manager-overrides", AS.owner(), body));
    expect(res.status).toBe(201);
  });

  it("refuses a manager setting their own override", async () => {
    expect(
      (await POST_OVERRIDE(post("/api/sales/commission/manager-overrides", AS.eastManager(), body))).status
    ).toBe(403);
  });

  it("rejects a percentage outside 0-100", async () => {
    const res = await POST_OVERRIDE(
      post("/api/sales/commission/manager-overrides", AS.owner(), { ...body, override_pct: 150 })
    );
    expect(res.status).toBe(400);
  });

  it("rejects an override aimed at a فروشنده account", async () => {
    const res = await POST_OVERRIDE(
      post("/api/sales/commission/manager-overrides", AS.owner(), { ...body, manager_user_id: ctx.nazanin })
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sales/commission/payments -- kind: driver and manager", () => {
  it("lets an owner pay a driver", async () => {
    const res = await POST_PAYMENT(
      post("/api/sales/commission/payments", AS.owner(), {
        kind: "driver",
        driver_user_id: ctx.driver,
        amount_toman: 200000,
        paid_on: "2026-08-01",
      })
    );
    expect(res.status).toBe(201);
  });

  it("lets an owner pay a manager", async () => {
    const res = await POST_PAYMENT(
      post("/api/sales/commission/payments", AS.owner(), {
        kind: "manager",
        manager_user_id: ctx.eastManager,
        amount_toman: 300000,
        paid_on: "2026-08-01",
      })
    );
    expect(res.status).toBe(201);
  });

  it("rejects a driver payment aimed at a فروشنده account", async () => {
    const res = await POST_PAYMENT(
      post("/api/sales/commission/payments", AS.owner(), {
        kind: "driver",
        driver_user_id: ctx.nazanin,
        amount_toman: 100000,
        paid_on: "2026-08-01",
      })
    );
    expect(res.status).toBe(400);
  });

  it("writes a driver payment into the driver table, not the فروشنده one", async () => {
    const before = (getDb().prepare("SELECT COUNT(*) AS n FROM driver_commission_payments").get() as { n: number }).n;
    await POST_PAYMENT(
      post("/api/sales/commission/payments", AS.owner(), {
        kind: "driver",
        driver_user_id: ctx.driver,
        amount_toman: 50000,
        paid_on: "2026-08-02",
      })
    );
    const after = (getDb().prepare("SELECT COUNT(*) AS n FROM driver_commission_payments").get() as { n: number }).n;
    expect(after).toBe(before + 1);
  });
});

describe("GET /api/sales/commission -- the driver and manager ledgers", () => {
  it("includes driver and manager statements for an owner", async () => {
    const json = await (await GET(get(AS.owner()))).json();
    const driverNames = json.driver_statements.map((s: { display_name: string }) => s.display_name);
    const managerNames = json.manager_statements.map((s: { display_name: string }) => s.display_name);
    expect(driverNames).toContain("راننده");
    expect(managerNames).toContain("مدیر شرق");
  });

  it("gives a salesperson no driver or manager statements", async () => {
    const json = await (await GET(get(AS.nazanin()))).json();
    expect(json.driver_statements).toEqual([]);
    expect(json.manager_statements).toEqual([]);
  });

  it("gives a manager only their own override statement, not another manager's", async () => {
    const json = await (await GET(get(AS.eastManager()))).json();
    expect(json.manager_statements).toHaveLength(1);
    expect(json.manager_statements[0].display_name).toBe("مدیر شرق");
  });
});
