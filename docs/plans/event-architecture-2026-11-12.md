# Events, outbox, worker and audit: plan

_Plan, 2026-11-12. Requested by the owner after reviewing a long discussion on audit logs, event-driven design, event sourcing, the transactional outbox, pragmatic DDD and CQRS. The owner asked for everything in the review's «adopt» and «later» lists, and for none of the «skip» list. **Nothing is built yet.** The one question (worker library) is answered: pg-boss (section 9)._

Review note with the full comparison: `notes/event-architecture-review-2026-11-12.md` in the project files.

## 1. The short answer

RouteFlow already has the pieces: an `events` table, a rule engine that reacts to it, `order_events`, append-only `activities`, ledger and stock moves that cannot be edited, an order state machine, a phone outbox, and a live layer that already works as an outbox. What is missing is **three small things and one record**:

1. a clock on the server for the rules sweep (pushes probably do not go out by themselves today);
2. every event written **inside** the save it describes;
3. a background worker for the reactions that can be a few seconds late;
4. the shared «who changed what» record (F27).

Plus a one-page list of event names, and, later, reports built from history.

## 2. The ideas in plain words

| Idea | Plain meaning | RouteFlow example |
|---|---|---|
| Event log | A diary next to the data: what happened, who, when | Order 1042 is `DELIVERED` now; the diary says confirmed 09:20, delivered 14:10 by Ali |
| Outbox | The diary line is saved in the same save as the change, so one never exists without the other; a helper does the reactions later | A call is saved and «lead verified» is saved with it; the manager's push goes out seconds later |
| Worker | The helper that does the reactions | Rules, notices, push, Telegram, SMS, exports |
| Audit record (F27) | One record of old and new values for important fields | Someone changed an order's price after it was confirmed |
| Modules | Each area owns its tables | Only ledger code writes journal lines |

**Rule that stays:** ledger postings, stock reservations and commission stay **inside** the same save as the order or payment (decisions 10.3, microservices row). Only things that can be late go to the worker: notices, push, SMS, Telegram, analytics, exports.

## 3. What exists today (checked in the code, `main` at cd3cd7d)

| Piece | Where | State |
|---|---|---|
| Event bus | `events` table, `emitEvent()` in `lib/repo/events.ts`, about 13 call sites | Works. `emitEvent` inserts, then runs the rule engine in the same call, best effort |
| Rule engine | `lib/repo/rules.ts` (`runEventRules`, `runSweepRules`, `escalateStaleRuns`, `flushAllNotifications`) | Works when called |
| Payments | `lib/repo/payments.ts` emits `payment.recorded` **inside** the save | Right |
| CRM writes | `lib/repo/crm/write.ts` collects events in the save and emits them **after** `db.tx` (`emitAll`) | A crash between save and emit loses the reaction |
| Order steps | `order_events` (one row per move) and `tryEmitEvent("order.<action>")` | Works |
| Live outbox | `live_events` + `rf_live_publish()` + triggers | Works (decisions 10.7) |
| Timers on the server | `deploy/routeflow`: upgrade, storage (jobs, daily, weekly), archive, CDN list, support prune | **No rules timer.** `scripts/run-sweeps.mjs` already has a `rules` entry but nothing calls it |
| Worker | decided in decisions 10.2 (pg-boss), not installed | Missing |
| Audit record | F27 | Not built. The only «who changed what» logs are per feature (`activity_log`, `order_events`, F99, F100, F110) |
| Packaging | release tarball is `.next/standalone` (`next.config.ts`) | A separate worker script cannot import `lib/**` TypeScript without a build step; see E3 |

## 4. The plan: five tasks now, three later

Order matters: E1 is a small fix for the live server; E2 makes events safe; E3 builds on E2; E4 and E5 are independent. One commit per task when built (the batch rule).

### E1. Rules timer (A1)

**Why:** the sweep that creates callback and follow-up tasks, escalates stale ones and **flushes push and Telegram** only runs when someone taps «به‌روزرسانی کارها» on Today (`app/(shell)/sales/today/page.tsx`). Check first on the server: `systemctl list-timers | grep routeflow`.

**What:** `deploy/routeflow` gets `routeflow-rules.service` and `routeflow-rules.timer`, the same shape as `write_storage_timers` (oneshot, `LoadCredentialEncrypted`, `scripts/run-sweeps.mjs rules`), every 5 minutes, `Persistent=false`. Add it to the install and update paths and to the stop/uninstall glob. Nothing in the app changes: `/api/rules/run` already loops every company for a token caller.

**Check:** the installer's own tests if any cover timers; otherwise a text guard like the other deploy guards; a throwaway-VM run of `systemd-analyze verify`.

**Risk:** the morning digest (07:00 Tehran) and quiet hours already use Tehran time; confirm the digest is once-a-day safe when the sweep runs 288 times a day. Cost per sweep on a small company is low; measure the first week.

**Later removed or replaced:** when E3 gives schedules, this timer becomes a worker schedule and the systemd unit is deleted in the same commit.

