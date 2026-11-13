import { getDb } from "@/lib/db";
import { auditLines, auditRefs, type AuditNames } from "@/lib/auditLabels";

export interface AuditRow {
  id: number;
  table_name: string;
  row_id: number;
  op: string;
  changes_json: string;
  actor_name: string | null;
  impersonator_name: string | null;
  created_at: string;
  /** One readable line per changed column, with names where the change holds ids (T6). */
  lines: string[];
  /** The name of the changed record when it is a customer, user or group; otherwise null (the card shows its number). */
  record: string | null;
}

/** The newest changes of one company, newest first; narrowed to one record when `table` and `rowId` are
 *  given. The audit record is read by the owner only (the pages that call this gate on that). */
export async function auditHistory(
  organizationId: number,
  filter: { table?: string; rowId?: number; limit?: number } = {}
): Promise<AuditRow[]> {
  const where = ["a.organization_id = ?"];
  const params: (string | number)[] = [organizationId];
  if (filter.table) {
    where.push("a.table_name = ?");
    params.push(filter.table);
    if (filter.rowId) {
      where.push("a.row_id = ?");
      params.push(filter.rowId);
    }
  }
  params.push(Math.min(filter.limit ?? 100, 500));
  const rows = (await getDb()
    .prepare(
      `SELECT a.id, a.table_name, a.row_id, a.op, a.changes_json, a.created_at,
              u.display_name AS actor_name, i.display_name AS impersonator_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
         LEFT JOIN users i ON i.id = a.impersonated_by
        WHERE ${where.join(" AND ")}
        ORDER BY a.id DESC LIMIT ?`
    )
    .all(...params)) as unknown as Omit<AuditRow, "lines" | "record">[];
  const names = await namesFor(organizationId, rows);
  return rows.map((r) => ({ ...r, lines: auditLines(r.changes_json, names), record: names[RECORD_KIND[r.table_name]]?.get(Number(r.row_id)) ?? null }));
}

const NAME_SQL = {
  user: "SELECT id, display_name AS name FROM users WHERE organization_id = ? AND id IN",
  group: "SELECT id, name FROM groups WHERE organization_id = ? AND id IN",
  customer: "SELECT id, business_name AS name FROM customers WHERE organization_id = ? AND id IN",
  product: "SELECT id, name FROM products WHERE organization_id = ? AND id IN",
  packaging: "SELECT k.id, p.name || ' / ' || k.name AS name FROM packagings k JOIN products p ON p.id = k.product_id WHERE p.organization_id = ? AND k.id IN",
} as const;

/** The names of every record the given changes point at: one query per kind, all of this company's. */
const RECORD_KIND: Record<string, keyof typeof NAME_SQL> = { customers: "customer", users: "user", groups: "group" };

async function namesFor(organizationId: number, rows: { table_name: string; row_id: number; changes_json: string }[]): Promise<AuditNames> {
  const wanted = new Map<keyof typeof NAME_SQL, Set<number>>();
  const want = (kind: keyof typeof NAME_SQL, id: number) => wanted.set(kind, (wanted.get(kind) ?? new Set()).add(id));
  for (const r of rows) {
    for (const { kind, id } of auditRefs(r.changes_json)) want(kind, id);
    const own = RECORD_KIND[r.table_name];
    if (own) want(own, Number(r.row_id));
  }
  const names: AuditNames = {};
  for (const [kind, ids] of wanted) {
    const list = [...ids];
    const found = (await getDb().prepare(`${NAME_SQL[kind]} (${list.map(() => "?").join(",")})`).all(organizationId, ...list)) as unknown as { id: number; name: string }[];
    names[kind] = new Map(found.map((f) => [Number(f.id), f.name]));
  }
  return names;
}
