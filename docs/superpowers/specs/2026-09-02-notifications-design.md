# کارگاه — Notification System, Design

**Date:** 2026-09-02
**Status:** approved design — ready for implementation planning
**Approach:** C (wire the dormant event-rules engine; add a `notify` action kind)

## Goal

Notify a user of events that concern them — a task assigned to them, a sales
goal met, a new order, a successful delivery, a failed delivery, a payment, a
credit approval waiting, an overdue customer — across three channels:

- **In-app feed** (a bell + notification centre) — unconditional, the quiet baseline
- **Web Push** — opt-in per type, debounced
- **Telegram** — opt-in per type, debounced

Two hard requirements from the brief:

1. **Not noisy.** Loud channels are off by default except for events directed at
   the recipient at `NORMAL` priority or higher; ambient events go loud only when
   `CRITICAL`. Quiet hours hold loud delivery overnight. Bundling collapses bursts.
2. **Same-channel notifications stay in one item.** Every notification carries a
   `group_key`; the feed renders one row per group, and each loud channel sends
   one message per flush that is edited in place while it is still fresh.

## What already exists (build-on inventory)

- **`events` table** — an append-only fact bus. `order.<action>`, `delivery.failed`,
  `payment.recorded` are already emitted via `tryEmitEvent`.
- **`lib/repo/rules.ts`** — a rules engine that maps an `event.kind` (or `sweep`)
  through `condition_json` to a `task` or an `alert`, with `cooldown_min`,
  `liveRun` dedupe, tenant overrides (`setTenantRuleOverride`), and escalation.
  `runEventRules()` is **defined but never called** — the bus has no consumer today.
- **`/api/rules/run`** — the sweep endpoint; driven by `scripts/run-sweeps.mjs`
  under a systemd timer. Runs `runSweepRules` + `escalateStaleRuns`.
- **`scripts/send-reminder-push.mjs`** — a standalone systemd job that broadcasts
  one web-push to **every** `push_subscriptions` row (no user targeting) when a
  reminder is due. The only code path that actually sends a push.
- **`push_subscriptions`** — `endpoint`/`p256dh`/`auth`/`created_at`. **No `user_id`.**
- **`components/NotificationToggle.tsx`** — subscribe/unsubscribe UI, currently
  mounted only inside the map's LayersPanel (`CoverageMap.tsx`).
- **`public/sw.js`** — `push` + `notificationclick` handlers, payload
  `{ title, body, url }`.
- **`/api/prefs` + `lib/repo/prefs.ts`** — per-user UI prefs as a `users.prefs_json`
  blob, merge-patched, allow-listed.
- **`app/today` + `components/today/Briefing.tsx`** — the current in-app surface
  for a user's open tasks.
- No settings section exists (`app/settings` absent).
- Roles: `owner`, `group_manager`, `rep_manager`, `salesperson`, `driver`
  (+ `platform_owner`). Persian / RTL, Next.js, `node:sqlite`, multi-tenant by
  `organization_id`, two themes (see `MASTER.md`), `Island` component for
  announcements.

## Data model

Five new tables + two column adds. All migrations are `CREATE TABLE IF NOT EXISTS`
or nullable `ALTER TABLE ADD COLUMN` (no table rebuild), following the idempotent
style in `lib/db.ts`.

### `notification_types` — the catalogue

Seeded with `organization_id NULL` default rows, exactly like `rules`; a tenant
row with the same `code` overrides.

| column | notes |
|---|---|
| `id` | PK |
| `organization_id` | NULL = shipped default |
| `code` | e.g. `task.assigned`, `goal.met`, `order.confirmed` |
| `name_fa` | shown in the settings matrix |
| `category` | `task` / `sales` / `order` / `delivery` / `finance` / `customer` |
| `directedness` | `directed` / `ambient` |
| `priority` | `CRITICAL` / `HIGH` / `NORMAL` / `LOW` (same vocabulary as `tasks`) |
| `group_scope` | `entity` \| `type_day` — how `group_key` is derived |
| `default_push` | 0/1, computed from the routing rule, stored for inspectability |
| `default_telegram` | 0/1 |
| `active` | 0/1 |
| `created_at`, `updated_at` | |

