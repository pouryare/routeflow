# RouteFlow Board &amp; Pocket — Handoff

**Date:** 2026-09-02 · **Branch:** `board-and-pocket` (off `main`) · **Status:** ✅ merged to `main` (fast-forward, 17 commits) and deployed live 2026-09-02.

**Deploy record (2026-09-02):** pre-deploy backup `data/backups/pre-board-pocket-deploy-20260902-181705.db` (via `db.serialize()`, not `cp`). Full suite green on the merged `main` (216 files / 1692 passed / 1 skipped, `tsc --noEmit` clean). Real-data migration check passed against a copy of the live DB. `npm run build` clean (`/sales/pocket`, `/sales/tasks`, `/api/tasks/[id]/move` in the route list). `systemctl restart routeflow` — service `active`, `NRestarts=0`. Live DB migrated on service start: `tasks.stage` + `tasks.started_at` + `users.prefs_json` added, `task_recurrences` created, `board_pocket_reminders_folded` marker set, FK check clean, 0 reminders to fold (live `reminders` table was already empty). `https://map.pouryarezaee.com` serves the new routes (307 → login when unauthed; a 404 would have meant a stale build). **Still outstanding:** the browser click-through in step 4 below — not runnable headless.

Spec: `docs/superpowers/specs/2026-09-02-board-and-pocket-design.md` · Plan: `docs/superpowers/plans/2026-09-02-board-and-pocket.md` (18 tasks, done).

**Post-deploy follow-ups (2026-09-02, all on `main`, deployed):**

