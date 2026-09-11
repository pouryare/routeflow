# CRM — Leads & Customers (design)

Date: 2026-09-11 · Status: approved in brainstorming (sections 1–4 reviewed one by one;
sections 5–7 written to the recommended defaults at the user's instruction to start
building) · Source brief: the 32-section "CRM / Leads & Customers — Expanded Requirements".

Companion rulebook: [`docs/tap-flow-principles.md`](../../tap-flow-principles.md) — every
field-side input in this spec is a tap flow and follows it.

Clickable mockups (private): list cards
<https://claude.ai/code/artifact/b5264b72-306d-4d64-aa60-eb716e360c70>, after-call flow
<https://claude.ai/code/artifact/bb9de4b3-5b28-4b92-b3f4-71f9cd4e1145>, Add Lead flow
<https://claude.ai/code/artifact/30e6abe6-2d44-47b2-b479-c5089b31892c>.

---

## 0. Decisions locked

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | One spec for all 32 sections; the plan builds it in dependency layers. |
| D2 | Lead model | **Merge into `customers`.** A lead is a `customers` row from the moment it's added (`lifecycle='lead'`). The 17 `saved_locations` migrate in; `saved_locations` retires. No "convert" that deletes anything. |
| D3 | Salesperson visibility | **Own + group's unassigned pool.** Logging on an unassigned lead auto-claims it. Others' records answer 404. |
| D4 | rep_manager | **Manager view of their group** in the CRM. Their non-CRM access is unchanged (still an open question elsewhere). |
| D5 | Quotations | **Own record + share sheet.** Accepting one creates a prefilled DRAFT order. |
| D6 | Samples | **Record wraps a `SAMPLE` order**, so stock, delivery, zero commission and the existing sample KPI keep working. |
| D7 | Duplicates | **Tiered.** Same normalised phone = blocking card (open / request / another branch). Similar name nearby = skippable warning. Manager merge. |
| D8 | Next action | **Required, prefilled, skippable with a one-tap reason.** Every open business has exactly one open next-action task. |
| D9 | Architecture | **A + C hybrid.** Tables are truth, `activities` is append-only (DB triggers), every CRM write emits an `events` row in the same transaction, and the cached state columns provably equal `replayCrmState(activities)`. |
| D10 | Interaction | **Tap flows** (one question per screen, big answers, the last answer autosaves). **5 s undo toast, 5 s auto-return.** One undo window app-wide: `OUTBOX_HOLD_MS` 9000 → 5000. |
| D11 | List cards | **Mixed.** Next-action-first pocket card (C) in the «پیگیری امروز» and «داغ» views; business card (A-lite) elsewhere. Cards carry only **Call** and **Open**. |
| D12 | First contact | Imported leads are **verified on the first call** (Google Maps data is often obsolete). "Who did you talk to?" is answered by **role**, names optional. |
| D13 | Add Lead done screen | **Combined:** «تماس همین حالا» + «باز کردن پرونده» buttons, then auto-return to the list after 5 s with the new card highlighted. |
| D14 | Look | Current meridian theme and tokens throughout; sheets are the existing bottom sheet (`.sheet`, `.meridian-scrim`, `.grab`, `.sheethead` — as `components/meridian/CustomerSheet.tsx`), with `useSwipeDismiss(…, "down")`. `<Icon>` only, no emoji. |

## 1. Data model

### 1.1 `customers` stays the Business — new columns (guarded `ALTER TABLE ADD COLUMN`, no rebuild)