`UNIQUE (organization_id, code)`.

### `notifications` — the feed and the system of record

One row per (recipient, event). Always inserted; the feed is unconditional.

| column | notes |
|---|---|
| `id` | PK |
| `organization_id` | tenant boundary |
| `user_id` | recipient |
| `type_code` | → `notification_types.code` |
| `title_fa`, `body_fa` | rendered at fan-out time (no late template eval) |
| `entity_type`, `entity_id` | click-through target |
| `group_key` | TEXT — `order:1234` or `order.created:1403-03-11` |
| `priority` | copied from the type (or overridden by the rule) |
| `created_at` | |
| `seen_at` | feed opened past this row |
| `read_at` | this group opened |
| `source_event_id` | → `events.id` |
| `source_rule_run_id` | → `rule_runs.id` (nullable) |

Indexes: `(organization_id, user_id, read_at, created_at)` for the feed;
`(user_id, group_key)` for coalescing.

### `notification_prefs` — the opt-in matrix

Sparse — a row exists only where the user overrode a default.

`user_id`, `type_code`, `channel` (`push` / `telegram`), `enabled` (0/1),
`updated_at`. PK `(user_id, type_code, channel)`.

### `notification_channels` — per-user channel state

One row per user per channel, created lazily on first write.

`user_id`, `channel` (`push` / `telegram`), `enabled` (master switch, default 1),
`quiet_start` / `quiet_end` (`"21:00"` / `"08:00"`; NULL = no quiet hours;
default `21:00`/`08:00`), `critical_breaks_quiet` (0/1, default 1), `updated_at`.

### `notification_deliveries` — the flush ledger

Drives bundling, in-place update, and idempotency.

`id`, `user_id`, `channel`, `flushed_at`, `notification_ids_json` (rows this
message covered), `provider_ref` (web-push `tag` / Telegram `message_id`),
`target` (endpoint or chat id). Index `(user_id, channel, flushed_at)`.

### Column adds

- `push_subscriptions.user_id INTEGER` — nullable; `/api/push/subscribe` fills it
  from the session. Ends the broadcast-to-everyone behaviour.
- `users.telegram_chat_id TEXT` — set when the account is linked.
- `users.telegram_link_nonce TEXT` — issued when the user clicks "connect",
  consumed by the webhook, then cleared.

## Generation — approach C

### Wire the engine

- `emitEvent()` gains a tail call to `runEventRules(orgId, eventRow)`, wrapped so
  it can never throw into the host write — same best-effort contract as
  `tryEmitEvent`. This is the decision that feed rows land **synchronously**,
  inside the same request that confirmed the order / recorded the payment.
- Only `emitEvent` (not just `tryEmitEvent`) calls it; both funnel through the
  same insert, so the hook sits at the single choke point.

### The `notify` action kind

- `fire()` in `lib/repo/rules.ts` gets a third branch beside `task` / `alert`:
  **`notify`**. `action_json` carries `{ "notification_type": "<code>" }`.
- The branch delegates to `fanOutNotifications(orgId, rule, event, runId)` in the
  new `lib/repo/notifications.ts`. It still writes a `rule_runs` row (so
  `cooldown_min`, `liveRun` dedupe and escalation keep working as a coarse
  anti-repeat on top of per-user bundling).
- `seedRules()` is extended: one `notify` rule per catalogue entry, `trigger_kind`
  = the event kind, `action_kind` = `notify`.

### Division of labour

- **Rules engine** owns: `trigger_kind` match, `condition_json`, `cooldown_min`,
  `liveRun` dedupe, tenant enable/disable via `setTenantRuleOverride`.
- **`lib/repo/notifications.ts`** owns everything per-user the rules schema can't
  express: recipient resolution, per-user × per-channel routing + opt-in,
  bundling by `group_key`, quiet hours, and actual push / Telegram delivery.

## Routing & opt-in — `fanOutNotifications`

