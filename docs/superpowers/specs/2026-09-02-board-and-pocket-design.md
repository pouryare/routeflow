# RouteFlow — Board &amp; Pocket — Design

**Date:** 2026-09-02 · **Branch:** `board-and-pocket` (off the current phase tip) · **Status:** design.

Two new views on the Phase 7 `tasks` spine, for the کارگاه (`/sales`) section:

- **Pocket** (`/sales/pocket`) — a member's personal home. 4 quick actions, 4 gradient stat tiles, their own open tasks grouped *today* / *this week*. Role-scoped: a member sees their own, a manager sees their team (tap a name to scope), an owner sees all.
- **Board** (`/sales/board`) — a manager task board. One set of tasks, **three synced lenses** (status / time / workflow). Desktop = pointer drag between lanes (the `OrderPipeline` pattern); mobile = lane pager or stacked accordion, move via a bottom sheet.

Both read and write the same `tasks` rows, so counts and columns never drift. A **reminder** is a `tasks` row with `kind='reminder'`; adding one from a customer sheet is the same write and shows in both surfaces. **Recurring** tasks ("find a new client in Tehran district 4 every Monday") are spawned by a new sweep on the existing `/api/rules/run` hook — no new scheduler.

No external service. Lane↔field mapping and recurrence matching are pure and TDD'd.

---

## 1. Schema

Additive only. One new table, two guarded `ADD COLUMN`s, one backfill.

```sql
-- tasks: one nullable column. NULL stage ⇒ derive from status in the workflow lens.
ALTER TABLE tasks ADD COLUMN stage TEXT;          -- per-kind pipeline stage (see §2)

-- users: one nullable JSON blob for per-member UI prefs. "Remembered per member"
-- means it follows them across devices, so it is server-side, not localStorage.
ALTER TABLE users ADD COLUMN prefs_json TEXT;     -- { board_mobile_mode, board_default_view }

CREATE TABLE task_recurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL,                              -- 'outreach' | 'visit' | 'admin' | …
  assignee_user_id INTEGER REFERENCES users(id),  -- NULL ⇒ use role_hint
  role_hint TEXT,
  group_id INTEGER REFERENCES groups(id),
  entity_type TEXT, entity_id INTEGER,            -- e.g. a district
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('CRITICAL','HIGH','NORMAL','LOW')),
  rrule TEXT NOT NULL,                             -- 'daily' | 'weekly:sat|sun|mon|tue|wed|thu|fri' | 'monthly:<1-28>'
  active INTEGER NOT NULL DEFAULT 1,
  last_spawned_on TEXT,                            -- Jalali 'YYYY-MM-DD' of the last spawn; dedupe key
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_task_recurrences_active ON task_recurrences(organization_id, active);
```

`TENANT_TABLES` += `task_recurrences`. `stage` / `prefs_json` are columns on already-listed tables.

**`kind` vocabulary** (still free TEXT — no CHECK, as Phase 7 left it). Recognised values:
`reminder` · `note` · `outreach` · `order` · `visit` · `admin` · `generic` (plus whatever Phase 7 rules already emit). The workflow lens knows pipelines for **`outreach` / `order` / `visit`**; every other kind falls back to the status columns.

**Stages** (`tasks.stage`), per kind:

| kind | stages (order = pipeline) |
|---|---|
| `outreach` | `call` → `waiting` → `scheduled` → `done` |
| `order` | `pending` → `ready` → `transit` → `delivered` |
| `visit` | `plan` → `enroute` → `done` |
| others | — (no stage; workflow lens shows them under status) |

**Backfill** (`app_meta` marker `board_pocket_reminders_folded`): copy every `reminders` row into `tasks` as `kind='reminder'`, `entity_type='customer'`, `entity_id=reminders.entity_id` (only the `entity_type='customer'` ones; district reminders stay on the map), `due_at=reminders.due_date`, `status = resolved ? 'done' : 'open'`, `created_at` preserved, `organization_id` resolved via the customer. The `reminders` table and `/api/reminders` stay for the map's district reminders; `AddReminder` on customers switches to `POST /api/tasks` (§5).

---

## 2. Lenses — `lib/tasks/lenses.ts` (pure, tested)

The single place the three board views are defined. No SQL, no DB.

