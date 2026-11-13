import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-assign-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { pickRep } = await import("@/lib/repo/assign");
const { tehranTodayIso } = await import("@/lib/jalali");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let group = 0;
let reps: number[] = [];

async function rep(name: string): Promise<number> {
  const db = getDb();
  const r = await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id,group_id) VALUES (?,?,?,?,1,?,1,?)").run(name, "x", name, "phone_sales", "2026-01-01T00:00:00.000Z", group);
  const id = Number(r.lastInsertRowid);
  await db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'phone_sales') ON CONFLICT DO NOTHING").run(id);
  return id;
}

beforeEach(async () => {
  const tag = Math.random().toString(36).slice(2, 8);
  const g = await getDb().prepare("INSERT INTO groups (name, slug, active, created_at, organization_id) VALUES (?,?,1,?,1)").run(`g-${tag}`, `g-${tag}`, "2026-01-01T00:00:00.000Z");
  group = Number(g.lastInsertRowid);
  reps = [await rep(`a-${tag}`), await rep(`b-${tag}`), await rep(`c-${tag}`)];
});

const mode = (m: string) => getDb().prepare("UPDATE groups SET assign_mode = ? WHERE id = ?").run(m, group);

describe("fair assignment (S6)", () => {
  it("leaves the lead in the pool by default", async () => {
    expect(await pickRep(getDb(), 1, group)).toBeNull();
  });

  it("goes round, one person after another, and skips someone on leave", async () => {
    await mode("round_robin");
    const got = [await pickRep(getDb(), 1, group), await pickRep(getDb(), 1, group), await pickRep(getDb(), 1, group), await pickRep(getDb(), 1, group)];
    expect(got).toEqual([reps[0], reps[1], reps[2], reps[0]]);
    await getDb().prepare("UPDATE users SET leave_until = ? WHERE id = ?").run(tehranTodayIso(), reps[1]);
    const next = [await pickRep(getDb(), 1, group), await pickRep(getDb(), 1, group), await pickRep(getDb(), 1, group)];
    expect(next).not.toContain(reps[1]);
    expect(new Set(next).size).toBe(2);
  });

  it("gives the lead to the person with the fewest open leads", async () => {
    await mode("least_open");
    for (const [i, n] of [[0, 2], [1, 0], [2, 1]] as const) {
      for (let k = 0; k < n; k++) {
        await getDb().prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id,owner_user_id) VALUES (?,?,'lead',?,1,?)").run(`L-${reps[i]}-${k}-${Math.random()}`, "x", "2026-01-01T00:00:00.000Z", reps[i]);
      }
    }
    expect(await pickRep(getDb(), 1, group)).toBe(reps[1]);
  });

  it("stays in the pool when everyone is away", async () => {
    await mode("round_robin");
    await getDb().prepare("UPDATE users SET leave_until = ? WHERE group_id = ?").run(tehranTodayIso(), group);
    expect(await pickRep(getDb(), 1, group)).toBeNull();
  });
});
