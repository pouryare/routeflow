# Roadmap: what to build, in order of status

This is the working list of every idea for RouteFlow that is not built yet. It is sorted **first by status, then by area**. Nothing here is promised or scheduled: an item is only a plan until someone writes its spec (see "How to promote an item" in `docs/future-features.md`).

Two other files go with it:

- [`docs/decisions.md`](decisions.md): platform facts the owner decided (database, hosting, libraries, maps, UI kit) and the questions still open.
- [`docs/roadmap-archive.md`](roadmap-archive.md): finished batches and the full answer the owner gave to every study idea. Each item below says where its full text is.

## How to read it

| Status | Meaning |
|---|---|
| **Build next** | Decided by the owner, and nothing else has to exist first. Shown with its full decision (open the arrow). |
| **Waiting** | Decided, but it needs another feature, an account (for example Farazsms) or an unbuilt part first. Short line only. |
| **Parked or skipped** | The owner parked it, skipped it, or said "not now". Short line only, with the reason. |
| **Done** | Built. Listed in section 4; the long history is in the archive. |
| **Not chosen yet** | An F-entry from `docs/future-features.md` that nobody has decided on. They are in the index in section 5. |

**IDs.** Every old ID is kept: **F** = entry in `docs/future-features.md`; **T** Twenty, **S** SuiteCRM, **D** Dolibarr, **E** EspoCRM, **A** Akaunting, **B** Bigcapital, **Z** ezBookkeeping studies, **H** the Holoo comparison; **UIB-A…F** the 2026-10-28 UI pattern batches; **FB1…FB44** the Fleetbase study items (new short tags for items that had none; the old text calls the third-pass ones D3-n, so D3-5 is FB36). Two ideas that two studies both suggested were merged into one line and show both IDs: **T7 / Z17** (totals of the filtered list) and **D13 / E10** (per-person switches). Ideas that are only similar stay separate and point to each other.

**Size** of an F-entry is a rough guess for its *first slice*: **S** a small change on code that exists, **M** a new table or screen, **L** cross-cutting or needs infrastructure or an outside service. It is a judgement and is meant to be argued with.

**How the status was decided.** The owner has not given statuses; this is the cleaner's reading of the old text. "Build next" means the old text names no prerequisite. "Waiting" means the text says "after", "with", "waits for" or "built with" another unbuilt thing. Move any item that looks wrong.

**Ground facts (2026-10-23).** The database is PostgreSQL, the current data is dummy, the server is in Iran, one company uses the app today (others may follow), and the number of drivers is unknown. Details: [decisions.md](decisions.md).

## Contents

