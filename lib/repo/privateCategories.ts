import { getDb } from "@/lib/db";
import { isOwner, type Role } from "@/lib/roles";

/** Z11: the private expense categories of a company, as account ids. */
export async function privateAccountIds(organizationId: number): Promise<number[]> {
  const rows = (await getDb().prepare("SELECT account_id FROM private_categories WHERE organization_id = ?").all(organizationId)) as unknown as { account_id: number }[];
  return rows.map((r) => Number(r.account_id));
}

/** What this viewer must not see the amount of: nothing for an owner, the private categories for anyone else. */
export async function hiddenAccountIdsFor(role: Role, organizationId: number): Promise<number[]> {
  return isOwner(role) ? [] : await privateAccountIds(organizationId);
}

export async function setCategoryPrivate(organizationId: number, accountId: number, on: boolean): Promise<boolean> {
  const db = getDb();
  if (!(await db.prepare("SELECT 1 FROM accounts WHERE id = ? AND type = 'EXPENSE' AND is_postable = 1").get(accountId))) return false;
  if (on) await db.prepare("INSERT INTO private_categories (organization_id, account_id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(organizationId, accountId);
  else await db.prepare("DELETE FROM private_categories WHERE organization_id = ? AND account_id = ?").run(organizationId, accountId);
  return true;
}
