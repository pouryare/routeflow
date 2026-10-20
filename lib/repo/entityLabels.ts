import type { DatabaseSync } from "node:sqlite";

/** Rows that point at a customer or a district: reminders, photos. */
export interface EntityRef {
  entity_type: string;
  entity_id: number;
}

const GONE: Record<"customer" | "district", string> = {
  customer: "مشتری حذف‌شده",
  district: "منطقه حذف‌شده",
};

function namesById(db: DatabaseSync, table: "customers" | "districts", column: string, ids: number[]) {
  const names = new Map<number, string>();
  if (ids.length === 0) return names;
  const placeholders = ids.map(() => "?").join(",");
  const found = db
    .prepare(`SELECT id, ${column} AS name FROM ${table} WHERE id IN (${placeholders})`)
    .all(...ids) as unknown as { id: number; name: string }[];
  for (const r of found) names.set(r.id, r.name);
  return names;
}

/** Each row with a display `label`: the customer's business name or the district's name, or
 *  a "deleted" placeholder when the row it points at is gone. Two queries however many rows
 *  there are, rather than one per row. */
export function withEntityLabels<R extends EntityRef>(db: DatabaseSync, rows: R[]): (R & { label: string })[] {
  const idsOf = (type: string) => [...new Set(rows.filter((r) => r.entity_type === type).map((r) => r.entity_id))];
  const customers = namesById(db, "customers", "business_name", idsOf("customer"));
  const districts = namesById(db, "districts", "name", idsOf("district"));
  return rows.map((r) => ({
    ...r,
    label:
      r.entity_type === "customer"
        ? customers.get(r.entity_id) ?? GONE.customer
        : districts.get(r.entity_id) ?? GONE.district,
  }));
}
