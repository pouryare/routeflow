import { getDb } from "@/lib/db";
import type { Db } from "@/lib/database/client";

export interface SupplierRow {
  id: number;
  organization_id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  active: number;
  created_by: number | null;
  created_at: string;
}

/** Create a supplier, or return the existing row for that exact name in that tenant.
 *
 *  Names are NOT trimmed here. The unique index is on the raw name precisely so that
 *  "  ACME  " and "ACME" stay two rows rather than silently becoming one payable balance
 *  that belongs to neither vendor. The legacy purchases.supplier TEXT column is kept for
 *  the same reason: it is the only record of what was originally typed.
 *
 *  An empty name is refused rather than stored: a supplier row with a blank label is
 *  unreportable, and every downstream surface would show an empty entry. */
export async function createSupplier(
  organizationId: number,
  input: { name: string; phone?: string | null; notes?: string | null; createdBy?: number | null }
): Promise<number> {
  /* Trim only to decide whether the name is EMPTY. The stored name keeps its original
     spacing, and the lookup uses the raw string, so "  ACME  " and "ACME" stay two
     suppliers -- which is what the unique index is on, and what the test asserts. Storing
     the trimmed form instead would collapse two vendors into one payable balance that
     belongs to neither, and the legacy purchases.supplier TEXT column would be the only
     remaining evidence that they had been separate. */
  if (input.name.trim() === "") throw new Error("نام تأمین‌کننده نمی‌تواند خالی باشد");

  const existing = await getDb()
    .prepare("SELECT id FROM suppliers WHERE organization_id = ? AND name = ?")
    .get(organizationId, input.name) as { id: number } | undefined;
  if (existing) return existing.id;

  return Number(
    (await getDb()
      .prepare(
        `INSERT INTO suppliers (organization_id, name, phone, notes, active, created_by, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        organizationId,
        input.name,
        input.phone?.trim() || null,
        input.notes?.trim() || null,
        input.createdBy ?? null,
        new Date().toISOString()
      )).lastInsertRowid
  );
}

/** Every supplier for a tenant. Tenant-scoped on EVERY read: a forgotten scope here is a
 *  cross-tenant leak, which is exactly what the `commission_rates` comment calls waiting
 *  for the first query. */
export async function listSuppliers(organizationId: number, opts?: { includeInactive?: boolean }): Promise<SupplierRow[]> {
  return await getDb()
    .prepare(
      `SELECT * FROM suppliers
        WHERE organization_id = ? ${opts?.includeInactive ? "" : "AND active = 1"}
        ORDER BY name`
    )
    // `as unknown as` is the house idiom for a row cast off node:sqlite's
    // Record<string, SQLOutputValue> -- see paymentsRepo.list. A direct `as SupplierRow[]`
    // is TS2352: the two types do not sufficiently overlap.
    .all(organizationId) as unknown as SupplierRow[];
}

export async function getSupplier(
  db: Db,
  organizationId: number,
  id: number
): Promise<SupplierRow | undefined> {
  return await db
    .prepare("SELECT * FROM suppliers WHERE id = ? AND organization_id = ?")
    .get(id, organizationId) as SupplierRow | undefined;
}

/** What a supplier is OWED: the payables balance from the ledger, not a stored number.
 *  Derived so it can never disagree with the trial balance. */
export async function supplierBalanceToman(organizationId: number, supplierId: number): Promise<number> {
  const row = await getDb()
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN e.side = 'C' THEN e.amount_toman ELSE 0 END)
                    - SUM(CASE WHEN e.side = 'D' THEN e.amount_toman ELSE 0 END), 0) AS n
         FROM ledger_entries e
        WHERE e.organization_id = ? AND e.supplier_id = ?`
    )
    .get(organizationId, supplierId) as { n: number };
  return row.n;
}

/** One supplier of this company, or undefined (the statement page). */
export async function supplierOf(organizationId: number, id: number): Promise<SupplierRow | undefined> {
  return await getSupplier(getDb(), organizationId, id);
}
