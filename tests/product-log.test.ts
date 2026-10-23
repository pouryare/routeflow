import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dbPath = path.join(os.tmpdir(), `rf-product-log-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, rawSqlite } = await import("@/lib/db");
const { createProduct } = await import("@/lib/catalogue");
const { logProductChange, recentProductChanges, thresholdText } = await import("@/lib/repo/productLog");
const { applyQuickWins } = await import("@/lib/database/migrations/09-quick-wins");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
});

const session = (org: number) => ({ organizationId: org, role: "owner", user: { id: 1 } }) as never;

describe("product change log", () => {
  it("the widened activity log keeps its columns and is rebuilt only once", async () => {
    const db = getDb();
    const cols = (await db.prepare("PRAGMA table_info(activity_log)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("changed_by_user_id");
    expect(cols).toContain("impersonated_by");
    applyQuickWins(await rawSqlite()); // a second run is a no-op
  });

  it("records a change and reads it back for the product's organisation only", async () => {
    const db = getDb();
    await db.prepare("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?) ON CONFLICT DO NOTHING").run(new Date().toISOString());
    const uid = Number(
      (await db
        .prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,1,?,1)")
        .run(`o${Date.now()}`, "x", "مالک", "owner", new Date().toISOString())).lastInsertRowid
    );
    const mine = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
    const theirs = await createProduct(db, { name: "شیر", kg_per_base_unit: 1, organization_id: 2 });
    await logProductChange(mine, "created", { new: "کره" }, { id: uid, name: "مالک" });
    await logProductChange(theirs, "created", { new: "شیر" }, { id: uid, name: "مالک" });
    await logProductChange(
      mine,
      "thresholds",
      { old: thresholdText({ reorder_point: null, target_stock: null }), new: thresholdText({ reorder_point: 5, target_stock: 20 }) },
      { id: uid, name: "مالک" }
    );

    const rows = await recentProductChanges(session(1));
    expect(rows.map((r) => r.product_name)).toEqual(["کره", "کره"]);
    expect(rows[0].event_type).toBe("updated");
    expect(rows[0].new_value).toContain("5");
    expect(rows[1].event_type).toBe("created");
  });
});
