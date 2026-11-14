import { getDb } from "@/lib/db";
import { upliftRuleProblem } from "@/lib/smallUplift";

export interface UpliftRuleRow { packaging_id: number; product_name: string; packaging_name: string; small_packs: number; percent: number }

/** The packs of this company that carry a small-quantity rule, for the owner's list. */
export async function listUpliftRules(orgId: number): Promise<UpliftRuleRow[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT pk.id AS packaging_id, p.name AS product_name, pk.name AS packaging_name, pk.small_packs, pk.small_uplift_percent AS percent
         FROM packagings pk JOIN products p ON p.id = pk.product_id
        WHERE p.organization_id = ? AND pk.small_packs IS NOT NULL ORDER BY p.name, pk.name`
    )
    .all(orgId)) as unknown as UpliftRuleRow[];
  return rows.map((r) => ({ ...r, packaging_id: Number(r.packaging_id), small_packs: Number(r.small_packs), percent: Number(r.percent) }));
}

/** Sets (or, with both null, clears) a pack's rule. Returns the problem in words, or null once saved. */
export async function setUpliftRule(orgId: number, packagingId: number, smallPacks: number | null, percent: number | null): Promise<string | null> {
  const problem = upliftRuleProblem(smallPacks, percent);
  if (problem) return problem;
  const db = getDb();
  const own = await db.prepare("SELECT 1 FROM packagings pk JOIN products p ON p.id = pk.product_id WHERE pk.id = ? AND p.organization_id = ?").get(packagingId, orgId);
  if (!own) return "بسته‌بندی پیدا نشد";
  await db.prepare("UPDATE packagings SET small_packs = ?, small_uplift_percent = ? WHERE id = ?").run(smallPacks, percent, packagingId);
  return null;
}
