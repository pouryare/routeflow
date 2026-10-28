# Roadmap: parked features, grouped and ordered

A prioritised view of every entry in `docs/future-features.md` (F1–F148). Nothing here is promised or scheduled: every feature stays **parked** until someone writes its spec (see "How to promote an item" in that file). This page only helps choose what to promote first.

**How it was made.** The title, the "existing code noted" flag and the "needs / relates to" column are taken from each entry in the future-features file (its "Already in the app" note and its Prerequisites line), so they match it. The grouping into themes, the size and the suggested order are my judgement and are meant to be argued with.

**Size** is a rough estimate of the *first slice* described in the entry, not of the whole feature: **S** = a small change on top of code that exists (a field, a list, a button, a report from existing data); **M** = a new table or screen with some design; **L** = cross-cutting, needs infrastructure or an outside service, or changes a core flow. **Existing code noted** = the entry has an "Already in the app" note (or, for F13 and F15, a "Correction (found later)" note) describing related code (it can equally say that nothing was found, so this does not mean the feature is built); the entries that really are partly built are listed in section 6.

Totals: 46 small, 73 medium, 27 large first slices; 123 entries note existing code (121 in an "Already in the app" note, F13 and F15 in a "Correction (found later)" note); 2 entries are records of built work, not features.

**Ground facts (2026-10-23).** The database is moving to PostgreSQL, the current data is dummy, the server is in Iran, one company uses the app today (others may later), and the number of drivers is unknown. They are recorded in [section 10](#10-platform-facts-and-decisions-not-features) and affect how several entries are built.

## Contents

1. [Build these first: small first slices on existing code](#1-build-these-first)
2. [Foundations: build once, many entries depend on them](#2-foundations)
3. [Overlaps: entries that should be designed together](#3-overlaps)
4. [Suggested order](#4-suggested-order)
5. [Decisions needed before building](#5-decisions-needed-before-building)
6. [Already partly built](#6-already-partly-built)
7. [Looked like features but already exist](#7-looked-like-features-but-already-exist)
8. [Claims not yet verified](#8-claims-not-yet-verified)
9. [Every entry by theme](#9-every-entry-by-theme)
10. [Platform facts and decisions (not features)](#10-platform-facts-and-decisions-not-features)
    - [10.1 Stated and decided by the owner](#101-stated-and-decided-by-the-owner)
    - [10.2 Proposed platform choices](#102-proposed-platform-choices)
    - [10.3 Not adding yet, and what would change that](#103-not-adding-yet-and-what-would-change-that)
    - [10.4 Driver count unknown: how to size](#104-driver-count-unknown-how-to-size)
    - [10.5 Outside services to check from Iran](#105-outside-services-to-check-from-iran)
    - [10.6 Libraries: replace, add, keep](#106-libraries-replace-add-keep)
    - [10.7 Live updates: where they would be used](#107-live-updates-where-they-would-be-used)
    - [10.8 Interesting technologies (not decided)](#108-interesting-technologies-not-decided)

## 1. Build these first

Small first slices that need no new infrastructure and no outside decision, ordered roughly by how much they unblock or save. Each rests on something the entry confirms already exists.

**Status (2026-10-23): every row below is built as a first slice.** F35, F89, F99, F100, F107, F108, F110, F116, F132, F138 (part 1) and F144 came in PR #57; the rest, plus F8, F16, F23, F62, F67, F72 and F112, came in the small-difficulty batch. Each entry in `docs/future-features.md` now has a "Built (2026-10-23)" note saying what the slice covers and what it leaves out. Section 1a lists what that batch left for later.

| Order | Feature | Why it is cheap |
|---|---|---|
| 1 | F144 Failure, cancellation, return and delay reason reports | Reasons are captured on every cancel, return and failed delivery but nothing counts them; one owner report of the last 90 days by reason. |
| 2 | F99 Product catalogue change log | A generic activity log exists but the product routes never write to it; call it from create, update and deactivate. |
| 3 | F100 Customer ownership change history | An owner-change entry exists but only for pool claims; write previous and new owner from every path that changes the owner. |
| 4 | F107 Device and session management | Each user has a token version, so "sign out everywhere" needs no new storage. |
| 5 | F110 Login activity log | Sign-ins are only rate-limited in memory; store each success and failure and show the last 100 to the owner. |
| 6 | F108 System status page for the owner | Backup age, sweep time, failed notifications and data freshness already exist; one owner-only page that reads them. |
| 7 | F138 Off-site backup copy | Run an integrity check on each new backup snapshot and write a status file the status page can read; the off-site copy follows. |
| 8 | F116 Amount in words | A small, tested number-to-words function for whole toman, shown on the receipt and payment confirmation. |
| 9 | F132 Order priority flag | The order priority column and the planner's weights already exist; add the picker and a tag on the order, planner and driver stop. |
| 10 | F89 Customer price history | Order lines freeze their sale price; show the last prices per product on the customer page. |
| 11 | F98 Customer note and visit search | Notes are stored on activities and search already folds Persian letters and digits; add a notes mode to the search. |
| 12 | F101 Bulk delivery notes per run | The single-stop receipt builder and print button exist; render one per stop with page breaks and a cover sheet. |
| 13 | F54 Data quality dashboard | A manager-only list of customers missing a location, phone number or district. |
| 14 | F47 Customer 360 page | Add balance, open cheques and open complaints cards to the existing customer page, role-gated. |
| 15 | F40 Customer onboarding checklist | A four-item onboarding checklist derived from existing customer fields. |
| 16 | F84 In-app help and tooltips | The help registry and the (i) button exist; write the missing entries for the five busiest screens. |
| 17 | F133 Required training and completion tracking | Add a required-lessons list to the academy manifest and a manager table of who has finished which. Quizzes are written by managers (decided 2026-10-27), not generated by a model. |
| 18 | F142 Snooze for alerts and tasks | Snooze on tasks and reminders by moving the due date; notifications later. |
| 19 | F137 Lead source return on spend | A source report (leads, converted customers, first-90-day revenue) from data that already exists; spend entry comes later. |
| 20 | F58 Order templates and favourites | Show a "usual basket" suggestion next to the existing "same as last time" in the repeat-order flow. |
| 21 | F19 Salesperson earnings view and commission simulator | A read-only earnings card from the existing commission statements. |
| 22 | F35 Force a new password on first sign-in | A boolean on the user, a redirect to a new-password screen while it is set, cleared when the user saves one (an earlier parked item). |

### 1a. Small after a prerequisite: left for later

The small-difficulty batch built the easy entries and the two "small after a prerequisite" entries whose prerequisite it built in the same batch (F62 on F58, F112 on F84). These stay parked because their prerequisite is still missing or needs a decision: F104 (customer snapshot sheet; can be built next, it only needs the call list), F74, F77, F85, F86, F91, F114, F69, F31, F42, F34, F95, F140, F2, F5, F117 and F38. Their entries name the prerequisite.

## 2. Foundations

Entries that other entries list as a prerequisite or a close relation. Doing the first slice of one of these early removes a blocker for several others. The count is how many entries name it in their Prerequisites line (taken from the file); the table is sorted by it.

| Entry | In-degree | What it unlocks |
|---|---|---|
| F27 Audit trail and anomaly detection | 10 | a shared "who changed what" record that history, approval and security entries all want |
| F48 Change approvals (second-person sign-off) | 10 | one approval request shape that order, discount, price and credit approvals can reuse |
| F1 Camera capture (read a document instead of typing it) | 6 | barcode and label scanning that van loading, returns and bin locations want |
| F6 Live driver tracking and customer ETA | 6 | the customer message channel and the position-data policy, both needed by many entries |
| F18 Customer statements and dunning | 6 | dated statements and reminders that payment terms, promises and the cash-flow forecast feed |
| F46 Credit-risk scoring from payment behaviour | 6 | a risk signal the customer snapshot, 360 page, terms and collections use |
| F12 Returns and quality management | 5 | reason codes and batch tracing that returns, complaints and scorecards share |
| F107 Device and session management | 5 | session revocation that two-step login, the auditor role and the Telegram bot rely on |
| F58 Order templates and favourites | 4 | the "usual basket" that reorder, call-to-order, product visibility and desk entry reuse |
| F66 Supplier order tracking (purchase orders) | 3 | the incoming-stock record behind appointments, pickup runs, pre-orders and forecasting |
| F13 Offline-first everywhere | 2 | the queue for tasks, notes and call outcomes (see also F105) |
| F17 Delivery proof and dispute handling | 2 | the proof model that confirmation codes and carrier shipments extend |

Most-referenced entries by the file's own Prerequisites lines: F27 (10), F48 (10), F1 (6), F6 (6), F18 (6), F46 (6), F12 (5), F107 (5), F8 (4), F31 (4), F58 (4), F4 (3), F50 (3), F64 (3).

## 3. Overlaps

Groups of entries that cover the same ground from different angles. Design each group once, then build the entries as slices of it, so the pieces fit.

| Group | Entries | Design once |
|---|---|---|
| Customer messaging channel | F6, F79, F18, F45, F120, F55, F136, F141, F70 | decide the provider, consent and opt-out once (SMS, Telegram or WhatsApp); every customer-facing entry waits on it |
| Approvals | F48, F76, F82, F102, F129, F143, F71 | one request shape, one inbox, delegation and Telegram buttons as views of it |
| History and audit | F27, F73, F99, F100, F110, F111, F78 | a common change record instead of a table per feature |
| Purchasing side | F66, F87, F118, F121, F11, F31 | purchase orders first; appointments, pickup, pre-orders and forecasts hang off them |
| Returns and quality | F12, F42, F80, F119, F144, F17 | reasons, receiving, pickup and analytics share the same data |
| Proof of delivery | F17, F120, F139, F69 | one proof model: receiver, photo, signature, code, waybill |
| Position data | F6, F38, F68, F103 | one policy on collecting, keeping and showing staff positions |
| Credit and collections | F9, F46, F50, F18, F83, F63, F71, F49, F10 | terms and promises feed risk, statements and the cash-flow forecast |
| Customer signals | F8, F9, F28, F47, F70, F104, F77 | the same few measures (due, at risk, tier) in the list, the card and the campaign |
| Order entry shortcuts | F58, F60, F62, F72, F114, F131, F44 | usual basket, templates, warnings and desk entry on one order path |
| Pricing | F56, F65, F21, F64, F89, F83 | dated prices, uplift, promotions, minimums and discounts must agree on one price rule |
| Reporting | F14, F123, F144, F32, F134, F92, F67, F16 | one safe query layer and one set of scoped reads |
| Offline | F13, F75, F105 | one outbox and conflict policy |
| Telegram | F124, F143, F109, F106 | one worker, one identity binding, one permission check |
| Staff pay and expenses | F24, F25, F26, F88, F90, F19 | commission, attendance and reimbursements meet in the monthly summary |
| Help and content | F84, F112, F133, F39 | one content store for help, release notes and training |
| Sessions and access | F106, F107, F110, F128, F109 | sign-in security as one design |
| Backup and recovery | F34, F138, F108, F111 | backup, copy, status and restore as one chain |

## 4. Suggested order

A suggestion in waves. Within a wave the order is flexible; across waves it follows the dependencies above.

**Wave P — platform.** The move to PostgreSQL and the platform choices in [section 10](#10-platform-facts-and-decisions-not-features) come first, because every later entry is written against the new database. They are not F-entries.

**Wave 0 — quick wins.** The 22 items in section 1. They add visible value, touch little, and several (F99, F100, F110, F108, F138) are groundwork for later waves.

**Wave 1 — foundations.** First slices of F27 (audit record), F48 (one approval type), F107 → F106 (sessions, then two-step login), F66 (purchase orders, once the ordering practice is confirmed) and the single decision on the customer message channel (F6/F79). The SMS provider is decided (Farazsms); consent, opt-out and any other channel are still open.

**Wave 2 — money and orders.** F83 (payment terms) → F50 (promises) → F18 (statements) → F46 (risk) → F49 (cash-flow forecast); F58 → F60/F62/F131 (order shortcuts); F44 (standing orders); F56/F64/F65 (pricing) together; F61 (backorders) and F71/F76 (holds and approval by value).

**Wave 3 — delivery and stock.** F57 (time windows), F69 (instructions), F17 → F120 (proof and codes), F80 → F119 (returns), F30 → F94 and F93 (loading and bins), F66 → F87/F118/F121, F81 (capacity warning).

**Wave 4 — heavier or external.** F4 (telephony), F10 (bank formats), F1 (OCR), F13/F105 (more offline), F126/F127 (tenant tooling), F139 (carriers), F124/F143 (Telegram bot and approvals), F14/F123 (report builders).

## 5. Decisions needed before building

Entries blocked by a choice, not by code. Settle these once and several entries unblock.

| Decision | Entries it unblocks | Status |
|---|---|---|
| Customer message channel, provider and consent | F6, F79, F18, F45, F120, F136, F55, F70, F141 | Partly decided 2026-10-23: SMS provider is Farazsms. Consent, opt-out and other channels open |
| Staff location: collect, keep and show positions | F6, F38, F68, F103 | Partly decided 2026-10-23: source is the phone's GPS (Capacitor shell). Keeping and showing policy open |
| Where Persian text and images may be processed (device, server, a model) | F1, F3, F5, F14, F2 | Narrowed 2026-10-23: the server is in Iran, so a hosted foreign model is unlikely; device or self-hosted. Open |
| Telephony infrastructure and carrier | F4, F60 | Open (an Iranian carrier is assumed in F4) |
| Bank statement formats or a payment gateway | F10 | Open |
| Pricing policy: uplift, minimum order, early-payment discount, campaigns | F21, F56, F64, F65, F83 | Open |
| Legal and tax: e-invoicing, document numbering, payroll outputs | F147, F90 | Open |
| Off-site backup destination and who holds the key | F138, F34 | Open (the server is in Iran) |
| Credit policy: auto-pass thresholds, holds, starter limits, approvals | F46, F71, F76, F48, F129 | Open |
| How commission works across groups | F96, F134 | Open |
| Real-device testing before any build | F113, F115, F117 | Open (Maestro with one physical phone is suggested in section 10.8) |
| Android distribution route (a domestic Android store or a direct file) and iPhone support | F6, F38, F103, F1, F30 | Open (the Capacitor shell itself is decided, section 10.1) |
| When to turn on row-level security | F27, F73, F99, F100, F111, F126, F127 | Decided and built 2026-10-23: on PostgreSQL from the start, before the cut-over (section 10.2, P3) |
| One chart library or keep the custom charts | F123, F146, F32 | Open (section 10.6: decide before writing more chart types) |

## 6. Already partly built

These entries say, in their own "Already in the app" or "Correction (found later)" notes, that a meaningful part exists. Their real first slice is smaller than the title suggests.

- **F9 Churn and credit-risk scoring:** churn scoring exists; credit-risk scoring is the missing half (see F46).
- **F11 Demand forecasting and auto-purchasing:** demand forecast and reorder point exist; supplier lead times and purchase drafts are missing.
- **F13 Offline-first everywhere:** the offline layer already covers sales roles for orders, deliveries, payments, cheques, complaints and new customers; tasks, notes and call outcomes are not covered (see F105).
- **F15 Multi-warehouse and multi-branch:** stock is already location-aware, with warehouse-to-van transfers; per-branch ledgers and a first-class warehouse transfer are missing.
- **F17 Delivery proof and dispute handling:** receiver name, GPS, photo and signature columns exist on deliveries; no required-proof rule or dispute case.
- **F33 Seasonal and holiday planning:** Jalali seasonal factors exist in the forecast; holiday-period shifting is missing.
- **F51 SLA and escalation rules:** the rule engine already supports escalation windows; which SLAs are configured and a breach report are missing.
- **F61 Backorders and partial fulfilment:** partial delivery and an automatic backorder draft exist; promised dates, a list and auto-fulfilment are missing.
- **F130 Rule builder screen:** the rule engine exists; owners can only toggle a rule and change its cooldown.
- **F132 Order priority flag:** built in PR #57 (picker and tags).
- **F138 Off-site backup copy:** the integrity check and status file are built (PR #57); the off-site copy and alert are missing.
- **F143 Approve from Telegram:** push notifications already carry one-tap actions for cheques and reminders; Telegram messages have no buttons.
- **F144 Failure, cancellation, return and delay reason reports:** built in PR #57 (/sales/reasons).

## 7. Looked like features but already exist

Ideas that came up during the brainstorm and were checked against the code, then not added as features because they are built:

- **Notifications centre:** priorities, per-user type-by-channel preferences, a quiet window, a grouped feed with unread counts, push and Telegram.
- **Stock reservation:** confirming an order reserves earliest-expiry batches, records a shortfall, and releases or consumes the reservation through the order state machine.
- **Accounting period locking (enforcement):** closed fiscal periods refuse postings. What is missing is a screen or flow that closes one (not verified; none found).
- **Referrer on a lead:** customers already store who referred them; only rewards and reporting are missing.
- **Duplicate customer decision deck** and **expense receipt photo** and several mobile-first items: recorded as built in F36 and F37.

## 8. Claims not yet verified

Statements in the entries that I could not confirm from the code. Check them before relying on the entry:

- F51: which SLAs are configured today.
- F56: whether the UI can schedule a future price, and whether `price_tier` changes the price an order uses.
- F57: no code found that passes customer hours to the route solver as a time window.
- F67: the assumption that "for Friday" means a week-end report on Friday.
- F69: whether the driver stop card shows customer or order notes.
- F71: who can set `blocked` and whether it stops order entry.
- F73: how a confirmed order is edited.
- F75: whether the sales screens read the catalogue offline.
- F97: whether run planning fills the vehicle on each run (a code comment says it does not; the column exists).
- F102: whether orders awaiting review appear in a decision deck.
- F113: gestures need testing on real phones; not possible in the build container.
- F132: what feeds the urgent driver commission rate, and whether anything sets the priority value.
- F147 (document templates): how far the existing print code goes.
- Whether any screen closes a fiscal period.

Platform claims in [section 10](#10-platform-facts-and-decisions-not-features), all unverified:

- Nothing has been tested from Iran: the outside services in 10.5, package registries, Firebase push, map tiles.
- Package versions and dates come from the npm registry; no package was installed or run.
- The official `farazsms` client was found on npm but not inspected.
- Whether Centrifugo can read events from a Postgres outbox table.
- Whether the Postgres extension `pg_duckdb` fits, and DuckDB's npm "latest" tag being a development build.
- Whether the current MapLibre version still needs the right-to-left text plugin, and how Persian labels look on the vector basemap today.
- Whether Google Play and Cafe Bazaar or Myket rules allow updating web code inside the Android app.

## 9. Every entry by theme

### Customers and sales (CRM)

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F8 | Reorder prediction (who is due to order) | S |  | — |
| F20 | Daily visit route for salespeople | M | yes | F8 |
| F22 | Market and competitor price log | M |  | F1 |
| F28 | Customer segmentation and loyalty | M |  | F9 |
| F29 | Sales pipeline and quotations | L | yes | F23 |
| F40 | Customer onboarding checklist | S | yes | — |
| F41 | Visit and call quality review | M | yes | F4 |
| F43 | Shared notes and @-mentions | M | yes | — |
| F47 | Customer 360 page | S | yes | F8, F46 |
| F52 | Free samples tracking | M | yes | — |
| F53 | New product launch tracker | M |  | F21, F52 |
| F54 | Data quality dashboard | S | yes | F148 |
| F59 | Salesperson handover | M | yes | F27 |
| F70 | Segment campaigns | M | yes | F8, F9 |
| F74 | Rep daily wrap-up | S | yes | F50 |
| F77 | Customer visit frequency targets | S | yes | F20, F28 |
| F85 | Order source tracking | S | yes | F3, F4, F44 |
| F86 | Manager coaching notes | S | yes | F41, F59 |
| F91 | Call and visit quota tracking | S | yes | F41 |
| F98 | Customer note and visit search | S | yes | — |
| F100 | Customer ownership change history | S | yes | F59 |
| F104 | Customer snapshot on call pickup | S | yes | F8, F46, F47 |
| F122 | Custom fields on customers | M | yes | F98, F148 |
| F135 | Manager ride-along visits | M | yes | F86 |
| F137 | Lead source return on spend | S | yes | F28, F85 |
| F141 | Survey builder | M | yes | F45, F79 |
| F148 | Duplicate customer detection upgrade (fuzzy match, preview, undo) | M | yes | F5 |

### Orders, pricing and promotions

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F3 | Paste-to-parse (turn a pasted message into a draft) | L |  | — |
| F21 | Promotion and campaign manager | L |  | — |
| F23 | Digital catalogue and price list | S |  | — |
| F44 | Standing orders and contracts | L | yes | — |
| F56 | Price list versioning and scheduled price changes | M | yes | F21, F48 |
| F58 | Order templates and favourites | S | yes | — |
| F60 | Call-to-order shortcut | M | yes | F4, F58 |
| F61 | Backorders and partial fulfilment | M | yes | F44, F64 |
| F62 | Customer-specific product visibility | S | yes | F58 |
| F64 | Minimum order and delivery fee rules | M | yes | — |
| F65 | Small-quantity price uplift | M | yes | F48, F56, F64 |
| F71 | Customer credit holds by rep | M | yes | F48 |
| F72 | Duplicate order warning | S | yes | — |
| F73 | Order edit history | M | yes | F27, F48 |
| F76 | Order approval by value | M | yes | F48, F51 |
| F89 | Customer price history | S | yes | F29, F56 |
| F96 | Inter-group order transfers | L | yes | F48 |
| F114 | Carton completion nudges | S | yes | F58, F65 |
| F121 | Pre-orders against incoming stock | L | yes | F61, F66 |
| F131 | Keyboard-first desk order entry | M | yes | F58 |
| F132 | Order priority flag | S | yes | F28, F64 |
| F145 | Counter sales and customer pickup | L | yes | F63 |

### Delivery, routing and drivers

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F6 | Live driver tracking and customer ETA | L |  | — |
| F7 | Dynamic re-routing during the day | L |  | F6 |
| F17 | Delivery proof and dispute handling | M | yes | — |
| F24 | Driver pay and incentives | M |  | — |
| F38 | Automatic arrival and departure (geofencing) | S | yes | F6 |
| F45 | Customer feedback loop (delivery rating) | M | yes | F6, F18 |
| F57 | Delivery time windows | M | yes | F38 |
| F68 | Rep activity map | M | yes | F6, F38 |
| F69 | Delivery instructions (per customer and per order) | S | yes | F57 |
| F78 | Driver map pin correction | M | yes | F27 |
| F79 | Late-delivery notices to customers | M | yes | F6 |
| F81 | Peak-day capacity warning | M | yes | F25, F57 |
| F97 | Vehicle assignment history | M | yes | — |
| F101 | Bulk delivery notes per run | S | yes | F147 |
| F103 | Rep mileage log | M | yes | F68, F88 |
| F115 | Voice read-out for drivers | M | yes | F69, F117 |
| F118 | Supplier pickup runs | L | yes | F31, F66 |
| F119 | Return pickup scheduling | M | yes | F12, F80 |
| F120 | Delivery confirmation code | M | yes | F6, F17, F79 |
| F139 | Third-party carrier shipments | L | yes | F17 |

### Stock, warehouse and suppliers

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F11 | Demand forecasting and auto-purchasing | L | yes | — |
| F12 | Returns and quality management | M |  | F1 |
| F15 | Multi-warehouse and multi-branch | L | yes | — |
| F30 | Van loading verification | M |  | F1 |
| F31 | Supplier scorecards and price history | S | yes | F12 |
| F33 | Seasonal and holiday planning | M | yes | F11 |
| F42 | Complaint root-cause analytics | S | yes | F12, F31 |
| F66 | Supplier order tracking (purchase orders) | L | yes | F11, F31 |
| F80 | Warehouse returns handling | M | yes | F12 |
| F87 | Warehouse receiving appointments | M | yes | F31, F66 |
| F93 | Warehouse bin locations and stock transfers | M | yes | F1, F30 |
| F94 | Warehouse picking accuracy log | M | yes | F30 |

### Money: credit, payments and cash

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F9 | Churn and credit-risk scoring | M | yes | — |
| F10 | Bank and payment reconciliation | L |  | F5 |
| F18 | Customer statements and dunning | M |  | F10 |
| F46 | Credit-risk scoring from payment behaviour | M | yes | — |
| F49 | Cash-flow forecast | M | yes | F46, F50 |
| F50 | Payment promise tracker | M | yes | F18, F46 |
| F63 | Deposits and prepayments | M | yes | F46 |
| F83 | Payment terms and early-payment discounts | M | yes | F18, F46, F50 |

### Accounting, analytics and reporting

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F14 | Natural-language reports ("ask your data") | L |  | — |
| F16 | Owner mobile dashboard with push alerts | S |  | — |
| F32 | Margin analytics (customer, product, route) | M | yes | — |
| F34 | Data export and backup self-service | S | yes | F27 |
| F67 | Friday weekly scorecard | S | yes | — |
| F90 | Monthly staff pay summary for the accountant | M | yes | F25, F27, F88 |
| F92 | Territory revenue map | M | yes | — |
| F116 | Amount in words | S | yes | F18, F147 |
| F123 | Report builder with saved reports | L | yes | F14 |
| F134 | Profit and loss by group | M | yes | F32 |
| F144 | Failure, cancellation, return and delay reason reports | S | yes | F12, F42 |
| F147 | Document templates (invoices, delivery notes, statements) | M |  | F18 |

### People, approvals and management control

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F19 | Salesperson earnings view and commission simulator | S | yes | — |
| F25 | Staff scheduling and attendance | L |  | — |
| F26 | Field expenses and petty cash | M |  | — |
| F27 | Audit trail and anomaly detection | M | yes | — |
| F48 | Change approvals (second-person sign-off) | M | yes | F27 |
| F51 | SLA and escalation rules | M | yes | — |
| F82 | Approval delegation while away | M | yes | F27, F48 |
| F88 | Staff expense reimbursement | M | yes | F26, F48 |
| F95 | Staff birthdays and work anniversaries | S | yes | F86, F90 |
| F102 | Manager approval inbox | M | yes | F48, F76, F82, F88 |
| F129 | Approval chains | L | yes | F48, F76, F82, F102 |
| F130 | Rule builder screen | L | yes | F51 |
| F133 | Required training and completion tracking | S | yes | F84, F112 |

### Platform, security and administration

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F35 | Force a new password on first sign-in | S |  | — |
| F99 | Product catalogue change log | S | yes | F27 |
| F106 | Two-step login for owners and managers | L | yes | F107 |
| F107 | Device and session management | S | yes | F106 |
| F108 | System status page for the owner | S | yes | F34 |
| F109 | Self-service password reset | M | yes | F106, F110 |
| F110 | Login activity log | S | yes | F27, F107 |
| F111 | Recycle bin | M | yes | F27, F34 |
| F125 | Wallboard display | M | yes | F108 |
| F126 | Organisation setup wizard | L | yes | F109, F127 |
| F127 | Tenant usage and plan limits | M | yes | F108, F126 |
| F128 | Read-only auditor role | L | yes | F107, F110 |
| F138 | Off-site backup copy | S | yes | F34, F108 |
| F140 | Company asset register | S | yes | F59, F107 |

### Mobile experience, input, offline and help

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F1 | Camera capture (read a document instead of typing it) | L |  | — |
| F2 | Voice input (speak instead of typing a note) | S |  | — |
| F5 | Persian text proofing (help users type clean Persian) | S | yes | F1, F3 |
| F13 | Offline-first everywhere | L | yes | — |
| F39 | Training and onboarding mode | M | yes | — |
| F75 | Offline product catalogue for reps | M | yes | F13 |
| F84 | In-app help and tooltips | S | yes | — |
| F105 | Offline tasks and notes | M | yes | F13 |
| F112 | What's new notes | S | yes | F84 |
| F113 | Radial quick-action menu and home-screen shortcuts | M | yes | — |
| F117 | Haptic and sound feedback settings | S | yes | F1, F30 |
| F142 | Snooze for alerts and tasks | S | yes | — |
| F146 | Role-based dashboard builder | M | yes | — |

### Telephony and messaging channels

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F4 | Wazo VoIP inside the CRM/ERP (call from, and log to, the customer record) | L |  | — |
| F55 | Owner announcements with read receipts | M | yes | — |
| F124 | Telegram bot for staff queries | L | yes | F107 |
| F136 | Message template editor | M | yes | F18, F79, F120 |
| F143 | Approve from Telegram | M | yes | F82, F102, F124 |

### Records of built work (not future features)

| ID | Feature | Size | Existing code noted | Needs / relates to |
|---|---|---|---|---|
| F36 | Duplicate customers as a decision deck — built | — |  | — |
| F37 | Decisions from the mobile-first rollout | — |  | — |

## 10. Platform facts and decisions (not features)

Not an F-entry. This records what the owner stated and decided on 2026-10-23 and what follows from it for the entries above.

How to read it: **10.1 is fact and decision** (the owner's words). **10.2 to 10.8 are proposals**, meant to be argued with. Package versions and dates were read from the npm registry on 2026-10-23; nothing was installed or tested, including from Iran. Per the "look for existing solutions" rule in `CLAUDE.md`, each proposal is compared with alternatives and put to the owner before anything is adopted.

### 10.1 Stated and decided by the owner

| Fact or decision | What it means |
|---|---|
| The database moves from SQLite to PostgreSQL. | Decided. It replaces "stay on SQLite" in `docs/crm-erp-plan.md` (Part 0 row 12, Part 2). The condition set there, every query behind `lib/repo`, is met. |
| The data in the current database is dummy. | Nothing has to be carried over. Postgres starts from one clean baseline schema and is filled from the seed scripts. The eight step-by-step migrations, the table-rebuild code, the boot-time backfills and the real-data migration tests exist to upgrade old SQLite files and are not needed (check each backfill before dropping it); the reference-data seeds (roles, reason codes, notification types, chart of accounts) are. |
| The production server is in Iran. | Self-host everything and use no paid foreign API or key, the rule already followed for OpenStreetMap, Open-Meteo, OSRM and VROOM. Every outside service must be checked from the server and from a phone on an Iranian network (list below). |
| One company uses RouteFlow today; other companies may later. | Keep one database with `organization_id` (`docs/crm-erp-plan.md`, decision 1). F126 and F127 stay parked until a second company is signed. |
| The number of drivers is unknown and cannot be predicted. | No design may assume a fleet size. Size by formula and watch the thresholds below. |
| RouteFlow gets an Android app: the web app wrapped in a Capacitor shell. | Decided. Needed because a PWA gets background location only while open (F6, F38, F103); also gives native barcode scanning and Bluetooth printing. Distribution route (domestic Android store or a direct file) is still open. |
| SMS provider: Farazsms. | Decided. The official npm client `farazsms` (1.1.0, 2026-06-21) exists and has not been inspected; decide between it and a thin wrapper when the SMS slice starts. Consent, opt-out and any other customer channel stay open. |
| Staff positions come from the phone's GPS for now. | Decided. No dedicated trackers, so a tracker server such as Traccar is not needed yet. Revisit if vehicles get hardware trackers. |
| Amount in words (F116) uses our own small function, not `@persian-tools/persian-tools`. | Decided 2026-10-23. `lib/amountWords.ts`; one dependency fewer, wording under our control. |
| PostgreSQL is self-hosted on the owner's own server; ArvanCloud is dropped. | Decided 2026-10-23. Arvan's managed database is MySQL only anyway. A repo Dockerfile (Postgres 18 plus the extensions below) serves CI and local development. |
| Install every extension this roadmap names: PostGIS, `pg_trgm`, `btree_gist`, `pg_stat_statements` and `pg_duckdb`, with `wal_level = logical`. | Decided 2026-10-23. `pg_duckdb` comes from the Pigsty apt repository, not PGDG, and needs `shared_preload_libraries`. |
| Driver and queries: `pg` behind the existing `Db` interface (a thin wrapper turns `?` into `$n`), with Kysely for new typed queries. Not Prisma. | Decided 2026-10-23 (owner: "Defaults"). |
| Schema tooling: node-pg-migrate (plain SQL files), kysely-codegen (types, checked for drift in CI), Squawk (lints each migration in CI), and a committed `db/schema.sql` from `pg_dump --schema-only`. | Decided 2026-10-23. Atlas was rejected: it is a Go binary downloaded from abroad, which is hard from Iran. |
| Row-level security is enforced before the cut-over, not after. | Decided 2026-10-23. |
| Off-site backup goes to a second machine the owner controls, over SSH; self-hosted S3 can come later. | Decided 2026-10-23. |
| The UI moves to HeroUI v3 with the full HeroUI look. | Decided 2026-10-23 (owner chose "full HeroUI look" over keeping the Meridian look on HeroUI parts). `@heroui/react` and `@heroui/styles` 3.2.6, MIT, built on React Aria Components; no HeroUI Pro (paid, foreign). HeroUI's theme becomes the visual system and MASTER.md's colour, radius and base-component rules are retired as screens move. Our component names (`BottomSheet`, `useToast`, `FilterChips` …) stay during the move so callers change once. Persian calendar and digits through `I18nProvider locale="fa-IR-u-ca-persian"`; `lib/jalali.ts` stays for storage. Styles are imported part by part, because the full sheet restyles `.card`, `.chip`, `.badge`, `.modal` and `.skeleton`. Phase 0 and the payment-flow pilot are done (TapFlow sheet, date step, buttons, toasts), and phase 2 (every sheet on one Drawer; card help, profile menu and bell in Popovers, each with a written reason in `check:mobile`; banners as Alerts), and phase 3 (Shamsi date fields on HeroUI's Persian Calendar in a sheet, switches and checkboxes, no `<select>` left, password and login fields on HeroUI's TextField, colour and font pickers in Popovers), and phase 4 (section and view tabs on HeroUI Tabs at 44 px, Chip, Avatar, Skeleton, EmptyState, collapsible sections on Disclosure, accounting tables and pager in HeroUI's table and pagination look on their own server markup), and phase 5 (every flow, picker and deck answer on HeroUI Button / ToggleButton through `components/tapflow/Answer.tsx`, SearchField for list search, day chips as ToggleButtons; Keypad, SwipeRow, the bottom bar and the signature cards restyled with HeroUI tokens), and phase 6 (HeroUI token names hold the palette inside `.meridian`, the older names are aliases, dead CSS removed, MASTER.md rewritten around HeroUI); the per-component map and order are in the plan page linked from `TODO-REPORT.md`. |

### 10.2 Proposed platform choices

The PostgreSQL rows here are now decided (10.1). The plan is phased: P1 an asynchronous `Db` interface and portable SQL while still on SQLite (done 2026-10-23: every call is awaited, transactions go through `db.tx()`, lint catches a forgotten `await`, and `tests/sql-dialect-guard.test.ts` refuses SQLite-only SQL outside `lib/database/`); P2 the Postgres baseline schema, the `pg` adapter and a CI run against Postgres (done 2026-10-23: `db/` has the image and the generated baseline, `DB_DIALECT=postgres` switches the app to `lib/database/pg.ts`, and CI runs the unit suite on Postgres against `tests/pg-known-failures.txt`, 77 files at the start); P3 green on Postgres, the `xid8` sync watermark and row-level security (done 2026-10-23: `tests/pg-known-failures.txt` is empty and files that only make sense on SQLite are listed with a reason in `tests/pg-sqlite-only.txt`; the demo seed builds a separate `routeflow_demo` database; each synced table carries a trigger-set `sync_xid` and the pull watermark is `x:<snapshot xmin>`; the app connects as `routeflow_app`, which is subject to a per-company policy on every table with `organization_id`, keyed on `rf.scope` set before each statement from the signed-in session); P4 the server, backups and cut-over by re-seeding (done 2026-10-27: `db/server/install.sh`, pgBackRest to two repositories with a monthly restore drill, `scripts/pg/doctor.mjs`, `docs/postgres-server.md`); P5 removing the SQLite code (done 2026-10-27 in the same pull request: the SQLite client, boot migrations, backfills, `DB_DIALECT` and the SQLite-only tests and scripts are gone, `npm test` runs on PostgreSQL, CI is one job, and the baseline migration is hand-owned).

| Choice | Serves | When |
|---|---|---|
| PostgreSQL, self-hosted, with `wal_level = logical`, PostGIS, `pg_trgm`, `btree_gist` and `pg_stat_statements` | everything; geofencing (F38), rep map (F68), mileage (F103), search (F98, F148, F10, F3) | with the move |
| Row-level security keyed on a per-transaction organisation setting; the same setting feeds one audit trigger | tenant safety now and when a second company arrives; F27, F73, F99, F100, F111 | with the move (`organization_id` already exists on the tenant tables) |
| `pg` with Kysely (types generated from the database) and plain SQL migration files; not Prisma | everything | with the move |
| A pg-boss worker process: retries, schedules, jobs enqueued in the same transaction as the write | sweeps, F16, F18, F67, F79, F127, F138 | with the move |
| Real Postgres in tests, one template database per test file | the database tests | with the move |
| Backups with point-in-time restore (pgBackRest or WAL-G) and an encrypted off-site copy; self-hosted error tracking and uptime check | F34, F108, F138 | with the move, early |
| S3-compatible object storage, self-hosted | F1, F17, F26, F34, F147 | first wave that stores files |
| Chromium print-to-PDF in the worker (Playwright is already a dependency) | F18, F101, F147 | when F147 starts |
| A message-channel adapter with a consent table and an outbox; first provider Farazsms | F6, F18, F79, F120, F106, F109 | with the first SMS slice |
| Valkey and server-sent events | F6, F125, the F4 screen pop; shared rate limits and one-time codes | with the first live feature, not with the Postgres cut-over (2026-10-24: one change at a time; Postgres covers cache, queue and pub/sub at this size) |
| Self-hosted OSRM and VROOM and own map tiles | F6, F7, F57, F103 | before live tracking |
| A Capacitor Android shell with a background-geolocation plugin (`@capacitor-community/background-geolocation`, 1.3.1, updated Oct 2026; untested) | F6, F38, F103, F1, F30 | before F6 starts |
| Wazo | F4 | wave 4 |
| OCR, speech and language models on the device or a self-hosted server, behind an interface | F1, F2, F3, F5, F14 | wave 4 |
| A read replica and materialised views for reports | F14, F123, F32, F134 | when reports get heavy |

### 10.3 Not adding yet, and what would change that

| Not now | Why | Revisit when |
|---|---|---|
| Elasticsearch, Meilisearch | Search here is short names, phones, notes and product names, and the Persian letter and digit folding already lives in `lib/persian.ts`. `pg_trgm` on a normalised column does fuzzy matching in SQL. A second search copy has to be kept in sync and does not obey row-level security, so every query would repeat the tenant filter, the kind of leak the 2026-10-22 audit found about twenty times. | Search over the real row counts stays slower than about 150 ms after indexing, or instant typo-tolerant search across many entity types with facets is wanted. Try Meilisearch first and test its Persian handling. |
| Kafka, RabbitMQ | A broker is a second system whose messages can disagree with the database (an order saved with no message, or the reverse). pg-boss queues the job in the same transaction as the write. Volumes are far below what a Postgres queue handles: orders are hundreds per day, and GPS pings are a few dozen inserts per second even with a thousand drivers. Kafka also needs a cluster to run, and container images can be hard to pull from Iran. | Several independent services must consume the same event stream, or a Postgres queue shows contention at sustained thousands of jobs per second. NATS JetStream or Valkey Streams are the lighter step before Kafka. |
| Kubernetes | One Next.js process behind Caddy, one Postgres, one worker and a few helpers fit on one or two machines under systemd or docker compose. Kubernetes adds a control plane, networking, storage and upgrades to run yourself, and the big clouds' managed offerings are not an option from Iran. More companies do not need it: they share one deployment through `organization_id`. | More than three or four app nodes, autoscaling, a dedicated operations person, or a customer who needs its own isolated deployment. |
| Microservices | Orders, ledger postings, stock reservations and commission must commit together; splitting them turns one transaction into distributed sagas. `lib/repo` and the architecture checks already give module boundaries inside one deployable. The worker, OSRM, VROOM, the Telegram poller and the Wazo listener are extra processes of the same codebase or stateless helpers, not services with their own databases. | Separate teams, or a part that needs a different runtime or independent scaling (for example a Python OCR helper with a narrow API). |

### 10.4 Driver count unknown: how to size

Position pings per day = drivers × hours on the road × 3600 ÷ ping interval in seconds. At a 30 second interval and 8 hours that is 960 pings per driver per day, about 350,000 per driver per year.

| Drivers | Pings per day | Inserts per second while all are on the road |
|---|---|---|
| 100 | 96,000 | about 3 |
| 1,000 | 960,000 | about 33 |
| 10,000 | 9,600,000 | about 333 |

A rough ladder, from judgement and not from measurement:

- **Up to a few hundred drivers:** one table partitioned by month, batch inserts, one "last position" row per driver. Keep raw pings 90 days, then keep a simplified line (PostGIS `ST_Simplify`) and drop the rest.
- **Around a thousand:** move "last position" to Valkey, write pings in batches, read from a replica.
- **Several thousand:** revisit with real numbers. This is where a dedicated time-series or streaming store becomes a topic.

### 10.5 Outside services to check from Iran

Nothing here has been tested from Iran. Check each from the server and, where a phone calls it, from a phone on an Iranian mobile network.

| Called by | Service | Used for |
|---|---|---|
| Server | `api.open-meteo.com`, `air-quality-api.open-meteo.com` | weather and air quality (`lib/weather`) |
| Server | `api.telegram.org` | staff notifications and the link worker (`lib/telegram.ts`, `scripts/telegram-poll.ts`); Telegram has been filtered in Iran |
| Server | `nominatim.openstreetmap.org` | resolving pasted map links (`lib/resolveMapsLink.ts`) |
| Server | push services of Google, Mozilla, Apple and Microsoft (`lib/pushEndpoint.ts`) | web push |
| Server and phones | `router.project-osrm.org` | route matrix and corridors; the public demo server, not meant for production load |
| Phones | OpenStreetMap, Carto, Stadia, MapTiler and Esri tile hosts (`next.config.ts`) | map backgrounds |
| Build and deploy | npm registry, container registries, GitHub releases | installing and updating; often restricted from Iranian servers, so check before choosing a tool that ships only as a container image |

If one fails: self-hosted OSRM and VROOM and own map tiles move earlier in the order; an Iranian SMS gateway or a domestic messenger (for example Bale or Eitaa, to be evaluated) takes over staff messages from Telegram. Most hosted foreign model APIs are not available from Iran, so F1, F2, F3, F5 and F14 plan for on-device or self-hosted models.

### 10.6 Libraries: replace, add, keep

From the 2026-10-23 review of what the code builds by hand. The codebase has almost no third-party libraries besides Leaflet and its plugins, framer-motion, sharp, exceljs, web-push and Playwright.

**Where a library does better than the current code**

| Area | Today | Change |
|---|---|---|
| Input validation | 161 route files, about 79 hand-written type checks, `lib/inputChecks.ts`; the audit fixed unvalidated dates, amounts and lengths route by route | A schema per route: Zod, or Valibot for code shared with the client |
| CSV export | `lib/csv.ts` (15 lines) does not neutralise cells starting with `=`, `+`, `-` or `@`; phones lose their leading zero in Excel | A formula guard, from a CSV library or a few lines |
| Password hashing | `scryptSync` at Node's default cost (N=16384), stored as `salt:hash`; below OWASP's current minimum (N=2^17) and the format cannot carry parameters | Argon2id (a native package: check it installs from Iran) or scrypt with proper parameters and a self-describing format. Cheap now because the data is dummy |
| Maps | Two stacks: 22 files on Leaflet with 8 Leaflet packages, 1 file on MapLibre; `leaflet-routing-machine` and `leaflet.heat` last published 2022 | Standardise on MapLibre before F6, F68 and F92 (clustering, heatmap, fullscreen and geolocation are built in; handles many moving points; fits PostGIS vector tiles) |
| Geometry | `lib/geo.ts` and `lib/simplify.ts` (about 450 lines); the corridor band only approximates a buffer | PostGIS (`ST_Distance`, `ST_Buffer`, `ST_Simplify`) on the server; no new library |
| Overlays and date picker | Hand-built toasts, hotkeys, Jalali date picker and sheets with hand-set ARIA | Decided: HeroUI v3 on React Aria (see 10.1). Toasts, every bottom sheet, the date step, card help, the profile menu, the bell, the banners, the Jalali pickers, switches, checkboxes, password fields, tabs, disclosures, chips, avatars, skeletons and empty states have moved; other text fields, the search overlay and the flow, picker and deck answers have moved too; the filter chips, the «بیشتر» menu links and the other text fields follow. Leftovers done 2026-10-27: answer links and buttons, filter chips and all text fields are on HeroUI parts, `.meridian` rules use the HeroUI colour names, and a filter group with 9 or more options opens a searchable sheet. Extras added 2026-10-27: the (?) help (Popover), Spinner in saving buttons, ProgressBar, Kbd, Tag, ListBox and a sortable Table on the margin report; a Dropdown, Modal or Select as separate parts wait for a screen that needs them |

Lower priority: the hand-written service worker (`public/sw.js`, manual cache versions) could move to Serwist if stale-cache bugs appear.

**Add for roadmap features**

| Library | Serves | Note |
|---|---|---|
| `@persian-tools/persian-tools` (4.0.4, Dec 2025) | F116 amount in words, F5 half-space fixes, F10 Sheba and card-to-bank checks, national ID validation | Test the number-to-words output on real toman amounts |
| `libphonenumber-js` | F4 caller matching, F79 and F106 SMS, duplicate detection (`lib/crm/phone.ts` is 44 lines) | Use the `min` build |
| grammY | F124 and F143 (`scripts/telegram-poll.ts` understands only `/start`) | Supports a custom API root, useful from Iran; whether Bale or Eitaa accept the same calls is unverified |
| pino and a GlitchTip-compatible SDK | F108, structured logs | Replaces `console.*` and the `slowSql` wrapper |
| `@tanstack/react-virtual` | long lists on phones; no list is virtualised today | `content-visibility: auto` is a free first step |
| One SVG chart library | F123, F146, F32 | Keep the 4 custom charts (749 lines); decide before writing more chart types; test Persian digits and right-to-left first |
| `rate-limiter-flexible` with a Valkey or Postgres store | shared rate limits once there is more than one app instance | `lib/rateLimit.ts` is in-memory and right for one process |
| `@simplewebauthn/server` | F106 two-step login | Passkeys on top of the existing TOTP; test on the real Android phones |
| `zxing-wasm` | F1 and F30 barcode scanning | For browsers without `BarcodeDetector`; try the browser API first |
| `bwip-js` | Batch and bin labels (F30, F93) | QR and Code 128 as image or SVG; also the way to draw a QR code, which the app does not do today |
| `pmtiles` | Own map backgrounds | A single-file basemap served from the own server and read by MapLibre; removes the dependency on public tile hosts |
| `csv-parse` and `iconv-lite` | F10 bank statements, lead import | Proper CSV parsing, and conversion of older Windows-1256 files; test with a real bank statement |
| `archiver` | F34 data export | Streams a zip of many CSV files without holding them in memory |
| `@opentelemetry/sdk-node` | F108 status page, tracing | Next.js supports it through `instrumentation.ts`; send to a self-hosted collector |
| `p-queue` | Throttling of outside calls | Replaces the hand-written gate in `lib/resolveMapsLink.ts`; also useful for SMS and OSRM limits |
| `react-querybuilder` (8.25.0) | F130 rule builder, F123 report builder | Builds a validated filter structure that is turned into parameterised SQL, which fits the rule "never raw SQL from the user" |
| `json-logic-js` (2.0.5, last release July 2024) | F130 stored rule conditions | Option for storing conditions as JSON; check whether the query-builder format is enough before adding it |
| AG Grid Community (36.2.0) | F131 keyboard-first desk order entry | Spreadsheet-style editing; check right-to-left and Persian digit behaviour first |
| `web-vitals` (6.2.3), sent to the own server | real-user timings from phones on Iranian networks | Lab tests cannot show these |
| `react-error-boundary` (6.1.6) | Every chart, sheet body, header widget and map | Added 2026-10-27 as `components/WidgetBoundary.tsx` |
| `lru-cache` (11.5.3) | Hot lookups on the server (price lists, permissions) | Cap its memory; one process only, so it is not shared between app servers |
| `valibot` (1.5.0) | Validating request bodies at the API edge, unknown keys dropped | Use for new routes; no rewrite of old ones |
| `nuqs` (2.10.2) | Filters and tabs kept in the address (F98, F123, lists) | Check it against our own `useFilter` before replacing it |
| `@tanstack/react-query` (5.105.0) | The chat screen and live panels only (infinite message list, updates from server-sent events) | Not app-wide: it would overlap the offline sync engine and server components |
| `@tanstack/react-table` (9.3.1) | The keyboard-first order entry grid (F131) | Later; v9 is a recent major, read its migration notes; compare with AG Grid above. Reports stay server pages |
| `react-hook-form` (7.91.0) | The few long forms (customer create, product) | Later; tap flows and short forms stay plain controlled fields |
| `jose` (6.2.13) | Signed one-time links and wallboard display keys (F125, F6 tracking page) | Later; Node `crypto` HMAC is enough for one simple signed link |
| `nanoid` (6.0.2) | Short public codes (tracking links, ticket numbers) | Later; custom alphabet without 0, O, 1, l. Row keys stay UUIDv7 |
| `microdiff` (1.6.0) | Showing «what changed» on a record in the UI | Later; the database audit trigger stays the record of truth |
| `canvas-confetti` (1.9.4) | Reward after a finished lesson or tour (F39, F133) | Later; skip when `prefers-reduced-motion` |
| `idb` (8.0.4) | A nicer IndexedDB wrapper | Later, only if `lib/offline/idbStore.ts` gets awkward |
| `papaparse` (5.7.0) | Previewing a CSV in the browser before upload (F10, F126) | Later; the server side stays `csv-parse` + `iconv-lite` above |
| `sanitize-html` (2.18.1) | Rendering rich notes (F43) | Later, only if notes become HTML; plain text or Markdown needs no sanitiser |
| BroadcastChannel (browser built-in) | Sign out everywhere across open tabs (F107) | Nothing to install |
| Zustand (5.0.16) | Client state shared by distant components (chat unread count, an active tour) | Later; React context first |
| Action-gated tours (driver.js, joyride or HeroUI Popover as the spotlight) | F39 training mode | Later; one tour on the order screen first; check right-to-left behaviour |

**Small-difficulty batch (2026-10-23): no new library.** All 18 entries were built on existing code: the browser's print path for the price list and run notes, the commission engine, the briefing panels, the notification flush and `users.prefs_json`. Nothing was added to `package.json`.

**Keep as is**: `lib/jalali.ts` (tested against Intl over twenty years), TOTP, UUIDv7, the thermal-receipt PDF and ESC/POS code (Chromium print-to-PDF only for A4 documents), the offline outbox, the VROOM fallback.

**Building and testing, and only if needed**

`@testcontainers/postgresql` (a real Postgres with PostGIS per test run), `fast-check` (property tests for money, ledger and commission), `@faker-js/faker` with the Persian locale (the demo seeding fetches portraits from `randomuser.me` today), `@axe-core/playwright` (accessibility checks in CI). Only if the need appears: `jose` (signed one-time links, wallboard display keys), `ical-generator` (F87). Not needed: client-side search libraries (`pg_trgm` does it), `node-cron` and BullMQ (pg-boss), date libraries (`Intl` and `lib/jalali.ts`).

**Shortlist audit (2026-10-27).** The owner short-listed about 60 libraries from a chat with Gemini; the audit and its reasons are in the project file `audits/shortlist-audit-2026-10-27.md`. Decisions:

- **Added now:** `react-error-boundary` 6.1.6 (exact), behind one `components/WidgetBoundary.tsx`. It sits in `ChartFrame` (every chart), `BottomSheet` (every sheet body), the header's search and bell, the sync island, and every map.
- **Adopt when the feature starts:** `pino`, `web-vitals`, `lru-cache`, Valibot, `nuqs`, `@tanstack/react-virtual`. TanStack Query only on the chat screen and live panels. Each one has a row in the table above.
- **Later:** `rate-limiter-flexible` (with more than one app server), `jose`, `nanoid` (short public codes only), `microdiff`, `canvas-confetti`, TanStack Table (desk order entry), React Hook Form, Zustand, `idb`, PapaParse (browser preview), `sanitize-html`, action-gated tours. Each one has a row in the table above.
- **Owner decision, stay on one server as long as possible:** no Centrifugo for now. Chat runs on PostgreSQL plus server-sent events and an `events` table with an increasing id, so a phone that lost signal catches up from `Last-Event-ID`. Revisit with a second app server or presence.
- **Owner decision, quizzes are written by managers:** no AI-generated quizzes for now (a hosted foreign model is unlikely from Iran, 10.2). They belong with the academy and F133.
- **Not used, already covered:** Fuse, MiniSearch, FlexSearch (`pg_trgm`); Graphile Worker, `node-cron` (pg-boss); `p-limit` (`p-queue`); ULID, cuid2 (UUIDv7); `date-fns` (Intl and `lib/jalali.ts`); AutoAnimate (framer-motion); tinykeys (`lib/hotkeys.ts`); clipboard-copy (`lib/clipboard.ts`); `localforage` (`lib/offline/idbStore.ts`); `@xstate/fsm` (`lib/orderStateMachine.ts`).
- **Rejected:** `solve-tsp` and `javascript-tsp` (not on npm), `glpk.js` (GPL-3.0), `link-preview-js` (the server would fetch any URL).

### 10.7 Live updates: where they would be used

Added 2026-10-23 from a review of the code and these docs. The candidates in the last group are inferred, not stated in the entries.

**What polls today (current code)**

| Place | Today |
|---|---|
| `components/CoverageMap.tsx` | Re-asks for customers every 45 seconds and when the tab becomes visible |
| `components/NotificationBell.tsx` | Re-asks for the unread count every 60 seconds |
| `components/LeadImportPanel.tsx` | Polls the job status while a lead import runs |
| Orders pipeline, runs view, order status panel | Refresh only after the user's own action, so a coworker's change shows only after they act or reload |

**Named in the entries**: F6 (live driver positions and ETA), F125 (wallboard; the entry notes nothing refreshes by itself today), F4 (incoming-call screen pop).

**Inferred candidates**: F38 and F68 (arrival events, rep activity map); F7 (a re-route proposal reaching the dispatcher or driver); F55 and F16 (announcements, owner alerts); F102 and F143 (an approval request reaching a manager, the answer going back); F107 (sign out everywhere closing open tabs); F13 and F105 (a "the server has news, pull now" signal for the offline sync); F30 and F94 (van loading progress visible to the office); F61 and F121 (stock arrived, a backorder can ship); progress of long jobs (exports F34, OCR F1, route optimisation, setup wizard F126).

**What a live-updates server such as Centrifugo adds beyond plain server-sent events**
- Presence: who is online or looking at the same order (helps F73 and conflicts in offline sync).
- Catch-up after a gap: a phone that lost signal asks for what it missed, which suits offline-first.
- Per-company and per-group channels with signed access tokens, which fits serving other companies later.
- Shared planning boards where two dispatchers see each other's moves.
- Live dashboard widgets (F16, F146) in place of polling loops.
- Several transports (WebSocket, SSE and fallbacks), which may help on filtered or unreliable networks.
- Possibly events read from a Postgres outbox table, so an event is saved in the same transaction as the business write. Unverified: check before relying on it.

**Limits**
- It reaches only screens that are open. A closed app still needs web push, SMS (Farazsms) or Telegram.
- It is one more service to run; with several nodes it needs Valkey or NATS behind it, which is the same moment Valkey is added anyway.
- Writes keep going through the app's API, so money and stock rules stay in one place.
- Untested from Iran. Per the "look for existing solutions" rule in `CLAUDE.md`, compare it with plain SSE plus Valkey pub/sub and other options before adopting it.

**Recommendation**: start with server-sent events on one server; bring in Centrifugo when more than one app server runs or presence is wanted.

**Decided 2026-10-27 (owner): stay on one server as long as possible.** Centrifugo is not added. Chat is built on PostgreSQL: the message row, then an `events` row with an increasing id, streamed over server-sent events; a phone that lost signal sends `Last-Event-ID` and gets what it missed. Presence waits for a second app server.

### 10.8 Interesting technologies (not decided)

Ideas that are interesting for this app but not chosen. None is decided; the owner picks which to pursue (see the intro to section 10).

| Technology | What it is, in plain words | Where it could help | Note |
|---|---|---|---|
| Local-first sync: Yjs (13.6.33) or Automerge (3.5.0) for merging edits; PowerSync (`@powersync/web` 2.5.0) or Electric (`@electric-sql/client` 1.5.28) for copying Postgres data to the device | Everyone edits their own copy, offline, and the copies merge when phones reconnect | Shared notes (F43), offline tasks and notes (F105), the offline catalogue (F75), two dispatchers editing one day plan | Keep the current outbox for money and stock; this is for notes, planning and read-only data. `wal_level = logical` is already proposed, which these need |
| Durable workflows: DBOS (`@dbos-inc/dbos-sdk` 5.3.0) | A to-do list that survives a power cut: it remembers which step it was on and carries on | Approval chains (F129), payment reminders that wait days (F18, F50), standing orders (F44) | Runs on Postgres. pg-boss covers single jobs; this is for multi-step processes |
| DuckDB (browser build `@duckdb/duckdb-wasm`, whose npm latest tag is a dev build; Node client `@duckdb/node-api`; or the `pg_duckdb` Postgres extension, unverified) | A fast calculator next to the database that counts large piles quickly | Margin by customer, product and route (F32), profit and loss by group (F134), saved reports (F123) | Try a read replica and materialised views first; add DuckDB if reports are still slow |
| deck.gl (9.4.0) on top of MapLibre | Paints very large numbers of points and areas on a map smoothly | Rep activity map (F68), territory revenue map (F92), GPS ping heat maps (F6) | Needs the MapLibre map stack decision first |
| Offline vector maps for drivers: PMTiles (4.5.0) with MapLibre, stored by the Capacitor shell | Download the city onto the phone like a paper map | Drivers in dead zones still see the map and next stop (F6, F13, F20) | Size of a Tehran basemap not checked; depends on the MapLibre and Capacitor decisions |
| H3 hexagon grid (`h3-js` 4.5.0) | Cover the city in honeycomb cells and count things per cell | Orders, customers or GPS pings per area (F92, F11, F81); fairer territory splits | PostGIS can also bin points; compare before adding |
| Valhalla routing | Answers "where can a van get to in 30 minutes" and draws that area | Real delivery zones around the depot (F57, F81); snapping messy GPS pings to roads for mileage (F103) | OSRM can also match pings to roads, so this is an alternative, not a requirement; not tested |
| Database tests: pgTAP and `squawk` | A referee for the database | pgTAP checks that company A cannot read company B under row-level security; `squawk` warns before a migration locks a big table | Goes with the row-level security plan; nothing to ship to users |
| Mutation testing: Stryker (10.0.0) | Breaks the code on purpose to see whether the tests notice | Money code only: commission, ledger, margin, pricing | Slow, so run it on a few folders, not the whole repo |
| Per-company switches (OpenFeature 1.23.0 or a simple table) and usage numbers (Umami, self-hosted) | A light switch per company and a counter on each button | Turn a feature on for one company first (F126, F127); measure whether voice notes are used (F2 asks for this) | A table with a company id may be enough instead of a library |
| Live updates for the Android shell: `@capgo/capacitor-updater` (8.53.1) | Change the app on every phone without anyone reinstalling it | Ship a bug fix to drivers' phones without waiting for a store review (F6, F13) | Self-hosting route not verified; check each store's rules on updating web code inside an app |
| A no-login tracking page, with Altcha (3.5.0) against abuse | A secret link sent by SMS that shows delivery progress; Altcha is a self-hosted CAPTCHA that makes bots solve a small puzzle | F6 ETA, F120 confirmation code, F79 late notices | Link must be signed and expire; keep phone numbers and full addresses off the page; needs the Farazsms and position decisions |
| Short links for SMS: a short-code route inside the app, or a self-hosted shortener such as Shlink | Shrink a long web address to a few characters | Persian SMS counts about 70 characters per message part, so a long tracking link can double the cost (F79, F6, F120, F106) | Check Farazsms pricing per message part first; a short-code table in the app is probably enough |
| Bad-network tests: Playwright network throttling and offline mode, Toxiproxy | A pretend bad tunnel for the app | Prove that an order queued while signal drops every few seconds is sent exactly once (F13, F105) | Playwright is already a dependency; the offline-first design depends on this being tested |
| Real-phone tests: Maestro with one physical Android phone | A robot finger on a real phone | Run the main flows of the Capacitor app on real hardware, which the build container cannot do (F113) | Needs a phone and a machine to plug it into; not installed or tried |
| Load testing: k6 | A thousand pretend users pressing buttons at once | Simulate 200 orders a day for several companies while 1,000 drivers send positions (F6, F127); shows where Postgres or the app slows down | A small smoke test already exists (`npm run perf:smoke`) |
| Persian map labels: the right-to-left text plugin for MapLibre (`@mapbox/mapbox-gl-rtl-text` 1.0.0) | Teaches the map to read Persian right to left | Street and place names on the vector basemap (the CARTO style drawn through `components/VectorBasemap.tsx`) and on any future MapLibre map (F6, F68, F92) | The code has no `setRTLTextPlugin` call. Whether the current MapLibre version still needs it and how labels look today are unchecked (dependencies were not installed in the review environment); look at the live map first |
| Forms generated from data: JSON Forms (`@jsonforms/core` 3.8.0) or `@rjsf/core` (6.11.0) | Describe a form in a list and the app draws it | Each company adds its own customer fields (F122), builds a survey (F141) or an onboarding checklist (F40) without a developer; the form definition is saved in the database | Compare the two with Persian and right-to-left rendering before choosing; validate submitted values on the server too |
| Import wizard: upload a spreadsheet, match its columns, preview and fix rows, then import (`react-spreadsheet-import` 4.7.1, last release Aug 2024; or a screen built on the existing lead import) | A guided copy-in of an old customer or product list, with the bad rows shown before anything is saved | Bringing a company's existing customers, products and balances in on day one (F126); bank statements (F10); the lead import already has a job runner (`components/LeadImportPanel.tsx`) | The library's last release is two years old and its right-to-left support is unchecked; reusing the lead import's job runner may be enough. Pairs with `csv-parse` and `iconv-lite` in 10.6 |
| Per-company subdomain and branding (the `Host` header read in `proxy.ts`, a logo and colour per company) | Each company gets its own address and sees its own name and logo | A second company's own look (F126, F127); its logo on invoices and delivery notes (F147) | No library needed. Needs a wildcard certificate (Caddy can issue one with a DNS challenge; check that the domain's DNS provider works from Iran). Only worth doing when a second company signs |
| Backup fire drill: a scheduled restore of the latest backup into a scratch database, with row counts and a checksum compared | Proves the backup actually restores, instead of finding out on the bad day | Backup self-service (F34), off-site copy (F138), the status page shows the last good drill (F108) | Today's `scripts/backup.mjs` writes snapshots but never restores one. pgBackRest and WAL-G have their own verify commands once on Postgres; a drill on a timer through pg-boss |
| Call detection on the phone (a small Capacitor plugin reading Android's phone state; `capacitor-call-detector` 0.0.5 is too young to rely on) | When a rep's phone rings, the app shows who the customer is | Customer snapshot on call pickup (F104) without VoIP; logging calls made from the rep's own phone (F4, F41) | Android only; reading the call log needs a permission Google Play restricts, so it may only suit a direct-file install. Not tested. Ties to the Android distribution decision in section 5 |
| Straighten photos before OCR: find the paper's edges and flatten it (`jscanify` 1.4.3, Jul 2026, on OpenCV.js) | Turns a crooked phone photo of a receipt or cheque into a flat, square scan | Better text reading for camera capture (F1); clearer expense receipts (F26) and delivery proof photos (F17) | Runs on the phone, so no image leaves it. OpenCV.js is several megabytes; load it only on the capture screen. Test on real receipts |
| Contact picker: the browser's Contact Picker API (Chrome on Android), or `@capacitor-community/contacts` (8.0.0, Sep 2026) in the Android shell | Fill a new customer's name and phone from the phone's address book instead of typing | Faster customer creation in the field (F40), with the duplicate check run straight after (F148) | The browser API reads only the contacts the user picks and needs no permission; the plugin needs a contacts permission. Not tested on the target phones |
