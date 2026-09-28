import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-reps-academy-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET: REPS_GET } = await import("@/app/api/sales/reps/route");
const { GET: REP_GET } = await import("@/app/api/sales/reps/[id]/route");
const { GET: OBJ_GET } = await import("@/app/api/sales/academy/objection/route");
const { GET: LESSONS_GET, POST: LESSONS_POST } = await import("@/app/api/sales/academy/lessons/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let seller = 0;
let repId = 0;

function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM lesson_progress; DELETE FROM representative_onboarding_steps; DELETE FROM representative_profiles; DELETE FROM customers; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)");
  owner = Number(u.run(`o${Date.now()}`, "x", "م", "owner", now).lastInsertRowid);
  seller = Number(u.run(`s${Date.now()}`, "x", "ف", "phone_sales", now).lastInsertRowid);
  const cust = Number(db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('R','نمایندهٔ الف','WHOLESALE','active',?,1)").run(now).lastInsertRowid);
  repId = Number(db.prepare("INSERT INTO representative_profiles (organization_id,customer_id,rep_code,stage,credit_terms_days,created_at,updated_at) VALUES (1,?,'REP-1','onboarding',0,?,?)").run(cust, now, now).lastInsertRowid);
  db.prepare("INSERT INTO representative_onboarding_steps (representative_id,step_code,label_fa) VALUES (?,'contract','قرارداد')").run(repId);
});

describe("reps + academy routes", () => {
  it("GET /api/sales/reps returns the overview; a salesperson is 403", async () => {
    const res = await REPS_GET(new NextRequest("http://localhost/api/sales/reps", { headers: { cookie: cookie(owner, "owner") } }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.reps).toHaveLength(1);
    expect(j.reps[0].rep_code).toBe("REP-1");

    const bad = await REPS_GET(new NextRequest("http://localhost/api/sales/reps", { headers: { cookie: cookie(seller, "phone_sales") } }));
    expect(bad.status).toBe(403);
  });

  it("GET /api/sales/reps/[id] returns health + onboarding", async () => {
    const res = await REP_GET(
      new NextRequest(`http://localhost/api/sales/reps/${repId}`, { headers: { cookie: cookie(owner, "owner") } }),
      ctxFor(repId)
    );
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.health.band).toBeTruthy();
    expect(j.onboarding).toHaveLength(1);
  });

  it("GET objection?outcome_code= returns a card", async () => {
    const res = await OBJ_GET(
      new NextRequest("http://localhost/api/sales/academy/objection?outcome_code=NOT_INTERESTED", {
        headers: { cookie: cookie(seller, "phone_sales") },
      })
    );
    const j = await res.json();
    expect(j.card.outcome_code).toBe("NOT_INTERESTED");
  });

  it("POST then GET lessons reflects the completion", async () => {
    const post = await LESSONS_POST(
      new NextRequest("http://localhost/api/sales/academy/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: cookie(seller, "phone_sales") },
        body: JSON.stringify({ lesson_slug: "02-phone-sales" }),
      })
    );
    expect(post.status).toBe(201);
    const j = await (await LESSONS_GET(new NextRequest("http://localhost/api/sales/academy/lessons", { headers: { cookie: cookie(seller, "phone_sales") } }))).json();
    expect(j.progress.map((p: { lesson_slug: string }) => p.lesson_slug)).toContain("02-phone-sales");
    expect(j.modules).toHaveLength(2);
  });
});
