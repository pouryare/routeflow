import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDbPath = path.join(os.tmpdir(), `rf-rundrafts-${Date.now()}-${process.pid}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const {
  readRunDrafts,
  createDraft,
  addOrderToDraft,
  removeOrderFromDraft,
  setDraftTarget,
  deleteDraft,
  isEmpty,
  isReadyToCommit,
} = await import("@/lib/repo/runDrafts");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = () => new Date().toISOString();
const ctx = { org: 1, me: 0, other: 0, driver: 0, orders: [] as number[] };

beforeAll(() => {
  const db = getDb();
  const user = (username: string) =>
    Number(
      db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
           VALUES (?, 'x:y', ?, 'group_manager', NULL, 1, ?, ?)`
        )
        .run(`${username}-${process.pid}`, username, iso(), ctx.org).lastInsertRowid
    );
  ctx.me = user("me");
  ctx.other = user("other");
  ctx.driver = user("driver");

  const customer = Number(
    db
      .prepare(
        `INSERT INTO customers (organization_id, customer_code, business_name, synced_at) VALUES (?, 'RD-1', 'مشتری', ?)`
      )
      .run(ctx.org, iso()).lastInsertRowid
  );
  for (let i = 1; i <= 4; i++) {
    ctx.orders.push(
      Number(
        db
          .prepare(
            `INSERT INTO orders (organization_id, customer_id, status, order_no, order_date, created_by, created_at, updated_at)
             VALUES (?, ?, 'CONFIRMED', ?, '2026-11-01', ?, ?, ?)`
          )
          .run(ctx.org, customer, `RD-${i}`, ctx.me, iso(), iso()).lastInsertRowid
      )
    );
  }
});

const mine = (id: number) =>
  readRunDrafts(getDb(), ctx.org, ctx.me).find((d) => d.id === id)!;
const add = (draftId: number, orderId: number, userId = ctx.me) =>
  addOrderToDraft({ organizationId: ctx.org, userId, draftId, orderId });
describe("privacy", () => {
  it("shows nobody else's drafts, even inside the same company", () => {
    const id = createDraft({ organizationId: ctx.org, userId: ctx.me, bySuggest: true });
    add(id, ctx.orders[0]);

    expect(readRunDrafts(getDb(), ctx.org, ctx.me).some((d) => d.id === id)).toBe(true);
    // This is the whole privacy promise, and it cannot be made by a table that only knows the
    // company. Two managers in one tenant must not see each other's half-formed plans.
    expect(readRunDrafts(getDb(), ctx.org, ctx.other).some((d) => d.id === id)).toBe(false);
  });

  it("refuses to add to a draft that is not yours", () => {
    const id = createDraft({ organizationId: ctx.org, userId: ctx.me });
    expect(() => add(id, ctx.orders[1], ctx.other)).toThrow(/پیدا نشد/);
  });

  it("another user's delete removes nothing", () => {
    const id = createDraft({ organizationId: ctx.org, userId: ctx.me });
    deleteDraft({ organizationId: ctx.org, userId: ctx.other, draftId: id });
    expect(readRunDrafts(getDb(), ctx.org, ctx.me).some((d) => d.id === id)).toBe(true);
  });
});

describe("«پیشنهاد بده» fills empty lanes only", () => {
  it("an untouched suggested lane is empty", () => {
    expect(isEmpty(mine(createDraft({ organizationId: ctx.org, userId: ctx.me, bySuggest: true })))).toBe(
      true
    );
  });

  it("the first hand-drag retires it, and NOTHING clears that", () => {
    const id = createDraft({ organizationId: ctx.org, userId: ctx.me, bySuggest: true });
    add(id, ctx.orders[2]);
    expect(isEmpty(mine(id))).toBe(false);

    // Taking every order back out again must NOT make it empty again. The person spent time
    // here; a later press of the button must not overwrite that silently.
    removeOrderFromDraft({
      organizationId: ctx.org,
      userId: ctx.me,
      draftId: id,
      orderId: ctx.orders[2],
    });
    expect(mine(id).order_ids).toEqual([]);
    expect(isEmpty(mine(id))).toBe(false);
  });

  it("choosing a driver or a date also retires it", () => {
    const id = createDraft({ organizationId: ctx.org, userId: ctx.me, bySuggest: true });
    setDraftTarget({ organizationId: ctx.org, userId: ctx.me, draftId: id, driverUserId: ctx.driver });
    // Otherwise «پیشنهاد بده» would refill a lane the manager had already decided about.
    expect(isEmpty(mine(id))).toBe(false);
  });

  it("a lane a person made is never empty", () => {
    expect(isEmpty(mine(createDraft({ organizationId: ctx.org, userId: ctx.me })))).toBe(false);
  });
});

describe("an order lives in one lane at a time", () => {
  it("dragging it elsewhere moves it rather than copying it", () => {
    const a = createDraft({ organizationId: ctx.org, userId: ctx.me });
    const b = createDraft({ organizationId: ctx.org, userId: ctx.me });
    add(a, ctx.orders[3]);
    add(b, ctx.orders[3]);
    // Two lanes claiming one order would mean whichever committed first silently loses the other.
    expect(mine(a).order_ids).not.toContain(ctx.orders[3]);
    expect(mine(b).order_ids).toEqual([ctx.orders[3]]);
  });

  it("refuses the same order twice in one lane", () => {
    const id = createDraft({ organizationId: ctx.org, userId: ctx.me });
    add(id, ctx.orders[0]);
    add(id, ctx.orders[0]);
    expect(mine(id).order_ids).toEqual([ctx.orders[0]]);
  });

  it("keeps the order they were dragged in", () => {
    const id = createDraft({ organizationId: ctx.org, userId: ctx.me });
    add(id, ctx.orders[2]);
    add(id, ctx.orders[1]);
    expect(mine(id).order_ids).toEqual([ctx.orders[2], ctx.orders[1]]);
  });
});

describe("a draft is a lane that is not real yet", () => {
  it("starts with neither a driver nor a date, and is therefore not ready", () => {
    const d = mine(createDraft({ organizationId: ctx.org, userId: ctx.me }));
    expect(d.driver_user_id).toBeNull();
    expect(d.run_date).toBeNull();
    expect(isReadyToCommit(d)).toBe(false);
  });

  it("becomes real only when BOTH the driver and the date are chosen", () => {
    const id = createDraft({ organizationId: ctx.org, userId: ctx.me });
    setDraftTarget({ organizationId: ctx.org, userId: ctx.me, draftId: id, driverUserId: ctx.driver });
    // A driver alone is not enough -- a day with no date is not a day.
    expect(isReadyToCommit(mine(id))).toBe(false);
    setDraftTarget({ organizationId: ctx.org, userId: ctx.me, draftId: id, runDate: "2026-11-02" });
    expect(isReadyToCommit(mine(id))).toBe(true);
  });
});