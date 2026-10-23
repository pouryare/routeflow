import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runsNeedingFreeze, freezeRun } from "@/lib/repo/routing";

const testDbPath = path.join(os.tmpdir(), `rf-freeze-${Date.now()}-${process.pid}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = () => new Date().toISOString();
const ctx = { org: 1, user: 0, customer: 0, product: 0, packaging: 0 };
let tagCounter = 0;

/** An order that is CONFIRMED and not on any run. */
async function makeOrder(): Promise<number> {
  const db = getDb();
  const oid = Number(
    (await db.prepare(
      "INSERT INTO orders (order_no, customer_id, order_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, ?, ?, 'CONFIRMED', ?, ?, ?, ?)",
    ).run(`FRZ-${process.pid}-${tagCounter++}`, ctx.customer, iso().slice(0, 10), ctx.user, ctx.org, iso(), iso())).lastInsertRowid,
  );
  await db.prepare(
    `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, qty_per_pack, kg_per_base_unit, created_at)
     VALUES (?, ?, ?, 2, 100000, 6, 2, ?)`,
  ).run(oid, ctx.product, ctx.packaging, iso());
  return oid;
}

/** A planned run for `day`, with NO route_template_id — exactly what createRun and commitPlan
 *  produce, and the thing this phase is about. */
async function makeTemplateLessRun(day: string, orderIds: number[] = []): Promise<number> {
  const db = getDb();
  const runId = Number(
    (await db.prepare(
      "INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, ?, 'planned', ?, ?, ?, ?)",
    ).run(ctx.user, day, ctx.user, ctx.org, iso(), iso())).lastInsertRowid,
  );
  for (const [i, oid] of orderIds.entries()) {
    await db.prepare(
      "INSERT INTO delivery_stops (run_id, order_id, sort_order, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
    ).run(runId, oid, i, iso());
  }
  return runId;
}

beforeAll(async () => {
  const db = getDb();
  ctx.user = Number(
    (await db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'owner', ?)")
      .run(`own-${process.pid}`, "مالک", iso())).lastInsertRowid,
  );
  ctx.customer = Number(
    (await db.prepare("INSERT INTO customers (customer_code, business_name, lat, lng, synced_at, organization_id) VALUES (?, ?, 35.7, 51.4, ?, ?)")
      .run(`C-FRZ-${process.pid}`, "مشتری تست", iso(), ctx.org)).lastInsertRowid,
  );
  ctx.product = Number(
    (await db.prepare("INSERT INTO products (name, kg_per_base_unit, organization_id, created_at, updated_at) VALUES (?, 2, ?, ?, ?)")
      .run("کالا", ctx.org, iso(), iso())).lastInsertRowid,
  );
  ctx.packaging = Number(
    (await db.prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, 6, ?)")
      .run(ctx.product, "بسته", iso())).lastInsertRowid,
  );
});
describe("runsNeedingFreeze — a run with NO route_template_id", () => {
  it("is reachable at all, which it was not before this phase", async () => {
    // THE REGRESSION. runsNeedingFreeze inner-joined route_schedules on route_template_id, and
    // createRun/commitPlan insert NULL there. An inner join on NULL matches nothing, so EVERY
    // board-created run was invisible to the freeze — "committed" was a word with no behaviour
    // behind it, on every day, for every tenant.
    const day = "2099-06-06";
    const runId = await makeTemplateLessRun(day, [await makeOrder()]);

    const due = await runsNeedingFreeze(ctx.org, `${day}T23:30:00.000Z`);
    expect(due.map((r) => r.id)).toContain(runId);
  });

  it("is NOT due before the cutoff has passed", async () => {
    // The cutoff is what "committed" means. Before it, the office may still be adding stops.
    const day = "2099-06-07";
    const runId = await makeTemplateLessRun(day, [await makeOrder()]);

    const before = await runsNeedingFreeze(ctx.org, `${day}T08:00:00.000Z`);
    expect(before.map((r) => r.id)).not.toContain(runId);
  });

  it("leaves an already-frozen run out", async () => {
    const day = "2099-06-08";
    const runId = await makeTemplateLessRun(day, [await makeOrder()]);
    await freezeRun(ctx.org, runId, { id: ctx.user, role: "owner" });

    const due = await runsNeedingFreeze(ctx.org, `${day}T23:30:00.000Z`);
    expect(due.map((r) => r.id)).not.toContain(runId);
  });

  it("still respects a template's own cutoff when the run HAS a template", async () => {
    // The original behaviour must survive: a templated run freezes at the template's cutoff, not
    // the organisation default.
    const db = getDb();
    const day = "2099-06-09";
    const templateId = Number(
      (await db.prepare("INSERT INTO route_templates (organization_id, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(ctx.org, `TPL-${process.pid}-${tagCounter++}`, "قالب", iso(), iso())).lastInsertRowid,
    );
    /* شنبه = 0 in this codebase's scheme, and derived from the date rather than hardcoded: an
       earlier version wrote 0 here while the date fell on weekday 3, so the template silently
       matched no schedule at all and the test was passing for the wrong reason. */
    const dow = (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 1) % 7;
    await db.prepare(
      "INSERT INTO route_schedules (organization_id, route_template_id, day_of_week, cutoff_time, created_at) VALUES (?, ?, ?, '06:00', ?)",
    ).run(ctx.org, templateId, dow, iso());

    const runId = Number(
      (await db.prepare(
        "INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, route_template_id, created_at, updated_at) VALUES (?, ?, 'planned', ?, ?, ?, ?, ?)",
      ).run(ctx.user, day, ctx.user, ctx.org, templateId, iso(), iso())).lastInsertRowid,
    );

    // 07:00 is past the template's 06:00 cutoff, so it is due — proving the template wins.
    const due = await runsNeedingFreeze(ctx.org, `${day}T07:00:00.000Z`);
    expect(due.map((r) => r.id)).toContain(runId);
  });
});

describe("freezeRun — on a mixed run", () => {
  it("freezes the run and keeps a visit on it", async () => {
    // A mixed run carries a `lead_run_stops` row with no order_id. A frozen day still has to be
    // drivable, so the visit must survive.
    const day = "2099-06-10";
    const runId = await makeTemplateLessRun(day, [await makeOrder()]);
    const db = getDb();
    const locId = Number(
      (await db.prepare("INSERT INTO saved_locations (name, maps_url, organization_id, created_at) VALUES (?, ?, ?, ?)")
        .run(`موقعیت-${process.pid}`, `u${process.pid}-${tagCounter++}`, ctx.org, iso())).lastInsertRowid,
    );
    await db.prepare("INSERT INTO lead_run_stops (run_id, location_id, sort_order, created_at) VALUES (?, ?, 0, ?)")
      .run(runId, locId, iso());

    await (async () => await freezeRun(ctx.org, runId, { id: ctx.user, role: "owner" }))();

    const run = await db.prepare("SELECT status, frozen_at FROM delivery_runs WHERE id = ?").get(runId) as {
      status: string;
      frozen_at: string | null;
    };
    expect(run.status).toBe("ready");
    expect(run.frozen_at).not.toBeNull();
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM lead_run_stops WHERE run_id = ?").get(runId) as { n: number }).n,
    ).toBe(1);
  });

  it("is safe to call twice", async () => {
    // A freeze that throws on the second call would make the button a landmine.
    const day = "2099-06-11";
    const runId = await makeTemplateLessRun(day, [await makeOrder()]);
    await freezeRun(ctx.org, runId, { id: ctx.user, role: "owner" });
    await (async () => await freezeRun(ctx.org, runId, { id: ctx.user, role: "owner" }))();
  });
});