```ts
export type BoardView = "status" | "time" | "workflow";
export interface Lane { id: string; label: string }

export function lanesFor(view: BoardView, kind?: string): Lane[];
//  status  → [open, in_progress, done]
//  time    → [backlog, today, week, done]
//  workflow→ STAGES[kind] ?? status lanes

export function laneOf(task: TaskLensFields, view: BoardView, nowIso: string): string;
//  status  → task.status
//  time    → task.status==='done' ? 'done' : bucket(task.due_at, nowIso)   // backlog|today|week
//  workflow→ task.stage ?? stageFromStatus(task.kind, task.status)

/** The one authoritative "what does dropping this card in this lane mean" function.
 *  Returns the field patch to persist; the API and any test call this, never the client. */
export function movePatch(
  task: TaskLensFields, view: BoardView, toLane: string, nowIso: string
): { status?: string; due_at?: string | null; stage?: string | null };
//  status  → { status: toLane, stage: stageFromStatus(kind, toLane) }
//  time    → toLane==='done' ? { status:'done' } : { due_at: dateForBucket(toLane, nowIso), status: task.status==='done' ? 'in_progress' : task.status }
//  workflow→ { stage: toLane, status: statusFromStage(kind, toLane) }   // first→open, last→done, mid→in_progress

export function stageFromStatus(kind: string, status: string): string | null;
export function statusFromStage(kind: string, stage: string): string;
```

`bucket(due_at, now)` → `backlog` if `due_at` is `null` or later than this Jalali week; `today` if `due_at` ≤ today; `week` if `due_at` is within the rest of the current Jalali week. `dateForBucket('today')` = today ISO; `'week'` = last day of this Jalali week; `'backlog'` = `null`.

## 3. Recurrence — `lib/tasks/recurrence.ts` (pure) + sweep in `lib/repo/rules.ts`

```ts
export function rruleMatches(rrule: string, jalaliDate: string): boolean;   // 'weekly:mon' etc.
```

`spawnRecurringTasks(orgId, asOfIso)` in `lib/repo/rules.ts` (tested): for each active `task_recurrences` where `rruleMatches(rrule, todayJalali)` and `last_spawned_on !== todayJalali` → `createTask(...)` with `due_at = today`, stamp `last_spawned_on`. Called from `runSweepRules` (so `POST /api/rules/run` — the existing cron hook — picks it up). Idempotent by `last_spawned_on`.

## 4. Repos

- **`lib/repo/pocket.ts`** (tested) — `pocketFor(session, { scopeUserId?, nowIso })` → `{ scope, tiles, today, week, done }`.
  - `scopeUserId` honoured only if the target is in the caller's reach — their group scope for a `group_manager` / `rep_manager`, anyone for `owner` / `platform_owner` (a `canReachUser` helper alongside the existing `canReachGroup` / `canReachEntity` in `lib/session.ts`); else 404-style empty. Default = `session.user.id`.
  - `tiles`: `reminders_today`, `tasks_today`, `orders_open`, `visits_week` — each `{ n, hint }` (hint = a sub-count string, e.g. «۲ سررسیدشده»).
  - `today` / `week` / `done`: `TaskCard[]` (`{ id, kind, title, status, stage, due_at, priority, customer?: {id,name}, assignee?: {id,name}, recur? }`), ordered by priority then `due_at`.
- **`lib/repo/board.ts`** (tested) — `boardFor(session, { view, kind?, scope?, groupId?, nowIso })` → `{ view, lanes: { id, label, cards: TaskCard[], total }[], hiddenCount }`.
  - Visibility: `salesperson` / `driver` never reach it (route + `proxy.ts`). `group_manager` → `groupFilter()` on their group. `rep_manager` → tasks whose `assignee_user_id` / `entity` is in their reps' scope. `owner` / `platform_owner` → all, optional `groupId` filter. Reuses `scopeGroupIds()` / `groupFilter()` / `entityGroupFilter()` / `orgFilter()` from `lib/session.ts`.
  - `workflow` view: filters to `kind`, `hiddenCount` = tasks of other kinds in scope.
  - Lane assignment is `laneOf(...)` from §2; nothing view-specific lives here.
- **`lib/repo/tasks.ts`** (extend) — `moveTask(orgId, id, { view, toLane, actor, nowIso })`: load the task, `movePatch(...)`, apply via `tasksRepo.patch`, and when the patch closes it (`status→done`) run the existing `completeTask` path (stamps `done_at`, `resolveRuleRunsFor`) — optionally with an `outcome_code` (see §5). `listTasks` gains `stage` in its projection.
- **`lib/repo/taskRecurrences.ts`** (tested) — `makeRepo("task_recurrences", { tenant:true })` + `list`, `create`, `patch`, `remove`.
- **`lib/repo/prefs.ts`** (tested) — `getPrefs(userId)` / `setPrefs(userId, partial)` — merge-patch the `users.prefs_json` blob; unknown keys rejected. Keys: `board_mobile_mode: 'pager'|'stack'`, `board_default_view: BoardView`.

