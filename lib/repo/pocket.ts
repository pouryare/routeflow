import { getDb } from "@/lib/db";
import { canReachUser, type Session } from "@/lib/session";
import { bucket } from "@/lib/tasks/lenses";
import {
  rowToCard,
  TASK_CARD_SELECT,
  TASK_CARD_JOINS,
  type TaskCard,
  type TaskCardRow,
} from "./taskCard";

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

  const rows = db
    .prepare(
      `SELECT ${TASK_CARD_SELECT}
         FROM tasks t ${TASK_CARD_JOINS}
        WHERE t.organization_id = ?
          AND t.status != 'dismissed'
          AND ( t.assignee_user_id = ?
                OR ( t.assignee_user_id IS NULL AND t.role_hint = ?
                     AND (t.group_id = ? OR t.group_id IS NULL) ) )`
    )
    .all(org, target, u?.role ?? "salesperson", u?.group_id ?? -1) as unknown as TaskCardRow[];

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
