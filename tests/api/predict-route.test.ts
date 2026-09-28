import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-predict-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET: DEMAND } = await import("@/app/api/predict/demand/route");
const { GET: CHURN } = await import("@/app/api/predict/churn/route");
const { GET: CAPACITY } = await import("@/app/api/predict/capacity/route");
const { POST: REFRESH } = await import("@/app/api/predict/refresh/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

function cookie(uid: number, role: string, gid: number | null = null) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid, oid: 1, tv: 0, name: "م" })}`;
}
const req = (url: string, c: string, init: { method?: string } = {}) =>
  new NextRequest(`http://localhost${url}`, { ...init, headers: { cookie: c } });
const bare = (url: string) => new NextRequest(`http://localhost${url}`);

let owner = 0;
let seller = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM forecasts; DELETE FROM forecast_models; DELETE FROM churn_scores; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  owner = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o'||abs(random()),'x','م','owner',?,1)").run(now).lastInsertRowid);
  seller = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('s'||abs(random()),'x','ف','phone_sales',?,1)").run(now).lastInsertRowid);
});

describe("predict routes", () => {
  it("demand / churn / capacity are 200 for an owner and 403 for a salesperson", async () => {
    for (const [fn, url] of [
      [DEMAND, "/api/predict/demand"],
      [CHURN, "/api/predict/churn"],
      [CAPACITY, "/api/predict/capacity"],
    ] as const) {
      expect((await fn(req(url, cookie(owner, "owner")))).status).toBe(200);
      expect((await fn(req(url, cookie(seller, "phone_sales")))).status).toBe(403);
    }
  });

  it("refresh runs for an owner, 403 for a salesperson", async () => {
    const ok = await REFRESH(req("/api/predict/refresh", cookie(owner, "owner"), { method: "POST" }));
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j).toHaveProperty("forecasts");
    expect(j).toHaveProperty("churn");
    expect(j).toHaveProperty("capacity");

    expect((await REFRESH(req("/api/predict/refresh", cookie(seller, "phone_sales"), { method: "POST" }))).status).toBe(403);
  });

  it("demand with a bad entity is 400", async () => {
    expect((await DEMAND(req("/api/predict/demand?entity=planet", cookie(owner, "owner")))).status).toBe(400);
  });

  it("every predict route is 401 without a cookie", async () => {
    expect((await DEMAND(bare("/api/predict/demand"))).status).toBe(401);
    expect((await CHURN(bare("/api/predict/churn"))).status).toBe(401);
    expect((await REFRESH(bare("/api/predict/refresh"))).status).toBe(401);
  });
});
