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

**Correction (found later):** the offline layer reaches beyond drivers. `lib/offline` (IndexedDB store, outbox, sync engine, device-generated ids) already queues draft orders (create, edit, submit), delivery start and complete, payments, cheques, complaints and new-customer capture, and the pull sends orders and customers to sales roles too (`lib/repo/syncPull.ts`, `lib/repo/syncMutations.ts`). Order approval, planning, freezing and credit decisions are refused offline on purpose. Tasks, notes and call outcomes are not covered (see F105).

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

**Correction (found later):** stock is already location-aware, so the original premise below is too strong. Stock movements and batches carry a `facility_id`, a facility can be a warehouse, cold storage, van, factory or another kind, and stock moves between locations as paired `TRANSFER_OUT` / `TRANSFER_IN` movements (used when loading and unloading vans, `lib/repo/vanStock.ts`, `lib/repo/unload.ts`). Reservations still use the organisation's default facility. What is missing is warehouse-to-warehouse transfers as a first-class flow, per-branch ledgers and consolidated reporting.

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

**More already in the app:** a delivery entity records the receiver's name, the device GPS position and time, a photo path, and a signature path column (`receiver_name`, `gps_lat`, `gps_lng`, `device_time`, `photo_path`, `signature_path`); the order page shows the receiver and whether a photo exists (`lib/repo/orderDeliveries.ts`). I found no code that captures a signature (the column is only declared), and no required-proof rule or dispute case.

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

**Also existing:** the sales academy (`/sales/academy`, `lib/repo/academy.ts`) offers lessons with per-user progress and objection cards, so written training content has a home already; what is missing is practising on safe data.

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

## F49. Cash-flow forecast