## 5. API

| route | method | notes |
|---|---|---|
| `/api/pocket` | GET `?user_id=` | `pocketFor(session, …)`. `user_id` requires reach. |
| `/api/board` | GET `?view=&kind=&group_id=` | `boardFor(session, …)`. Manager/owner only. |
| `/api/tasks` | GET (extend), POST (extend) | POST body gains `kind`, `stage?`, `entity_type/id?`, nullable `due_at` (a `note` has none). |
| `/api/tasks/[id]/move` | PATCH `{ view, to_lane }` | the only lane-move endpoint; calls `moveTask`. Returns the updated `TaskCard`. |
| `/api/tasks/[id]` | PATCH (unchanged) | still `{ status, outcome_code?, outcome_note? }` for the outcome-chip close. |
| `/api/task-recurrences` | GET, POST | owner / group_manager / rep_manager. |
| `/api/task-recurrences/[id]` | PATCH, DELETE | `{ active?, rrule?, title?, … }`. |
| `/api/prefs` | GET, PATCH `{ board_mobile_mode?, board_default_view? }` | self only. |
| `/api/rules/run` | POST (unchanged hook) | now also runs `spawnRecurringTasks`. |

`proxy.ts`: `/api/pocket`, `/api/tasks*`, `/api/prefs` → any authenticated non-platform role (each scopes by session). `/api/board`, `/api/task-recurrences*` → `owner` / `group_manager` / `rep_manager` / `platform_owner`.

**Closing a card.** When a move sets `status → done` (the `done` lane in status/time, the last stage in workflow) and the task has no `outcome_code` yet, the card shows the existing `TaskRow` outcome chips inline (`تماس شد` / `خرید کرد` / `قیمت` / `رد کرد` / حذف); the chip fires `PATCH /api/tasks/[id]` and may return a Phase 8 objection card. A task already closed, or one whose `kind` is `note` / `admin`, closes without a prompt.

## 6. UI — two new `/sales` tabs, کارگاه dark skin

Both are Server Components that call the repos directly, pass `plain(...)` rows to a `"use client"` child, and refresh via `router.refresh()` after a mutation. Add two entries to the `tabs` array in `app/sales/layout.tsx` (`ready`-gated by role: Board hidden for `salesperson` / `driver`).

### `/sales/pocket` — `components/pocket/Pocket.tsx`
- Top bar (`.top`): the member's mark + «امروز — <name>» + Jalali date; the existing `/sales` chrome (theme toggle, «نقشه»).
- Role `.seg`: `فروشنده` / `مدیر گروه` / `مالک` (only the roles the viewer actually has; a plain `salesperson` sees no switch). Manager/owner → a horizontal **team strip** of `teamchip`s (avatar + name + open-count); tapping one re-fetches `/api/pocket?user_id=`.
- **4 actions** (`.btn`): `+ یادآوری` `+ یادداشت` `+ سفارش` `+ بازدید`. `یادآوری` / `یادداشت` open a small inline form (date + text; `یادداشت` has no date → `kind='note'`, `due_at=null`); `سفارش` / `بازدید` deep-link to the existing flows with the task pre-attached.
- **4 tiles** — `.statrow` of 4 `.gcard`s (`sand` / `mint` / `peach` / `sky` washes, `.k` label, `.v` count, `.d` hint chip, `.ico` glyph): یادآوری‌های امروز · کارهای امروز · سفارش‌های باز · بازدیدهای این هفته.
- **List** — one `.kblock`: groups «امروز» / «این هفته» / «انجام‌شده», each row = kind dot + title + `.pill` (due/status) + customer name (a `<button>` → customer modal, §7) + amount for orders.

### `/sales/board` — `components/board/Board.tsx`
- Toolbar: view `.seg` (`وضعیت` / `زمان` / `گردش‌کار`, default from `prefs.board_default_view`); when `گردش‌کار`, a kind-chip row (`پیگیری تماس` / `سفارش` / `بازدید`) + a muted «N کار از نوع‌های دیگر پنهان است».
- **Desktop** (`pointer:fine`): `.board` of `.col` lanes; `.task` cards with pointer-drag (threshold 6px, drag ghost, `elementFromPoint` → `.col.over` = accent-soft dashed, 60ms click-guard) — reuse the mechanics already in `components/sales/OrderPipeline.tsx` (extract the shared bits into `components/board/useCardDrag.ts`). Drop → `PATCH /api/tasks/[id]/move`. The `⋯` menu (target-lane list) is the keyboard path.
- **Mobile** (`pointer:coarse` or width ≤ 620px): honour `prefs.board_mobile_mode` —
  - `pager` (default): one lane full-width, a segmented lane control + dots; card `⋯ → انتقال` opens a bottom sheet (`useSwipeDismiss`) listing target lanes.
  - `stack`: lanes as a vertical accordion, one open at a time; same انتقال sheet.
  - A one-line toggle at the top writes `PATCH /api/prefs`.
