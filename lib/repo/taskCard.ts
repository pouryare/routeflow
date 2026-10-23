import { canSnooze } from "@/lib/taskSnooze";

/** The shape both the Pocket and the Board hand to the client for a single task, plus
 *  the mapper from a joined SQL row. One definition so the two surfaces never drift.
 *
 *  The SELECT that feeds `rowToCard` must alias:
 *    c.business_name AS customer_name   (LEFT JOIN customers on entity_type='customer')
 *    au.display_name AS assignee_name   (LEFT JOIN users au on au.id = assignee_user_id)
 *    ... EXISTS(...) AS recur           (1/0 — has a matching task_recurrences template)
 */
export interface TaskCard {
  id: number;
  kind: string;
  title: string;
  status: string;
  stage: string | null;
  started_at: string | null;
  due_at: string | null;
  priority: string;
  customer: { id: number; name: string } | null;
  assignee: { id: number; name: string } | null;
  recur: boolean;
  /** F142: whether «later» is offered (open, normal or low priority, under the snooze cap). */
  snoozable: boolean;
}

export interface TaskCardRow {
  id: number;
  kind: string;
  title: string;
  status: string;
  stage: string | null;
  started_at: string | null;
  due_at: string | null;
  priority: string;
  entity_type: string | null;
  entity_id: number | null;
  customer_name: string | null;
  assignee_user_id: number | null;
  assignee_name: string | null;
  recur: number | null;
  snooze_count: number;
}

/** The SELECT column list + joins that produce a `TaskCardRow`. `t` is the tasks alias. */
export const TASK_CARD_SELECT = `
  t.id, t.kind, t.title, t.status, t.stage, t.started_at, t.due_at, t.priority,
  t.entity_type, t.entity_id, t.assignee_user_id, t.snooze_count,
  c.business_name AS customer_name,
  au.display_name AS assignee_name,
  EXISTS (
    SELECT 1 FROM task_recurrences tr
     WHERE tr.organization_id = t.organization_id AND tr.title = t.title
  ) AS recur`;

export const TASK_CARD_JOINS = `
  LEFT JOIN customers c ON t.entity_type = 'customer' AND c.id = t.entity_id
  LEFT JOIN users au ON au.id = t.assignee_user_id`;

export function rowToCard(r: TaskCardRow): TaskCard {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    status: r.status,
    stage: r.stage,
    started_at: r.started_at,
    due_at: r.due_at,
    priority: r.priority,
    customer:
      r.entity_type === "customer" && r.entity_id
        ? { id: r.entity_id, name: r.customer_name ?? `#${r.entity_id}` }
        : null,
    assignee: r.assignee_user_id
      ? { id: r.assignee_user_id, name: r.assignee_name ?? `#${r.assignee_user_id}` }
      : null,
    recur: Boolean(r.recur),
    snoozable: canSnooze(r),
  };
}

const PRIO_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** Sort order for both surfaces: most urgent priority first, then soonest due, undated last. */
export function compareTaskCards(a: Pick<TaskCard, "priority" | "due_at">, b: Pick<TaskCard, "priority" | "due_at">): number {
  return (
    (PRIO_RANK[a.priority] ?? 2) - (PRIO_RANK[b.priority] ?? 2) ||
    (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999")
  );
}
