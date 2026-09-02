import { getDb } from "@/lib/db";
import {
  evaluateConditions,
  cooldownUntil,
  isEscalatable,
  type RuleCondition,
} from "@/lib/rules/engine";
import { toJalali } from "@/lib/jalali";
import { rruleMatches } from "@/lib/tasks/recurrence";
import { listRecurrences } from "./taskRecurrences";
import { createTask } from "./tasks";
import type { EventRow } from "./events";

export interface RuleRow {
  id: number;
  organization_id: number | null;
  code: string;
  name: string;
  trigger_kind: string;
  condition_json: string | null;
  action_kind: "task" | "alert";
  action_json: string | null;
  cooldown_min: number;
  escalate_after_min: number | null;
  escalate_to_role: string | null;
  active: number;
}

interface ActionSpec {
  title?: string;
  kind?: string;
  role_hint?: string;
  priority?: string;
  severity?: string;
  category?: string;
}

/** Tenant rules ∪ the NULL-org defaults, tenant winning per code. */
export function rulesFor(organizationId: number): RuleRow[] {
  const rows = getDb()
    .prepare(
      `SELECT *, (organization_id IS NOT NULL) AS is_tenant FROM rules
        WHERE active = 1 AND (organization_id = ? OR organization_id IS NULL)`
    )
    .all(organizationId) as unknown as (RuleRow & { is_tenant: number })[];
  const byCode = new Map<string, RuleRow>();
  for (const r of rows) {
    const existing = byCode.get(r.code);
    if (!existing || r.is_tenant) byCode.set(r.code, r);
  }
  return [...byCode.values()];
}