- Card: kind label + priority dot, title (2-line clamp), amount (orders, `.mono` tabular), assignee avatar, customer button, recurring `↺` badge.
- `.synclog` line after a move: «کارت «…» — <change> · در هر سه نما و پاکت همگام شد».

### Customer link
Every customer name on either surface is a `<button>` opening the existing customer detail — reuse `components/kargah/CustomerSheet.tsx` (fed by `/api/sales/customers/[id]/summary`), which already renders lifecycle, debt tier, purchase summary, and an `AddReminder` that now posts `kind='reminder'`.

## 7. Tenancy

One new tenant table (`task_recurrences`). `twoOrgs` seeds one `task_recurrences` row per org; `tenancy-isolation` asserts no `pocket` / `board` / recurrence row crosses orgs, and that `spawnRecurringTasks` only touches its own org. `stage` / `prefs_json` add no cross-tenant surface (`prefs_json` is per-user).

## 8. Migration safety

`tests/board-pocket-migration-realdata.test.ts` (env-gated, against the real backup):
- `foreign_key_check` empty; `task_recurrences` exists and empty; `tasks.stage` / `users.prefs_json` exist and are `NULL` on every existing row.
- The `reminders → tasks` backfill: every `entity_type='customer'` reminder now has exactly one matching `tasks` row (`kind='reminder'`), counts equal, `due_at` / `created_at` preserved, `organization_id` matches the customer's; district reminders untouched; re-running the migration is a no-op (`app_meta` marker).

## 9. Deviations / decisions

- **Reuses the Phase 7 spine wholesale.** No new `tasks` columns beyond `stage`; `kind` stays free TEXT; `role_hint` / `assignee_user_id` / `group_id` / `entity_type` already carry scoping. New work is three pure modules, four repos, seven routes, two pages.
- **`stage` is nullable and derived when absent** — a task created before this feature, or by a Phase 7 rule, still lands in the right workflow lane via `stageFromStatus`. Writing a stage back on any move keeps it accurate thereafter.
- **Workflow pipelines: `outreach` / `order` / `visit` only** (confirmed). Every other kind shows under the status columns in the workflow lens — no per-kind config screen.
- **Recurrence is a table + a sweep, not a cron and not a full RRULE.** `rrule` is one of three shapes (`daily`, `weekly:<day>`, `monthly:<dom>`); anything more becomes a Phase 7 `rules` sweep query instead. Reuses `POST /api/rules/run`.
- **`prefs_json` on `users`, not a `user_prefs` table** — matches the repo's inline-migration style; one blob, merge-patched, unknown keys rejected. `board_mobile_mode` also cached in `localStorage` for first paint, server is the source of truth.
- **Pocket is a new `/sales/pocket` tab, not a rewrite of `/today`.** `/today` stays the cross-role post-login briefing; for a member it can link to `/sales/pocket`. The Pocket is the کارگاه-chrome, board-synced version.
- **Note attachment is optional.** `kind='note'` with `entity_type`/`entity_id` nullable and `due_at` null: standalone from the Pocket, auto-linked when created from a customer sheet.
- **Old `reminders` table kept** for district (map) reminders; customer reminders migrate and route through `tasks`.
- **Out of scope:** snooze/defer on reminders (use `due_at`), a recurrence editor richer than the three shapes, per-column WIP limits, board for `salesperson` / `driver`, real-time multi-user board sync (each client `router.refresh()`s after its own move, same as `OrderPipeline` today).

## 10. Open for review

1. **Board scope for `group_manager` vs `rep_manager`** — this spec gives them one `/sales/board` with a role-derived default filter (group vs reps) and an owner-only group picker. Acceptable, or separate boards?
2. **`+ یادداشت` from the Pocket** — spec allows standalone notes. If every note must hang off a customer, say so and the Pocket action becomes "pick a customer first".
3. **Mobile pref** — server-side per user (`prefs_json`) so it follows the member across devices. If per-browser is fine, drop the `users` column and keep only `localStorage`.