### E2. Events always inside the save (A2)

**Why:** an event must exist if and only if its change exists.

**What:**
1. Migration: add to `events` the outbox columns `pending` (default false, so old rows and rows from the previous release count as handled), `attempts`, `next_try_at`, `last_error`, and a partial index on `pending`. (Built as `pending`, not `handled_at`, so the migration is expand-only.) Time columns follow the table's existing text ISO style.
2. `emitEvent(org, input, db)` becomes insert only. It no longer runs the rule engine itself.
3. A new `drainEvents(org)` takes unhandled events with `FOR UPDATE SKIP LOCKED`, runs the rule engine for each (`runEventRules`), marks `handled_at`, and on failure records `attempts`, `last_error` and a backoff `next_try_at`. Callers run it right after commit, so reactions are as fast as today.
4. Every call site moves inside its transaction: CRM `emitAll` (the real fix), order moves, impersonation start and end, lead import notify, rules' own sweep events. Payments already are.
5. A leftover event (the process died between commit and drain) is picked up by the next drain: first by E1's 5-minute sweep, later by the worker.
6. The nightly archive moves only **handled** events (`lib/repo/historyArchive.ts`, migration `1762700000000_history-archive.sql`).
7. Event names stay past tense. The list in E5 will show the few that are requests, not facts (`reassign.requested`), and decide each.

**Check:** a test that kills the flow between commit and drain (a call is saved, `lead.verified` exists unhandled, the next drain fires the rule once); a test that a rolled-back save leaves no event; the idempotence test (drain twice, one task).

**Decision inside this task:** rule failures stay best effort and visible: `attempts` and `last_error` count on the status card (E3).

### E3. Background worker (A3)

**Why:** reactions run today while the user waits, and there is no retry, no schedule and no place to see a stuck one. `storage_jobs`, the lead-import runner and a future export job each hand-roll half of a queue.

**Placement (decided by me, small and reversible): inside the app process first.** The release is a `.next/standalone` bundle, and handlers are TypeScript in `lib/repo`; a separate process would need its own build and a second systemd unit. `instrumentation.ts` already resumes lead imports at boot, so the worker starts there (Node runtime only). It can move to its own unit later without changing handlers. Safe with two app servers because jobs are claimed with `SKIP LOCKED`.

**Library: pg-boss (owner, 2026-11-12, section 9).** Facts checked 2026-11-12: version 12.38.2, MIT, last modified 2026-11-10, needs Node 22.12 or newer (the app is on Node 24). It keeps its own `pgboss` schema in our database.

