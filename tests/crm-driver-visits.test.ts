import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-driver-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { driverVisitsFor, applyDriverVisit } = await import("@/lib/repo/crm/driverVisits");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-11T06:00:00.000Z";
const db = getDb();
const g = async (s: string) => Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES (?,?,?,1)").run(s, s, NOW)).lastInsertRowid);
const g1 = await g("g1"), g2 = await g("g2");
const user = async (u: string, role: string, gid: number) =>
  Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES (?,?,?,?,?,?,1)").run(u, "x", u, role, gid, NOW)).lastInsertRowid);
const rep = await user("rep", "phone_sales", g1);
const driver = await user("drv", "delivery_driver", g1);
const lead = async (gid: number) => {
  const id = Number((await db.prepare(`INSERT INTO customers (customer_code, business_name, address, lat, lng, location_precision, owner_user_id, group_id,
      verification, sales_stage, contact_status, temperature, synced_at, organization_id)
      VALUES (?, 'رستوران بی‌تلفن', 'سعادت‌آباد', 35.78, 51.37, 'approx', ?, ?, 'unverified', 'unknown', 'not_contacted', 'cold', ?, 1)`)
    .run(`D-${Math.random()}`, rep, gid, NOW)).lastInsertRowid);
  const t = Number((await db.prepare(`INSERT INTO tasks (organization_id, role_hint, group_id, kind, title, entity_type, entity_id, due_at, created_at)
      VALUES (1, 'delivery_driver', ?, 'verify_visit', 'بازدید تأیید', 'customer', ?, ?, ?)`).run(gid, id, NOW, NOW)).lastInsertRowid);
  await db.prepare("UPDATE customers SET next_task_id = ? WHERE id = ?").run(t, id);
  return { id, t };
};
const mine = await lead(g1);
const elsewhere = await lead(g2);
const D: Session = { user: { id: driver, display_name: "drv" } as Session["user"], role: "delivery_driver", groupId: g1, organizationId: 1, roles: ["delivery_driver"], hasRole: (x) => x === "delivery_driver" };

describe("driver visits", () => {
  it("lists only the driver's group's visits, with the minimum to find the door", async () => {
    const v = await driverVisitsFor(D);
    expect(v.map((x) => x.task_id)).toEqual([mine.t]);
    expect(Object.keys(v[0]).sort()).toEqual(["address", "area_label", "business_name", "customer_id", "due_at", "hours", "lat", "lng", "maps_url", "task_id"]);
  });

  it("verifies the lead, fixes the pin from the driver's GPS, saves the phone and hands it back to the rep", async () => {
    const r = await applyDriverVisit(D, mine.t, { nowIso: NOW, pos: { lat: 35.781, lng: 51.371, accuracy: 20 }, answers: [
      { step: "found", option: "yes" }, { step: "open", option: "yes" }, { step: "phone", option: "ok", value: "0912 777 0001" },
      { step: "who", option: "OWNER" }, { step: "interest", option: "yes" },
    ] });
    const c = await db.prepare("SELECT * FROM customers WHERE id = ?").get(mine.id) as Record<string, unknown>;
    expect(c).toMatchObject({ verification: "verified", phone_norm: "9127770001", lat: 35.781, lng: 51.371, location_precision: "exact", temperature: "warm" });
    expect(await db.prepare("SELECT status FROM tasks WHERE id = ?").get(mine.t)).toEqual({ status: "done" });
    expect(await db.prepare("SELECT kind, assignee_user_id FROM tasks WHERE id = ?").get(r.nextTaskId!)).toEqual({ kind: "call", assignee_user_id: rep });
  });

  it("404s a visit in another group and refuses a non-driver", async () => {
    await expect((async () => await applyDriverVisit(D, elsewhere.t, { answers: [{ step: "found", option: "no" }, { step: "notfound", option: "gone" }] }))()).rejects.toThrow(expect.objectContaining({ status: 404 }));
    const R: Session = { ...D, user: { id: rep } as Session["user"], role: "phone_sales" };
    await expect((async () => await driverVisitsFor(R))()).rejects.toThrow(expect.objectContaining({ status: 403 }));
  });
});
