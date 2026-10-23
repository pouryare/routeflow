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
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop } = await import("@/lib/delivery");
const { createTask } = await import("@/lib/repo/tasks");
const { setTarget } = await import("@/lib/repo/targets");
const { todayFor } = await import("@/lib/repo/briefing");
const { toJalali, tehranTodayIso } = await import("@/lib/jalali");

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

/* tehranTodayIso, not toISOString().slice(0,10). The briefing now asks for Tehran's today,
   so a UTC-based fixture would stop matching for the last 3.5 hours of every evening and
   this file would fail only in the evening — the exact class of time-of-day flake the
   repo keeps rediscovering. The fixture must use the SAME clock as the code under test. */
const today = tehranTodayIso();
const jNow = toJalali(new Date().toISOString())!;
const PERIOD = `${jNow.jy}-${String(jNow.jm).padStart(2, "0")}`;

const sess = (id: number, role: string, gid: number | null): Session =>
  ({ user: { id } as never, role: role as never, groupId: gid, organizationId: 1, roles: [role] as Session["roles"], hasRole: (x) => x === role }) as Session;

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM tasks; DELETE FROM alerts; DELETE FROM targets; DELETE FROM credit_approvals; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM deliveries; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM groups; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  groupId = Number((await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('A','a',?,1)").run(now)).lastInsertRowid);
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)"
  );
  owner = Number((await u.run(`o${Date.now()}`, "x", "م", "owner", null, now)).lastInsertRowid);
  mgr = Number((await u.run(`m${Date.now()}`, "x", "مد", "group_manager", groupId, now)).lastInsertRowid);
  seller = Number((await u.run(`s${Date.now()}`, "x", "ف", "phone_sales", groupId, now)).lastInsertRowid);
  driver = Number((await u.run(`d${Date.now()}`, "x", "ر", "delivery_driver", groupId, now)).lastInsertRowid);
  custId = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('C','x','active',?,?,1)").run(now, groupId)).lastInsertRowid);
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  await setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
});

