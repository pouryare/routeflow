import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-tpl-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { fillTemplate, templateProblem } = await import("@/lib/messageTemplate");
const { setTemplate, templateFor, templatesOf } = await import("@/lib/repo/notificationTemplates");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("template wording", () => {
  it("fills placeholders from the event", () => {
    expect(fillTemplate("order.confirmed", "سفارش {order_no} تأیید شد", "{customer_name}", { order_no: "1042", customer_name: "رستوران" })).toEqual({ title_fa: "سفارش 1042 تأیید شد", body_fa: "رستوران" });
  });
  it("leaves a missing value empty", () => {
    expect(fillTemplate("order.confirmed", "سفارش {order_no}", null, { order_no: null })?.title_fa).toBe("سفارش");
  });
  it("refuses an unknown placeholder, an empty title, a too-long text and an unknown type", () => {
    expect(templateProblem("order.confirmed", "{amount_toman}", null)).toMatch(/وجود ندارد/);
    expect(templateProblem("order.confirmed", " ", null)).toMatch(/خالی/);
    expect(templateProblem("order.confirmed", "ب".repeat(81), null)).toMatch(/حداکثر/);
    expect(templateProblem("nope", "x", null)).toMatch(/قابل تغییر نیست/);
    expect(fillTemplate("order.confirmed", "{bad}", null, {})).toBeNull();
  });
});

describe("saved wording", () => {
  let user = 0;
  beforeAll(async () => {
    user = Number((await getDb().prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('t-own','x:y','م','owner',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
  });
  it("saves, replaces and restores the shipped text", async () => {
    expect(await setTemplate(1, "order.created", "سفارش تازه {order_no}", null, user)).toBeNull();
    expect((await templateFor(1, "order.created"))?.title_fa).toBe("سفارش تازه {order_no}");
    expect(await setTemplate(1, "order.created", "دومی", "ب", user)).toBeNull();
    expect((await templatesOf(1))).toHaveLength(1);
    expect(await setTemplate(1, "order.created", null, null, user)).toBeNull();
    expect(await templateFor(1, "order.created")).toBeNull();
  });
  it("refuses a bad wording", async () => {
    expect(await setTemplate(1, "order.created", "{zzz}", null, user)).toMatch(/وجود ندارد/);
  });
});
