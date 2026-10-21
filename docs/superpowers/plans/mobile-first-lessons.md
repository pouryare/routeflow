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

## TapFlow Phase 7 (customer lifecycle, visit plan, new place)

- **Options that are data, not copy.** The lifecycle sheet's answers ARE `LIFECYCLE_TRANSITIONS[from]`; a test checks that for every state the sheet offers exactly the table's moves and that every label is the shared lifecycle word. A move added to the table appears in the sheet; a move the server would refuse can never be offered. What the flow adds is a sentence per move and one extra question before the two that end a relationship (lost, blocked), with the gentler «فقط غیرفعال شود» when the table allows it (rule 7). No reason is asked: the server stores only the new state, and asking something that is thrown away is worse than not asking.
- The customer panel's `<select>` is gone (`select` 47 → 46); the pill still updates at once (`onPending`) and goes back if the move is undone or refused.
- **A render test caught a real crash.** Two hosts built the done-screen chips on *every* render, before anything was answered, and the chip builders assumed a finished state (`st.values.who.startsWith`, `st.values.name.trim()`): the planner and sites pages would have thrown on open. Rule for hosts: **build `done` only when `state.saved`** (the other hosts' chip functions happened to tolerate missing values; do not rely on that).
- Visit plan: the day the planner is showing is the recommended answer, so adding to it is 2 taps and no keyboard. Customers and saved lead locations travel in one list with non-colliding ids (a lead is the negative of its id) and come back as "c5"/"l9".
- New place: reuses the CRM `PinStep` (GPS «اینجا هستم» or a dropped pin) as the last answer, so the position confirmation is the save. The marker shape is the kind's default; the desk form still lets someone pick another. The kind's label for a home is «خانه / مبدأ» (a home is also where routes start), which differs from the shared kind name.
- Phone-only entry points (`md:hidden`) sit above the unchanged desk forms (`hidden … md:flex`), the same pattern as payments and complaints. The audit counts source, so hidden desk forms still count; Phase 10 allowlist.
- This completes TapFlow Phases 1–7. Remaining TapFlow work: Phase 9 (expenses) and Phase 8's layout pass; then the interaction-patterns plan (Phases A–I, with the Phase B detection fix) and the design-rules document.

## Merge with `main` (before Phase B)

- `main` had moved 82 commits (an audit pass). Things that mattered: **TapFlow now renders through a portal** (`useSheetHost`), so a server render of a sheet is empty; tests that assert a sheet's content import `tests/helpers/sheetHost.ts` first. **`npm run typecheck`** (`next typegen && tsc --noEmit`) is the real type check: the 56 "baseline errors" I had been diffing against were just the missing generated route types. And main's audit had made **cancel/return/credit-reject ask first** (`confirmAction`); the tap-flow sheet is that ask now, and `tests/destructive-confirm.test.ts` guards the new form.
- `CLAUDE.md` changed: work is batched (one PR, merge once CI is green, with a merge commit) and a to-do report (`TODO-REPORT.md`) is updated at the end of every reply.

## Phase B (phone shell)

- **The bar is derived, not authored.** `bottomTabs(session)` is built from the same `appTabs` the header pill uses; a test checks, for every role, that nothing the role can open becomes unreachable on a phone (every destination is in the bar or in «بیشتر», never both) and that the bar only names hrefs the role can open. A renamed route fails a test instead of silently dropping out of the bar.
- **Layout is CSS, behaviour is JS.** The detection flash came from choosing a layout in JS on a server that cannot know the device. The board now has both layouts in the markup and a media query picks one; `useIsNarrow` (now an external-store read of the same query) is for behaviour only. Same query string in the hook and the stylesheet, held by a test.
- **A fixed bar covers things.** The sticky total bar in the order form, the map's bottom overlays (the map measured itself against the viewport), and the sync badge all lived at the bottom edge. Fixed: order form bar offset by the bar's height; the map subtracts the bar's *measured* height (it grows by the home-indicator inset on some phones); the sync badge moves up and to the other side so it does not sit on the «+ ثبت» button. Any new bottom-anchored element must clear `.bottomnav` below 768px.
- **One flow per task.** The «+ ثبت» sheet does not carry copies of the payment, complaint and order flows: it links to the page with `?new=1` / `?quick=1` and the page opens its own flow (`lib/flows/autoOpen.ts`). Reminder and note need no page, so they open in place. Each action only appears for a role that can open its page and whose API accepts the write (a rep manager can read orders but not sell).
- The vocabulary test (`tests/vocabulary.test.ts`) enforces one word per thing: «سفارش تازه», never «سفارش جدید».
- Drivers: `/driver` is a bare single-screen page with no bar (its header links to its own destinations). The bar appears for vans only on the shell pages they can reach (academy): two items, no «بیشتر», no «+ ثبت». Decision: the driver page stays single-screen.
- `StickyAction` exists and is tested but no page uses it yet: the order form already had its own sticky total/submit bar, which now sits above the bar. First adopters: planner confirm, count-sheet.
- Not verified on a device: bar overlap with browser chrome, the safe-area values on a real notch phone, and the swipe-to-dismiss of the sheets inside the bar.

## Phase C (inputs)

- **Pure model first, component second.** `lib/keypad.ts`, `lib/recents.ts` and `lib/dayChoices.ts` are plain functions with tests; the components only render them. That made the keypad display bug ("2.0" collapsing to "2" mid-entry) a one-line, unit-tested fix (`display`).
- **The audit counts text, not intent.** The mobile audit regex matches `<input` anywhere, comments included; reword prose instead of fighting the ratchet.
- **React-compiler purity.** `Date.now()` inside a component body (even in a handler) is flagged; read the clock through a module-level helper.
- **Own keypad changes test contracts.** Tests that looked for `value="800000"` on a text field now assert the readout and the key grid, and that no OS-keyboard field exists.
- **Labels still can't be bare verbs.** «تأیید» alone fails the bare-verb test; «تأیید عدد».
- `vitest` includes only `tests/**/*.test.ts`; write component tests with `createElement`, not JSX.
- **Adoption keeps old data shapes.** The order form's delivery day stays `requestedMode`/`requestedDate`; chips only set them (picking a day = exact date, the «بدون تعهد» chip = soonest). No API change was needed.
- Replacing a state-heavy search (query + matches) with `SmartPicker` deleted more code than it added; look for dead state and unused imports after each swap.

## Phase 9 (expense entry)

- **The plan promised fields the server doesn't have.** «supplier» and «photo» have no column on an expense. Supplier became the journal memo; photo is parked. Check the write path's columns before planning a step for them.
- **Lists the engine didn't have a slot for.** Categories and suppliers are two different lists, so `FlowContext` got an optional `lists` record instead of overloading `items`/`products`.
- **Method is required by the API but was missing from the plan.** The flow asks it last (it is also the save tap) and offers only the three methods that map to a cash or bank account.
- **Zero amounts are blocked by the amount step, not the machine**; test the step's `allowZero`, not a thrown error.
- Render tests of hosts that call `useRouter` need `vi.mock("next/navigation")`.

## Phase D (filters)

- **Only some dropdowns are filters.** The plan listed complaints, cheques and the order pipeline, but their dropdowns change one row's status; there is no list filter to convert. Those belong to the swipe-row phase. Read the control's job before swapping it.
- **Filters apply live.** The sheet's «نمایش نتایج» only closes; the list updates as chips are tapped. A draft-then-apply model would need every host to hold two copies of its filter state.
- **A period is a shortcut for the two date fields, not a new filter.** The chip writes from/to; editing a date clears the chip. The page's filtering code did not change.
- **Persian months, tested at a year boundary** (last month from early Farvardin is Esfand of the year before).
- A group's "no filter" value can be non-empty (`neutral: "hide"` for the voided filter), so the active badge and the clear button ask the group, not `""`.

## Phase E (swipe rows, decision decks)

- **A gesture is a shortcut, never the only way.** `SwipeRow` keeps each action as a real button (hidden but focusable on phones, visible from 768px); rows that already had their own buttons pass `ownButtons={false}` so nothing is duplicated.
- **Portals bubble.** A sheet opened from inside a swipe row sends its pointer events up React's tree to the row, so a drag in the sheet would move the row. Flows are rendered outside the swipe face.
- **Swipe is easy to do by accident, so it ends in undo, not a question.** Each swipe goes through `useUndoableAction` (5 s, one held write at a time, a new one sends the previous).
- **Decks take a snapshot.** The board refreshes as verdicts land; the deck keeps the list it opened with so cards do not shuffle.
- **The plan's "first queue" was not buildable as written.** Credit approvals have no screen and the list endpoint returns ids only; check the data a card needs before promising it.
- The bare-verb test also applies to swipe labels («حذف» alone fails; «حذف این کار»).

## Phase F (map select)

- **The run already was the selection.** The leads page keeps a run (ordered list of places) and the map already numbered its pins; selection mode only changes what a pin tap does and adds bulk tools. No second selection state to keep in sync.
- **The tray is below the map, not over it.** An overlay would cover the geolocate/zoom controls; a row under the map cannot.
- **Bulk add returns how many were new**, so the tray can say «همه‌شان از قبل در مسیر بودند» instead of silently doing nothing.
- **Fixed steps beat a drag for the radius** on a phone: four 44 px chips are quicker and more accurate than dragging a circle edge with a thumb.
- Leaflet components are not render-tested here (they need a browser); the geometry lives in `lib/mapSelect.ts` so it is.

## Phase G (auto-triggers, action cards)

- **Put the trigger where the data is.** The geofence prompt lives on the coverage map, which does not know today's run; the driver run page knows its stops and already sits under the app-wide position watch. The arrival banner went there, built on a pure `stopAtDoor` (pending only, has coordinates, not waved away, nearest wins).
- **A banner, not a question.** It names the place and offers one button; «فعلاً نه» is per stop.
- **Opening a child's sheet from the parent without an effect:** the parent bumps a counter prop and the child adjusts its own state during render when it sees a new value.
- **Suggestions are scoped to the person's own customers** (those they have sold to). Showing a salesperson other people's customers would leak data and make the call someone else's job. Other roles get none.
- **Per-device dismissal is a deliberate shortcut**: it needs no table or migration; the cost is that «الان نه» on a phone does not hide the card on the desk.
- **The plan assumed per-event push notifications.** Pushes are one grouped digest, so there is no single item to hang a button on. Check how a channel is built before planning actions on it.
- Repo smoke test on an empty database catches SQL typos in the new queries cheaply.

## Phase H (report cards)

- **The strip already was a card layout.** `KpiStrip` had a hero card and a bar with inline detail; the phone version only needed the bar swapped for a carousel and the detail moved to a sheet. Read the component before planning a new one.
- **One markup, CSS decides the layout; JS decides behaviour.** Bar and carousel are both rendered and a media query hides one; only whether the drill opens as a sheet reads `useIsNarrow`, so there is no flash.
- **Role and icon rules apply to new widgets too.** `role="list"` / `listitem` trip the no-role-literals test; use `<ul>/<li>`. A button that is a picture needs a recorded reason (or an icon) inside it.
- **Totals keep the table's sign convention** (costs negative) so the card and the table can never disagree; a test pins it.

## Phase I (admin presets)

- **Check what there is to copy before building «copy from».** A group is a name and a colour; its districts each belong to exactly one group, so copying a territory would steal it. The commission plan is the real template, and `listPlans` already existed: only the page prop and a pure mapping (`latestPlans`, `planToEditable`) were needed.
- **Generated credentials need a testable random source.** `lib/credentials.ts` takes the byte source as a parameter and rejects bytes that would bias the alphabet; the app passes `crypto.getRandomValues`.
- **Sharing a secret before it is saved is a trap.** The new-account write is held 5 s for undo; «ارسال» calls `flush()` first so the details work the moment they arrive.
- **Flow tests key variant values by step id**, not by field name (`name`, `phonenum`).
- The month grid cells are buttons without icons; the recorded-reason comment satisfies the button rule without 31 decorative glyphs.

## Phase 8 (layout pass)

- **Count what is tapped, not what is styled.** The tiny-target rule matched `py-0.5` on badges as well as buttons (31 hits, 19 real). The audit now finds the element's own opening tag, ignores `=>` when looking for its end, and only counts controls; a test pins it. Then the fix was one utility (`touch`) added where it was real.
- **Cards from the same markup beat a second component.** `AcctTable` labels every cell from its header and CSS lays the row out as a card, so ten pages changed without being touched; only string headers become labels and `colSpan` is honoured.
- **A map first mounted inside a hidden pane has no size.** The planner keys the map by the visible pane so switching remounts it in a visible container.
- **Toggling panes in place (`contents` / `hidden md:contents`) kept the diff to one file**; splitting a 1100-line page into components would have been a larger, riskier change for the same result.
- **A sheet is CSS plus one hook.** The processing modal became a bottom sheet with a media query and `useSwipeDismiss`, no new component.

## Phase 10 (rules and enforcement)

- **Written before the gate was met, at the user's request, with the gap stated in the document.** No phone run was possible, so §5 says the budgets are targets; the allowlist leaves 10 dropdowns counted rather than exempting them to look finished.
- **Allowlist per rule, not per file.** Exempting a whole file hides its other counts; `{ rules: ["select"], reason }` keeps text fields and tap targets ratcheting there.
- **The check found its own gaps on first run:** three mobile components (ActionCard, KeypadField, SmartPicker) had no test naming them. A rule that is enforced finds the exceptions you forgot.
- **`confirm()` as a function name is a false positive for a regex audit;** rename it rather than loosen the rule.
- **Verified the check fails:** a scratch `<select>` made `check:mobile` exit 1 with the rule cited, then was removed.

## Leftovers pass

- **A smoke test on an empty database caught a wrong join** (`credit_approvals` has no `customer_id`; the customer comes through the order) before it reached a page. Every new repo query gets one.
- **Chips replace dropdowns inside map panels too**; a sort order with seven options is a scrolling row, a list of saved routes goes behind «فیلترها».
- **A neutral value that is truthy is a trap** (`"__none"`): guard the handler, not just the group.

## Leftovers round 2

- **Long press is a swipe's quiet sibling.** One timer, cancelled by any movement past the travel threshold, and the click it produces is swallowed for a moment. Selection mode turns the row's swipe actions off, otherwise a drag while picking runs an action.
- **Bulk actions send only what the server allows.** `chequeBulk` filters by the server's own transition table and reports how many were skipped, so the toast tells the truth.
- **Not every plan item has something behind it.** The duplicates deck needs a pair queue and a merge that do not exist; it moved to `docs/future-features.md` (F5) instead of being faked.

## First real-browser run (375px, demo data, Chromium)

Seeded a small demo database (`npm run seed:demo -- --scale=smoke --db=/tmp/...`; the default heavy scale fails on order dates older than a year), ran `next dev` against it, logged in as each demo role and drove pages with Playwright at 375x812 with touch. It found what no unit test had:

- **`/leads` was blank and 952px wide** (the sort chips I added sat in a non-wrapping flex row and widened the page). Fixed, and `.filterchips` now cannot widen its parent.
- **The expenses page crashed**: rows straight from node:sqlite have a null prototype and cannot be passed from a server component to a client one. Map to plain objects at the boundary (done for expense categories and credit approvals).
- **Every single-column answer list (pick steps) was 108px wide** instead of full width: `.tf-grid.one` is a grid inside a flex column. A pre-existing bug that every pick-step flow had.
- **The floating «+ ثبت» button covered the order form's submit button.** It now hides on pages that mark their own primary bar.
- Worked as designed: bottom bar, quick actions, suggestion cards with real churn data, income statement cards and drill sheet, KPI carousel (13 cards) and drill sheet, planner panes, leads selection tray, customer picker sheet, payments filter sheet, expense and new-account flows, keypad.
- Method note: `.tf-opt` also matches hidden quick-action links in the DOM; select inside `.sheet.on`.

## Gaps pass (3)

- **Push buttons need exactly one target.** Pushes are digests, so a button is attached only when the digest is about one actionable thing, and the service worker may only make a relative /api/ request (pinned by a test that is mirrored by a regex in `public/sw.js`). Reminder pushes carry the reminder's customer, not the reminder id, so they got no button.
- **The offline outbox already existed; the UI just did not use it.** `postJSON(url, body, outbox)` queues a `payment.record` fact when the device is offline; wiring the payment flow was ten lines. Look for the plumbing before building it.
- **Drag by a handle, not by the row.** The row stays scrollable and tappable; the handle (`touch-none`, pointer capture) owns the drag, and `slotAt`/`moveItem` decide where it lands.
- **Some gaps are product questions, not work:** a «skipped» stop state, a pair queue for duplicates, a photo of an expense. Each is written down with what it needs.

## Decisions pass

- **When the owner delegates a policy, change the test that encoded the old one and say so.** Reversible deletes undo; the one irreversible action asks. The destructive-confirm test now holds each handler to its kind.
- **«Later» is not a state.** Skipping a door for now is "come back to it last"; moving the stop to the end of the run answers it without a new status or any change to totals.
- **Offline authorisation lives in the sync server, not the client.** Cheque and complaint mutations check the person's role set and re-validate the payload exactly like the online routes; the ledger (client_uuid) makes replays harmless.
- **A grep audit counts words in comments.** Zero dropdowns took rewording one comment that said "<select>".
