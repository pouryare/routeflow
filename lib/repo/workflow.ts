import { getDb, TaskRow } from "@/lib/db";
import { createTask } from "@/lib/repo/tasks";

export class WorkflowError extends Error {}

export interface StepTemplate {
  key: string;
  label_fa: string;
}

/** The fixed, seeded, app-wide step palette -- no admin CRUD, spec 2026-09-08 §15
 *  decision 6 (originally settled for the generic design, kept for this repurposed
 *  complaint-resolution one). */
export function listStepTemplates(): StepTemplate[] {
  return getDb()
    .prepare("SELECT key, label_fa FROM workflow_step_templates ORDER BY sort_order")
    .all() as StepTemplate[];
}

/** Every task spawned for this complaint's resolution graph, plus the edges connecting
 *  them. entity_type='complaint'/entity_id=complaintId is the same polymorphic link
 *  photos/reminders/activity_log already use -- no dedicated complaint_id column. */
export function getComplaintSteps(
  organizationId: number,
  complaintId: number,
): { tasks: TaskRow[]; edges: { from_task_id: number; to_task_id: number }[] } {
  const db = getDb();
  const tasks = db
    .prepare(
      "SELECT * FROM tasks WHERE organization_id = ? AND entity_type = 'complaint' AND entity_id = ? ORDER BY created_at"
    )
    .all(organizationId, complaintId) as TaskRow[];
  const ids = tasks.map((t) => t.id);
  const edges =
    ids.length === 0
      ? []
      : (db
          .prepare(
            `SELECT from_task_id, to_task_id FROM workflow_edges WHERE to_task_id IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids) as { from_task_id: number; to_task_id: number }[]);
  return { tasks, edges };
}

/** Spawns a new task from a template, linked into the complaint's resolution graph.
 *  fromTaskId null -> a root step, attached directly to the complaint with no edge.
 *  fromTaskId set -> a child step; MUST belong to the same complaint (a resolution
 *  graph never crosses complaints), and the UNIQUE constraint on workflow_edges.
 *  to_task_id (a fresh task, by construction, can never already have a parent) makes
 *  the tree invariant a DB-level guarantee, not just an app-level one. */
export function linkStep(
  organizationId: number,
  complaintId: number,
  templateKey: string,
  fromTaskId: number | null,
  createdByUserId: number,
): { taskId: number; edge: { from_task_id: number; to_task_id: number } | null } {
  const db = getDb();
  const template = db
    .prepare("SELECT label_fa FROM workflow_step_templates WHERE key = ?")
    .get(templateKey) as { label_fa: string } | undefined;
  if (!template) throw new WorkflowError("مرحلهٔ نامعتبر");

  if (fromTaskId !== null) {
    const parent = db
      .prepare("SELECT entity_type, entity_id FROM tasks WHERE id = ? AND organization_id = ?")
      .get(fromTaskId, organizationId) as { entity_type: string | null; entity_id: number | null } | undefined;
    if (!parent || parent.entity_type !== "complaint" || parent.entity_id !== complaintId) {
      throw new WorkflowError("مرحلهٔ مبدأ متعلق به این شکایت نیست");
    }
  }

  const taskId = createTask(organizationId, {
    title: template.label_fa,
    kind: "complaint_step",
    entity_type: "complaint",
    entity_id: complaintId,
    created_by: createdByUserId,
  });

  let edge: { from_task_id: number; to_task_id: number } | null = null;
  if (fromTaskId !== null) {
    db.prepare("INSERT INTO workflow_edges (from_task_id, to_task_id, created_at) VALUES (?, ?, ?)").run(
      fromTaskId,
      taskId,
      new Date().toISOString(),
    );
    edge = { from_task_id: fromTaskId, to_task_id: taskId };
  }

  return { taskId, edge };
}