1. **Resolve recipients.** `recipientsFor(typeCode, event, db)` — one case per
   type:
   - `task.assigned` / `task.escalated` → the assignee
   - order / payment / delivery types → `orders.salesperson_user_id`
     (+ the owning group's manager(s) for the ambient copy)
   - `goal.met` → the target's owner + their manager
   - ambient group events → the group's `group_manager` user(s)
   Drop `user_id === event.actor_user_id` (never notify someone of their own
   action) unless the type explicitly opts in.
2. **Insert one `notifications` row per recipient** — always. Render `title_fa` /
   `body_fa` now.
3. **Decide loud channels per recipient.** `effectiveRouting(userId, type, channel)`:
   - `notification_prefs` override if a row exists, else the default rule:
     `directed && priority >= NORMAL` → push + telegram on;
     `ambient` → on only if `priority === CRITICAL`.
   - Gate by `notification_channels.enabled` (master switch) **and** whether the
     channel is actually connected (a `push_subscriptions` row for the user / a
     non-null `users.telegram_chat_id`).
   - Loud channels are **not** sent here. The row is left unflushed; the flush
     pass (below) picks it up. This is what makes bundling possible.

## Bundling — "one item per channel"

`group_key` derivation from `notification_types.group_scope`:

- `entity` → `"{entity_type}:{entity_id}"` — everything about order 1234 is one
  thread.
- `type_day` → `"{type_code}:{jalali_date}"` — "new orders today" is one item
  that counts up.

**In-app feed** (`GET /api/notifications`): rows grouped by `group_key`, each
group returns `{ latest, count, unread_count, items[] }`, ordered by latest
activity. Bell badge = `COUNT(DISTINCT group_key WHERE read_at IS NULL)`. Opening
a group stamps `read_at` on its rows.

**Loud channels**: the flusher groups a user's unflushed rows by `group_key`, then
composes **one message** for the whole batch, e.g.
`"۳ سفارش جدید · ۱ تحویل موفق · وظیفه جدید: پیگیری مشتری X"`. If a prior
`notification_deliveries.provider_ref` for that (user, channel) is still fresh
(< ~10 min), **edit in place**: web-push re-send with the same `tag` replaces the
visible notification; Telegram `editMessageText` on the stored `message_id`.
Otherwise send a new message and write a new ledger row.

## Loud-channel flush — on the sweep tick

A new pass inside `runSweepRules` (so the deployed `run-sweeps.mjs` timer drives
it — tighten that timer to ~1 min). For each user with unflushed `notifications`:

1. **Debounce.** Skip if the oldest unflushed row is younger than `DEBOUNCE_MS`
   (~120s) — lets a burst settle into one message.
2. **Quiet hours.** If now ∈ [`quiet_start`, `quiet_end`) for the channel: hold,
   unless `critical_breaks_quiet` and the batch contains a `CRITICAL` row. Held
   rows flush on the first tick at/after `quiet_end`. The window may wrap past
   midnight — handle `quiet_start > quiet_end`.
3. **Compose & send** (per Bundling above):
   - **Web Push** — `webpush.sendNotification` to the user's subscriptions (now
     user-scoped), payload `{ title, body, url: "/notifications", tag:
     "kargah-digest" }`. `404` / `410` → delete the subscription (existing
     pattern in `send-reminder-push.mjs`).
   - **Telegram** — `POST https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage`
     (or `editMessageText`) to `users.telegram_chat_id`.
4. Write `notification_deliveries`.

`scripts/send-reminder-push.mjs` is refactored to enqueue `notifications` rows of
a `reminder.due` type instead of broadcasting — one delivery path, not two.

## UI

### Notification centre

