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

**Owner direction (2026-11-01).** Two choices set the build order. (1) **Street first:** the van loop that no other CRM or ERP covers (money in hand per driver with a day-end count D1, order edit rules by stage, the double-save guard Z2, offline for tasks and notes F105) is built before office accounting depth. (2) **RouteFlow replaces Holoo for the daily books:** the book fixes (cleared cheque to bank H5, returned goods B1, month close A2, year close H2) come right after the street work, then the accountant role H3 and VAT D7; until D7 exists an outside accountant files tax from the month pack. No-code flexibility (custom fields, rule builder, report builder) stays last. Comparison: [how RouteFlow differs from other CRMs and ERPs](https://claude.ai/artifact/CM5CtuL2H5iEHtLgsZFHiv).

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
  **Built (batch B):** search box (any of the pasted order numbers, names or phones; Persian digits read) and chips for status group, day, payment and rep on the orders list, all kept in the address; «نمایش ۱۰۰ سفارش قدیمی‌تر» raises the read from 100 to at most 1,000. The filters run on the orders read, not in SQL (`lib/orderListFilter.ts`).
  <details><summary>Full decision</summary>

  **Orders list you can search and filter.** `/sales/orders` reads at most 100 orders and takes no filter inputs. Add `FilterChips` for status, payment, rep and day, a count, «load more» past 100, and one paste-many search (paste order numbers or phones, get just those).

  </details>
- **FB4. Empty states name what is hidden.** Say what is hidden («۳ مورد به تعویق افتاده») and offer to clear the filter that causes it. Partly built 2026-11-05: payments and stock lists say how many are hidden and offer «پاک کردن فیلتر»; the action centre and the task board have no filters to name yet. **Batch C:** the orders list now says how many orders the search and filters hide, with «پاک کردن فیلتر».
  <details><summary>Full decision</summary>

  **Empty states name what is hidden.** Action centre, tasks and filtered lists say «۳ مورد به تعویق افتاده، فردا ۰۹:۰۰» and offer «پاک کردن فیلتر» when a filter is the cause.

  </details>
- **FB6. Saved views.** Per person, named filter sets on the orders and customers lists, stored on the server.
  <details><summary>Full decision</summary>

  **Saved views.** Per person, named filter sets on the orders and customers lists, stored on the server.
  **Built (batch C, orders list only):** under the filter chips, a person's saved views as chips (table `saved_views`, personal, on the server); tap applies, «ذخیرهٔ این فیلتر» names a new one, «حذف نما» removes it. The customers list has no saved views yet (its filters are not in the address).

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

  **Built (batch C, first slice):** the orders list heading shows the toman sum of the orders left after the search and filters. Not yet: payments, cheques and expenses lists, ticked rows, counts per column on the lead pool and task board.
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

  **Built (batch C, orders list):** after a saved view's filter is changed the bar offers «ذخیره», «ذخیره به‌عنوان نمای تازه» and «بازنشانی». Views stay personal.
  </details>
- **T11. New record pre-filled from the filter.** «مشتری جدید» from a filtered list opens with that group and rep set.
  <details><summary>Full decision</summary>

  **New record pre-filled from the filter.** «مشتری جدید» from a list filtered to a group and rep opens with both set (T11).

  </details>
- **T4. Bulk edit on the selection bar.** Customers: rep, group, district, price tier, tags. Tasks: assignee, due date. Count preview, one log line per record. **First slice built 2026-11-14 (PR #105):** customers' salesperson and group on the CRM selection bar, with a count preview and one timeline line each. Price tier, tags, district and tasks are not done.
  <details><summary>Full decision</summary>

  **Bulk edit on the shared selection bar.** Customers: rep, group, district, price tier, tags. Tasks: assignee, due date. An empty field is left alone; a count preview («۴۲ مشتری تغییر می‌کند»); one activity line per record; credit limit is not bulk-editable; owner changes also go to the F100 history (T4).

  </details>
- **T14. One action list.** Each action is declared once (label, icon, roles, place) and feeds record buttons, the selection bar and Ctrl-K. **Built 2026-11-13 (PR #102):** `lib/actionList.ts`; who sees an action comes from the role's ready tabs. Feeds Ctrl-K («کارها») and the customer map action; the record buttons are not moved onto it yet. **2026-11-14 (PR #105):** the customer sheet's buttons come from the list too.
  <details><summary>Full decision</summary>

  **One action list.** Each action is declared once (label, icon, role set, where it applies, pinned or under «بیشتر», hotkey) and feeds the record buttons, the selection bar and Ctrl-K, so the three never disagree on role gates (T14).

  </details>
- **B7. Bulk results.** Every bulk action ends with «N انجام شد، M نشد» and a list of skipped rows with reasons.
  <details><summary>Full decision</summary>

  **Bulk results (B7).** Every bulk action on the shared selection bar ends with «N انجام شد، M نشد» and a list of the skipped rows, each with a Persian reason.

  </details>
- **S12. Edit conflict warning.** If a field changed since you opened it, show both values and who/when; keep mine or theirs.
- **S14. Show a list or selection on the map.** The selection bar and filtered customer lists open the map with only those customers (UI batch D). **Built 2026-11-13 (PR #102).**

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
- **S6. Fair lead assignment per group.** Per group: pool (default), round robin, or least open work; people on leave are skipped. **Built 2026-11-13 (PR #84).** A setting per group on the groups page (stays in the pool, round robin, fewest open leads). It applies when a manager adds a lead and leaves it in the pool; people on leave (S23), inactive people and other groups are skipped, and with nobody available the lead stays in the pool. Not built: applying it to imported or claimed customers.
- **S15. Do-not-call and contact preferences.** Three switches per customer (calls, promo messages, service messages) with reason, date and who.
  **Built (batch B):** table `contact_preferences` (a row = off, with reason, day, who). Button «ترجیح تماس» in the map customer panel (all selling roles) opens a sheet of three chips; the phone shows «تماس نشود» and the «تماس بگیر» cards on the today page fall back to «ساخت سفارش». No SMS sender exists yet, so promo and service switches are stored and shown only; the message sender (Farazsms, T16) must read them when built.
- **S16. Revive lost leads.** After a wait that depends on the lost reason (price 60 days, already supplied 120, not interested 180), back to the pool with a call-again task.
  **Built (batch B):** daily worker job `leads.revive` (03:00) returns a lost or not-interested lead to the pool after its rest (price 60, supplier 120, no need 180, others in `lib/leadRevive.ts`; wrong contact and closed never), with a call task naming the lost reason; leads with calls switched off (S15) stay lost. The owner's own days are read from `app_meta` key `revive_days:<company>` (JSON by reason); no settings form yet.

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
  **Built (batch C, push only):** when the owner (or a manager's request the owner approves) changes a confirmed order's delivery day, due date, address or notes, each driver whose run is not finished and has a pending stop for it gets one push (type `order.changed`) with one line about what changed. Not built: the «تغییر کرده» badge for the warehouse, and line edits (none exist yet).

  </details>
- **FB32. Merged order timeline.** One feed per order: status changes, notes, edits, payment adjustments and chat. Built with chat phase 1.
  <details><summary>Full decision</summary>

  **Merged order timeline: built with chat phase 1.** One feed per order with status changes, notes, edits (who and the one-line summary), payment adjustments and chat messages.

  </details>
- **D4. Floor price.** A line under cost (or an owner floor per product) needs approval.
  <details><summary>Full decision</summary>

  **Floor price (D4).** A line under cost (or a higher owner-set floor per product) needs approval even when the discount percent is under `discount_auto_pass_pct`; the rep sees «زیر حداقل قیمت این کالا».

  </details>
- **D22. Quantity price steps.** Up to four steps per product and pack size; order entry nudges toward the next step.
  <details><summary>Full decision</summary>

  **Quantity price steps (D22).** Up to four steps per product and pack size (starting quantity, price). Order entry applies the step and nudges toward the next one. A step price is a list price, so it needs no discount approval; the floor price (D4) still applies.

  </details>
- **A12. Freeze customer details on the order.** At confirm, copy name, phone and address onto the order so reprints do not change.
  <details><summary>Full decision</summary>

  **Freeze customer details on the order (A12).** At confirm, copy name, phone and address (tax IDs once D7 exists) onto the order; `orders` keeps only `customer_id` today, so reprints show the customer's current data. Reprints use the copy. «Forget a person» (D20) clears these copies too.
  **Built (batch B):** migration adds `orders.ship_name/ship_phone/ship_address`, filled by the `freezeCustomer` effect at the first confirm (also on credit approval and hold release, never overwritten). The order page shows the copy. No printed invoice exists yet, so reprints (and «forget a person», D20) are still to wire when D7 lands.

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
- **D8. Warehouse count session.** Start a count for a facility, several phones count, review the toman value of every gap, one confirm.
  <details><summary>Full decision</summary>

  **Warehouse count session (D8).** Start a count for a facility (a snapshot), several phones count, a «what is left» list, a review with the toman value of every gap, one confirm. Reuses the reason chips of `lib/flows/stockCount.ts`.

  </details>
- **D9. Stock and value on a past date.** A Jalali date chip on the stock page shows quantity and value on that date.
  <details><summary>Full decision</summary>

  **Stock and value on a past date (D9).** A Jalali date chip on the stock page shows quantity and value per product and facility on that date, with a total and export.
  **Built (batch C):** page `/sales/stock/on-date` (owner and managers; link on the stock page): date drums, quantity per product at the end of that day from the stock movements, value (owner only) at today's average cost because past costs are not stored. Not built: per-facility split, export (comes with the month pack D26).

  </details>
- **D16. Supplier price rows.** Per product and supplier: price, minimum quantity, delivery days, supplier code.
  **Built (batch B):** table `supplier_prices`; «قیمت‌های این تأمین‌کننده» section on the supplier page (owner) lists, adds, changes and removes rows; the purchase form fills the cost when the supplier name and product match a row, shows delivery days and code, and warns under the minimum. D17 and F31 can read the rows.
  <details><summary>Full decision</summary>

  **Supplier price rows (D16).** Per product and supplier: price, minimum quantity, delivery days, supplier code. Purchase entry pre-fills the price and warns under the minimum; feeds D17 and F31.

  </details>
- **D17. Buy list grouped by supplier (first slice of F11).** Products under their reorder point, minus what is on order, grouped by supplier; tick to make purchase drafts.
  <details><summary>Full decision</summary>

  **Buy list grouped by supplier (D17, the F11 first slice).** «لیست خرید»: products under their reorder point, minus what is on order, rounded up to the supplier minimum, grouped by the cheapest or fastest supplier. Tick to make a purchase draft per supplier; a person confirms.

  **Built (batch C, first slice):** page `/sales/stock/buy-list` (owner; link on the stock page): products at or under their reorder point (not «تصفیه»), quantity = target less shelf (at least the supplier's minimum), grouped by the cheapest supplier price row (quicker on a tie), a group «بدون تأمین‌کننده» for the rest, with a toman total. **Completed (batch C part 3):** the list now counts units on open purchase orders as stock, and each supplier's group has «پیش‌نویس سفارش خرید», which makes a draft on `/sales/stock/orders`.
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

- **T8. Calendar view of cheques by due date.** Phone: agenda grouped by day. Desk: Jalali month grid with daily sums.
  <details><summary>Full decision</summary>

  **Calendar view of cheques by due date.** Phone: an agenda grouped by day (`DayChips`); desk: a Jalali month grid with daily sums. Payment promises (F50) and tasks reuse it later (T8).
  **Built (batch C, phone agenda only):** on the cheques page a card «سررسید چک‌های در دست» lists the cheques in hand by due day, soonest first, with the day's sum; the customer name opens the customer. The desk month grid is not built; promises and tasks do not use it yet.

  </details>
- **D1. Money in hand per driver and rep.** Cash and cheques go to the person's own box; the office counts at day end; a gap is saved with a reason.
  <details><summary>Full decision</summary>

  **Money in hand per driver and rep (D1).** Cash and cheques a person collects land in their own box, not straight in the office cash account (`1101`). At day end the office counts and confirms; a short or extra amount is saved with a reason and shows on the action centre. The owner sees one line per person: holding now, since when.

  </details>
- **D2. Cheque deposit slips, several bank accounts.** Tick cheques, pick a bank account, get a numbered slip. A bounce reopens the debt.
  <details><summary>Full decision</summary>

  **Built (batch B):** slips 2026-11-13 (PR #84); bank accounts 2026-11-13 (new table `bank_accounts` per company; depositing opens a sheet to pick or add an account; the slip and the journal that books the cleared cheque carry the account tag, so each account's cleared balance is read from the single bank ledger account `1102`). A company with no account keeps the old single-bank behaviour. Not built: renaming or closing an account, the opening balance, cash deposits and transfers into a chosen account (they stay on `1102` untagged).

  **Cheque deposit slips and more than one bank account (D2).** Tick cheques on the board, pick the bank account, get a numbered slip with count, total and a printable list. A bounce takes the cheque out and reopens the debt. Works with D1 (driver box, office box, bank).

  </details>
- **D3. Close a small leftover.** A manager closes a small balance with a reason under an owner limit (default 50,000 toman). **Built 2026-11-13 (batch B).** New payment method `LEFTOVER` (contract migration widens the method check) closes a balance without cash: Dr 5110 «بخشودگی و گردکردن» / Cr receivables, settling the oldest unpaid orders; void works as for any receipt; it is left out of the collected-money totals (KPI, week compare, payment cards). The limit (default 50,000 toman) is a threshold in the owner's «حدهای هشدار» card. UI: «بستن مانده کوچک» button + sheet (reason chips) in the customer panel on the map, shown to managers only when the balance is one they may close. Reasons: rounding, bank fee, small discount, other. Not built: bad debt write-off (owner, separate).
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
  **Built (batch B):** customers get a term kind (`payment_terms_kind`: cash on delivery, N days after, end of month + N) beside the days; managers set it with «شرایط پرداخت» on the customer page (`PUT /api/customers/[id]/terms`, audited). `orders.due_date` is written once at delivery (`lib/paymentTerms.ts`) and shown as «سررسید» on the order page. Not yet: overdue lists using the due date (aging still counts from delivery).
  <details><summary>Full decision</summary>

  **Payment term kinds (D5, answers F83).** Cash on delivery, N days after delivery, or end of month plus N days. The due date is saved on the order at delivery, so later changes to the customer do not rewrite it.

  </details>
- **A4. Transfer between own accounts.** One «انتقال وجه» form: from, to, amount, date, tracking number, optional fee.
  **Built (batch B):** «انتقال وجه» button on the expenses page (owner) opens a sheet: from and to (cash box, bank, petty cash), amount, date, bank tracking number (kept in the memo), optional fee (leaves the source, posted to «سایر»). One balanced MANUAL journal, `POST /api/accounting/transfers`, safe against a double tap. No dedicated bank-fee account yet.
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

  **Built (batch C, first slice):** page `/accounting/money` (owner, tab «ورودی و خروجی پول» in the accounts group): per month, money in and out of the cash, bank and petty-cash accounts grouped by what posted it (expenses by category), opening and closing balance. Moves between own accounts net to zero and are left out. Z5 (calendar tab) and Z20 (month so far) are not built yet.
  </details>
- **B1. Credit note.** A manager makes a credit for goods returned after delivery; applied to open orders or paid back. Suppliers get the same document.
  <details><summary>Full decision</summary>

  **Built (batch B):** credit note against the debt earlier (payment method CREDIT_NOTE, Dr 4102 / Cr 1201); 2026-11-13 added the cash refund: «نقد به مشتری پس داده شد» in the same sheet, for a customer who already paid. One entry Dr 4102 / Cr 1101 (cash box), a row in `cash_refunds`, a note on the customer timeline; a manager up to the owner's limit «سقف پرداخت نقدی برگشت» (default 200,000 toman, in «حدهای هشدار»), the owner any amount. Not built: voiding a refund, supplier credit notes, refund by bank transfer, stock.

  **Credit note (B1).** A manager makes a credit for goods returned after delivery, with a reason and an amount. It lowers what the customer owes and is applied to open orders or paid back in cash. Suppliers get the same document for goods sent back. Today the `RETURNED` status only ends the undelivered part (`lib/orderStateMachine.ts`); this is the money side of F12 and F80.

  </details>

- **H5. Cleared cheque reaches the bank.** When a cheque is marked «وصول شد», one entry moves it from cheques receivable to the bank. **Built 2026-11-13 (batch B).** Clearing a cheque posts Dr bank 1102 / Cr 1202 in the same save (`postChequeCleared`). No catch-up for cheques cleared before this (all data is dummy). The bank account is fixed to 1102 until D2 lets you pick one.
  <details><summary>Full decision</summary>

  **Cleared cheque reaches the bank (H5, Holoo comparison, fixes a wrong number).** Today `advanceCheque` (`lib/repo/cheques.ts`) only changes the status on «به بانک سپرده شد» and «وصول شد»; the money stays in `1202` چک‌های دریافتنی and the bank `1102` is too low by every cleared cheque. On «وصول شد» post Dr bank / Cr `1202`, with the account chosen the way D2 picks it. Cheques already cleared get one catch-up entry. A bounce already voids the payment and works. Built first of the Holoo fixes. Not checked: whether any report works around it.

  </details>

### Accounting, reports and analytics

- **D7. Official invoice for some customers.** Per-order choice: tax IDs, VAT per product, invoice number per Jalali year, Moadian export later.
  <details><summary>Full decision</summary>

  **Official invoice, some customers only (D7, answers F147 numbering).** A per-order choice: tax IDs on company and customer, VAT per product, an invoice number given at confirmation per Jalali year (drafts use no number), a Moadian export later. Other orders stay as today.

  **Built, first slice (2026-11-13, owner chose "numbers + VAT, no export").** Company tax code and default VAT rate on the status page; a product may carry its own rate (stock page); a customer carries a tax code (customer page); a manager turns «فاکتور رسمی» on for a draft, which needs both codes. Confirming numbers the order `YYYY/NNNNNN` per Jalali year (company-wide lock, unique index) and freezes each line's rate; the invoice page `/sales/orders/[id]/invoice` splits VAT out. **Prices already include VAT**, so totals, credit checks and the books are unchanged. Not built: Moadian file, a VAT-payable ledger account (the books do not show VAT yet), discount spread per line (spread over the VAT total), print layout and PDF, sellers and the accountant seeing the invoice link, tutorial.

  </details>
- **D29. Logo and stamp on documents.** Upload once; PDF receipt, delivery note and statements print them; thermal printer prints the logo.
  <details><summary>Full decision</summary>

  **Logo and stamp (D29).** The owner uploads a logo and a stamp/signature image once; PDF receipt, delivery note and statements print them; the thermal printer prints the logo in black and white; the stamp is on or off per document type.

  </details>
- **U1. Profit per stop (differentiator, 2026-11-01).** One number per delivery stop: sales, goods cost, fuel and driver share, minutes on site; a list of shops that lose money to serve.
  <details><summary>Full decision</summary>

  **Profit per stop (U1).** Chosen from the talk on what no CRM or ERP can copy: a CRM has no costs and an ERP has no routes, so only a joined system can say «shop X: sales 4M, goods cost 3.2M, fuel 90k, 40 minutes, profit 310k» and list the shops that lose money to serve. What exists: `components/CostToServePanel.tsx` (straight-line km from the depot, a per-km cost typed by hand in the browser, revenue matched to customers by business name text, so a renamed shop silently drops out), vehicles with `cost_per_km`, order margin in `lib/dashboard.ts`, OSRM routes in the planner. What is missing: real driving distance and time per stop, order margin per stop, vehicle cost per km and the driver's share joined in one report. An order with unknown cost shows «هزینه ناقص», never a made-up profit. Not checked: how accurate stored stop times are on real routes.

  </details>
- **U2. Money map (differentiator, 2026-11-01).** A «money» colour mode for districts: total owed and the part older than 30 days; tap a district for its numbers.
  <details><summary>Full decision</summary>

  **Money map (U2).** Customer pins can already be coloured by debt (`debtColor` in `lib/types.ts`: over 30 days red, 8 to 30 orange) and the map has a debt heat switch (`CoverageMap.tsx`), but district colours only know «status» and «group» (`DistrictColorMode`). Add a «money» mode: each district shaded by what is owed there, and a tap shows «38M owed, 20M older than 30 days, 6 shops». Small build on layers and numbers that exist. A supporting feature for demos, easy for a rival to copy, so it is not the moat.
  **Built (batch B):** third district colour mode «پول» (red when any debt is older than 30 days, green when only fresh, grey none); the district sheet says «X تومان بدهی، Y بیش از ۳۰ روز، N مغازه». `lib/districtMoney.ts`; map customers now carry `district_id`.

  </details>
- **A2. Close a month.** Owner closes a month after a short checklist; reopening needs a reason; a closed month refuses entries.
  <details><summary>Full decision</summary>

  **Close a month (A2).** `fiscal_periods` and the closed-month refusal in `postJournal` exist, but nothing sets a month to closed (`lib/repo/reports.ts` only reads it). The owner closes a month after a short checklist (deliveries posted, drafts listed, cash counted); reopening needs a reason; both are logged (E6). A closed month refuses new entries; corrections go into the next open month. D26 (month pack) and E5 (own-mistake window) need this.
  **Built (batch B):** «بستن ماه» card on the journal page (owner): a month before the current one is closed after a checklist (unfinished orders of the month, «صندوق را شمرده‌ام»); reopening needs a reason and the authenticator code; both go to the audit record (`fiscal_periods`). The closed-month refusal in `postJournal` was already there. D26 and E5 can now build on it.

  </details>
- **A11. Discounts given report.** Toman given as discount by rep, customer and product, approvals versus auto-passes.
  <details><summary>Full decision</summary>

  **Discounts given (A11).** A monthly report of toman given as discount by rep, customer and product, with approvals versus auto-passes. No page reads `order_discounts` for a report today.
  **Built (batch B):** card «تخفیف‌های ۳۰ روز اخیر» on /sales/admin/discounts (owner): total, with or without approval, top five by rep, customer, product (an order's discount shared by line value). `lib/discountReport.ts`.

  </details>
- **A6. Expense categories per company.** A small per-company category table pointing at the shared accounts. Decide before a second company.
  <details><summary>Full decision</summary>

  **Expense categories per company (A6).** The `accounts` table has no `organization_id`, so the chart is shared and `expenseCategories()` lists every active expense account for every company. A small per-company category table pointing at the shared accounts lets each company add, rename, retire and group categories and mark one «هزینه مستقیم» (printed above gross profit). History is untouched. Decide before a second company is added.

  </details>
- **B2. Open a date range in a closed month.** Owner opens one range with a reason; it closes again by itself. Extends A2.
  <details><summary>Full decision</summary>

  **Open a date range in a closed month (B2, extends A2).** The owner opens one date range with a reason; it closes again by itself after a set time. Logged. A2 stays one lock for all areas.
  **Built (batch C):** in the «بازکردن» sheet of a closed month, «فقط چند روز» takes a from-day and to-day and a reason (with the authenticator code); entries dated in those days are accepted for 24 hours, then the month is closed again by itself. Table `period_openings` keeps who, when and why. Z7 is built too: the close checklist counts expenses with no receipt or note.

  </details>
- **Z7. Needs attention.** A filter chip for entries with no photo, note or supplier; the month-close checklist shows the count. Partly built 2026-11-05: the «نیاز به بررسی» chip on recent expenses; the month-close count waits for A2.
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
  **Built (batch C):** on the journal page the owner sees «بستن سال» per finished year: one `YEAR_CLOSE` entry clears the year's revenue and expense accounts into 3103 and closes the twelve months (the last month must still be open). Profit reports, the expense lists and the profit split leave that entry out (`NOT_YEAR_CLOSE`), the balance sheet keeps it, so «سود و زیان دوره» covers only open years. Reopening a year asks for a reason and the authenticator code, opens the last month and posts a mirror entry. The income statement gets year chips (`?period=1403`). Not built: restarting entry numbers each year (not chosen); the accountant role (H3) comes separately.

  </details>
- **H6. Void an expense or a purchase.** A «باطل کردن» button with a reason posts the mirror entry and keeps the original visible.
  <details><summary>Full decision</summary>

  **Void an expense or a purchase (H6, Holoo comparison).** Payments can be voided and re-allocated, but expenses and purchases have no edit or void route (only the receipt photo), so a 2,000,000 fuel entry typed instead of 200,000 cannot be corrected from the app. Add a «باطل کردن» button with a reason on expenses and purchases: it posts the mirror entry (as `postReceiptReversal` does for payments), the original stays visible, and the log names who did it. Expenses first. Voiding a purchase must recompute the product's average cost and show the affected orders, so it waits with B6.
  **Built (batch B, expenses only):** `voidExpense` posts the mirror journal (type REVERSAL, points at the original); `recentExpenses` hides the voided row, the books keep both; category and enterer reports net by side. Button «باطل کردن» on owner rows of the expense page, `POST /api/accounting/expenses/[id]/void`. Purchase void waits for B6. Account 5110 is now a system category.

  </details>

### People, approvals and management control

- **FB27. Live commission preview (first slice of F19).** The commission editor shows the result for sample sales as the rule changes, using the payroll calculation.
  <details><summary>Full decision</summary>

  **Live commission preview (first slice of F19).** The commission editor shows the result for sample sales values as the rule changes, using the same calculation as payroll so the preview cannot drift from the real engine.

  **Built (batch B):** under the rate form, a live list of what the typed rate pays on sample sales (100, 500, 2,000 kg; or two group sales for managers), by `accrualToman`. The tier plan already had its own preview.
  </details>
- **D15. Money rules for expenses.** Owner sets limits per expense category and role; over the limit the expense waits for approval.
  <details><summary>Full decision</summary>

  **Money rules for expenses (D15, answers F26 and F88).** The owner sets a limit per expense category and role (per entry and per day). Over it, the expense waits as «منتظر تأیید» for a manager or owner with the reason shown.

  </details>
- **D18. Team week grid.** People down the side, days across, counting visits, tasks and deliveries; tap for that person's day.
  <details><summary>Full decision</summary>

  **Team week grid (D18).** Managers get people down the side and days across, each box counting visits, tasks and deliveries; tapping opens that person's day. Phone: one card per person with a week strip.

  </details>
- **E5. Undo your own fresh mistake.** Whoever entered a payment, note, task or photo can void it within N minutes (default 15) with a reason. **Built 2026-11-13 (PR #102) for payments:** the entering person may void their own within the window (a company setting); notes, tasks and photos are not covered yet. **2026-11-14 checked, nothing more to build:** photos can only be added by managers, who can already delete them; a task can already be dismissed by whoever got it; call and visit notes are an append-only log with its own corrections.
  <details><summary>Full decision</summary>

  **Undo your own fresh mistake (E5).** Whoever entered a payment, note, task or photo can void it within N minutes (owner setting, default 15) with a reason; after that, manager only. Logged, and voided payments stay in the money log (D6). Today voiding a payment is for managers only.

  </details>
- **S23. Staff on leave until a date.** Still can sign in; assignment skips them; planner warns; a cover card lists their open leads and tasks. **Built 2026-11-13 (PR #84).** A «مرخصی همکاران» card on the users page sends a person away for N days with a reason and brings them back; the «who gets this lead» list skips them; the card shows what each still holds and points to the handover card. Not built: the planner warning.

- **H3. Accountant role.** A new login that reads all accounting and can post manual entries, reversals and the year close. **Built 2026-11-13 (PR #102):** role `accountant`, manual journal with reversal, confined to `/accounting`.
  <details><summary>Full decision</summary>

  **Accountant role (H3, Holoo comparison).** Today only owners read all accounting and a group manager reads the journal and expenses (`lib/accountingGate.ts`); the roadmap speaks of «the accountant» only as someone who receives a file (D21, D26). A new role reads every accounting page and export, and can post a manual سند (a bank fee, a loan, a correction between accounts; it must balance and be tagged MANUAL), reverse an entry (H6), and close a month (A2) or the year (H2). Every action is logged by name. No user admin, prices or commission. Adding a role means checking every role list in the gates (`MANAGE_ROLES`, `OWNER_ROLES` and the proxy), so it is a real piece of work; per-screen ticks like Holoo's were not chosen. F128 (auditor) was not found in `docs/roadmap.md`; check before reusing the number.

  </details>

### Platform, security and administration

- **UIB-A2. Code guard on the remaining sensitive actions.** The rule and the guard exist; each of these needs one line: creating an owner or manager, customer export, changing your own mobile, hard deletes, cancelling or editing a delivered order, authenticator reset, overwrite imports. Partly built 2026-11-05: the guard is now on creating an owner or manager, returning a delivered order, and the hard deletes of groups and districts. **Batch B (2026-11-13):** the Excel export asks for the code too (it is a fetch now, so the code sheet can repeat it), and an upload that changes existing rows asks (`import_overwrite`). Not built: changing your own mobile (no route yet).
  <details><summary>Full decision</summary>

  The code guard on creating an owner or manager, customer export, changing your own mobile number, hard deletes, cancelling or editing a delivered order, authenticator reset and overwrite imports (the rules and the guard exist; each route needs one line).

  </details>
- **FB41. Log retention with a preview.** Each growing log gets a keep-for-N-days setting; the status page shows what the next purge would delete. **Built 2026-11-13 (batch B).** Registry in `lib/logRetention.ts` (sign-in log, notification deliveries, finished sync rows, idempotency keys; 7 to 3650 days, platform-wide like the archive). A nightly worker job `logs.purge` deletes in batches; the platform owner's status page card «نگهداری گزارش‌های فنی» shows the days and tonight's row count per log. Not covered: the SMS ledger and outbox tables do not exist yet (add them to the registry when they do).
  <details><summary>Full decision</summary>

  **Log retention with a preview.** Each growing log table (SMS ledger, sign-in log, outbox, notifications) gets a keep-for-N-days setting. The owner status page shows how many rows the next nightly purge would delete.

  </details>
- **T5. Created by, and how.** Orders, customers, payments and tasks store a source (form, quick order, import, rule, system...) next to the creator. **Built 2026-11-13 (PR #84).** `created_source` on customers, orders, payments and tasks (form, offline, import, rule, conversion, system), shown on the customer page. Not built: showing or filtering it on orders, payments and tasks.
  <details><summary>Full decision</summary>

  **Created by, and how.** Orders, customers, payments and tasks store a source next to the creator (form, quick order, offline sync, import, rule, system, Telegram), shown as one line and usable in filters. F85 stays the sales channel (T5).

  </details>
- **T6. Readable timelines.** Merge one person's edits within 10 minutes; hide cost, margin and credit changes from roles that cannot see them. **First slice built 2026-11-13 (PR #84):** the change history reads names and Persian words instead of ids, and a customer shows its own changes. Not built: merging one person's edits within 10 minutes, hiding cost fields by role.
  <details><summary>Full decision</summary>

  **Readable timelines.** On the merged order timeline and the customer timeline: one person's edits within 10 minutes merge into one entry; cost, margin and credit changes are hidden from roles that cannot see them; position pings and counters are not logged (T6).

  </details>
- **T3. Recycle bin (F111): JSON copy in a trash table (also T18).** First types: reminders, tasks, photos. A link to a deleted item shows who deleted it, with a restore button for managers. **Checked 2026-11-13:** photos already have a 30-day trash with a restore button (`/sales/admin/storage`, decision 12 in `docs/storage.md`) and tasks cannot be deleted (they are cancelled or done), so only reminders are left. Not built: a trash table for reminders; build it when someone loses a reminder.
  <details><summary>Full decision</summary>

  **Recycle bin (F111): a JSON copy in a trash table**, not a `deleted_at` column; first types reminders, tasks and photos, per-company keep-for-N-days in the log-retention setting. A link to a deleted item shows who deleted it and when, with a restore button for managers (T3, T18).

  </details>
- **T24. Rate limiter moved to Postgres.** Short and long windows per person and IP. **Built 2026-11-13 (batch B).** Sign-in, second-step code, step-up code and own-password limits now live in table `rate_limits` (`lib/repo/rateLimitDb.ts`), each with a short and a long window (sign-in by name 5 in 15 minutes and 20 an hour). The in-memory limiter stays for live-update pings. Tests: `tests/rateLimitDb.test.ts`.
  <details><summary>Full decision</summary>

  **Rate limiter move to Postgres.** Give each rule a short and a long window, keyed by person and IP (for example 5 code tries a minute and 20 an hour) (T24).

  </details>
- **D6. Tamper-evident money log.** A hash chain over money events only, with a «check the chain» button for the owner.
  <details><summary>Full decision</summary>

  **Tamper-evident money log (D6, answers F27).** One hash chain per company over money events only (order confirmed, payment, cheque status, journal posted, month closed, leftover closed); the owner has a «check the chain» button. Not every edit.

  </details>
- **D30. Owner-set thresholds.** One settings card for numbers now fixed in code (stalled order days, quiet customer days, ageing days, duplicate order window, snooze days). **Built 2026-11-13 (batch B).** Five numbers are columns on `organizations` (stalled order days, quiet customer days, data ageing and stale days, duplicate-order hours) with the old values as defaults; `lib/thresholds.ts` is the one list, `thresholdsFor` reads it, and the owner's status page card «حدهای هشدار» saves it (reset button; changes show in the change history through an audit trigger). Wired to the action center, the order-entry duplicate warning, the map's quiet list and the data-age banners. Not done: the alert snooze days (no such number exists in code yet).
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
- **E6. Access and settings change log.** A who/when/old/new line for role, group, active state, password resets and company settings. **Built 2026-11-13 (PR #84):** company settings, groups, trainer permission, two-step login on or off, commission rates and storages join the history (never secrets or keys).
  <details><summary>Full decision</summary>

  **Access and settings change log (E6, answers F27 question 1 for permissions).** A who/when/old/new line for role, group, active state and password resets of users, and for company settings (discount auto-pass percent, code for sensitive actions, the D30 thresholds), shown on the owner status page beside the access review card (D3-3). Today `setRoles`, user edits and these settings write no log line.

  </details>
- **E17. Sign out after idle time.** Owner sets idle hours per role; drivers and reps stay signed in so offline work is not lost. **Built 2026-11-13 (batch B).** Owner sets idle hours for owner, group manager, rep manager and shareholder on the status page («خروج خودکار بی‌فعالیت»); drivers and reps are never listed. `users.last_active_at` is touched at most every 5 minutes per process; `resolveSession` signs out when the later of that and the sign-in's start is older than the limit. A Login-As session is not timed. Rules are cached 60 s per company.
  <details><summary>Full decision</summary>

  **Sign out after idle time (E17).** The owner sets idle hours per role (for example 12 for owner, managers and accountant); drivers and reps stay signed in so offline work is not lost. Today a sign-in lives 30 days whether used or not.

  </details>
- **E7. Background exports and bulk edits.** Exports over ~1,000 rows and bulk edits over ~100 run as jobs with progress and a push when ready. **Built 2026-11-13 (PR #102) for the orders export only:** over 1,000 rows it runs on the worker, shows progress, notifies when ready, file kept 24 hours (`export_jobs`). Bulk edits are not moved because the bulk edit itself (T4) is not built. **2026-11-14 (PR #105):** a bulk edit of more than 100 customers runs on the same worker job.
  <details><summary>Full decision</summary>

  **Background exports and bulk edits (E7).** Exports over about 1,000 rows (T21) and bulk edits over about 100 records (T4) run on the job runner with a progress count and a push when ready; the file is kept 24 hours.

  </details>
- **Z2. No double save.** Every money form sends a one-time key; a repeat returns the first result. **Built 2026-11-13 (batch B).** Money forms (receipt, cheque, expense, purchase, receiving) send an `Idempotency-Key` header (`lib/idemKey.ts`); `once()` in `lib/repo/idempotency.ts` wraps those four POST routes, stores the first answer in `idempotency_keys` and returns it for a repeat (409 while the first is running; a failed first try forgets the key). Offline payments keep their own `client_uuid`. No visible screen change, so no tutorial. Keys are purged by FB41.
  <details><summary>Full decision</summary>

  **No double save (Z2).** Every money form (payments, expenses, cheques, transfers, purchases) sends a one-time key; a repeat returns the first result and saves nothing new. One shared helper. Offline sync already does this with `client_uuid`; the online forms and the journal table do not.

  </details>
- **Z11. Owner-only amounts.** The owner marks an expense category private; others see dots and totals still count it.
  **Built (batch B):** table `private_categories`; the owner ticks categories in «دسته‌های خصوصی» on the expenses page. For a group manager the category row, the recent-expense lines and the repeat prefill show dots, the totals and the by-enterer table leave them out, and the journal page hides any journal that touches a private category. Owner-only pages (income statement, trial balance, exports) already hide everything from others.
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
- **S24. «گزارش مشکل برنامه» button.** One line and an optional screenshot with page, role, version, phone and connection attached; a list for the owner. **Built 2026-11-13 (batch B).** «گزارش مشکل برنامه» in the account menu (desk), «حساب من» (phone) and the driver's links: a sheet with a line and an optional screenshot (shrunk, kept in the row); the page, role, app version, phone and connection go along. Table `problem_reports`; the owner's status page card lists open reports with «دیدن تصویر» and «انجام شد». Ten reports an hour per person.

- **EV1. Rules timer on the server.** The rules sweep (callback and follow-up tasks, escalation, push and Telegram flush) runs every 5 minutes from a systemd timer, like the storage sweeps. Today it runs only when someone taps «به‌روزرسانی کارها». **Built (2026-11-12 to 13, ef35fca and earlier; EV1's timer was replaced by the worker).**
  <details><summary>Full decision</summary>

  **Rules timer (EV1, plan `docs/plans/event-architecture-2026-11-12.md` E1).** `deploy/routeflow` writes `routeflow-rules.service` and `.timer` (every 5 minutes, same shape as the storage timers) that run `scripts/run-sweeps.mjs rules`; nothing in the app changes. Check on the server first with `systemctl list-timers`. When the worker (EV3) has schedules, the timer is deleted in the same commit. Decided 2026-11-12 (owner: everything in the review's adopt list).

  </details>
- **EV2. Events always inside the save.** An event is saved in the same transaction as the change it describes, then handled right after commit; a crash in between loses nothing. **Built (2026-11-12 to 13).**
  <details><summary>Full decision</summary>

  **Events inside the save (EV2, plan E2).** `events` gets `handled_at`, `attempts`, `next_try_at`, `last_error`. `emitEvent` only inserts; `drainEvents` runs the rule engine for unhandled rows with `SKIP LOCKED` and marks them, called right after commit so reactions are as fast as today. The CRM writes (`lib/repo/crm/write.ts`, which emit after the transaction) move inside; payments already are. The nightly archive moves only handled events. Money postings stay inside the same save as the order or payment: only notices, push, SMS, Telegram, analytics and exports may be late.

  </details>
- **EV3. Background worker.** Reactions, schedules, retries and exports run in a worker started with the app; a card on «وضعیت سامانه» shows queue length and failures. **Built (2026-11-12 to 13).**
  <details><summary>Full decision</summary>

  **Background worker (EV3, plan E3; decisions 10.22).** Starts inside the app process from `instrumentation.ts` (the release is a standalone bundle, so a separate script cannot import `lib/**`), claims jobs with `SKIP LOCKED`, runs handlers under the system scope. Jobs: event drain, rules sweep every 5 minutes (replaces EV1), notification flush; later exports (E7), SMS, Telegram, statements (F18), and, each with its own entry, route optimization, OCR (F1), photo processing and bank import (F10). **Split into its own process** when the first CPU-heavy job arrives. **Library: pg-boss** (owner, 2026-11-12; 12.38.2, MIT), not a queue of our own.

  </details>
- **EV4. Audit record, first slice of F27.** One append-only record of old and new values for important fields, with who changed them; an owner-only history list on the record and on «وضعیت سامانه». **Built (2026-11-12 to 13).**
  <details><summary>Full decision</summary>

  **Audit record (EV4, plan E4, answers F27).** `audit_log` filled by one generic trigger on a short list of tables (orders, order lines, payments, customers' owner and credit limit, users' role and active, product prices, company settings); changed columns only; actor from `rf.actor`, set beside `rf.scope`; refuses update and delete; cost, margin and credit changes visible only to roles that can see them (T6). Not in this slice: anomaly rules, the money hash chain (D6) and the permission log (E6), which sit on top of it. Does not replace `order_events`, `activities`, F99, F100 or F110.

  </details>
- **EV5. Event list.** `docs/events.md`: each event name, who emits it, who reacts, fact or request; a test fails when an emitted name is missing. **Built (2026-11-12 to 13).**
  <details><summary>Full decision</summary>

  **Event list (EV5, plan E5).** One row per event kind. A small Vitest guard reads every `kind:` passed to `emitEvent`. Requests named like facts (`reassign.requested`) are decided one by one.

  </details>
- **EV-L1. Funnel and speed reports from history.** Leads, attempts, conversations, samples, purchases; days from lead to first order; who calls new leads fastest, from `activities` and `events`. Needs a sample event first. Starts after EV2, with the reporting group.
- **EV-L2. Who may write which table.** A ratchet in `scripts/check-architecture.mjs`: journals and ledger lines only from the ledger files, stock moves only from the stock files, `audit_log` and `events` only from their own modules. Starts at today's count; after EV2.
  **Built (batch B):** metric `foreignTableWrites` in `scripts/check-architecture.mjs` (journals and ledger lines: `lib/repo/ledgerCore.ts`; stock moves: `stock.ts`; `audit_log`: `auditLog.ts`; `events`: `events.ts`). Baseline 2: the delivery undo in `lib/delivery.ts` deletes stock moves, and `leadImportNotify.ts` inserts an event. To fix when those two are moved.
- **EV-L3. Read tables only when slow.** A new summary table only when a screen is measurably slow, refreshed by the worker, like `sales_daily`.

### Mobile, input, offline and help

- **UIB-C. Forms that keep your work.** Drafts survive a closed tab, an unsaved-changes bar, phone keyboard handling, and instant updates with a rollback.
  <details><summary>Full decision</summary>

  **Batch C: forms that keep your work.** Drafts that survive a closed tab, an unsaved-changes bar, keyboard handling on phones, optimistic updates (`useOptimistic`) with a rollback.

  </details>
- **Z10. Remember method and account.** Per person, only payment method and bank account are remembered. Partly built 2026-11-05: the payment and expense method is remembered per phone and offered first; a bank account is not a step in either flow yet.
  <details><summary>Full decision</summary>

  **Remember method and account (Z10).** Per person, only payment method and bank account are remembered; the category always starts empty.

  </details>
- **Z12. Type a sentence and Z15 paste a bank SMS.** A plain rule parser, no AI: «بنزین ۴۵۰ هزار» opens the expense form; a pasted card-to-card SMS opens the payment form.
  <details><summary>Full decision</summary>

  **Type a sentence (Z12) and paste a bank SMS (Z15).** A plain rule parser, no AI, works offline. «بنزین ۴۵۰ هزار» opens the expense form with the amount and a category guessed from words used before. A pasted card-to-card bank SMS opens the payment form with amount, date and tracking number; start with the 3 or 4 biggest banks, fall back to an empty form.

  </details>
- **Z13. Share a photo into the app.** A shared photo opens a new expense with it as the receipt. (Z14 icon shortcuts built 2026-11-05.)
  <details><summary>Full decision</summary>

  **Share a photo into the app (Z13).** `app/manifest.ts` gets a share target; a shared photo opens a new expense with it as the receipt. Expense receipt only for now. **Icon shortcuts (Z14):** long-press the app icon for record payment, new order, record expense, by role.

  </details>

- **AC1 to AC6. Academy with company lessons. Built 2026-11-13 (PR #82).** Not in this slice: the link from an objection card or a product page to a lesson, the push for an overdue lesson, and the lesson-to-tutorial «نشانم بده» button. Lessons shipped with the app (general and app related) plus lessons each company writes in its own categories; reader, editor, required per role, manager table, links to tutorials and product pages. Van roles reach it from a card on `/driver`.
  <details><summary>Full decision</summary>

  **Academy now (owner, 2026-11-12; plan `docs/plans/academy-catalogue-independence-2026-11-12.md`).** Two layers on one screen: «RouteFlow» lessons shipped as files (about 10 in Persian, drafted by the agent, reviewed by the owner: AC5) and «شرکت» lessons stored per company in categories the company creates (AC1, AC2). Editor `/sales/academy/manage` (AC3) for the owner, managers (own group) and any «مربی» (trainer), a permission the owner can give to anyone. Required per role with days after hire, the F133 table includes company lessons, «به‌روز شد» when a lesson changes (AC4). Links with tutorials, objection cards and product pages (AC6). **No new library:** plain text with headings and photos, photos in the company's storage. **Quizzes are the next slice** (AC-L1); the first slice ends a lesson with «خواندم».

  </details>
- **VC1 to VC4. Catalogue for van roles. VC1, VC2, VC3 (show and print) and VC3b built 2026-11-13 (PR #82).** Not in this slice: this shop's price and visibility at a stop (F62, F89; the customer prices are not in the phone's synced data), add to order (a van role has no order screen yet), save as a picture, VC4. The page is `/sales/catalogue` (under the shell so it keeps the bottom bar), cached by the service worker after a visit, not read from the phone's local database. A page for `field_rep` and `delivery_driver`: search, category chips, photo, packings, this shop's price, stock on the van (approximate), add to order, show to the customer, save as picture or PDF. Product information (photos, category, three selling points, a «how to say it» line) is edited by owner and managers. **VC4 first slice built 2026-11-13 (PR #102):** a manager loads goods from the warehouse onto a van («بارگیری وانت» on `/sales/stock`), so the van stock the catalogue shows is real. **Door sale and samples built 2026-11-14:** a van role opens «فروش در محل» (`/sales/door-sale`, a tab on the van bar), picks the shop, and either sells from the van (the ordinary order is created, confirmed, put on today's run, delivered and paid in one transaction; cash, on account, or another amount) or gives a free sample (own `samples` table plus a `SAMPLE_OUT` movement off the van, event `sample.given`). Managers see a sample report (shops sampled, who bought within 30 days, cost) on the stock page. A van delivery no longer debits the warehouse a second time. Not built: selling with no signal (it needs the server's stock check), an order for later from a van role, samples of an unpriced product, FEFO batches on van stock.
  <details><summary>Full decision</summary>

  **Catalogue now (owner, 2026-11-12).** Today `/sales/products` sends van roles to `/driver`, so they have no catalogue, and a product has no photo or description. **Both, in two steps:** step 1 takes orders for later with van stock shown as approximate (VC1 to VC3b); step 2 sells from van stock at the door once van loading (F30) exists, with samples (F52) (VC4). Cost and margin are never sent to van roles. The first version shows or saves the price list; sending it to the shop waits for the message channel (F6, F79). Needs a check that the van screens read the catalogue offline (F75).

  </details>
- **OI1 to OI3. Operational independence. OI2 (a «هفتهٔ اول» lesson) and OI3 (`docs/runbook-index.md`) built 2026-11-13; OI1 built 2026-11-13 (PR #84): the manager table has a column with how many of each person's tutorials they finished.** Manager view of each new hire's tutorials and required lessons (OI1), a first-week checklist per role as an Academy category (OI2), a one-page «if X breaks, read Y» runbook index (OI3). With F59 handover, T13 lend and S23 cover, which keep their own entries. Practice mode (F39) is later.
  <details><summary>Full decision</summary>

  **Owner, 2026-11-12:** plan everything good from the shared «Systematize RouteFlow Operations» chat. Goal: a new person, or someone covering for an absent colleague, can work from the app alone. The pieces and their order are in the plan. F59 needs the audit record (EV4). F39: design not decided, later (a practice order must never message a real customer).

  </details>

- **OI4 to OI11. Operational independence, batch J (owner, 2026-11-14; plan `docs/plans/operational-independence-batch-j-2026-11-14.md`; decisions 10.24). Not built.** OI4 a named backup per person or duty, pre-filling leave and handover. OI5 a coverage view for the owner: five counts side by side (people with no backup, duties only one person has done, approvals only one manager can give, overdue required lessons, skills nobody holds at level 3), no combined score. OI6 skills with four levels, set by a manager; a finished lesson alone never goes above «learning». OI7 routine checklists with an owner and a backup, made from recurring tasks, missed ones shown on OI5. OI8 playbooks for group manager, rep manager, accountant and owner as Academy lessons. OI9 an offboarding checklist joining F59, F140, F107 and F82. OI10 when a company lesson is edited the editor says whether people must re-read. OI11 a sales starter pack the platform owner applies to a company (routines, playbooks, objection cards), editable copy, switchable per company; enforcement is soft (flags, never blocks). **F39 practice mode: one practice company per learner**, no outgoing messages, a visible practice bar, deleted after 30 unused days. Order: OI8 and OI9, then OI4, OI7, OI6, OI5, then OI10 and F39, OI11 after OI7 and OI8. Not building: positions and job-profile tables, RACI, a weighted index, a process engine, an SOP approval workflow.

### Messaging, chat and telephony

- **FB9. Internal chat, phase 1: threads on orders and customers.** *(Built 2026-11-13: a «گفتگو» button on the order page and the customer page, plain text up to 1000 characters, live delivery to everyone who may see the record, unread count; no edit, delete, attachments, mentions, reply or typing dots yet.)* A native chat, no outside server. Phase 1 is a thread on every order and customer. The owner may read any 1:1 or group chat and members see a notice.
  <details><summary>Full decision</summary>

  **Internal chat, first slice: threads on orders and customers.** See the decision below.<br><br>**Internal chat system (decided 2026-10-30).** A native chat, no outside chat server; the existing-solutions search was skipped on the owner's say-so. Phases: (1) a thread on every order and customer, (2) 1:1 and group chats on the same tables (one conversation table with a subject: customer, order, direct or group), (3) photos, search and read receipts. Decided 2026-10-30: the owner may read any 1:1 or group chat, members see a standing notice («مالک می‌تواند این گفتگو را ببیند») and each owner read is logged. Rules to settle when it is designed: a thread is visible only to people who may see the record, and adding someone grants no access to the record; mentions go through the existing notification preferences and quiet hours; online-only at first, saying so on a failed send; live delivery by server-sent events or polling over Postgres, no Redis. The live layer is built (2026-11-09, issue #58, decisions 10.7): chat publishes with `publishLive` (audience = the thread's members at send time, `clientKey` = the message id made on the phone, so a retry is never stored twice) and typing with `publishEphemeral` (skipped for a slow phone).

  </details>

## 2. Waiting for something

Decided, but each needs something first. The "waits for" part is in the line. The full decision is in the archive (`docs/roadmap-archive.md`, sections 1b to 1k).

### Screens, lists and desk speed

- **UIB-E. Desk layouts and dashboards.** Denser desk screens and dashboard patterns. Comes after the phone patterns are done.
- **FB19. Setup checklist details.** Minutes per step, a % bar, steps that tick from real data. Waits for UI batch D (UIB-D).
- **A17. Typed filters on desk screens.** Text such as `بدهی>۱۰۰۰۰۰۰ منطقه:۳` turns into filter chips. Comes with T1.

### Customers and sales (CRM)

- **FB36. Saved smart segments.** A customer filter saved by name, usable by promotions and reminders. Comes with F28 and F21.
- **T12. F122 custom fields rules.** Text, number, choice, date, yes/no; up to ten; archive instead of delete. Waits for F122.
- **T13. F82 / F59 lend a rep's customers. Built 2026-11-13 (PR #84), owner only, on the handover card.** A manager lends customers to a colleague for N days; access ends by itself. Waits for F82 / F59. The «تا کی؟» chips lend all of a person's customers for 3 days to a month; open tasks stay; the rules sweep gives them back the day after the last day, or «برگرداندن» does it early; a customer that changed hands meanwhile stays where it is. Not built: picking single customers, lending tasks.
- **E2. «به شما سپرده شد» notice.** One push when records are handed to you; many at once become one push. Built with S6, T4 and F59. **Handover part built 2026-11-13 (PR #84):** the person who receives a handover or a lend gets one push. Not built: a push for a single customer reassigned by hand.
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

- **U3. Learned open hours (differentiator, 2026-11-04).** Repeated «مغازه تعطیل بود» visits in the same weekday and hour suggest new hours for a shop; one tap accepts; the planner prefers the learned window. Waits for the F57 soft window and about a month of real routes.
  Exists: `working_hours_json` weekday ranges (`lib/crm/hours.ts`), the seeded failure reasons SHOP_CLOSED and CUSTOMER_ABSENT, `actual_arrival` on stops, a per-stop `time_window` in `lib/routing/vroom.ts` that nothing fills yet. Missing: link each visit to its weekday and hour, an evidence rule (for example 3 closed visits in the same slot), the suggestion card, the planner preference. A driver's «closed» tap can be wrong, so hours change only on a person's tap.

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

- **D27. «Arrives on…» date.** Order entry shows «+300 expected Tuesday» beside a shortage. Comes after D17. **Built (2026-11-13):** the order form says «۳۰۰ عدد تا … می‌رسد» under the product picker for a product with an open purchase order.

### Money: credit, payments and cash

- **T23. F50 payment promises wake-up row.** A follow-up closes itself when paid, otherwise wakes on the date; the same row can serve snooze and cooldowns. **Built (batch C):** the rules sweep makes one high-priority call task for the customer's rep (else group managers) on the day a promise falls due and is unpaid, and closes that task by itself once payments since the promise reach its amount. Snooze and cooldowns do not use it yet.
- **D11. Pay by link through an Iranian gateway.** A link per order or balance on the company's own merchant account. Waits for a merchant account.
- **A8. Reminder days around the due date.** Owner sets a day list (−3, 0, +3...); each day a task is made for the rep. First slice of F18; uses D5. **Built (batch C):** on the owner's status page a «یادآوری سررسید پرداخت» card picks days from -7 to +7; the rules sweep makes one call task per unpaid order and day for the order's rep (once each). No message to the customer (that waits for F18/F6/F79).
- **B4. Bank line rules.** A short rule list pre-fills imported bank lines. Waits for the F10 bank import.
- **Z5. Month calendar.** A tab on the money in/out page (A5): Jalali grid with collected, delivered and expenses per day.
- **Z20. Month so far.** A bar for the month gone and a month-end guess, on the A7 tiles and the A5 page. **Built (batch C, A5 page only):** a bar for the share of the running month gone and a month-end guess for money in at the same pace. The A7 tiles do not show it yet.

### Accounting, reports and analytics

- **D26. Month pack for the accountant.** One spreadsheet after a month is closed. **Built (batch C):** a «بستهٔ حسابدار» button on each closed month in the «بستن ماه» card downloads one workbook: trial balance at month end, profit and loss, money in and out, stock at month end (value at today's average cost) and the month's journal. Owner only; refused for an open month.
- **A1. Starting balances.** The setup wizard asks once for cash, bank, debts and stock value and makes one OPENING entry. A step in F126.
- **Z6. Expenses by paste.** Waits for the F10 import to accept an expenses sheet.
- **S11. F123 report questions and subtotals.** Run-time chips (period, rep, group), group by a column with subtotals, one chart. Waits for F123.

### People, approvals and management control

- **S5. SLA working-hours clock.** Owner sets working hours (default Sat–Wed 8–17, Thu 8–13). Part of F51.

### Platform, security and administration

- **UIB-A1. SMS backup for the sensitive-action code.** Send the code by SMS (Farazsms) when someone has no authenticator, with a resend countdown. Needs an account and an approved template.
- **T22. Staff invitation by SMS link.** A 48-hour single-use link to set a password. Waits for Farazsms and the SMS guard.
- **T9. F130 rule builder: draft, test, firing log and budget.** Edit a draft then publish; test on one customer; firing log; daily firing budget per rule. **Built 2026-11-13 (batch B):** the firing log («سابقهٔ اجرا», last 30 firings with what each made) and the daily budget per rule (a «سقف در روز» field in the rule sheet; a rule at its cap makes nothing more that day; day = UTC date, not Tehran). **Not built:** draft and publish, and the test on one customer. Both need rules whose conditions an owner can edit; today the conditions live in code (sweeps) or in seeded rows, so there is nothing to draft or dry-run yet.
- **T10. F126 import wizard steps.** Upload, pick sheet and header row, match columns, fix cells, import with dedupe by mobile. Waits for F126 / F10.
- **D12. Switches per company.** Cheques, batches, leads, commission, van stock can be turned off per company. A step in the setup wizard (F126).
- **S9. F130 rules skip imported records.** Imported records are skipped unless a rule switch says otherwise. Waits for F130. **Built 2026-11-13 (PR #102).**
- **S13. Who-can-do-what page.** Owner, view only, made from the real gates. Comes after T14.
- **S20. Replaced document keeps the old version.** Kept 30 days as «نسخهٔ قبلی». Waits for the documents feature.
- **S25. Document valid-until date.** A task 30 days before and an expired chip. Waits for the documents feature.

### Mobile, input, offline and help

- **E11. F146 home screen defaults.** Owner sets a default per role; each person may hide or reorder cards except pinned ones. Waits for F146.

### Messaging, chat and telephony

- **M1. Send motions for chat and SMS (owner, 2026-11-05).** When a message really leaves the phone: the send button flies off like a paper plane and its label flips to «ارسال شد»; «…» typing dots while the other person writes; the sent text rises out of the box into a bubble; read ticks (sending, sent ✓, delivered ✓✓, read in colour); the mic turns into a send arrow as you type; hold the mic to record a voice note, release to send; drag a message sideways to reply with a quote; «بازگردانی» pulls a just-sent message back into the box. Waits for chat phase 1 (FB9) or the SMS receipt (A16). Clips and choices: `docs/decisions.md` 10.17 and 10.18.
- **FB21. Internal chat phases 2 and 3.** 1:1 and group chats on the same tables, then photos, search and read receipts. Waits for phase 1.
- **FB20. Attempts list with retry on the status page.** Per message: tries, outcome, time and a retry button. Waits for the batch A delivery log. **Built 2026-11-13 (PR #102).**
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

**Built 2026-11-13, batch two (PR #84):** F34 (one Excel file out, edited file in with a «what would change» preview of new, changed and error rows), F140 (asset register card on the users page), F85 (order channel chips and a report on the lead-sources page), F138 (off-site backup line), S6, S23, T13, T5, T6, E2, E6 and OI1 above. Not built: the planner warning for a person on leave, the alert for a stale off-site copy, filtering by created source, the voice clips for the new tutorials (`data-import`, `staff-leave`, `lend-customers`, `assets`, `page-academy-1`, `manage-lessons`, `van-catalogue` need the ElevenLabs key).

**Built from the small-items batch (2026-11-05):** A7 money tiles on the owner home, A10 repeat an expense, A13 receipt footer and order prefix, B3 books behind a document, D31 reopen a cancelled order, D32 sell-off «تصفیه», FB2 undo on the planner, FB5 detail sheets at the bottom, FB29 authenticator nudge, FB34 owner access review, FB38 invoice sent stamp, FB40 stale draft orders, S17 referrals, S19 push before a timed task, T15 weekly chart on calendar days, T17 maintenance banner, UIB-A3 credit approval scope, Z1 keypad sums, Z3 hide money (found already built), Z9 place on money entries, Z14 icon shortcuts, Z18 save and add next, Z19 safe refresh. Partly built, still listed above with what is left: UIB-A2, FB4, Z7, Z10. T11 was not started: no customer list has a group or rep filter yet. The count and plan are in `plans/small-roadmap-items-2026-11-05.md` in the project files.

**Built: live updates (2026-11-09, issue #58, PR #59).** Our own server-sent events on Postgres (decisions 10.7): the notification bell, orders list, order page, schedule, driver page and coverage map update themselves; plus the ten ideas borrowed from other realtime tools, L1 to L10: live record changes checked per record, presence without flicker, droppable notices, latest value on open, newest-only delivery, «X also has this order open», send with a receipt (for chat), the owner's «چه کسی الان وصل است» card on «وضعیت سامانه», read-only display links (for the wallboard F125) and tag filters. Details: decisions 10.7.

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
- **F138 Off-site backup copy:** the integrity check and status file are built (PR #57); the status page has a line for the off-site copy and its age (PR #84). The alert (a push when it goes stale) is missing.
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
| F59 | Salesperson handover | M | yes | F27 | Built (first slice) | T13, E2 |
| F70 | Segment campaigns | M | yes | F8, F9 | Not built | T16 |
| F74 | Rep daily wrap-up | S | yes | F50 | Small, waits for a prerequisite | — |
| F77 | Customer visit frequency targets | S | yes | F20, F28 | Small, waits for a prerequisite | — |
| F85 | Order source tracking | S | yes | F3, F4, F44 | Built (first slice) | T5 |
| F86 | Manager coaching notes | S | yes | F41, F59 | Small, waits for a prerequisite | — |
| F91 | Call and visit quota tracking | S | yes | F41 | Small, waits for a prerequisite | — |
| F98 | Customer note and visit search | S | yes | — | Built (first slice) | — |
| F100 | Customer ownership change history | S | yes | F59 | Built (first slice) | T4 |
| F104 | Customer snapshot on call pickup | S | yes | F8, F46, F47 | Small, waits for a prerequisite | — |
| F122 | Custom fields on customers | M | yes | F98, F148 | First slice built (2026-11-13): five types, up to ten, archive, customer-page card; no list columns, filter, export, per-role hiding or sync yet | T12, E16 |
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
| F56 | Price list versioning and scheduled price changes | M | yes | F21, F48 | Built (batch D) | D14 |
| F58 | Order templates and favourites | S | yes | — | Built (first slice) | — |
| F60 | Call-to-order shortcut | M | yes | F4, F58 | Not built | — |
| F61 | Backorders and partial fulfilment | M | yes | F44, F64 | Partly built | — |
| F62 | Customer-specific product visibility | S | yes | F58 | Built (first slice) | — |
| F64 | Minimum order and delivery fee rules | M | yes | — | Not built | — |
| F65 | Small-quantity price uplift | M | yes | F48, F56, F64 | Not built | — |
| F71 | Customer credit holds by rep | M | yes | F48 | Built (batch D) | — |
| F72 | Duplicate order warning | S | yes | — | Built (first slice) | — |
| F73 | Order edit history | M | yes | F27, F48 | Built (delivery day, due date, address, notes with a reason) | FB3 |
| F76 | Order approval by value | M | yes | F48, F51 | Built (first slice, 2026-11-13): company limit «سقف سفارش بدون تأیید» in the thresholds page (0 = off); a bigger order waits in the credit approvals deck as a «value» request; a signed-in owner's own order passes. No per-role or per-customer limit yet | — |
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
| F6 | Live driver tracking and customer ETA | L |  | — | Built (first slice: live dots) | FB10, FB11, FB12, FB13, FB14, FB15, FB16, FB22, FB25, FB33, FB39 |
| F7 | Dynamic re-routing during the day | L |  | F6 | Not built | FB31 |
| F17 | Delivery proof and dispute handling | M | yes | — | Partly built | FB17, FB22 |
| F24 | Driver pay and incentives | M |  | — | Not built | — |
| F38 | Automatic arrival and departure (geofencing) | S | yes | F6 | Small, waits for a prerequisite | FB15 |
| F45 | Customer feedback loop (delivery rating) | M | yes | F6, F18 | Built (batch D, rep-entered) | — |
| F57 | Delivery time windows | M | yes | F38 | Built, display only (batch D) | FB35 |
| F68 | Rep activity map | M | yes | F6, F38 | Not built | — |
| F69 | Delivery instructions (per customer and per order) | S | yes | F57 | Small, waits for a prerequisite | — |
| F78 | Driver map pin correction | M | yes | F27 | Not built | E3 |
| F79 | Late-delivery notices to customers | M | yes | F6 | Not built | FB11, FB22, FB25, FB28, FB33 |
| F81 | Peak-day capacity warning | M | yes | F25, F57 | Not built | — |
| F97 | Vehicle assignment history | M | yes | — | Not built | — |
| F101 | Bulk delivery notes per run | S | yes | F147 | Built (first slice) | — |
| F103 | Rep mileage log | M | yes | F68, F88 | Built (batch D) | — |
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
| F66 | Supplier order tracking (purchase orders) | L | yes | F11, F31 | Built (first slice, 2026-11-13): orders with status, expected day and lines; made as drafts from the buy list; receive against an order (partial keeps the rest open, «بستن با کسری» closes it); late ones on top; feeds D17, D27 and F31. Not built: a hand-made order form, price difference flag at receipt | F87, F118, F121 |
| F80 | Warehouse returns handling | M | yes | F12 | Not built | B1 |
| F87 | Warehouse receiving appointments | M | yes | F31, F66 | Built (batch D) | — |
| F93 | Warehouse bin locations and stock transfers | M | yes | F1, F30 | Not built | FB31 |
| F94 | Warehouse picking accuracy log | M | yes | F30 | Not built | — |

### Money: credit, payments and cash

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F9 | Churn and credit-risk scoring | M | yes | — | Partly built | — |
| F10 | Bank and payment reconciliation | L |  | F5 | Not built | T10, D21, A3, B4, Z6 |
| F18 | Customer statements and dunning | M |  | F10 | Not built | FB28, A8 |
| F46 | Credit-risk scoring from payment behaviour | M | yes | — | Built (first slice) | — |
| F49 | Cash-flow forecast | M | yes | F46, F50 | Not built | D23, D24 |
| F50 | Payment promise tracker | M | yes | F18, F46 | Built (first slice) | T8, T23 |
| F63 | Deposits and prepayments | M | yes | F46 | Built, first slice (batch D) | — |
| F83 | Payment terms and early-payment discounts | M | yes | F18, F46, F50 | Not built | D5 |

### Accounting, analytics and reporting

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F14 | Natural-language reports ("ask your data") | L |  | — | Not built | FB31 |
| F16 | Owner mobile dashboard with push alerts | S |  | — | Built (first slice) | — |
| F32 | Margin analytics (customer, product, route) | M | yes | — | Not built | — |
| F34 | Data export and backup self-service | S | yes | F27 | Built (first slice) | — |
| F67 | Friday weekly scorecard | S | yes | — | Built (first slice) | — |
| F90 | Monthly staff pay summary for the accountant | M | yes | F25, F27, F88 | Built (batch D) | — |
| F92 | Territory revenue map | M | yes | — | Built in batch H as a hexagon layer (h3-js) | — |
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
| F26 | Field expenses and petty cash | M |  | — | Built (first slice, 2026-11-13): costs are filed as claims on «هزینه‌های من» (all staff, drivers too); the company limit «سقف تأیید هزینه توسط مدیر گروه» (default 500,000 toman) decides who may approve. No cash advance or petty-cash box balance yet. | D15 |
| F27 | Audit trail and anomaly detection | M | yes | — | Planned: first slice is EV4 | T-skip, D6, E6, EV4 |
| F48 | Change approvals (second-person sign-off) | M | yes | F27 | Built (credit limit, order edits, expiry; no price-list kind yet) | — |
| F51 | SLA and escalation rules | M | yes | — | Partly built | FB43, S5 |
| F82 | Approval delegation while away | M | yes | F27, F48 | Built (first slice, 2026-11-13): when a manager is sent on leave, the leave card can name a colleague who then decides that manager's group credit and order-size approvals until the leave ends. Other approval kinds follow when they exist | T13 |
| F88 | Staff expense reimbursement | M | yes | F26, F48 | Built (2026-11-13): approved claim books Dr expense (with the group) / Cr 2107 «بدهی به کارکنان»; the owner pays a person back in one entry from the cash box or bank. Nobody approves their own claim except the owner. | D15 |
| F95 | Staff birthdays and work anniversaries | S | yes | F86, F90 | Small, waits for a prerequisite | — |
| F102 | Manager approval inbox | M | yes | F48, F76, F82, F88 | Built (first slice, 2026-11-13): a fourth button on «امروز» next to credit, discount and duplicates: staff costs waiting for this manager. Orders awaiting review are not in a deck yet. | — |
| F129 | Approval chains | L | yes | F48, F76, F82, F102 | Built, first slice (batch D) | — |
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
| F111 | Recycle bin | M | yes | F27, F34 | Partly built (photos) | T3 |
| F125 | Wallboard display | M | yes | F108 | Not built | — |
| F126 | Organisation setup wizard | L | yes | F109, F127 | Not built | FB30, T10, D12, A1 |
| F127 | Tenant usage and plan limits | M | yes | F108, F126 | Not built | FB30 |
| F128 | Read-only auditor role | L | yes | F107, F110 | Not built | D26 |
| F138 | Off-site backup copy | S | yes | F34, F108 | Partly built | — |
| F140 | Company asset register | S | yes | F59, F107 | Built (first slice) | D11, D10-D25-D28 |

### Mobile experience, input, offline and help

| ID | Feature | Size | Existing code noted | Needs / relates to | Status | Also in |
|---|---|---|---|---|---|---|
| F1 | Camera capture (read a document instead of typing it) | L |  | — | Not built | D19 |
| F2 | Voice input (speak instead of typing a note) | S |  | — | Small, waits for a prerequisite | — |
| F5 | Persian text proofing (help users type clean Persian) | S | yes | F1, F3 | Small, waits for a prerequisite | — |
| F13 | Offline-first everywhere | L | yes | — | Partly built | — |
| F39 | Training and onboarding mode | M | yes | OI6 | Planned in batch J: one practice company per learner (decisions 10.24) | — |
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
| History and audit | F27, F73, F99, F100, F110, F111, F78 | a common change record instead of a table per feature (EV4 `audit_log`, with events saved inside the save, EV2) |
| Purchasing side | F66, F87, F118, F121, F11, F31 | purchase orders first; appointments, pickup, pre-orders and forecasts hang off them |
| Returns and quality | F12, F42, F80, F119, F144, F17 | reasons, receiving, pickup and analytics share the same data |
| Proof of delivery | F17, F120, F139, F69 | one proof model: receiver, photo, signature, code, waybill |
| Position data | F6, F38, F68, F103 | one policy on collecting, keeping and showing staff positions |
| Credit and collections | F9, F46, F50, F18, F83, F63, F71, F49, F10 | terms and promises feed risk, statements and the cash-flow forecast |
| Customer signals | F8, F9, F28, F47, F70, F104, F77 | the same few measures (due, at risk, tier) in the list, the card and the campaign |
| Order entry shortcuts | F58, F60, F62, F72, F114, F131, F44 | usual basket, templates, warnings and desk entry on one order path |
| Pricing | F56, F65, F21, F64, F89, F83 | dated prices, uplift, promotions, minimums and discounts must agree on one price rule |
| Reporting | F14, F123, F144, F32, F134, F92, F67, F16 | one safe query layer and one set of scoped reads |
| Offline | F13, F75, F105 | one outbox and conflict policy (the server side is EV2 and EV3) |
| Telegram | F124, F143, F109, F106 | one worker (EV3), one identity binding, one permission check |
| Staff pay and expenses | F24, F25, F26, F88, F90, F19 | commission, attendance and reimbursements meet in the monthly summary |
| Help and content | F84, F112, F133, F39 | one content store for help, release notes and training |
| Sessions and access | F106, F107, F110, F128, F109 | sign-in security as one design |
| Backup and recovery | F34, F138, F108, F111 | backup, copy, status and restore as one chain |

### 6.3 Suggested order of waves

A suggestion in waves. Within a wave the order is flexible; across waves it follows the dependencies above.

**Wave P — platform.** The move to PostgreSQL and the platform choices in [docs/decisions.md section 10](decisions.md#10-platform-facts-and-decisions-not-features) come first, because every later entry is written against the new database. They are not F-entries.

**Wave 0 — quick wins.** The 22 quick wins (listed under Done). They add visible value, touch little, and several (F99, F100, F110, F108, F138) are groundwork for later waves.

**Wave 1 — foundations.** First slices of F27 (audit record, EV4, built together with events inside the save EV2 and the worker EV3, plan `docs/plans/event-architecture-2026-11-12.md`), F48 (one approval type), F107 → F106 (sessions, then two-step login), F66 (purchase orders, once the ordering practice is confirmed) and the single decision on the customer message channel (F6/F79). The SMS provider is decided (Farazsms); consent, opt-out and any other channel are still open.

**Order set by the owner on 2026-11-01:** street loop first, then the book fixes (replace Holoo), then office depth, then no-code flexibility (see "Owner direction" in the ground facts). The waves below stay as the dependency map.

**Wave 2 — money and orders.** F83 (payment terms) → F50 (promises) → F18 (statements) → F46 (risk) → F49 (cash-flow forecast); F58 → F60/F62/F131 (order shortcuts); F44 (standing orders); F56/F64/F65 (pricing) together; F61 (backorders) and F71/F76 (holds and approval by value).

**Wave 3 — delivery and stock.** F57 (time windows), F69 (instructions), F17 → F120 (proof and codes), F80 → F119 (returns), F30 → F94 and F93 (loading and bins), F66 → F87/F118/F121, F81 (capacity warning).

**Batch J (2026-11-14):** OI8 and OI9 → OI4 → OI7 → OI6 → OI5 → OI10, F39, OI11 (see the OI4 to OI11 entry).

**Wave 2b — people and content (2026-11-12).** S23 and OI3 (no prerequisite); AC1 → AC2 → AC5 → AC3 → AC4 (Academy); VC1 → VC2 → VC3 (van catalogue); after EV4: F59 → T13; OI1 and OI2 after AC4; later AC-L1, VC4 (with F30) and F39.

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
- F75: whether the sales screens read the catalogue offline (VC2 needs the answer).
- AC1: that `lesson_progress` can carry the lesson kind and version without a data move; AC3: that a «مربی» flag fits the role checks without a new role. VC1: that product photos can serve small thumbnails.
- F97: whether run planning fills the vehicle on each run (a code comment says it does not; the column exists).
- F102: whether orders awaiting review appear in a decision deck.
- F113: gestures need testing on real phones; not possible in the build container.
- F132: what feeds the urgent driver commission rate, and whether anything sets the priority value.
- F147 (document templates): how far the existing print code goes.
- Whether any screen closes a fiscal period.
- EV1: whether push and Telegram really go unsent on the live server today (read from the installer; check `systemctl list-timers`). EV3: pg-boss without self-migration, `send` inside our own transaction, and the `routeflow_app` role.

Platform claims in [docs/decisions.md section 10](decisions.md#10-platform-facts-and-decisions-not-features), all unverified:

- Nothing has been tested from Iran: the outside services in 10.5, package registries, Firebase push, map tiles.
- Package versions and dates come from the npm registry; no package was installed or run.
- The official `farazsms` client was found on npm but not inspected.
- ~~Whether Centrifugo can read events from a Postgres outbox table~~: answered 2026-11-09, yes since v5.2, and v6 clusters on Postgres alone (see decisions 10.7).
- Whether the Postgres extension `pg_duckdb` fits, and DuckDB's npm "latest" tag being a development build.
- ~~Whether MapLibre needs the right-to-left text plugin~~: answered 2026-10-28, MapLibre 6 shapes Persian itself and labels render in Peyda (see 10.1, map tiles).
- Whether Google Play and Cafe Bazaar or Myket rules allow updating web code inside the Android app.


**F48 built (batch B, first slice).** Table `change_requests`. One kind so far: raising or removing a customer's credit limit. «سقف اعتبار» on the customer page (`PUT /api/customers/[id]/credit-limit`): an owner, or any lowering, applies at once; a group manager's raise waits as a request with a reason. The owner decides on the discounts admin page («درخواست‌های سقف اعتبار», `POST /api/change-requests/[id]/decide`, authenticator code asked, cannot approve one's own request). Not yet: price edits, other kinds, expiry of old requests, a push to the owner, an audit line for the request itself.

**F73 + FB3 built (batch B, first slice).** `lib/orderEditRules.ts` is the one rule for what may change at each stage (lines on a draft only; the priority flag until the order is finished), used by `addLine`, the priority repo and the order page. A priority change writes an `edit` event in `order_events` with «اولویت: عادی ← فوری» and the actor, which shows on the order timeline (journey page). Not yet: a required reason after confirmation, history for dates, address and notes (no screen edits them), and the offline-sync copy of the rule.

**A3 built (batch B).** Tables `reconciliations` and `reconciled_entries`. «مطابقت صندوق و بانک» on the journal page (owner): pick the cash box, bank or petty cash, type the counted balance, tick open lines until the gap is zero, save. Saving checks the sum again on the server, ticked lines leave the list and cannot be ticked twice (a mistake is fixed by a reversal journal). Shortcut: all open lines up to the last 500, no date filter yet; no bank file import (F10).

**D2 built (batch B, first slice).** Table `deposit_slips` and `cheques.deposit_slip_id`. «ثبت به‌عنوان واریز» on the cheques board now deposits the ticked cheques together under one numbered slip (`POST /api/cheques/deposit`, number counts up per company) and opens the slip page `/sales/cheques/slips/[id]` with count, total and the list, to print or save as PDF. A bounce still voids the payment and reopens the debt (already built). Not yet: several bank accounts (the books have one bank account, 1102).

**D1 built (batch B, first slice).** Table `cash_handovers`. «پول در دست» on the payments page (owner): per rep, driver and phone-sales person, the cash they collected since the office last counted them. «شمارش» saves the counted amount; a different amount needs a reason. Not yet: the ledger still books a cash receipt straight into the office cash account (1101), so a gap is recorded but not posted; cheques in hand are not in the box; no action-centre line for a gap.

**D1 finished (2026-11-13).** The books now follow the box. Cash taken by a rep, driver or phone-sales person is booked Dr 1104 «پول در دست کارکنان» (`payments.in_hand = 1`), not 1101. «شمارش» posts one `HANDOVER` journal in the same save: Dr 1101 (counted), Dr 5111 «کسری و اضافهٔ صندوق» for a shortage (Cr 5111 for an overage), Cr 1104 (expected). Voiding a receipt before the count credits 1104, after the count 1101. A short count shows on the owner's action centre for a week. Receipts before this change stay in 1101 (all data is dummy, no catch-up). Not yet: cheques in hand are not in the box; a transfer form from a box to the bank (A4).

**B1 built (batch B, first slice; F12 reason codes only).** «برگشت از فروش» on the customer panel (managers): an amount up to what the customer owes and a reason (damaged, expired, wrong item, refused, other). It is a `CREDIT_NOTE` payment: it settles the oldest unpaid orders, posts Dr 4102 sales returns / Cr receivables, is not counted as money collected, and a void reverses it (`POST /api/payments/credit-note`). Not yet: paying the credit back in cash, a supplier credit note, stock movement and disposition (F80: restock, quarantine, write-off), recall tracing by batch (F12), a limit for managers.

**F130 built (batch B, first slice: the list, not the builder).** «قانون‌ها» at `/sales/admin/rules` (owner, under «تنظیمات سازمان»): every rule of the company including the switched-off ones, with its kind (task, alert, notice), trigger (event or periodic check), waiting time and firings in the last 14 days. The owner can switch a rule on or off and change its waiting time. `PATCH /api/rules` is now owner-only (it was open to group managers, who have no screen for it) and checks the waiting time (1 to 43200 minutes). Not yet: creating or editing conditions (react-querybuilder, decided 2026-10-23), draft and publish, dry run, a daily firing budget with auto-pause.