describe("todayFor", () => {
  it("salesperson gets open_tasks and the target panel", async () => {
    await createTask(1, { title: "تماس با علی", kind: "call", assignee_user_id: seller });
    await setTarget(1, { user_id: seller, period: PERIOD, metric: "revenue_toman", target_value: 100_000 });
    const b = await todayFor(sess(seller, "phone_sales", groupId));
    const keys = b.panels.map((p) => p.key);
    expect(keys).toContain("open_tasks");
    expect(keys).toContain("target");
    expect(b.panels.find((p) => p.key === "open_tasks")!.items[0].action).toMatchObject({ kind: "task_outcome" });
  });

  it("driver gets today_run and a retry panel for yesterday's failure", async () => {
    const db = getDb();
    const o = await createOrder(db, { customer_id: custId, order_date: today, created_by: owner, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] });
    await confirmOrder(db, o.id);
    const run = await createRun(db, { driver_user_id: driver, run_date: today, created_by: owner, organization_id: 1 });
    await addStop(db, run, o.id);

    // a failed order on yesterday's run
    const yesterday = tehranTodayIso(new Date(Date.now() - 86_400_000));
    const o2 = await createOrder(db, { customer_id: custId, order_date: yesterday, created_by: owner, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] });
    await confirmOrder(db, o2.id);
    const run2 = await createRun(db, { driver_user_id: driver, run_date: yesterday, created_by: owner, organization_id: 1 });
    await addStop(db, run2, o2.id);
    await db.prepare("UPDATE orders SET status = 'DELIVERY_FAILED' WHERE id = ?").run(o2.id);

    const b = await todayFor(sess(driver, "delivery_driver", groupId));
    const keys = b.panels.map((p) => p.key);
    expect(keys).toContain("today_run");
    expect(keys).toContain("retry");
    expect(b.panels.find((p) => p.key === "retry")!.items).toHaveLength(1);
  });

  it("group_manager gets credit_waiting and unplanned", async () => {
    const db = getDb();
    const o = await createOrder(db, { customer_id: custId, order_date: today, created_by: owner, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] });
    await confirmOrder(db, o.id); // CONFIRMED, no stop -> unplanned
    await db.prepare(
      "INSERT INTO credit_approvals (organization_id, order_id, requested_by, requested_at, customer_balance_toman, credit_limit_toman, overage_toman, status) VALUES (1,?,?,?,1,0,1,'pending')"
    ).run(o.id, owner, new Date().toISOString());

    const b = await todayFor(sess(mgr, "group_manager", groupId));
    const keys = b.panels.map((p) => p.key);
    expect(keys).toContain("credit_waiting");
    expect(keys).toContain("unplanned");
    // Each parked order links to itself, where «تأیید اعتبار» is decided — not to the
    // /sales/admin/credit-approvals page that was never built.
    const credit = b.panels.find((p) => p.key === "credit_waiting")!;
    expect(credit.items.map((i) => i.href)).toContain(`/sales/orders/${o.id}`);
  });

  it("puts no raw English enum on screen", async () => {
    /* The briefing builds its panels straight from SQL rows, which is how two English
       enums reached a Persian page: `sub: a.severity` printed «critical» under «هشدارها»,
       and `label: s.stage` printed «prospect» under «نمایندگان بر اساس مرحله». The user
       reported the first; the second was found next to it.

       Asserted over every panel rather than the two that were wrong, because the next
       panel added here will be built the same way.

       The order matters as much as the loop. This test used to seed an alert and a rep
       but NO order — so `orders_by_state` matched nothing, `panel()` returned null, and the
       assertion iterated over an empty set while the page went on printing «CONFIRMED».
       A guard with no fixtures is not a guard. The summary is walked too, because a status
       breakdown that reaches the header is still on screen. */
    const db = getDb();
    await db.prepare(
      "INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'critical','credit','درخواست اعتبار در انتظار تصمیم',?)",
    ).run(new Date().toISOString());
    await db.prepare(
      "INSERT INTO representative_profiles (organization_id,customer_id,rep_code,stage,created_at,updated_at) VALUES (1,?,'R1','prospect',?,?)",
    ).run(custId, new Date().toISOString(), new Date().toISOString());
    const o = await createOrder(db, { customer_id: custId, order_date: today, created_by: owner, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] });
    await confirmOrder(db, o.id);

    const b = await todayFor(sess(owner, "owner", null));
    expect(b.panels.map((p) => p.key)).toContain("orders_by_state");
    for (const panel of b.panels) {
      for (const item of [...(panel.summary ?? []), ...panel.items]) {
        expect(item.label ?? "", `panel ${panel.key}`).not.toMatch(/[A-Za-z]{3,}/);
        expect(item.sub ?? "", `panel ${panel.key}`).not.toMatch(/[A-Za-z]{3,}/);
      }
    }
  });

  it("«سفارش‌های امروز» names its orders instead of only counting them", async () => {
    /* One row per ORDER, not one row per status. The panel used to answer "there are five"
       and nothing else — no order number, no customer, no money — and every row linked to
       the same generic board, so a manager could not tell WHICH five. The status breakdown
       survives as the panel's header, because that is a different statement from the list. */
    const db = getDb();
    const o = await createOrder(db, { customer_id: custId, order_date: today, created_by: owner, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 2 }] });
    await confirmOrder(db, o.id);
    const name = (await db.prepare("SELECT business_name FROM customers WHERE id = ?").get(custId) as { business_name: string }).business_name;

    const p = (await todayFor(sess(owner, "owner", null))).panels.find((x) => x.key === "orders_by_state");
    expect(p).toBeDefined();

    // The breakdown is Persian, and it is a header rather than another row of «تأییدشده».
    expect(p!.summary?.map((s) => s.label)).toContain("تأییدشده");
    expect(p!.summary?.map((s) => s.sub)).toContain("۱");

    // Each order is named, priced, and opens ITSELF — the same contract credit_waiting has.
    const row = p!.items.find((i) => i.href === `/sales/orders/${o.id}`);
    expect(row, "the order does not link from its own panel").toBeDefined();
    expect(row!.label).toMatch(/سفارش/);
    expect(row!.sub).toContain(name);
    expect(row!.sub).toContain("تومان");
    expect(row!.sub).toMatch(/[۰-۹]/);
  });

  it("open_tasks never prints the raw priority enum", async () => {
    /* `sub: t.priority` put «HIGH» beside a Persian task title. Same leak as the order
       status, two panels up — found while fixing that one, exactly as the alert severity
       was. Asserted against a HIGH task specifically, because the demo seed writes NORMAL
       for everything and a NORMAL-only fixture would not have proved the map is consulted. */
    await createTask(1, { title: "تماس با علی", kind: "call", assignee_user_id: seller, priority: "HIGH" });
    const p = (await todayFor(sess(seller, "phone_sales", groupId))).panels.find((x) => x.key === "open_tasks");
    expect(p).toBeDefined();
    expect(p!.items.map((i) => i.sub)).toContain("زیاد");
    expect(JSON.stringify(p)).not.toMatch(/CRITICAL|HIGH|NORMAL|LOW/);
  });

  it("omits a panel with nothing actionable", async () => {
    const b = await todayFor(sess(seller, "phone_sales", groupId));
    // no tasks, no target -> neither panel present
    expect(b.panels.map((p) => p.key)).not.toContain("open_tasks");
    expect(b.panels.map((p) => p.key)).not.toContain("target");
  });

  it("gives EVERY role at least one panel, even on an empty day", async () => {
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
      const b = await todayFor(sess(owner, role, role === "owner" || role === "platform_owner" ? null : groupId));
      expect(b.panels.length, `${role} produced no briefing panel`).toBeGreaterThan(0);
    }
  });
});