**What:** expected inflows (cheques by due date, receivables by each customer's payment pattern) against outflows (supplier payables, payroll, rent) for the next 30–60 days, with a warning when a shortfall is coming.

**Already in the app:** the inputs exist separately: cheques with due dates and statuses, payments and customer debts (`lib/repo/payments.ts`), a payables page (`/accounting/payables`), and the ledger and income statement under `/accounting`. Nothing combines them into a forward-looking view.

**Why parked:** a forecast is only as good as the due dates and payment-behaviour assumptions; receivables rarely arrive on the due date, so the model needs each customer's actual delay (see F46); payroll and fixed costs may not be in the system yet.

**Open questions**
1. Which outflows are recorded today (supplier payables yes; payroll, rent, tax?) and which must be entered as recurring items?
2. Inflow timing: on due date, or shifted by the customer's average delay?
3. Show a best case and a worst case, or one line?
4. Opening balance: from the ledger cash and bank accounts?

**Suggested first slice:** a read-only weekly table for the next eight weeks: cheques due, payables due, and the resulting net, with no customer-delay modelling.

**Prerequisites:** none for the first slice; F46 and F50 improve the inflow estimate.

---

## F50. Payment promise tracker

**What:** record "the customer promised to pay on the 15th", follow up automatically if it isn't received, and track each customer's promise-kept rate.

**Already in the app:** reminders and tasks with due dates (`AddReminder`, `lib/repo/tasks.ts`), and the credit-approval and payment flows. A promise is only a free-text task today: it has no amount, no link to the debt and no outcome.

**Why parked:** a promise must tie to a debt and clear itself when a payment arrives; too many tracked promises become noise; the promise-kept rate must not be used to shame reps or customers.

**Open questions**
1. Fields: promised amount, date, customer, order or invoice, who recorded it.
2. Auto-resolve when a matching payment is recorded (full or partial)?
3. A broken promise creates what: a task for the rep, an alert for the manager?
4. Does the kept-rate feed credit-risk scoring (F46) and the statement reminders (F18)?

**Suggested first slice:** a "promise to pay" step in the call-outcome flow that creates a dated task linked to the customer's balance and marks it kept when a payment of at least that amount arrives.

**Prerequisites:** payments and tasks (exist); F46 and F18 consume the result.

---

## F51. SLA and escalation rules

**What:** response and resolution targets for things that wait on a person: a complaint unanswered for four hours, an order stuck in review for a day, a credit approval waiting too long. Breaches escalate to the next level and show on a compliance report.

**Already in the app:** the rule engine (`lib/rules/engine.ts`, `lib/repo/rules.ts`) already supports escalation: a rule can carry `escalate_after_min` and `escalate_to_role`, and a fired rule that is past its window and neither escalated nor resolved is escalated (`isEscalatable`, with `rule_runs` bookkeeping). What is not clear is which standing SLAs are configured, and there is no breach report.

**Why parked:** targets differ by role, group and time of day (nights and holidays); escalation messages are noisy if the targets are too tight; SLAs measure people, so wording and visibility need care.

**Open questions**
1. Which objects get an SLA first: complaints, orders in review, credit approvals, cheques due for a decision?
2. Business hours and holidays: does the clock pause?
3. Escalate to whom (the requester's manager, the owner)?
4. A weekly breach report per team: who sees it?

**Suggested first slice:** configure three escalation rules on existing events (unanswered complaint, order in review, credit approval pending) and add a small "overdue by SLA" count to the manager briefing. No new engine.

**Prerequisites:** the existing rule engine and notification fan-out.

---

## F52. Free samples tracking

**What:** samples given to prospects, their quantity and cost, and whether the prospect converted into a customer, to see the return on sampling.

**Already in the app:** the CRM already treats a sample as a lead stage (`sample`, in `lib/crm/stage.ts`) and has a call outcome `REQUESTED_SAMPLE`, a follow-up kind `sample_delivery`, and a flow that asks which product, how much (for example one pack, five pieces) and when to deliver it (`sampleprod`, `sampleqty`, `samplewhen` in `lib/crm/flows/afterCall.ts`). The quantity is a label, not a stock or cost record, and conversion is not measured.

**Why parked:** samples leave stock, so they need a stock movement and cost or the inventory drifts; "converted" needs a window and a definition (first order within 60 days?); a rep could game the rate by sampling only likely buyers.

**Open questions**
1. Does a sample create a stock movement at delivery (a new movement type) and a cost?
2. Conversion window and definition.
3. Sample budget per rep or group?

**Suggested first slice:** turn the `sampleqty` label into a quantity and unit, create a stock movement when the `sample_delivery` task is done, and report samples per rep with conversion within 60 days.

**Prerequisites:** stock movements (exist); the lead stage history.

---

## F53. New product launch tracker

**What:** for a new product, which customers have tried it, who reordered, which regions or reps are lagging, and what to do next.

**Why parked:** needs a definition of "launch" (a date range and target customers); adoption is only meaningful against a target list; a small customer count makes percentages misleading.

**Open questions**
1. A launch has a product, start date, target customer segment and a goal (for example 40% trial in 30 days)?
2. Trial = first order of the product; repeat = second order within a window?
3. Does the tracker create tasks for reps for customers who haven't tried it?
4. Ties to samples (F52) and promotions (F21).

**Suggested first slice:** a launch record (product, date, target group) and a table of trial and repeat counts per customer and rep from existing order lines. No tasks yet.

**Prerequisites:** order lines (exist); F52 and F21 add samples and offers.

---

## F54. Data quality dashboard

**What:** customers missing a location, phone number, district, owner or price group, with a completeness score per group and per rep, and one-tap fix tasks.

**Already in the app:** customer health scoring (`lib/repo/health.ts`) is about customer performance, not record completeness. The duplicates tool covers repeated customers. The lead import and CRM flows validate on entry. There is no completeness view for existing records.

**Why parked:** the right rules differ by customer type (a representative customer needs different fields from a direct one); a fix task for every gap floods the task board; location correctness (not just presence) is harder to check.

**Open questions**
1. Which fields are required per customer type?
2. Is the score per record, per group, or per rep, and who sees it?
3. Bulk fix tasks or a single "fix these ten" list?
4. Do wrong-looking values count too (a location far outside the district, a phone with the wrong digit count)?

**Suggested first slice:** a manager-only list of customers missing location, phone or district, with counts by group, linking to the existing customer edit flow.

**Prerequisites:** none; F37 handles duplicates separately.

---

## F55. Owner announcements with read receipts

**What:** a notice from the owner or a manager to all staff or one role (holiday hours, a policy change, a new price list), with a "read" confirmation and a view of who has not read it.

**Already in the app:** the notification feed with unread counts and priority (`lib/repo/notifications.ts`), the academy of lessons and objection cards (`/sales/academy`, `lib/repo/academy.ts`, with per-user lesson progress), and push and Telegram channels. There is no authored announcement with read tracking.

**Why parked:** an announcement is a push to everyone, so overuse trains people to ignore it; targeting by role and group needs scope checks; read receipts raise a fairness question.

**Open questions**
1. Audience: all, a role, a group, or named people?
2. Must it be acknowledged (one tap) or just seen?
3. Expiry and pinning: does it stay on the briefing until read?
4. Persian text with simple formatting only, no attachments at first.

**Suggested first slice:** a pinned announcement card on the briefing for a chosen role or group with an "understood" tap and a manager view of who has tapped. Push optional.

**Prerequisites:** the briefing panels and notification fan-out.

---

## F56. Price list versioning and scheduled price changes

**What:** price lists with effective dates, a visible history of what changed and when, the ability to schedule a price rise for a future date, and a report of which customers and orders a change affects.

**Already in the app:** prices are already versioned in the data. `product_prices` is insert-only with a `valid_from` date per product and packaging (a price change is a new row, never an update, so old revenue does not move), and costs follow the same pattern in `product_costs`. Customers carry a `price_tier` field in the CRM. What I did not verify: whether the UI lets a manager schedule a future price, whether `price_tier` actually changes the price an order uses, and whether per-group price lists exist.

**Why parked:** a scheduled change must apply to orders created after the date but not to ones already confirmed; customers with agreed prices (F44 contracts) must not be silently changed; announcing a rise to customers is a business step the app does not own.

**Open questions**
1. Per-customer-group price lists, or one list plus per-customer overrides?
2. Does a price change apply by order date or delivery date?
3. Approval for a rise or cut above a threshold (see F48)?
4. A "what changes" preview: customers affected, margin before and after.

**Suggested first slice:** a price history view per product from the existing rows, and a "new price from this date" form that inserts a future-dated row, with a preview of recent order volume affected.

**Prerequisites:** none for the first slice; F48 for approvals, F21 for campaigns.

---

## F57. Delivery time windows

**What:** each customer's preferred receiving hours, honoured by the route planner and shown to the driver, so a shop is not visited when it is closed or busy.

**Already in the app:** customers have opening hours (`working_hours_json`, with `parseHours` and `nextOpenAt`), used to pick a good time for calls and visits (`lib/repo/crm/write.ts`) and shown on the driver's visit list (`lib/repo/crm/driverVisits.ts`). The route solver adapter (`lib/routing/vroom.ts`) accepts a per-stop `time_window`. I found no code that fills that window from the customer's hours when planning delivery runs, so opening hours currently inform visits, not routes.

**Why parked:** hard windows can make a plan infeasible or much longer; opening hours are not the same as receiving hours (a shop may receive goods before opening); wrong or missing hours would silently distort plans.

**Open questions**
1. Separate "receiving window" from opening hours, or reuse opening hours?
2. Hard constraint or soft preference with a penalty? Start soft.
3. What happens to stops that cannot fit: flagged to the planner for a decision?
4. Driver view: show the window on the stop card and warn when arriving outside it.

**Suggested first slice:** pass opening hours as a soft time window to the solver for stops that have them, and show the window on the planner and driver stop cards. Receiving-specific hours later.

**Prerequisites:** the solver adapter and customer hours (exist); F38 helps measure how often arrivals miss the window.

---

## F58. Order templates and favourites

**What:** each customer's usual basket (or several named baskets) one tap away when starting an order, instead of retyping lines.

**Already in the app:** the repeat-order flow in `lib/flows/orderQuick.ts` already offers "same as last time?": it picks the customer's latest repeatable order (`pickLastOrder`, skipping drafts, cancelled and returned orders) and rebuilds its lines priced from today's catalogue (`itemsFromLastOrder`). What is missing: a basket that is not just the last order (the usual one), named templates (weekly stock, weekend), and a "favourite products" row.

**Why parked:** "usual" needs a definition (most frequent lines over the last N orders?); templates can go stale when products are discontinued or repackaged; a template must never pre-confirm an order.

**Open questions**
1. Automatic "usual basket" from history, saved templates by hand, or both?
2. Handling of products out of stock or retired: drop with a notice, or substitute?
3. Where do templates live: per customer, per group?
4. Relationship to standing orders (F44): a template is a manual shortcut, a standing order generates drafts by itself.

**Suggested first slice:** an "usual basket" suggestion computed from the customer's last five orders (lines present in at least three), shown beside "same as last time" in the existing flow.

**Prerequisites:** `orderQuickFlow` (exists).

---

## F59. Salesperson handover

**What:** when a salesperson leaves or changes role, hand their customers, open tasks, promises (F50) and leads to successors with a checklist, so nothing is orphaned.

**Already in the app:** customers carry an `owner_user_id`; a rep can claim a customer from the group pool (an `owner_change` activity is recorded), and a reassign request exists (`/api/crm/reassign-request`, `requestReassign`). Users can be deactivated with a confirmation. There is no bulk handover and no check of what a leaving user still owns.

**Why parked:** distributing customers fairly is a management decision (by district, by value, evenly); commission on past and future orders must follow clear rules; open tasks and promises need a new owner or they fall through.

**Open questions**
1. Who decides the split, and can it be proposed automatically (by district and current load)?
2. Commission after handover: stays with the old owner until a date?
3. Deactivation blocked while the user owns customers or open tasks, or allowed with a warning?
4. Notify customers? Usually a rep makes a call, so a task for the new owner.

**Suggested first slice:** a "what does this user own" summary on the deactivation screen (customers, open tasks, pending approvals) and a bulk reassign to one chosen successor, recorded in the activity log.

**Prerequisites:** none; F27 audit trail records it.

---

## F60. Call-to-order shortcut

**What:** from a logged or incoming call, start an order draft for that customer in two taps: customer already selected, usual basket suggested.

**Already in the app:** after a call, the CRM flow already offers "register the order now" as the next step (`neg` step in `lib/crm/flows/afterCall.ts`), which opens the order page and creates a follow-up task. What is missing is the draft being pre-filled (customer, usual basket from F58), and the incoming-call case, which depends on telephony (F4).

**Why parked:** an incoming-call trigger needs F4 (Wazo) first; a pre-filled draft must still be confirmed by a person; matching a caller to the right customer (shared numbers) needs care.

**Open questions**
1. Does the shortcut create a draft immediately or only open the order flow with the customer selected?
2. Which basket is suggested: last order or usual basket (F58)?
3. For an unknown caller: offer "add lead" instead of an order?

**Suggested first slice:** pass the customer and the "same as last time" lines into `orderQuickFlow` from the existing post-call "register the order" option. Incoming calls wait for F4.

**Prerequisites:** F58 for the usual basket; F4 for incoming calls.

---

## F61. Backorders and partial fulfilment

**What:** when stock covers only part of an order, ship what is available and track the rest as a backorder with its own promised date, a visible list, and automatic fulfilment when stock arrives.

**Already in the app:** partial delivery exists. A driver can record a short delivery (`deliverPartial`), which moves the order to `PARTIALLY_DELIVERED`; when it is settled, the `spawnBackorder` effect (`lib/repo/deliveries.ts`) copies the shortfall (planned minus delivered per line) into a fresh `DRAFT` order at the original agreed price, which someone then has to confirm. Stock reservation also records a shortfall slice (a reservation with no batch) when stock is short at confirmation. Missing: a promised date for the backorder, a backorder list or badge, a link back to the parent order, automatic confirmation when stock is received, and telling the customer.

**Why parked:** automatic fulfilment of a backorder competes with new orders for the same stock (who gets it first?); customers may no longer want the goods weeks later; prices must follow the rule already used (original price carried over).

**Open questions**
1. Priority when stock arrives: backorders before new orders, or first come first served?
2. Expiry: a backorder not fulfilled in N days is cancelled or asked about.
3. Does the customer choose between waiting, cancelling the short lines, or substituting?
4. Shortage at confirmation (not at delivery): split the order immediately, or hold it?

**Suggested first slice:** a "backorders" list built from the existing spawned drafts (note text and parent link), showing age and the stock now available, with a one-tap confirm when stock covers it.

**Prerequisites:** the existing partial-delivery and reservation code; F44 and F64 touch the same order creation path.

---

## F62. Customer-specific product visibility

**What:** hide products from customers or groups that don't buy them, so reps and customers see shorter, relevant lists.

**Already in the app:** products have a global `active` flag. I found no per-customer or per-group visibility.

**Why parked:** hiding the wrong product costs a sale; exceptions ("this customer wants it once a year") must be easy; the rules (by customer type, by region, by price group) need agreeing with sales.

**Open questions**
1. Hide by rule (customer type, group), by explicit list, or by purchase history (not bought in 12 months goes to "more")?
2. Hidden or only moved down the list? Start with moved down, searchable.
3. Does visibility apply to customer-facing catalogues (F23) as well as order entry?

**Suggested first slice:** in order entry, show the customer's usual products first (from history, see F58) and the rest behind "all products". No hiding.

**Prerequisites:** F58 for the usual-products signal.

---

## F63. Deposits and prepayments

**What:** record advance payments from customers and apply them to later orders automatically, with the customer's credit visible at order entry.

**Already in the app:** a payment can be split into allocations, and a slice with no order sits on the customer's account as an unallocated credit (`payment_allocations.order_id` NULL; `autoAllocateFIFO` fills the oldest unpaid delivered orders first and leaves the remainder on account). The chart of accounts has a prepayments account (1301). Missing: applying on-account credit automatically to a new order, showing the credit on the order and in the credit check, and a deposit requirement before an order (for example for custom or large orders).

**Why parked:** on-account credit and credit limits interact (credit should offset exposure); refunds of unused deposits need a flow; accounting treatment of deposits versus on-account payments must be confirmed with the accountant.

**Open questions**
1. Apply on-account credit automatically at delivery, or let the cashier choose?
2. Does the credit-approval check (limit versus balance) count unallocated credit?
3. Deposit required: per customer type, per order size, per product?
4. Refund path and approval (see F48).

**Suggested first slice:** show the customer's on-account credit on the order page and in the payment screen, with a one-tap "apply to this order" that creates the allocation.

**Prerequisites:** payments and allocations (exist); F46 shares the credit view.

---

## F64. Minimum order and delivery fee rules

**What:** a minimum basket value (or quantity) per route or customer type, and a delivery fee charged below a threshold, applied at order entry.

**Already in the app:** nothing I could find enforces a minimum order or a delivery fee (a search for minimum-order and delivery-fee terms found only an unrelated analytics metric).

**Why parked:** hard minimums lose small customers who matter strategically; fees need a line on the invoice and a ledger account; rules differ by route length and customer type.

**Open questions**
1. Warn or block when below the minimum? Start with warn plus manager override.
2. Fee: fixed, or by distance or zone?
3. Free delivery above a threshold; are delivery fees taxable?
4. Where does the fee appear: a separate order line with its own product code?

**Suggested first slice:** a warning at order confirmation when the basket is below the route's minimum, with a reason picker when the rep proceeds. No fee yet.

**Prerequisites:** none for the warning; the fee needs a decision on order-line representation.

---

## F65. Small-quantity price uplift

**What:** an item ordered below a quantity threshold gets a higher unit price (the opposite of a volume discount), to discourage tiny orders that cost more to pick, load and deliver. Confirmed meaning: the trigger is the quantity ordered, not the stock level.

**Already in the app:** prices are dated and insert-only (`product_prices.valid_from`, see F56), and an order line freezes the price it was sold at (`unit_price_toman`, `price_id`), so an uplift can be stored on the line without touching the price list. No quantity-based price rules exist as far as I found.

**Why parked:** an automatic price rise surprises customers and reps, and may conflict with agreed prices, contracts (F44) and campaigns (F21); the rule must be visible before the order is confirmed; the quoted price must never change afterwards.

**Open questions**
1. Threshold per product and packaging, per product category, or global? Counted in packs or base units?
2. Uplift as a percentage or a fixed amount per unit, with a cap?
3. Which customers are exempt (agreed prices, contracts, price tiers)?
4. Shown as its own labelled adjustment on the line ("small-order uplift") so the rep and customer see why the unit price is higher, and recorded for reports.
5. Approval or override by a manager when a rep waives it (F48)?
6. Interaction with the minimum-order rule (F64): either raise the price or warn on the basket, not both for the same line.

**Suggested first slice:** a per-product rule (threshold in packs, percentage uplift, cap) applied at order entry, shown as a separate labelled adjustment on the order line, off by default, exempting customers with an agreed price. A manager can waive it with a reason.

**Prerequisites:** F56 for dated price handling; F64 for the small-order treatment; F48 for approvals.

---

## F66. Supplier order tracking (purchase orders)

**What:** purchase orders with an expected date and a status (ordered, in transit, partly received, received), alerts for lateness, and receipt against the order.

**Already in the app:** purchases are recorded as receipts only (`purchases` and `purchase_lines`: supplier, date, invoice number, base quantity and unit cost per line), with a suppliers repo and a payables page. There is no order before the receipt, no expected date and no status.

**Why parked:** it needs a new document type that links to receipts, lead times per supplier (F11 wants them too), and partial receipts; ordering practice may be phone and WhatsApp, so people must actually enter the order.

**Open questions**
1. Does the order get entered by hand, or generated from F11 suggestions and confirmed?
2. Partial receipt: close the order at receipt or keep the remainder open?
3. Price on the order versus the invoice price at receipt: flag differences?
4. Feeds supplier scorecards (F31) with promised dates.

**Suggested first slice:** a purchase order with supplier, expected date and lines, a "receive against this order" action that pre-fills the existing receipt, and an overdue list.

**Prerequisites:** the receive flow (TapFlow Phase 6); F11 and F31 build on it.

---

## F67. Friday weekly scorecard

**What:** an automatic weekly summary for each manager and the owner, generated on Friday at the end of the Persian week (Saturday to Friday): orders, deliveries, collection, complaints, visits, targets, with the change from the previous week.

**Already in the app:** the briefing panels (`lib/repo/briefing.ts`), KPI snapshots and health scores (`lib/repo/health.ts`, `kpi_snapshots`), targets, and a scheduled sweep with weekly recurrence rules (`weekly:<day>`, including `fri`, in `lib/tasks/recurrence.ts`). Notifications reach people through push and Telegram. There is no weekly digest.

**Why parked:** Friday is the rest day, so a notification then must be quiet and useful rather than a work alert; numbers must match the screens people check; the scorecard design differs by role.

**Open questions**
1. Window: Saturday to Friday as the week, summarised on Friday evening, or delivered on Thursday night for use on Saturday morning? (I took "for Friday" to mean the week-end report; confirm.)
2. Delivery: briefing card on the next working day, a Telegram message, or both?
3. Which five numbers per role, and the comparison (last week, same week last year)?
4. Quiet-hours rule: respect each person's quiet window (the notification code already has one).

**Suggested first slice:** a "this week versus last" card on the owner and manager briefing, computed from existing KPI snapshots and shown from Friday on. Telegram digest second.

**Prerequisites:** KPI snapshots and the briefing (exist).

---

## F68. Rep activity map

**What:** where each rep went today and this week, what they visited and how long they stayed, from visit, call and order locations, for managers to coach and to check coverage.

**Already in the app:** the map shows customers, leads and districts with coverage status, and the phone tracks its own position live (`MyPositionProvider`) for navigation and arrival prompts (see F38). Delivery stops record the device's GPS at the moment of the action (`gps_lat`, `gps_lng`, `device_time`). I found no stored position history for salespeople, so there is nothing yet to draw as a rep's day.

**Why parked:** recording staff locations is a privacy and labour-law matter that needs a written policy and clear consent; continuous tracking drains batteries and is unreliable in a PWA (see F6 and F38); a map of movement can be read as surveillance and misused.

**Open questions**
1. Continuous trail, or only location at logged events (visit saved, call outcome, order created)? Event-only is far less intrusive.
2. Retention: delete after 30 days?
3. Who sees what: the rep sees their own, the manager sees their team's, the owner sees all?
4. Working hours only, with an obvious on/off indicator for the rep?

**Suggested first slice:** save the device location with each visit, call-outcome and order creation (event-only, with the rep's knowledge), and show a day map of those points for the rep and their manager. No continuous tracking.

**Prerequisites:** the visit and call flows (exist); F6 and F38 share the position-handling decisions.

---

## F69. Delivery instructions (per customer and per order)

**What:** standing instructions for each customer (gate code, parking spot, "ring twice", who receives, receiving hours, floor), and a one-off note on each order ("deliver before noon", "call on arrival"). Both appear on the driver's stop card, and the order note can be a quick pick from common phrases.

**Already in the app:** customers have an address, a contact person and a free notes field; orders have a notes field (the repeat-order flow leaves it empty); a delivery stop has its own notes, which the driver writes when acting on it (`delivery_stops.notes`). I did not confirm that the driver's stop card shows the customer's or the order's notes, nor that order entry offers a place to type the order note.

**Why parked:** free-text notes fill with noise, and gate codes are sensitive (they should be visible only to the driver on that run and not on shared screens); instructions that apply "always" versus "this time" must not be mixed; notes must survive a customer merge (F37).

**Open questions**
1. Structured fields (access code, floor, parking, receiver, best hours) plus a free-text line, or free text only? Structured is easier to read on a phone.
2. Who may edit the standing instructions: rep, manager, or the driver with a suggestion that needs approval?
3. Is an order note copied to the stop at planning time so a later edit does not reach a frozen run?
4. Hide access codes from roles that don't deliver.

**Suggested first slice:** show the customer's notes and the order's note on the driver stop card (read-only), and add a one-line order-note field with three quick-pick phrases to order entry. Structured fields next.

**Prerequisites:** the driver stop card; order entry flow (`orderQuickFlow`); F57 for receiving hours.

---

## F70. Segment campaigns

**What:** pick a segment (dormant for 45 days, bought product X, in district Y, owes more than Z), and generate a call list with a short script and a result to record per call, then measure the outcome.

**Already in the app:** call lists and follow-ups (the briefing's `call_list` panel, tasks, call-outcome flows), lead lists and lead runs (`/leads`, `lib/repo/leadRuns.ts`) for planned visits to leads, and churn and health scores for who is at risk. There is no segment builder and no campaign record that ties a list, a script and results together.

**Why parked:** segments built from many filters invite mistakes (everyone in the list is the wrong people); calling the same customers too often damages the relationship, so contact frequency needs a limit; results need a clear measure (reorder within 14 days).

**Open questions**
1. Filters first: last order date, product bought, district, balance, owner?
2. A cap on how often one customer appears in campaigns?
3. Script: free text with Persian rich fields, or tied to the objection cards in the academy?
4. Outcome definition and window; report per campaign and per rep.

**Suggested first slice:** a saved "dormant 45 days in my group" list that creates call tasks for the owning reps, with a one-line script and a "reordered within 14 days" count after.

**Prerequisites:** F8 and F9 supply the "who is due or at risk" signals; the call-outcome flow.

---

## F71. Customer credit holds by rep

**What:** a rep (or manager) places a temporary hold on a customer's new orders with a reason and an expiry (a dispute, a collection problem, a returned cheque under discussion), visible to everyone who takes orders for that customer, and released with one tap.

**Already in the app:** an order that breaches the credit limit can be parked for approval (`PENDING_CREDIT`) and a rejected one lands in `ON_HOLD` until a manager or owner releases it (`releaseHold`). A customer has a lifecycle, and `blocked` can be reached from any state (it can only return to `active`). I did not verify who may set `blocked`, whether it stops order entry, or whether it can expire. Holds are therefore either per order or an open-ended block, with no temporary, reasoned customer-level hold.

**Why parked:** a hold that a rep can place alone can also be abused or forgotten; it must expire or be reviewed; a hold on a customer who is mid-delivery needs a rule for orders already confirmed.

**Open questions**
1. Who can place a hold: the customer's rep, the group manager, both? Who can release?
2. Expiry: a default (7 days) with a reminder before it lapses?
3. Effect: warn at order entry, require a manager override, or block?
4. Existing confirmed orders keep going; only new ones are affected?
5. Record in the activity log and the audit trail (F27).

**Suggested first slice:** a "hold" action on the customer with a reason and an expiry date, shown as a banner at order entry that asks for a manager override to proceed. No change to the lifecycle states.

**Prerequisites:** the order state machine and customer lifecycle (exist); F48 for the override approval.

---

## F72. Duplicate order warning

**What:** warn when a customer already has a near-identical open order (same products, close quantities, same or neighbouring day), which usually means a double entry, and offer to open that order instead.

**Already in the app:** nothing I could find warns about a repeated order. The duplicate-customer tool (`lib/repo/crm/duplicates.ts`) is about customer records, not orders.

**Why parked:** legitimate repeat orders (a big customer ordering twice a day) would be nagged; the "near-identical" definition affects both false alarms and missed duplicates; a warning at the wrong moment slows entry.

**Open questions**
1. Definition: same customer, an open order created within the last N hours, with at least X% of lines matching?
2. Block or just ask ("open the existing one" / "this is a new order")?
3. Does a confirmed "this is new" answer suppress the warning for that customer for a day?
4. Include orders created by a different rep?

**Suggested first slice:** at confirmation, if the same customer has another open order created in the last 24 hours with the same set of products, show one question with two buttons: open the existing order, or continue.

**Prerequisites:** none; works with `orderQuickFlow` and the desktop order form.

---

## F73. Order edit history

**What:** every change to an order after confirmation (quantities, prices, dates, address, notes) shown as a timeline with who changed it, when, and why, including what the old value was.

**Already in the app:** `order_events` records each status transition of an order with the action, actor, reason code, note and time (`lib/repo/orders.ts`, with audit views in `lib/repo/journey.ts` and `lib/repo/why.ts`), and legacy orders get one synthetic create event. Order lines carry an `is_reversal` flag, which suggests corrections are posted as reversing lines. I did not confirm how a confirmed order is edited, and I found no field-level history (old and new values) for quantities, prices or dates.

**Why parked:** it touches every write path that changes an order; the timeline must stay readable (group a multi-field edit into one entry); sensitive changes (price down, quantity up after delivery) deserve highlighting, which overlaps F27 and F48.

**Open questions**
1. Which fields are tracked: lines (product, quantity, price), dates, address, notes, discounts?
2. Recorded in the same `order_events` table with a "field change" action, or a separate table?
3. Required reason on edits after confirmation?
4. Who can see it: the order's owner, managers, finance?

**Suggested first slice:** record a before-and-after summary for line and date edits in `order_events` (action `edit`) and show it on the order page's existing timeline. Reason required after confirmation.

**Prerequisites:** the order events table and timeline (exist); F27 and F48 build on it.

---

## F74. Rep daily wrap-up

**What:** an end-of-day screen for a salesperson that collects the day's loose ends: calls and visits not logged, promises made, orders left in draft, tomorrow's first calls, and a one-tap "I'm done" that the manager can see.

**Already in the app:** the day's start is covered: the briefing and `/sales/today` (decks for credit approvals and duplicates, action cards, suggestions) and the pocket view with today and week tiles. There is nothing for the close of the day.

**Why parked:** an end-of-day ritual only works if it is short; it should draw from data already captured instead of asking for typing; a manager seeing who has not closed the day can feel like surveillance.

**Open questions**
1. Items: unlogged calls (from the phone log, which a PWA cannot read), draft orders, open promises (F50), tasks due today, tomorrow's plan?
2. Time of day: a reminder at a fixed time, or on demand?
3. Does "done" feed a daily score or only a note on the manager view?
4. Tone: a checklist, not a report to fill.

**Suggested first slice:** a "close the day" card on `/sales/today` that lists today's draft orders and overdue tasks with one-tap actions, plus tomorrow's first three tasks. No manager view yet.

**Prerequisites:** tasks and orders (exist); F50 adds promises.

---

## F75. Offline product catalogue for reps

**What:** the product list with packagings and prices cached on the phone so reps can browse and quote in basements and rural areas, with a freshness indicator ("prices as of 09:10").

**Already in the app:** the sync pull (`/api/sync/pull`, `lib/repo/syncPull.ts`) sends the full catalogue (products, packagings and prices) to every signed-in role except the vendor account, and recent orders and customers to sales roles; the service worker caches the app shell, map tiles and map data (`public/sw.js`). I did not verify that the sales screens read the catalogue from the local copy when offline, and whether quoting works without a connection.

**Why parked:** an offline quote must show that prices may be stale and must not be confirmed offline at an out-of-date price; the cache needs a refresh policy and a version stamp; storage use on low-end phones.

**Open questions**
1. Which screens use the local catalogue: a browse and price-lookup view only, or full order entry?
2. Does an offline order confirm locally and sync later, or stay a draft until online (see F13)?
3. Freshness display and a maximum age before a warning appears.
4. Customer-specific prices and visibility (F56, F62) must also be available offline.

**Suggested first slice:** a read-only "price list" screen on the phone that reads the already-synced catalogue and shows its last-sync time, working offline. Order entry offline later under F13.

**Prerequisites:** the sync pull (exists); F13 for offline order entry.

---

## F76. Order approval by value

**What:** orders above a value, or with unusual discounts, wait for a manager's tap before reaching the warehouse; small ordinary orders pass automatically.

**Already in the app:** every order of a direct customer already waits for a manager. `submitOrder` (`lib/orders.ts`) moves a draft to `PENDING_REVIEW`, where a group manager or owner must `passReview` it; orders of representatives and sample orders pass automatically; an order that breaches the customer's credit limit goes to the separate credit approval (`PENDING_CREDIT`). What does not exist is a value-based rule: today the review is the same for a small repeat order as for a very large one, and nothing looks at discount size.

**Why parked:** thresholds that are too low flood managers and delay deliveries; too high and the control means nothing; auto-passing needs a safe definition of "ordinary" (usual customer, usual products, prices at list).

**Open questions**
1. Auto-pass rule: order below value X, from a customer with N prior delivered orders, no discount, price at list?
2. A second level: orders above a higher value go to the owner rather than the group manager?
3. Time limit: an order unreviewed for N hours reminds the manager and, past a limit, escalates (see F51).
4. Does a manager pass from the briefing in one tap (the decision deck pattern already used for credit)?

**Suggested first slice:** auto-pass small orders from customers with a clean history and list prices, leaving everything else in the existing review. Value escalation to the owner second.

**Prerequisites:** the order state machine and decision deck (exist); F48 for the discount rule; F51 for the time limit.

---

## F77. Customer visit frequency targets

**What:** set how often each customer tier should be visited (for example weekly for top accounts, monthly for small ones), and flag customers overdue for a visit on the rep's day list and the manager's briefing.

**Already in the app:** the visit calendar (`visit_plans`, `/sales/schedule`), visit and call activities on the customer timeline, and sales targets for revenue, kilograms and order count (`lib/repo/targets.ts`). There is no per-customer visit interval, so "overdue for a visit" cannot be computed.

**Why parked:** a single cadence per tier ignores that some customers need calls rather than visits; targets that reps cannot reach (too many customers) become noise; the tier definition itself (F28) is not built.

**Open questions**
1. Cadence by tier, by customer type, or per customer? Start with per tier or type.
2. A visit counts only if a visit activity is logged, or a call also counts?
3. Rep capacity: warn when the targets add up to more visits than the rep can make in a day (see F20).
4. Reports: visit compliance per rep and per group.

**Suggested first slice:** a per-customer-type visit interval and an "overdue for a visit" list on the rep's day, from the last visit activity. No manager report yet.

**Prerequisites:** the activity timeline (exists); F28 for tiers; F20 for turning the list into a route.

---

## F78. Driver map pin correction

**What:** a driver who finds a customer's pin wrong drops a corrected pin from the stop screen. It is sent to a manager (or the rep) for approval, so the next delivery is routed to the right place.

**Already in the app:** pin editing exists for leads and facilities (`components/LocationPinPicker.tsx`, `components/crm/PinStep.tsx`), and drivers already verify phone-less leads on their round with a short flow (`components/driver/VerifyVisits.tsx`, `lib/crm/flows/driverVisit.ts`). Delivery stops record the device GPS at the time of the action (`gps_lat`, `gps_lng`). I did not find a way for a driver to propose a corrected position for a customer from the stop card.

**Why parked:** a driver's phone location at the door is not always the building entrance; letting the pin change instantly would let one bad reading mislead every later route; approvals add work for managers; customers with several delivery points need more than one pin.

**Open questions**
1. Propose-and-approve, or auto-accept when the driver's position is within a few hundred metres of the old pin?
2. Use the device position at the moment of the tap, or let the driver drag a pin on the map?
3. Who approves: the customer's rep, the group manager, or the dispatcher?
4. Keep the history of pins (with F37 duplicate and merge tools in mind).

**Suggested first slice:** a "location is wrong here" button on the stop card that sends the current device position as a proposed correction to the rep, who accepts or rejects it with one tap. The accepted pin updates the customer.

**Prerequisites:** the stop GPS capture (exists); F27 records who changed what.

---

## F79. Late-delivery notices to customers

**What:** when a run is delayed past a threshold, a templated message goes to the affected customers (reviewed by the dispatcher before sending, at least at first), with a new expected time.

**Already in the app:** stops carry a planned arrival and a delay reason code, and staff get push and Telegram notifications (`lib/repo/notifications.ts`). Customers are not notification recipients, and I found no customer-facing messaging channel.

**Why parked:** it needs a way to reach customers (SMS gateway or messaging app accounts, see F6), consent and opt-out, and a trustworthy new ETA (see F6 and F38); a wrong message is worse than none.

**Open questions**
1. Channel: SMS, Telegram or WhatsApp? Which do customers actually read?
2. Trigger: run late by 30 minutes, or a stop expected to miss its receiving window (F57)?
3. Dispatcher approval for each notice, or automatic for small delays?
4. Wording and language, and one message per customer or per contact?

**Suggested first slice:** a "delayed" button for the dispatcher that lists the affected stops and generates a copy-ready message per customer (copy and paste into the usual chat). No automatic sending.

**Prerequisites:** F6 for a live ETA and the channel decision.

---

## F80. Warehouse returns handling

**What:** returned items are received at the warehouse, inspected, counted and sent to restock, quarantine or write-off, with the reason and the customer recorded.

**Already in the app:** returns partly exist. An order can end in `RETURNED` (a driver can record it when a customer refuses, or a manager after delivery), and delivery lines record `qty_returned`. Stock has a manual `RETURN_IN` movement, but its meaning is deliberately narrow: a replacement handed back at the door (the code comment says so, and warns against using it as a general "goods came back" movement). Manual `WRITE_OFF`, `ADJUSTMENT` and `COUNT` movements exist, and batches can be quarantined or recalled (`lib/batchStates.ts`). What is missing is the warehouse-side receiving step for goods that came back on the van, an inspection outcome per line, and a link to the reason and customer.

**Why parked:** the existing stock model treats a refused delivery as "never left the van" (nothing moves), so a returns flow must not double count; disposition rules depend on shelf life and condition; supplier claims (F12) need the same data.

**Open questions**
1. Where do returned goods enter: the end-of-day unload (`UnloadTapFlow`) or a separate receiving screen?
2. Dispositions: restock to the original batch, restock as a new lot, quarantine, write-off, return to supplier?
3. Who inspects, and is a photo required for write-off?
4. Link back to the order, delivery line and reason code so reports (F12, F42) can use it.

**Suggested first slice:** add a disposition choice (restock, quarantine, write-off) to the van unload step for returned quantities, creating the matching stock movement and recording the reason. No supplier claims yet.

**Prerequisites:** the unload flow and stock movements (exist); F12 for reasons.

---

## F81. Peak-day capacity warning

**What:** when tomorrow's (or next week's) confirmed orders exceed van capacity or driver availability, warn the planner a day ahead, with options (move some orders, add a van, split the day).

**Already in the app:** vehicles carry limits for stops, weight and volume (`max_stops`, `max_weight_kg`, `max_volume_m3`), and `lib/dayCapacity.ts` splits orders across days against those limits when the planner builds runs (`lib/repo/dayPlan.ts`, `readPlannableOrders`). The briefing shows unplanned orders. It does not warn ahead that a coming day is over capacity.

**Why parked:** capacity depends on which vehicles and drivers are available that day (F25 is not built); orders keep arriving until cut-off, so an early warning can be wrong; the weather capacity factors (`capacity_factors`, learned in `lib/predict/capacityLearning.ts`) change the effective capacity.

**Open questions**
1. Horizon: tomorrow only, or the next three working days?
2. Source of available vehicles and drivers until F25 exists: all active vehicles?
3. Who is warned: the planner, plus the owner when the gap is large?
4. Offer the existing day-splitting as the suggested fix, with the customers affected.

**Suggested first slice:** a banner on the planner for each of the next three days showing confirmed demand (stops, weight, volume) against total vehicle limits, using the existing day-capacity maths and weather factors. Warning only.

**Prerequisites:** the day-capacity module and vehicle limits (exist); F25 for driver availability; F57 for windows.

---

## F82. Approval delegation while away

**What:** a manager or owner who is on leave names a stand-in for order review, credit approvals and other approvals (see F48, F76), for a set period. Decisions are recorded as "approved by X on behalf of Y", and the delegation ends on its own.

**Already in the app:** a person can hold several roles (`user_roles`, with `setRoles`, `usersWithRole` and `rolesFor` in `lib/repo/userRoles.ts`), and the code's rule is that "who can do X" is answered from that table, not from the primary role. So an approval can already be done by anyone holding the approving role, and order transitions accept an actor with several roles. What is missing is a time limit on a role grant, a way to say "I am away", and the "on behalf of" record. I also found no leave or absence state for users.

**Why parked:** a lasting extra role is a security risk if nobody removes it; approving for someone else must be visible in the audit trail (F27); some approvals (credit increases, price cuts) may not be delegable; nested delegation (a stand-in delegating again) must be forbidden.

**Open questions**
1. Time-boxed role grant (start and end dates), or a separate delegation record that is checked at approval time? The record is safer: the stand-in never holds the role.
2. Which approvals can be delegated: order review, credit approval, cheque decisions, price changes?
3. Who may delegate: the approver themself, or the owner on their behalf?
4. Notice to the delegator when something is approved in their name, and a morning summary when they return.

**Suggested first slice:** a delegation record (from, to, start, end, approval kinds) that the approval check consults, "approved on behalf of" shown on the order timeline, and an automatic end. No change to who holds which role.

**Prerequisites:** the multi-role model and the order state machine (exist); F27 and F48 build on it.

---

## F83. Payment terms and early-payment discounts

**What:** each customer has agreed payment terms (cash, 15 days, 30 days, cheque dated N days) and an optional discount for paying early, such as 2% within 7 days. Terms set each order's due date, drive statements (F18) and reminders, and feed risk scoring (F46).

**Already in the app:** debt is computed live from delivered orders minus payments and aged into three buckets (up to 7 days, 8 to 30 days, over 30 days) from the delivery date; the opening balance is always counted as over 30 days (`customerDebt`, `bucketOf` in `lib/repo/payments.ts`). Cheques have due dates, and customers can have a credit limit. There is no agreed term or due date on a customer or order, so "overdue" currently means "old", not "past its agreed date". I found no early-payment or cash discount fields.

**Why parked:** a discount for early payment changes the amount owed, so it needs a clear rule on the invoice and in the ledger (and it interacts with F65's uplift and F21's campaigns); terms must be frozen on the order when it is created so later changes do not rewrite history; cheques dated in the future blur "paid" versus "promised" (see F50).

**Open questions**
1. Terms per customer, per customer group, or per order? Start per customer with a default per group.
2. Due date counted from the delivery date or the invoice date?
3. Early-payment discount: applied automatically when a payment arrives in the window, or offered and confirmed by the cashier?
4. How are post-dated cheques treated against the due date?
5. Tax and accounting treatment of the discount, to confirm with the accountant.

**Suggested first slice:** a terms field on the customer (days), copied onto each order as a due date at creation, and an "overdue by terms" count next to the existing age buckets. No discount yet.

**Prerequisites:** none for the first slice; F18, F46 and F50 consume the due dates; the discount needs the ledger decision.

---

## F84. In-app help and tooltips

**What:** short Persian help for each screen and field (what it is, how to read it, what to do next), reachable from a small `(i)` button and editable by the owner without a developer.

**Already in the app:** a help registry exists (`lib/help`, with `getHelp` and a typed entry: title, what it shows, how to read it). The `(i)` button is `components/meridian/CardHelp.tsx`: a deliberate click opens a small panel, an unwritten entry shows a calm "coming soon" line, and unwritten ids are collected for a help-debt backlog (`tests/meridian-help.test.ts`). It is used on a small number of dashboard cards; the registry has only a handful of written entries. The sales academy (`/sales/academy`) covers lessons and objection cards, which is training rather than per-screen help.

**Why parked:** writing good help for every screen is a large content job; help must be kept in step with the screens or it misleads; an owner-editable help layer needs a version, a review and a way to restore the default text.

**Open questions**
1. Scope: per-card help only, or per-field hints inside forms and tap flows?
2. Language: Persian only at first; do staff want English or Arabic later?
3. Who writes and approves entries: the developer in code, or the owner in an editor with the shipped text as a fallback?
4. Where it shows up first: the screens people ask most questions about (orders, payments, routing, the driver run).

**Suggested first slice:** work down the existing help-debt list to write the missing entries for the five most-used screens, and add `CardHelp` to their headers. No editor yet.

**Prerequisites:** none; builds on the existing registry and button.

---

## F85. Order source tracking

**What:** record how each order arrived (phone call, visit, app, WhatsApp or Telegram message, driver on the spot, repeat from a standing order) to see which channels bring volume and where to invest rep time.

**Already in the app:** orders have a type (`order_type`, default `SALE`, with sample orders) and a creator and salesperson, and leads have a source (`source_code`, chosen in the add-lead flow). I found no field recording the channel an order came through.

**Why parked:** the channel must be captured in one tap at entry or it will be left blank; some channels (a customer's WhatsApp message) only exist once paste-to-parse (F3) or telephony (F4) are built; existing orders have no value to backfill.

**Open questions**
1. A short fixed list (phone, visit, app, message, driver, standing order) plus "other"?
2. Defaulted where it can be known (a standing order draft, an order created from a call outcome, a driver order) and asked only otherwise?
3. Reports: orders and revenue per channel per rep and per group, and conversion from the lead source to the first order?
4. Include a "created at the door" source for orders raised by drivers?

**Suggested first slice:** add a source field with a one-tap picker to order entry and prefill it from the flow that created the order, then show orders and revenue by source on the analytics page.

**Prerequisites:** none for the first slice; F3, F4 and F44 add automatic sources.

---

## F86. Manager coaching notes

**What:** a private notebook per salesperson, kept by their manager: observations, agreed goals with review dates, and follow-ups after a coaching conversation. Visible to the manager and the owner, not to the rep unless the manager shares an entry.

**Already in the app:** a per-user salesperson score exists in the health analysis (`salespersonScore` in `lib/analysis/health.ts`, assembled in `lib/repo/health.ts`), and revenue, weight and order targets per person (`lib/repo/targets.ts`). Note that the existing `/sales/reps` pages are for representatives (partner customers with onboarding stages and a health band, `lib/repo/representatives.ts`), not for the company's own salespeople, so they are not the place for this. There is no manager notebook, no goals with dates and no coaching follow-up.

**Why parked:** private notes about people are sensitive (retention, access, who sees them if a manager leaves); notes can be unfair or become disputes; a coaching tool that feels like surveillance will not be used honestly.

**Open questions**
1. Who can read: the writing manager, the owner, or the rep too (shared entries only)?
2. Structure: a free-text note with an optional goal and review date, or a fixed template (strength, to improve, agreed action)?
3. Link to F41 (call and visit reviews): a reviewed call can be attached to a note.
4. Retention and handover when a manager changes (F59).

**Suggested first slice:** a manager-only note list on a salesperson's page with an optional goal and review date, a reminder task on the review date, and no sharing yet.

**Prerequisites:** none; F41 and F59 connect to it.

---

## F87. Warehouse receiving appointments

**What:** suppliers book a delivery time slot, and the warehouse sees the day's expected arrivals so it can staff unloading and clear space.

**Already in the app:** purchases are recorded only at receipt (`purchases` and `purchase_lines`), with a receive flow for batches. There is no expected delivery, slot or arrival schedule. I found no appointment or dock concept in the code.

**Why parked:** it only helps if suppliers actually announce arrivals; it needs the purchase-order record that does not exist yet (F66); a booking page for suppliers means external access, with its own login and scope.

**Open questions**
1. Booked by the warehouse after a phone call, or by the supplier through a link? Start internal.
2. Slot length and capacity: one truck at a time, or several?
3. Late and no-show handling, and feeding supplier scorecards (F31).
4. Does an appointment link to a purchase order and prefill the receipt?

**Suggested first slice:** a daily "expected arrivals" list built from purchase orders (F66) with an expected date and optional time, shown on the warehouse view. No supplier-facing booking.

**Prerequisites:** F66 for the order record; F31 consumes the arrival data.

---

## F88. Staff expense reimbursement

**What:** when a salesperson or driver pays a business cost from their own pocket (fuel, parking, a small repair), they log it with a receipt, a manager approves it, and the app tracks that the business owes the person and records the repayment.

**Already in the app:** expenses can already be logged in a short tap flow (`lib/flows/expense.ts`, `ExpenseEntry`): category from the live chart of expense accounts, amount, optional supplier name, how it was paid, and an optional receipt photo, with posting to the ledger and reports of expenses by category and by who entered them (`/accounting/expenses`). The flow deliberately models money the business spent on the spot (cash, card machine, card to card); it does not model a person paying out of pocket and being repaid later. There is no approval step or amount owed to a person.

**Why parked:** it adds a liability account per person and a repayment flow; approval limits and who approves; receipts are paper (F1 can read them later); mixing personal-pocket and business-cash expenses in one list must stay unambiguous.

**Open questions**
1. A new "paid by me" method on the existing flow that creates an amount owed, or a separate claim form?
2. Approval: the group manager up to a limit, the owner above it (F48)?
3. Repayment: marked paid in cash, bank transfer or together with salary? Posted to which accounts?
4. Monthly statement per person and a clear "you are owed" figure.

**Suggested first slice:** add a "paid from my pocket" choice to the existing expense flow that marks the expense as owed to the person, a manager approve or reject list, and a per-person owed balance. Repayment recorded by hand.

**Prerequisites:** the expense flow and ledger postings (exist); F26 describes the field-expense side; F48 for approval limits.

---

## F89. Customer price history

**What:** every price a customer has been charged (and, once quotes exist, offered) for each product, with dates and the list price at the time, to settle "you charged me less last time" and to spot unplanned discounts.

**Already in the app:** each order line freezes the price it was sold at (`unit_price_toman`, with `price_id` pointing at the dated list price), so the history is in the data. The customer page shows a purchase history with each order's number, status, date, payment status, total and line count, and a product mix with packs and totals per product (`components/PurchaseHistory.tsx`). It does not show unit price per product over time, and quotes are not recorded (F29).

**Why parked:** showing past prices to reps changes negotiations (they may anchor on the lowest price ever given); prices for different pack sizes are not comparable without normalising; discounts and uplifts (F21, F65) must be shown as adjustments, not as price changes.

**Open questions**
1. Who sees it: the rep and manager for their customers, or managers only?
2. Compare unit price per base unit to make pack sizes comparable?
3. Mark lines sold below list price (using `price_id` to find the list price in force on that date) and below a margin floor?
4. Include prices from orders that were cancelled or returned? Probably show them greyed.

**Suggested first slice:** on the customer page, a per-product list of the last five unit prices with dates and the list price at the time, read from existing order lines. Quotes and discount flags later.

**Prerequisites:** none; F29 adds quotes, F56 improves the list-price history.

---

## F90. Monthly staff pay summary for the accountant

**What:** an end-of-month sheet per person combining commission (accrued, paid and owed), progress against targets, attendance, and approved expense reimbursements, ready to export for the accountant.

**Already in the app:** commission statements exist for salespeople (`lib/commissionLedger.ts`: delivered kilograms, accrued, paid and still owed, the orders behind it, and the plan used, flat or tiered), for drivers (`lib/driverCommissionLedger.ts`) and for managers (`lib/managerCommissionLedger.ts`), shown on `/sales/commission` with a plan copy tool. Targets exist (`lib/repo/targets.ts`) and the chart of accounts has a salary account (5103). Attendance (F25) and reimbursements (F88) do not exist, and I found no stored base salary, so a "total pay" figure would be incomplete.

**Why parked:** payroll is a sensitive, legally relevant output; the commission figures must stay exactly equal to what the ledger already produces (earlier work required payroll output to stay byte-identical), so the sheet must reuse those functions and never recalculate; base salary and deductions are outside the app today.

**Open questions**
1. Does the sheet stop at "commission owed plus approved reimbursements", or include a base salary entered by hand each month?
2. Export format for the accountant: Excel or CSV with fixed columns, per month, with a lock once exported?
3. Who may see it: the owner only, or managers for their group?
4. Corrections after export: shown as an adjustment in the next month rather than editing a locked month.

**Suggested first slice:** a read-only monthly sheet per person assembled from the three existing commission statements plus targets, with a CSV export and no salary or attendance columns.

**Prerequisites:** the commission statements (exist); F25 and F88 add attendance and reimbursements; F27 for logging exports.

---

## F91. Call and visit quota tracking

**What:** a daily or weekly target for the number of calls and visits per salesperson, with a simple progress bar on their day and a summary for managers, kept separate from revenue targets.

**Already in the app:** targets exist for revenue, kilograms and order count per person or group and month (`lib/repo/targets.ts`, `TargetMetric`). Calls and visits are logged as activities with outcomes, and the coverage analytics already report how many visits actually got logged and how long the days ran (`lib/repo/coverageAnalytics.ts`). There is no target for the number of calls or visits, so activity is measured but never compared with a goal.

**Why parked:** activity quotas can encourage quantity over quality (many short, pointless calls); the right number differs by role and season; the count must come from logged outcomes, not taps on a counter.

**Open questions**
1. Count calls, visits, or both? Does a no-answer count?
2. Daily, weekly, or both; per role or per person?
3. Shown to the rep only, or compared in a team table? Start with the rep and their manager.
4. Pair with outcome measures (orders per call) so the number alone is not the goal (see F41).

**Suggested first slice:** extend targets with a "calls and visits per week" metric counted from the existing activities, and show the progress bar on the rep's day. No team ranking.

**Prerequisites:** the activity timeline and targets (exist); F41 for quality alongside quantity.

---

## F92. Territory revenue map

**What:** a map of revenue by district compared with the district's potential (customers and prospects), to show where growth is available and which districts are over- or under-served.

**Already in the app:** the map has a customer density heat map (`components/HeatmapLayer.tsx`), districts with a coverage status (visited, needs coverage, not allowed, unknown), and a coverage and cost-to-serve analytics module (`lib/repo/coverageAnalytics.ts`). The heat map shows where customers are, not how much they buy, and there is no per-district revenue or potential figure.

**Why parked:** "potential" needs a definition (number of businesses of the right type in the district, from lead imports; population; competitor presence) and those figures may be thin or stale; district boundaries must stay consistent for trends to mean anything; group-scoped views must not reveal another group's revenue.

**Open questions**
1. Potential from what: the count of known customers and leads per district, an owner-entered estimate, or both?
2. Metric: revenue, kilograms or orders; last 90 days against the previous 90?
3. Visual: a district colour scale (low, expected, high) or a ratio of revenue to potential?
4. Who sees it: the owner for all districts, a group manager for their group's districts only.

**Suggested first slice:** colour each district by revenue over the last 90 days (from delivered orders grouped by the customer's district) on the existing map, group-scoped, with potential left out for now.

**Prerequisites:** districts and customer district assignment (exist); lead data supplies potential later.

---

## F93. Warehouse bin locations and stock transfers

**What:** record where inside a warehouse each batch is kept (aisle, shelf, bin or cold room), move stock between bins with a scan, keep a history of who moved what, and show locations on pick lists.

**Already in the app:** stock is tracked per location (`facility_id` on stock movements and batches), where a location can be a warehouse, cold storage, van and several other kinds (`facilities`). Moving stock between two locations is already done as a paired `TRANSFER_OUT` and `TRANSFER_IN` movement, used when loading a van and when unloading it (`lib/repo/vanStock.ts`, `lib/repo/unload.ts`), and available as a manual movement kind. There is no level below a location: no aisle, shelf or bin.

**Why parked:** bin tracking needs discipline at every move or the data rots; it multiplies the transfer volume; pick lists ordered by bin only help after the physical layout is mapped; label and scan support (F1, F30, and label printing) should exist first.

**Open questions**
1. Model bins as child locations of a warehouse, or as a free-text "position" on a batch's stock record?
2. Scan to move (needs labels on bins and batches) or pick from a list?
3. Does the first slice stay at "which cold room or zone" rather than shelf-level?
4. Should reservations and FEFO picking consider bin proximity?

**Suggested first slice:** add a zone field (for example cold room, dry store, returns) to warehouse stock via the existing transfer movement, with a zone-to-zone transfer in the stock screen and a history list. Shelf-level bins later.

**Prerequisites:** stock movements and facilities (exist); F1 and F30 for scanning.

---

## F94. Warehouse picking accuracy log

**What:** record picking mistakes (wrong item, short, extra, damaged on pick) per picker, product and order, found at loading, at delivery or by a customer, to see patterns and fix their causes.

**Already in the app:** delivery lines record planned, delivered and returned quantities per order line, a short delivery has its own order state and reasons, and van loading creates paired transfer movements (`lib/repo/vanStock.ts`). There is no picking step as such (no pick list, no picker identity on an order) and nothing that attributes a mistake to a picker.

**Why parked:** without a pick step there is no one to attribute a mistake to; a log of mistakes per person is sensitive and can feel punitive; many shortages are stock-record errors, not picking errors, so the log needs a cause category.

**Open questions**
1. Who is the picker: the person who loads the van, recorded on the load step?
2. Categories: wrong item, wrong quantity, damaged, expired item picked, stock record wrong?
3. Where do errors enter: at loading (a checker), at the door (driver), or from a complaint?
4. Reports by cause and product first; by person only for the manager.

**Suggested first slice:** a "load check" with an error reason when the checker finds a difference at van loading (ties to F30), and a simple report by reason and product. No per-person view.

**Prerequisites:** F30 (van loading verification) creates the moment to record it.

---

## F95. Staff birthdays and work anniversaries

**What:** reminders for the team for birthdays and work anniversaries, with an optional congratulation message.

**Already in the app:** users have a display name, role and phone number; the occasions list in the planner (`lib/holidayOccasions.ts`) is for lunar-calendar days off, not staff events. I found no birth date or start date on a user.

**Why parked:** birth dates are personal data and need the person's consent; the field must be optional; the reminder has little business value on its own and should not compete with real work alerts.

**Open questions**
1. Does each person enter their own date (optional), or does the owner?
2. Jalali dates for birthdays; how are Gregorian-registered dates shown?
3. Who is reminded: only the owner and the person's manager, or the whole team?
4. A weekly digest rather than a daily push, to keep notifications quiet (see F67).

**Suggested first slice:** two optional fields on the user (birth date, start date) set by the person, and a card on the owner's and manager's briefing for the coming seven days. No push.

**Prerequisites:** none; F90 and F86 could use the start date.

---

## F96. Inter-group order transfers

**What:** an order taken by one group that must be fulfilled from another group's stock or route, with a clear handover, status visible to both groups, and the commission and revenue assigned according to a stated rule.

**Already in the app:** data is scoped by group (orders, runs, customers, tasks all carry a group), and some reference data can be shared across groups (facilities with no group are visible to every group in the organisation, `groupFilterWithShared` in `lib/session.ts`, read-only). An order is planned onto its own group's runs. There is no way to hand an order from one group to another.

**Why parked:** scope rules are a security boundary (a group manager must never see another group's customers); commission and target credit across groups needs an agreed rule; stock reservation and delivery would have to cross the scope line in a controlled way.

**Open questions**
1. Transfer the whole order (the other group fulfils and delivers), or only stock (the other group supplies, the original group delivers)?
2. Commission and revenue: to the selling group, the delivering group, or split?
3. Who approves: both group managers, or the owner?
4. What each side may see: the receiving group sees the order and delivery address, not the customer's history.

**Suggested first slice:** a "request fulfilment by group B" action on a confirmed order that creates a task for group B's manager to accept or refuse, and on acceptance moves the delivery responsibility only. Stock and commission rules stay unchanged for now.

**Prerequisites:** the group scope model (exists); F48 for approval; the commission statements need a documented rule.

---

## F97. Vehicle assignment history

**What:** which driver used which van on which day, kept as a history, to answer questions about fuel, damage, fines and maintenance and to compare vans.

**Already in the app:** vehicles have a plate, name, capacity limits, refrigeration flag, cost per kilometre and a default driver (`vehicles.driver_default_id`), and delivery runs gained a `vehicle_id` column during the routing work, alongside a route template with a default driver and vehicle. A comment in `lib/repo/vanStock.ts` still says runs carry no vehicle and that the default driver is the only link, so I could not confirm that run planning actually fills the vehicle in. Each van also has its own stock location.

**Why parked:** the history is only as good as the planner's discipline in choosing a vehicle per run; a driver swapping vans on the day must be recorded; fuel and damage records (the fleet ideas) do not exist yet to attach to it.

**Open questions**
1. Is the vehicle chosen at planning time, at loading, or both (a swap at the depot)?
2. How is a van swap recorded mid-day, and who may record it?
3. Reports: days used and kilometres per vehicle, per driver; cost per kilometre against actual.
4. Link to incidents and fuel logs once they exist.

**Suggested first slice:** require a vehicle on each run when it moves to ready, show "driver, van, date" in a history list per vehicle and per driver, and report kilometres by vehicle from the run's actual distance.

**Prerequisites:** the existing run vehicle column and vehicles table.

---

## F98. Customer note and visit search

**What:** search across all call and visit notes for a phrase, such as "closing for renovation" or "prefers morning", to find the customers affected, with results scoped to what the searcher may see.

**Already in the app:** a global search overlay already finds customers, orders and other records, with Persian-aware matching (it folds Arabic and Persian letter forms and digits, `lib/persian.ts`, `lib/repo/search.ts`) and the same group and role scoping as the pages it mirrors. Call and visit notes are stored on activities (`insertActivity`, with a `note` column) and shown on the customer timeline, but they are not searched.

**Why parked:** notes may contain sensitive remarks about people, so searching them widens what a manager can find; matching in free Persian text needs normalisation and, ideally, word-boundary handling; searching every note across many customers must stay fast (an index, not a full scan on each keystroke).

**Open questions**
1. Who may search notes: managers over their group, reps over their own customers only?
2. Search note text only, or also task titles, complaint descriptions and order notes?
3. Result view: customer cards with a highlighted snippet, and a way to turn a result list into a call list (see F70).
4. Highlight the match and show date and author.

**Suggested first slice:** a "search notes" mode in the existing search overlay that matches activity notes for customers the user can already see, returning customer, date and a snippet. Task and complaint text later.

**Prerequisites:** the existing search model and activity notes.

---

## F99. Product catalogue change log

**What:** a history of product creation, renaming, pack-size and unit changes, price entries and deactivation, with who changed it and when, shown on the product page.

**Already in the app:** prices and costs are already versioned as dated, insert-only rows (`product_prices`, `product_costs`), so price history exists in the data. A generic activity log (`logActivity` into `activity_log`: entity, event type, old and new value, note, who) is used for districts, visit plans, photos and the duplicate-customer merge. The product routes do not write to it, so renames, unit and pack changes and deactivation leave no history.

**Why parked:** a rename that silently changes how past orders read is the kind of change people want traced; the log must not slow product edits; showing it to everyone is unnecessary, so access needs a rule.

**Open questions**
1. Log all field changes or a short list (name, unit, pack, active, SKU)?
2. Show on the product page to managers, and to finance?
3. One shared change log helper for products and other reference data (suppliers, vehicles, price tiers)?
4. Include who deactivated a product and the stock on hand at that moment.

**Suggested first slice:** call the existing `logActivity` from the product create, update and deactivate routes, and add a "history" list on the product page. Price changes appear from the existing dated rows.

**Prerequisites:** none; F27 describes the broader audit trail.

---

## F100. Customer ownership change history

**What:** when a customer moves between salespeople or groups, record who moved it, when, from whom to whom and why, and show it on the customer page and in a report.

**Already in the app:** an `owner_change` activity ("change of owner") appears on the customer timeline (`lib/crm/timeline.ts`), but it is written only when a salesperson takes a customer from the group pool, with the note "taken from the group pool" and no previous owner (`lib/repo/crm/write.ts`). A reassign request exists (`requestReassign`). I found no record of a manager moving a customer from one rep to another, or of a group change.

**Why parked:** reassigning customers affects commission, targets and open tasks (see F59), so the history should be written wherever the owner changes, not only in one flow; old owners should not lose access to their past activity.

**Open questions**
1. Capture every change path (pool claim, manager reassign, bulk handover, deactivated user) in one place?
2. Store previous owner, new owner, actor and reason (reason from a short list)?
3. Does commission follow the owner at the time of the order (current behaviour) or the owner at the time of payment? Confirm and document.
4. A report of ownership changes by month to spot churn in assignments.

**Suggested first slice:** write the previous and new owner and a reason into the existing `owner_change` activity from all owner-changing paths, and show "from X to Y by Z" on the timeline.

**Prerequisites:** the activity timeline (exists); F59 handover uses the same record.

---

## F101. Bulk delivery notes per run

**What:** print all of a run's delivery notes in one go, in stop order, with a cover sheet (driver, van, totals, cash to collect), instead of printing them one at a time.

**Already in the app:** the receipt handed over at the door is built from one stop's numbers (`lib/deliveryReceipt.ts`, `lib/receiptLayout.ts`) and printed from the delivery flow ("print receipt") and from done stops; the planner and report pages have print buttons (`components/PrintButton.tsx`). That is the customer's copy after delivery. There is no pre-printed note per stop for the run and no multi-page print.

**Why parked:** print layout for many pages needs page breaks that work on common printers; right-to-left Persian text and Jalali dates must print correctly; the format is a document design (see F36 on templates).

**Open questions**
1. Printed at loading time as a packing and handover note, or as a paper backup of the route sheet?
2. One page per stop with lines and totals, plus a cover page with the run summary?
3. Reprinting after a stop changes (an order edited or cancelled) must show the latest.
4. Combine with the route sheet idea so the driver has one packet.

**Suggested first slice:** a "print all notes" button on a ready run that renders the existing receipt layout for each stop in order, separated by page breaks, with a cover summary. No new template editor.

**Prerequisites:** the receipt builder and print button (exist); F36 later for owner-editable templates.

---

## F102. Manager approval inbox

**What:** one screen listing everything waiting for the manager's decision (orders in review, credit approvals, price changes, expenses, reassign requests), sorted by age, with the decision actions in place.

**Already in the app:** quick-decision decks exist for specific queues: cheques due for a verdict, complaints to triage, credit approvals, and duplicate customer pairs (`lib/decisions.ts`, the decks on `/sales/today`, with `pendingForDeck` for credit). The briefing lists credit waiting and unplanned orders. Orders waiting in `PENDING_REVIEW` for a manager's pass are handled through the orders pages (I did not verify that they appear in a deck). There is no single list across all kinds.

**Why parked:** a unified inbox pulls in several repos with different permissions, so each item must be filtered by what this manager may decide; every new approval type (F48, F76, F88) must plug into it, which needs a common item shape; the inbox has to stay fast.

**Open questions**
1. A common item shape (kind, subject, age, requester, summary, actions) that each approval type provides?
2. Order of the list: oldest first, or by value and risk?
3. Delegation (F82): shows items for those the manager is covering, marked as such.
4. Actions in place with the existing consequence confirmation, or open the detail page?

**Suggested first slice:** a read-only unified list assembled from the queues that already exist (credit approvals, orders in review, complaints to triage, cheques due), linking to the existing decision screens. Common actions later.

**Prerequisites:** the existing decks and approvals; F48, F76, F82 and F88 plug into it later.

---

## F103. Rep mileage log

**What:** distance driven by each salesperson on visits, estimated from the locations of the customers visited that day (or entered at month end), for reimbursement and for comparing effort across territories.

**Already in the app:** visits and calls are logged against customers, customers and leads have coordinates, a straight-line distance helper exists (`lib/geo.ts`), and routing has road-distance support for delivery runs. Delivery runs record planned and actual distance (`delivery_runs.actual_distance_km`). Salespeople's own movement is not stored anywhere, so there is no log to total.

**Why parked:** a distance derived from visit points is only an estimate (the order of visits and the road network matter); continuous tracking would be more accurate but raises the privacy issues in F68; reimbursement money rides on the number, so disputes need a clear method.

**Open questions**
1. Method: sum of road distances between the day's logged visit locations in time order (estimate), or manual odometer entries at start and end of day?
2. Starting and ending point: home, office, or the first and last visit?
3. Approval by the group manager before it reaches reimbursement (F88)?
4. Non-visit trips (collecting a cheque, a meeting) added by hand.

**Suggested first slice:** a day summary for each rep: the visits logged in time order and the estimated road distance between them, using the routing distance helper, shown to the rep and manager. No reimbursement link yet.

**Prerequisites:** visit activities with locations (exist); F68 if position events are stored; F88 for the payout.

---

## F104. Customer snapshot on call pickup

**What:** a compact card shown when a rep opens a customer from a call list: balance, last order, last note, open tasks, risk flags, and the best time to call, so the rep is ready within two seconds.

**Already in the app:** the briefing's call list shows only each customer's name and last purchase date and links to the customer page (`lib/repo/briefing.ts`); the customer page has the history timeline, purchase history, photos and reminders; the visit "intel" flow collects business facts (size, current supplier channel, products used, best time to visit, a note for the next visitor, `lib/crm/intel.ts`). Debt and risk (churn, credit) are computed elsewhere. They are not combined into one pre-call card.

**Why parked:** a card must be fast, so its pieces need to come from one cheap query; too much on it defeats the purpose; each field needs its own role check (a rep may not see another group's balance).

**Open questions**
1. Which five facts, in what order? Candidates: balance and overdue, last order date and items, last note, open tasks, next best action.
2. Show it as a sheet over the call list or at the top of the customer page?
3. Include the intel facts (best time to call, supplier channel)?
4. Offline cache for the most recent customers (see F105).

**Suggested first slice:** a bottom sheet opened from a call-list row showing balance, last order, last note and open tasks from existing data, with a "call" and "log outcome" button. No new scoring.

**Prerequisites:** none; F8, F46 and F47 add signals later.

---

## F105. Offline tasks and notes

**What:** reps can read their tasks and customer notes, add notes and log call outcomes with no signal, synced when the connection returns.

**Already in the app:** an offline layer exists (`lib/offline`: an IndexedDB store, an outbox, a sync engine, queue-if-offline, clock-skew handling and ids generated on the device). Offline it can queue draft orders (create, edit, submit), delivery start and complete, payment records, cheque records, complaint records and new-customer capture (`lib/repo/syncMutations.ts`). The pull sends the catalogue, and orders and customers for the user's scope. Tasks, notes (activities) and call outcomes are not in the pull or in the queued actions, and approvals (order approve, plan, freeze, credit decision) are explicitly refused offline. Note: this means F13 should record that the layer reaches beyond drivers.

**Why parked:** tasks change on the server while the rep is offline (reassigned, completed by a manager), so conflict rules are needed; a call outcome creates follow-up tasks on the server, which the offline copy must not duplicate; the pulled data grows with each added table.

**Open questions**
1. Which actions first: read tasks, add a note, close a task, log a call outcome?
2. Conflict rule when a task changed on the server meanwhile: server wins and the rep is told?
3. Do offline call outcomes create their follow-up task locally, with a temporary id replaced on sync?
4. How many days of tasks and customers are cached, and how is the cache cleared on logout?

**Suggested first slice:** pull the user's open tasks and the last notes for their customers, show them read-only offline, and queue "add note" only (a pure append, no conflict). Task closing and call outcomes after that.

**Prerequisites:** the offline layer and sync pull (exist); F13 describes the wider goal.

---

## How to promote an item

1. Write `docs/superpowers/specs/YYYY-MM-DD-<item>-design.md` (answer the open questions, pick the first slice).
2. Write the plan with `writing-plans`.
3. Add the new flow/step to the design rules (`docs/mobile-first-principles.md`, once it exists) so it follows the same anatomy.
