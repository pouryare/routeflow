import { getDb, plain } from "@/lib/db";
import { canReachUser, scopeGroupIds, type Session } from "@/lib/session";
import { bucket } from "@/lib/tasks/lenses";
import {
  rowToCard,
  TASK_CARD_SELECT,
  TASK_CARD_JOINS,
  type TaskCard,
  type TaskCardRow,
} from "./taskCard";
import { isVanRole } from "../roles";

export interface PocketTile {
  key: "reminders_today" | "tasks_today" | "orders_open" | "visits_week";
  label: string;
  n: number;
  hint: string;
}

export interface Pocket {
  scopeUserId: number;
  scopeName: string;
  tiles: PocketTile[];
  today: TaskCard[];
  week: TaskCard[];
  done: TaskCard[];
}

const PRIO_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** The personal task view. A member sees their own; a manager may pass `scopeUserId` to
 *  see a report's (only if `canReachUser`). */
export function pocketFor(
  session: Session,
  opts: { scopeUserId?: number; nowIso?: string } = {}
): Pocket {
  const db = getDb();
  const org = session.organizationId;
  const now = opts.nowIso ?? new Date().toISOString();

  const target =
    opts.scopeUserId && canReachUser(session, opts.scopeUserId)
      ? opts.scopeUserId
      : session.user.id;
  const u = db
    .prepare("SELECT display_name, role, group_id FROM users WHERE id = ?")
    .get(target) as { display_name: string; role: string; group_id: number | null } | undefined;

  /* A task is offered when its hint names a role this person HOLDS. Until the role SET lands
     (Task 2) the set is the primary column plus both van roles, which is the widest set a
     person can hold without inventing one. Matching one role fails silently -- no error,
     just a shorter list. The old names stay accepted for pre-migration rows. */
  const held: string[] = [u?.role ?? "phone_sales", "field_rep", "delivery_driver", "driver", "salesperson", "phone_sales"];
  const placeholders = held.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT ${TASK_CARD_SELECT}
         FROM tasks t ${TASK_CARD_JOINS}
        WHERE t.organization_id = ?
          AND t.status != 'dismissed'
          AND ( t.assignee_user_id = ?
                OR ( t.assignee_user_id IS NULL
                     AND t.role_hint IN (${placeholders})
                     AND (t.group_id = ? OR t.group_id IS NULL) ) )`
    )
    .all(org, target, ...held, u?.group_id ?? -1) as unknown as TaskCardRow[];

  const cards = rows
    .map(rowToCard)
    .sort(
      (a, b) =>
        (PRIO_RANK[a.priority] ?? 2) - (PRIO_RANK[b.priority] ?? 2) ||
        (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999")
    );

  const done = cards.filter((c) => c.status === "done");
  const active = cards.filter((c) => c.status !== "done");
  const today = active.filter((c) => bucket(c.due_at, now) === "today");
  const week = active.filter((c) => bucket(c.due_at, now) !== "today");

  const ymd = now.slice(0, 10);
  const count = (p: (c: TaskCard) => boolean) => active.filter(p).length;
  const hint = (n: number, word: string) => (n > 0 ? `${n} ${word}` : "—");

  const remToday = today.filter((c) => c.kind === "reminder");
  const critToday = today.filter((c) => c.priority === "CRITICAL");
  const tiles: PocketTile[] = [
    {
      key: "reminders_today",
      label: "یادآوری‌های امروز",
      n: remToday.length,
      hint: hint(remToday.filter((c) => (c.due_at ?? ymd) < ymd).length, "سررسیدشده"),
    },
    {
      key: "tasks_today",
      label: "کارهای امروز",
      n: today.length,
      hint: hint(critToday.length, "بحرانی"),
    },
    {
      key: "orders_open",
      label: "سفارش‌های باز",
      n: count((c) => c.kind === "order"),
      hint: hint(count((c) => c.kind === "order" && (c.stage === "pending" || !c.stage)), "در انتظار"),
    },
    {
      key: "visits_week",
      label: "بازدیدهای این هفته",
      n: count((c) => c.kind === "visit" && bucket(c.due_at, now) !== "backlog"),
      hint: hint(count((c) => c.kind === "visit" && (c.stage === "plan" || !c.stage)), "برنامه‌ریزی‌شده"),
    },
  ];

  return { scopeUserId: target, scopeName: u?.display_name ?? "", tiles, today, week, done };
}

export interface PocketTeamMember {
  id: number;
  name: string;
  role: string;
  open: number;
}

/** The people a manager can scope the Pocket to — their reports, each with an open-task
 *  count. Empty for a plain member. */
export function pocketTeam(session: Session): PocketTeamMember[] {
  if (session.role === "phone_sales" || isVanRole(session.role)) return [];
  const db = getDb();
  const roles = ["phone_sales", "salesperson", "field_rep", "delivery_driver", "driver", "rep_manager"];
  const roleIn = roles.map(() => "?").join(", ");

  let where = "u.organization_id = ? AND u.role IN (" + roleIn + ") AND u.active = 1";
  const params: unknown[] = [session.organizationId, ...roles];

  if (session.role === "group_manager" || session.role === "rep_manager") {
    const scope = scopeGroupIds(session);
    const ids = scope === "all" ? [] : scope;
    if (ids.length === 0) return [];
    where += ` AND u.group_id IN (${ids.map(() => "?").join(", ")})`;
    params.push(...ids);
  }

  // plain(): node:sqlite rows have a null prototype, which Next.js refuses to pass from
  // a Server Component to a Client Component. pocketFor's rows go through rowToCard
  // (fresh literals); this query does not, so it needs the copy.
  return plain(
    db
      .prepare(
        `SELECT u.id, u.display_name AS name, u.role,
                (SELECT COUNT(*) FROM tasks t
                   WHERE t.assignee_user_id = u.id AND t.status = 'open') AS open
           FROM users u
          WHERE ${where}
          ORDER BY open DESC, u.display_name`
      )
      .all(...(params as never[])) as unknown as PocketTeamMember[]
  );
}