| Column | Type | Notes |
|---|---|---|
| `owner_user_id` | INTEGER → users | Backfill: match `customers.salesperson` text to `users.display_name` within the org; unmatched → NULL (unassigned). |
| `business_type` | TEXT | KEBAB · IRANIAN · FAST_FOOD · CAFE · CONFECTIONERY · BAKERY · CATERING · HOTEL · CHAIN · OTHER. Validated in code. `customer_type` (CHECK-constrained) is **derived** from it (KEBAB/IRANIAN/FAST_FOOD/CHAIN→RESTAURANT, CAFE→CAFE, CONFECTIONERY/BAKERY→RETAIL, CATERING→CATERING, HOTEL→HOTEL, OTHER→OTHER) so academy objection cards keep matching. |
| `secondary_phone`, `whatsapp`, `instagram`, `website` | TEXT | optional |
| `phone_norm` | TEXT | last 10 digits of `phone`, indexed; kept by the repo on every write |
| `size_band` | TEXT | S / M / L, optional |
| `maps_url` | TEXT | from Add Lead link or migrated `saved_locations` |
| `rating_potential`, `rating_volume`, `rating_ease` | INTEGER | carried over from `/leads` |
| `district_id` | INTEGER → districts | computed from lat/lng on write (point-in-ring, `lib/trafficZones.pointInRing` as `lib/groups.ts` does) |
| `area_label` | TEXT | neighbourhood text from the link/geocoder or district name |
| `source_code`, `source_detail`, `source_url`, `referred_by_customer_id` | TEXT/INTEGER | source ≠ activity type ≠ outcome |
| `verification` | TEXT | `unverified` · `verified` · `renamed` · `moved` · `invalid_closed` · `invalid_other_business` · `invalid_not_fit` · `invalid_wrong_number` |
| `contact_status` | TEXT | `not_contacted` · `attempted` · `no_answer` · `busy` · `wrong_number` · `unavailable` · `contacted` |
| `sales_stage` | TEXT | `unknown` · `not_interested` · `interested` · `sample` · `quotation` · `negotiation` · `first_order` · `customer` · `repeat_customer` · `lost` |
| `temperature`, `temperature_manual` | TEXT, INTEGER | hot/warm/cold; manual = pinned override |
| `attempt_count`, `consecutive_misses` | INTEGER | |
| `last_activity_at`, `last_contacted_at` | TEXT | |
| `next_task_id` | INTEGER → tasks | the one open next action |
| `lost_reason_code` | TEXT | `reason_codes` domain `crm_lost` |
| `merged_into_id` | INTEGER → customers | hidden from every list when set |
| `closed_at` | TEXT | permanently closed (only true dead end) |

`lifecycle` is **derived** by the single stage writer: unknown/not_interested/interested →
`lead`/`qualified` (interested and above → qualified), sample/quotation/negotiation →
`sampled` for sample else `qualified`, first_order/customer/repeat_customer → `active`,
lost → `lost`. `dormant` and `blocked` keep their existing code paths. The 21 existing
readers of `lifecycle` are untouched.

### 1.2 New tables (all on `TENANT_TABLES`, `organization_id NOT NULL`)

- **`contacts`** — `customer_id`, `name` (nullable: role-only contacts are normal),
  `role` (OWNER · MANAGER · PURCHASING · CHEF · RECEPTION · ACCOUNTANT · STOREKEEPER · STAFF ·
  OTHER), `phone`, `phone_norm`, `whatsapp`, `is_primary`, `is_decider` (derived from role,
  overridable), `best_time`, `note`, `active`, `created_by`, timestamps. Backfill: each
  customer's `contact_person`/`phone` becomes the primary contact (role OTHER).
  `customers.contact_person`/`phone` stay as mirrors of the primary contact.
- **`activities`** — **append-only** (`BEFORE UPDATE`/`BEFORE DELETE` triggers RAISE).
  `customer_id`, `user_id`, `contact_id`, `type` (call · visit · message · note · price_sent ·
  lead_created · verification · owner_change · temperature_change · stage_change ·
  sample · quotation · order · merge · correction · system), `outcome_code`, `attempt_no`,
  `phone_used`, `note`, `answers_json` (the tap-flow answers, for audit), `completed_task_id`,
  `next_task_id`, `corrects_activity_id`, `client_uuid` (partial UNIQUE), `occurred_at`,
  `created_at`.
