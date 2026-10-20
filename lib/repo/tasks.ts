import { makeRepo } from "./base";
import { resolveRuleRunsFor } from "./rules";
import { tryEmitEvent } from "./events";
import {
  movePatch,
  stageFromStatus,
  type BoardView,
  type TaskLensFields,
} from "@/lib/tasks/lenses";

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
  /** Per-kind Board workflow stage; NULL means "derive from status" (lib/tasks/lenses). */
  stage: string | null;
  /** Set when work has started but the task is not yet done — the Board's "in progress"
   *  marker. status stays 'open', so listTasks / the briefing are unaffected. */
  started_at: string | null;
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
    /** Explicit Board stage; when omitted it is derived from the kind at status 'open'. */
    stage?: string | null;
    priority?: TaskRow["priority"];
    created_by?: number | null;
  }
): number {
  if (!input.title?.trim()) throw new TaskError("عنوان لازم است");
  const id = tasksRepo.insert(organizationId, {
    organization_id: organizationId,
    assignee_user_id: input.assignee_user_id ?? null,
    role_hint: input.role_hint ?? null,
    group_id: input.group_id ?? null,
    kind: input.kind,
    title: input.title.trim(),
    entity_type: input.entity_type ?? null,
    entity_id: input.entity_id ?? null,
    due_at: input.due_at ?? null,
    stage: input.stage ?? stageFromStatus(input.kind, "open"),
    started_at: null,
    priority: input.priority ?? "NORMAL",
    status: "open",
    outcome_code: null,
    outcome_note: null,
    created_by: input.created_by ?? null,
    created_at: new Date().toISOString(),
    done_at: null,
  } as Omit<TaskRow, "id">);

  // Phase 1 notifications: a task handed to a person is a feed fact. Guarded on
  // assignee_user_id, so a role-only task emits nothing. No recursion: task.assigned
  // only matches notify_task_assigned (a `notify` rule, which creates no task), and the
  // rule-spawned tasks fire() writes go through a raw INSERT, never this function.
  if (input.assignee_user_id) {
    tryEmitEvent(organizationId, {
      kind: "task.assigned",
      entity_type: "task",
      entity_id: id,
      actor_user_id: input.created_by ?? null,
      metadata: {
        assignee_user_id: input.assignee_user_id,
        title: input.title.trim(),
        priority: input.priority ?? "NORMAL",
      },
    });
  }

  return id;
}

/** Move a task by Board lane. `movePatch` (lib/tasks/lenses) is the only place the
 *  lane→field mapping lives. A move that closes the task routes through `completeTask`
 *  so `done_at` stamps and any linked `rule_runs` resolve, then the derived stage is
 *  written on top. Returns the task's new lens fields, or null if it is not in this org. */
export function moveTask(
  organizationId: number,
  id: number,
  args: { view: BoardView; toLane: string; actor: number; nowIso: string; outcome_code?: string | null }
): {
  id: number;
  status: string;
  stage: string | null;
  started_at: string | null;
  due_at: string | null;
} | null {
  const row = tasksRepo.get(organizationId, id);
  if (!row) return null;

  const lensRow: TaskLensFields = {
    kind: row.kind,
    status: row.status,
    stage: row.stage,
    started_at: row.started_at,
    due_at: row.due_at,
  };
  const patch = movePatch(lensRow, args.view, args.toLane, args.nowIso);

  if (patch.status === "done" && row.status !== "done") {
    completeTask(organizationId, id, { outcome_code: args.outcome_code ?? null });
    const after: Partial<TaskRow> = {};
    if (patch.stage !== undefined) after.stage = patch.stage;
    if (patch.started_at !== undefined) after.started_at = patch.started_at;
    if (Object.keys(after).length) tasksRepo.patch(organizationId, id, after);
  } else {
    const fields: Partial<TaskRow> = {};
    if (patch.status !== undefined) fields.status = patch.status as TaskRow["status"];
    if (patch.started_at !== undefined) fields.started_at = patch.started_at;
    if (patch.due_at !== undefined) fields.due_at = patch.due_at;
    if (patch.stage !== undefined) fields.stage = patch.stage;
    if (Object.keys(fields).length) tasksRepo.patch(organizationId, id, fields);
  }

  const out = tasksRepo.get(organizationId, id)!;
  return {
    id: out.id,
    status: out.status,
    stage: out.stage,
    started_at: out.started_at,
    due_at: out.due_at,
  };
}

export function listTasks(
  organizationId: number,
  filter: { assignee?: number; role?: string; status?: string; limit?: number; groupIds?: number[] } = {}
): TaskRow[] {
  const clauses = ["organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (filter.assignee !== undefined) {
    clauses.push("assignee_user_id = ?");
    params.push(filter.assignee);
  }
  if (filter.groupIds !== undefined) {
    // An ungrouped row is company-wide; a grouped one is visible only inside its group. An empty
    // list therefore sees the company-wide rows and nothing more -- never "everything".
    clauses.push(
      filter.groupIds.length
        ? `(group_id IS NULL OR group_id IN (${filter.groupIds.map(() => "?").join(", ")}))`
        : "group_id IS NULL"
    );
    params.push(...filter.groupIds);
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

/** The customer_type behind a task, resolved from its entity: 'customer' directly, or
 *  'order' -> orders.customer_id -> customers.customer_type. */
export function taskCustomerType(organizationId: number, id: number): string | null {
  const t = tasksRepo.get(organizationId, id);
  if (!t?.entity_type || !t.entity_id) return null;
  const db = tasksRepo.db();
  if (t.entity_type === "customer") {
    return (
      (db.prepare("SELECT customer_type FROM customers WHERE id = ? AND organization_id = ?").get(t.entity_id, organizationId) as
        | { customer_type: string | null }
        | undefined)?.customer_type ?? null
    );
  }
  if (t.entity_type === "order") {
    return (
      (db
        .prepare(
          `SELECT c.customer_type FROM orders o JOIN customers c ON c.id = o.customer_id
            WHERE o.id = ? AND o.organization_id = ?`
        )
        .get(t.entity_id, organizationId) as { customer_type: string | null } | undefined)?.customer_type ?? null
    );
  }
  return null;
}

export function dismissTask(organizationId: number, id: number): void {
  const row = tasksRepo.get(organizationId, id);
  if (!row) throw new TaskError("کار پیدا نشد");
  tasksRepo.patch(organizationId, id, { status: "dismissed", done_at: new Date().toISOString() });
  if (row.entity_type && row.entity_id) {
    resolveRuleRunsFor(organizationId, row.entity_type, row.entity_id);
  }
}
