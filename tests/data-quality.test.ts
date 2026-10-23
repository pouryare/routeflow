import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-data-quality-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { dataQuality } = await import("@/lib/repo/dataQuality");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const sess = (id: number, role: string, gid: number | null): Session =>
  ({ user: { id } as never, role: role as never, groupId: gid, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

describe("dataQuality (F54)", async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES (?,?,?,1)");
  const groupA = Number((await g.run("شمال", "a", now)).lastInsertRowid);
  const groupB = Number((await g.run("جنوب", "b", now)).lastInsertRowid);
  const district = 1; // customers.district_id carries no foreign key
  const c = db.prepare(
    "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,lat,lng,phone,district_id,organization_id) VALUES (?,?,?,?,?,?,?,?,?,1)"
  );
  await c.run("Q1", "کامل", "active", now, groupA, 35.7, 51.4, "09120000000", district);
  await c.run("Q2", "بی‌نشان", "active", now, groupA, null, null, null, district);
  await c.run("Q3", "بی‌تلفن", "dormant", now, groupB, 35.7, 51.4, " ", district);
  await c.run("Q4", "سرنخ", "lead", now, groupA, null, null, null, null); // a lead is not checked

  it("lists served customers with their gaps, most gaps first, and counts per group", async () => {
    const owner = sess(1, "owner", null);
    const { rows, groups, total } = await dataQuality(owner);
    expect(rows.map((r) => r.business_name)).toEqual(["بی‌نشان", "بی‌تلفن"]);
    expect(rows.map((r) => r.gaps)).toEqual([["location", "phone"], ["phone"]]);
    expect(total).toBe(rows.length);
    const north = groups.find((x) => x.group_name === "شمال")!;
    expect(north.customers).toBe(2);
    expect(north.location).toBe(1);
  });

  it("a group manager sees their own group only; other roles see nothing", async () => {
    expect((await dataQuality(sess(2, "group_manager", groupB))).rows.map((r) => r.business_name)).toEqual(["بی‌تلفن"]);
    expect((await dataQuality(sess(3, "delivery_driver", null))).rows).toEqual([]);
  });
});
