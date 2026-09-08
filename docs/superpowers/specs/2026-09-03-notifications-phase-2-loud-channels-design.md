# کارگاه — Notification System Phase 2: Loud Channels, Design

**Date:** 2026-09-03
**Status:** approved design — ready for implementation planning
**Parent:** `docs/superpowers/specs/2026-09-02-notifications-design.md` ("Spec 2 — loud channels"). This doc locks the open decisions, records the code deltas found on `sales-polish` after Phase 1 merged (`a9e534d`), and is the single source for the Phase 2 implementation plan. Read the parent for shared vocabulary (`group_key`, `directedness`, `effectiveRouting`, bundling).

## Goal

Phase 1 shipped the unconditional in-app feed. Phase 2 makes notifications *loud* — Web Push and Telegram — without being noisy: opt-in per type, bundled into one message per flush, muted during quiet hours, edited in place while fresh.

## Decisions locked (brainstorm 2026-09-03)

1. **Telegram transport = long-poll worker.** A standalone `scripts/telegram-poll.mjs` under systemd (mirrors `scripts/run-sweeps.mjs` / `scripts/send-reminder-push.mjs`: config from `process.env` via `EnvironmentFile=`). No public webhook endpoint, no `setWebhook`, no ingress/cert work. The `POST /api/telegram/webhook` route from the parent spec is **not built**.
2. **One plan.** Push targeting + flush pass + quiet hours + Telegram link/send + `/settings/notifications` + `send-reminder-push.mjs` refactor land together in one SDD run.
3. **Types wired:** the 7 Phase-1 types become loud-capable; plus `task.escalated`, `credit_approval.waiting`, `customer.overdue` (triggers exist), `cheque.due_soon` (one small new sweep query), and `reminder.due` (replaces `send-reminder-push.mjs`). **Deferred:** `goal.met`, `lead.assigned` (no `goals`/`leads` tables), and **`stock.low`** — the app has no reorder-point / low-stock-threshold model, only `expiring_batch` (a different concept); wiring it means inventing a threshold, which is its own change.

## Build-on inventory (verified on `sales-polish` @ `a9e534d`)

- `lib/repo/notifications.ts` — Phase 1 module. Exports `groupKeyFor`, `renderNotification`, `recipientsFor`, `fanOutNotifications`, `listNotificationGroups`, `unreadGroupCount`, `markGroupsRead`, `FanoutContext`, `FanoutRule`, `Priority`, `FeedGroup`. `fanOutNotifications` already threads an optional `db?`.
- `lib/repo/rules.ts` — `fire()` has the `notify` branch; `runEventRules` / `fire` thread `db?`. `runSweepRules(orgId, asOfIso)` at line 228 uses a `consider(code, entityType, entityId, ctx)` helper; today's sweep queries: `credit_approval_waiting`, `expiring_batch`, `customer_overdue`, `sample_followup`. `escalateStaleRuns(orgId, asOfIso)` at line 357 reassigns a stale `rule_run`'s task to `escalate_to_role` and bumps priority — this is where `task.escalated` originates.
- `lib/db.ts` — `notification_types` (Phase 1 cols: `id, organization_id, code, name_fa, category, directedness, priority, group_scope, active, created_at, updated_at`; **no** `default_push`/`default_telegram`), `notifications`, `push_subscriptions` (`id, endpoint, p256dh, auth, created_at` — **no `user_id`, no `organization_id`**). `NOTIFICATION_TYPE_SEED` (7 rows), `RULE_SEED` (8 `notify` rows). Idempotent migration style: `CREATE TABLE IF NOT EXISTS` in the `getDb()` `db.exec` block; `ADD COLUMN` via the `PRAGMA table_info` guard; seeds via `INSERT … SELECT … WHERE NOT EXISTS` in a `seed*` fn near `seedRules(db)`.
- `lib/push.ts` — `configureWebPush(): boolean` (false if VAPID env absent) + re-exported `webpush`.
- `scripts/send-reminder-push.mjs` — standalone; broadcasts one push to **every** `push_subscriptions` row when `reminders WHERE resolved=0 AND due_date<=today` is non-empty.
- `scripts/run-sweeps.mjs` — systemd-driven; `POST`s `/api/rules/run` with `x-sweep-token`. `/api/rules/run` loops every org calling `runSweepRules` + `escalateStaleRuns`.
- `.env.local` (gitignored) holds `SESSION_SECRET`, `VAPID_*`, `SWEEP_TOKEN`. Telegram config joins it.
- `components/kargah/ProfileMenu.tsx` — the entry point for a `/settings/notifications` link.
- `components/NotificationToggle.tsx` — subscribe/unsubscribe UI, mounted only in the map's LayersPanel.
- `reminders` table: `id, entity_type IN ('district','customer'), entity_id, due_date, message, resolved, created_at`. **No `organization_id`, no owner column.**
- `cheques` table: `id, organization_id, customer_id, amount_toman, cheque_no, due_date, status IN (…'in_hand','deposited'…), received_by, …`.

