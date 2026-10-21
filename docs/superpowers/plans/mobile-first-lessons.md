# Mobile-first lessons (running notes)

Raw material for `docs/mobile-first-principles.md` (Phase 10 of
`2026-10-20-mobile-first-interaction-patterns.md`). Append 3–5 bullets at the end of every phase:
what worked, what surprised us, what the next page should copy.

## Baseline (2026-10-20, `npm run audit:mobile`)

| Rule | Count |
|---|---|
| `<select>` | 47 |
| native `type="date"` | 1 |
| `<input>` / `<textarea>` | 104 |
| tiny tap targets (`py-[2px]`, `py-0.5`) | 36 |
| `confirm()` / `alert()` / `prompt()` | 9 |

Worst files: admin users (4 selects, 9 fields), CommissionEditor (5/5), PaymentsPanel (4/5), CatalogueEditor, OrderForm, ComplaintsPanel, CoverageMap.

## TapFlow Phase 0 (generic layer)

- The engine's `FlowSet` is a closed CRM vocabulary; non-CRM flows carry their answers in `state.values` via `FlowOption.put`, and build their request body in a pure, tested `toPayload(ctx, state)`. No new server endpoints are needed.
- `amount` steps are **prefilled from `ctx.vars[input.field]` and stored under the same key** (the step id if there is no `input`). The first draft of the delivery flow used two different keys; the contract is now stated in the plan.
- `tests/button-a11y.test.ts` fails any `<button>` without an `<Icon>`: every new chip/row needs one, which is a feature (the icon rule) but easy to forget.
- Component rendering can be tested without a DOM: `renderToStaticMarkup` (see `tests/tapflow-steps.test.ts`) is enough to prove a kind dispatches and nothing renders twice.
- Environment: `tsc --noEmit` has **56 pre-existing errors** (Next typegen names `RouteContext`/`LayoutProps`/`PageProps` are missing without `.next/types`); compare against a saved baseline rather than expecting zero. `tests/playwrightExtract.test.ts` fails on a clean checkout (no browser). `tests/sync-pull.test.ts` can fail under full-suite load but passes alone.

## TapFlow Phase 1 (delivery at the door)

- Durability beats elegance for a record of something that already happened: the delivery is put in the device queue the moment the last answer is tapped, the *send* is what waits out the 5 s undo window, and undo removes the queue entry. The generic hook alone (hold the whole write) would have lost a delivery if the app were killed inside the window.
- The cash question must show the **delivered** total, not the ordered one. The config stays pure; the host renders with `withTotals(ctx, state)` and keeps the original ctx for start/undo.
- A "could not confirm" failure is not the same as a refusal: 4xx drops the queue entry and says what to fix; network/5xx keeps it and says it is saved on the phone. Two distinct sentences, both Persian, both pass `friendlyError` unchanged.
- Extracting `buildReceipt` and `sendDelivery` out of the 376-line component made the flow, the retry-on-reconnect and the "show receipt" button share one implementation.
- Not verified in a real browser: `seed:demo` needs network access this environment does not have, so the sheet is covered by config tests plus a server-render test (`tests/delivery-flow-render.test.ts`). A manual 375 px pass with a seeded driver is still owed before calling Phase 1 done on a device.
- Closing the sheet mid-flow currently discards answers (rule 15, "closing saves a draft", is not implemented in `useFlowHost`). Acceptable at ≤ 5 taps; revisit if drivers close it by accident.

## TapFlow Phase 2 (payments and cheques)

- One step serves two paths: the `amount` step is shared by cash and cheque (the cheque path just asks for it last), so there is one amount UI, one `values.amount`, one prefill.
- A screen can fix facts the flow would otherwise ask: `ctx.vars.customer_id` skips "who", `ctx.vars.method = "CHEQUE"` skips "how was it paid". Both are `start`/`next` functions in the config, not host branching, so the budget test covers them (cheques board with a known customer: exactly 4 taps).
- The amount is prefilled with what the customer owes by reading `/api/customers/:id/statement` once the customer is known, and it only *prefills*; if the read fails the person types it, as before. The prefill is passed through a derived render-only ctx (`viewCtx`), the same trick as `withTotals` in the delivery flow.
- Cheque due dates are weeks away, so `DateStep` offers offsets («یک ماه دیگر») as answers (one tap, submits) with the calendar as the fallback. `lib/flows/dates.ts` is the pure part; Phase C's `DayChips` will generalise it.
- The desk form stays from `md:` up (`hidden md:flex`), so backdating a receipt and typing a note are still possible on a desk. The mobile audit counts source, not rendered output, so these hidden forms still count in the ratchet; they will need allowlist entries (with reasons) in Phase 10.
- Not done, on purpose: (a) **`CustomerDetailPanel` «ثبت دریافت» button** — the panel has no role prop, and `/api/payments` is manager/phone-sales only; adding the button needs a role check first. (b) **Offline payments** — `lib/offline/net.ts` knows `payment.record` but no component uses `postJSON`/the outbox, so the flow is online-only and says so in its failure message; wiring the outbox is its own task. (c) a **`reference`/note-less cash path** records `note: null`; the desk form keeps the note field.
- Naming trap: `FlowContext.recentCustomers` is currently used for "all selectable customers"; Phase C's recents ranking should either rename it or add a separate field.