**What:**
1. Jobs: `events.drain` (E2's drain, so a retry is automatic), `rules.sweep` (every 5 minutes, replaces E1's timer), `notifications.flush`; the nightly archive and storage sweeps may move across later, one at a time. Future: exports (E7), SMS (Farazsms), Telegram, statements (F18).
2. Handlers run under `withDbScope("system")` (or the job's company) because there is no session; this keeps row-level security honest.
3. Retries with backoff, a failed job kept 14 days. A card on “وضعیت سامانه” shows queue length, oldest unhandled event, failures in the last day. `/api/health` reports the same two numbers.
4. If the library is pg-boss: create its schema once in a hand-owned migration run by the owner role (the app role `routeflow_app` should not hold CREATE), and start pg-boss with its own migration turned off; verify that option exists in 12.x before building (listed under unverified, section 8). Jobs are queued **in the same transaction** as the write where the job must not be lost (`send` with our transaction handle); otherwise after commit.

**Check:** a job that fails twice then passes; two workers claiming the same queue; a restart in the middle of a job; the health numbers.

### E4. Audit record, first slice of F27 (A4)

**Why:** ten roadmap entries wait on it (F59, F73, F78, F34, F90, F48, F82, F111 and more), and today «who changed this price» has no answer outside the few features with their own log.

**What (first slice only):**
1. Table `audit_log`: company, table, row id, operation, **changed columns only** as old and new (JSON), actor user, `impersonated_by`, time. Append-only (update and delete refused by triggers, like `activities`). Archive twin like the other logs.
2. One generic trigger function, attached to a short list: `orders` (status, totals, price), `order_lines`, `payments`, `customers` (owner, credit limit, group), `users` (role, active), `product_prices`, company settings. The list is a table in the migration, not code in every route.
3. The actor: the pg adapter already sets `rf.scope` per transaction (`lib/database/pg.ts`); it sets `rf.actor` in the same call so no extra round trip. Statements outside a request get `system`.
4. Redaction: cost, margin and credit changes are stored but shown only to roles that can see them (T6).
5. Owner-only read: a history list on the record page («تاریخچه تغییرات») and one list on «وضعیت سامانه», filter by record, person and day. Placement and nav budget are written in the build PR (CLAUDE.md UI rule).

**Not in this slice:** anomaly rules (cancel rate, edit-after-confirm, cash variance), the money hash chain (D6), the permission change log shown on the status page (E6). They sit on top of this record and stay in the roadmap as follow-ups.

**Does not replace** `order_events`, `activities`, F99, F100, F110. Those stay; the merged timelines (FB32, T6) can read from `audit_log` later.

**Check:** a changed price writes one row with old and new; an unchanged update writes nothing; delete and update on `audit_log` fail; the actor is the signed-in person, and `impersonated_by` is filled under Login-As; row-level security hides another company's rows; trigger cost on a bulk update (the live triggers already use a statement-level shape; use the same idea).

### E5. Event list (A5)

**What:** `docs/events.md`: one row per event name, who emits it, who reacts (rule, notification, live, worker), and whether it is a fact or a request. A small Vitest guard reads every `kind:` passed to `emitEvent` and fails when a name is missing from the list, so the list cannot rot.

## 5. Later (in the roadmap, not in this batch)

| ID | What | Starts when |
|---|---|---|
| EV-L1 | **Funnel and speed reports from history.** Leads, contact attempts, conversations, samples, purchases; days from `lead.created` to first order; who calls new leads fastest. `lib/leadStats.ts` counts today's status; this reads `activities` and `events`. First step is checking event coverage: there is no sample-requested or sample-delivered event yet (stock has `SAMPLE_OUT`). No new table | after E2, with the reporting group (F14, F123) |
| EV-L2 | **Who may write which table.** A new metric in `scripts/check-architecture.mjs`: writes to `journals` and `ledger_entries` only from the ledger files, `stock_movements` only from the stock files, `audit_log` and `events` only from their own modules. Starts as a ratchet at today's count (like `rawRoleChecks`), never a rewrite | after E2, as one small PR |
| EV-L3 | **Read tables only when slow.** A new summary table is added only when a screen is measurably slow (the `pg_stat_statements` card exists), refreshed by the worker, following `sales_daily` | when a screen needs it |

### Later queues for the worker (from the second review, 2026-11-12)

A second shared conversation (project note `kafka-rabbitmq-pgextensions-review-2026-11-12.md`) reached the same conclusion: no Kafka or RabbitMQ, PostgreSQL with pg-boss, money writes inside the transaction. It adds these queue ideas. None is built in this batch; each starts with its own roadmap entry.

| Queue idea | Roadmap | Note |
|---|---|---|
| Route optimization (VROOM) for big days only | delivery planner, F7 | Moving one stop stays synchronous; 80 stops across vehicles is a job. Ten quick edits should make one run (pg-boss singleton keys drop duplicates; verify) |
| Cheque and invoice OCR | F1 | Slow and failure-prone, the clearest queue case |
| Photo processing (thumbnail, compression, orphan cleanup) | storages | `storage_jobs` can move onto pg-boss later |
| Bank statement import | F10 | Parse, match, propose, a person reviews exceptions |
| Offline post-sync work (notices, recalculation, conflict analysis) | F13, F105 | The write itself stays synchronous |

**When to split the worker into its own process:** the first time a job is CPU-heavy (OCR, a large export, an 80-stop optimization) and could slow web requests on the same small server. Handlers do not change; the split needs a build step so the worker can import `lib/**`. `pg_cron` and `pgmq` are not adopted: pg-boss already schedules and queues.

## 6. Where it sits on the roadmap

- `docs/roadmap.md` §1 «Platform, security and administration» gets the new group «Events, worker and audit (2026-11-12)» with E1 to E5, EV-L1 to EV-L3.
- F27 moves from «Not built» to «Planned: first slice is E4». Wave 1 (foundations) names E2, E3, E4 together; the «History and audit», «Offline» (one outbox) and «Telegram» (one worker) overlap rows point at them.
- `docs/decisions.md`: new section 10.22 with the adopt, later and skip tables and the money-stays-inside rule; the pg-boss row in 10.2 points to it.
- Issues: opened when the build starts (`docs/github-workflow.md`), one milestone `Events and worker`, labels `area: platform`, E4 also `area: people`.

## 7. UI, tutorials and what's new

E1, E2, E3 and E5 have no screen except the status card. E4 adds the history list and the status-page list. When built: place them in the nav budget, run `scripts/preview.sh` at 390×844 right to left in light and dark, check tutorials (none expected), and add a line to the what's-new notes only for the history list.

## 8. Not verified yet

- Whether pushes really do not go out on the live server (read from the installer; check `systemctl list-timers`).
- pg-boss: a way to run without self-migrating, `send` inside our own transaction, and behaviour with the `routeflow_app` role. To be tested on a throwaway database before E3.
- Cost of the audit trigger on a bulk update.
- Whether the morning digest is safe to call every 5 minutes (it is meant to be once a day).

## 9. Questions

1. **Worker library: answered 2026-11-12, pg-boss** (against a small queue of our own on the `events` table). Recorded in decisions 10.22.

Everything else in this plan is a small, reversible choice made here: worker inside the app process first; E2 before E3 so the worker has safe events to read; audit first slice without anomaly rules.
