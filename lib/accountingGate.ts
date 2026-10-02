import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { isVanRole, OWNER_ROLES } from "@/lib/roles";
import type { Role } from "@/lib/roles";

/**
 * The accounting pages' own gate.
 *
 * proxy.ts refuses the bundle and the tab, but its header says outright that it is "NOT an
 * authorisation decision" — it cannot reach SQLite, so it cannot know a user was demoted
 * since the cookie was issued. This is the authoritative check, and every accounting page
 * calls it rather than repeating the role comparison, because eight copies of an
 * authorisation rule is eight chances to write one of them slightly differently.
 *
 * READ is open to a group_manager: they can enter expenses, so hiding the journal and the
 * expense report from them would be hiding their own work. The trial balance, balance
 * sheet, income statement, payables and suppliers are owner-only — those are the whole
 * organisation's money. `OWNER_ROLES`, never a literal: platform_owner is a strict
 * superset of owner (lib/roles.ts:68) and a hand-written list locks them out.
 */

/** Accounts a group_manager may read, because they are the ones who post to them. */
const MANAGER_READABLE = new Set(["/accounting/journal", "/accounting/expenses"]);

export async function requireAccounting(route: string): Promise<number> {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  // A van role has no organisation-wide books to read; send them to their own day, same
  // as every other page that aggregates rather than lists.
  if (isVanRole(session.role)) redirect("/driver");
  if (!canReadAccounting(session.role, route)) redirect("/sales");
  return session.organizationId;
}

/** Exported separately so the rule is testable without a cookie jar. */
export function canReadAccounting(role: Role, route: string): boolean {
  if (OWNER_ROLES.includes(role)) return true;
  return role === "group_manager" && MANAGER_READABLE.has(route);
}