- **`product_interests`** — `customer_id`, `product_id`, `level` (high/med/low), `status`
  (interested · sampled · quoted · ordered · dropped), `note`, `first_at`,
  `last_discussed_at`, `sample_id`, `quotation_id`, `first_order_id`;
  UNIQUE(customer_id, product_id).
- **`samples`** — `customer_id`, `contact_id`, `product_id`, `packaging_id`, `qty`,
  `order_id` (the SAMPLE order), `status` (requested · preparing · delivered ·
  feedback_pending · positive · negative · converted; machine in `lib/crm/sampleStates.ts`),
  `requested_at`, `delivered_at`, `delivered_by_user_id`, `recipient`, `feedback_code`,
  `feedback_note`, `followup_task_id`, `converted_order_id`, `created_by`, timestamps.
- **`quotations`** + **`quotation_lines`** — header: `customer_id`, `contact_id`, `user_id`,
  `status` (sent · accepted · rejected · expired · converted), `channel` (whatsapp ·
  telegram · other), `valid_until`, `sent_at`, `converted_order_id`, `note`; lines:
  `product_id`, `packaging_id`, `price_toman` (snapshot from `product_prices`), `qty`
  (nullable).
- **`customer_tags`** — (`customer_id`, `tag`) UNIQUE.
- **`reason_codes`** domain widened (small guarded table rebuild) with `lead_source`
  (GOOGLE_MAPS, GOOGLE_SEARCH, SNAPPFOOD, TAPSI_FOOD, INSTAGRAM, REFERRAL, EXISTING_CUSTOMER,
  FIELD_VISIT, OTHER), `crm_lost` (PRICE_HIGH, HAS_SUPPLIER, QUALITY, NO_NEED, BUYS_FACTORY,
  BUYS_DISTRIBUTOR, PAYMENT_TERMS, DELIVERY, MOQ, WRONG_CONTACT, CLOSED, SEASONAL,
  COMPETITOR, OTHER), `crm_skip` (WAITING_ON_THEM, LOGGED_ELSEWHERE, LEAD_LOST, OTHER),
  `crm_not_fit`. NULL-org rows are the shipped defaults (the existing `reason_codes`
  treatment).
- **`org_settings`** keys (existing app_meta / org prefs mechanism): `crm.max_misses` (5),
  `crm.hot_window_days` (14), `crm.warm_window_days` (30).

### 1.3 Events (same transaction as the write)

`lead.created`, `lead.verified`, `lead.invalidated`, `activity.logged`, `stage.changed`,
`temperature.changed`, `owner.changed`, `lead.claimed`, `reassign.requested`,
`duplicate.suspected`, `sample.requested|delivered|feedback|converted`,
`quote.sent|accepted|rejected|expired`, `customer.converted`, `customer.repeat`,
`business.merged`, `reorder.due`.

### 1.4 Retired

`saved_locations` (rows → customers with `lifecycle='lead'`, `verification='unverified'`,
`source_code='GOOGLE_MAPS'`, `maps_url`, ratings, notes; `customer_code` `LEAD-<n>`),
`lead_list_items.location_id` → `customer_id` (rebuild), the empty legacy `reminders` table
(`AddReminder` writes `tasks` kind `reminder`). `/api/locations/[id]/convert` and
`/api/reminders*` are removed; `/api/locations/parse` becomes the "paste link" step.

## 2. Rules & automation

### 2.1 Outcome vocabulary — `lib/crm/outcomes.ts` (pure)

Each outcome → `{ contact_status, stage (forward-only), temperature_signal, next_action
default }`. Existing codes (CONTACTED, ORDERED, PRICE_OBJECTION, NOT_INTERESTED,
ALREADY_SUPPLIED, NO_TIME, PAYMENT_TERMS, QUALITY_DOUBT) are reused so objection cards keep
firing.