## Data model — new

All idempotent; a Phase-2 real-backup migration test (mirrors Phase 1's `notifications-migration-realdata.test.ts`) covers them.

### Column adds

| Column | Notes |
|---|---|
| `notification_types.default_push INTEGER NOT NULL DEFAULT 0` | computed at seed from the routing rule (`directed && priority≥NORMAL` → 1; else 0). Stored for the matrix's "پیش‌فرض" hint and inspectability. |
| `notification_types.default_telegram INTEGER NOT NULL DEFAULT 0` | same value as `default_push` at seed (both loud channels share the default rule). |
| `push_subscriptions.user_id INTEGER` | nullable; `/api/push/subscribe` fills it from the session. Existing rows stay NULL (orphans — never targeted, never broadcast to). No backfill. |
| `users.telegram_chat_id TEXT` | set on link, cleared on disconnect. |
| `users.telegram_link_nonce TEXT` | minted on "connect", consumed by the poll worker, then cleared. |
| `notifications.push_flushed_at TEXT` | nullable; set when this row is included in a successful push send/edit. |
| `notifications.tg_flushed_at TEXT` | nullable; set when this row is included in a successful Telegram send/edit. |

A row is "unflushed for channel C" iff `<C>_flushed_at IS NULL` — a plain indexable predicate, no JSON scan. `notification_deliveries` is the *message* ledger (for the edit-in-place lookup and audit), not the per-row flush state.

### `notification_prefs` — opt-in matrix (sparse)

`user_id INTEGER NOT NULL`, `type_code TEXT NOT NULL`, `channel TEXT NOT NULL CHECK (channel IN ('push','telegram'))`, `enabled INTEGER NOT NULL`, `updated_at TEXT NOT NULL`. PK `(user_id, type_code, channel)`. A row exists only where the user diverged from the default; resetting to default **deletes** the row.

### `notification_channels` — per-user channel state

`user_id INTEGER NOT NULL`, `channel TEXT NOT NULL CHECK (channel IN ('push','telegram'))`, `enabled INTEGER NOT NULL DEFAULT 1` (master switch), `quiet_start TEXT` / `quiet_end TEXT` (`"HH:MM"`; NULL = no quiet hours; seeded default `"21:00"` / `"08:00"` on first write), `critical_breaks_quiet INTEGER NOT NULL DEFAULT 1`, `updated_at TEXT NOT NULL`. PK `(user_id, channel)`. Created lazily on first `PUT`.

Quiet-hours comparison uses the **server's local wall-clock** `HH:MM` (the deploy host runs Iran time; the app is single-region). No per-user timezone in Phase 2 — noted as a known simplification.

### `notification_deliveries` — flush ledger

`id INTEGER PK`, `user_id INTEGER NOT NULL`, `channel TEXT NOT NULL`, `flushed_at TEXT NOT NULL`, `notification_ids_json TEXT NOT NULL` (rows this message covered), `provider_ref TEXT` (web-push `tag` / Telegram `message_id`), `target TEXT` (endpoint or chat id). Index `(user_id, channel, flushed_at)`. Drives bundling, in-place update, and idempotency (a `notifications` row is "unflushed" for a channel iff no `notification_deliveries` row for that user+channel lists its id).

## Components

### `lib/telegram.ts` (new)

Parallel to `lib/push.ts`. `telegramConfigured(): boolean` (false if `TELEGRAM_BOT_TOKEN` unset). `sendTelegram(chatId, text): Promise<{ message_id: number } | null>` and `editTelegram(chatId, messageId, text): Promise<boolean>` — thin `fetch` wrappers over `api.telegram.org/bot<token>/{sendMessage,editMessageText}`, `parse_mode` omitted (plain text), network/HTTP errors swallowed to `null`/`false` (caller logs). No dependency added.

### `scripts/telegram-poll.mjs` (new)

Standalone Node (not Next). Reads `COVERAGE_DB_PATH`, `TELEGRAM_BOT_TOKEN` from `process.env`. Long-poll loop: `getUpdates?offset=<n>&timeout=50`; persists the offset (a `meta`/kv row or a file next to the DB). For each message whose text is `/start <nonce>`: `SELECT id FROM users WHERE telegram_link_nonce = ?`; if found, `UPDATE users SET telegram_chat_id = ?, telegram_link_nonce = NULL`; reply «حساب تلگرام شما به کارگاه متصل شد.» via `sendMessage`. Unknown text → optional one-line help reply, no state change. Exits non-zero and logs if the token is unset. systemd unit `routeflow-telegram.service` (simple, `Restart=always`), documented in the plan; not installed by code.

### `flushNotifications(orgId, asOfIso, db)` in `lib/repo/notifications.ts` (new)

Called once per org from `runSweepRules` (after the existing sweep queries). Steps, per user with ≥1 unflushed row:

1. **Debounce.** `DEBOUNCE_MS = 120_000`. If `max(created_at)` of the user's unflushed rows is younger than now−`DEBOUNCE_MS`, skip this user this tick (let the burst settle).
2. **Per channel** (`push`, `telegram`): gather the user's unflushed rows whose `effectiveRouting(userId, type_code, channel, db)` is on.
   - `effectiveRouting`: `notification_prefs (user, type, channel)` row wins if present; else default = `type.directedness === 'directed' && priorityRank(type.priority) >= priorityRank('NORMAL')`. Then AND `notification_channels.enabled` (default 1 if no row) AND channel connected (`push`: ≥1 `push_subscriptions` row for the user; `telegram`: `users.telegram_chat_id` not null).
3. **Quiet hours.** From `notification_channels` for that channel: if `quiet_start`/`quiet_end` set and `now` (HH:MM, server local) ∈ `[quiet_start, quiet_end)` — with `quiet_start > quiet_end` meaning the window wraps midnight — **hold** the batch, unless `critical_breaks_quiet` and the batch contains a row with `priority === 'CRITICAL'`. Held rows carry to the next tick; they flush on the first tick at/after `quiet_end`.
4. **Compose one message** for the channel's batch, grouped by `group_key`: a Persian summary line per group (`«۳ سفارش جدید»`, `«تحویل ناموفق: مشتری X»`), joined by ` · `, capped (first ~4 groups + «و N مورد دیگر»). URL `/notifications`.
5. **Send or edit in place.** If a `notification_deliveries` row for this `(user, channel)` has `flushed_at` within `EDIT_WINDOW_MS = 600_000` (10 min): reuse it — web-push re-send with the same `tag: "kargah-digest"` (replaces the visible notification); Telegram `editTelegram(chat, provider_ref, text)`. On edit success, **update** that ledger row's `notification_ids_json` + `flushed_at`. Else send fresh (`sendTelegram` / `webpush.sendNotification`) and **insert** a ledger row. `404`/`410` from web-push → `DELETE FROM push_subscriptions WHERE id = ?` (existing pattern).
6. On a successful send/edit, stamp `<channel>_flushed_at = now` on every row covered, and insert/update the `notification_deliveries` row (`notification_ids_json`, `provider_ref`, `flushed_at`). A channel that is off or held leaves its rows' `<channel>_flushed_at` NULL for the next tick; the other channel may still flush the same rows now (the two `flushed_at` columns are independent).

Constants (`DEBOUNCE_MS`, `EDIT_WINDOW_MS`, group cap) are module consts with a one-line rationale comment.

### Push targeting + reminder refactor

- `/api/push/subscribe` (`app/api/push/subscribe/route.ts`): `INSERT … user_id` from `guard.session.user.id`; on the existing endpoint-conflict upsert, set `user_id` too.
- `send-reminder-push.mjs` is **deleted**. Replaced by a `reminder.due` sweep in `runSweepRules`: scan `reminders WHERE resolved = 0 AND due_date <= <today>`; for each, `consider("reminder_due", entity_type, entity_id, …)` → a seeded `notify` rule → `recipientsFor("reminder.due", …)`:
  - `entity_type = 'customer'` → that customer's `salesperson_user_id` (via `customers.id = entity_id`).
  - `entity_type = 'district'` → the district's group manager(s) (`districts.group_id` → `users` with role `group_manager` in that group), or the org's owners if the district has no group.
  - `reminders` has no `organization_id`; resolve the org from the customer/district row and pass it through. A reminder that resolves to no org (orphan) is skipped.
  - `group_scope = type_day`, priority `NORMAL`, directedness `directed`.
  Its systemd timer is retired in favour of the rules sweep timer.

### `/settings/notifications` (new route + page)

- `app/settings/notifications/page.tsx` (+ whatever minimal `app/settings/layout.tsx` the app's conventions want). Linked from `components/kargah/ProfileMenu.tsx`.
- **Per channel:** master switch; quiet-hours start/end time inputs; «اجازه بده هشدارهای بحرانی در ساعات سکوت هم بیایند» checkbox. → `PUT /api/notifications/channels`.
- **Connection state:** push — «متصل» / a "این دستگاه را متصل کن" button (moves `NotificationToggle`'s subscribe logic here); telegram — «متصل» + disconnect, or a "اتصال تلگرام" button that mints a nonce (`POST /api/notifications/telegram-link` → `{ url: "https://t.me/tamino_route_flow_bot?start=<nonce>" }`) and opens it. Channel with absent server config → «در دسترس نیست», controls disabled.
- **The matrix:** `notification_types` (org-effective) grouped by `category`; each row Push + Telegram toggle; the default (`default_push`/`default_telegram`) shown as a hint; a toggle that matches the default deletes any `notification_prefs` row, one that diverges writes it. → `GET` / `PUT /api/notifications/prefs`.
- **`POST /api/notifications/test`** — `{ channel }` → fan out one synthetic `notification` of a `system.test` type to the caller and flush it immediately (bypass debounce for this one), so the user sees it land. Rate-limited (≤1 / 10 s / user).
- RTL, both themes, `prefers-reduced-motion`; reuses `Island`/existing form primitives.
- `NotificationToggle` in `CoverageMap.tsx`'s LayersPanel → replaced by a link to `/settings/notifications`.

### API routes (new)

| Route | Behaviour |
|---|---|
| `GET /api/notifications/prefs` | `{ channels: {push,telegram: {...}}, types: [{code,name_fa,category,default_push,default_telegram,push,telegram}] }` for the session user, org-effective catalogue. |
| `PUT /api/notifications/prefs` | body `{ type_code, channel, enabled }` → upsert/delete a `notification_prefs` row. Validates `type_code` is a live catalogue code, `channel ∈ {push,telegram}`. |
| `PUT /api/notifications/channels` | body `{ channel, enabled?, quiet_start?, quiet_end?, critical_breaks_quiet? }` → upsert `notification_channels`. Validates `HH:MM`. |
| `POST /api/notifications/telegram-link` | mints `users.telegram_link_nonce` (random, ~16 bytes b64url), returns the `t.me` deep link. |
| `DELETE /api/notifications/telegram-link` | clears `telegram_chat_id` + `telegram_link_nonce`. |
| `POST /api/notifications/test` | `{ channel }` → one immediate self-notification on that channel. |

All role-guarded to the same 6 roles as `GET /api/notifications`; all scoped to `guard.session` user + org; no raw SQL in the route (repo functions only).

## Event catalogue — Phase 2 additions

| `code` | Recipient | Directed­ness | Priority | `group_scope` | Trigger source |
|---|---|---|---|---|---|
| `task.escalated` | new assignee | directed | CRITICAL | entity | add `emitEvent` in `escalateStaleRuns` after the reassign/priority bump |
| `credit_approval.waiting` | approver (owner / group_manager) | directed | HIGH | entity | paired `notify` rule on the existing `credit_approval_waiting` sweep |
| `customer.overdue` | owning salesperson | directed | NORMAL | entity | paired `notify` rule on the existing `customer_overdue` sweep |
| `cheque.due_soon` | cheque's `received_by` (fallback: customer's salesperson) | directed | HIGH | entity | **new** sweep query: `cheques WHERE status IN ('in_hand','deposited') AND due_date <= date(now,'+7 days')` |
| `reminder.due` | customer's salesperson / district's group_manager(s) | directed | NORMAL | type_day | **new** sweep query over `reminders` (replaces `send-reminder-push.mjs`) |
| `system.test` | the caller only | directed | LOW | entity | `POST /api/notifications/test`; not seeded as a rule |

Each catalogue add = one `NOTIFICATION_TYPE_SEED` row + (except `system.test`) one `RULE_SEED` `notify` row + a `recipientsFor` case + a `renderNotification` template + tests. Persian `name_fa` for every row.

## Config

- `.env.local` (and the deployed `EnvironmentFile=`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME=tamino_route_flow_bot`. Added to the local file when the worktree is set up; **never committed** (`.env.local` is gitignored). The BotFather token was shared in plaintext during design — a `/revoke` + swap after rollout is advisable.
- VAPID keys already configured (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY`).
- Every channel degrades cleanly when its config is absent: `telegramConfigured()` / `configureWebPush()` false → the settings page shows «در دسترس نیست», `effectiveRouting` returns off, `flushNotifications` skips the channel. No throw anywhere.

## Testing (vitest, repo norm — env-before-import, dynamic imports, `COVERAGE_DB_PATH` tmp)

- `effectiveRouting` — default on/off by directedness×priority; `notification_prefs` override both ways; master switch off; channel not connected (no push sub / null chat id).
- quiet hours — inside window holds; releases on the first tick ≥ `quiet_end`; window wrapping past midnight (`quiet_start=22:00`, `quiet_end=06:00`); `critical_breaks_quiet` lets a `CRITICAL` row through, others still held.
- bundling — compose across ≥2 `group_key`s (counts + labels + cap + «و N مورد دیگر»); in-place-edit vs new-message decision by `notification_deliveries.flushed_at` age; `notification_ids_json` accumulates on edit.
- `flushNotifications` — debounce skips a fresh burst; a held-then-released batch flushes once; a send failure leaves rows unflushed (retried next tick); `404`/`410` deletes the sub.
- push targeting — `/api/push/subscribe` stamps `user_id`; flush targets only the recipient's own subs; an orphan (NULL `user_id`) sub is never sent to.
- Telegram — `telegram-poll` consumes `/start <nonce>` once, sets `telegram_chat_id`, clears the nonce; a second `/start` with the used nonce is a no-op; `sendTelegram`/`editTelegram` swallow HTTP errors.
- new types — `recipientsFor` + render for each of `task.escalated`, `credit_approval.waiting`, `customer.overdue`, `cheque.due_soon`, `reminder.due`; the new `cheque.due_soon` / `reminder.due` sweep queries fire the paired `notify` rule and produce feed rows.
- migration — real-backup test: the 3 new tables + 7 new columns apply idempotently, existing `push_subscriptions` rows survive with NULL `user_id`, row counts for `users`/`customers`/`reminders`/`cheques` unchanged, `foreign_key_check` clean.
- routes — `prefs` / `channels` / `telegram-link` / `test`: auth guard, session scoping, validation (bad `channel`, bad `HH:MM`, unknown `type_code`), and that `test` is rate-limited.

## Rollout

1. Deploy with the flush pass dormant — seed the new `notify` rules `active = 0`, or land `flushNotifications` behind a `NOTIFY_FLUSH_ENABLED` env check. Confirm the new feed rows (from the new types) look right for a day.
2. Enable the flush pass; tighten the `routeflow-sweep-rules` systemd timer to ~1 min.
3. Set `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME`; start `routeflow-telegram.service`; announce the settings page. Retire the old reminder-push timer.
4. `npm run build` on the deploy host (the dev sandbox OOMs) + `systemctl restart` per the usual RouteFlow flow.

Migrations verified against a real backup copy of `coverage.db` (WAL-aware — the app's own migration path, not a raw `cp`).

## Deferred (written down, not built)

- `goal.met`, `lead.assigned` — need `goals` / `leads` domain models first (own feature).
- `stock.low` — needs a reorder-point / low-stock-threshold model on products or batches; only `expiring_batch` (expiry, not quantity) exists today. Add the threshold, then the type is a one-line sweep + paired rule.
- `POST /api/telegram/webhook` — superseded by the poll worker.
- Shared `AppHeader` consolidation — Phase 1's bell is a fixed island; fine as-is.
- Phase 1's parked polish (relative timestamps, deep-link on feed-row click, click-outside/Esc on the panel, the sweep-path `JSON.parse` guard, finishing `db?` threading on `rulesFor`/`recipientsFor`) — carry into whichever plan next touches those files.
