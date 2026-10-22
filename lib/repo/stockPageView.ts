/** The few direct reads the advanced stock page makes besides the purchase and stock ledgers. */

import { getDb, plain } from "@/lib/db";
import { orgClause } from "@/lib/orgScope";

export function activeProducts(organizationId: number): { id: number; name: string; base_unit: string }[] {
  return plain(
    getDb()
      .prepare("SELECT id, name, base_unit FROM products WHERE active = 1 AND organization_id = ? ORDER BY name")
      .all(organizationId)
  ) as unknown as { id: number; name: string; base_unit: string }[];
}

/** The site's display name, or null when it is not this company's. */
export function facilityName(id: number, organizationId: number | null): string | null {
  const org = orgClause("organization_id", organizationId);
  const row = getDb().prepare(`SELECT name FROM facilities WHERE id = ?${org.sql}`).get(id, ...org.params) as { name: string } | undefined;
  return row?.name ?? null;
}
