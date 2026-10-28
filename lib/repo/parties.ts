/** The people the books name (a ledger line's party_id). A member of staff gets one on first use;
 *  shareholders are added in lib/repo/shareholders.ts. One staff party per user per company. */
import type { Db } from "@/lib/database/client";

export async function ensureStaffParty(db: Db, organizationId: number, userId: number): Promise<number> {
  const find = () =>
    db
      .prepare("SELECT id FROM parties WHERE organization_id = ? AND kind = 'staff' AND user_id = ?")
      .get(organizationId, userId) as Promise<{ id: number } | undefined>;
  const existing = await find();
  if (existing) return existing.id;

  const person = await db.prepare("SELECT display_name FROM users WHERE id = ?").get(userId) as
    | { display_name: string }
    | undefined;
  await db
    .prepare(
      `INSERT INTO parties (organization_id, kind, user_id, name_fa, created_at)
       VALUES (?, 'staff', ?, ?, ?) ON CONFLICT DO NOTHING`
    )
    .run(organizationId, userId, person?.display_name ?? "—", new Date().toISOString());
  return (await find())!.id;
}
