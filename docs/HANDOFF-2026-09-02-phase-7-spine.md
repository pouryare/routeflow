# RouteFlow Phase 7 (Spine + briefing — M8) — Handoff

**Date:** 2026-09-02 · **Branch:** `phase-7-spine` (off `phase-6-weather`) · **Status:** code-complete, unmerged.

Spec: `docs/superpowers/specs/2026-09-02-phase-7-spine-design.md` · Plan: `docs/superpowers/plans/2026-09-02-phase-7-spine.md` (10 tasks, done).

## What shipped

| Area | Detail |
|---|---|
| `lib/rules/engine.ts` | Pure: `evaluateConditions` (flat AND of `{field,op,value}`, dotted paths, `eq/ne/gt/gte/lt/lte/in/exists`), `cooldownUntil`, `isEscalatable`. |
| Schema | `events` (generic append-only fact bus, **no FK on any reference** — it must outlive the rows it names), `tasks` (`priority`/`status` CHECKs, `outcome_code` for the academy hook), `alerts` (`severity` CHECK), `rules` (`trigger_kind` = an `event.kind` or `'sweep'`, `condition_json`, `action_kind` task/alert, `cooldown_min`, `escalate_after_min`/`_to_role`; `organization_id NULL` = a shipped default), `rule_runs` (per-rule-per-entity firing record + cooldown + escalation state), `targets` (`metric` CHECK). All six on `TENANT_TABLES`; `rules` gets the `reason_codes` treatment (NULL→1 sweeps + `tenancy-schema` no-NULL check skip it). `seedRules` plants 5 defaults. |
| `lib/repo/events.ts` | `emitEvent` / `tryEmitEvent` (never throws) / `recentEvents`. Emitters wired one-liner into `advanceOrder` (`order.<action>` mirror), `recordPayment` (`payment.recorded`), `recordDelivery`'s fail path (`delivery.failed`). |
| `lib/repo/rules.ts` | `rulesFor` (tenant ∪ default, tenant wins per code), `runEventRules(orgId, event)` (kind match → live-run cooldown guard → `evaluateConditions` → fire a task/alert + a `rule_runs` row), `runSweepRules(orgId, asOf)` (dedicated queries: pending `credit_approvals` > 60 min, `expiring_batch` within 14 days with stock, `customer_overdue` at > 2× mean interval, `sample_followup` for a SAMPLE CLOSED > 3 d with no later sale), `escalateStaleRuns` (past the window → re-assign the linked task to an `escalate_to_role` user, bump to CRITICAL, stamp `escalated_at`), `resolveRuleRunsFor` (close runs so the rule can fire again), `setTenantRuleOverride`. |
| `lib/repo/tasks.ts` / `alerts.ts` | `createTask` / `listTasks` (priority-ordered) / `completeTask` (stamps `outcome_code`/`outcome_note`, resolves linked `rule_runs`) / `dismissTask`; `raiseAlert` / `listAlerts` (severity-ordered) / `resolveAlert`. |
| `lib/repo/targets.ts` | `setTarget` (find-or-update by exact scope — the table `UNIQUE` does not bite a NULL `user_id`/`group_id`, so uniqueness is enforced in code), `listTargets`, `targetProgress` (delivered revenue / kg / order count over the Jalali `YYYY-MM` period vs the target). |
| `lib/repo/briefing.ts` | `todayFor(session)` → `{role, panels}`, each panel capped at 5 + `more`, every item carrying an `href` or an `action`, a panel with nothing actionable omitted. Branches: **salesperson** `open_tasks` / `call_list` / `target`; **driver** `today_run` / `weather` (from the run's frozen `weather_json`) / `retry` (yesterday's `DELIVERY_FAILED`); **group_manager/owner** `orders_by_state` / `credit_waiting` / `unplanned` / `exceptions`; **rep_manager** `reps_by_stage`. |
| API | `GET /api/today`; `/api/tasks` GET (`?mine=1&role=&status=`) + POST, `PATCH /api/tasks/[id]` (`{status:'done'|'dismissed', outcome_code?, outcome_note?}`); `/api/alerts` GET (`?open=1`) + PATCH (`{id, resolve:true}`); `/api/targets` GET/POST; `/api/rules` GET + PATCH (`{code, active?, cooldown_min?}` → tenant override); `POST /api/rules/run` (sweep + escalate hook). `proxy.ts`: `/today` + `/api/tasks` reachable by a driver; `/api/targets` + `/api/rules` manager-gated. |
| UI | `/today` + `Briefing` (renders the panels) + `TaskRow` (outcome-code buttons → `PATCH /api/tasks/[id]`). `/` now redirects a logged-in non-platform user to `/today` (driver → `/driver`, platform_owner → `/platform`). «امروز» is the first sales nav tab; the driver header links to it. |
| Tenancy | `twoOrgs` seeds a `tasks` + `alerts` + `targets` + a tenant `rules` (`SHARED-RULE`) row per org; `tenancy-isolation` asserts none leak and the 5 default rules stay shared. |

Suite: 170 files / 1479 tests green (+1 skipped). `tsc` + `eslint app/ lib/` clean. Real-data check passed: FK check clean, six tables present, five default rules, everything else empty.

## Deviations from the plan

- **`events` has NO foreign keys** on `organization_id` / `actor_user_id` / entity refs — an append-only bus must survive the deletion of the rows it mentions, and (practically) the FKs made every test that hand-seeds a not-yet-created org fail on `beforeEach` cleanup ordering.
- **The sweep is `runSweepRules` + `/api/rules/run`, not a running scheduler** — a real cron (or a boot-time interval) calls the endpoint. Same pattern as Phase 5's `runsNeedingFreeze`.
- **`condition_json` is a flat AND list** — a rule needing nested logic gets a dedicated sweep query in `runSweepRules` instead. The four seeded sweep rules all use bespoke queries; `condition_json` is exercised by the event-triggered path and the tests.
- **`targets` uniqueness is enforced in `setTarget`, not by the `UNIQUE`** — SQLite treats NULL as distinct, and a target is user XOR group (one of them NULL).
- **`/today` panels for `rep_manager` / `platform_owner` are minimal** — `reps_by_stage` only for the former, nothing bespoke for the latter (it redirects to `/platform`). Fleshing these out is a small follow-up; the six-role skeleton and the two hard rules (actionable-only, capped) are in place.

## Pre-deploy checklist (after Phase 10, with the whole branch stack)

1. Fresh backup via the SQLite backup API.
2. `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/spine-migration-realdata …` — FK check empty, six tables present, five default rules, rest empty.
3. `npm run build` + `systemctl restart routeflow`.
4. Wire a scheduler (cron, or a `setInterval` in an admin process) to `POST /api/rules/run` per tenant every ~15 min. Confirm a seeded pending credit approval raises a critical alert and a manager task after an hour, and escalates to the owner after four.
5. Set real `targets` for the current period so the salesperson / manager briefing target panels populate.

## Next: Phase 8 — Reps + academy

Per `docs/crm-erp-plan.md` §4.4: `/reps` tab (rep health, onboarding, stages — much of `representative_profiles` + the onboarding machine landed in Phase 0b), and `/academy` (modules 1–2 + the objection library, cards keyed to the `tasks.outcome_code` a salesperson picked here in Phase 7). The academy content is ~440k chars to author/chunk — this phase ships the schema (`lesson_progress`, `objection_cards`), the MDX skeleton under `content/academy/`, and the wiring from `outcome_code` → the matching card; the full content is a documented backlog item. Branch off `phase-7-spine`.