function liveRun(
  organizationId: number,
  ruleId: number,
  entityType: string | null,
  entityId: number | null,
  nowIso: string
): { id: number } | undefined {
  return getDb()
    .prepare(
      `SELECT id FROM rule_runs
        WHERE organization_id = ? AND rule_id = ?
          AND entity_type IS ? AND entity_id IS ?
          AND resolved_at IS NULL AND cooldown_until > ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(organizationId, ruleId, entityType, entityId, nowIso) as { id: number } | undefined;
}

/** Create the rule's task or alert and the rule_runs row. Returns the run id. */
function fire(
  organizationId: number,
  rule: RuleRow,
  entityType: string | null,
  entityId: number | null,
  ctx: { group_id?: number | null; assignee_user_id?: number | null; title_override?: string },
  nowIso: string
): number {
  const db = getDb();
  const spec: ActionSpec = rule.action_json ? JSON.parse(rule.action_json) : {};
  const title = ctx.title_override ?? spec.title ?? rule.name;

  let taskId: number | null = null;
  let alertId: number | null = null;

  if (rule.action_kind === "task") {
    taskId = Number(
      db
        .prepare(
          `INSERT INTO tasks
             (organization_id, assignee_user_id, role_hint, group_id, kind, title, entity_type, entity_id,
              priority, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
        )
        .run(
          organizationId,
          ctx.assignee_user_id ?? null,
          spec.role_hint ?? null,
          ctx.group_id ?? null,
          spec.kind ?? rule.code,
          title,
          entityType,
          entityId,
          spec.priority ?? "NORMAL",
          nowIso
        ).lastInsertRowid
    );
  } else {
    alertId = Number(
      db
        .prepare(
          `INSERT INTO alerts
             (organization_id, severity, category, title, entity_type, entity_id, group_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          organizationId,
          spec.severity ?? "warning",
          spec.category ?? rule.code,
          title,
          entityType,
          entityId,
          ctx.group_id ?? null,
          nowIso
        ).lastInsertRowid
    );
  }

  return Number(
    db
      .prepare(
        `INSERT INTO rule_runs
           (organization_id, rule_id, entity_type, entity_id, fired_at, cooldown_until, task_id, alert_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        organizationId,
        rule.id,
        entityType,
        entityId,
        nowIso,
        cooldownUntil(nowIso, rule.cooldown_min),
        taskId,
        alertId
      ).lastInsertRowid
  );
}

export interface FiredRun {
  rule_code: string;
  run_id: number;
}

/** Run every event-triggered rule against one event. */
export function runEventRules(organizationId: number, event: EventRow): FiredRun[] {
  const now = new Date().toISOString();
  const meta: Record<string, unknown> = event.metadata_json ? JSON.parse(event.metadata_json) : {};
  const out: FiredRun[] = [];

  for (const rule of rulesFor(organizationId)) {
    if (rule.trigger_kind !== event.kind) continue;
    if (liveRun(organizationId, rule.id, event.entity_type, event.entity_id, now)) continue;
    const conds: RuleCondition[] = rule.condition_json ? JSON.parse(rule.condition_json) : [];
    if (!evaluateConditions(conds, meta)) continue;
    const runId = fire(
      organizationId,
      rule,
      event.entity_type,
      event.entity_id,
      {},
      now
    );
    out.push({ rule_code: rule.code, run_id: runId });
  }
  return out;
}

/** The periodic sweep. Each 'sweep' rule has a dedicated query here. */
export function runSweepRules(organizationId: number, asOfIso: string = new Date().toISOString()): FiredRun[] {
  const db = getDb();
  const out: FiredRun[] = [];
  const rules = new Map(rulesFor(organizationId).map((r) => [r.code, r]));
  const consider = (
    code: string,
    entityType: string,
    entityId: number,
    ctx: { title_override?: string; group_id?: number | null } = {}
  ) => {
    const rule = rules.get(code);
    if (!rule || rule.trigger_kind !== "sweep") return;
    if (liveRun(organizationId, rule.id, entityType, entityId, asOfIso)) return;
    out.push({ rule_code: code, run_id: fire(organizationId, rule, entityType, entityId, ctx, asOfIso) });
  };

  // credit_approval_waiting: pending > 60 min
  for (const r of db
    .prepare(
      "SELECT id FROM credit_approvals WHERE organization_id = ? AND status = 'pending' AND requested_at <= ?"
    )
    .all(organizationId, new Date(Date.parse(asOfIso) - 60 * 60_000).toISOString()) as { id: number }[]) {
    consider("credit_approval_waiting", "credit_approval", r.id);
  }

  // expiring_batch: a batch within 14 days with stock
  for (const b of db
    .prepare(
      `SELECT b.id FROM batches b
        WHERE b.organization_id = ? AND b.status = 'active' AND b.expiry_date IS NOT NULL
          AND julianday(b.expiry_date) - julianday(?) BETWEEN 0 AND 14
          AND COALESCE((SELECT SUM(m.base_qty) FROM stock_movements m WHERE m.batch_id = b.id), 0) > 0`
    )
    .all(organizationId, asOfIso.slice(0, 10)) as { id: number }[]) {
    consider("expiring_batch", "batch", b.id);
  }

  // customer_overdue: active customer with no order in > 2x their mean interval (>= 3 orders)
  for (const c of db
    .prepare(
      `SELECT c.id, c.group_id,
              (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS n,
              (SELECT MIN(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS first_order
         FROM customers c
        WHERE c.organization_id = ? AND c.lifecycle = 'active'`
    )
    .all(organizationId) as {
    id: number;
    group_id: number | null;
    last_order: string | null;
    n: number;
    first_order: string | null;
  }[]) {
    if (c.n < 3 || !c.last_order || !c.first_order) continue;
    const spanDays = (Date.parse(c.last_order) - Date.parse(c.first_order)) / 86_400_000;
    const meanInterval = spanDays / Math.max(1, c.n - 1);
    const idleDays = (Date.parse(asOfIso) - Date.parse(c.last_order)) / 86_400_000;
    if (idleDays > 2 * meanInterval && meanInterval > 0) {
      consider("customer_overdue", "customer", c.id, { group_id: c.group_id });
    }
  }

  // sample_followup: a SAMPLE order CLOSED > 3 days ago with no later order from that customer
  for (const s of db
    .prepare(
      `SELECT o.id, o.customer_id, o.group_id FROM orders o
        WHERE o.organization_id = ? AND o.order_type = 'SAMPLE' AND o.status = 'CLOSED'
          AND o.updated_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM orders o2 WHERE o2.customer_id = o.customer_id
              AND o2.order_type = 'SALE' AND o2.order_date > o.order_date
          )`
    )
    .all(organizationId, new Date(Date.parse(asOfIso) - 3 * 86_400_000).toISOString()) as {
    id: number;
    group_id: number | null;
  }[]) {
    consider("sample_followup", "order", s.id, { group_id: s.group_id });
  }

  // Board & Pocket: templates that spawn a task on a schedule. Same hook, same cooldown
  // idea (last_spawned_on), so /api/rules/run drives it with no extra scheduler.
  spawnRecurringTasks(organizationId, asOfIso);

  return out;
}

/** Jalali civil date as YYYY-MM-DD (Tehran). */
function jalaliYmd(iso: string): string {
  const j = toJalali(iso);
  if (!j) return iso.slice(0, 10);
  return `${j.jy}-${String(j.jm).padStart(2, "0")}-${String(j.jd).padStart(2, "0")}`;
}

/** Spawn a task for every active recurrence whose rrule matches today and that has not
 *  already spawned today. Idempotent by `last_spawned_on`. Returns the count spawned. */
export function spawnRecurringTasks(
  organizationId: number,
  asOfIso: string = new Date().toISOString()
): { spawned: number } {
  const today = jalaliYmd(asOfIso);
  const dueIso = asOfIso.slice(0, 10);
  let spawned = 0;
  for (const r of listRecurrences(organizationId, { active: true })) {
    if (r.last_spawned_on === today) continue;
    if (!rruleMatches(r.rrule, today)) continue;
    createTask(organizationId, {
      title: r.title,
      kind: r.kind,
      assignee_user_id: r.assignee_user_id,
      role_hint: r.role_hint,
      group_id: r.group_id,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      priority: r.priority,
      due_at: dueIso,
      created_by: r.created_by,
    });
    getDb()
      .prepare("UPDATE task_recurrences SET last_spawned_on = ?, updated_at = ? WHERE id = ?")
      .run(today, asOfIso, r.id);
    spawned++;
  }
  return { spawned };
}

/** Escalate stale unresolved runs: re-assign the linked task to someone of the rule's
 *  escalate_to_role and bump its priority. */
export function escalateStaleRuns(
  organizationId: number,
  asOfIso: string = new Date().toISOString()
): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT rr.id, rr.fired_at, rr.escalated_at, rr.resolved_at, rr.task_id,
              r.escalate_after_min, r.escalate_to_role
         FROM rule_runs rr JOIN rules r ON r.id = rr.rule_id
        WHERE rr.organization_id = ? AND rr.resolved_at IS NULL AND rr.escalated_at IS NULL
          AND r.escalate_after_min IS NOT NULL`
    )
    .all(organizationId) as {
    id: number;
    fired_at: string;
    escalated_at: string | null;
    resolved_at: string | null;
    task_id: number | null;
    escalate_after_min: number;
    escalate_to_role: string;
  }[];

  let n = 0;
  for (const rr of rows) {
    if (!isEscalatable(rr, rr.escalate_after_min, asOfIso)) continue;
    db.prepare("UPDATE rule_runs SET escalated_at = ? WHERE id = ?").run(asOfIso, rr.id);
    if (rr.task_id) {
      const to = db
        .prepare(
          "SELECT id FROM users WHERE organization_id = ? AND role = ? AND active = 1 ORDER BY id LIMIT 1"
        )
        .get(organizationId, rr.escalate_to_role) as { id: number } | undefined;
      db.prepare(
        "UPDATE tasks SET assignee_user_id = COALESCE(?, assignee_user_id), priority = 'CRITICAL' WHERE id = ?"
      ).run(to?.id ?? null, rr.task_id);
    }
    n += 1;
  }
  return n;
}

export class RuleError extends Error {}

/** Toggle / retune a rule for one tenant -- writes a tenant override row keyed by code,
 *  copying the rest of the shape from the base (tenant or default) rule. */
export function setTenantRuleOverride(
  organizationId: number,
  input: { code: string; active?: boolean; cooldown_min?: number }
): void {
  const db = getDb();
  const base = db
    .prepare(
      `SELECT * FROM rules WHERE code = ? AND (organization_id IS NULL OR organization_id = ?)
        ORDER BY (organization_id IS NULL) LIMIT 1`
    )
    .get(input.code, organizationId) as RuleRow | undefined;
  if (!base) throw new RuleError("قانون پیدا نشد");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO rules
       (organization_id, code, name, trigger_kind, condition_json, action_kind, action_json,
        cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (organization_id, code) DO UPDATE SET
       active = excluded.active, cooldown_min = excluded.cooldown_min, updated_at = excluded.updated_at`
  ).run(
    organizationId,
    base.code,
    base.name,
    base.trigger_kind,
    base.condition_json,
    base.action_kind,
    base.action_json,
    input.cooldown_min ?? base.cooldown_min,
    base.escalate_after_min,
    base.escalate_to_role,
    input.active === false ? 0 : 1,
    now,
    now
  );
}

/** When the underlying thing is handled, close the matching runs so the rule can fire
 *  again later. */
export function resolveRuleRunsFor(
  organizationId: number,
  entityType: string,
  entityId: number
): void {
  getDb()
    .prepare(
      "UPDATE rule_runs SET resolved_at = ? WHERE organization_id = ? AND entity_type = ? AND entity_id = ? AND resolved_at IS NULL"
    )
    .run(new Date().toISOString(), organizationId, entityType, entityId);
}