A bell in the app header. Today the header is per-page; introduce a shared
`AppHeader` slot (or mount the bell into each page's existing header). Badge =
unread group count. Click → dropdown / sheet: grouped feed, "خواندنِ همه",
expandable groups, click-through to the entity. Reuses the `Island` visual
vocabulary. RTL, both themes, degrades under `prefers-reduced-motion`.

### `/settings/notifications`

New page (no settings section exists today).

- Per-channel master switch + **quiet hours** time range + a checkbox
  "اجازه بده هشدارهای بحرانی در ساعات سکوت هم بیایند".
- **The matrix** — notification types grouped by `category`, each row with Push /
  Telegram toggles. Default state shown as a hint ("پیش‌فرض: روشن"); toggling
  writes a `notification_prefs` row (and deletes it when set back to default).
- **Telegram connect** — button opens
  `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<nonce>`. `POST /api/telegram/webhook`
  resolves `/start <nonce>` → sets `users.telegram_chat_id`, clears the nonce,
  bot replies "متصل شد". Disconnect clears the column.
- The old `NotificationToggle` in the map is replaced by a link here; its
  subscribe logic moves into this page.

### API routes

- `GET /api/notifications` — grouped feed
- `PATCH /api/notifications` — mark group(s) / all read
- `GET /api/notifications/prefs`, `PUT /api/notifications/prefs`
- `PUT /api/notifications/channels` — master switch + quiet hours
- `POST /api/telegram/webhook` — bot updates (nonce linking; ignore everything else)
- `POST /api/notifications/test` — send yourself one, to verify a channel

## Event catalogue (seed)

| Event (`code`) | Recipient | Directedness | Priority | `group_scope` |
|---|---|---|---|---|
| `task.assigned` | assignee | directed | HIGH | entity |
| `task.escalated` | new assignee | directed | CRITICAL | entity |
| `goal.met` | target owner (person/group) + their manager | directed | HIGH | type_day |
| `order.confirmed` | salesperson who registered it | directed | NORMAL | entity |
| `order.rejected` | salesperson | directed | HIGH | entity |
| `order.created` | group_manager | ambient | NORMAL | type_day |
| `delivery.succeeded` | order's salesperson (directed) + group_manager (ambient) | directed / ambient | NORMAL | type_day |
| `delivery.failed` | salesperson + group_manager + driver | directed | HIGH | entity |
| `payment.recorded` | order's salesperson | directed | NORMAL | entity |
| `credit_approval.waiting` | approver (owner / manager) | directed | HIGH | entity |
| `customer.overdue` | owning salesperson | directed | NORMAL | entity |
| `lead.assigned` | assignee | directed | HIGH | entity |
| `stock.low` | group_manager | ambient | HIGH | type_day |
| `cheque.due_soon` | owning salesperson | directed | HIGH | entity |

Each row → one `notification_types` row + one seeded `notify` rule. Some source
events already exist on the bus (`order.*`, `delivery.failed`, `payment.recorded`);
the rest (`goal.met`, `order.created`, `delivery.succeeded`, `lead.assigned`,
`stock.low`, `cheque.due_soon`, `customer.overdue`, `task.assigned`,
`task.escalated`, `credit_approval.waiting`) need an `emitEvent` call added at
their origin or a `sweep` rule — enumerated in the implementation plan.

## Config

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` in the systemd `EnvironmentFile`.
- VAPID keys already configured.
- Every channel degrades cleanly when its config is absent — the settings page
  shows it as "در دسترس نیست" and routing skips it.

## Testing (vitest, matching repo norm)

- `recipientsFor` — per type, including the actor-exclusion rule
- `effectiveRouting` — default; `notification_prefs` override; master-switch off;
  channel not connected
- `group_key` derivation — both `group_scope` values, Jalali date boundary
- bundling — message composition across multiple groups; in-place-update vs.
  new-message decision by `provider_ref` freshness
- quiet hours — hold, release on the `quiet_end` tick, window wrapping past
  midnight, `critical_breaks_quiet`
- `404` / `410` push subscription cleanup
- Telegram nonce — single use, cleared after linking
- Browser glue (bell, settings page, webhook) lightly tested, per repo convention

## Rollout

1. Tables + generation + in-app feed + bell — **nothing loud yet**. Verify the
   feed fills correctly for a day.
2. Enable the flush pass; tighten the sweep timer to ~1 min.
3. Connect Telegram; refactor `send-reminder-push.mjs` onto the `reminder.due`
   type.

Migrations verified against a real backup copy of `routeflow.db` (WAL-aware — use
the app's own migration path, not a raw `cp`).

## Suggested split into two specs / two plans

- **Spec 1 — feed & generation:** data model, engine wiring, `notify` action,
  `fanOutNotifications` (feed rows only), `GET/PATCH /api/notifications`, the bell
  + notification centre. Independently useful.
- **Spec 2 — loud channels:** the flush pass, quiet hours, user-scoped push,
  Telegram bot + webhook + linking, `/settings/notifications` with the matrix,
  `send-reminder-push.mjs` refactor.