| Outcome | contact_status | stage | temp | default next action |
|---|---|---|---|---|
| NO_ANSWER / BUSY / UNAVAILABLE | no_answer / busy / unavailable | – | – | Call again, tomorrow 10:00 / +3 h |
| WRONG_NUMBER | wrong_number | – | – | Find the right number, tomorrow |
| CALL_BACK | contacted | – | warm | Call again at the time given (required) |
| INTERESTED | contacted | interested | warm | Send price list, tomorrow |
| ASKED_PRICE | contacted | interested | hot | Send price now (quote) → follow up quote +3 d |
| REQUESTED_SAMPLE | contacted | sample | hot | Deliver sample (creates sample + SAMPLE order) |
| NEGOTIATING / READY_TO_ORDER | contacted | negotiation | hot | Follow up +2 d / create order |
| PRICE_OBJECTION / PAYMENT_TERMS / QUALITY_DOUBT / ALREADY_SUPPLIED | contacted | – | warm | Objection card; call again +3 d |
| NOT_INTERESTED (+ `crm_lost` reason) | contacted | not_interested | cold | Win-back picker |
| GATEKEEPER | contacted | – | – | Call the decider at the time given |

Verification answers (first contact with an `unverified` lead): verified · renamed · moved
· other business (→ optionally spawn a new lead with that number) · closed · not a fit.
Invalid leads get `closed_at`, leave every queue, keep history.

### 2.2 Next action

- Exactly one open next-action task per open business: a new one dismisses the previous
  (`customers.next_task_id`).
- Every flow ends on it; skipping asks a `crm_skip` reason.
- Win-back picker: 7 d · 30 d · 3 m · 6 m · 12 m · custom · reassign · another contact ·
  wait for new offer (tag `wait_new_offer`; surfaced when a product or price changes) ·
  competitor revisit date · closed for good.

### 2.3 Temperature

Auto: hot if a hot signal in the last `hot_window_days`, warm if a warm signal in the last
`warm_window_days`, else cold. Manual pin (manager, or owning rep) sets
`temperature_manual=1` and shows «دستی»; the auto value stays visible as "suggested"; a
pin clears only when someone clears it.

### 2.4 Attempts

A call attempt is one `activities` row; attempts within 10 minutes on the same number are
one attempt. After `max_misses` consecutive misses the suggested next action is "park 30
days" (unverified leads: "visit in person to verify").

### 2.5 Automatic follow-ups (rules engine, deduped + cooldown)

Event rules: `sample.delivered` → feedback follow-up +3 d; `quote.sent` → follow-up +3 d.
Sweeps: quote expiring (alert); lead created 2 d ago, never contacted → call task;
open business with no open next task (repair) → "decide next step"; `reorder.due` (§5.2)
→ `reorder` task. New task kinds `quote_followup`, `reorder`, `sample_delivery`,
`verify_lead` added to `lib/tasks/labels.ts` (labels + tones).

### 2.6 Conversion (no copies, ever)

A SALE order reaching DELIVERED: stage → `first_order` (lifecycle `active`,
`first_order_at`), matching product interests → `ordered`, same-product samples in the last
60 d → `converted`; a second delivered SALE order → `repeat_customer`. All written as system
activities + events on the same row.

### 2.7 Replay guarantee

`lib/crm/replay.ts` `replayCrmState(activities)` → `{contact_status, sales_stage,
temperature(auto), attempt_count, consecutive_misses, last_activity_at,
last_contacted_at, verification}`. A test asserts the stored columns equal the replay after
every write path; `repairCrmState(orgId)` rebuilds them.

## 3. Permissions & APIs

`crmFilter(session, alias)` in `lib/session.ts`: owner/platform_owner → org; group_manager,
rep_manager → their group (no group → nothing); salesperson → `owner_user_id = me OR
(owner_user_id IS NULL AND group_id = my group)`; driver → nothing. Child tables scope by
joining their business. Out of scope → 404.

Writes: a salesperson writes only on businesses they own; logging on an unassigned lead in
their group auto-claims it. Managers only: assign, merge, temperature pin on others', team
analytics. Duplicate check searches the org and redacts to what the caller can reach (an
out-of-scope match returns owner name + area + "request it").

