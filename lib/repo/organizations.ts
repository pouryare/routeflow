/** The tenant registry. Almost everything is scoped *to* one organisation and never
 *  needs to enumerate them; the exceptions are cross-tenant operators — the sweep cron
 *  (lib/sweepAuth) and the platform_owner surface. */

import { getDb } from "@/lib/db";

/** Every organisation id, ascending. */
export function allOrgIds(): number[] {
  return (
    getDb().prepare("SELECT id FROM organizations ORDER BY id").all() as { id: number }[]
  ).map((r) => r.id);
}