| Commit | What |
|---|---|
| `32579ae` | `/sales/pocket` 500 — `pocketTeam()` handed node:sqlite rows (null prototype) to a Client Component; wrapped in `plain()`. `/sales/schedule` 500 (pre-existing, owner-only) — `groupFilter(session)` emits unqualified `organization_id` and the runs query joins `users`; call `groupFilter(session, "r.group_id")`. Hardened the spine/analysis/prediction migration-realdata tests (they asserted their phase's tables empty after migrating the newest backup — false once a current prod backup lands in `data/backups/`; now compare pre/post row counts). |
| `a2532ea` | `/today` is now a first-class `/sales` tab at `/sales/today` (kargah chrome + travelling pill, `Briefing` gained a `variant="kargah"`). The bare `/today` still serves the driver's briefing; everyone else redirects. `app/page.tsx` post-login → `/sales/today`. |
| `e2390d7` | `scripts/seed-demo.mjs` enrichment: monthly targets, ~19 Board/Pocket tasks (every kind/stage/lane), 4 recurrences, 5 more delivery runs, cheques in every state, quality complaints, a pending credit approval, academy progress — all idempotent. `--remove` rewritten to run with FK off + assert `foreign_key_check` clean before commit (the old teardown orphaned rows against a DB with real delivery/batch/stock activity). De-flaked `repo-rules-recurring` "weekday" test (derived the day from `getUTCDay()` vs the code's Tehran civil date — failed every evening 20:30–24:00 UTC). |
| `a32195b` | `/sales/academy` 500 — `listObjectionCards()` / `lessonProgress()` returned node:sqlite rows to `<AcademyLibrary>`; only stayed up while `lesson_progress` was empty. `plain()` both. |

Demo data seeded into the live org (`node scripts/seed-demo.mjs --force`, backup `data/backups/pre-demo-seed-20260902-203053.db`), then `rules` / `analysis` / `predict` sweeps run (286 KPI snapshots for `1405-06`). Every `/sales` tab returns 200 for owner / group_manager / salesperson; `/today` + `/driver` for the driver. Clear the demo with `node scripts/seed-demo.mjs --remove`.

Two new views on the Phase 7 `tasks` spine, for the کارگاه (`/sales`) section: a member **Pocket** and a manager task **Board** with three synced lenses.

## What shipped

| Area | Detail |
|---|---|
| Schema | `task_recurrences` (org-scoped template → task on a schedule; `priority` CHECK; `ix_task_recurrences_active`; on `TENANT_TABLES`). Two guarded `ADD COLUMN`s: `tasks.stage` (per-kind workflow stage; NULL = derive) and `tasks.started_at` (the Board's "in progress" marker — see Deviations), `users.prefs_json` (per-member board prefs). `backfillReminderTasks(db)` — marker `board_pocket_reminders_folded` + per-row `NOT EXISTS`, folds every `entity_type='customer'` reminder into `tasks` as `kind='reminder'` (org/group from the customer, `resolved → done`). District reminders stay on the map. |
| `lib/tasks/lenses.ts` (pure) | The single definition of the three views + `movePatch` (lane drop → field patch). `lanesFor` / `laneOf` / `deriveStage` / `stageFromStatus` / `statusFromStage` / `bucket` / `dateForBucket`. `STAGES` pipelines for `outreach` / `order` / `visit`; every other kind falls back to the status lanes in the workflow lens. Jalali week (Sat–Fri) from the Gregorian weekday. |
| `lib/tasks/recurrence.ts` (pure) | `rruleMatches(rrule, jalaliYmd)` — `daily` \| `weekly:<sat..fri>` \| `monthly:<1-28>`. |
| `lib/repo/prefs.ts` | `getPrefs` / `setPrefs` — merge-patch `users.prefs_json`; unknown keys / bad values rejected; corrupt blob → `{}`. Keys `board_mobile_mode`, `board_default_view`. |
| `lib/repo/taskRecurrences.ts` | `listRecurrences` / `createRecurrence` / `patchRecurrence` / `removeRecurrence`, org-scoped, `VALID_RRULE` guard on create + patch. |
| Recurrence sweep | `spawnRecurringTasks(orgId, asOfIso)` in `lib/repo/rules.ts`, called from `runSweepRules` — so `POST /api/rules/run` (the existing cron hook) spawns a task for each active recurrence whose rrule matches today's Jalali date and whose `last_spawned_on` is not today. Idempotent. |
| `lib/repo/tasks.ts` | `moveTask(orgId, id, { view, toLane, actor, nowIso, outcome_code? })` — applies `movePatch`, routes a close through `completeTask` (stamps `done_at`, resolves `rule_runs`) then writes the derived `stage`/`started_at`. `createTask` stamps a default `stage`; `TaskRow` gains `stage` + `started_at`. |
| `lib/repo/taskCard.ts` | `TaskCard` shape + `rowToCard` + `TASK_CARD_SELECT` / `TASK_CARD_JOINS` (customer name, assignee name, `recur` EXISTS). Used by both the Pocket and the Board so the two never drift. |
| `lib/repo/pocket.ts` | `pocketFor(session, { scopeUserId?, nowIso? })` → four `.gcard` tiles (`reminders_today` / `tasks_today` / `orders_open` / `visits_week` with a sub-count hint) + `today` / `week` / `done` cards. Sees the member's own tasks **or** unassigned role-hint tasks in their group (so folded reminders surface). `pocketTeam(session)` → a manager's reports + open counts. `canReachUser` (in `lib/session.ts`): self always; otherwise a management role over their scope — a salesperson/driver reaches only themselves. |
| `lib/repo/board.ts` | `boardFor(session, { view, kind?, groupId?, nowIso? })` → lensed lanes (`{ id, label, cards, total }`) + `hiddenCount`. Scope: `group_manager` = their group's tasks or tasks assigned into it; `rep_manager` = own + tasks on customers they manage as reps; `owner` / `platform_owner` = the whole org, optional `groupId`. Always `organization_id`-bounded. All lane assignment via `lanesFor` + `laneOf` — no view logic in the repo. |
| API | `PATCH /api/tasks/[id]/move { view, to_lane, outcome_code? }` → the moved card. `/api/tasks` POST extended: `stage`, `group_id`, and reminder/note kinds auto-assign to the creator. `GET /api/pocket?user_id=`, `GET /api/board?view=&kind=&group_id=`, `GET/POST /api/task-recurrences` + `[id]` `PATCH/DELETE`, `GET/PATCH /api/prefs`. `proxy.ts`: `isTaskBoard` gates `/sales/tasks` + `/api/board` + `/api/task-recurrences` to owner / group_manager / rep_manager; `/api/pocket` + `/api/prefs` are opener (the route re-checks). |
| UI | **`/sales/pocket`** (`components/pocket/Pocket.tsx` + `QuickAdd.tsx`) — امروز header, manager team strip (scope via `?user_id=`), four gradient tiles, the امروز/این‌هفته/انجام‌شده list, customer names → `CustomerSheet`. **`/sales/tasks`** (`components/board/Board.tsx` + `BoardMobile.tsx` + `useCardDrag.ts`) — three-lens toggle, `.kargah` `.board`/`.col`/`.task` markup, desktop pointer-drag with a ghost + `.over` lane + a `⋯` menu, a sync-log line, `CustomerSheet`. On a phone: a lane pager **or** a vertical accordion (choice persisted via `PATCH /api/prefs`), a card moves through a bottom sheet — no horizontal scroll. Dropping an `outreach` card into a closing lane shows the `OutcomeChips` (extracted from `TaskRow`) inline. `AddReminder` on a customer now posts `kind='reminder'`. Tabs «پاکت» (all) + «تختهٔ کارها» (owner/group_manager/rep_manager). |
| Tenancy | `task_recurrences` on `TENANT_TABLES` (covered by the generic `tenancy-isolation` sweep). `tests/board-pocket-isolation.test.ts` — two orgs via `seedTwoOrgs`: `listRecurrences` / `boardFor` / `pocketFor` / `spawnRecurringTasks` never cross orgs. |

Suite: **green** (`tsc --noEmit` clean, `npm run build` clean). Real-data check (`tests/board-pocket-migration-realdata.test.ts`, against `data/backups/`): FK check empty, `task_recurrences` present + empty, `tasks.stage` / `tasks.started_at` / `users.prefs_json` `NULL` on every existing row, every customer reminder folded 1:1 (`resolved → done`), re-run a no-op.

## Deviations from the plan

- **`tasks.started_at` instead of an `in_progress` status.** Phase 7's `tasks.status` CHECK is `open | done | dismissed` — SQLite cannot `ALTER` a CHECK, and a table rebuild would also change what `listTasks` / the briefing return. So a nullable `started_at` column: a task is "در حال انجام" when `started_at` is set and `status` is still `open`. `listTasks` and the briefing are completely unaffected.
- **`useCardDrag` is a NEW hook; `OrderPipeline.tsx` is untouched.** The plan said to extract the drag mechanics from `OrderPipeline`. That component is MASTER.md-referenced and could not be visually re-verified in this environment, so the hook was written fresh from the same proven pattern (capture-on-card, travel threshold, `elementFromPoint` per move, click-guard). A later cleanup can migrate `OrderPipeline` onto it.
- **Route `[id]` handlers use an explicit `ctx: { params: Promise<{ id: string }> }`** rather than `RouteContext<"…">` — the generated route type does not exist for a brand-new route until a build, and `npx tsc --noEmit` runs first. Matches the precedent in `app/api/driver/stops/[id]/route.ts`.
- **The Board lives at `/sales/tasks`, not `/sales/board`.** `/sales/board` is already the order-assignment board («تخصیص کارها»). New tab label: «تختهٔ کارها».
- **Pages render content only** — `app/sales/layout.tsx` already draws the کارگاه chrome (mark, title, date, skin toggle, tab pill), so the Pocket/Board pages start below the tab pill. No `plain()` wrapper: `rowToCard` rebuilds every row into a fresh literal, so the repo output crosses the server→client boundary as-is.
- **`BoardMobile` bottom sheet is hand-rolled** (scrim + slide-up + Escape) rather than `useSwipeDismiss` — same behaviour, one fewer coupling.
- **Outcome chips gate on `kind === 'outreach'`** — the `OUTCOMES` codes are sales-call outcomes; `order` / `visit` / `note` / `admin` close without a prompt.
- **`recur` on a card is a live `EXISTS` against `task_recurrences` by title** (the spec floated `false` for v1). `task_recurrences` is a handful of rows per org, so the correlated subquery is cheap.
- **In-app visual verification is outstanding.** The UI compiles (`tsc` + `next build`) and rests on the tested repo layer, but a real browser click-through was not possible headless — see the checklist.

## Pre-deploy checklist

Steps 1–3 were run on 2026-09-02 (see the deploy record at the top). Step 4 is the only remaining item.

1. ✅ Fresh backup via the SQLite backup API → `data/backups/pre-board-pocket-deploy-20260902-181705.db`.
2. ✅ `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/board-pocket-migration-realdata.test.ts` — FK check empty, columns/table present and `NULL`/empty, reminders folded 1:1, re-run a no-op.
3. ✅ `npm run build` + `systemctl restart routeflow`.
4. **Browser pass** — NOT yet done (not runnable headless); do this now that it is live:
   - as a **salesperson** — `/sales/pocket`: four tiles with real counts; the امروز/این‌هفته list; a customer name opens the sheet; `+ یادداشت` adds a no-due task; `+ یادآوری` adds a dated one and bumps the tile.
   - as a **group_manager** — `/sales/tasks`: drag a card between lanes (desktop); switch وضعیت / زمان / گردش‌کار; use the `⋯` menu; drop an outreach card into انجام‌شده → the outcome chips appear. The Pocket role/team strip scopes to a report.
   - DevTools device mode ~390 px on `/sales/tasks` — no horizontal scroll; toggle پیمایش / عمودی, reload, the choice persists.
   - `POST /api/rules/run` for the org — a `weekly:<today>` recurrence spawns exactly one task; a second call spawns none.
   - `/api/board` + `/api/task-recurrences` 404/redirect for a salesperson; `/api/pocket?user_id=<someone-else>` for a plain salesperson returns their own pocket.
