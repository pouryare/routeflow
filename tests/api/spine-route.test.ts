import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-spine-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET: TODAY } = await import("@/app/api/today/route");
const { GET: TASKS_GET, POST: TASKS_POST } = await import("@/app/api/tasks/route");
const { PATCH: TASK_PATCH } = await import("@/app/api/tasks/[id]/route");
const { GET: ALERTS_GET } = await import("@/app/api/alerts/route");
const { POST: TARGETS_POST } = await import("@/app/api/targets/route");
const { POST: RULES_RUN } = await import("@/app/api/rules/run/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let seller = 0;
let driver = 0;

function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}

beforeEach(() => {
  const db = getDb();
  db.exec("PRAGMA foreign_keys=OFF; DELETE FROM tasks; DELETE FROM alerts; DELETE FROM targets; DELETE FROM rule_runs; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;");
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x", "م", "owner", now).lastInsertRowid);
  seller = Number(u.run(`s${Date.now()}`, "x", "ف", "phone_sales", now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x", "ر", "delivery_driver", now).lastInsertRowid);
});

describe("spine routes", () => {
  it("GET /api/today returns panels for a driver", async () => {
    const res = await TODAY(
      new NextRequest("http://localhost/api/today", { headers: { cookie: cookie(driver, "delivery_driver") } })
    );
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.role).toBe("delivery_driver");
    expect(Array.isArray(j.panels)).toBe(true);
  });

  it("create a task, list it, complete it with an outcome", async () => {
    const post = await TASKS_POST(
      new NextRequest("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookie(owner, "owner") },
        body: JSON.stringify({ title: "تماس", kind: "call", assignee_user_id: seller }),
      })
    );
    expect(post.status).toBe(201);
    const { id } = await post.json();

    const list = await (await TASKS_GET(new NextRequest("http://localhost/api/tasks", { headers: { cookie: cookie(seller, "phone_sales") } }))).json();
    expect(list.tasks.some((t: { id: number }) => t.id === id)).toBe(true);

    const patch = await TASK_PATCH(
      new NextRequest(`http://localhost/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: cookie(seller, "phone_sales") },
        body: JSON.stringify({ status: "done", outcome_code: "PRICE_OBJECTION" }),
      }),
      ctxFor(id)
    );
    expect(patch.status).toBe(200);
    expect(
      (getDb().prepare("SELECT status FROM tasks WHERE id = ?").get(id) as { status: string }).status
    ).toBe("done");
  });

  it("PATCH with an outcome_code returns the matching objection card", async () => {
    const db = getDb();
    const cust = Number(
      db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('C1','x','RESTAURANT','active',?,1)").run(new Date().toISOString()).lastInsertRowid
    );
    const post = await TASKS_POST(
      new NextRequest("http://localhost/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookie(owner, "owner") },
        body: JSON.stringify({ title: "تماس", kind: "call", assignee_user_id: seller, entity_type: "customer", entity_id: cust }),
      })
    );
    const { id } = await post.json();
    const res = await TASK_PATCH(
      new NextRequest(`http://localhost/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: cookie(seller, "phone_sales") },
        body: JSON.stringify({ status: "done", outcome_code: "PRICE_OBJECTION" }),
      }),
      ctxFor(id)
    );
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.objection_card.script_fa).toContain("قیمت");
  });

  it("alerts GET works and rules/run returns a count", async () => {
    getDb().prepare("INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'critical','x','!',?)").run(new Date().toISOString());
    const a = await (await ALERTS_GET(new NextRequest("http://localhost/api/alerts?open=1", { headers: { cookie: cookie(owner, "owner") } }))).json();
    expect(a.alerts).toHaveLength(1);

    const run = await RULES_RUN(new NextRequest("http://localhost/api/rules/run", { method: "POST", headers: { cookie: cookie(owner, "owner") } }));
    const j = await run.json();
    expect(run.status).toBe(200);
    expect(typeof j.fired).toBe("number");
  });

  it("403s a salesperson posting a target", async () => {
    const res = await TARGETS_POST(
      new NextRequest("http://localhost/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookie(seller, "phone_sales") },
        body: JSON.stringify({ period: "1405-01", metric: "kg", target_value: 10 }),
      })
    );
    expect(res.status).toBe(403);
  });
});
