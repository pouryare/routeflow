import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import type { Session } from "@/lib/session";

/** The race the PostgreSQL watermark exists for (db/migrations/1761400000000_sync-xid.sql).
 *
 *  A writer stamps a row and has not committed yet; a pull runs and moves the watermark on;
 *  then the writer commits. With a timestamp watermark the row's stamp is already behind the
 *  watermark, so the device never gets it. With the transaction-id watermark the writer was
 *  still running when the pull began, so the next pull asks for it again.
 *
 *  SQLite has one writer at a time, so the race cannot happen there and this file only runs
 *  on PostgreSQL. */

process.env.ROUTEFLOW_DB_PATH = path.join(os.tmpdir(), `rf-sync-xid-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";

const owner = (id: number): Session =>
  ({
    user: { id } as never,
    role: "owner" as never,
    groupId: null,
    organizationId: 1,
    roles: ["owner"] as Session["roles"],
    hasRole: (x) => x === "owner",
  }) as Session;

let writer: pg.Client | null = null;
let ownerId = 0;
let product = 0;

beforeAll(async () => {
  const { getDb, DB_PATH } = await import("@/lib/db");
  const { testDatabaseUrl } = await import("@/lib/database/pg");
  const db = getDb();
  const now = new Date().toISOString();
  ownerId = Number(
    (await db
      .prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('xo','x','م','owner',1,?,1)")
      .run(now)).lastInsertRowid
  );
  const { createProduct } = await import("@/lib/catalogue");
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  /* A second connection to this file's own database: the writer whose transaction is open
     across the pull. */
  const url = testDatabaseUrl(process.env.DATABASE_URL!, process.env.ROUTEFLOW_PG_TEMPLATE!, DB_PATH).url;
  writer = new pg.Client({ connectionString: url });
  await writer.connect();
});

afterAll(async () => {
  await writer?.end();
});

describe("the PostgreSQL sync watermark", () => {
  it("is a transaction id", async () => {
    const { pullSince } = await import("@/lib/repo/syncPull");
    expect((await pullSince(owner(ownerId), null)).watermark).toMatch(/^x:\d+$/);
  });

  it("sends a row whose writer committed after the pull moved the watermark on", async () => {
    const { pullSince } = await import("@/lib/repo/syncPull");
    await writer!.query("BEGIN");
    await writer!.query("UPDATE products SET name = 'کره ممتاز', updated_at = $1 WHERE id = $2", [new Date().toISOString(), product]);
    const first = await pullSince(owner(ownerId), null);
    await writer!.query("COMMIT");

    const second = await pullSince(owner(ownerId), first.watermark);
    const sent = second.rows.filter((r) => r.table === "products" && r.row.id === product);
    expect(sent.map((r) => r.row.name)).toEqual(["کره ممتاز"]);
  });

  it("sends a delete whose writer committed after the pull", async () => {
    const { pullSince } = await import("@/lib/repo/syncPull");
    const first0 = await pullSince(owner(ownerId), null);
    await writer!.query("BEGIN");
    await writer!.query(
      "INSERT INTO deleted_rows (organization_id, entity_type, entity_id, deleted_at) VALUES (1, 'order_line', 4243, $1)",
      ["2020-01-01T00:00:00.000Z"] // an old stamp: a timestamp watermark would hide it for good
    );
    const first = await pullSince(owner(ownerId), first0.watermark);
    await writer!.query("COMMIT");

    const second = await pullSince(owner(ownerId), first.watermark);
    expect(second.tombstones.map((t) => t.entity_id)).toContain(4243);
  });

  it("does not send the row's bookkeeping column", async () => {
    const { pullSince } = await import("@/lib/repo/syncPull");
    const all = await pullSince(owner(ownerId), null);
    expect(all.rows.some((r) => "sync_xid" in r.row)).toBe(false);
  });

  it("starts again from the beginning for a timestamp watermark from before the switch", async () => {
    const { pullSince } = await import("@/lib/repo/syncPull");
    const r = await pullSince(owner(ownerId), "2030-01-01T00:00:00.000Z");
    expect(r.rows.some((x) => x.table === "products" && x.row.id === product)).toBe(true);
  });
});
