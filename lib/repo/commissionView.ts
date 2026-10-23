import { getDb } from "@/lib/db";
import { orgScopeId, type Session } from "@/lib/session";
import { orgClause } from "@/lib/orgScope";
import { isOwner, VAN_ROLES } from "@/lib/roles";
import { allStatements, statementFor, readRates, type Statement } from "@/lib/commissionLedger";
import { allDriverStatements, readDriverRates, type DriverStatement } from "@/lib/driverCommissionLedger";
import {
  allManagerStatements,
  managerStatementFor,
  readManagerOverrides,
  type ManagerStatement,
} from "@/lib/managerCommissionLedger";

/* Everything the commission page, the commission API and the dashboard's money section read, as
 * functions of the SESSION. One definition of "whose statements may this caller see" instead of
 * three hand-copied ones. */

export interface Period {
  from: string;
  to: string;
}

export interface CommissionStatements {
  statements: Statement[];
  driverStatements: DriverStatement[];
  managerStatements: ManagerStatement[];
}

/** The three ledgers for a period, as far as the caller may see them: a فروشنده gets only their own
 *  statement and none of the driver or manager ledgers (the reads are skipped, not just hidden);
 *  a group manager gets their group's people plus their own override; an owner gets everyone in
 *  their organisation (a platform_owner, every organisation). */
export async function commissionStatementsFor(session: Session, period: Period): Promise<CommissionStatements> {
  const db = getDb();
  const groupId = isOwner(session.role) ? undefined : session.groupId;
  const organizationId = orgScopeId(session);
  if (session.role === "phone_sales") {
    return { statements: [await statementFor(db, session.user.id, period)], driverStatements: [], managerStatements: [] };
  }
  return {
    statements: await allStatements(db, period, { groupId, organizationId }),
    driverStatements: await allDriverStatements(db, period, { groupId, organizationId }),
    managerStatements: isOwner(session.role)
      ? await allManagerStatements(db, period, organizationId)
      : session.role === "group_manager"
        ? [await managerStatementFor(db, session.user.id, period)]
        : [],
  };
}

export interface CommissionPeople {
  sellers: { id: number; display_name: string }[];
  drivers: { id: number; display_name: string }[];
  managers: { id: number; display_name: string }[];
}

/** The people an owner can set commission for: active sellers, van-role staff and group managers
 *  of THEIR organisation. Empty for anyone else. These lists used to be unscoped and offered every
 *  company's staff in the pickers. */
export async function commissionPeopleFor(session: Session): Promise<CommissionPeople> {
  if (!isOwner(session.role)) return { sellers: [], drivers: [], managers: [] };
  const db = getDb();
  const org = orgClause("organization_id", orgScopeId(session));
  const named = async (where: string, params: (string | number)[] = []) =>
    (await db
      .prepare(`SELECT id, display_name FROM users WHERE ${where} AND active = 1${org.sql} ORDER BY display_name`)
      .all(...params, ...org.params))
      .map((r) => ({ ...r })) as { id: number; display_name: string }[];
  return {
    sellers: await named("role = 'phone_sales'"),
    // The van roles, from the one list that defines them (see tests/van-role-dropdown.test.ts).
    drivers: await named(`role IN (${VAN_ROLES.map(() => "?").join(", ")})`, [...VAN_ROLES]),
    managers: await named("role = 'group_manager'"),
  };
}

export interface CommissionRates {
  rates: Awaited<ReturnType<typeof readRates>>;
  driverRates: Awaited<ReturnType<typeof readDriverRates>>;
  managerOverrides: Awaited<ReturnType<typeof readManagerOverrides>>;
}

/** The payroll policy tables (rates and overrides): owner only, newest first; `limit` keeps only
 *  that many of each (the page shows twelve, the API returns them all). */
export async function commissionRatesFor(session: Session, opts: { limit?: number } = {}): Promise<CommissionRates> {
  if (!isOwner(session.role)) return { rates: [], driverRates: [], managerOverrides: [] };
  const db = getDb();
  const org = session.organizationId;
  const cut = <T,>(rows: T[]): T[] => (opts.limit === undefined ? rows : rows.slice(0, opts.limit));
  return {
    rates: cut(await readRates(db, org)),
    driverRates: cut(await readDriverRates(db, org)),
    managerOverrides: cut(await readManagerOverrides(db, org)),
  };
}
