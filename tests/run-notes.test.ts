import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";
import type { RunDetail, RunStop } from "@/lib/delivery";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-run-notes-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { runNotes } = await import("@/lib/runNotes");
const { runForNotes } = await import("@/lib/repo/driverStops");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const line = (id: number, packs: number, price: number) => ({
  id, product_name: "کره", packaging_name: "جعبه", packs_ordered: packs, packs_delivered: null, unit_price_toman: price,
  unit_cost_toman: 0, qty_per_pack: 10, kg_per_base_unit: 0.25, total_toman: packs * price, kg: 0,
});
const stop = (id: number, status: string, lines: ReturnType<typeof line>[]): RunStop => ({
  id, order_id: id, order_no: `S-${id}`, priority: "NORMAL", customer_id: id, customer_name: `مشتری ${id}`, address: "تهران",
  phone: "0912", lat: null, lng: null, status, collected_toman: 0, sort_order: id, notes: null, lines: lines as never,
  total_toman: lines.reduce((s, l) => s + l.total_toman, 0),
});

describe("runNotes (F101)", () => {
  const run = {
    id: 1, driver_user_id: 2, driver_name: "رضا", run_date: "2026-10-24", status: "ready", facilities: [], remaining: 2,
    collected_toman: 0, to_collect_toman: 50000,
    stops: [stop(1, "pending", [line(11, 2, 10000)]), stop(2, "done", [line(21, 1, 5000)]), stop(3, "pending", [line(31, 3, 10000)])],
  } as RunDetail;

  it("one note per pending stop, in stop order, with ordered packs and the full amount to collect", () => {
    const { cover, notes } = runNotes(run, "پخش نمونه", "نیسان ۱");
    expect(notes.map((n) => n.orderNo)).toEqual(["S-1", "S-3"]);
    expect(notes[1].lines[0].detail).toContain("۳ بسته");
    expect(notes[1].dueLabel).toBe(notes[1].totalLabel);
    expect(cover).toMatchObject({ driverName: "رضا", vehicle: "نیسان ۱", stops: 3, pending: 2 });
    expect(cover.toCollectLabel).toContain("۵۰٬۰۰۰");
  });
});

describe("runForNotes", () => {
  const sess = (id: number, role: string): Session =>
    ({ user: { id } as never, role: role as never, groupId: null, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;
  it("opens for a manager and the run's own driver; not for another driver or company", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)");
    const driver = Number((await u.run("rd", "x", "رضا", "delivery_driver", now)).lastInsertRowid);
    const other = Number((await u.run("od", "x", "علی", "delivery_driver", now)).lastInsertRowid);
    const runId = Number(
      (await db.prepare("INSERT INTO delivery_runs (driver_user_id,run_date,status,created_by,created_at,updated_at,organization_id) VALUES (?,?,'ready',?,?,?,1)")
        .run(driver, "2026-10-24", driver, now, now)).lastInsertRowid
    );
    expect((await runForNotes(sess(99, "owner"), runId))?.run.id).toBe(runId);
    expect((await runForNotes(sess(driver, "delivery_driver"), runId))?.run.driver_name).toBe("رضا");
    expect(await runForNotes(sess(other, "delivery_driver"), runId)).toBeNull();
    expect(await runForNotes({ ...sess(99, "owner"), organizationId: 2 } as Session, runId)).toBeNull();
  });
});
