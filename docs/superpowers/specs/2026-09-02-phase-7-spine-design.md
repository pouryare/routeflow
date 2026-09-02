# RouteFlow Phase 7 — Spine + briefing (M8) — Design

**Date:** 2026-09-02 · **Branch:** `phase-7-spine` (off `phase-6-weather`) · **Status:** design.

Implements `docs/crm-erp-plan.md` M8 (`events` / `tasks` / `alerts` / `rules` / `rule_runs` / `targets`) and §4.3 (`/today`, role-branched). No external service — the rule engine and the briefing queries are fully TDD'd.

---

## 1. Schema

```sql
-- append-only fact bus. The generic spine; order_events stays as the order-specific audit.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  kind TEXT NOT NULL,                 -- 'payment.recorded', 'delivery.failed', 'order.confirmed', 'customer.overdue', …
  entity_type TEXT, entity_id INTEGER,
  actor_user_id INTEGER REFERENCES users(id),
  metadata_json TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_events_recent ON events(organization_id, kind, occurred_at);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER REFERENCES organizations(id),   -- NULL = a shipped default
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,         -- the event.kind it listens for, or 'sweep' for a periodic check
  condition_json TEXT,               -- {field, op, value}[] against event.metadata / a context row
  action_kind TEXT NOT NULL CHECK (action_kind IN ('task', 'alert')),
  action_json TEXT,                  -- {title, priority, role_hint, severity, category}
  cooldown_min INTEGER NOT NULL DEFAULT 1440,
  escalate_after_min INTEGER,        -- NULL = no escalation
  escalate_to_role TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, code)
);

CREATE TABLE rule_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  rule_id INTEGER NOT NULL REFERENCES rules(id),
  entity_type TEXT, entity_id INTEGER,
  fired_at TEXT NOT NULL,
  cooldown_until TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id),
  alert_id INTEGER REFERENCES alerts(id),
  escalated_at TEXT,
  resolved_at TEXT
);
CREATE INDEX ix_rule_runs_live ON rule_runs(organization_id, rule_id, entity_id, resolved_at);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  assignee_user_id INTEGER REFERENCES users(id),
  role_hint TEXT,                     -- when no specific assignee: whom it is for
  group_id INTEGER REFERENCES groups(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  entity_type TEXT, entity_id INTEGER,
  due_at TEXT,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('CRITICAL','HIGH','NORMAL','LOW')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dismissed')),
  outcome_code TEXT,                  -- links the academy objection library (Phase 8)
  outcome_note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  done_at TEXT
);
CREATE INDEX ix_tasks_open ON tasks(organization_id, assignee_user_id, status, due_at);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  severity TEXT NOT NULL CHECK (severity IN ('critical','warning','opportunity')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  entity_type TEXT, entity_id INTEGER,
  group_id INTEGER REFERENCES groups(id),
  created_at TEXT NOT NULL,
  resolved_at TEXT, resolved_by INTEGER REFERENCES users(id)
);
CREATE INDEX ix_alerts_open ON alerts(organization_id, severity, resolved_at);

CREATE TABLE targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER REFERENCES users(id),    -- NULL = a group target
  group_id INTEGER REFERENCES groups(id),
  period TEXT NOT NULL,                     -- 'YYYY-MM' (Jalali year-month)
  metric TEXT NOT NULL CHECK (metric IN ('revenue_toman','kg','orders')),
  target_value REAL NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, user_id, group_id, period, metric)
);
```

`TENANT_TABLES` += `events`, `rules`, `rule_runs`, `tasks`, `alerts`, `targets`. `rules` NULL-org defaults handled like `reason_codes` (sweeps skip; `tenancy-schema` no-NULL check skips). Everything else is strictly tenant-scoped.

