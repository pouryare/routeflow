import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-complaint-workflow-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET, POST } = await import("@/app/api/sales/complaints/[id]/steps/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

function cookie(uid: number, role: string) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid: null, oid: 1, tv: 0, name: "م" })}`;
}
function ctxFor(id: number) {
  return { params: Promise.resolve({ id: String(id) }) } as never;
}

let complaintId = 0;
let owner = 0;
let salesperson = 0;

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM workflow_edges; DELETE FROM tasks WHERE id > 0; DELETE FROM quality_complaints; DELETE FROM users WHERE id > 0;");
  const now = new Date().toISOString();
  owner = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('o','x','مالک','owner',1,?,1)"
      )
      .run(now).lastInsertRowid,
  );
  salesperson = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('s','x','فروشنده','salesperson',1,?,1)"
      )
      .run(now).lastInsertRowid,
  );
  complaintId = Number(
    db
      .prepare(
        "INSERT INTO quality_complaints (organization_id,reported_at,reported_by,category,severity,status,created_at) VALUES (1,?,?,?,?,?,?)"
      )
      .run(now, salesperson, "spoilage", "high", "open", now).lastInsertRowid,
  );
});

describe("GET /api/sales/complaints/[id]/steps", () => {
  it("a salesperson can read (list parity with the complaints list route)", async () => {
    const req = new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
      headers: { cookie: cookie(salesperson, "salesperson") },
    });
    const res = await GET(req, ctxFor(complaintId));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.templates).toHaveLength(6);
    expect(json.tasks).toEqual([]);
    expect(json.edges).toEqual([]);
  });

  it("404s for a complaint id that does not exist", async () => {
    const req = new NextRequest(`http://x/api/sales/complaints/999999/steps`, {
      headers: { cookie: cookie(owner, "owner") },
    });
    const res = await GET(req, ctxFor(999999));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/sales/complaints/[id]/steps", () => {
  it("an owner can spawn a root step", async () => {
    const req = new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
      method: "POST",
      headers: { cookie: cookie(owner, "owner"), "content-type": "application/json" },
      body: JSON.stringify({ template_key: "initial_review" }),
    });
    const res = await POST(req, ctxFor(complaintId));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.edge).toBeNull();
    expect(typeof json.task_id).toBe("number");
  });

  it("a salesperson cannot spawn a step (write parity with the status-change gate)", async () => {
    const req = new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
      method: "POST",
      headers: { cookie: cookie(salesperson, "salesperson"), "content-type": "application/json" },
      body: JSON.stringify({ template_key: "initial_review" }),
    });
    const res = await POST(req, ctxFor(complaintId));
    expect(res.status).toBe(403);
  });

  it("rejects an unknown template_key with 400, not a 500", async () => {
    const req = new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
      method: "POST",
      headers: { cookie: cookie(owner, "owner"), "content-type": "application/json" },
      body: JSON.stringify({ template_key: "bogus" }),
    });
    const res = await POST(req, ctxFor(complaintId));
    expect(res.status).toBe(400);
  });

  it("chains a second step onto the first", async () => {
    const first = await POST(
      new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
        method: "POST",
        headers: { cookie: cookie(owner, "owner"), "content-type": "application/json" },
        body: JSON.stringify({ template_key: "initial_review" }),
      }),
      ctxFor(complaintId),
    );
    const firstJson = await first.json();
    const second = await POST(
      new NextRequest(`http://x/api/sales/complaints/${complaintId}/steps`, {
        method: "POST",
        headers: { cookie: cookie(owner, "owner"), "content-type": "application/json" },
        body: JSON.stringify({ template_key: "lab_check", from_task_id: firstJson.task_id }),
      }),
      ctxFor(complaintId),
    );
    expect(second.status).toBe(201);
    const secondJson = await second.json();
    expect(secondJson.edge).toEqual({ from_task_id: firstJson.task_id, to_task_id: secondJson.task_id });
  });
});
