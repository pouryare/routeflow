import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-snap-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { snapshotFor } = await import("@/lib/repo/crm/snapshot");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-11T06:00:00.000Z";
const db = getDb();
const g1 = Number((await db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g1','g1',?,1)").run(NOW)).lastInsertRowid);
const user = async (u: string) =>
  Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES (?,?,?,?,?,?,1)").run(u, "x", u, "phone_sales", g1, NOW)).lastInsertRowid);
const rep = await user("snapRep");
const other = await user("snapOther");
const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,owner_user_id,group_id,synced_at,organization_id,verification,sales_stage,contact_status,temperature,phone_norm) VALUES ('S1','نانوایی سحر',?,?,?,1,'verified','customer','contacted','warm','9121112233')").run(rep, g1, NOW)).lastInsertRowid);
await db.prepare("INSERT INTO tasks (organization_id, kind, title, entity_type, entity_id, due_at, assignee_user_id, created_at) VALUES (1,'call','پیگیری چک','customer',?,?,?,?)").run(cust, "2026-09-12T10:00:00.000Z", rep, NOW);
const sess = (id: number): Session => ({ user: { id } as Session["user"], role: "phone_sales", groupId: g1, organizationId: 1, roles: ["phone_sales"], hasRole: (x) => x === "phone_sales" });

describe("pre-call snapshot", () => {
  it("gathers phone, open tasks and no-debt state for a rep's own customer", async () => {
    const s = await snapshotFor(sess(rep), cust);
    expect(s?.name).toBe("نانوایی سحر");
    expect(s?.phone).toBe("9121112233");
    expect(s?.openTasks.map((t) => t.title)).toEqual(["پیگیری چک"]);
    expect(s?.debtToman).toBe(0);
    expect(s?.lastOrder).toBeNull();
    expect(s?.holdReason).toBeNull();
  });
  it("refuses a customer another rep owns", async () => {
    expect(await snapshotFor(sess(other), cust)).toBeNull();
  });
});
