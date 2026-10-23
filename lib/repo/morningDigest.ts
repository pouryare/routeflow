import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import type { UserRow } from "@/lib/db";
import { todayFor } from "@/lib/repo/briefing";
import { weekVsLast } from "@/lib/repo/weekCompare";
import { changePercent } from "@/lib/weekCompare";
import { DIGEST_FROM, DIGEST_TITLE, digestBody } from "@/lib/morningDigest";
import { jalaliYmd, tehranTodayIso } from "@/lib/jalali";
import { faNum } from "@/lib/format";
import { OWNER_ROLES } from "@/lib/roles";

const TEHRAN = "Asia/Tehran";
const TYPE = "owner.digest";

/** The owner's own session, as the briefing would see it when they sign in. */
function ownerSession(user: UserRow): Session {
  return { user, role: "owner", roles: ["owner"], groupId: null, organizationId: user.organization_id as number, hasRole: (r) => r === "owner" };
}

function weekLine(session: Session, asOf: Date): string | null {
  const w = weekVsLast(session, tehranTodayIso(asOf));
  if (!w) return null;
  const pct = changePercent(w.now.orders, w.before.orders);
  const change = pct === null ? "" : ` (${pct >= 0 ? "+" : "−"}${faNum(Math.abs(pct))}٪ نسبت به همین روزهای هفتهٔ قبل)`;
  return `این هفته تا امروز: ${faNum(w.now.orders)} سفارش تأییدشده${change}`;
}

/** F16: queue today's digest for each active owner of the organisation, once per Tehran day
 *  and not before DIGEST_FROM. The sweep's flush then delivers it on the owner's loud channels,
 *  under their own quiet hours and their on/off choice for this type in notification settings.
 *  Returns how many were queued. */
export function queueMorningDigests(organizationId: number, asOfIso: string = new Date().toISOString()): number {
  const asOf = new Date(asOfIso);
  const hhmm = asOf.toLocaleTimeString("en-GB", { hour12: false, timeZone: TEHRAN }).slice(0, 5);
  if (hhmm < DIGEST_FROM) return 0;
  const db = getDb();
  const groupKey = `${TYPE}:${jalaliYmd(asOfIso)}`;
  const owners = db
    .prepare(
      `SELECT * FROM users WHERE organization_id = ? AND active = 1 AND role IN (${OWNER_ROLES.map(() => "?").join(", ")})
          AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = users.id AND n.group_key = ?)`
    )
    .all(organizationId, ...OWNER_ROLES, groupKey) as unknown as UserRow[];
  const insert = db.prepare(
    `INSERT INTO notifications (organization_id, user_id, type_code, title_fa, body_fa, group_key, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'NORMAL', ?)`
  );
  for (const user of owners) {
    const session = ownerSession({ ...user, organization_id: organizationId });
    const body = digestBody(todayFor(session).panels, weekLine(session, asOf));
    insert.run(organizationId, user.id, TYPE, DIGEST_TITLE, body, groupKey, asOfIso);
  }
  return owners.length;
}
