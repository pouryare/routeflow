import { makeRepo } from "./base";
import { resolveRuleRunsFor } from "./rules";

export class TaskError extends Error {}

export interface TaskRow {
  id: number;
  organization_id: number;
  assignee_user_id: number | null;
  role_hint: string | null;
  group_id: number | null;
  kind: string;
  title: string;
  entity_type: string | null;
  entity_id: number | null;
  due_at: string | null;
  priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
  status: "open" | "done" | "dismissed";
  outcome_code: string | null;
  outcome_note: string | null;
  created_by: number | null;
  created_at: string;
  done_at: string | null;
}

export const tasksRepo = makeRepo<TaskRow>("tasks", { tenant: true });

export function createTask(
  organizationId: number,
  input: {
    title: string;
    kind: string;
    assignee_user_id?: number | null;
    role_hint?: string | null;
    group_id?: number | null;
    entity_type?: string | null;
    entity_id?: number | null;
    due_at?: string | null;
    priority?: TaskRow["priority"];
    created_by?: number | null;
  }
): number {
  if (!input.title?.trim()) throw new TaskError("عنوان لازم است");
  return tasksRepo.insert(organizationId, {
    organization_id: organizationId,
    assignee_user_id: input.assignee_user_id ?? null,
    role_hint: input.role_hint ?? null,
    group_id: input.group_id ?? null,
    kind: input.kind,
    title: input.title.trim(),
    entity_type: input.entity_type ?? null,
    entity_id: input.entity_id ?? null,
    due_at: input.due_at ?? null,
    priority: input.priority ?? "NORMAL",
    status: "open",
    outcome_code: null,
    outcome_note: null,
    created_by: input.created_by ?? null,
    created_at: new Date().toISOString(),
    done_at: null,
  } as Omit<TaskRow, "id">);
}

export function listTasks(
  organizationId: number,
  filter: { assignee?: number; role?: string; status?: string; limit?: number } = {}
): TaskRow[] {
  const clauses = ["organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (filter.assignee !== undefined) {
    clauses.push("assignee_user_id = ?");
    params.push(filter.assignee);
  }
  if (filter.role !== undefined) {
    clauses.push("role_hint = ?");
    params.push(filter.role);
  }
  clauses.push("status = ?");
  params.push(filter.status ?? "open");
  params.push(filter.limit ?? 100);
  return tasksRepo
    .db()
    .prepare(
      `SELECT * FROM tasks WHERE ${clauses.join(" AND ")}
        ORDER BY CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
                 COALESCE(due_at, created_at) LIMIT ?`
    )
    .all(...(params as never[])) as unknown as TaskRow[];
}

/** Complete a task with an optional outcome; resolves any rule_runs tied to the same
 *  entity so the rule can fire again later. */
export function completeTask(
  organizationId: number,
  id: number,
  outcome: { outcome_code?: string | null; outcome_note?: string | null } = {}
): void {
  const row = tasksRepo.get(organizationId, id);
  if (!row) throw new TaskError("کار پیدا نشد");
  tasksRepo.patch(organizationId, id, {
    status: "done",
    done_at: new Date().toISOString(),
    outcome_code: outcome.outcome_code ?? null,
    outcome_note: outcome.outcome_note ?? null,
  });
  if (row.entity_type && row.entity_id) {
    resolveRuleRunsFor(organizationId, row.entity_type, row.entity_id);
  }
}

export function dismissTask(organizationId: number, id: number): void {
  const row = tasksRepo.get(organizationId, id);
  if (!row) throw new TaskError("کار پیدا نشد");
  tasksRepo.patch(organizationId, id, { status: "dismissed", done_at: new Date().toISOString() });
  if (row.entity_type && row.entity_id) {
    resolveRuleRunsFor(organizationId, row.entity_type, row.entity_id);
  }
}
