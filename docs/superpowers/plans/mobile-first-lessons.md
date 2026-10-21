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
