import { getDb } from "@/lib/db";

export interface AuditRow {
  id: number;
  table_name: string;
  row_id: number;
  op: string;
  changes_json: string;
  actor_name: string | null;
  impersonator_name: string | null;
  created_at: string;
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
  return (await getDb()
    .prepare(
      `SELECT a.id, a.table_name, a.row_id, a.op, a.changes_json, a.created_at,
              u.display_name AS actor_name, i.display_name AS impersonator_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
         LEFT JOIN users i ON i.id = a.impersonated_by
        WHERE ${where.join(" AND ")}
        ORDER BY a.id DESC LIMIT ?`
    )
    .all(...params)) as unknown as AuditRow[];
}
