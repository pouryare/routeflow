import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { reconcileGap, signedAmount } from "@/lib/reconcile";

const testDbPath = path.join(os.tmpdir(), `rf-rec-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { postTransfer } = await import("@/lib/repo/ledgerPostings");
const { reconcileView, saveReconcile } = await import("@/lib/repo/reconcile");
afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("A3 hand reconcile", () => {
  it("counts debits up and credits down", () => {
    expect(signedAmount("D", 10) + signedAmount("C", 4)).toBe(6);
    expect(reconcileGap(6, 2, 4)).toBe(0);
  });

  it("locks ticked lines only when the gap is zero, and ticked lines leave the list", async () => {
    await getDb().prepare(`INSERT INTO users (id, username, password_hash, display_name, role, organization_id, created_at) VALUES (1,'rc','x','R','owner',1,'2026-01-01') ON CONFLICT DO NOTHING`).run();
    const base = { organizationId: 1, postedAt: "2026-06-01T12:00:00.000Z", by: 1 };
    await postTransfer(getDb(), { ...base, from: "1101", to: "1102", amountToman: 700 });
    await postTransfer(getDb(), { ...base, from: "1101", to: "1102", amountToman: 300 });
    const view = await reconcileView(1, "1102");
    expect(view.lines.map((l) => l.signed)).toEqual([700, 300]);
    await expect(saveReconcile(1, "1102", 1000, [view.lines[0].id], 1)).rejects.toThrow();
    await expect(saveReconcile(1, "1102", 700, [], 1)).rejects.toThrow();
    await saveReconcile(1, "1102", 700, [view.lines[0].id], 1);
    const after = await reconcileView(1, "1102");
    expect(after.lockedToman).toBe(700);
    expect(after.lines.map((l) => l.signed)).toEqual([300]);
    await expect(saveReconcile(1, "1102", 700, [view.lines[0].id], 1)).rejects.toThrow();
    await saveReconcile(1, "1102", 1000, [after.lines[0].id], 1);
  });
});