Routes (`/api/crm/*`, every route re-checks; `proxy.ts` denies drivers):

- `GET /businesses?view=today|hot|my_leads|my_customers|unassigned|at_risk|all&q&type&area&owner&cursor`
- `POST /businesses` (Add Lead; lat/lng required; `client_uuid`)
- `GET /businesses/dedupe?phone&name&lat&lng`
- `GET|PATCH /businesses/[id]`, `GET /businesses/[id]/timeline?cursor`
- `POST /businesses/[id]/flow` — **the one write path for tap-flow results** (call, visit,
  verification, win-back); one transaction: activity + task completion + next task (or skip
  reason) + side effects (sample, quote, interests, contact) + cached state + events + rules
- `POST /businesses/[id]/{claim,assign,merge,temperature,request}`
- `/businesses/[id]/contacts`, `/businesses/[id]/interests`
- `/samples`, `/samples/[id]/transition`, `/quotations`, `/quotations/[id]/{accept,reject}`
- `GET /queue`, `GET /analytics/{funnel,team,sources,areas,lost,samples}`

Offline: new fact ops `lead.capture`, `crm.flow`, `contact.add`; claim/assign/merge/quote
accept are online-only. A server-side duplicate found on sync creates a
`duplicate.suspected` task for the manager and never rejects the capture.

`OUTBOX_HOLD_MS` becomes 5000 (D10).

## 4. Screens

All on the meridian theme. Sheets use the existing bottom sheet markup and swipe-down.

- **`/crm` «مشتریان و سرنخ‌ها»** (nav group «مشتریان», ready for every role but driver;
  `/leads` redirects here). Header + «+ سرنخ» + search + view chips with counts:
  «پیگیری امروز» · «داغ» (pocket next-action cards, grouped overdue / today / later) ·
  «سرنخ‌های من» · «مشتریان من» · «در خطر» · «بی‌صاحب» · «همه» (business cards: name, type,
  area, contact role, temperature dot, stage pill, verification pill, owner, last activity,
  next action, last order). Card buttons: **Call** (`tel:` then the after-call flow opens on
  `visibilitychange`) and **Open**. Managers get an owner chip row.
- **`<TapFlow>`** — `components/tapflow/TapFlow.tsx`, generic, renders a config from
  `lib/crm/flows/*.ts`: context strip, back, progress, answer grid, multi-select step,
  inline inputs, done screen (summary chips, optional actions, 5 s auto-return), toast with
  5 s undo via `useToast` action + the outbox hold, draft on close.
- **After-call / visit flow** (`lib/crm/flows/afterCall.ts`) — as the v2 mockup:
  reach → (first call) verify → who (role chips; known contacts first; gatekeeper branch) →
  what → branch → time answer saves. Visits open with "Did you meet anyone?".
  Also opened from «کارهای من», «امروز» and «کارتابل» for CRM tasks.
- **Add Lead flow** (`lib/crm/flows/addLead.ts`) — as the mockup: source → link / here /
  referral / other → name + phone (live dedupe) → location (required) + pin → business type
  → (manager) owner → first step (saves) → done screen with «تماس همین حالا» /
  «باز کردن پرونده», back to the list after 5 s.
- **Business profile `/crm/[id]`** — header (name, type, area, temperature, stage,
  verification, owner) · action bar (Call · Visit · Follow-up · Note · Sample · Send price ·
  More) · next-action card · "what they want" (interests) · health card with reasons ·
  purchase pattern + reorder prediction (customers) · cross-sell suggestions · contacts
  (role chips) · samples & quotes · timeline (chronological union of activities, tasks,
  orders, payments, samples, quotes; filter chips) · mini map + navigate.
- **Small flows**: send price (product chips → price snapshot → WhatsApp/Telegram share →
  saves quote), request sample, temperature pin, reassign, merge (manager), add contact.