## TapFlow Phase 3 (complaints)

- Labels shared, not copied: `CATEGORY_LABEL` / `SEVERITY_LABEL` are `Record<ServerUnion, string>`, so a category added on the server is a compile error until it has a Persian word, and the desk panel imports the same maps. (The panel widens them to `Record<string,string>` because its rows come from JSON.)
- `tests/no-raw-enum-copy.test.ts` rejects `map[x] ?? x` anywhere in `lib/`; a flow's done-screen chips must fall back to «نامشخص», never the raw code. It caught this the first time; payment.ts had the same pattern and was fixed too.
- A `pick` step can now carry extra options that name no one («کالا مشخص نیست»), so "I don't know" is an answer and not a reason to abandon the flow. Passing the product id only when one was picked keeps the server from guessing a batch.
- The same flow serves two entries: from the complaints page it asks who first; from an order it already knows customer, order and the order's own products, and `order_id` travels with the complaint (the server uses order + product to find the batch and spot clusters). The button only appears for the roles `POST /api/sales/complaints` accepts, instead of offering a button that would be refused.
- No photo step: the complaints table has no column for one. If a photo is wanted, that is a schema change first (see `docs/future-features.md` F1 for the camera work).
- Tap counts: from an order 4 taps (product, kind, severity, ثبت), from the complaints page 5 (customer first); the note is optional and typing is never required to finish.

## TapFlow Phase 4 (task outcomes, reminders and notes)

- Read before building: **a task about a customer already had its tap flow** (`TaskRow` opens `AfterCallFlow` when `customerId` is set). The small pills were only the path for tasks with no customer and for the board's "drop into done". The plan's two-step outcome-then-when flow would have had nowhere to write the second answer (`PATCH /api/tasks/:id` takes only an outcome code and note), so `outcomeFlow` is one question, one tap, and says so in its budget (1/1).
- The old pills' codes were kept (CONTACTED, ORDERED, PRICE_OBJECTION, NOT_INTERESTED) because the server's objection cards and reports are keyed by them; only the words changed, to what a person would say («سفارش داد», «قیمت را زیاد دانست»). `OutcomeChips` had no other users and was deleted.
- **A latent bug fell out**: the board asked for an outcome only inside the *desktop* branch of `Board`, so on the phone pager a drop into «done» set `outcomeFor` and nothing ever showed. The sheet is rendered once at the top of the board and works in both layouts.
- "Delete this task" used a two-tap confirm («حذف همیشگی»). It now hides the row at once, sends after the 5 s window, and «بازگردانی ثبت» is a local un-hide: undo instead of "are you sure?" (rule 20), and one less tap.
- A reminder is mostly one of five things, so they are answers («تماس بگیرم»…): day, then tap = 2 taps and no keyboard. A note has no date and goes straight to the words. A district's reminder posts to `/api/reminders` with different field names; a customer's or the Pocket's is a task. The mapping is one tested function.
- Phones get the flow, desks keep the inline form: `useIsNarrow` (previously private to `Board`) moved to `lib/useIsNarrow.ts` so Pocket, AddReminder and Board share one meaning of "phone". Caveat: it is false on first paint, so a phone briefly renders the desk affordance before the first effect.
- Ratchet: tiny tap targets 36 → 32 (the baseline was re-written downward).
- Not done: the board's drag-to-done on a phone still only works through `BoardMobile`'s own move control; making that control a full-height bottom action is Phase E (swipe rows).

## Correction (Phase 5 start)

- I added `lib/search/normalize.ts` in Phase 0 after grepping for "normaliz". The repo already had a fuller normaliser, `normalisePersian` / `matchesQuery` in `lib/persian.ts`, spelled the British way. Removed the duplicate; `PickStep` uses `matchesQuery`. **Lesson: grep for both spellings before adding a helper.**

