import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";
import { ROLES } from "@/lib/roles";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-briefing-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop } = await import("@/lib/delivery");
const { createTask } = await import("@/lib/repo/tasks");
const { setTarget } = await import("@/lib/repo/targets");
const { todayFor } = await import("@/lib/repo/briefing");
const { toJalali } = await import("@/lib/jalali");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let mgr = 0;
let seller = 0;
let driver = 0;
let groupId = 0;
let custId = 0;
let product = 0;
let packaging = 0;

const today = new Date().toISOString().slice(0, 10);
const jNow = toJalali(new Date().toISOString())!;
const PERIOD = `${jNow.jy}-${String(jNow.jm).padStart(2, "0")}`;

const sess = (id: number, role: string, gid: number | null): Session =>
  ({ user: { id } as never, role: role as never, groupId: gid, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM tasks; DELETE FROM alerts; DELETE FROM targets; DELETE FROM credit_approvals; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM deliveries; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM groups; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  groupId = Number(db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('A','a',?,1)").run(now).lastInsertRowid);
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x", "م", "owner", null, now).lastInsertRowid);
  mgr = Number(u.run(`m${Date.now()}`, "x", "مد", "group_manager", groupId, now).lastInsertRowid);
  seller = Number(u.run(`s${Date.now()}`, "x", "ف", "phone_sales", groupId, now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x", "ر", "delivery_driver", groupId, now).lastInsertRowid);
  custId = Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('C','x','active',?,?,1)").run(now, groupId).lastInsertRowid);
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
});

describe("todayFor", () => {
  it("salesperson gets open_tasks and the target panel", () => {
    createTask(1, { title: "تماس با علی", kind: "call", assignee_user_id: seller });
    setTarget(1, { user_id: seller, period: PERIOD, metric: "revenue_toman", target_value: 100_000 });
    const b = todayFor(sess(seller, "phone_sales", groupId));
    const keys = b.panels.map((p) => p.key);
    expect(keys).toContain("open_tasks");
    expect(keys).toContain("target");
    expect(b.panels.find((p) => p.key === "open_tasks")!.items[0].action).toMatchObject({ kind: "task_outcome" });
  });

  it("driver gets today_run and a retry panel for yesterday's failure", () => {
    const db = getDb();
    const o = createOrder(db, { customer_id: custId, order_date: today, created_by: owner, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] });
    confirmOrder(db, o.id);
    const run = createRun(db, { driver_user_id: driver, run_date: today, created_by: owner, organization_id: 1 });
    addStop(db, run, o.id);

    // a failed order on yesterday's run
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const o2 = createOrder(db, { customer_id: custId, order_date: yesterday, created_by: owner, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] });
    confirmOrder(db, o2.id);
    const run2 = createRun(db, { driver_user_id: driver, run_date: yesterday, created_by: owner, organization_id: 1 });
    addStop(db, run2, o2.id);
    db.prepare("UPDATE orders SET status = 'DELIVERY_FAILED' WHERE id = ?").run(o2.id);

    const b = todayFor(sess(driver, "delivery_driver", groupId));
    const keys = b.panels.map((p) => p.key);
    expect(keys).toContain("today_run");
    expect(keys).toContain("retry");
    expect(b.panels.find((p) => p.key === "retry")!.items).toHaveLength(1);
  });

  it("group_manager gets credit_waiting and unplanned", () => {
    const db = getDb();
    const o = createOrder(db, { customer_id: custId, order_date: today, created_by: owner, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] });
    confirmOrder(db, o.id); // CONFIRMED, no stop -> unplanned
    db.prepare(
      "INSERT INTO credit_approvals (organization_id, order_id, requested_by, requested_at, customer_balance_toman, credit_limit_toman, overage_toman, status) VALUES (1,?,?,?,1,0,1,'pending')"
    ).run(o.id, owner, new Date().toISOString());

    const b = todayFor(sess(mgr, "group_manager", groupId));
    const keys = b.panels.map((p) => p.key);
    expect(keys).toContain("credit_waiting");
    expect(keys).toContain("unplanned");
    // Each parked order links to itself, where «تأیید اعتبار» is decided — not to the
    // /sales/admin/credit-approvals page that was never built.
    const credit = b.panels.find((p) => p.key === "credit_waiting")!;
    expect(credit.items.map((i) => i.href)).toContain(`/sales/orders/${o.id}`);
  });

  it("puts no raw English enum on screen", () => {
    /* The briefing builds its panels straight from SQL rows, which is how two English
       enums reached a Persian page: `sub: a.severity` printed «critical» under «هشدارها»,
       and `label: s.stage` printed «prospect» under «نمایندگان بر اساس مرحله». The user
       reported the first; the second was found next to it.

       Asserted over every panel rather than the two that were wrong, because the next
       panel added here will be built the same way. */
    const db = getDb();
    db.prepare(
      "INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'critical','credit','درخواست اعتبار در انتظار تصمیم',?)",
    ).run(new Date().toISOString());
    db.prepare(
      "INSERT INTO representative_profiles (organization_id,customer_id,rep_code,stage,created_at,updated_at) VALUES (1,?,'R1','prospect',?,?)",
    ).run(custId, new Date().toISOString(), new Date().toISOString());

    const b = todayFor(sess(owner, "owner", null));
    for (const panel of b.panels) {
      for (const item of panel.items) {
        expect(item.label ?? "", `panel ${panel.key}`).not.toMatch(/[A-Za-z]{3,}/);
        expect(item.sub ?? "", `panel ${panel.key}`).not.toMatch(/[A-Za-z]{3,}/);
      }
    }
  });

  it("omits a panel with nothing actionable", () => {
    const b = todayFor(sess(seller, "phone_sales", groupId));
    // no tasks, no target -> neither panel present
    expect(b.panels.map((p) => p.key)).not.toContain("open_tasks");
    expect(b.panels.map((p) => p.key)).not.toContain("target");
  });

  it("gives EVERY role at least one panel, even on an empty day", () => {
    // todayFor is a chain of `if (role === ...)` blocks with no fallback, so a role with no
    // branch produces ZERO panels: a person who signs in to an empty screen, with no error
    // anywhere to explain it. That is how the next new role lands in production unnoticed.
    //
    // The stronger half of this: `panel()` returns null for an empty item list, so even a
    // role WITH a branch renders nothing when there is no data. platform_owner hit exactly
    // that — it matched no branch at all, and the owner branch it now shares also filters
    // empties. A founder on a quiet day must still get SOMETHING, or the briefing is
    // indistinguishable from a broken page.
    for (const role of ROLES) {
      const b = todayFor(sess(owner, role, role === "owner" || role === "platform_owner" ? null : groupId));
      expect(b.panels.length, `${role} produced no briefing panel`).toBeGreaterThan(0);
    }
  });
});
