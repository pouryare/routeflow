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

## How to promote an item

1. Write `docs/superpowers/specs/YYYY-MM-DD-<item>-design.md` (answer the open questions, pick the first slice).
2. Write the plan with `writing-plans`.
3. Add the new flow/step to the design rules (`docs/mobile-first-principles.md`, once it exists) so it follows the same anatomy.
