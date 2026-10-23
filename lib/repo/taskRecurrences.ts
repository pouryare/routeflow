import { makeRepo } from "./base";

/** A template that spawns a task on a schedule. `spawnRecurringTasks` (lib/repo/rules.ts,
 *  run from /api/rules/run) reads these on every sweep. */
export interface TaskRecurrenceRow {
  id: number;
  organization_id: number;
  title: string;
  kind: string;
  assignee_user_id: number | null;
  role_hint: string | null;
  group_id: number | null;
  entity_type: string | null;
  entity_id: number | null;
  priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
  rrule: string;
  active: number;
  last_spawned_on: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export class RecurrenceError extends Error {}

/** daily | weekly:<sat..fri> | monthly:<1-28>. Validated here and in lib/tasks/recurrence.ts. */
export const VALID_RRULE = /^(daily|weekly:(sat|sun|mon|tue|wed|thu|fri)|monthly:([1-9]|1\d|2[0-8]))$/;

export const taskRecurrencesRepo = makeRepo<TaskRecurrenceRow>("task_recurrences", { tenant: true });

export interface RecurrenceInput {
  title: string;
  kind: string;
  rrule: string;
  priority?: TaskRecurrenceRow["priority"];
  assignee_user_id?: number | null;
  role_hint?: string | null;
  group_id?: number | null;
  entity_type?: string | null;
  entity_id?: number | null;
}

export async function listRecurrences(
  organizationId: number,
  opts: { active?: boolean } = {}
): Promise<TaskRecurrenceRow[]> {
  const clauses = ["organization_id = ?"];
  const params: unknown[] = [organizationId];
  if (opts.active !== undefined) {
    clauses.push("active = ?");
    params.push(opts.active ? 1 : 0);
  }
  return await taskRecurrencesRepo
    .db()
    .prepare(`SELECT * FROM task_recurrences WHERE ${clauses.join(" AND ")} ORDER BY id`)
    .all(...(params as never[])) as unknown as TaskRecurrenceRow[];
}

export async function createRecurrence(
  organizationId: number,
  input: RecurrenceInput,
  actor: number
): Promise<TaskRecurrenceRow> {
  if (!input.title?.trim()) throw new RecurrenceError("عنوان لازم است");
  if (!VALID_RRULE.test(input.rrule)) throw new RecurrenceError("الگوی تکرار نامعتبر است");
  const now = new Date().toISOString();
  const id = await taskRecurrencesRepo.insert(organizationId, {
    organization_id: organizationId,
    title: input.title.trim(),
    kind: input.kind,
    assignee_user_id: input.assignee_user_id ?? null,
    role_hint: input.role_hint ?? null,
    group_id: input.group_id ?? null,
    entity_type: input.entity_type ?? null,
    entity_id: input.entity_id ?? null,
    priority: input.priority ?? "NORMAL",
    rrule: input.rrule,
    active: 1,
    last_spawned_on: null,
    created_by: actor,
    created_at: now,
    updated_at: now,
  } as Omit<TaskRecurrenceRow, "id">);
  return await taskRecurrencesRepo.get(organizationId, id) as TaskRecurrenceRow;
}

export async function patchRecurrence(
  organizationId: number,
  id: number,
  patch: Partial<
    Pick<
      TaskRecurrenceRow,
      | "title"
      | "kind"
      | "rrule"
      | "priority"
      | "active"
      | "assignee_user_id"
      | "role_hint"
      | "group_id"
      | "entity_type"
      | "entity_id"
      | "last_spawned_on"
    >
  >
): Promise<TaskRecurrenceRow | null> {
  const existing = await taskRecurrencesRepo.get(organizationId, id);
  if (!existing) return null;
  if (patch.rrule !== undefined && !VALID_RRULE.test(patch.rrule)) {
    throw new RecurrenceError("الگوی تکرار نامعتبر است");
  }
  await taskRecurrencesRepo.patch(organizationId, id, { ...patch, updated_at: new Date().toISOString() });
  return await taskRecurrencesRepo.get(organizationId, id) as TaskRecurrenceRow;
}

export async function removeRecurrence(organizationId: number, id: number): Promise<boolean> {
  if (!await taskRecurrencesRepo.get(organizationId, id)) return false;
  await taskRecurrencesRepo
    .db()
    .prepare("DELETE FROM task_recurrences WHERE id = ? AND organization_id = ?")
    .run(id, organizationId);
  return true;
}
