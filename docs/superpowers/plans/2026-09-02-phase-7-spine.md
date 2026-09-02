# Phase 7 — Spine + briefing Implementation Plan

> Execute task-by-task, TDD, commit + push each. No review checkpoints.

**Goal:** `events` / `rules` / `rule_runs` / `tasks` / `alerts` / `targets` + a rule engine with cooldown + escalation + `/today` role-branched.

**Spec:** `docs/superpowers/specs/2026-09-02-phase-7-spine-design.md`

## Global Constraints

- Persian UI, English identifiers. Cross-tenant → 404. Migrations idempotent, guarded.
- New DB access via `lib/repo/`. Never commit to `main`/build/restart.
- No external service — everything TDD'd.
- Vitest bg + poll. eslint `app/ lib/` + per-file. After route add: `npx next typegen && rm -rf .next/dev/types`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: `lib/rules/engine.ts` — pure evaluation + cooldown/escalation math

**Files:** Create `lib/rules/engine.ts`, `tests/rules-engine.test.ts`.

- `RuleCondition`, `evaluateConditions(conds, row)` (ops eq/ne/gt/gte/lt/lte/in/exists; missing field → false unless `exists` negated), `cooldownUntil(firedAt, min)`, `isEscalatable(run, afterMin, now)`.
- Tests: `[{field:'overage',op:'gt',value:0}]` on `{overage:5}` true, on `{overage:0}` false; `in` with an array; `exists` on a present/absent field; `cooldownUntil('...T10:00Z', 60)` = `...T11:00Z`; `isEscalatable` true when `now - fired_at > afterMin` and not escalated/resolved, false otherwise and false when `afterMin` null.
- Commit.

### Task 2: schema — six tables + `seedRules`

**Files:** Modify `lib/db.ts`, `tests/tenancy-schema.test.ts`; Create `tests/spine-schema.test.ts`.

- `events`, `rules`, `rule_runs`, `tasks`, `alerts`, `targets` in the main schema block. `seedRules(db)` (5 NULL-org defaults, `INSERT … WHERE NOT EXISTS`) next to `seedReasonCodes`. `TENANT_TABLES` += all six. `rules` gets the `reason_codes` treatment (both NULL→1 sweeps + `tenancy-schema` no-NULL check skip it).
- Schema test: tables + CHECKs + uniques; `tasks.priority` / `status` reject junk; `alerts.severity` rejects junk; `targets` UNIQUE; 5 NULL-org rules after boot.
- Full suite — fix tenancy-schema fallout.
- Commit.

### Task 3: `lib/repo/events.ts` + emitters

**Files:** Create `lib/repo/events.ts`, `tests/events-repo.test.ts`; Modify `lib/delivery.ts`, `lib/repo/payments.ts`, `lib/repo/orders.ts` (one wrapped `emitEvent` each).

- `emitEvent(orgId, input)` → id; `recentEvents`. Emitters wrapped in try/catch — never break the host flow.
- Tests: `emitEvent` writes a row read back by `recentEvents`; a `recordDelivery` fail path leaves a `delivery.failed` event; `recordPayment` leaves `payment.recorded`; filtering by `kind` + `since` works.
- Commit.

### Task 4: `lib/repo/rules.ts` — `runEventRules` + `runSweepRules` + escalation

**Files:** Create `lib/repo/rules.ts`, `tests/rules-repo.test.ts`.

- `rulesFor`, `runEventRules(orgId, event)`, `runSweepRules(orgId, asOf)`, `escalateStaleRuns(orgId, asOf)`, `resolveRuleRunsFor(orgId, entity_type, entity_id)`.
- The sweep queries: pending `credit_approvals` > 60 min; `expiringBatches` with stock; a customer with no order in > 2× mean interval; a `SAMPLE` CLOSED > 3 d with no later order.
- Tests: emit `delivery.failed` for order X → `runEventRules` creates a `group_manager` task and a `rule_runs` row; a second `delivery.failed` for X inside cooldown → nothing new; after `cooldown_until` → fires again; `runSweepRules` with a pending 90-min-old approval → a critical alert + a manager task; `escalateStaleRuns` past the window re-assigns the task to an owner and stamps `escalated_at`; `resolveRuleRunsFor` closes the run so a later sweep re-fires.
- Commit.

