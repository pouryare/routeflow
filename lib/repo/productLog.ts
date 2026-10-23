import type { DatabaseSync } from "node:sqlite";
import { getDb, logActivity } from "@/lib/db";
import type { Session } from "@/lib/session";

/** F99: the product catalogue's change log, kept in the shared activity log (entity `product`).
 *
 *  Prices and costs need no entry here: they are dated, insert-only rows with their author, so
 *  their history is already the data. What had no trace is the rest: a product added, a
 *  packaging added, a reorder line moved. */

export type ProductChange = "created" | "packaging" | "thresholds";

const NOTE: Record<ProductChange, string> = {
  created: "کالا تعریف شد",
  packaging: "بسته‌بندی تازه",
  thresholds: "آستانه‌های انبار تغییر کرد",
};

export function logProductChange(
  productId: number,
  change: ProductChange,
  values: { old?: string | null; new?: string | null },
  actor: { id: number; name: string; impersonatedBy?: number | null },
  db: DatabaseSync = getDb()
): void {
  logActivity(db, {
    entity_type: "product",
    entity_id: productId,
    event_type: change === "created" ? "created" : "updated",
    old_value: values.old ?? null,
    new_value: values.new ?? null,
    note: NOTE[change],
    changed_by: actor.name,
    changed_by_user_id: actor.id,
    impersonated_by: actor.impersonatedBy ?? null,
  });
}

export interface ProductChangeRow {
  id: number;
  product_id: number;
  product_name: string;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  changed_by: string | null;
  created_at: string;
}

/** The newest catalogue changes for this session's organisation. Shared (organisation-less)
 *  products are the platform's, not this company's, so their entries are left out. */
export function recentProductChanges(session: Session, limit = 30): ProductChangeRow[] {
  return getDb()
    .prepare(
      `SELECT a.id, a.entity_id AS product_id, p.name AS product_name, a.event_type, a.old_value,
              a.new_value, a.note, COALESCE(u.display_name, a.changed_by) AS changed_by, a.created_at
         FROM activity_log a
         JOIN products p ON p.id = a.entity_id
         LEFT JOIN users u ON u.id = a.changed_by_user_id
        WHERE a.entity_type = 'product' AND p.organization_id = ?
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?`
    )
    .all(session.organizationId, limit) as unknown as ProductChangeRow[];
}

/** "reorder 10 · target 40" for a threshold entry; a blank side reads «—». */
export function thresholdText(t: { reorder_point: number | null; target_stock: number | null }): string {
  const n = (v: number | null) => (v === null ? "—" : String(v));
  return `نقطهٔ سفارش ${n(t.reorder_point)} · موجودی هدف ${n(t.target_stock)}`;
}

export function productThresholds(productId: number): { reorder_point: number | null; target_stock: number | null } {
  return (getDb()
    .prepare("SELECT reorder_point, target_stock FROM products WHERE id = ?")
    .get(productId) as { reorder_point: number | null; target_stock: number | null } | undefined) ?? {
    reorder_point: null,
    target_stock: null,
  };
}
