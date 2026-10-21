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
