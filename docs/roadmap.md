# Roadmap: parked features, grouped and ordered

A prioritised view of every entry in `docs/future-features.md` (F1–F148). Nothing here is promised or scheduled: every feature stays **parked** until someone writes its spec (see "How to promote an item" in that file). This page only helps choose what to promote first.

**How it was made.** The title, the "existing code noted" flag and the "needs / relates to" column are taken from each entry in the future-features file (its "Already in the app" note and its Prerequisites line), so they match it. The grouping into themes, the size and the suggested order are my judgement and are meant to be argued with.

**Size** is a rough estimate of the *first slice* described in the entry, not of the whole feature: **S** = a small change on top of code that exists (a field, a list, a button, a report from existing data); **M** = a new table or screen with some design; **L** = cross-cutting, needs infrastructure or an outside service, or changes a core flow. **Existing code noted** = the entry has an "Already in the app" note describing related code (it can equally say that nothing was found, so this does not mean the feature is built); the entries that really are partly built are listed in section 6.

Totals: 46 small, 73 medium, 27 large first slices; 123 entries carry an "Already in the app" note; 2 entries are records of built work, not features.

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

## 1. Build these first

Small first slices that need no new infrastructure and no outside decision, ordered roughly by how much they unblock or save. Each rests on something the entry confirms already exists.

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
| 17 | F133 Required training and completion tracking | Add a required-lessons list to the academy manifest and a manager table of who has finished which. |
| 18 | F142 Snooze for alerts and tasks | Snooze on tasks and reminders by moving the due date; notifications later. |
| 19 | F137 Lead source return on spend | A source report (leads, converted customers, first-90-day revenue) from data that already exists; spend entry comes later. |
| 20 | F58 Order templates and favourites | Show a "usual basket" suggestion next to the existing "same as last time" in the repeat-order flow. |
| 21 | F19 Salesperson earnings view and commission simulator | A read-only earnings card from the existing commission statements. |
| 22 | F35 Force a new password on first sign-in | A boolean on the user, a redirect to a new-password screen while it is set, cleared when the user saves one (an earlier parked item). |

## 2. Foundations

Entries that other entries list as a prerequisite or a close relation. Doing the first slice of one of these early removes a blocker for several others. The count is how many entries name it in their Prerequisites line (taken from the file).

| Entry | In-degree | What it unlocks |
|---|---|---|
| F27 Audit trail and anomaly detection | 10 | a shared "who changed what" record that history, approval and security entries all want |
| F48 Change approvals (second-person sign-off) | 10 | one approval request shape that order, discount, price and credit approvals can reuse |
| F58 Order templates and favourites | 4 | the "usual basket" that reorder, call-to-order, product visibility and desk entry reuse |
| F66 Supplier order tracking (purchase orders) | 3 | the incoming-stock record behind appointments, pickup runs, pre-orders and forecasting |
| F6 Live driver tracking and customer ETA | 6 | the customer message channel and the position-data policy, both needed by many entries |
| F13 Offline-first everywhere | 2 | the queue for tasks, notes and call outcomes (see also F105) |
| F107 Device and session management | 5 | session revocation that two-step login, the auditor role and the Telegram bot rely on |
| F46 Credit-risk scoring from payment behaviour | 6 | a risk signal the customer snapshot, 360 page, terms and collections use |
| F17 Delivery proof and dispute handling | 2 | the proof model that confirmation codes and carrier shipments extend |
| F1 Camera capture (read a document instead of typing it) | 6 | barcode and label scanning that van loading, returns and bin locations want |
| F18 Customer statements and dunning | 6 | dated statements and reminders that payment terms, promises and the cash-flow forecast feed |
| F12 Returns and quality management | 5 | reason codes and batch tracing that returns, complaints and scorecards share |

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

**Wave 0 — quick wins.** The 22 items in section 1. They add visible value, touch little, and several (F99, F100, F110, F108, F138) are groundwork for later waves.

**Wave 1 — foundations.** First slices of F27 (audit record), F48 (one approval type), F107 → F106 (sessions, then two-step login), F66 (purchase orders, once the ordering practice is confirmed) and the single decision on the customer message channel (F6/F79).

**Wave 2 — money and orders.** F83 (payment terms) → F50 (promises) → F18 (statements) → F46 (risk) → F49 (cash-flow forecast); F58 → F60/F62/F131 (order shortcuts); F44 (standing orders); F56/F64/F65 (pricing) together; F61 (backorders) and F71/F76 (holds and approval by value).

**Wave 3 — delivery and stock.** F57 (time windows), F69 (instructions), F17 → F120 (proof and codes), F80 → F119 (returns), F30 → F94 and F93 (loading and bins), F66 → F87/F118/F121, F81 (capacity warning).