`seedRules(db)` — a handful of NULL-org defaults:
| code | trigger_kind | condition | action | cooldown | escalate |
|---|---|---|---|---|---|
| `credit_approval_waiting` | `sweep` | a `credit_approvals` row pending > 60 min | alert `critical` / task role `group_manager` | 60 | after 240 → `owner` |
| `delivery_failed_retry` | `delivery.failed` | — | task role `group_manager` «پیگیری تحویل ناموفق» HIGH | 720 | — |
| `customer_overdue` | `sweep` | active customer with no order in > 2× their mean interval | task role `salesperson` «تماس با مشتری معوق» NORMAL | 2880 | — |
| `expiring_batch` | `sweep` | a batch within its expiry window with stock | alert `warning` / category `stock` | 1440 | — |
| `sample_followup` | `sweep` | `order_type='SAMPLE'` CLOSED > 3 days with no follow-up order | task role `salesperson` «پیگیری نمونه» NORMAL | 4320 | — |

---

## 2. Events — `lib/repo/events.ts` (tested)

- `emitEvent(orgId, {kind, entity_type?, entity_id?, actor_user_id?, metadata?, occurred_at?})` → id. Append-only.
- Wired into a few existing flows as thin one-liners: `recordDelivery` on a `failDelivery` → `delivery.failed`; `recordPayment` → `payment.recorded`; `advanceOrder` → `order.<action>` (a mirror, cheap). Each call site is one `emitEvent(...)`; a failure to emit never breaks the flow (wrapped).
- `recentEvents(orgId, {kind?, since?, limit?})`.

## 3. The rule engine — `lib/rules/engine.ts` (pure) + `lib/repo/rules.ts` (tested)

**Pure** `lib/rules/engine.ts`:
```ts
export interface RuleCondition { field: string; op: "eq"|"ne"|"gt"|"gte"|"lt"|"lte"|"in"|"exists"; value?: unknown; }
export function evaluateConditions(conds: RuleCondition[], row: Record<string, unknown>): boolean;
export function cooldownUntil(firedAtIso: string, cooldownMin: number): string;
export function isEscalatable(run: { fired_at: string; escalated_at: string | null; resolved_at: string | null }, escalateAfterMin: number | null, nowIso: string): boolean;
```

**`lib/repo/rules.ts`**:
- `rulesFor(orgId)` — tenant ∪ NULL-org, tenant wins per code.
- `runEventRules(orgId, event)` — for each active rule with `trigger_kind === event.kind`: skip if an unresolved `rule_runs` for this (rule, entity) is still inside `cooldown_until`; `evaluateConditions(rule.condition_json, event.metadata)` — on fire, create the `task` or `alert` per `action_json`, write a `rule_runs` row (`cooldown_until = cooldownUntil(...)`). Returns what fired.
- `runSweepRules(orgId, asOfIso)` — the `trigger_kind='sweep'` rules; each has a small dedicated query (`credit_approvals pending`, `expiringBatches`, `customer_overdue`, `sample_followup`), same cooldown + create logic. This is the periodic sweep a cron / boot hook calls.
- `escalateStaleRuns(orgId, asOfIso)` — `rule_runs` where `isEscalatable` → re-assign the linked task to a user of `escalate_to_role` (any in the group, else the owner), stamp `escalated_at`, bump the task priority.
- `resolveRuleRunsFor(orgId, entity_type, entity_id)` — when the underlying thing is handled (a task done, an approval decided), close the matching `rule_runs` so the rule can fire again later.

## 4. Tasks / alerts / targets repos (tested)

- `lib/repo/tasks.ts` — `tasksRepo`, `createTask`, `listTasks(orgId, {assignee?, role?, status?})`, `completeTask(orgId, id, {outcome_code?, outcome_note?})` (stamps `done_at`, `status='done'`, calls `resolveRuleRunsFor`), `dismissTask`.
- `lib/repo/alerts.ts` — `alertsRepo`, `raiseAlert`, `listAlerts(orgId, {severity?, open?})`, `resolveAlert(orgId, id, by)`.
- `lib/repo/targets.ts` — `setTarget` (upsert), `listTargets(orgId, period)`, `targetProgress(orgId, {user_id?, group_id?, period, metric})` — actual from `orders`/`payments` over the Jalali month, returns `{target, actual, fraction}`.

## 5. Briefing — `lib/repo/briefing.ts` (tested)

