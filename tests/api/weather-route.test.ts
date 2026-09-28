import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-weather-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { upsertSnapshot } = await import("@/lib/repo/weather");
const { GET: W_GET } = await import("@/app/api/sales/weather/route");
const { GET: CF_GET, PATCH: CF_PATCH } = await import("@/app/api/sales/capacity-factors/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let seller = 0;

function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM weather_snapshots; DELETE FROM capacity_factors WHERE organization_id IS NOT NULL; DELETE FROM users WHERE id>0;");
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x", "م", "owner", now).lastInsertRowid);
  seller = Number(u.run(`s${Date.now()}`, "x", "ف", "phone_sales", now).lastInsertRowid);
});

describe("weather routes", () => {
  it("returns a snapshot and its adjustment", async () => {
    upsertSnapshot({
      lat_r: 35.7,
      lng_r: 51.42,
      forecast_date: "2026-03-01",
      temp_min: 3,
      temp_max: 10,
      precip_prob: 90,
      precip_mm: 9,
      snow_mm: 0,
      wind_kmh: 12,
      gust_kmh: 20,
      visibility_m: 8000,
      weather_code: 63,
      raw_json: "{}",
    });
    const res = await W_GET(
      new NextRequest("http://localhost/api/sales/weather?lat=35.7&lng=51.42&date=2026-03-01", {
        headers: { cookie: cookie(owner, "owner") },
      })
    );
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.snapshot.precip_mm).toBe(9);
    expect(j.adjustment.conditions).toContain("heavy_rain");
  });

  it("PATCH sets a tenant capacity factor and GET shows it", async () => {
    const patch = await CF_PATCH(
      new NextRequest("http://localhost/api/sales/capacity-factors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: cookie(owner, "owner") },
        body: JSON.stringify({ condition_code: "fog", stop_factor: 0.6 }),
      })
    );
    expect(patch.status).toBe(200);
    const j = await (await CF_GET(new NextRequest("http://localhost/api/sales/capacity-factors", { headers: { cookie: cookie(owner, "owner") } }))).json();
    expect(j.factors.find((f: { condition_code: string }) => f.condition_code === "fog").stop_factor).toBe(0.6);
  });

  it("403s a salesperson on PATCH", async () => {
    const res = await CF_PATCH(
      new NextRequest("http://localhost/api/sales/capacity-factors", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: cookie(seller, "phone_sales") },
        body: JSON.stringify({ condition_code: "fog", stop_factor: 0.6 }),
      })
    );
    expect(res.status).toBe(403);
  });
});
