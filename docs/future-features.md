# Future features (parked, not planned)

Ideas that would remove the most manual entry on a phone but are ambitious or risky. Each is **parked on purpose**: when one is picked up, it gets its own spec in `docs/superpowers/specs/` and its own plan. Until then nothing here is promised.

Every item must end in a **confirmation tap flow** (`docs/tap-flow-principles.md`): the machine proposes, the person confirms with one tap, and the usual 5 s undo applies. Nothing the machine reads is saved without that confirmation.

Origin: the 2026-10-20 mobile-first brainstorm. The pieces that are *not* ambitious live in `docs/superpowers/plans/2026-10-20-mobile-first-interaction-patterns.md`.

---

## F1. Camera capture (read a document instead of typing it)

**What:** point the phone at a paper and get a pre-filled confirmation sheet.

| Source | Fills | Used by |
|---|---|---|
| Cheque | cheque number, bank, amount, due date (Jalali), payer name | `paymentFlow` cheque branch, `/sales/cheques` |
| Supplier invoice / receipt | supplier, date, total, lines if legible | `expenseFlow`, `PurchaseEntry` |
| Delivery note / signed receipt | attaches as a photo to the stop | `DeliveryFlow` done screen |
| Batch label (QR / barcode) | product, batch code, expiry | `receiveFlow`, `stockCountFlow` |

**Why parked:** Persian cheque and invoice OCR accuracy is uncertain, handwriting is worse, and it needs a decision on where recognition runs (on device, or sent to a service, which means customer data leaves the device).

**Open questions to settle in the spec**
1. On-device (Tesseract/ML Kit via WebAssembly, works offline, lower accuracy) or a server/vision-model call (better, needs signal and a privacy decision)?
2. Do we keep the photo? `photos` and `/api/photos` exist, so storage is solved; retention is not.
3. Barcode/QR needs no OCR (`BarcodeDetector` API or a small JS decoder) and could ship **first** as its own small feature: scan a batch label, skip typing the code.
4. Field-by-field confidence: low-confidence fields are highlighted for the person to retype rather than silently accepted.

**Suggested first slice (small, low risk):** QR/barcode scan for batch code in `receiveFlow`. Cheque OCR second. Invoice OCR last.

**Prerequisites:** TapFlow plan Phases 0, 2 and 6 (amount step, payment/cheque flow, receive flow).

---

## F2. Voice input (speak instead of typing a note)

**What:** a press-and-hold microphone button next to every optional note field (`tf-input` on the `note` steps, complaint description, visit notes, reminder text). Persian speech to text, shown as editable text before saving.

**Why parked:** Persian recognition quality varies by accent, noise and phone; browser `SpeechRecognition` support is uneven (works in Chrome Android, unreliable elsewhere, often cloud-backed); vans are noisy.

**Open questions**
1. Browser API (`webkitSpeechRecognition`, free, cloud-backed, Chrome-only) or a hosted model?
2. Is audio ever stored? Default answer: no, text only.
3. Does it work offline? Probably not; the button hides when offline.
4. Which roles want it? Ask drivers and phone sales before building.

**Suggested first slice:** a `VoiceNoteButton` that only appears where `SpeechRecognition` is available and `navigator.onLine` is true, inserted into the TapFlow `input` step only. Measure how often it is used and corrected before expanding.

**Prerequisites:** TapFlow plan Phase 0.

---

## F3. Paste-to-parse (turn a pasted message into a draft)

**What:** paste a WhatsApp/Telegram/SMS message and get a draft to confirm.

| Pasted text | Draft |
|---|---|
| "سلام، ۱۰ کارتن شیر و ۵ ماست برای فردا بفرستید" from a customer | order draft for that customer: lines, delivery day |
| A lead's details ("نانوایی X، ۰۹۱۲…، خیابان…") | add-lead draft (`AddLeadFlow` basics + link) |
| A payment confirmation ("واریز ۵ میلیون") | payment draft (`paymentFlow`) |

**Why parked:** needs a parser that copes with informal Persian, Persian/Arabic digits, units ("کارتن", "بسته", "کیلو"), and fuzzy product names. The lead-import decoder (`app/api/geo/decode-link`, `components/leadImport/DecodeConsole`) already shows the pattern for links; free-text is much harder.

**Open questions**
1. Rule-based (regex + product-name fuzzy match against the catalogue; predictable, offline, limited) or an LLM call (flexible, needs signal, needs a data-handling decision)?
2. How is a customer matched when the sender is a phone number: `customers.phone_norm` exact match first.
3. Share-target: register the PWA as a share target so "Share → RouteFlow" works straight from WhatsApp (`share_target` in `app/manifest.ts`).
4. **Ask first:** do phone sales actually receive orders as messages? If not, drop this.

**Suggested first slice:** share-target + order drafts using rule-based matching against `readCatalogue()`, confirmation via `orderQuickFlow`'s final screen.

**Prerequisites:** TapFlow plan Phase 5 (`orderQuickFlow`).

---

## F4. Wazo VoIP inside the CRM/ERP (call from, and log to, the customer record)