### Task 5: `lib/repo/tasks.ts` + `lib/repo/alerts.ts`

**Files:** Create `lib/repo/tasks.ts`, `lib/repo/alerts.ts`, `tests/tasks-alerts-repo.test.ts`.

- `createTask`, `listTasks`, `completeTask` (→ `resolveRuleRunsFor`), `dismissTask`; `raiseAlert`, `listAlerts`, `resolveAlert`.
- Tests: create + list scoped by assignee / role / status; `completeTask` stamps `done_at` + status + resolves any linked `rule_runs`; `raiseAlert` + `resolveAlert`; cross-tenant `completeTask` → error.
- Commit.

### Task 6: `lib/repo/targets.ts`

**Files:** Create `lib/repo/targets.ts`, `tests/targets-repo.test.ts`.

- `setTarget` (upsert on the UNIQUE), `listTargets(orgId, period)`, `targetProgress(orgId, {user_id?, group_id?, period, metric})` — actual from delivered-order revenue / kg / count over the Jalali month.
- Tests: `setTarget` then `setTarget` again = one row updated; `targetProgress` for a salesperson with 2 delivered orders totalling 30 000 against a 100 000 target → `{target:100000, actual:30000, fraction:0.3}`; an unknown period → actual 0.
- Commit.

### Task 7: `lib/repo/briefing.ts` — `todayFor(session)`

**Files:** Create `lib/repo/briefing.ts`, `tests/briefing-repo.test.ts`.

- `todayFor(session)` → `{role, panels}` per spec §5, each panel capped at 5 + `more`. Every item has an `href` or `action`.
- Tests: a salesperson session → panels include `open_tasks` (populated from a seeded task) and `target` (from a seeded target); a driver session with a run today → a `today_run` panel with the right stop count and a `retry` panel listing yesterday's failure; a group_manager session → `credit_waiting` from a pending approval and `unplanned` from a CONFIRMED order with no stop; a panel with zero actionable items is absent.
- Commit.

### Task 8: API routes

**Files:** Create `app/api/today/route.ts`, `app/api/tasks/route.ts`, `app/api/tasks/[id]/route.ts`, `app/api/alerts/route.ts`, `app/api/targets/route.ts`, `app/api/rules/route.ts`, `app/api/rules/run/route.ts`; Modify `proxy.ts`; Create `tests/api/spine-route.test.ts`.

- Per spec §6. `npx next typegen`.
- Tests: `GET /api/today` for a driver → 200 with panels; `POST /api/tasks` then `PATCH /api/tasks/[id]` with an outcome → done; `GET /api/alerts?open=1`; `PATCH` resolve; `POST /api/rules/run` → runs the sweep (200, a count); a salesperson `POST /api/targets` → 403.
- Commit.

### Task 9: `/today` UI

**Files:** Create `app/today/page.tsx`, `components/today/Briefing.tsx`, `components/today/TaskRow.tsx`; Modify `app/page.tsx` (redirect a logged-in non-platform user to `/today`), `app/sales/layout.tsx` (nav tab «امروز»), `app/driver/page.tsx` (a link to `/today`).
- `Briefing` renders `panels`; `TaskRow` has the outcome buttons → `PATCH /api/tasks/[id]`. Mobile-first, capped, no horizontal scroll. `tsc` + `eslint` clean.
- Commit.

### Task 10: tenancy, real-data check, handoff

**Files:** Modify `tests/helpers/twoOrgs.ts`, `tests/tenancy-isolation.test.ts`, `docs/crm-erp-plan.md`; Create `tests/spine-migration-realdata.test.ts`, `docs/HANDOFF-2026-09-02-phase-7-spine.md`; update memory.

- `twoOrgs`: `OrgFixture` += `taskId`, `alertId`; seed a `tasks` + `alerts` + `targets` + tenant `rules` row per org.
- `tenancy-isolation`: none leak; NULL-org default rules shared.
- Real-data test per spec §9.
- Full suite, `tsc`, `eslint app/ lib/`. Plan doc row 7 → ✅ DONE. Handoff. Memory.
- Commit.