- **Daily queue** — the «پیگیری امروز» view plus CRM panels in `todayFor`: overdue, today,
  never-contacted, hot, sample deliveries, quote follow-ups, planned visits, reorder due;
  "nearby" groups by `district_id`/distance from the rep's position and can hand a group to
  the existing visit planner (`visit_plans`).

## 5. Customer intelligence (pure `lib/crm/*`, read through `lib/repo/crm/*`)

### 5.1 Purchase pattern

From delivered SALE orders + lines: first/last order, count, AOV, median inter-order
interval, weekly/monthly trend (last 6 Jalali months), and per product: order share, median
interval, median qty, last bought.

### 5.2 Reorder prediction

Needs ≥ 3 delivered orders (2 → "low confidence"). Expected date = last order + median
interval, window ± half the IQR; expected products = in ≥ 50 % of the last 5 orders, qty =
median; value = median order value. Always labelled «پیش‌بینی» with confidence, never shown as
an order. Sweep: expected date ≤ tomorrow, no order since, no open reorder task →
`reorder.due` → `reorder` task for the owner ("Call · Create follow-up · View last order").

### 5.3 Health (4 states with reasons)

Extends `lib/analysis/health.customerHealth` factors (cadence, trend, payment, complaints,
margin) with **engagement** (days since last activity) and **breadth** (distinct products;
single-product dependency). States: healthy ≥ 70 · needs attention 50–69 · at risk 30–49 ·
inactive/lost < 30 or days since last order > 3× typical interval (or > 90 d with no
interval). Reasons are concrete sentences with numbers ("last order 21 days ago · usually
every 10–14 days · order frequency down 35 % · no contact for 12 days"). The primary action is
derived (usually Call). The existing 3-band `band()` stays for the analysis page.

### 5.4 Cross-sell (rules, no AI)

For a customer's frequent product A and a product P they don't buy: among customers of the
same `business_type` who buy A, the share who also buy P; suggest when support ≥ 3 customers
and share ≥ 40 %. Reason text: "Buys 10g butter weekly · 6 of 9 kebab shops that buy it also
buy cocoa". Actions: Call · Add interest · Send price · Send sample.

## 6. Analytics — `/crm/analytics`

Managers see the team; a salesperson sees only themselves. Filters as chips + a bottom-sheet
picker: date range, salesperson, city, territory (group/district), business type, source,
product, segment tag.

- **Funnel** (cohort = businesses created in range, "reached" = ever reached, rank-based like
  `lib/orderFunnel.ts`): Leads → Contacted → Interested → Samples → Negotiations → First orders
  → Repeat customers; absolute numbers, step % and overall %.
- **Team / leaderboard**: volume (leads added, calls, visits, quotes, samples) next to
  outcomes (answer rate, conversations, interested, sample→order, quote→order, first orders,
  new customers, revenue, AOV, repeat rate, follow-ups on time, overdue). Anti-gaming: calls
  within 10 min to the same number = one; "answered" needs a talked outcome; first orders
  need a delivered order; rates show "–" below n = 10; coaching hint = the rep's weakest
  funnel step against the team. Period vs previous period.
- **Sources**: per source — leads, contacted, interested, customers, orders, revenue,
  contact rate, interest rate, lead→customer, revenue per lead, AOV, repeat rate.
- **Areas**: by district/group — leads, customers, revenue, untouched districts, hot leads,
  at-risk customers, rep workload; links into `/map`.
- **Lost reasons** and **samples** (waiting delivery, awaiting feedback, converted, by
  product and by rep).

Queries are live SQL in `lib/repo/crm/analytics.ts` over indexed columns (data is small);
rate math is pure in `lib/crm/metrics.ts`. Charts reuse `components/charts/*`.

## 7. Migration, rollout, testing

- **Migrations** in `lib/db.ts`, guarded and idempotent, following the existing pattern;
  the only rebuilds are `reason_codes` (domain) and `lead_list_items` (column). Backfills:
  owner, contacts, `phone_norm`, `business_type` from `customer_type`, `contact_status` /
  `sales_stage` / `verification` from lifecycle + orders (existing customers = verified),
  saved_locations → customers. A `tests/crm-migration-realdata.test.ts` runs against a
  SQLite-backup-API copy of production and asserts no row is lost.
- **Tests (TDD)**: pure — outcomes, flow configs (every path ends; common path ≤ 5 taps;
  every label mapped), temperature, phone normalisation + dedupe, replay, purchase pattern,
  reorder, health, cross-sell, funnel/metrics. Repo — `crmFilter` isolation (404s,
  two-orgs helper), flow write path (one transaction, one open next task, auto-claim),
  conversion hook, merge, append-only triggers, replay = stored. Existing guards —
  repo-boundary, no-raw-enum, appNav.
- **Build order** (plan phases, each shippable): P1 data + scoping + core repo;
  P2 `<TapFlow>` + after-call flow + Add Lead + `/crm` list + task integration + 5 s hold;
  P3 business profile + contacts + interests + samples + quotes + timeline;
  P4 daily queue + nearby; P5 intelligence; P6 analytics.
- **Deploy**: production is a systemd service. Each phase merges to `main` only with
  tests green; `npm run build` + `systemctl restart routeflow` after a fresh
  SQLite-backup-API copy, done with the user.

## 8. Additions (2026-09-11, after the section reviews)

| # | Decision |
|---|---|
| D15 | **Price tier.** Add Lead asks «سطح قیمت منو؟» — ارزان / متوسط / گران / نمی‌دانم (`customers.price_tier`: low · mid · high · unknown). When the source is a food app (SnappFood, Tapsi Food) the step points the rep at the app's menu. |
| D16 | **Working hours.** Add Lead has a multi-step hours picker: which days → opens at → closes at → another range? (several ranges per day, e.g. ۱۲–۱۶ and ۱۹–۲۴; overnight allowed) → done, or «نمی‌دانم». Stored as `customers.working_hours_json` = `[{days:[0..6 Sat-first], from:"HH:MM", to:"HH:MM"}]`. Every next-action time is moved to the next open slot when hours are known, and the time answers show the moved time. |
| D17 | **Phone-less leads.** A lead found on a food app often has no phone — only a pin (often approximate, `location_precision='approx'`), a rough address and a price tier. Phone is optional in Add Lead. A phone-less lead's first step is a **verification visit**, by default by a **driver** on their round (`tasks.kind='verify_visit'`, `role_hint='driver'`, the lead's group), or by the rep. The driver answers a short tap flow in `/driver` — found it? open? got a number? who did you talk to? interested? — and the driver's GPS fixes the exact pin. The lead then either becomes valid (phone saved, verified, next action "first call" for its owner) or invalid (closed / not found). Drivers see only these visit tasks and the minimum to find the place: name, address, pin, hours. |
| D18 | `/leads` (map pins + lead lists) stays as it is in this phase, relabelled «پین‌های نقشه»; the pins migrate and the page retires in P4 with the daily queue. |
| D19 | Offline capture for CRM flows is deferred: no screen uses the outbox yet (`postJSON` has no callers). The 5 s undo is a client-side hold of the POST, flushed on `visibilitychange`/`pagehide`. |
| D20 | In P2, products named in a call (price asked, sample requested) are recorded in the activity's answers and in the next task's title; the structured `product_interests`, `samples` and `quotations` records arrive in P3. |
| D21 | Tap budgets per flow: after-call ≤ 5 common / ≤ 9 longest; Add Lead ≤ 7 / ≤ 12 (a capture flow collects data the business needs); driver visit ≤ 5 / ≤ 5. |

Activity rows carry the facts the replay folds, so replay never re-derives them from outcome
codes: `contact_status_to`, `stage_to`, `verification_to`, `signal`, and the flags `attempt`,
`miss`, `talked`. The verification vocabulary is: unverified · verified · renamed · moved ·
wrong_number · invalid_closed · invalid_other_business · invalid_not_fit · invalid_not_found.
