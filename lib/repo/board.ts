import { getDb } from "@/lib/db";
import { scopeGroupIds, type Session } from "@/lib/session";
import { lanesFor, laneOf, type BoardView } from "@/lib/tasks/lenses";
import {
  rowToCard,
  TASK_CARD_SELECT,
  TASK_CARD_JOINS,
  type TaskCard,
  type TaskCardRow,
} from "./taskCard";

export interface BoardLane {
  id: string;
  label: string;
  cards: TaskCard[];
  total: number;
}

export interface Board {
  view: BoardView;
  kind?: string;
  lanes: BoardLane[];
  hiddenCount: number;
}

const PRIO_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** WHERE fragment (+ params) that narrows `tasks t` to what this session's Board shows.
 *  group_manager: their group's tasks, or tasks assigned to someone in it.
 *  rep_manager:   their own + tasks on customers they manage as reps.
 *  owner:         the whole org, optionally one group.
 *  Always tenant-bounded by organization_id. */
function boardScope(session: Session, groupId?: number): { sql: string; params: unknown[] } {
  const org = session.organizationId;

  if (session.role === "rep_manager") {
    return {
      sql: `t.organization_id = ?
            AND ( t.assignee_user_id = ?
                  OR ( t.entity_type = 'customer' AND t.entity_id IN (
                        SELECT customer_id FROM representative_profiles WHERE manager_user_id = ?
                     ) ) )`,
      params: [org, session.user.id, session.user.id],
    };
  }

  if (session.role === "owner" || session.role === "platform_owner") {
    if (groupId) return { sql: `t.organization_id = ? AND t.group_id = ?`, params: [org, groupId] };
    return { sql: `t.organization_id = ?`, params: [org] };
  }

  // group_manager
  const scope = scopeGroupIds(session);
  const ids = scope === "all" ? [] : scope;
  if (ids.length === 0) return { sql: `t.organization_id = ? AND t.assignee_user_id = ?`, params: [org, session.user.id] };
  const inList = ids.map(() => "?").join(", ");
  return {
    sql: `t.organization_id = ?
          AND ( t.group_id IN (${inList})
                OR t.assignee_user_id IN (
                     SELECT id FROM users WHERE organization_id = ? AND group_id IN (${inList})
                ) )`,
    params: [org, ...ids, org, ...ids],
  };
}

export function boardFor(
  session: Session,
  opts: { view: BoardView; kind?: string; groupId?: number; nowIso?: string }
): Board {
  const db = getDb();
  const now = opts.nowIso ?? new Date().toISOString();
  const { sql, params } = boardScope(session, opts.groupId);

  const rows = db
    .prepare(
      `SELECT ${TASK_CARD_SELECT}
         FROM tasks t ${TASK_CARD_JOINS}
        WHERE ${sql} AND t.status != 'dismissed'`
    )
    .all(...(params as never[])) as unknown as TaskCardRow[];

  let cards = rows.map(rowToCard);
  let hiddenCount = 0;

  if (opts.view === "workflow" && opts.kind) {
    hiddenCount = cards.filter((c) => c.kind !== opts.kind).length;
    cards = cards.filter((c) => c.kind === opts.kind);
  }

  cards.sort(
    (a, b) =>
      (PRIO_RANK[a.priority] ?? 2) - (PRIO_RANK[b.priority] ?? 2) ||
      (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999")
  );

  const lanes: BoardLane[] = lanesFor(opts.view, opts.kind).map((l) => {
    const inLane = cards.filter(
      (c) => laneOf({ ...c }, opts.view, now) === l.id
    );
    return { id: l.id, label: l.label, cards: inLane, total: inLane.length };
  });

  return { view: opts.view, kind: opts.kind, lanes, hiddenCount };
}
