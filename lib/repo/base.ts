import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";

/** A thin, tenant-scoped table helper. The only sanctioned place for new raw SQL.
 *
 *  Every tenant repo takes `organizationId` as its first argument and applies
 *  `WHERE organization_id = ?` on every read and stamps it on every insert. A forgotten
 *  scope is a compile error at the call site, not a silent cross-tenant leak.
 *
 *  Complex reads stay hand-written SQL *inside a repo module* via `db()`, never in a
 *  route. The eventual Postgres migration swaps the driver here and nothing else. */
export interface Repo<Row extends { id: number }> {
  get(organizationId: number, id: number): Promise<Row | undefined>;
  list(organizationId: number, where?: Partial<Row>): Promise<Row[]>;
  insert(organizationId: number, row: Omit<Row, "id">): Promise<number>;
  patch(organizationId: number, id: number, fields: Partial<Row>): Promise<void>;
  db(): Db;
}

export function makeRepo<Row extends { id: number }>(
  table: string,
  opts: { tenant: boolean }
): Repo<Row> {
  const tenantClause = opts.tenant ? " AND organization_id = ?" : "";
  const tenantArgs = (organizationId: number): number[] => (opts.tenant ? [organizationId] : []);

  return {
    db: () => getDb(),

    async get(organizationId, id) {
      return await getDb()
        .prepare(`SELECT * FROM ${table} WHERE id = ?${tenantClause}`)
        .get(id, ...tenantArgs(organizationId)) as Row | undefined;
    },

    async list(organizationId, where = {}) {
      const keys = Object.keys(where);
      const conds = keys.map((k) => `${k} = ?`).join(" AND ");
      const sql =
        `SELECT * FROM ${table} WHERE 1 = 1` + (conds ? ` AND ${conds}` : "") + tenantClause;
      return await getDb()
        .prepare(sql)
        .all(
          ...keys.map((k) => (where as Record<string, unknown>)[k] as never),
          ...tenantArgs(organizationId)
        ) as Row[];
    },

    async insert(organizationId, row) {
      const data: Record<string, unknown> = { ...row };
      if (opts.tenant) data.organization_id = organizationId;
      const cols = Object.keys(data);
      const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
      return Number(
        (await getDb()
          .prepare(sql)
          .run(...cols.map((c) => data[c] as never))).lastInsertRowid
      );
    },

    async patch(organizationId, id, fields) {
      const cols = Object.keys(fields);
      if (cols.length === 0) return;
      const sql =
        `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} ` +
        `WHERE id = ?${tenantClause}`;
      await getDb()
        .prepare(sql)
        .run(
          ...cols.map((c) => (fields as Record<string, unknown>)[c] as never),
          id,
          ...tenantArgs(organizationId)
        );
    },
  };
}