1. [Build next](#1-build-next)
2. [Waiting](#2-waiting-for-something)
3. [Parked or skipped](#3-parked-or-skipped)
4. [Done and partly done](#4-done-and-partly-done)
5. [Index of F-entries (ideas not chosen yet)](#5-index-of-f-entries)
6. [Design notes: foundations, overlaps, order, unverified claims](#6-design-notes)

## 1. Build next

Decided, and nothing else has to be built first. Open the arrow on an item for the owner's full decision, word for word from the old roadmap. Order inside an area is not a priority; the owner picks the batches. Batches decided so far: Fleetbase batch 1 (FB1 to FB5) and batch 2 (FB6 to FB9) are next in `TODO-REPORT.md`.

### Screens, lists and desk speed

- **UIB-B. Quick wins for taps.** Haptics on tap and on errors, one button-state rule (idle, busy, done, failed), and checks that wait until you leave a field.
  <details><summary>Full decision</summary>

  **Batch B: quick wins.** Haptics on tap and on errors, one button-state rule (idle, busy, done, failed), validation that waits for the person to leave a field.

  </details>
- **UIB-D. Find and act faster.** Ctrl-K runs actions, pinned pages, one shared selection bar for lists, a setup checklist for a new company, and a first-use tour.
  <details><summary>Full decision</summary>

  **Batch D: find and act faster.** Ctrl-K gets actions and not only search, pinned pages, one shared selection bar for lists, a setup checklist for a new company, a first-use tour. The map's saved-list search still has English labels.

  </details>
- **FB1. Orders list you can search and filter.** Filter chips for status, payment, rep and day; a count; load more past 100; paste many order numbers or phones to find them.
  <details><summary>Full decision</summary>

  **Orders list you can search and filter.** `/sales/orders` reads at most 100 orders and takes no filter inputs. Add `FilterChips` for status, payment, rep and day, a count, «load more» past 100, and one paste-many search (paste order numbers or phones, get just those).

  </details>
- **FB2. Undo on the planner.** Commit, freeze and day-lane moves get the 5-second undo toast.
  <details><summary>Full decision</summary>

  **Undo on the planner.** Commit, freeze and day-lane moves get the 5-second undo toast (`useUndoableAction`); `RoutingPlanner` calls `/routing/commit` and `/runs/{id}/freeze` directly today.

  </details>
- **FB4. Empty states name what is hidden.** Say what is hidden («۳ مورد به تعویق افتاده») and offer to clear the filter that causes it.
  <details><summary>Full decision</summary>

  **Empty states name what is hidden.** Action centre, tasks and filtered lists say «۳ مورد به تعویق افتاده، فردا ۰۹:۰۰» and offer «پاک کردن فیلتر» when a filter is the cause.

  </details>
- **FB5. Detail sheets: bottom by default, movable to the side.** Every detail sheet opens at the bottom; one saved choice per person moves them to the side.
  <details><summary>Full decision</summary>

  **Detail sheets: bottom by default, movable to the side.** Every detail sheet opens at the bottom (phone and desk); the user can move it to the side. Reuse the toggle in `CustomerDetailPanel` (`orient`, saved in `coverage_panel_orient`, icons `panel-bottom` / `panel-side`), flip its default to bottom, apply it to order details, and keep one shared saved choice per person for every detail sheet (decided 2026-10-30).

  </details>
- **FB6. Saved views.** Per person, named filter sets on the orders and customers lists, stored on the server.
  <details><summary>Full decision</summary>

  **Saved views.** Per person, named filter sets on the orders and customers lists, stored on the server.

  </details>
- **FB7. Keyboard triage on desk.** J/K, X, E, S keys on the action centre, tasks and orders list. Must match the physical key so it works with the Persian layout.
  <details><summary>Full decision</summary>

  **Keyboard triage on desk.** Action centre, tasks and orders list: J/K move, X select, E acknowledge, S snooze, open, with a one-line hint strip; desk only, phones keep swipe. `BINDINGS` in `lib/hotkeys.ts` is empty and `eventMatchesChord` matches `event.key`, so the new keys must match the physical key (`event.code`) or they fail under the Persian keyboard layout; it also needs a list-cursor model on top of `lib/selection`.

  </details>
- **FB8. Category strip and daily score on the action centre.** One chip per area with its count, plus a 0 to 100 score with the change since yesterday. The score uses the queue's own weights.
  <details><summary>Full decision</summary>

  **Category strip and daily score on the action centre.** One chip per area (credit, stock, delivery, cheques) with its count that filters the queue, plus a 0 to 100 score with the change since yesterday, stored daily in `kpi_snapshots`. The score reuses the action centre's own impact, probability and urgency numbers as weights (decided 2026-10-30), so it agrees with the order of the queue and there is no second set of weights.

  </details>
- **T7. Totals for the filtered list (also Z17).** Orders, payments, cheques and expenses lists show a count and a toman sum for the current filter and ticked rows; the lead pool and task board show a count per column.
  <details><summary>Full decision</summary>

  **Totals for the filtered list.** Orders, payments and cheques lists show a count and the toman sum for the current filter; the lead pool and task board show a count per column. Computed on the server with the same filter (T7).<br><br>**Total of the list (Z17).** A strip on the payments, expenses and orders lists that follows the filters and the selected rows. Not checked on every list.

  </details>
- **T21. Export follows what you see.** Export writes the current filter and sort, or only ticked rows, up to a row cap, and says how many rows. Customer export stays behind the authenticator code.
  <details><summary>Full decision</summary>

  **Export follows what you see.** `/api/sales/orders/export` takes no filter today. It writes the current filter and sort, or only ticked rows, up to a row cap, and says how many rows it wrote; customers and payments follow. Customer export stays behind the authenticator code (T21).

  </details>
- **T1. One filter format.** Saved views, segments, rules and the report builder share one filter shape: field, operator, value, AND/OR, «من» and relative Jalali dates.
  <details><summary>Full decision</summary>

  **One filter format.** Saved views, saved smart segments (D3-5), rule conditions (F130) and the report builder (F123) share one filter shape: field, operator, value, nested AND/OR, with «من» and relative Jalali dates («۳۰ روز گذشته»). Each list offers a fixed menu of fields and operators, turned into parameterised SQL through the scoped reads (T1).

  </details>
- **T2. Unsaved-changes bar for saved views.** Changing a saved view shows Save, Save as new and Reset. Views stay personal.
  <details><summary>Full decision</summary>

  **Unsaved-changes bar.** Changing a saved view's filters shows Save, Save as new view and Reset. Views stay personal; no sharing to roles (T2).

  </details>
- **T11. New record pre-filled from the filter.** «مشتری جدید» from a filtered list opens with that group and rep set.
  <details><summary>Full decision</summary>

  **New record pre-filled from the filter.** «مشتری جدید» from a list filtered to a group and rep opens with both set (T11).

  </details>
- **T4. Bulk edit on the selection bar.** Customers: rep, group, district, price tier, tags. Tasks: assignee, due date. Count preview, one log line per record.
  <details><summary>Full decision</summary>

  **Bulk edit on the shared selection bar.** Customers: rep, group, district, price tier, tags. Tasks: assignee, due date. An empty field is left alone; a count preview («۴۲ مشتری تغییر می‌کند»); one activity line per record; credit limit is not bulk-editable; owner changes also go to the F100 history (T4).

  </details>
- **T14. One action list.** Each action is declared once (label, icon, roles, place) and feeds record buttons, the selection bar and Ctrl-K.
  <details><summary>Full decision</summary>

  **One action list.** Each action is declared once (label, icon, role set, where it applies, pinned or under «بیشتر», hotkey) and feeds the record buttons, the selection bar and Ctrl-K, so the three never disagree on role gates (T14).

  </details>
- **B7. Bulk results.** Every bulk action ends with «N انجام شد، M نشد» and a list of skipped rows with reasons.
  <details><summary>Full decision</summary>

  **Bulk results (B7).** Every bulk action on the shared selection bar ends with «N انجام شد، M نشد» and a list of the skipped rows, each with a Persian reason.

  </details>
- **Z3. Hide money (eye in the top bar).** One tap turns every money number into dots.
  <details><summary>Full decision</summary>

  **Hide money (Z3).** An eye in the top bar turns every money number into dots until tapped again; for everyone, remembered per person on that phone. **Owner-only amounts (Z11):** the owner marks an expense category private; others see the line with dots and owner totals still count it. It must also hide the amount in totals and exports for others.

  </details>
- **S12. Edit conflict warning.** If a field changed since you opened it, show both values and who/when; keep mine or theirs.
- **S14. Show a list or selection on the map.** The selection bar and filtered customer lists open the map with only those customers (UI batch D).

### Customers and sales (CRM)

- **E1. Follow a customer or an order.** A «دنبال کردن» bell; you follow what you own or create; followers get pushes for new orders, payments, complaints and notes.
  <details><summary>Full decision</summary>

  **Follow a customer or an order (E1).** A «دنبال کردن» bell on customer and order pages. You follow what you own or created automatically; anyone can follow or unfollow by hand. Followers get pushes for new orders, payments, complaints, status changes and notes, through the existing grouping, quiet hours and per-type switches. Today pushes go only to fixed people per notice type.

  </details>
- **E3. Lock a checked customer.** A manager locks name, phone, address and pin; a flow's change becomes a suggestion for the manager.
  <details><summary>Full decision</summary>

  **Lock a checked customer (E3).** A manager locks name, phone, address and pin. While locked, a call or visit flow cannot change them: the change becomes a suggestion the manager accepts with one tap (the F78 path). Logged. Today `applyCustomerUpdates` in `lib/repo/crm/write.ts` overwrites phone, name and pin from any flow.

  </details>
- **E4. One contact, several businesses.** A contact can link to more than one shop; the phone check allows the same person.
  <details><summary>Full decision</summary>

  **One contact, several businesses (E4).** A contact can link to more than one business (an owner of two shops, a head office and its branches). The phone check allows the same number for the same person; a call from it asks which shop. Today `phoneFor` in `lib/repo/crm/contacts.ts` refuses a phone another business already has.

  </details>
- **E14. Track a cross-sell try.** «پیگیری» on the cross-sell hint makes a try; it closes as won on the first order with that product.
  <details><summary>Full decision</summary>

  **Track a cross-sell try (E14).** «پیگیری» on the action centre cross-sell hint (`crossSellCandidates`) makes a try: product, rep, next step date. It closes as won when the first order with that product arrives, or as lost with a reason after N days. A small report of tries and wins by rep.

  </details>
- **S2. Head office and branches card.** HQ lists its branches with last order and balance; branch links up. Bill-to-HQ is not now.
- **S3. Lead pipeline board.** A column per stage with counts, days in stage, a stuck chip, and a 90-day stage-to-stage report by rep.
- **S4. Complaint waiting states and duplicate-of.** Waiting on customer or supplier stops the SLA clock; close as a duplicate of another.
- **S6. Fair lead assignment per group.** Per group: pool (default), round robin, or least open work; people on leave are skipped.
- **S15. Do-not-call and contact preferences.** Three switches per customer (calls, promo messages, service messages) with reason, date and who.
- **S16. Revive lost leads.** After a wait that depends on the lost reason (price 60 days, already supplied 120, not interested 180), back to the pool with a call-again task.
- **S17. Referrals shown and rewarded with a thank-you task.** Show the referrer on the customer page, top referrers in the source report, and a thank-you task. Rewards stay in F137.

### Orders, pricing and promotions

- **UIB-A4. Discount gaps.** Discount is ignored by customer lifetime value, the driver stop list, dashboard revenue, the commission value metric and offline sync. The quick order has no discount. No push for a new request.
  <details><summary>Full decision</summary>

  Discount is ignored by customer lifetime value, the driver stop list, dashboard revenue, the commission «value» metric and offline sync; the tap-flow quick order has no discount; no push or notification for a new request.

  </details>
- **FB3. Edit rules by order stage, with reasons.** What may change depends on the stage (ready, out for delivery, delivered). A locked field says why in one Persian line. One shared rule for the page, the API and offline sync.
  <details><summary>Full decision</summary>

  **Edit rules by order stage, with reasons.** Ready: lines may only be removed, the day only moved earlier. Out for delivery: lines and day locked. Delivered or cancelled: everything locked. Each locked field shows a one-line Persian reason; one shared rule used by the page, the API and offline sync (relates to F73).

  </details>
- **FB24. Change summaries on edited orders.** After a confirmed order is edited, the driver gets a one-line push and the warehouse sees a «تغییر کرده» badge.
  <details><summary>Full decision</summary>

  **Change summaries on edited orders.** When an order is edited after confirmation, the driver gets a one-line Persian push («اقلام تغییر کرد»، «موعد به … منتقل شد»، «مبلغ دریافتی تغییر کرد») and the warehouse sees a «تغییر کرده» badge. Extends the stage-based edit rules in 1c.

  </details>
- **FB32. Merged order timeline.** One feed per order: status changes, notes, edits, payment adjustments and chat. Built with chat phase 1.
  <details><summary>Full decision</summary>

  **Merged order timeline: built with chat phase 1.** One feed per order with status changes, notes, edits (who and the one-line summary), payment adjustments and chat messages.

  </details>
- **FB38. Invoice sent stamp.** Record when an invoice was sent and show it on the customer page. First-viewed waits for the tracking page.
  <details><summary>Full decision</summary>

  **Invoice sent stamp, now.** Record when an invoice was sent (printed or shared) and show it on the customer page. A first-viewed time waits for the tracking page, because it needs a customer-facing link.

  </details>
- **FB40. Stale draft orders.** An action centre card lists drafts older than N days (default 7); older ones are cancelled automatically with a log line.
  <details><summary>Full decision</summary>

  **Stale draft orders.** An action centre card lists draft orders older than N days (owner setting, default 7). Drafts older than the limit are cancelled automatically, with a log line for each.

  </details>
- **D4. Floor price.** A line under cost (or an owner floor per product) needs approval.
  <details><summary>Full decision</summary>

  **Floor price (D4).** A line under cost (or a higher owner-set floor per product) needs approval even when the discount percent is under `discount_auto_pass_pct`; the rep sees «زیر حداقل قیمت این کالا».

  </details>
- **D22. Quantity price steps.** Up to four steps per product and pack size; order entry nudges toward the next step.
  <details><summary>Full decision</summary>

  **Quantity price steps (D22).** Up to four steps per product and pack size (starting quantity, price). Order entry applies the step and nudges toward the next one. A step price is a list price, so it needs no discount approval; the floor price (D4) still applies.

  </details>
- **D31. Reopen a cancelled order.** A manager reopens a cancelled order to draft within N days (default 7); must be confirmed again.
  <details><summary>Full decision</summary>

  **Reopen a cancelled order (D31).** A manager or owner reopens a cancelled order to draft within an owner-set time (default 7 days). It must be confirmed again, so stock and credit are re-checked; logged with who and why; not after delivery.

  </details>
- **A12. Freeze customer details on the order.** At confirm, copy name, phone and address onto the order so reprints do not change.
  <details><summary>Full decision</summary>

  **Freeze customer details on the order (A12).** At confirm, copy name, phone and address (tax IDs once D7 exists) onto the order; `orders` keeps only `customer_id` today, so reprints show the customer's current data. Reprints use the copy. «Forget a person» (D20) clears these copies too.

  </details>
- **A13. Receipt footer and order number prefix.** Settings for footer text per document and a prefix per company.
  <details><summary>Full decision</summary>

  **Receipt footer and order number prefix (A13).** A settings card: footer text per document (receipt, delivery note, statement; the receipt footer is fixed in `lib/deliveryReceipt.ts` today) and an order number prefix per company. The next number can only go up.

  </details>

### Delivery, routing and drivers

- **FB26. Planner blockers and warnings.** Each planner check has a severity (blocker or warning) and a Persian reason. New owner setting: maximum working hours per driver per day.
  <details><summary>Full decision</summary>

  **Planner blockers and warnings.** Every planner check returns a result with a severity: a blocker stops, a warning tells; each has a Persian reason. A new owner setting, maximum working hours per driver per day, shows as a warning. No legal hours rules are built in.

  </details>
- **FB37. Driver «گزارش مشکل» sheet.** The driver picks a type and priority, adds a photo and note; it is stamped with position and stop and shows on the action centre.
  <details><summary>Full decision</summary>

  **Driver «گزارش مشکل» sheet (small version).** The driver picks a type (vehicle, road, customer, goods) and a priority, adds an optional photo and note; the report is stamped with the phone position and the current stop and shows on the action centre.

  </details>

### Stock, warehouse and suppliers

- **D21. Supplier pay list.** Supplier terms set a due date; a list shows what is due; ticked rows give a sheet for the accountant.
  <details><summary>Full decision</summary>

  **Supplier pay list (D21).** Supplier terms (days) set a due date on each purchase; a list shows what is due, oldest first; ticked rows give a sheet (supplier, Sheba, amount) for the accountant; the payment is recorded with the bank tracking number. No bank file (formats differ, F10).

  </details>
- **D32. Sell-off product state «تصفیه».** Still sellable, off the buy list; turns inactive when stock hits zero.
  <details><summary>Full decision</summary>

  **Sell-off product state «تصفیه» (D32).** Still sellable, off the buy list, no reorder warnings; it turns inactive by itself when available stock reaches zero; reps see a chip.

  </details>
- **D8. Warehouse count session.** Start a count for a facility, several phones count, review the toman value of every gap, one confirm.
  <details><summary>Full decision</summary>

  **Warehouse count session (D8).** Start a count for a facility (a snapshot), several phones count, a «what is left» list, a review with the toman value of every gap, one confirm. Reuses the reason chips of `lib/flows/stockCount.ts`.

  </details>
- **D9. Stock and value on a past date.** A Jalali date chip on the stock page shows quantity and value on that date.
  <details><summary>Full decision</summary>

  **Stock and value on a past date (D9).** A Jalali date chip on the stock page shows quantity and value per product and facility on that date, with a total and export.

  </details>
- **D16. Supplier price rows.** Per product and supplier: price, minimum quantity, delivery days, supplier code.
  <details><summary>Full decision</summary>

  **Supplier price rows (D16).** Per product and supplier: price, minimum quantity, delivery days, supplier code. Purchase entry pre-fills the price and warns under the minimum; feeds D17 and F31.

  </details>
- **D17. Buy list grouped by supplier (first slice of F11).** Products under their reorder point, minus what is on order, grouped by supplier; tick to make purchase drafts.
  <details><summary>Full decision</summary>

  **Buy list grouped by supplier (D17, the F11 first slice).** «لیست خرید»: products under their reorder point, minus what is on order, rounded up to the supplier minimum, grouped by the cheapest or fastest supplier. Tick to make a purchase draft per supplier; a person confirms.

  </details>
- **D19. Labels at goods receipt.** Print a label per batch or pallet (product, batch, expiry, QR) and an A4 PDF of barcodes.
  <details><summary>Full decision</summary>

  **Labels (D19).** At goods receipt, print one label per batch or pallet (product, batch, expiry, QR) on the Bluetooth printer, plus an A4 PDF of pack barcodes. The same QR serves F1 scanning later.

  </details>
- **B5. Sent and received transfers between facilities.** Goods show as «در راه» between send and receive; not received after N days goes to the action centre.
  <details><summary>Full decision</summary>

  **Sent and received transfers between facilities (B5).** Goods leave the source when sent, show as «در راه» (not sellable, counted in stock value) and land when received; not received after N days goes to the action centre. Warehouse-to-van loading stays one step.

  </details>
- **B10. Product page with its history.** Tabs: orders that sold it, purchases, stock moves, cost and price changes.
  <details><summary>Full decision</summary>

  **Product page with its history (B10).** Tabs: orders that sold it, purchases that bought it, stock moves, cost and price changes. Rows link to the order or purchase.

  </details>

### Money: credit, payments and cash

- **UIB-A3. Credit approval for group managers.** The proxy closes credit approval to group managers. Move it to the sales API the way the discount decision was moved.
  <details><summary>Full decision</summary>

  Credit approval is closed to group managers by `proxy.ts` (its API is under `/api/admin`); move it the way the discount decision was moved to `/api/sales`.

  </details>
- **T8. Calendar view of cheques by due date.** Phone: agenda grouped by day. Desk: Jalali month grid with daily sums.
  <details><summary>Full decision</summary>

  **Calendar view of cheques by due date.** Phone: an agenda grouped by day (`DayChips`); desk: a Jalali month grid with daily sums. Payment promises (F50) and tasks reuse it later (T8).

  </details>
- **D1. Money in hand per driver and rep.** Cash and cheques go to the person's own box; the office counts at day end; a gap is saved with a reason.
  <details><summary>Full decision</summary>

  **Money in hand per driver and rep (D1).** Cash and cheques a person collects land in their own box, not straight in the office cash account (`1101`). At day end the office counts and confirms; a short or extra amount is saved with a reason and shows on the action centre. The owner sees one line per person: holding now, since when.

  </details>
- **D2. Cheque deposit slips, several bank accounts.** Tick cheques, pick a bank account, get a numbered slip. A bounce reopens the debt.
  <details><summary>Full decision</summary>

  **Cheque deposit slips and more than one bank account (D2).** Tick cheques on the board, pick the bank account, get a numbered slip with count, total and a printable list. A bounce takes the cheque out and reopens the debt. Works with D1 (driver box, office box, bank).

  </details>
- **D3. Close a small leftover.** A manager closes a small balance with a reason under an owner limit (default 50,000 toman).
  <details><summary>Full decision</summary>

  **Close a small leftover (D3).** A manager closes a small remaining balance with a reason (rounding, bank fee, small discount) under an owner-set limit (default 50,000 toman); bigger amounts and bad debt need the owner. Ledger entry plus log line.

  </details>
- **D23. Recurring costs.** A list of rent, salaries and subscriptions; on the day a task asks «پرداخت شد؟» and one tap records it.
  <details><summary>Full decision</summary>

  **Recurring costs (D23, answers F49 question 1).** A list of rent, salaries and subscriptions (category, amount, Jalali day of month, who pays). On the day a task asks «پرداخت شد؟» with the amount filled; one tap records the expense; the cash forecast reads the list.

  </details>
- **D24. Bank loans.** A loan card with a schedule; reminders and a one-tap payment that splits principal and interest.
  <details><summary>Full decision</summary>

  **Bank loans (D24).** A loan card (bank, amount, instalments, first due date); the schedule is made once; each due date gives a reminder and a one-tap payment that splits principal and interest; the forecast (F49) and the balance sheet read it.

  </details>
- **D5. Payment term kinds.** Cash on delivery, N days after delivery, or end of month plus N. Due date saved on the order at delivery.
  <details><summary>Full decision</summary>

  **Payment term kinds (D5, answers F83).** Cash on delivery, N days after delivery, or end of month plus N days. The due date is saved on the order at delivery, so later changes to the customer do not rewrite it.

  </details>
- **A4. Transfer between own accounts.** One «انتقال وجه» form: from, to, amount, date, tracking number, optional fee.
  <details><summary>Full decision</summary>

  **Transfer between own accounts (A4).** One «انتقال وجه» form: from, to, amount, date, bank tracking number, optional fee; one balanced entry. D1 (driver box to office), D2 (cash deposit to bank) and A3 reuse it. Petty cash `1103` is in the chart but unused today.

  </details>
- **A3. Hand reconcile of cash and bank.** Type the counted balance, tick lines until the difference is zero; ticked lines lock.
  <details><summary>Full decision</summary>

  **Hand reconcile of cash and bank (A3).** Pick an account and a date, type the counted or bank-paper balance, tick lines until the difference is zero, save. Ticked lines lock; a mistake after that is fixed by a reversal. No bank file; F10 may later pre-tick from one. D1's end-of-day count lands here.

  </details>
- **A5. Money in and out page.** A monthly page of money in and out and opening and closing cash and bank, read from the ledger.
  <details><summary>Full decision</summary>

  **Money in and out (A5).** A monthly page «ورودی و خروجی پول»: money in (receipts, cheques cashed), money out (suppliers, expenses by category, commission, loans), opening and closing cash and bank, read from the ledger legs of the money accounts. No new tables.

  </details>
- **A7. Money tiles on the owner home.** Cash box, banks, owed to us, we owe, cheques due this week; each tile opens its page.
  <details><summary>Full decision</summary>

  **Money tiles (A7).** One strip on the owner home: cash box, each bank, owed to us (with the overdue part), we owe (with what is due in 7 days), cheques due this week. Each tile opens its page. A default card for F146.

  </details>
- **A10. Repeat an expense.** A «تکرار این» button opens the expense form pre-filled.
  <details><summary>Full decision</summary>

  **Repeat an expense (A10).** A «تکرار این» button on an expense row opens the form pre-filled (category, supplier, amount, new date). Expenses only, not customer payments.

  </details>
- **B1. Credit note.** A manager makes a credit for goods returned after delivery; applied to open orders or paid back. Suppliers get the same document.
  <details><summary>Full decision</summary>

  **Credit note (B1).** A manager makes a credit for goods returned after delivery, with a reason and an amount. It lowers what the customer owes and is applied to open orders or paid back in cash. Suppliers get the same document for goods sent back. Today the `RETURNED` status only ends the undelivered part (`lib/orderStateMachine.ts`); this is the money side of F12 and F80.

  </details>
- **Z9. Place on money entries.** The phone's GPS spot is saved with cash, cheque and expense entries.
  <details><summary>Full decision</summary>

  **Place on money entries (Z9).** The phone's GPS spot is saved with cash, cheque and expense entries and shown as a pin; no far-from-customer flag for now. Not checked: whether delivery stops already store a proof location.

  </details>

- **H5. Cleared cheque reaches the bank.** When a cheque is marked «وصول شد», one entry moves it from cheques receivable to the bank.
  <details><summary>Full decision</summary>

  **Cleared cheque reaches the bank (H5, Holoo comparison, fixes a wrong number).** Today `advanceCheque` (`lib/repo/cheques.ts`) only changes the status on «به بانک سپرده شد» and «وصول شد»; the money stays in `1202` چک‌های دریافتنی and the bank `1102` is too low by every cleared cheque. On «وصول شد» post Dr bank / Cr `1202`, with the account chosen the way D2 picks it. Cheques already cleared get one catch-up entry. A bounce already voids the payment and works. Built first of the Holoo fixes. Not checked: whether any report works around it.

  </details>

### Accounting, reports and analytics

- **T15. Sales chart bug and calendar days (with T20).** The weekly chart skips empty days, so one empty day shifts every bar. Fill calendar days with 0, show closed days, compare the same weekdays; add sales by weekday, a month-to-date line, and rankings with an «سایر» row.
  <details><summary>Full decision</summary>

  **Sales chart bug.** `revenue_by_day` in `lib/dashboard.ts` is built only from days that had orders and the sales page takes the first 7 as «this week» and the next 7 as «last week», so one empty day shifts every bar. Build calendar days filled with 0, show Fridays and holidays as closed, compare the same weekdays (T15). With it: sales by weekday, a cumulative month-to-date line against last month, and rankings showing top 10 plus “سایر” instead of silently dropping the rest (T20).

  </details>
- **D7. Official invoice for some customers.** Per-order choice: tax IDs, VAT per product, invoice number per Jalali year, Moadian export later.
  <details><summary>Full decision</summary>

  **Official invoice, some customers only (D7, answers F147 numbering).** A per-order choice: tax IDs on company and customer, VAT per product, an invoice number given at confirmation per Jalali year (drafts use no number), a Moadian export later. Other orders stay as today.

  </details>
- **D29. Logo and stamp on documents.** Upload once; PDF receipt, delivery note and statements print them; thermal printer prints the logo.
  <details><summary>Full decision</summary>

  **Logo and stamp (D29).** The owner uploads a logo and a stamp/signature image once; PDF receipt, delivery note and statements print them; the thermal printer prints the logo in black and white; the stamp is on or off per document type.

  </details>
- **A2. Close a month.** Owner closes a month after a short checklist; reopening needs a reason; a closed month refuses entries.
  <details><summary>Full decision</summary>

  **Close a month (A2).** `fiscal_periods` and the closed-month refusal in `postJournal` exist, but nothing sets a month to closed (`lib/repo/reports.ts` only reads it). The owner closes a month after a short checklist (deliveries posted, drafts listed, cash counted); reopening needs a reason; both are logged (E6). A closed month refuses new entries; corrections go into the next open month. D26 (month pack) and E5 (own-mistake window) need this.

  </details>
- **A11. Discounts given report.** Toman given as discount by rep, customer and product, approvals versus auto-passes.
  <details><summary>Full decision</summary>

  **Discounts given (A11).** A monthly report of toman given as discount by rep, customer and product, with approvals versus auto-passes. No page reads `order_discounts` for a report today.

  </details>
- **A6. Expense categories per company.** A small per-company category table pointing at the shared accounts. Decide before a second company.
  <details><summary>Full decision</summary>

  **Expense categories per company (A6).** The `accounts` table has no `organization_id`, so the chart is shared and `expenseCategories()` lists every active expense account for every company. A small per-company category table pointing at the shared accounts lets each company add, rename, retire and group categories and mark one «هزینه مستقیم» (printed above gross profit). History is untouched. Decide before a second company is added.

  </details>
- **B2. Open a date range in a closed month.** Owner opens one range with a reason; it closes again by itself. Extends A2.
  <details><summary>Full decision</summary>

  **Open a date range in a closed month (B2, extends A2).** The owner opens one date range with a reason; it closes again by itself after a set time. Logged. A2 stays one lock for all areas.

  </details>
- **B3. Books behind a document.** A «ثبت‌های حسابداری» button on order, payment, expense and cheque pages for the owner and accountant.
  <details><summary>Full decision</summary>

  **Books behind a document (B3).** A «ثبت‌های حسابداری» button on order, payment, expense and cheque pages for the owner and the accountant: the debit and credit lines the document made, each linked to its account.

  </details>
- **Z7. Needs attention.** A filter chip for entries with no photo, note or supplier; the month-close checklist shows the count.
  <details><summary>Full decision</summary>

  **Needs attention (Z7).** A filter chip on expense and payment lists for entries with no photo, note or supplier; the month-close checklist (A2) shows the count and the owner accepts or fixes it.

  </details>

- **H1. Real کل / معین levels in the chart of accounts.** Use the empty `parent_id` to link accounts to their group; reports show a subtotal per group.
  <details><summary>Full decision</summary>

  **Real کل / معین levels (H1, Holoo comparison).** `accounts.parent_id` exists but no code reads it and the seed leaves it empty; the header rows `1000` to `5000` are not linked to the accounts under them, so the chart is flat plus a type. Link each account to its group, show a subtotal per group in the trial balance, balance sheet and income statement. The تفصیلی layer stays as the customer, supplier, party and group tags on ledger lines (no account per customer). An export mapping for an outside accountant was not chosen; it can follow the month pack (D26).

  </details>
- **H2. Close the year.** A «بستن سال» button moves the year's profit into retained earnings; reports get a year filter.
  <details><summary>Full decision</summary>

  **Close the year (H2, Holoo comparison).** There is no year object and no closing entry, on purpose (no second set of books). The balance sheet derives one line «سود و زیان دوره» (`3900`) from all revenue and expense since the start, so old profit never resets, and the profit split debits `3103` which never received the profit, so `3103` goes negative. A «بستن سال» button posts one closing entry per Jalali year that moves the year's profit into `3103`; the `3900` line then covers only the open year; income statement and balance sheet get a year filter (today a single month or all time). Owner and the accountant role (H3) can run it; reopening needs a reason and is logged. Entry numbers keep running as today (restarting each year was not chosen). Works with A2 (close a month) and the yearly split. Not checked in the app: only the code was read.

  </details>
- **H6. Void an expense or a purchase.** A «باطل کردن» button with a reason posts the mirror entry and keeps the original visible.
  <details><summary>Full decision</summary>

  **Void an expense or a purchase (H6, Holoo comparison).** Payments can be voided and re-allocated, but expenses and purchases have no edit or void route (only the receipt photo), so a 2,000,000 fuel entry typed instead of 200,000 cannot be corrected from the app. Add a «باطل کردن» button with a reason on expenses and purchases: it posts the mirror entry (as `postReceiptReversal` does for payments), the original stays visible, and the log names who did it. Expenses first. Voiding a purchase must recompute the product's average cost and show the affected orders, so it waits with B6.

  </details>

### People, approvals and management control

- **FB27. Live commission preview (first slice of F19).** The commission editor shows the result for sample sales as the rule changes, using the payroll calculation.
  <details><summary>Full decision</summary>

  **Live commission preview (first slice of F19).** The commission editor shows the result for sample sales values as the rule changes, using the same calculation as payroll so the preview cannot drift from the real engine.

  </details>
- **D15. Money rules for expenses.** Owner sets limits per expense category and role; over the limit the expense waits for approval.
  <details><summary>Full decision</summary>

  **Money rules for expenses (D15, answers F26 and F88).** The owner sets a limit per expense category and role (per entry and per day). Over it, the expense waits as «منتظر تأیید» for a manager or owner with the reason shown.

  </details>
- **D18. Team week grid.** People down the side, days across, counting visits, tasks and deliveries; tap for that person's day.
  <details><summary>Full decision</summary>

  **Team week grid (D18).** Managers get people down the side and days across, each box counting visits, tasks and deliveries; tapping opens that person's day. Phone: one card per person with a week strip.

  </details>
- **E5. Undo your own fresh mistake.** Whoever entered a payment, note, task or photo can void it within N minutes (default 15) with a reason.
  <details><summary>Full decision</summary>

  **Undo your own fresh mistake (E5).** Whoever entered a payment, note, task or photo can void it within N minutes (owner setting, default 15) with a reason; after that, manager only. Logged, and voided payments stay in the money log (D6). Today voiding a payment is for managers only.

  </details>
- **S23. Staff on leave until a date.** Still can sign in; assignment skips them; planner warns; a cover card lists their open leads and tasks.

- **H3. Accountant role.** A new login that reads all accounting and can post manual entries, reversals and the year close.
  <details><summary>Full decision</summary>

  **Accountant role (H3, Holoo comparison).** Today only owners read all accounting and a group manager reads the journal and expenses (`lib/accountingGate.ts`); the roadmap speaks of «the accountant» only as someone who receives a file (D21, D26). A new role reads every accounting page and export, and can post a manual سند (a bank fee, a loan, a correction between accounts; it must balance and be tagged MANUAL), reverse an entry (H6), and close a month (A2) or the year (H2). Every action is logged by name. No user admin, prices or commission. Adding a role means checking every role list in the gates (`MANAGE_ROLES`, `OWNER_ROLES` and the proxy), so it is a real piece of work; per-screen ticks like Holoo's were not chosen. F128 (auditor) was not found in `docs/roadmap.md`; check before reusing the number.

  </details>

### Platform, security and administration

- **UIB-A2. Code guard on the remaining sensitive actions.** The rule and the guard exist; each of these needs one line: creating an owner or manager, customer export, changing your own mobile, hard deletes, cancelling or editing a delivered order, authenticator reset, overwrite imports.
  <details><summary>Full decision</summary>

  The code guard on creating an owner or manager, customer export, changing your own mobile number, hard deletes, cancelling or editing a delivered order, authenticator reset and overwrite imports (the rules and the guard exist; each route needs one line).

  </details>
- **FB29. Authenticator nudge.** A banner with «فعال‌سازی اکنون» for managers until they enrol. No lock-out.
  <details><summary>Full decision</summary>

  **Authenticator nudge.** A banner with a «فعال‌سازی اکنون» button for managers and anyone required to use the authenticator, shown until they enrol; no lock-out after a grace period.

  </details>
- **FB34. Owner access review card.** On the status page: users per role, never signed in, no authenticator, idle 30+ days, recent impersonations.
  <details><summary>Full decision</summary>

  **Owner access review card on the owner status page.** Users per role, never signed in, no authenticator, no sign-in for 30+ days, recent impersonations; each line opens the list. Reads the existing sign-in log.

  </details>
- **FB41. Log retention with a preview.** Each growing log gets a keep-for-N-days setting; the status page shows what the next purge would delete.
  <details><summary>Full decision</summary>

  **Log retention with a preview.** Each growing log table (SMS ledger, sign-in log, outbox, notifications) gets a keep-for-N-days setting. The owner status page shows how many rows the next nightly purge would delete.

  </details>
- **T5. Created by, and how.** Orders, customers, payments and tasks store a source (form, quick order, import, rule, system...) next to the creator.
  <details><summary>Full decision</summary>

  **Created by, and how.** Orders, customers, payments and tasks store a source next to the creator (form, quick order, offline sync, import, rule, system, Telegram), shown as one line and usable in filters. F85 stays the sales channel (T5).

  </details>
- **T6. Readable timelines.** Merge one person's edits within 10 minutes; hide cost, margin and credit changes from roles that cannot see them.
  <details><summary>Full decision</summary>

  **Readable timelines.** On the merged order timeline and the customer timeline: one person's edits within 10 minutes merge into one entry; cost, margin and credit changes are hidden from roles that cannot see them; position pings and counters are not logged (T6).

  </details>
- **T3. Recycle bin (F111): JSON copy in a trash table (also T18).** First types: reminders, tasks, photos. A link to a deleted item shows who deleted it, with a restore button for managers.
  <details><summary>Full decision</summary>

  **Recycle bin (F111): a JSON copy in a trash table**, not a `deleted_at` column; first types reminders, tasks and photos, per-company keep-for-N-days in the log-retention setting. A link to a deleted item shows who deleted it and when, with a restore button for managers (T3, T18).

  </details>
- **T17. Maintenance banner.** Owner sets start and end; everyone sees a banner; drivers and reps are told to sync first.
  <details><summary>Full decision</summary>

  **Maintenance banner.** The owner sets a start and end; everyone sees a dismissible Persian banner; drivers and reps are also told to sync offline work before it starts (T17).

  </details>
- **T24. Rate limiter moved to Postgres.** Short and long windows per person and IP.
  <details><summary>Full decision</summary>

  **Rate limiter move to Postgres.** Give each rule a short and a long window, keyed by person and IP (for example 5 code tries a minute and 20 an hour) (T24).

  </details>
- **D6. Tamper-evident money log.** A hash chain over money events only, with a «check the chain» button for the owner.
  <details><summary>Full decision</summary>

  **Tamper-evident money log (D6, answers F27).** One hash chain per company over money events only (order confirmed, payment, cheque status, journal posted, month closed, leftover closed); the owner has a «check the chain» button. Not every edit.

  </details>
- **D30. Owner-set thresholds.** One settings card for numbers now fixed in code (stalled order days, quiet customer days, ageing days, duplicate order window, snooze days).
  <details><summary>Full decision</summary>

  **Owner-set thresholds (D30).** One settings card for the numbers now fixed in code: stalled order days (`actionCenter.ts`, 2), quiet customer days (`mapWorklist.ts`, 45), data ageing days (`freshness.ts`, 7 and 14), duplicate order window (`duplicateOrder.ts`, 24 hours), alert snooze days (7). Current values are the defaults; reset button; changes logged.

  </details>
- **D13. Per-person extra switches (also E10).** A short list on top of roles; start with four: may see cost, may export, may bulk edit, may give customers to others.
  <details><summary>Full decision</summary>

  **Per-person extra switches (D13).** A short list on top of roles (for example a rep may see cost), checked in the same gates as roles. The exact list is proposed at build time.<br><br>**D13 per-person switches:** start with four: may see cost, may export, may bulk edit (T4), may give customers to others. Checked in the same gates as roles (E10).

  </details>
- **D20. Forget a person.** Owner-only and manual: personal data cleared, orders and ledger stay under «مشتری حذف‌شده».
  <details><summary>Full decision</summary>

  **Forget a person (D20).** Owner-only and manual: name, phones, address, pin and notes are cleared; orders and ledger stay under «مشتری حذف‌شده»; the person is also removed from the trash copy (T3) and campaign lists; logged without the old values. No automatic job.

  </details>
- **E6. Access and settings change log.** A who/when/old/new line for role, group, active state, password resets and company settings.
  <details><summary>Full decision</summary>

  **Access and settings change log (E6, answers F27 question 1 for permissions).** A who/when/old/new line for role, group, active state and password resets of users, and for company settings (discount auto-pass percent, code for sensitive actions, the D30 thresholds), shown on the owner status page beside the access review card (D3-3). Today `setRoles`, user edits and these settings write no log line.

  </details>
- **E17. Sign out after idle time.** Owner sets idle hours per role; drivers and reps stay signed in so offline work is not lost.
  <details><summary>Full decision</summary>

  **Sign out after idle time (E17).** The owner sets idle hours per role (for example 12 for owner, managers and accountant); drivers and reps stay signed in so offline work is not lost. Today a sign-in lives 30 days whether used or not.

  </details>
- **E7. Background exports and bulk edits.** Exports over ~1,000 rows and bulk edits over ~100 run as jobs with progress and a push when ready.
  <details><summary>Full decision</summary>

  **Background exports and bulk edits (E7).** Exports over about 1,000 rows (T21) and bulk edits over about 100 records (T4) run on the job runner with a progress count and a push when ready; the file is kept 24 hours.

  </details>
- **Z2. No double save.** Every money form sends a one-time key; a repeat returns the first result.
  <details><summary>Full decision</summary>

  **No double save (Z2).** Every money form (payments, expenses, cheques, transfers, purchases) sends a one-time key; a repeat returns the first result and saves nothing new. One shared helper. Offline sync already does this with `client_uuid`; the online forms and the journal table do not.

  </details>
- **Z11. Owner-only amounts.** The owner marks an expense category private; others see dots and totals still count it.
  <details><summary>Full decision</summary>

  **Hide money (Z3).** An eye in the top bar turns every money number into dots until tapped again; for everyone, remembered per person on that phone. **Owner-only amounts (Z11):** the owner marks an expense category private; others see the line with dots and owner totals still count it. It must also hide the amount in totals and exports for others.

  </details>
- **Z4. App lock.** After N minutes in the background the app asks for a 4-digit PIN or fingerprint.
  <details><summary>Full decision</summary>

  **App lock (Z4).** After N minutes in the background the app asks for a 4-digit PIN or fingerprint; the owner sets N per company; forgot PIN means a normal login. Separate from the authenticator code for sensitive actions.

  </details>
- **Z16. Merge duplicates.** «ادغام در…» moves all rows of a supplier, product or district to another: owner only, typed-name confirm.
  <details><summary>Full decision</summary>

  **Merge duplicates (Z16).** «ادغام در…» moves all rows of a supplier, product or district to another and retires the old one: owner only, typed-name confirm, a log line. Expense and money categories wait until the ledger question is decided (re-point the label, or post a reversal pair).

  </details>
- **Z19. Safe refresh.** «به‌روزرسانی داده‌ها» refuses while items are waiting to sync, then clears the local copy.
  <details><summary>Full decision</summary>

  **Safe refresh (Z19).** «به‌روزرسانی داده‌ها» in settings refuses while items are still waiting to sync, then clears the local copy and reloads.

  </details>
- **S24. «گزارش مشکل برنامه» button.** One line and an optional screenshot with page, role, version, phone and connection attached; a list for the owner.

### Mobile, input, offline and help

- **UIB-C. Forms that keep your work.** Drafts survive a closed tab, an unsaved-changes bar, phone keyboard handling, and instant updates with a rollback.
  <details><summary>Full decision</summary>

  **Batch C: forms that keep your work.** Drafts that survive a closed tab, an unsaved-changes bar, keyboard handling on phones, optimistic updates (`useOptimistic`) with a rollback.

  </details>
- **Z1. Sums in the keypad.** The shared keypad gets + and − and shows the running total.
  <details><summary>Full decision</summary>

  **Sums in the keypad (Z1).** The shared keypad (`components/mobile/Keypad.tsx`, `lib/keypad.ts`) gets + and − only (no × ÷) and shows the running total.

  </details>
- **Z18. Save and add next.** A «ثبت و بعدی» button on expense, payment and customer forms.
  <details><summary>Full decision</summary>

  **Save and add next (Z18).** A «ثبت و بعدی» button on the expense, payment and customer forms; it keeps the date and the remembered method and account.

  </details>
- **Z10. Remember method and account.** Per person, only payment method and bank account are remembered.
  <details><summary>Full decision</summary>

  **Remember method and account (Z10).** Per person, only payment method and bank account are remembered; the category always starts empty.

  </details>
- **Z12. Type a sentence and Z15 paste a bank SMS.** A plain rule parser, no AI: «بنزین ۴۵۰ هزار» opens the expense form; a pasted card-to-card SMS opens the payment form.
  <details><summary>Full decision</summary>

  **Type a sentence (Z12) and paste a bank SMS (Z15).** A plain rule parser, no AI, works offline. «بنزین ۴۵۰ هزار» opens the expense form with the amount and a category guessed from words used before. A pasted card-to-card bank SMS opens the payment form with amount, date and tracking number; start with the 3 or 4 biggest banks, fall back to an empty form.

  </details>
- **Z13. Share a photo into the app, and Z14 icon shortcuts.** A shared photo opens a new expense with it as the receipt; long-press the app icon for record payment, new order, record expense.
  <details><summary>Full decision</summary>

  **Share a photo into the app (Z13).** `app/manifest.ts` gets a share target; a shared photo opens a new expense with it as the receipt. Expense receipt only for now. **Icon shortcuts (Z14):** long-press the app icon for record payment, new order, record expense, by role.

  </details>

### Messaging, chat and telephony

- **FB9. Internal chat, phase 1: threads on orders and customers.** A native chat, no outside server. Phase 1 is a thread on every order and customer. The owner may read any 1:1 or group chat and members see a notice.
  <details><summary>Full decision</summary>

  **Internal chat, first slice: threads on orders and customers.** See the decision below.<br><br>**Internal chat system (decided 2026-10-30).** A native chat, no outside chat server; the existing-solutions search was skipped on the owner's say-so. Phases: (1) a thread on every order and customer, (2) 1:1 and group chats on the same tables (one conversation table with a subject: customer, order, direct or group), (3) photos, search and read receipts. Decided 2026-10-30: the owner may read any 1:1 or group chat, members see a standing notice («مالک می‌تواند این گفتگو را ببیند») and each owner read is logged. Rules to settle when it is designed: a thread is visible only to people who may see the record, and adding someone grants no access to the record; mentions go through the existing notification preferences and quiet hours; online-only at first, saying so on a failed send; live delivery by server-sent events or polling over Postgres, no Redis.

  </details>
- **S19. Push before a timed task.** One push 10 minutes before (owner can change). Check first that none exists.

## 2. Waiting for something

Decided, but each needs something first. The "waits for" part is in the line. The full decision is in the archive (`docs/roadmap-archive.md`, sections 1b to 1k).

### Screens, lists and desk speed

- **UIB-E. Desk layouts and dashboards.** Denser desk screens and dashboard patterns. Comes after the phone patterns are done.
- **FB19. Setup checklist details.** Minutes per step, a % bar, steps that tick from real data. Waits for UI batch D (UIB-D).
- **A17. Typed filters on desk screens.** Text such as `بدهی>۱۰۰۰۰۰۰ منطقه:۳` turns into filter chips. Comes with T1.

### Customers and sales (CRM)

- **FB36. Saved smart segments.** A customer filter saved by name, usable by promotions and reminders. Comes with F28 and F21.
- **T12. F122 custom fields rules.** Text, number, choice, date, yes/no; up to ten; archive instead of delete. Waits for F122.
- **T13. F82 / F59 lend a rep's customers.** A manager lends customers to a colleague for N days; access ends by itself. Waits for F82 / F59.
- **E2. «به شما سپرده شد» notice.** One push when records are handed to you; many at once become one push. Built with S6, T4 and F59.
- **E16. F122 conditional custom fields.** A custom field may show and require itself when another field matches. Waits for F122.
- **S7. Merge with a choice per field.** Pick name, phone, pin, address, owner; the losing phone is kept as a second number. Part of F148.
- **S21. Expected first-order month on a lead.** Optional Jalali month shown on the pipeline board. Comes after S3.

### Orders, pricing and promotions

- **FB18. Receipt layout live preview.** A preview card that updates as you type. Waits for the receipt layout page.
- **FB33. Internal versus customer-visible notes.** Until the tracking page (F6, F79) exists every note is internal.
- **D14. Prices that follow a base number.** Product price = named number × factor, rounded to 1,000 toman, with a preview. Comes with F56.
- **S8. F29 quote answers.** Draft, sent, accepted, lost, expired; expiry 7 days; frozen prices; accept makes an order draft. Waits for F29.
- **S10. F44 contract end and renewal task.** End date, reminder N days before (default 30), ended contracts stop drafts. Waits for F44.

### Delivery, routing and drivers

- **FB10. Freshness labels on positions and ETAs.** Every live dot shows its age; an arrival says live, planned or estimated. Waits for F6 live tracking.
- **FB11. Customer tracking page.** A coarse three-step status before an SMS code, then map and arrival. Waits for F6 and F79.
- **FB12. Late-start, off-route and long-stop alerts.** Per-company switches and thresholds, sent once per order. Waits for F6.
- **FB13. Position retention as a setting.** Per-company keep time with a system maximum. Waits for F6.
- **FB14. Route simulator for testing.** A fake driver on a planned route to test arrivals and take screenshots. Waits for F6.
- **FB15. Arrival after a short stay (dwell).** Count arrival only after a short stay inside the customer's circle. Waits for F6 and F38.
- **FB16. Run replay map.** Scrub a driver's day with time and speed per point, for disputes and mileage. Waits for F6.
- **FB17. QR scan proof and a required-proof setting.** QR on the delivery note scanned at the door; per-company required proof. Waits for the F17 design.
- **FB25. ETA stage rules.** No driver means no ETA; started means a live ETA per stop; every ETA has a confidence. Recorded for F6 and F79.
- **FB35. Delivery window capacity.** Owner sets a maximum orders per window; order entry shows places left. Waits for F57.
- **FB39. Sort position pings by their own time.** Note for F6: a late ping must not move the dot backwards.

### Stock, warehouse and suppliers

- **D27. «Arrives on…» date.** Order entry shows «+300 expected Tuesday» beside a shortage. Comes after D17.

### Money: credit, payments and cash

- **T23. F50 payment promises wake-up row.** A follow-up closes itself when paid, otherwise wakes on the date; the same row can serve snooze and cooldowns. Waits for F50.
- **D11. Pay by link through an Iranian gateway.** A link per order or balance on the company's own merchant account. Waits for a merchant account.
- **A8. Reminder days around the due date.** Owner sets a day list (−3, 0, +3...); each day a task is made for the rep. First slice of F18; uses D5.
- **B4. Bank line rules.** A short rule list pre-fills imported bank lines. Waits for the F10 bank import.
- **Z5. Month calendar.** A tab on the money in/out page (A5): Jalali grid with collected, delivered and expenses per day.
- **Z20. Month so far.** A bar for the month gone and a month-end guess, on the A7 tiles and the A5 page.

### Accounting, reports and analytics

- **D26. Month pack for the accountant.** One spreadsheet after a month is closed. Waits for closing a month (A2) and stock value on a date (D9).
- **A1. Starting balances.** The setup wizard asks once for cash, bank, debts and stock value and makes one OPENING entry. A step in F126.
- **Z6. Expenses by paste.** Waits for the F10 import to accept an expenses sheet.
- **S11. F123 report questions and subtotals.** Run-time chips (period, rep, group), group by a column with subtotals, one chart. Waits for F123.

### People, approvals and management control

- **S5. SLA working-hours clock.** Owner sets working hours (default Sat–Wed 8–17, Thu 8–13). Part of F51.

### Platform, security and administration

- **UIB-A1. SMS backup for the sensitive-action code.** Send the code by SMS (Farazsms) when someone has no authenticator, with a resend countdown. Needs an account and an approved template.
- **T22. Staff invitation by SMS link.** A 48-hour single-use link to set a password. Waits for Farazsms and the SMS guard.
- **T9. F130 rule builder: draft, test, firing log and budget.** Edit a draft then publish; test on one customer; firing log; daily firing budget per rule. Waits for F130.
- **T10. F126 import wizard steps.** Upload, pick sheet and header row, match columns, fix cells, import with dedupe by mobile. Waits for F126 / F10.
- **D12. Switches per company.** Cheques, batches, leads, commission, van stock can be turned off per company. A step in the setup wizard (F126).
- **S9. F130 rules skip imported records.** Imported records are skipped unless a rule switch says otherwise. Waits for F130.
- **S13. Who-can-do-what page.** Owner, view only, made from the real gates. Comes after T14.
- **S20. Replaced document keeps the old version.** Kept 30 days as «نسخهٔ قبلی». Waits for the documents feature.
- **S25. Document valid-until date.** A task 30 days before and an expired chip. Waits for the documents feature.

### Mobile, input, offline and help

- **E11. F146 home screen defaults.** Owner sets a default per role; each person may hide or reorder cards except pinned ones. Waits for F146.

### Messaging, chat and telephony

- **FB21. Internal chat phases 2 and 3.** 1:1 and group chats on the same tables, then photos, search and read receipts. Waits for phase 1.
- **FB20. Attempts list with retry on the status page.** Per message: tries, outcome, time and a retry button. Waits for the batch A delivery log.
- **FB23. SMS guard.** Iranian numbers only, a cooldown per number, a daily budget, a spike alert and one ledger row per attempt; monitor first, then enforce; owner pause switch. Built together with Farazsms.
- **FB28. Message templates (F136).** Placeholders such as `{customer.name}` with a picker. Waits for F18, F79 and F120.
- **T16. F70 / F21 SMS campaigns rules.** Opt-out list with reason and source, two topics (promotions, service), test send, scheduling, counts. Waits for Farazsms and F70.
- **E8-E9. Chat rules (F43).** Up to 3 pinned messages; edit your own for 24 hours; a person who cannot see a record cannot be mentioned on it. Waits for chat.
- **A15. Phone that does not work.** An invalid-number failure marks the phone and makes a fix-it task. Waits for Farazsms.
- **A16. Payment receipt SMS.** The customer gets the amount received and remaining balance. Waits for Farazsms.
- **S22. Pre-flight checklist before an SMS campaign.** Red items block sending (empty list, empty placeholder, budget, no test send). Waits for T16.

## 3. Parked or skipped

Not planned now. The reason is in the line; the full text is in the archive.

### Screens, lists and desk speed

- **UIB-F. Rest of the 53 favourite patterns.** Need a decision or a library first. Passkeys are a later way to sign in.
- **T-skip. Skipped from the Twenty study.** Sharing saved views with a role (T2 option), a log of who opens sensitive pages (T19), short links with click counts (T16).

### Customers and sales (CRM)

- **S18. Public «request to buy» form.** Skipped (not now).

### Delivery, routing and drivers

- **FB22. Skipped: van check sheet, odometer, expiry dates, store-reviewer sign-in.** The owner skipped these (the reviewer sign-in is not needed).

### Stock, warehouse and suppliers

- **FB43. Stock hold for a quote with an expiry.** No decision taken (open question under F51).
- **B6. Cost after a purchase edit.** Parked until a purchase edit or void exists; then recompute the average cost.

### Money: credit, payments and cash

- **D10-D25-D28. Skipped from the Dolibarr study.** Customer page with SMS code (D10), depreciation of vans and equipment (D25), a calendar feed (D28).

### Accounting, reports and analytics

- **FB31. Reference notes, not decided.** Report-builder safety rules (F14), urgent-order broadcast to nearby drivers (F7), warehouse bin hierarchy (F93).
- **FB44. Scheduled saved reports to Telegram.** Skipped.
- **A9-A14. Skipped from the Akaunting study.** Three tax kinds for D7 (A9); a «بدون قیمت» print option for delivery notes (A14).
- **B8-B9-B11-B12. Skipped from the Bigcapital study.** VAT owed report (B8), profit on a cash basis (B9), sellable and buyable switches (B11), draft-then-publish money entries (B12).
- **Z8. Read-only token for the accountant's sheet.** Parked; the month pack (D26) covers the accountant for now.

### People, approvals and management control

- **FB42. Recurring driver unavailability.** Design note only: a recurring day off or leave week shown as a planner warning.

### Platform, security and administration

- **FB30. Company data purge and export with a dry run.** Parked until a second company is signed (F126, F127).
- **E12-E13-E15. Skipped from the EspoCRM study.** Fixed password-reset rules (E12), an SMS with the complaint number (E13), separate lead stage lists per group (E15).

## 4. Done and partly done

**Built as first slices (2026-10-23, PR #57 and the small-difficulty batch):** F8, F16, F19, F23, F35, F40, F47, F54, F58, F62, F67, F72, F84, F89, F98, F99, F100, F101, F107, F108, F110, F112, F116, F132, F133, F137, F142, F144. Each has a "Built" note in `docs/future-features.md` saying what the slice covers and what it leaves out. The original table of the 22 quick wins and the list of what the small batch left for later are in the archive (section 1 and 1a).

**Built from the 2026-10-28 UI pattern batch A (PR #2):** discount approval on orders, and the authenticator code before 15 sensitive actions. What was left over is UIB-A1 to UIB-A4 above. Full text: archive 1b.

**Built from the studies:** S1 (branches no longer shown as duplicates, PR #20). The records F36 (duplicate customers as a decision deck) and F37 (decisions from the mobile-first rollout) are also built work, not ideas.

**Partly built.** These F-entries say in their own notes that a meaningful part exists, so their real first slice is smaller than the title suggests:

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

## 5. Index of F-entries

All 148 entries of `docs/future-features.md` (F1 to F148), grouped by area, with a status and the study ideas that mention them ("Also in"). This is the same table as the old section 9, with two columns added. Totals from the old text: 46 small, 73 medium, 27 large first slices; 123 entries note existing code; 2 entries are records of built work.

### Customers and sales (CRM)

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F8 | Reorder prediction (who is due to order) | S |  | — | Built (first slice) | — |
| F20 | Daily visit route for salespeople | M | yes | F8 | Not built | — |
| F22 | Market and competitor price log | M |  | F1 | Not built | — |
| F28 | Customer segmentation and loyalty | M |  | F9 | Not built | FB36 |
| F29 | Sales pipeline and quotations | L | yes | F23 | Not built | S8 |
| F40 | Customer onboarding checklist | S | yes | — | Built (first slice) | — |
| F41 | Visit and call quality review | M | yes | F4 | Not built | — |
| F43 | Shared notes and @-mentions | M | yes | — | Not built | E8-E9 |
| F47 | Customer 360 page | S | yes | F8, F46 | Built (first slice) | — |
| F52 | Free samples tracking | M | yes | — | Not built | — |
| F53 | New product launch tracker | M |  | F21, F52 | Not built | — |
| F54 | Data quality dashboard | S | yes | F148 | Built (first slice) | A15 |
| F59 | Salesperson handover | M | yes | F27 | Not built | T13, E2 |
| F70 | Segment campaigns | M | yes | F8, F9 | Not built | T16 |
| F74 | Rep daily wrap-up | S | yes | F50 | Small, waits for a prerequisite | — |
| F77 | Customer visit frequency targets | S | yes | F20, F28 | Small, waits for a prerequisite | — |
| F85 | Order source tracking | S | yes | F3, F4, F44 | Small, waits for a prerequisite | T5 |
| F86 | Manager coaching notes | S | yes | F41, F59 | Small, waits for a prerequisite | — |
| F91 | Call and visit quota tracking | S | yes | F41 | Small, waits for a prerequisite | — |
| F98 | Customer note and visit search | S | yes | — | Built (first slice) | — |
| F100 | Customer ownership change history | S | yes | F59 | Built (first slice) | T4 |
| F104 | Customer snapshot on call pickup | S | yes | F8, F46, F47 | Small, waits for a prerequisite | — |
| F122 | Custom fields on customers | M | yes | F98, F148 | Not built | T12, E16 |
| F135 | Manager ride-along visits | M | yes | F86 | Not built | — |
| F137 | Lead source return on spend | S | yes | F28, F85 | Built (first slice) | S17 |
| F141 | Survey builder | M | yes | F45, F79 | Not built | — |
| F148 | Duplicate customer detection upgrade (fuzzy match, preview, undo) | M | yes | F5 | Not built | S7 |

### Orders, pricing and promotions

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F3 | Paste-to-parse (turn a pasted message into a draft) | L |  | — | Not built | — |
| F21 | Promotion and campaign manager | L |  | — | Not built | FB36, T16 |
| F23 | Digital catalogue and price list | S |  | — | Built (first slice) | — |
| F44 | Standing orders and contracts | L | yes | — | Not built | S10 |
| F56 | Price list versioning and scheduled price changes | M | yes | F21, F48 | Not built | D14 |
| F58 | Order templates and favourites | S | yes | — | Built (first slice) | — |
| F60 | Call-to-order shortcut | M | yes | F4, F58 | Not built | — |
| F61 | Backorders and partial fulfilment | M | yes | F44, F64 | Partly built | — |
| F62 | Customer-specific product visibility | S | yes | F58 | Built (first slice) | — |
| F64 | Minimum order and delivery fee rules | M | yes | — | Not built | — |
| F65 | Small-quantity price uplift | M | yes | F48, F56, F64 | Not built | — |
| F71 | Customer credit holds by rep | M | yes | F48 | Not built | — |
| F72 | Duplicate order warning | S | yes | — | Built (first slice) | — |
| F73 | Order edit history | M | yes | F27, F48 | Not built | FB3 |
| F76 | Order approval by value | M | yes | F48, F51 | Not built | — |
| F89 | Customer price history | S | yes | F29, F56 | Built (first slice) | — |
| F96 | Inter-group order transfers | L | yes | F48 | Not built | — |
| F114 | Carton completion nudges | S | yes | F58, F65 | Small, waits for a prerequisite | — |
| F121 | Pre-orders against incoming stock | L | yes | F61, F66 | Not built | D27 |
| F131 | Keyboard-first desk order entry | M | yes | F58 | Not built | — |
| F132 | Order priority flag | S | yes | F28, F64 | Built (first slice) | — |
| F145 | Counter sales and customer pickup | L | yes | F63 | Not built | — |

### Delivery, routing and drivers

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F6 | Live driver tracking and customer ETA | L |  | — | Not built | FB10, FB11, FB12, FB13, FB14, FB15, FB16, FB22, FB25, FB33, FB39 |
| F7 | Dynamic re-routing during the day | L |  | F6 | Not built | FB31 |
| F17 | Delivery proof and dispute handling | M | yes | — | Partly built | FB17, FB22 |
| F24 | Driver pay and incentives | M |  | — | Not built | — |
| F38 | Automatic arrival and departure (geofencing) | S | yes | F6 | Small, waits for a prerequisite | FB15 |
| F45 | Customer feedback loop (delivery rating) | M | yes | F6, F18 | Not built | — |
| F57 | Delivery time windows | M | yes | F38 | Not built | FB35 |
| F68 | Rep activity map | M | yes | F6, F38 | Not built | — |
| F69 | Delivery instructions (per customer and per order) | S | yes | F57 | Small, waits for a prerequisite | — |
| F78 | Driver map pin correction | M | yes | F27 | Not built | E3 |
| F79 | Late-delivery notices to customers | M | yes | F6 | Not built | FB11, FB22, FB25, FB28, FB33 |
| F81 | Peak-day capacity warning | M | yes | F25, F57 | Not built | — |
| F97 | Vehicle assignment history | M | yes | — | Not built | — |
| F101 | Bulk delivery notes per run | S | yes | F147 | Built (first slice) | — |
| F103 | Rep mileage log | M | yes | F68, F88 | Not built | — |
| F115 | Voice read-out for drivers | M | yes | F69, F117 | Not built | — |
| F118 | Supplier pickup runs | L | yes | F31, F66 | Not built | — |
| F119 | Return pickup scheduling | M | yes | F12, F80 | Not built | — |
| F120 | Delivery confirmation code | M | yes | F6, F17, F79 | Not built | FB28 |
| F139 | Third-party carrier shipments | L | yes | F17 | Not built | — |

### Stock, warehouse and suppliers

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F11 | Demand forecasting and auto-purchasing | L | yes | — | Partly built | D17 |
| F12 | Returns and quality management | M |  | F1 | Not built | B1 |
| F15 | Multi-warehouse and multi-branch | L | yes | — | Partly built | — |
| F30 | Van loading verification | M |  | F1 | Not built | — |
| F31 | Supplier scorecards and price history | S | yes | F12 | Small, waits for a prerequisite | D16 |
| F33 | Seasonal and holiday planning | M | yes | F11 | Partly built | — |
| F42 | Complaint root-cause analytics | S | yes | F12, F31 | Small, waits for a prerequisite | — |
| F66 | Supplier order tracking (purchase orders) | L | yes | F11, F31 | Not built | — |
| F80 | Warehouse returns handling | M | yes | F12 | Not built | B1 |
| F87 | Warehouse receiving appointments | M | yes | F31, F66 | Not built | — |
| F93 | Warehouse bin locations and stock transfers | M | yes | F1, F30 | Not built | FB31 |
| F94 | Warehouse picking accuracy log | M | yes | F30 | Not built | — |

### Money: credit, payments and cash

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F9 | Churn and credit-risk scoring | M | yes | — | Partly built | — |
| F10 | Bank and payment reconciliation | L |  | F5 | Not built | T10, D21, A3, B4, Z6 |
| F18 | Customer statements and dunning | M |  | F10 | Not built | FB28, A8 |
| F46 | Credit-risk scoring from payment behaviour | M | yes | — | Not built | — |
| F49 | Cash-flow forecast | M | yes | F46, F50 | Not built | D23, D24 |
| F50 | Payment promise tracker | M | yes | F18, F46 | Not built | T8, T23 |
| F63 | Deposits and prepayments | M | yes | F46 | Not built | — |
| F83 | Payment terms and early-payment discounts | M | yes | F18, F46, F50 | Not built | D5 |

### Accounting, analytics and reporting

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F14 | Natural-language reports ("ask your data") | L |  | — | Not built | FB31 |
| F16 | Owner mobile dashboard with push alerts | S |  | — | Built (first slice) | — |
| F32 | Margin analytics (customer, product, route) | M | yes | — | Not built | — |
| F34 | Data export and backup self-service | S | yes | F27 | Small, waits for a prerequisite | — |
| F67 | Friday weekly scorecard | S | yes | — | Built (first slice) | — |
| F90 | Monthly staff pay summary for the accountant | M | yes | F25, F27, F88 | Not built | — |
| F92 | Territory revenue map | M | yes | — | Not built | — |
| F116 | Amount in words | S | yes | F18, F147 | Built (first slice) | — |
| F123 | Report builder with saved reports | L | yes | F14 | Not built | T1, S11 |
| F134 | Profit and loss by group | M | yes | F32 | Not built | — |
| F144 | Failure, cancellation, return and delay reason reports | S | yes | F12, F42 | Built (first slice) | — |
| F147 | Document templates (invoices, delivery notes, statements) | M |  | F18 | Not built | D7 |

### People, approvals and management control

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F19 | Salesperson earnings view and commission simulator | S | yes | — | Built (first slice) | FB27 |
| F25 | Staff scheduling and attendance | L |  | — | Not built | — |
| F26 | Field expenses and petty cash | M |  | — | Not built | D15 |
| F27 | Audit trail and anomaly detection | M | yes | — | Not built | T-skip, D6, E6 |
| F48 | Change approvals (second-person sign-off) | M | yes | F27 | Not built | — |
| F51 | SLA and escalation rules | M | yes | — | Partly built | FB43, S5 |
| F82 | Approval delegation while away | M | yes | F27, F48 | Not built | T13 |
| F88 | Staff expense reimbursement | M | yes | F26, F48 | Not built | D15 |
| F95 | Staff birthdays and work anniversaries | S | yes | F86, F90 | Small, waits for a prerequisite | — |
| F102 | Manager approval inbox | M | yes | F48, F76, F82, F88 | Not built | — |
| F129 | Approval chains | L | yes | F48, F76, F82, F102 | Not built | — |
| F130 | Rule builder screen | L | yes | F51 | Partly built | T1, T9, S9 |
| F133 | Required training and completion tracking | S | yes | F84, F112 | Built (first slice) | — |

### Platform, security and administration

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F35 | Force a new password on first sign-in | S |  | — | Built (first slice) | — |
| F99 | Product catalogue change log | S | yes | F27 | Built (first slice) | — |
| F106 | Two-step login for owners and managers | L | yes | F107 | Not built | — |
| F107 | Device and session management | S | yes | F106 | Built (first slice) | — |
| F108 | System status page for the owner | S | yes | F34 | Built (first slice) | — |
| F109 | Self-service password reset | M | yes | F106, F110 | Not built | E12-E13-E15 |
| F110 | Login activity log | S | yes | F27, F107 | Built (first slice) | — |
| F111 | Recycle bin | M | yes | F27, F34 | Not built | T3 |
| F125 | Wallboard display | M | yes | F108 | Not built | — |
| F126 | Organisation setup wizard | L | yes | F109, F127 | Not built | FB30, T10, D12, A1 |
| F127 | Tenant usage and plan limits | M | yes | F108, F126 | Not built | FB30 |
| F128 | Read-only auditor role | L | yes | F107, F110 | Not built | D26 |
| F138 | Off-site backup copy | S | yes | F34, F108 | Partly built | — |
| F140 | Company asset register | S | yes | F59, F107 | Small, waits for a prerequisite | D11, D10-D25-D28 |

### Mobile experience, input, offline and help

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F1 | Camera capture (read a document instead of typing it) | L |  | — | Not built | D19 |
| F2 | Voice input (speak instead of typing a note) | S |  | — | Small, waits for a prerequisite | — |
| F5 | Persian text proofing (help users type clean Persian) | S | yes | F1, F3 | Small, waits for a prerequisite | — |
| F13 | Offline-first everywhere | L | yes | — | Partly built | — |
| F39 | Training and onboarding mode | M | yes | — | Not built | — |
| F75 | Offline product catalogue for reps | M | yes | F13 | Not built | — |
| F84 | In-app help and tooltips | S | yes | — | Built (first slice) | — |
| F105 | Offline tasks and notes | M | yes | F13 | Not built | — |
| F112 | What's new notes | S | yes | F84 | Built (first slice) | — |
| F113 | Radial quick-action menu and home-screen shortcuts | M | yes | — | Not built | — |
| F117 | Haptic and sound feedback settings | S | yes | F1, F30 | Small, waits for a prerequisite | — |
| F142 | Snooze for alerts and tasks | S | yes | — | Built (first slice) | T23 |
| F146 | Role-based dashboard builder | M | yes | — | Not built | E11, A7 |

### Telephony and messaging channels

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F4 | Wazo VoIP inside the CRM/ERP (call from, and log to, the customer record) | L |  | — | Not built | — |
| F55 | Owner announcements with read receipts | M | yes | — | Not built | — |
| F124 | Telegram bot for staff queries | L | yes | F107 | Not built | — |
| F136 | Message template editor | M | yes | F18, F79, F120 | Not built | FB28 |
| F143 | Approve from Telegram | M | yes | F82, F102, F124 | Partly built | — |

### Records of built work (not future features)

| ID | Feature |
|---|---|
| F36 | Duplicate customers as a decision deck — built |
| F37 | Decisions from the mobile-first rollout |

## 6. Design notes

### 6.1 Foundations

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

### 6.2 Overlaps

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

### 6.3 Suggested order of waves

A suggestion in waves. Within a wave the order is flexible; across waves it follows the dependencies above.

**Wave P — platform.** The move to PostgreSQL and the platform choices in [docs/decisions.md section 10](decisions.md#10-platform-facts-and-decisions-not-features) come first, because every later entry is written against the new database. They are not F-entries.

**Wave 0 — quick wins.** The 22 quick wins (listed under Done). They add visible value, touch little, and several (F99, F100, F110, F108, F138) are groundwork for later waves.

**Wave 1 — foundations.** First slices of F27 (audit record), F48 (one approval type), F107 → F106 (sessions, then two-step login), F66 (purchase orders, once the ordering practice is confirmed) and the single decision on the customer message channel (F6/F79). The SMS provider is decided (Farazsms); consent, opt-out and any other channel are still open.

**Wave 2 — money and orders.** F83 (payment terms) → F50 (promises) → F18 (statements) → F46 (risk) → F49 (cash-flow forecast); F58 → F60/F62/F131 (order shortcuts); F44 (standing orders); F56/F64/F65 (pricing) together; F61 (backorders) and F71/F76 (holds and approval by value).

**Wave 3 — delivery and stock.** F57 (time windows), F69 (instructions), F17 → F120 (proof and codes), F80 → F119 (returns), F30 → F94 and F93 (loading and bins), F66 → F87/F118/F121, F81 (capacity warning).

**Wave 4 — heavier or external.** F4 (telephony), F10 (bank formats), F1 (OCR), F13/F105 (more offline), F126/F127 (tenant tooling), F139 (carriers), F124/F143 (Telegram bot and approvals), F14/F123 (report builders).

### 6.4 Claims not yet verified

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

Platform claims in [docs/decisions.md section 10](decisions.md#10-platform-facts-and-decisions-not-features), all unverified:

- Nothing has been tested from Iran: the outside services in 10.5, package registries, Firebase push, map tiles.
- Package versions and dates come from the npm registry; no package was installed or run.
- The official `farazsms` client was found on npm but not inspected.
- Whether Centrifugo can read events from a Postgres outbox table.
- Whether the Postgres extension `pg_duckdb` fits, and DuckDB's npm "latest" tag being a development build.
- ~~Whether MapLibre needs the right-to-left text plugin~~: answered 2026-10-28, MapLibre 6 shapes Persian itself and labels render in Peyda (see 10.1, map tiles).
- Whether Google Play and Cafe Bazaar or Myket rules allow updating web code inside the Android app.