`todayFor(session)` → `{ role, panels: BriefingPanel[] }` where a `BriefingPanel` is `{ key, title, items: BriefingItem[], more?: number }` and a `BriefingItem` is `{ label, sub?, href?, tone?, action? }`. Role branches per §4.3, each panel capped (e.g. 5 items, `more` = the overflow count):

- **salesperson** — `call_list` (customers overdue vs their own mean interval), `open_tasks`, `sample_followups`, `target` (this month, bullet: target/actual/fraction), `commission` (accrued), `leads` (assigned lead_lists items).
- **driver** — `today_run` (stops / kg / cash from `readRun`), `weather` (from the run's `weather_json`), `retry` (yesterday's `DELIVERY_FAILED` on their runs), `commission`.
- **group_manager** — `orders_by_state` (today, `GROUP BY status`), `exceptions` (open alerts), `credit_waiting` (pending `credit_approvals`), `team_target`, `unplanned` (CONFIRMED orders with no stop), `capacity` (runs today vs their `capacity_stops`).
- **rep_manager** — `reps_by_stage`, `onboarding_overdue`, `reps_idle` (no order in N days), `rep_targets`.
- **owner** — `groups` (count + today's orders), `cash_today` (by method), `stock_risk` (expiring batches count), `critical_alerts`, `margin_vs_last` (this month vs last).
- **platform_owner** — `tenants` (org count, today's events per org, unresolved critical alerts per org).

Rule: every item carries an `href` or an `action`, or it is dropped (a bare number belongs in `/analytics`).

## 6. API

| route | method | notes |
|---|---|---|
| `/api/today` | GET | `todayFor(session)` |
| `/api/tasks` | GET `?status=&role=`, POST | list scoped to the session; POST creates |
| `/api/tasks/[id]` | PATCH `{status, outcome_code?, outcome_note?}` | complete / dismiss |
| `/api/alerts` | GET `?open=1`, PATCH `{id, resolve:true}` | |
| `/api/targets` | GET `?period=`, POST `{user_id?, group_id?, period, metric, target_value}` | owner/manager |
| `/api/rules` | GET, PATCH `{id, active?, cooldown_min?, …}` | owner/manager |
| `/api/rules/run` | POST | `runSweepRules` + `escalateStaleRuns` for the org — the cron hook |

`proxy.ts`: `/api/today`, `/api/tasks*`, `/api/alerts` open to any authenticated non-platform role (each scopes by session); `/api/targets`, `/api/rules*` → owner/manager.

## 7. `/today` UI

One route, role-branched, the post-login landing (`/` redirects here for a logged-in non-platform user; keep `/login` and existing entry points). Each panel a card: title, ≤5 items each a row with its `href`/`action`, a «موارد بیشتر» link when `more>0`. A task row shows outcome buttons (`تماس شد` / `خرید کرد` / `رد کرد` → PATCH with an `outcome_code`). Mobile-first, no horizontal scroll.

Nav: add «امروز» as the first tab in the sales layout; the driver page links to it.

## 8. Tenancy

Six new tenant tables. `twoOrgs` seeds one `tasks` + one `alerts` + one `targets` + one `rules` (tenant) row per org. `tenancy-isolation`: none leak; the NULL-org default rules are shared.

## 9. Migration safety

`tests/spine-migration-realdata.test.ts` (env-gated): `foreign_key_check` empty; the six tables exist and (bar the seeded NULL-org `rules`) empty; the seeded default rules number 5.

## 10. Deviations anticipated

- **`events` is a new generic bus; `order_events` stays** as the order-specific audit trail. Emitters are wired only where cheap (delivery fail, payment, order transition mirror); a full event-sourcing sweep is out of scope.
- **The sweep is a query + `runSweepRules`, not a running cron** — `/api/rules/run` is the hook a real scheduler (or a boot-time check) calls. Same pattern as Phase 5's `runsNeedingFreeze`.
- **`condition_json` is a flat `{field,op,value}[]`** — no nested boolean logic. A rule needing more gets a dedicated sweep query instead.
- **`/today` panels are capped and every item is actionable** — a panel with nothing actionable is omitted, not shown empty.
- **No `lesson_progress` / academy wiring** — that is Phase 8; `tasks.outcome_code` is the forward hook.
