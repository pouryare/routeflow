import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-write-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { applyFlow, createLead, claimBusiness, CrmError } = await import("@/lib/repo/crm/write");
const { replayCrmState } = await import("@/lib/crm/replay");
const { ACTIVITY_FACT_COLUMNS } = await import("@/lib/repo/crm/migrate");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-11T06:00:00.000Z"; // 09:30 Tehran
const db = getDb();
const g1 = Number(db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g1','g1',?,1)").run(NOW).lastInsertRowid);
const user = (u: string, role: string) =>
  Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES (?,?,?,?,?,?,1)").run(u, "x", u, role, g1, NOW).lastInsertRowid);
const repA = user("repA", "phone_sales");
const repB = user("repB", "phone_sales");
let n = 0;
const cust = (owner: number | null, extra: Record<string, unknown> = {}) => {
  const row = { customer_code: `W-${++n}`, business_name: `کسب‌وکار ${n}`, owner_user_id: owner, group_id: g1, synced_at: NOW, organization_id: 1,
    verification: "unverified", sales_stage: "unknown", contact_status: "not_contacted", temperature: "cold", phone_norm: `91200${String(n).padStart(5, "0")}`, ...extra };
  const k = Object.keys(row);
  return Number(db.prepare(`INSERT INTO customers (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(Object.values(row) as never[])).lastInsertRowid);
};
const openTask = (customerId: number) => {
  const id = Number(db.prepare("INSERT INTO tasks (organization_id, kind, title, entity_type, entity_id, due_at, assignee_user_id, created_at) VALUES (1,'call','تماس','customer',?,?,?,?)").run(customerId, NOW, repA, NOW).lastInsertRowid);
  db.prepare("UPDATE customers SET next_task_id = ? WHERE id = ?").run(id, customerId);
  return id;
};
const A: Session = { user: { id: repA, display_name: "repA" } as Session["user"], role: "phone_sales", groupId: g1, organizationId: 1 };
const row = (id: number) => db.prepare("SELECT * FROM customers WHERE id = ?").get(id) as Record<string, unknown>;
const task = (id: number) => db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown>;
const replayOf = (id: number) => replayCrmState(db.prepare(`SELECT ${ACTIVITY_FACT_COLUMNS} FROM activities WHERE customer_id = ? ORDER BY occurred_at, id`).all(id) as never[]);
const expectStateIsReplay = (id: number) => {
  const r = row(id), s = replayOf(id);
  expect({ cs: r.contact_status, st: r.sales_stage, v: r.verification, t: r.temperature, a: r.attempt_count })
    .toEqual({ cs: s.contact_status, st: s.sales_stage, v: s.verification, t: s.temperature, a: s.attempt_count });
};

describe("applyFlow", () => {
  it("a missed call completes the opener, schedules tomorrow 10:00 and counts the attempt", () => {
    const c = cust(repA);
    const opener = openTask(c);
    const r = applyFlow(A, { customerId: c, entry: "call", channel: "call", taskId: opener, nowIso: NOW,
      answers: [{ step: "reach", option: "no_answer" }, { step: "noans", option: "t10" }] });
    expect(task(opener)).toMatchObject({ status: "done", outcome_code: "NO_ANSWER" });
    expect(task(r.nextTaskId!)).toMatchObject({ status: "open", kind: "call", due_at: "2026-09-12T06:30:00.000Z", assignee_user_id: repA, entity_id: c });
    expect(row(c)).toMatchObject({ next_task_id: r.nextTaskId, attempt_count: 1, contact_status: "no_answer" });
    expectStateIsReplay(c);
  });

  it("a first call verifies, records the contact by role and makes the lead hot", () => {
    const c = cust(repA);
    const r = applyFlow(A, { customerId: c, entry: "call", channel: "call", nowIso: NOW, answers: [
      { step: "reach", option: "talked" }, { step: "verify", option: "yes" },
      { step: "who", option: "PURCHASING", value: "رضا" }, { step: "what", option: "price" },
      { step: "prods", option: "ok" }, { step: "sendnow", option: "wa" },
    ] });
    expect(row(c)).toMatchObject({ verification: "verified", sales_stage: "interested", temperature: "hot", contact_status: "contacted", lifecycle: "qualified" });
    expect(db.prepare("SELECT name, role, is_primary, is_decider FROM contacts WHERE customer_id = ?").get(c)).toEqual({ name: "رضا", role: "PURCHASING", is_primary: 1, is_decider: 1 });
    expect(task(r.nextTaskId!)).toMatchObject({ kind: "quote_followup", priority: "HIGH" });
    expect(r.acc.share).toBe("whatsapp");
    expectStateIsReplay(c);
  });

  it("keeps exactly one open next action", () => {
    const c = cust(repA);
    const old = openTask(c);
    applyFlow(A, { customerId: c, entry: "call", channel: "call", nowIso: NOW, answers: [{ step: "reach", option: "busy" }, { step: "noans", option: "h2" }] });
    expect(task(old).status).toBe("dismissed");
    expect((db.prepare("SELECT COUNT(*) n FROM tasks WHERE entity_id = ? AND status = 'open'").get(c) as { n: number }).n).toBe(1);
  });

  it("moves the next action into working hours", () => {
    const c = cust(repA, { working_hours_json: JSON.stringify([{ days: [0, 1, 2, 3, 4, 5, 6], from: "12:00", to: "16:00" }]) });
    const r = applyFlow(A, { customerId: c, entry: "call", channel: "call", nowIso: NOW, answers: [{ step: "reach", option: "no_answer" }, { step: "noans", option: "t10" }] });
    expect(task(r.nextTaskId!).due_at).toBe("2026-09-12T08:30:00.000Z");
  });

  it("closes an invalid lead with no next action", () => {
    const c = cust(repA);
    const old = openTask(c);
    const r = applyFlow(A, { customerId: c, entry: "call", channel: "call", nowIso: NOW, answers: [
      { step: "reach", option: "talked" }, { step: "verify", option: "closed" }, { step: "closed", option: "yes" }] });
    expect(r.nextTaskId).toBeNull();
    expect(row(c)).toMatchObject({ verification: "invalid_closed", lost_reason_code: "CLOSED", next_task_id: null });
    expect(row(c).closed_at).toBeTruthy();
    expect(task(old).status).toBe("dismissed");
  });

  it("auto-claims an unassigned lead in the rep's group", () => {
    const c = cust(null);
    applyFlow(A, { customerId: c, entry: "call", channel: "call", nowIso: NOW, answers: [{ step: "reach", option: "no_answer" }, { step: "noans", option: "t10" }] });
    expect(row(c).owner_user_id).toBe(repA);
    expect(db.prepare("SELECT COUNT(*) n FROM activities WHERE customer_id = ? AND type = 'owner_change'").get(c)).toEqual({ n: 1 });
  });

  it("404s another rep's business and 400s an unfinished flow", () => {
    const c = cust(repB);
    expect(() => applyFlow(A, { customerId: c, entry: "call", channel: "call", answers: [{ step: "reach", option: "no_answer" }, { step: "noans", option: "t10" }] }))
      .toThrow(expect.objectContaining({ status: 404 }));
    const mine = cust(repA);
    expect(() => applyFlow(A, { customerId: mine, entry: "call", channel: "call", answers: [{ step: "reach", option: "no_answer" }] }))
      .toThrow(expect.objectContaining({ status: 400 }));
  });

  it("is idempotent on client_uuid", () => {
    const c = cust(repA);
    const input = { customerId: c, entry: "call" as const, channel: "call" as const, nowIso: NOW, clientUuid: "u-1",
      answers: [{ step: "reach", option: "no_answer" }, { step: "noans", option: "t10" }] };
    const a = applyFlow(A, input);
    const b = applyFlow(A, input);
    expect(b.activityId).toBe(a.activityId);
    expect(row(c).attempt_count).toBe(1);
  });
});

describe("createLead", () => {
  const LINK = JSON.stringify({ name: "کافه نو", lat: 35.7, lng: 51.4, address: "ونک، ملاصدرا", maps_url: "https://maps.app.goo.gl/x" });
  const basics = (phone: string, branch_of: number | null = null) => JSON.stringify({ name: "کافه نو", phone, branch_of });
  const HOURS = JSON.stringify([{ days: [0, 1, 2, 3, 4, 5, 6], from: "12:00", to: "23:00" }]);
  const answers = (b: string, first = "call_t10") => [
    { step: "src", option: "SNAPPFOOD" }, { step: "link", option: "ok", value: LINK }, { step: "basics", option: "ok", value: b },
    { step: "type", option: "CAFE" }, { step: "price", option: "high" }, { step: "hours", option: "ok", value: HOURS }, { step: "first", option: first },
  ];

  it("creates the business with source, tier, hours, owner and a first call", () => {
    const r = createLead(A, { answers: answers(basics("0912 999 0001")), nowIso: NOW });
    expect(row(r.id)).toMatchObject({ business_name: "کافه نو", phone_norm: "9129990001", source_code: "SNAPPFOOD", business_type: "CAFE",
      customer_type: "CAFE", price_tier: "high", owner_user_id: repA, group_id: g1, lifecycle: "lead", verification: "unverified",
      location_precision: "exact", maps_url: "https://maps.app.goo.gl/x", next_task_id: r.nextTaskId });
    expect(JSON.parse(row(r.id).working_hours_json as string)).toHaveLength(1);
    expect(task(r.nextTaskId!)).toMatchObject({ kind: "call", due_at: "2026-09-12T08:30:00.000Z" }); // moved to 12:00
    expect(db.prepare("SELECT type FROM activities WHERE customer_id = ?").get(r.id)).toEqual({ type: "lead_created" });
  });

  it("refuses a phone that already exists, unless it is declared a branch", () => {
    const first = createLead(A, { answers: answers(basics("0912 999 0002")), nowIso: NOW });
    expect(() => createLead(A, { answers: answers(basics("09129990002")), nowIso: NOW })).toThrow(expect.objectContaining({ status: 409 }));
    const branch = createLead(A, { answers: answers(basics("09129990002", first.id)), nowIso: NOW });
    expect(row(branch.id).parent_customer_id).toBe(first.id);
  });

  it("sends a phone-less lead to a driver visit", () => {
    const r = createLead(A, { answers: answers(basics(""), "driver"), nowIso: NOW });
    expect(row(r.id).phone_norm).toBeNull();
    expect(task(r.nextTaskId!)).toMatchObject({ kind: "verify_visit", role_hint: "field_rep", assignee_user_id: null, group_id: g1 });
  });

  it("422s without a usable location", () => {
    const bad = [
      { step: "src", option: "FIELD_VISIT" }, { step: "here", option: "nothere" }, { step: "basics", option: "ok", value: basics("") },
      { step: "loc", option: "map" }, { step: "pin", option: "ok", value: "{}" }, { step: "type", option: "CAFE" },
      { step: "price", option: "unknown" }, { step: "hours", option: "skip" }, { step: "first", option: "self" },
    ];
    expect(() => createLead(A, { answers: bad, nowIso: NOW })).toThrow(expect.objectContaining({ status: 422 }));
  });
});

describe("claimBusiness", () => {
  it("claims the pool, refuses someone else's", () => {
    const pool = cust(null);
    claimBusiness(A, pool);
    expect(row(pool).owner_user_id).toBe(repA);
    expect(() => claimBusiness(A, cust(repB))).toThrow(CrmError);
  });
});