## TapFlow Phase 5 (orders)

- **Repeat order (5.1).** Needs no server change: the last order is `GET /api/sales/orders?customer=ID` (newest first; the first that is not a draft, cancelled or returned) plus `GET /api/sales/orders/:id` for its lines. Lines are re-priced from *today's* catalogue; a line whose packaging has gone or has no price is counted and the recap says «N قلم دیگر قابل سفارش نیست» rather than quietly sending a shorter order.
- The common path is 3 taps (همان سفارش قبلی → in the first opportunity → ثبت سفارش) and the order is created as a **DRAFT**, exactly like the full form; the confirm question says so, and the done screen offers «باز کردن سفارش» (the new id is only known after the held write is sent, so that button flushes first).
- Quantities may go **up** as well as down: `FlowItem.max` (the delivery flow's cap of "what was ordered" was wrong for an order). The credit limit warns and records `credit_override`, never blocks, matching the form.
- The "loading the last order" state is an explicit step option, not an empty list: while `vars.last = "loading"` the only option is «در حال بارگذاری…», so the person can never save from stale data. In practice the fetch is done before the first tap.
- Host trap found by the linter: deriving `picked` from the flow's own state in an effect is a render loop in disguise (the flow's ctx depends on what was picked). Adjusting state *during render* is the sanctioned pattern.
- **Status actions (5.2).** The server treats the reason code as optional, so «دلیل مشخص نیست» is an honest answer, not a loophole. Only cancel, return and failed delivery ask why (from `/api/sales/reason-codes?domain=…`); every other action is one tap with the 5 s undo, via a new `useUndoableAction` hook.
- `ConfirmOrderButton` lost its "are you sure?" second tap (a slip was the expensive case; the undo now covers it and costs nothing when the tap was right). The button text says it cannot be edited afterwards and that there are 5 seconds to change your mind.
- `ACTION_LABEL` moved out of the panel into `lib/flows/orderAction.ts`, with a test that every action the state machine can fire has a label.
- Not done: the **order list's per-card advance buttons** (OrderPipeline/BoardMobile) still call the transition API directly; they are Phase E swipe-row candidates. `OrderForm` itself keeps its selects (it is the full form).

## TapFlow Phase 6 (stock)

- **The plan's receive flow was wrong, and reading the code caught it.** It said "save to `/api/sales/batches`". A batch row alone puts nothing on the ledger; stock arrives only through a *purchase* (`/api/sales/purchases`, which also moves the average cost and is owner-only). So "receiving goods" is a one-line purchase: product, quantity, price (prefilled with the current average cost, one tap), supplier (recent suppliers as answers), expiry (shelf-life shortcuts, or «تاریخ انقضا ندارد»). It asks for the price because the books need it. The invoice form with its line table stays for a whole supplier invoice.
- **A shelf count must compare with that shelf, not the company.** `on_hand` on the stock page sums every facility including vans, so counting the warehouse against it would manufacture a "shortage" equal to whatever is on the road. Added `onHandByProduct(org, facilityId)` (tested against a van) and the count compares with the default facility's own balance.
- Everything in the ledger is a signed delta, and the *reason* chooses the kind, so reports can tell breakage from expiry from samples from plain loss: damaged/expired → `WRITE_OFF`, samples → `SAMPLE_OUT`, unexplained loss or a corrected count → `COUNT`, an unrecorded purchase found → `ADJUSTMENT`. «درست است» writes nothing at all (the API refuses a zero movement anyway).
- A count loop can't use the 5 s auto-return: 50 products × 5 s is a bad afternoon. The sheet advances at once, each difference gets its own undo toast, and undo cancels that write and returns to that product. Writes are independent held saves (one per product).
- The amount step grew up for this: decimals (a count in kilograms), a unit label per item (`<field>_unit` in `ctx.vars`), and zero as a legitimate answer (an empty shelf). Counts and quantities are not money, so «تومان» was wrong under them.
- Not done: **batch-level counts** (a write-off for expiry would ideally hit the expired batch; the movement is unbatched), and **counting vans** (`onHandByProduct` already supports any facility; only the warehouse is wired). `PurchaseEntry` keeps its selects/inputs (desk invoice form).
- The React compiler lint rejects a `useMemo` whose closure is also referenced by an earlier option object; deriving the render-only ctx as a plain `const` after the state is simpler and correct.
