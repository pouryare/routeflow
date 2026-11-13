import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-handover-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { handOver, previewHandover, HandoverError } = await import("@/lib/repo/handover");
import type { Session } from "@/lib/session";
import type { Role } from "@/lib/roles";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const NOW = "2026-01-01T00:00:00.000Z";
let owner: Session;
let leaver = 0;
let heir = 0;
let customerIds: number[] = [];

async function user(name: string, role: Role, active = true): Promise<number> {
  const r = await getDb().prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,?,?,1)").run(name, "x", name, role, active ? 1 : 0, NOW);
  return Number(r.lastInsertRowid);
}
const as = (id: number, role: Role): Session => ({ user: { id } as never, role, roles: [role], groupId: null, organizationId: 1, hasRole: (x: Role) => x === role });

beforeEach(async () => {
  const db = getDb();
  await db.exec("DELETE FROM events; DELETE FROM tasks;");
  const tag0 = Math.random().toString(36).slice(2, 8);
  owner = as(await user(`o-${tag0}`, "owner"), "owner");
  leaver = await user(`leaver-${tag0}`, "phone_sales");
  heir = await user(`heir-${tag0}`, "phone_sales");
  // Customers and their timeline lines are append-only history, so each test makes its own and never deletes.
  const tag = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  customerIds = [];
  for (const code of ["C1", "C2"]) {
    customerIds.push(Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id,owner_user_id) VALUES (?,?,?,?,1,?)").run(`${code}-${tag}`, code, "active", NOW, leaver)).lastInsertRowid));
  }
  await db.prepare("INSERT INTO tasks (organization_id, kind, title, assignee_user_id, status, created_at) VALUES (1,'note','باز',?,'open',?)").run(leaver, NOW);
  await db.prepare("INSERT INTO tasks (organization_id, kind, title, assignee_user_id, status, created_at) VALUES (1,'note','بسته',?,'done',?)").run(leaver, NOW);
});

describe("handover", () => {
  it("moves customers and open tasks, leaves a line on every customer and one event", async () => {
    expect(await previewHandover(owner, leaver)).toEqual({ customers: 2, tasks: 1 });
    expect(await handOver(owner, leaver, heir)).toEqual({ customers: 2, tasks: 1 });
    const db = getDb();
    expect(Number(((await db.prepare("SELECT COUNT(*) AS n FROM customers WHERE owner_user_id = ?").get(heir)) as { n: number }).n)).toBe(2);
    expect(Number(((await db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_user_id = ? AND status = 'open'").get(heir)) as { n: number }).n)).toBe(1);
    // a finished task stays with the person who did it
    expect(Number(((await db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE assignee_user_id = ?").get(leaver)) as { n: number }).n)).toBe(1);
    const notes = (await db.prepare("SELECT note FROM activities WHERE type = 'owner_change' AND customer_id = ANY(?::bigint[])").all(`{${customerIds.join(",")}}`)) as { note: string }[];
    expect(notes).toHaveLength(2);
    expect(notes[0].note).toContain("leaver-");
    expect(notes[0].note).toContain("heir-");
    expect(Number(((await db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'records.handed_over'").get()) as { n: number }).n)).toBe(1);
  });

  it("refuses a non-owner, the same person, a missing person and an inactive or non-selling receiver", async () => {
    await expect(handOver(as(heir, "phone_sales"), leaver, heir)).rejects.toThrow(HandoverError);
    await expect(handOver(owner, leaver, leaver)).rejects.toThrow(/کس دیگری/);
    await expect(handOver(owner, leaver, 999999)).rejects.toThrow(/پیدا نشد/);
    const gone = await user(`gone-${Math.random().toString(36).slice(2, 8)}`, "phone_sales", false);
    await expect(handOver(owner, leaver, gone)).rejects.toThrow(/فعال/);
    const shareholder = await user(`sh-${Math.random().toString(36).slice(2, 8)}`, "shareholder");
    await expect(handOver(owner, leaver, shareholder)).rejects.toThrow(/فعال/);
    // nothing moved
    expect(Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM customers WHERE owner_user_id = ?").get(leaver)) as { n: number }).n)).toBe(2);
  });
});
