import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import {
  evaluateConditions,
  cooldownUntil,
  isEscalatable,
  type RuleCondition,
} from "@/lib/rules/engine";
import { jalaliYmd } from "@/lib/jalali";
import { ROLES, type Role } from "@/lib/roles";
import { rruleMatches } from "@/lib/tasks/recurrence";
import { listRecurrences } from "./taskRecurrences";
import { createTask } from "./tasks";
import { fanOutNotifications, flushNotifications } from "./notifications";
import { emitEvent, tryEmitEvent, type EventRow } from "./events";

export interface RuleRow {
  id: number;
  organization_id: number | null;
  code: string;
  name: string;
  trigger_kind: string;
  condition_json: string | null;
  action_kind: "task" | "alert" | "notify";
  action_json: string | null;
  cooldown_min: number;
  escalate_after_min: number | null;
  escalate_to_role: string | null;
  active: number;
}

interface ActionSpec {
  title?: string;
  notification_type?: string;
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
  nowIso: string,
  db?: DatabaseSync
): { id: number } | undefined {
  return (db ?? getDb())
    .prepare(
      `SELECT id FROM rule_runs
        WHERE organization_id = ? AND rule_id = ?
          AND entity_type IS ? AND entity_id IS ?
          AND resolved_at IS NULL AND cooldown_until > ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(organizationId, ruleId, entityType, entityId, nowIso) as { id: number } | undefined;
}

/** The fan-out shape `fanOutNotifications` consumes: an events row minus the columns it
 *  never reads. */
type SourceEvent = Pick<
  EventRow,
  "id" | "kind" | "entity_type" | "entity_id" | "actor_user_id" | "metadata_json" | "occurred_at"
>;

/** Record a sweep finding on the event bus so a sweep-triggered `notify` rule has a real
 *  source event to fan out from. Returns undefined for a notify rule with no
 *  notification_type -- nothing to deliver, so nothing to record. */
function synthesiseSweepEvent(
  organizationId: number,
  spec: ActionSpec,
  entityType: string | null,
  entityId: number | null,
  meta: Record<string, unknown> | undefined,
  nowIso: string,
  db?: DatabaseSync
): SourceEvent | undefined {
  const kind = spec.notification_type;
  if (!kind) return undefined;
  const metadata = meta ?? {};
  const id = emitEvent(
    organizationId,
    { kind, entity_type: entityType, entity_id: entityId, actor_user_id: null, metadata, occurred_at: nowIso },
    db
  );
  return {
    id,
    kind,
    entity_type: entityType,
    entity_id: entityId,
    actor_user_id: null,
    metadata_json: JSON.stringify(metadata),
    occurred_at: nowIso,
  };
}

/** Create the rule's task, alert, or notification fan-out, plus the rule_runs row.
 *  Returns the run id. */
function fire(
  organizationId: number,
  rule: RuleRow,
  entityType: string | null,
  entityId: number | null,
  ctx: {
    group_id?: number | null;
    assignee_user_id?: number | null;
    title_override?: string;
    meta?: Record<string, unknown>;
    event?: EventRow;
  },
  nowIso: string,
  db?: DatabaseSync
): number {
  const conn = db ?? getDb();
  const spec: ActionSpec = rule.action_json ? JSON.parse(rule.action_json) : {};
  const title = ctx.title_override ?? spec.title ?? rule.name;

  let taskId: number | null = null;
  let alertId: number | null = null;

  if (rule.action_kind === "notify") {
    // Feed rows are written by the notification module; rule_runs still tracks the fire
    // for cooldown/liveRun. No task or alert id. An event-triggered rule already carries
    // the event fanOutNotifications needs; a 'notify' rule on a 'sweep' trigger (Phase 2:
    // cheque.due_soon, reminder.due, credit_approval.waiting, customer.overdue) has none,
    // so the sweep's finding is recorded on the bus first and the fan-out hangs off that
    // row -- notifications.source_event_id then points at a real event either way.
    // The synthesised kind is the notification type; no seeded rule triggers on those
    // kinds, and an event-triggered fire always carries ctx.event, so this cannot recurse.
    const src = ctx.event ?? synthesiseSweepEvent(organizationId, spec, entityType, entityId, ctx.meta, nowIso, db);
    if (src) {
      fanOutNotifications(
        organizationId,
        { code: rule.code, action_json: rule.action_json },
        {
          id: src.id,
          kind: src.kind,
          entity_type: src.entity_type,
          entity_id: src.entity_id,
          actor_user_id: src.actor_user_id,
          metadata_json: src.metadata_json,
          occurred_at: src.occurred_at,
        },
        null,
        db
      );
    }
  } else if (rule.action_kind === "task") {
    taskId = Number(
      conn
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
      conn
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
    conn
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
export function runEventRules(
  organizationId: number,
  event: EventRow,
  db?: DatabaseSync
): FiredRun[] {
  const now = new Date().toISOString();
  const meta: Record<string, unknown> = event.metadata_json ? JSON.parse(event.metadata_json) : {};
  const out: FiredRun[] = [];

  for (const rule of rulesFor(organizationId)) {
    if (rule.trigger_kind !== event.kind) continue;
    if (liveRun(organizationId, rule.id, event.entity_type, event.entity_id, now, db)) continue;
    const conds: RuleCondition[] = rule.condition_json ? JSON.parse(rule.condition_json) : [];
    if (!evaluateConditions(conds, meta)) continue;
    // A malformed action_json would throw out of fire() and abort every *later* rule for
    // this event. Skip just the broken one; well-formed rules are untouched.
    if (rule.action_json) {
      try {
        JSON.parse(rule.action_json);
      } catch (e) {
        console.warn("[rules] bad action_json for rule", rule.code, e);
        continue;
      }
    }
    const runId = fire(
      organizationId,
      rule,
      event.entity_type,
      event.entity_id,
      { event },
      now,
      db
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
    ctx: { title_override?: string; group_id?: number | null; meta?: Record<string, unknown> } = {}
  ) => {
    const rule = rules.get(code);
    if (!rule || rule.trigger_kind !== "sweep") return;
    if (liveRun(organizationId, rule.id, entityType, entityId, asOfIso)) return;
    out.push({ rule_code: code, run_id: fire(organizationId, rule, entityType, entityId, ctx, asOfIso) });
  };

  // credit_approval_waiting: pending > 60 min
  for (const r of db
    .prepare(
      `SELECT ca.id, (SELECT c.business_name FROM customers c JOIN orders o ON o.customer_id = c.id
                        WHERE o.id = ca.order_id) AS customer_name
         FROM credit_approvals ca
        WHERE ca.organization_id = ? AND ca.status = 'pending' AND ca.requested_at <= ?`
    )
    .all(organizationId, new Date(Date.parse(asOfIso) - 60 * 60_000).toISOString()) as {
    id: number;
    customer_name: string | null;
  }[]) {
    consider("credit_approval_waiting", "credit_approval", r.id);
    consider("notify_credit_approval_waiting", "credit_approval", r.id, {
      meta: { customer_name: r.customer_name },
    });
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
      `SELECT c.id, c.group_id, c.business_name,
              (SELECT MAX(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS last_order,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS n,
              (SELECT MIN(o.order_date) FROM orders o WHERE o.customer_id = c.id) AS first_order
         FROM customers c
        WHERE c.organization_id = ? AND c.lifecycle = 'active'`
    )
    .all(organizationId) as {
    id: number;
    group_id: number | null;
    business_name: string;
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
      consider("notify_customer_overdue", "customer", c.id, {
        group_id: c.group_id,
        meta: { customer_name: c.business_name },
      });
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

  // cheque_due_soon: a held/deposited cheque whose due_date is within 7 days.
  for (const c of db
    .prepare(
      `SELECT id, cheque_no, due_date FROM cheques
        WHERE organization_id = ? AND status IN ('in_hand','deposited')
          AND date(due_date) <= date(?, '+7 days')`
    )
    .all(organizationId, asOfIso.slice(0, 10)) as {
    id: number;
    cheque_no: string;
    due_date: string;
  }[]) {
    consider("notify_cheque_due_soon", "cheque", c.id, {
      meta: { cheque_no: c.cheque_no, due_date: c.due_date },
    });
  }

  // reminder_due: an unresolved reminder at/past its due_date. Replaces
  // scripts/send-reminder-push.mjs -- that script and its systemd timer were both retired
  // on deploy; this sweep is the only reminder notifier now.
  // at deploy.
  for (const r of db
    .prepare(
      `SELECT id, entity_type, entity_id, message FROM reminders
        WHERE resolved = 0 AND date(due_date) <= date(?)`
    )
    .all(asOfIso.slice(0, 10)) as {
    id: number;
    entity_type: string;
    entity_id: number;
    message: string;
  }[]) {
    // Reminders carry no organization_id of their own, so the entity decides who may see
    // them. A customer is owned, and the check is membership. A district is shared
    // reference data (see the districts rebuild in lib/db.ts), so the check is existence --
    // every org's reminder on a shared district is due, and filtering by organization_id
    // would suppress all of them. The column that filter named is gone, so leaving the
    // query alone would throw here on every district reminder rather than merely mis-scope.
    const inOrg =
      r.entity_type === "customer"
        ? db.prepare("SELECT 1 FROM customers WHERE id = ? AND organization_id = ?").get(r.entity_id, organizationId)
        : db.prepare("SELECT 1 FROM districts WHERE id = ?").get(r.entity_id);
    if (inOrg) consider("notify_reminder_due", r.entity_type, r.entity_id, { meta: { message: r.message, reminder_id: r.id } });
  }

  // Board & Pocket: templates that spawn a task on a schedule. Same hook, same cooldown
  // idea (last_spawned_on), so /api/rules/run drives it with no extra scheduler.
  spawnRecurringTasks(organizationId, asOfIso);

  return out;
}

/** Deliver this org's pending feed rows to the loud channels. Split out of
 *  `runSweepRules` (which stays sync) so `/api/rules/run` can await it once per org after
 *  the sweep AND the escalation pass, letting the same tick's `task.escalated` rows ride
 *  along. Best-effort: a broken channel must never fail the sweep. */
export async function flushAllNotifications(
  organizationId: number,
  asOfIso: string = new Date().toISOString()
): Promise<void> {
  try {
    await flushNotifications(organizationId, asOfIso);
  } catch (e) {
    console.warn("[rules] notification flush failed", e);
  }
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
      /* An escalation matching nobody is a task that silently never escalates, so this
         resolves through the SET — a manager whose primary is something else is still one.
         The role is BOUND, not interpolated: it comes from a user-authored rule and must
         never be pasted into a SQL string. */
      const escalateTo = rr.escalate_to_role as Role;
      const to = ROLES.includes(escalateTo)
        ? (db
            .prepare(
              `SELECT u.id FROM users u
                 JOIN user_roles _r ON _r.user_id = u.id AND _r.role = ?
                WHERE u.organization_id = ? AND u.active = 1 ORDER BY u.id LIMIT 1`
            )
            .get(escalateTo, organizationId) as { id: number } | undefined)
        : undefined;
      db.prepare(
        "UPDATE tasks SET assignee_user_id = COALESCE(?, assignee_user_id), priority = 'CRITICAL' WHERE id = ?"
      ).run(to?.id ?? null, rr.task_id);
      // The escalation is a fact of its own: notify_task_escalated triggers on it through
      // runEventRules. No new owner -> nobody to tell, so no event.
      if (to?.id) {
        const t = db.prepare("SELECT title FROM tasks WHERE id = ?").get(rr.task_id) as
          | { title: string }
          | undefined;
        tryEmitEvent(
          organizationId,
          {
            kind: "task.escalated",
            entity_type: "task",
            entity_id: rr.task_id,
            actor_user_id: null,
            metadata: { assignee_user_id: to.id, title: t?.title ?? null },
          },
          db
        );
      }
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