**Wave 4 — heavier or external.** F4 (telephony), F10 (bank formats), F1 (OCR), F13/F105 (more offline), F126/F127 (tenant tooling), F139 (carriers), F124/F143 (Telegram bot and approvals), F14/F123 (report builders).

## 5. Decisions needed before building

Entries blocked by a choice, not by code. Settle these once and several entries unblock.

| Decision | Entries it unblocks |
|---|---|
| Customer message channel, provider and consent | F6, F79, F18, F45, F120, F136, F55, F70, F141 |
| Staff location: collect, keep and show positions | F6, F38, F68, F103 |
| Where Persian text and images may be processed (device, server, a model) | F1, F3, F5, F14, F2 |
| Telephony infrastructure and carrier | F4, F60 |
| Bank statement formats or a payment gateway | F10 |
| Pricing policy: uplift, minimum order, early-payment discount, campaigns | F21, F56, F64, F65, F83 |
| Legal and tax: e-invoicing, document numbering, payroll outputs | F147, F90 |
| Off-site backup destination and who holds the key | F138, F34 |
| Credit policy: auto-pass thresholds, holds, starter limits, approvals | F46, F71, F76, F48, F129 |
| How commission works across groups | F96, F134 |
| Real-device testing before any build | F113, F115, F117 |

## 6. Already partly built

These entries say, in their own "Already in the app" notes, that a meaningful part exists. Their real first slice is smaller than the title suggests.

- **F9 Churn and credit-risk scoring:** churn scoring exists; credit-risk scoring is the missing half (see F46).
- **F11 Demand forecasting and auto-purchasing:** demand forecast and reorder point exist; supplier lead times and purchase drafts are missing.
- **F13 Offline-first everywhere:** the offline layer already covers sales roles for orders, deliveries, payments, cheques, complaints and new customers; tasks, notes and call outcomes are not covered (see F105).
- **F15 Multi-warehouse and multi-branch:** stock is already location-aware, with warehouse-to-van transfers; per-branch ledgers and a first-class warehouse transfer are missing.
- **F17 Delivery proof and dispute handling:** receiver name, GPS, photo and signature columns exist on deliveries; no required-proof rule or dispute case.
- **F33 Seasonal and holiday planning:** Jalali seasonal factors exist in the forecast; holiday-period shifting is missing.
- **F51 SLA and escalation rules:** the rule engine already supports escalation windows; which SLAs are configured and a breach report are missing.
- **F61 Backorders and partial fulfilment:** partial delivery and an automatic backorder draft exist; promised dates, a list and auto-fulfilment are missing.
- **F132 Order priority flag:** the priority column and planner weights exist; nothing sets the value or shows it to the driver.
- **F144 Failure, cancellation, return and delay reason reports:** reasons are captured; nothing aggregates them.
- **F143 Approve from Telegram:** push notifications already carry one-tap actions for cheques and reminders; Telegram messages have no buttons.
- **F130 Rule builder screen:** the rule engine exists; owners can only toggle a rule and change its cooldown.
- **F138 Off-site backup copy:** a local nightly backup exists; the off-site copy, integrity check and alert are missing.

## 7. Looked like features but already exist

Ideas that came up during the brainstorm and were checked against the code, then not added as features because they are built:

- **Notifications centre:** priorities, per-user type-by-channel preferences, a quiet window, a grouped feed with unread counts, push and Telegram.
- **Stock reservation:** confirming an order reserves earliest-expiry batches, records a shortfall, and releases or consumes the reservation through the order state machine.
- **Accounting period locking (enforcement):** closed fiscal periods refuse postings. What is missing is a screen or flow that closes one (not verified; none found).
- **Referrer on a lead:** customers already store who referred them; only rewards and reporting are missing.
- **Duplicate customer decision deck** and **expense receipt photo** and several mobile-first items: recorded as built in F36 and F37.

## 8. Claims not yet verified

Statements in the entries that I could not confirm from the code. Check them before relying on the entry:

- F147 (document templates): how far the existing print code goes.
- F51: which SLAs are configured today.
- F56: whether the UI can schedule a future price, and whether `price_tier` changes the price an order uses.
- F57: no code found that passes customer hours to the route solver as a time window.
- F69: whether the driver stop card shows customer or order notes.
- F71: who can set `blocked` and whether it stops order entry.
- F73: how a confirmed order is edited.
- F75: whether the sales screens read the catalogue offline.
- F97: whether run planning fills the vehicle on each run (a code comment says it does not; the column exists).
- F102: whether orders awaiting review appear in a decision deck.
- F132: what feeds the urgent driver commission rate, and whether anything sets the priority value.
- F67: the assumption that "for Friday" means a week-end report on Friday.
- Whether any screen closes a fiscal period.
- F113: gestures need testing on real phones; not possible in the build container.

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