**What:** use [Wazo](https://wazo.io) (open-source, API-driven telephony platform) as the phone system behind RouteFlow, so calls are placed, received and recorded inside the app instead of in a separate dialer.

| Moment | What the app does | Used by |
|---|---|---|
| Salesperson taps a phone number | click-to-call through Wazo (the user's softphone/desk phone rings, then the customer) | call list, customer page, lead page |
| Incoming call | screen pop: caller matched by `customers.phone_norm` (or lead), shows open orders, balance, last visit | phone sales, group manager |
| Call ends | proposes a call-outcome sheet (outcome, note, recall date, optional follow-up task) pre-filled with number, direction and duration | existing call-outcome step of `AddLeadFlow` / CRM |
| Missed call | alert + task "call back" on the customer | tasks board, notifications |
| Manager review | call history per customer, per rep, per day (talk time, answered/missed) | analytics |

**Why parked:** needs a Wazo server (self-hosted or hosted) and SIP trunk with an Iranian carrier; WebRTC softphone in a PWA is unreliable on locked phones (calls arrive only when the app is open); call recording has legal and consent implications; per-tenant isolation (one Wazo tenant per RouteFlow organisation) must be designed.

**Open questions to settle in the spec**
1. Integration level: click-to-call and call logging through the Wazo REST API plus webhooks/websocket events (small, server-side) or an in-browser WebRTC softphone (large)? Phones keep using a normal SIP app or the native dialer first.
2. Where does Wazo run, and which carrier/trunk provides the numbers? Does it work on the deployment network (`deploy/`)?
3. Identity mapping: RouteFlow user ↔ Wazo user/extension, organisation ↔ Wazo tenant. Where are Wazo credentials stored (per organisation, encrypted)?
4. Recording: off by default; if on, who is told, how long is audio kept, and who may play it back?
5. Number matching: normalise Persian digits and `+98`/`09…` forms before matching `phone_norm`; what happens when two customers share a number?
6. Offline/PWA: logging must queue and sync when the connection returns; the call itself needs signal anyway.

**Suggested first slice (small, low risk):** server-side only. A Wazo webhook endpoint that writes a call-log row (number, direction, duration, matched customer/lead, user) and a click-to-call button on the customer and lead pages that asks Wazo to originate the call. No softphone, no recording, no screen pop. Call-outcome capture reuses the existing confirmation sheet, so nothing is saved without a tap.

**Prerequisites:** a reachable Wazo instance and a decision on the carrier/trunk (infrastructure, not code). In code: the call-outcome step and `customers.phone_norm` already exist.

---

## F5. Persian text proofing (help users type clean Persian)

**What:** catch and fix typing problems in free-text fields (notes, complaint descriptions, visit notes, customer and product names) before they are saved.

| Layer | What it does | Cost |
|---|---|---|
| Browser spellcheck | `lang="fa" spellcheck="true"` on inputs and textareas; red underline in Chrome and Android keyboards, patchy on iOS Safari | one attribute, no control over the dictionary |
| Normalisation | Arabic ي/ك to Persian ی/ک, mixed digit sets, zero-width non-joiner (نیم‌فاصله) fixes. Libraries: `@persian-tools/persian-tools` (JS), `hazm` / `Parsivar` (Python) | small; improves search and duplicate detection |
| Hunspell `fa` dictionary | offline spellcheck via `nspell` / `typo-js` | moderate quality; compounds and zero-width non-joiners cause false positives |
| LLM proofreading | grammar, spelling and zero-width non-joiner fixes on long text | needs signal, per-call cost, customer text leaves the device |
| LanguageTool | Persian module exists, rule coverage limited | unverified, treat as a maybe |

**Already in the app:** `lib/persian.ts` (`normalisePersian`, `matchesQuery`) maps Arabic ي/ك to Persian ی/ک for search matching. It is applied to search, not yet to what is stored or to digits and zero-width non-joiners everywhere.

**Open questions**
1. Normalise on save as well as on search? Existing rows would need a one-off backfill.
2. Which fields get an LLM check (long notes only), and is the data-handling decision the same as F1 and F3?
3. Does the Hunspell false-positive rate on Persian compounds make underlines more annoying than useful? Test on real notes first.
4. Library choice: extend `lib/persian.ts` or adopt `@persian-tools/persian-tools`? Check licence, size and maintenance first (not verified here).

**Suggested first slice (small, low risk):** `lang="fa" spellcheck="true"` on note fields, plus normalise-on-save in `lib/persian.ts`. LLM "check text" button later, as a confirmation tap: it proposes the fix, one tap accepts it, the usual 5 s undo applies.

**Prerequisites:** none for the first slice. The LLM step shares the privacy decision with F1 and F3.

---

## F35. Force a new password on first sign-in

**What:** an account created from the phone (or the desk) gets a one-time password that is shown once and shared. Nothing makes the person change it, so it stays their password until they do.

**Why parked:** there is no `must_change_password` state anywhere today (users table, sign-in, session); adding it touches login, the session cookie and every route that assumes a signed-in user can proceed.

**First slice:** a boolean on the user set at creation and on admin password reset, a redirect to a «رمز تازه» screen from the shell layout while it is set, cleared when the user saves a new password.

---

## F36. Duplicate customers as a decision deck — built

A manager's deck on `/sales/today`: each pair sharing a phone or Instagram page is one card, «ادغام شود» or «دو مشتری جدا هستند», with the 5 s undo. `GET/POST /api/crm/businesses/duplicates`, `lib/repo/crm/duplicates.ts`. The record with more orders survives, except that the one owning accounting lines always does (the ledger is append-only, so a pair where both have lines is not offered). Merge re-points orders, payments, complaints, contacts, activities, reminders, visit plans, tasks, alerts and photos, and records the merge in the survivor's history. «جدا هستند» is remembered in `crm_not_duplicates`.

**Still open:** matching by name/position only (phone and Instagram today); no nightly pairing job.

---

## F37. Decisions from the mobile-first rollout

- **Expense receipt photo — built.** Own table `expense_receipts` (one per journal), photo step in the expense flow, receipt button on the journal; kept off `photos` because that table's scoping is customer/district.
- **Skip a driver stop — built as «later»** (`deferStop`, swipe, button, undo).
- **Offline writes — cheques and complaints built.** Reminders and notes stay online-only.
- **Reminder push buttons — built.** `notifications.ref_id` carries the reminder; a single-reminder push offers «انجام شد».
- **Swipe on order cards — built** (draft cards on phones; drag stays for desktop).
- **Planner map selection — built** (pick places from the map into the day).
## F6. Live driver tracking and customer ETA

**What:** drivers' positions on the map in real time, and an automatic "your delivery arrives in about 15 minutes" message (SMS, Telegram or WhatsApp) to the customer.

**Why parked:** continuous GPS drains batteries and needs background location, which a PWA gets only while open; message channels need provider accounts and customer consent; sending customer phone numbers to a messaging provider is a privacy decision.

**Open questions**
1. Position source: the driver app while a run is active (foreground only) or a dedicated tracker?
2. ETA model: planned arrival from the run plus live offset, or a routing-engine recalculation from the current position?
3. Which channel do customers actually read? Ask before choosing.
4. Retention: keep the breadcrumb trail (useful for disputes and `actual_distance_km`) or only the last position?

**Suggested first slice:** position pings every 30–60 s while a run is `IN_TRANSIT`, a live dot on the existing map, and a manager-only view. Customer messages second.

**Prerequisites:** none in code; a messaging provider for the customer-facing half.

---

## F7. Dynamic re-routing during the day

**What:** when a stop fails, a rush order arrives or traffic changes, the system re-optimises the remaining stops of a run and proposes the new order. The driver (or dispatcher) confirms with one tap.

**Why parked:** re-ordering after a run is frozen and loaded touches the plan-freeze rule (`PLANNED` to `READY`); customers already told an ETA must be told again; the optimiser must be fast enough to run on demand.

**Open questions**
1. Who may accept a re-route: driver, dispatcher, or both?
2. Do rush orders insert into a live run, and what limits (van capacity, working hours) apply?
3. Does a changed order notify customers (F6)?

**Suggested first slice:** "re-optimise remaining stops" button for the dispatcher that shows the before/after order and distance, applied only on confirmation.

**Prerequisites:** F6 is useful but not required; the existing routing engine.

---

## F8. Reorder prediction (who is due to order)

**What:** from each customer's order history, estimate when they usually reorder and what. Customers who are "due" go onto the salesperson's call list with a pre-filled order draft.

**Why parked:** needs enough history per customer; seasonal and irregular buyers produce noisy predictions; wrong suggestions erode trust fast.

**Open questions**
1. Rule-based (median gap between orders, usual lines) or a learned model? Start with rules.
2. Minimum history before a prediction is shown?
3. How does a salesperson dismiss a bad suggestion, and does that feed back?

**Suggested first slice:** "due today" panel on the briefing for salespeople using median order gap, with a one-tap draft via `orderQuickFlow`.

**Prerequisites:** TapFlow plan Phase 5 (`orderQuickFlow`).

---

## F9. Churn and credit-risk scoring

**What:** flag customers whose order rhythm is dropping (churn) or whose payments are slipping (credit risk), before a cheque bounces. Shown as exceptions on the manager briefing and as a warning in the credit-approval step.

**Already in the app:** churn scoring exists. `lib/repo/churn.ts` and `lib/predict/churn.ts` score every customer from order history with a logistic model, learn per-tenant weights once enough real lapses exist, and give a reason; `components/predict/ChurnList.tsx` shows it on `/sales/forecast`. Credit-risk scoring (payment delay, bounced cheques) is the part that is missing.

**Why parked:** a score that is wrong blocks a good customer or lets a bad one through; the inputs (payment delay, bounced cheques, order trend) must be defined with the people who grant credit.

**Open questions**
1. Explainable rules (days late, bounced count, order trend) or a statistical model? Credit approvers need to see *why*.
2. Advisory only, or can it put an order `ON_HOLD` automatically? Default: advisory only.
3. Per-group thresholds?

**Suggested first slice:** a transparent score with the top three reasons shown beside the credit decision, advisory only.

**Prerequisites:** none; uses existing payments, cheques and orders.

---

## F10. Bank and payment reconciliation

**What:** import bank statements (or connect a payment gateway), and auto-match deposits to customers, invoices and cheques. Unmatched lines go to a short review list with a proposed match to confirm.

**Why parked:** Iranian bank export formats vary and no common open API exists; payer names in statements are inconsistent Persian text (see F5); matching one deposit to several invoices needs a split step.

**Open questions**
1. Which banks and formats first (CSV/Excel export vs gateway)?
2. Match keys: amount + date + payer name, plus a reference code the customer quotes?
3. Who confirms a match, and does it post to the ledger automatically?

**Suggested first slice:** upload a statement file, show proposed matches against open payments and cheques, post only the ones a person confirms.

**Prerequisites:** the cheque and payment flows; F5 normalisation helps name matching.

---

## F11. Demand forecasting and auto-purchasing

**What:** forecast stock need per product from sales history, and draft purchase orders to suppliers for a manager to confirm.

**Already in the app:** demand forecasting exists. `lib/predict` smooths demand on a deseasonalised series and `lib/predict/inventory.ts` computes the reorder point (average daily sales × lead time + safety stock); `/sales/forecast` shows the demand table. Missing: supplier lead times and minimum orders, and drafting purchase orders from the result.

**Why parked:** perishables with batches and expiry make "how much to buy" depend on shelf life; supplier lead times and minimum quantities must be modelled; poor forecasts cost real money.

**Open questions**
1. Horizon (days or weeks) and per-product shelf-life limit?
2. Supplier data: lead time, minimum order, price. Where is it kept today?
3. Draft only, never auto-send, at first.

**Suggested first slice:** a "suggested reorder" column on stock using average daily sales × lead time minus on-hand, drafted into a purchase entry on confirmation.

**Prerequisites:** batch and stock data (exists); supplier lead times to be added.

---

## F12. Returns and quality management

**What:** a return reason per line, per product and per batch; supplier claims; recall tracing from a batch to every customer who received it.

**Why parked:** needs a consistent reason list agreed with the business; claims involve supplier paperwork outside the app; recall tracing depends on batch codes being captured at every delivery.

**Open questions**
1. Reason codes: damaged, expired, wrong item, customer refused?
2. Does a return restock, quarantine, or write off the goods?
3. Is batch captured at delivery today, or only at receipt?

**Suggested first slice:** reason code on returns, a "which customers got batch X" query, and a quarantine state for returned stock.

**Prerequisites:** batch recall and stock movements (exist); F1 batch scanning helps.

---

## F13. Offline-first everywhere

**What:** extend the driver app's offline sync so sales, warehouse and payment flows also work without signal and reconcile cleanly when it returns.

**Why parked:** conflict handling (two people editing the same record offline), idempotent writes and clear "not yet sent" states for every flow are large cross-cutting work; the existing `/api/sync/*` covers drivers only.

**Open questions**
1. Which flows matter most offline: new order, payment, stock count, lead capture?
2. Conflict rule: last write wins, or ask the person?
3. How much data is cached on the device, and how is it cleared on logout?

**Suggested first slice:** offline lead capture and call outcomes (low conflict risk), queued with the existing sync client.

**Prerequisites:** the driver sync client (`hasSyncClient`) as the pattern.

---

## F14. Natural-language reports ("ask your data")

**What:** type or say "which customers in district 3 haven't ordered in 30 days?" and get a table back, built on the existing analytics.

**Why parked:** generated queries must respect role and tenant scope (a group manager must never see another group's data); answers must be checkable; sending business data to a model is a data-handling decision.

**Open questions**
1. Free-form SQL generation (risky) or a fixed menu of parameterised questions that the model only fills in (safe)? Default: the fixed menu.
2. Which roles get it?
3. Persian questions with Persian/Jalali dates must be understood (see F5).

**Suggested first slice:** a handful of saved, parameterised reports (dormant customers, top debtors, slow products) with a search box that picks one and fills its parameters.

**Prerequisites:** analytics queries with scope helpers.

---

## F15. Multi-warehouse and multi-branch

**What:** several warehouses with stock transfers between them, per-branch ledgers, and consolidated reporting across branches.

**Why parked:** stock, batches, runs and the ledger currently assume one stock location per organisation; moving to many touches nearly every stock and accounting query.

**Open questions**
1. Is a branch a separate legal entity with its own books, or just a location?
2. In-transit stock between warehouses: modelled as a state?
3. Which roles see across branches?

**Suggested first slice:** a warehouse dimension on stock movements and batches with transfers, before any per-branch ledger.

**Prerequisites:** a design for how organisation, group and warehouse relate.

---

## F16. Owner mobile dashboard with push alerts

**What:** a daily summary and push alerts for exceptions (large unpaid balances, failed deliveries, stock-outs, bounced cheques), tuned for the owner on a phone.

**Why parked:** alert fatigue; thresholds differ per business; real push delivery needs real devices and cannot be tested here.

**Open questions**
1. Which five alerts matter, and what thresholds?
2. Daily digest at a fixed time vs instant alerts?
3. Quiet hours?

**Suggested first slice:** a morning digest through the existing push and Telegram channels, built from the briefing panels the owner already has.

**Prerequisites:** notification channels and `briefing.ts` (exist).

---

## F17. Delivery proof and dispute handling

**What:** every stop ends with proof: signature or recipient name, photo, GPS stamp and time. A dispute ("I never received it") opens a case that pulls up the proof, the stop's order lines and the driver's run.

**Already in the app:** `photos` and `/api/photos`, and the photo step on the `DeliveryFlow` done screen. What is missing is a required-proof rule, a signature capture and the dispute case itself.

**Why parked:** forcing proof slows drivers at the door; signatures on a small screen are hard; GPS can be off or wrong indoors; disputes need an owner and a resolution path (credit note, redelivery).

**Open questions**
1. Which proof is required: photo only, photo + name, or signature? Per customer type?
2. What if proof cannot be captured (no signal, shy customer)? An explicit "no proof" reason, never a silent skip.
3. Dispute outcomes: credit note, redelivery, rejected. Who decides?
4. Retention period for photos and signatures.

**Suggested first slice:** GPS and time stamp saved with the existing photo, a "no proof" reason when skipped, and a dispute button on the order that shows the stop's proof.

**Prerequisites:** TapFlow `DeliveryFlow`, `photos`.

---

## F18. Customer statements and dunning

**What:** auto-generated account statements (open invoices, cheques due, balance) and polite payment reminders by message, escalating by days overdue.

**Why parked:** wording matters for Persian business relationships; wrong or duplicated reminders damage trust; message channels need provider accounts and consent (see F6); statements must reconcile with the ledger.

**Open questions**
1. Escalation ladder: days overdue and tone per step. Who approves the wording?
2. Channel: SMS, Telegram, WhatsApp, or a printable PDF handed over by the salesperson?
3. Pause rules: a customer with a promised date or a bounced cheque in dispute gets no reminder.
4. Does a reminder also create a task for the salesperson (`tasks`)?

**Suggested first slice:** a printable/shareable statement per customer and a manager-approved list of "reminders due today" that creates call tasks. No automatic sending.

**Prerequisites:** payments, cheques and debts (exist); F10 helps keep balances current.

---

## F19. Salesperson earnings view and commission simulator

**What:** show a rep "if you close these three orders you earn X", and let managers try a commission rule change on last month's data before applying it.

**Already in the app:** the commission engine and `commission_rates` / `commission_payments`; payroll output must stay byte-identical, so the simulator must reuse the same calculation, not copy it.

**Why parked:** showing earnings creates disputes when the number differs from payroll; a simulator that diverges from the real engine is worse than none.

**Open questions**
1. Show projected earnings to reps at all, or only to managers?
2. Rule changes: simulate against which period, and is the result stored?
3. Rounding and cutoff dates must match payroll exactly.

**Suggested first slice:** a read-only "this month so far" earnings card from the real engine, then a manager-only "what if" that runs the same function with edited rates and shows the difference.

**Prerequisites:** the commission engine's pure calculation function.

---

## F20. Daily visit route for salespeople

**What:** a suggested daily visit route built from customers due for a call or visit (see F8), pending leads and overdue balances, ordered to minimise travel, with a one-tap start.

**Already in the app:** `visit_plans` and the schedule page already hold planned visits on the calendar (`/sales/schedule`), and the routing engine orders delivery stops. What is missing is *building* the day's visit list automatically and ordering it for travel.

**Why parked:** a good visit list weighs value, urgency and distance; reps will not follow a list that ignores what they know; the delivery optimiser assumes vans and capacity, not a person on foot or by motorbike.

**Open questions**
1. Inputs and weights: overdue balance, due reorder, lead stage, last visit age?
2. Start and end point (home, office) and working hours per rep?
3. Can the rep drag stops out and in, and does that feed back into the weights?

**Suggested first slice:** "suggest my day" button that selects up to N due customers/leads in the rep's group, orders them by nearest-neighbour from the rep's last position, and writes `visit_plans` rows only on confirmation.

**Prerequisites:** F8 for the "due" signal (a simple overdue/last-visit rule works first); `visit_plans`; routing helpers.

---

## F21. Promotion and campaign manager

**What:** define a discount, bundle or expiry-driven offer for a group of customers with start/end dates, a margin floor and measured uplift afterwards.

**Why parked:** pricing rules interact with credit, commission and invoicing; a campaign that sells below cost is a real loss; measuring uplift needs a baseline.

**Open questions**
1. Types: percentage, fixed price, buy-X-get-Y, near-expiry batch discount?
2. Stacking rules between campaigns and customer-specific prices.
3. Does commission use the discounted or the list price?
4. Who may create a campaign, and is there an approval for low margin?

**Suggested first slice:** near-expiry batch discount only (reads `batches` expiry, applies a fixed percentage on the order line, shows margin before confirm).

**Prerequisites:** batch expiry data (exists); a decision on price storage per line.

---

## F22. Market and competitor price log

**What:** reps record shelf prices seen in shops (with a photo), and the system shows where RouteFlow's prices sit above or below the market, per product and district.

**Why parked:** data quality depends on reps entering it; competitor products must be matched to ours; stale prices mislead.

**Open questions**
1. How does a rep pick the competing product quickly (catalogue of competitor items, or free text with photo)?
2. Which fields: product, brand, price, shop, date, photo?
3. How old may a price be before it is hidden?

**Suggested first slice:** a two-tap capture (our product, competitor price, optional photo) inside the visit flow and a per-product price-position view for managers.

**Prerequisites:** the visit flow (`leadVisit`), `photos`; F1 can read price tags later.

---

## F23. Digital catalogue and price list

**What:** a shareable catalogue or price list per customer group (photos, units, prices), sent through Telegram or WhatsApp or opened as a web page.

**Why parked:** each group may see different prices, so a shared link must not leak another group's prices; keeping the list current when prices change; image sizes on weak connections.

**Open questions**
1. Public link with a secret token, or sign-in for customers (see the customer portal idea)?
2. Does opening the list let the customer start an order draft?
3. Expiry of shared links.

**Suggested first slice:** a PDF/image export of the price list per customer group from `readCatalogue()`, shared manually by the salesperson.

**Prerequisites:** product photos and per-group prices (check what exists first).

---

## F24. Driver pay and incentives

**What:** pay or bonus per delivered stop, distance, on-time rate and fewer failures, reusing the commission engine's structure.

**Why parked:** incentives change behaviour (drivers may skip hard stops or rush); the rules are a business and legal decision; the data must be trustworthy (see F6 and F17 for proof).

**Open questions**
1. Which measures count, and are they capped?
2. How are failed deliveries that were not the driver's fault excluded?
3. Is the result shown to the driver, and how often?

**Suggested first slice:** a manager-only monthly summary per driver (stops, failures, on-time rate, km) with no pay calculation.

**Prerequisites:** run and stop data (exists); the commission engine as a pattern.

---

## F25. Staff scheduling and attendance

**What:** shifts, leave and check-in for drivers and warehouse staff, tied to route capacity so a planner sees how many vans can run tomorrow.

**Why parked:** labour rules, shift swaps and leave approval are a product of their own; check-in by GPS raises privacy questions.

**Open questions**
1. Check-in method: a tap, a tap with location, or none (manager marks attendance)?
2. Does an absent driver automatically reduce planned capacity and warn the planner?
3. Leave types and approver.

**Suggested first slice:** a per-day availability list for drivers that the planner can use when assigning runs, with no check-in.

**Prerequisites:** run assignment and capacity (exist).

---

## F26. Field expenses and petty cash

**What:** drivers and reps log expenses (fuel, parking, repairs) in two taps with a receipt photo, and the group manager approves; approved items post to the ledger.

**Why parked:** needs the right expense categories and ledger accounts; approval flow and limits per role; receipts are paper (see F1).

**Open questions**
1. Categories and which ledger accounts they post to.
2. Per-role spending limits and an approval threshold.
3. Cash advance and reimbursement: tracked per person?

**Suggested first slice:** a log-only expense form with a photo and category, an approve/reject list for managers, posting to the ledger only on approval.

**Prerequisites:** `expenseFlow` (TapFlow), `photos`, the ledger.

---

## F27. Audit trail and anomaly detection

**What:** a tamper-evident log of who changed what, plus alerts for odd patterns: many cancellations by one user, price edits after confirmation, large cash shortfalls, off-hours changes.

**Already in the app:** `activity_log` records activity; a hash-chained, append-only trail and pattern rules are the new part.

**Why parked:** a strict audit trail touches every write path; false alerts make people ignore the real ones; staff may feel watched.

**Open questions**
1. Which actions are audited (money, stock, status, permissions)?
2. Tamper evidence: hash chain per organisation? Who can read it?
3. Which five anomaly rules first, with what thresholds?

**Suggested first slice:** a read-only "money and status changes" audit view for owners from `activity_log`, plus three simple rules (cancel rate, edit-after-confirm, cash variance) surfaced as exceptions on the briefing.

**Prerequisites:** `activity_log`, the briefing exceptions panel.

---

## F28. Customer segmentation and loyalty

**What:** tiers by volume and payment behaviour (for example gold, regular, watch), with perks such as faster credit approval, priority delivery slots or better terms.

**Why parked:** perks that cost money need rules and limits; tiers visible to customers raise fairness questions; tiers must not be gamed.

**Open questions**
1. Tier inputs and window (last 90 days volume, on-time payment rate)?
2. Which perks are real and affordable?
3. Are tiers shown to customers or internal only? Start internal.

**Suggested first slice:** an internal tier badge on the customer page computed from existing orders and payments, used only to sort the call list.

**Prerequisites:** F9 shares the payment-behaviour inputs.

---

## F29. Sales pipeline and quotations

**What:** quotes with an expiry date, follow-up reminders, a win/loss reason, and one-tap conversion of an accepted quote into an order draft.

**Already in the app:** lead stages (`lib/crm/stage.ts`), tasks for follow-ups and `orderQuickFlow` for drafts. There is no quote document or quote state.

**Why parked:** a quote is a price promise, so it must freeze prices and interact with credit, discounts (F21) and stock; expiry and re-quote rules need agreeing with sales.

**Open questions**
1. Does a quote reserve stock, or is it only a price promise?
2. Validity period and what happens on expiry (auto-close, reminder)?
3. Win/loss reasons: a short fixed list so the reports are usable.
4. Is the quote a printable document the customer receives (PDF/message), or internal only?

**Suggested first slice:** a quote as a draft order with an expiry date and a "won / lost + reason" close step, converted to an order with the quoted prices.

**Prerequisites:** TapFlow Phase 5 (`orderQuickFlow`); F23 for the customer-facing document.

---

## F30. Van loading verification

**What:** at loading, scan or tick each line so the van's contents are compared with the run's order lines. Missing, extra or wrong items are caught before the van leaves.

**Why parked:** scanning needs barcodes or batch labels on goods (see F1 slice 1); a hard block at the gate slows departures, so it needs an override with a reason; partial loads must split stops sensibly.

**Open questions**
1. Scan every unit, every case, or tick per order line? Match to what the warehouse can do.
2. Override rule: who can release a short-loaded van, and does the shortfall move to a later run?
3. Does the check also record the batch loaded, giving recall tracing for free (F12)?

**Suggested first slice:** a per-run loading checklist (tick each line, quantity confirmed), with a "short" reason when under-loaded. Scanning later.

**Prerequisites:** run and `READY` state; F1 barcode slice for scanning.

---

## F31. Supplier scorecards and price history

**What:** per-supplier delivery performance (late, short, damaged), and price history per supplier and product, to compare suppliers and spot price creep.

**Already in the app:** `lib/repo/suppliers.ts` and batch receipts with `unit_cost_toman`. Receipts do not yet record a promised date, so lateness cannot be measured.

**Why parked:** scorecards need a promised date and a received-condition entry at receipt; unfair scores damage supplier relations; units and pack sizes differ between suppliers.

**Open questions**
1. Capture at receipt: promised date, short quantity, damage note?
2. Score formula: on-time rate, fill rate, quality rate; weights?
3. Price comparison across pack sizes: normalise per unit?

**Suggested first slice:** unit-cost history chart per product and supplier from existing batches, plus a "promised date" field on receipt to start collecting on-time data.

**Prerequisites:** the receive flow (TapFlow Phase 6); F12 for quality data.

---

## F32. Margin analytics (customer, product, route)

**What:** true profit per customer, product and route, including delivery cost, discounts, returns and bad debt, not just revenue.

**Already in the app:** orders store `total_toman` and `cost_toman`; runs store planned and actual distance and duration. Delivery cost per run, discounts and bad-debt allocation are not yet attributed.

**Also existing:** `components/CostToServePanel.tsx` already shows revenue against straight-line distance from the dispatch site per customer, and reports how many sales rows failed to match a customer. It is a distance proxy, not a cost model.

**Why parked:** allocating shared costs (fuel, driver time, vehicle) to orders is a modelling decision; results can upset sales and drivers if shown carelessly; accuracy depends on the cost inputs being right.

**Open questions**
1. Delivery cost model: per km, per minute, per stop, or a blend? Where do the rates live?
2. Is bad debt allocated to the customer when a cheque bounces or a balance is written off?
3. Who sees margins: owner only, or managers per group?

**Suggested first slice:** owner-only margin by customer and product from `total_toman` less `cost_toman`, then add a per-km delivery cost on runs.

**Prerequisites:** stored order cost and total (exist); run distance (exists).

---

## F33. Seasonal and holiday planning

**What:** before Nowruz, Ramadan, Yalda or a heat wave, forecast demand and capacity from last year's same period, and warn the planner of the stock and van shortfall.

**Already in the app:** the holiday calendar (`listHolidaysForMonth`), weather forecasts on the schedule page, and order history. They are not yet combined into a seasonal forecast.

**Already in the app (more than first noted):** `lib/predict/seasonality.ts` holds Jalali-month seasonal factors, tenant-tunable through `seasonal_factors`, used by the demand forecast. Missing: holiday-period shifting for events that move on the calendar (Ramadan, Nowruz timing) and a planner banner.

**Why parked:** needs at least a year of clean history per product; holiday dates move on the Jalali/lunar calendar, so "same period last year" is not a fixed date range; weather effects differ per product.

**Open questions**
1. Index demand by day-of-holiday-period rather than calendar date?
2. Which products are seasonal enough to bother with?
3. Output: a planner banner ("expect +40% in two weeks") or a suggested purchase order (see F11)?

**Suggested first slice:** a last-year-vs-now view of orders by product around each holiday, with a banner on the planner two weeks ahead.

**Prerequisites:** order history; F11 for purchase suggestions.

---

## F34. Data export and backup self-service

**What:** owners download their data (orders, customers, ledger) as files, see when the last backup ran, and restore a point in time without a developer.

**Already in the app:** `scripts/backup.mjs` makes backups from the command line.

**Why parked:** a self-service restore can destroy current data, so it needs strong confirmation, a pre-restore snapshot and tenant isolation (an owner restores only their organisation); exports contain personal data, so access is limited and logged.

**Open questions**
1. Export formats: Excel/CSV per table, or a full archive?
2. Restore scope: whole organisation only, or per table? Default: whole organisation, with a snapshot taken first.
3. Where are backups stored, how long are they kept, and are they encrypted?
4. Every export and restore goes into the audit trail (F27).

**Suggested first slice:** owner-only CSV/Excel export of customers, orders and payments, plus a "last backup" status line. Restore stays an operator task for now.

**Prerequisites:** F27 for logging; the backup script as the engine.

---

## F35. Role-based dashboard builder

**What:** managers and owners choose which panels appear on their briefing and in what order, without a developer.

**Already in the app:** `lib/repo/briefing.ts` (`todayFor`) returns a fixed set of panels per role, each capped at five items and each carrying a link or an action, and `users.prefs_json` / `lib/repo/prefs.ts` store per-user preferences. What is missing is letting a person show, hide or reorder panels.

**Why parked:** a free-form builder is a large product; letting users hide panels can hide exceptions they need to see; panel availability must still respect role and scope (a group manager must not be able to add another group's panel).

**Open questions**
1. Show/hide/reorder of existing panels only, or also new panels with filters?
2. Which panels are pinned (exceptions, credit approvals) and cannot be hidden?
3. Per user, or a default per role that the owner sets for the team?

**Suggested first slice:** show/hide and reorder of the existing panels stored in `prefs_json`, with a pinned set that cannot be hidden. No new panels.

**Prerequisites:** none; builds on `briefing.ts` and `prefs.ts`.

---

## F36. Document templates (invoices, delivery notes, statements)

**What:** invoices, delivery notes and statements with the company's logo, wording, numbering and layout, editable by the owner and printable or shareable as PDF.

**Why parked:** invoice layout and numbering can be a legal matter (and links to e-invoicing); a template editor is a product of its own; Persian right-to-left printing and Jalali dates need careful PDF handling. Check what print views exist today before designing (the orders, report and planner pages have print-related code; its coverage was not verified).

**Open questions**
1. Fixed layouts with owner-editable fields (logo, header, footer, terms), or a visual editor? Start with fixed layouts.
2. Numbering: one sequence per organisation, per year, per document type? Gaps allowed?
3. PDF generation on the server or print-to-PDF in the browser? Persian shaping and fonts must be tested.
4. Which documents first: delivery note (drivers need it), statement (F18), invoice?

**Suggested first slice:** one delivery-note layout with the organisation's logo, name and footer text, printable from the order page.

**Prerequisites:** F18 for the statement; the e-invoicing decision for invoices.

---

## F37. Duplicate customer detection upgrade (fuzzy match, preview, undo)

**What:** find customers entered twice even when phone and Instagram differ, show exactly what a merge will move, and allow an undo within a window.

**Already in the app:** `lib/repo/crm/duplicates.ts` already finds duplicate pairs on the `customers` table by identical phone or Instagram, picks a survivor (`chooseSurvivor`: more orders, then more recent, then older id), supports "mark separate" and `mergeBusinesses`, and `lib/duplicates.ts` holds the pure survivor logic. What is missing is matching on name similarity and nearby location, a preview of what moves, and an undo.

**Why parked:** fuzzy matching on Persian names produces false positives (shared common words, branches of one chain); a merge moves orders, payments, tasks and history, so a wrong merge is costly; undo needs the pre-merge state kept.

**Open questions**
1. Signals and weights: normalised name (see F5), distance under some metres, same owner?
2. Merge preview: counts of orders, payments, tasks, notes, files that will move.
3. Undo window and how the pre-merge snapshot is stored.
4. Who may merge: owner and managers only?

**Suggested first slice:** name-plus-location suggestions shown as extra pairs in the existing duplicates list, using `normalisePersian`, with the preview counts. Undo second.

**Prerequisites:** F5 name normalisation helps; existing duplicates repo.

---

## F38. Automatic arrival and departure (geofencing)

**What:** detect when a driver arrives at and leaves a customer's location and record the times, giving stop duration and on-time data without a tap.

**Already in the app:** `lib/arrival.ts` (`stopAtDoor`) prompts the driver when they are within 150 m of a pending stop (`ARRIVAL_RADIUS_KM`), used in `components/driver/DriverRun.tsx`. `deliveries.actual_arrival` is a server timestamp set when the stop action is received, not when the driver physically arrived, and there is no departure time or dwell time.

**Why parked:** continuous background location is unreliable in a PWA (works only while the app is open and the screen is on); battery use; GPS error indoors and in dense streets; location tracking of staff needs consent and clear rules (see F6).

**Open questions**
1. Record the prompt's first detection time as arrival, or require the driver to confirm?
2. Departure: first position beyond the radius after arrival?
3. Where is the raw position kept, and for how long?
4. How are the times used: ETA correction (F6), on-time rate (F24), service-time learning for the route planner?

**Suggested first slice:** store the time the existing prompt first fired for each stop (`detected_arrival_at`) alongside the server-received time, and show both to managers. No departure tracking yet.

**Prerequisites:** the existing arrival prompt; F6 shares the position-handling decisions.

---

## F39. Training and onboarding mode

**What:** a sandbox with demo data and guided tasks, so new staff can practise creating orders, recording payments and running a delivery without touching real records.

**Already in the app:** demo seed scripts (`scripts/seed-demo-org.mjs`, `scripts/seed-demo-drivers.mjs`) build a demo organisation. There is no in-app training mode or guided tasks.

**Why parked:** a sandbox must be completely isolated from real data, including notifications and messages (a practice order must never message a real customer); guided tasks need content in Persian per role; resetting the sandbox must be safe.

**Open questions**
1. Separate demo organisation per learner, or one shared training organisation that resets nightly?
2. Which guided tasks per role: first order, record a cheque, finish a delivery stop, add a lead?
3. How is training mode entered and clearly shown on every screen so nobody confuses it with live data?
4. Outbound channels (push, Telegram, messaging) are disabled in training.

**Suggested first slice:** a training organisation seeded by the existing demo scripts, a clearly marked banner, and a short checklist per role. No in-app guided overlays yet.

**Prerequisites:** the demo seed scripts; tenant isolation (exists).

---

## F40. Customer onboarding checklist

**What:** a new customer's first-order steps tracked until complete: credit limit set, location confirmed, price group chosen, contact person recorded, first delivery slot agreed. Incomplete items show on the owner's task list and the customer page.

**Already in the app:** lead stages (`lib/crm/stage.ts`) and tasks. They track a lead's progress, not the readiness of a new customer to be served.

**Why parked:** the checklist must match how the business really onboards; too many mandatory steps slow sales; some items (credit) need a manager.

**Open questions**
1. Which steps are mandatory before the first order and which can follow?
2. Who owns each step (salesperson, manager, warehouse)?
3. Does an incomplete checklist block order confirmation or only warn?

**Suggested first slice:** a four-item checklist (location, price group, contact, credit) derived from existing customer fields, shown on the customer page and on new customers' first order. Warn only.

**Prerequisites:** none.

---

## F41. Visit and call quality review

**What:** managers sample call outcomes and visit notes, give a quick score and a comment, and coach reps from it.

**Already in the app:** call outcomes, attempt numbers and notes are stored as activities (`insertActivity` in `lib/repo/crm/write.ts`) and appear on the customer timeline (`lib/crm/timeline.ts`). There is no review, score or coaching comment.

**Why parked:** scoring staff is sensitive; a rubric must be agreed; review only makes sense if the notes are good enough to judge, and call audio is not recorded (see F4 on recording).

**Open questions**
1. Rubric: three to five criteria with a short scale, set by the owner?
2. Sampling: random, or targeted (very short calls, repeated no-answers)?
3. Who sees scores: the rep and their manager only?
4. Do scores feed commission or only coaching? Default: coaching only.

**Suggested first slice:** a manager "review five random calls this week" list with one-tap rating and an optional comment, visible to the rep.

**Prerequisites:** the activity timeline; F4 if call recordings are ever added.

---

## F42. Complaint root-cause analytics

**What:** group complaints by product, batch, supplier, route, driver, district and time, to find the pattern behind them and show trends.

**Already in the app:** `lib/repo/complaints.ts` has categories (spoilage, packaging, foreign object, short weight, wrong product), severity, status and links to customer, order, product and batch. `complaintClusters` flags batches with two or more open complaints in 30 days, and `backwardTrace` follows a complaint to its order, batch, purchase line and the supplier's lot reference. The complaints page (`/sales/complaints`) lists them. Missing: patterns across route, driver, district and supplier, resolved complaints, and trends over time.

**Why parked:** driver and route attribution can be unfair when the cause is upstream (a bad batch, not the driver); small counts mislead; supplier conclusions have commercial consequences.

**Open questions**
1. Dimensions to add first: supplier, route, driver, district, product?
2. Minimum count before a pattern is shown, and over what window?
3. Rates, not only counts: complaints per 1,000 units delivered.
4. Who sees driver-level views?

**Suggested first slice:** complaint rate per product and per supplier over the last 90 days, including resolved complaints, with the existing batch clusters alongside. Driver and route views later.

**Prerequisites:** `quality_complaints`, batch and purchase links (exist); F12 and F31 add richer data.

---

## F43. Shared notes and @-mentions

**What:** @-mention a colleague on a customer, order or task, creating a notification and a task for them.

**Already in the app:** activity notes on the customer timeline (`lib/crm/timeline.ts`), tasks with assignees, and the notification feed with unread counts (`lib/repo/notifications.ts`). There is no mention syntax or conversation on an order or task.

**Why parked:** mentions need access checks (someone mentioned must be allowed to see the record, or the mention leaks it); threads on every object grow into a chat product; notification noise.

**Open questions**
1. Where can a note be written: customer, order, task, complaint?
2. Does a mention auto-grant visibility, or is it refused when the person cannot see the record?
3. Reply threads, or one flat note list per record?
4. Does a mention create a task, a notification, or both?

**Suggested first slice:** @-mention in customer notes only, restricted to people who can already see that customer, creating a notification (not a task).

**Prerequisites:** the notifications fan-out; role and scope checks.

---

## F44. Standing orders and contracts

**What:** a customer who orders the same thing every week gets a recurring order that generates a draft each time for confirmation, with a contract (start, end, quantities, agreed prices).

**Already in the app:** `task_recurrences` and `lib/tasks/recurrence.ts` (`rruleMatches`: `daily`, `weekly:<day>`, `monthly:<1-28>`) generate recurring tasks from the sweep rules. Nothing generates orders.

**Why parked:** a generated order touches stock, credit and the delivery plan; holidays and skipped weeks need rules; price changes during a contract; a draft that nobody confirms must not silently ship.

**Open questions**
1. Draft only, always requiring a confirmation tap, or auto-confirm for trusted customers? Start with draft only.
2. Prices: fixed for the contract, or current price list at generation time?
3. Holiday handling: skip, move to the next working day, or ask?
4. How does the customer change or pause it (call, portal)?

**Suggested first slice:** a standing order that reuses the existing recurrence rules to create an order draft in `DRAFT` state and a task for the salesperson to confirm it.

**Prerequisites:** the recurrence engine; TapFlow Phase 5 (`orderQuickFlow`); the holiday calendar.

---

## F45. Customer feedback loop (delivery rating)

**What:** a one-tap rating after delivery, where a low rating creates a follow-up task or a complaint.

**Already in the app:** the complaints flow (`ComplaintFlow`, `ComplaintFromOrder`) for problems a customer reports. There is no positive or neutral rating and no prompt after delivery.

**Why parked:** needs a way to reach the customer (see F6 and F18 for message channels); response rates are usually low and biased towards complaints; ratings of drivers feed pay (F24) and need care.

**Open questions**
1. Channel: a link in a message, a rep asking on the next visit, or the driver's tap on a tablet?
2. Scale: thumbs up/down or one to five? A reason list for low ratings.
3. A low rating creates a complaint (with severity) or only a follow-up task?
4. Are ratings shown to drivers?

**Suggested first slice:** a rep-entered rating on the next visit (two taps, optional reason), low ratings creating a follow-up task. No automatic messages.

**Prerequisites:** complaints repo; F6/F18 for automated delivery of the request.

---

## F46. Credit-risk scoring from payment behaviour

**What:** a score and the top reasons per customer, built from days-late trend, bounced cheques and credit exposure, shown at the credit-approval step and on the customer page. Finishes the half of F9 that is not built.

**Already in the app:** a per-customer credit limit and an approval queue. An order that breaches a direct customer's limit is parked in `credit_approvals` (`lib/repo/creditApprovals.ts`: pending, approved, rejected, expired, with the balance, limit, overage and a reason), and the approver decides. The check is balance against limit only; it knows nothing about how the customer pays. Churn scoring (`lib/repo/churn.ts`) is a separate, existing model.

**Why parked:** a wrong score blocks a good customer or lets a bad one through; the approver must see *why*; few bounced cheques per customer means little data.

**Open questions**
1. Transparent rules (days late, bounced count, exposure over limit) or a learned model like churn? Start with rules.
2. Advisory only, or can it suggest a lower limit or hold the order? Default: advisory.
3. Window for "recent" behaviour, and per-group thresholds?
4. Representatives who settle in cash are outside credit control; they should be skipped.

**Suggested first slice:** a transparent score with the top three reasons shown on the existing credit-approval card, advisory only.

**Prerequisites:** payments, cheques and customer debt (exist).

---

## F47. Customer 360 page

**What:** one screen for a customer with orders, payments and balance, cheques, complaints, calls and visits, tasks, ratings, churn and credit risk, and next best action.

**Already in the app:** the customer detail panel and page (`components/CustomerDetailPanel.tsx`, `/crm/[id]`) with the history timeline, purchase history, photos and reminders, plus the unified timeline (`lib/crm/timeline.ts`, kinds: activity, task, order, payment). Missing: cheques, complaints, balance and risk in the same place, and a clear "what to do next" line.

**Why parked:** a page that shows everything shows nothing; the sections must differ by role (a driver needs the door and the balance, a manager needs risk); every section needs its own access check so no role sees more than it should.

**Open questions**
1. Which five facts sit at the top for each role?
2. Is the timeline extended with cheques and complaints, or are they separate cards?
3. Does the page propose one next action (call, collect, reorder) from F8 and F46, or only show data?

**Suggested first slice:** add balance, open cheques and open complaints cards to the existing customer page, role-gated, with no new scoring.

**Prerequisites:** none; F8 and F46 add the signals later.

---

## F48. Change approvals (second-person sign-off)

**What:** price edits, discounts above a limit, credit-limit increases and similar sensitive changes need a second person's approval, with the reason recorded.

**Already in the app:** only the credit-limit breach is approved this way (`credit_approvals`, with its own decision flow). There is no general approval request for price, discount or limit changes.

**Why parked:** a generic approval engine touches every sensitive write path; too many approvals slow the business and people route around them; approvers need a quick decision screen (the decision deck is the pattern); who approves whom depends on roles and groups.

**Open questions**
1. Which actions need approval, and thresholds (discount over X%, price below cost, limit increase over Y)?
2. Who approves: group manager, owner, or the next level up? What if the requester is the approver?
3. Does the change wait (pending) or apply immediately and get reviewed afterwards?
4. Expiry of unanswered requests, and a record in the audit trail (F27).

**Suggested first slice:** one action only, a discount above a threshold on an order line, requesting approval from the group manager through the existing decision deck. Generalise after.

**Prerequisites:** the decision deck and notifications; F27 for the audit record.

---

## How to promote an item

1. Write `docs/superpowers/specs/YYYY-MM-DD-<item>-design.md` (answer the open questions, pick the first slice).
2. Write the plan with `writing-plans`.
3. Add the new flow/step to the design rules (`docs/mobile-first-principles.md`, once it exists) so it follows the same anatomy.
