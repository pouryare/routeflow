# Tap flows — how RouteFlow asks questions

A **tap flow** is a bottom sheet that asks one question at a time, where every answer is a big
button and each answer decides the next question. It replaces a form wherever the person
using it is standing up, holding a phone, and in the middle of real work: at a restaurant
door, in a van, on the phone with a customer.

The after-call flow in the CRM is the reference implementation. Its clickable mockup is at
<https://claude.ai/code/artifact/bb9de4b3-5b28-4b92-b3f4-71f9cd4e1145> (private to the
owner; the CRM spec in `docs/superpowers/specs/` describes it in full). This document is the
reusable rulebook for the rest of the app.

### Defaults at a glance

| Default | Rule | Where it's detailed |
|---|---|---|
| **Autosave** | The last answer saves. No save button, ever. | Rule 19 |
| **5-second undo** | A toast shows what was saved, with «لغو» and a 5 s countdown bar. Undo reopens the last question with every answer kept. The app's one undo window is 5 s everywhere (`OUTBOX_HOLD_MS = 5000`). | Rule 20, §6.6 |
| **5-second return** | The done screen returns to where the flow started after 5 s (or at once with «همین حالا»). It may offer the one or two likeliest next moves («تماس همین حالا», «باز کردن پرونده») meanwhile. The changed item is highlighted and the toast stays on screen. | Rule 21 |
| **Verify imported data** | The first contact with a record from an outside source (Google Maps, a pasted list, a spreadsheet) confirms it still exists as recorded before anything else. Invalid records leave the queues but keep their history. | Rule 8 |
| **Roles before names** | "Who did you talk to?" is answered with role chips (decision-makers, then staff). The name is optional; people already known appear first; picking a staff role leads to the decision-maker. | Rules 9–10 |

---

## 1. When to use a tap flow, and when not to

| Situation | Use |
|---|---|
| Recording **what just happened** (call outcome, delivery at the door, visit, payment received, complaint) | **Tap flow** |
| Several answers depend on each other (if X, ask Y; otherwise ask Z) | **Tap flow** |
| Changing one field on something already on screen (rename, phone, temperature) | **Inline edit**, not a flow |
| Long reference data typed once at a desk (product catalogue, user admin, commission rates) | **Normal form** |
| Something the person does dozens of times a day | Tap flow, with a hard tap budget (see §4) |

The test: *is the person answering questions about something that just happened, while
standing up?* If yes, it's a tap flow.

## 2. Anatomy

```
┌───────────────────────────────┐
│  Context strip (dimmed)        │  who/what this is about — business, attempt #, order no.
├───────────────────────────────┤
│  ‹ قبلی          ▬ ▬ ▬ ▭ ▭ ▭    │  back + progress (progress is approximate on a tree)
│                                │
│  Question (one, short, bold)   │
│  Sub-line: why it's asked / fact│
│                                │
│  [ Answer ]      [ Answer ]    │  2–8 big answers, 2 columns, ≥ 52 px tall
│  [ Answer · پیشنهادی ]  ...     │  the recommended answer is outlined, never pre-selected
│                                │
│  + یادداشت (اختیاری)            │  optional note, never blocks
└───────────────────────────────┘
          ⋮  (next question)
┌───────────────────────────────┐
│  Last question: "when next?"   │  time answers for the prefilled next action
│  [ فردا ۱۰:۰۰ · پیشنهادی ]      │  ← tapping an answer on the last step SAVES. No save button.
│  [ ۲ ساعت دیگر ] [ فردا عصر ]   │
│        بدون کار بعدی…          │  escape hatch — asks for a one-tap reason, then saves
└───────────────────────────────┘
          ↓ (autosaved)
┌───────────────────────────────┐
│  ✓ ثبت شد                      │  summary chips: outcome · contact · side-effects · next action
│  برگشت به فهرست در ۵…          │  auto-returns to where the flow started after 5 s
│  همین حالا برگرد               │  (or now, with one tap)
├───────────────────────────────┤
│ ثبت شد · تماس دوباره · فردا  [لغو (۵)] │  toast with a 5 s countdown bar, stays over the list
└───────────────────────────────┘
   The card that changed is highlighted in the list. After 5 s the toast says where the
   record went («در کارهای من و امروز») and the write is committed.
```

## 3. The rules

### Asking
1. **One question per screen.** Never two unrelated questions on one screen.
2. **It's a tree, not a wizard.** Skip every question the earlier answers make irrelevant.
   A "no answer" call never sees "which products?".
3. **Answers are facts, in the user's words.** «جواب نداد», not «NO_ANSWER» or «وضعیت: ۳».
   System codes live only in the config.
4. **2–8 answers per question.** More than 8 means the question is two questions, or the
   rare answers belong behind «سایر».
5. **Sub-labels state consequences**, not help text: «داغ» (this makes the lead hot),
   «تقویم باز می‌شود» (the calendar opens), «فرم سفارش باز می‌شود» (the order form opens).
6. **Highlight the recommended answer; don't pre-select it.** The person still taps once, so
   they own the choice and the tap counts as a confirmation.
7. **Destructive or terminal answers** (closed for good, cancel order) are tinted and always
   followed by one confirmation step that also offers the gentler alternative.
8. **Verify before you trust imported data.** The first contact with a record that came from
   outside (Google Maps, a pasted list, a spreadsheet) starts by confirming it still exists
   as recorded: right business? renamed? moved? closed? a different business on this number?
   not a fit? Invalid records leave every queue but keep their history; nothing is deleted.
9. **Ask for the role, not the name, the first time.** Nobody is known on a first call.
   Offer role chips grouped by *decision-maker* (owner, manager, purchasing, chef) and
   *staff* (receptionist/cashier, accountant, storekeeper, staff). The name is an optional
   field on the same screen. People already known appear first, above the roles.
10. **Gatekeepers route to the decision-maker.** Picking a staff role asks "who buys?" and
    "when can we reach them?", or "they put me through", which returns to the role question.

### Typing
11. **Typing only for what the app can't know**: a new phone number, a new person's name, an
   amount that differs from the expected one. Everything else is a chip.
12. **Notes are optional, everywhere.** A flow never requires free text to finish.
13. **Prefill from context.** Contact = the primary contact, amount = the order total,
    quantity = the last order's quantity, date = the rule's default. Show the prefilled
    value; never apply it silently.

### Moving
14. **Back goes up one step and keeps the answers below it.**
15. **Closing the sheet saves a draft**, not nothing. The card shows «نتیجه ثبت نشده»
    (outcome not logged) until it's finished or discarded.
16. **One sheet, content swaps in place.** No modal on top of a modal. A calendar or product
    picker is a step in the flow, not a pop-up over it.
17. **Auto-open when it's obviously next.** After a `tel:` call, the flow opens when the
    app becomes visible again (`visibilitychange`). After scanning a delivery, the
    delivery flow opens.

### Finishing
18. **Every flow ends with what happens next.** The last question is the prefilled next
    action's time (owner = me unless changed). Skipping it asks for a one-tap reason.
19. **Autosave: the last answer saves.** There is no save button. The done screen lists
    every recorded fact and side-effect as chips (outcome, contact, verification,
    temperature change, quote sent, sample created, next action).
20. **Undo, not "are you sure?".** A toast shows what was saved with «لغو» and a **5-second**
    countdown bar. Undo reopens the sheet on the last question with every answer kept.
    After 5 s the write commits and the toast says where it went («در کارهای من و امروز»).
21. **Return on your own.** The done screen goes back to where the flow started after
    **5 seconds** (or at once with «همین حالا»), and may offer the one or two likeliest next
    moves meanwhile (Add Lead: «تماس همین حالا», «باز کردن پرونده»). The item that changed is
    highlighted on return; the undo toast runs its own 5 s alongside.

## 4. Tap budget

- The **most common path must finish in ≤ 5 taps**. Saving is automatic, so it costs none.
  (Missed call: جواب نداد → فردا ۱۰:۰۰ = 2 taps after hanging up.)
- The **longest path should stay ≤ 9 taps**. If it's longer, fold two questions together
  or move the rare branch behind «سایر».
- Measure it: each flow's tests assert the tap count of its common path (see §6).

## 5. Look and feel

- Answer buttons: ≥ 52 px tall, full-width in one column or half-width in two; label at
  body size, sub-label at caption size in `--text-muted`.
- Recommended answer: `--accent-dim` border and an accent sub-label; selected: accent border
  plus a soft accent fill.
- Primary save button: full width, accent fill, the only accent-filled element on the sheet.
- RTL throughout; numbers in Persian digits; dates in Shamsi via the existing Jalali helpers.
- Icons from `<Icon name>` only (no emoji), and never an icon without a word.
- Focus ring visible on every button; the sheet announces each new question
  (`aria-live="polite"`); the slide-in respects `prefers-reduced-motion`.

## 6. How to build one

Every flow is **config + one generic sheet + one write path**:

1. **Config, pure, in `lib/<domain>/…Flow.ts`.** A tree of steps: `question`, `sub`,
   `options[] { code, label, sub?, recommended?, tone?, next, effects }`. Effects are data
   (`{ contact_status: 'no_answer', temperature: 'hot', next_action: {kind, offset} }`),
   not code.
2. **One generic `<TapFlow config onFinish>` component** renders any config: context strip,
   back, progress, answers, multi-select steps, final summary, next action, draft save.
3. **One server endpoint per flow** receives the final answers and applies the effects in one
   transaction. The server reads **the same config module**, so the UI and the server can't
   disagree about what an answer does.
4. **Tests on the config, not the pixels:**
   - every path ends at a final step (no dead ends, no cycles);
   - the common path's tap count ≤ 5, every path ≤ 9;
   - every option label exists in the labels map (the existing `no-raw-enum-copy` idea);
   - every effect is a known key.
5. **Offline:** a flow's final submit is a queued "fact" operation (`lib/offline/safety.ts`)
   whenever it records something that already happened.
6. **Undo window = outbox hold.** The 5-second undo is the offline outbox holding the
   mutation before sending it, so undo never has to reverse a server write.
   **Decision (2026-09-11): one undo window for the whole app, 5 s.** `OUTBOX_HOLD_MS`
   (`lib/offline/constants.ts`) goes from 9000 to 5000, and `ToastProvider.ACTION_LIFETIME_MS`
   keeps sharing it, so every undo toast in RouteFlow, tap flow or not, lasts 5 s. The
   change is scheduled in the CRM implementation plan and is not live yet.

## 7. Where to apply it next in RouteFlow

| Surface | Today | As a tap flow |
|---|---|---|
| Call / visit outcome (CRM) | 4 outcome chips on `/today` (`components/today/OutcomeChips.tsx`) | The reference flow |
| Task done on Board / Pocket | Drop into «انجام‌شده» + outcome chips | Opens the same flow as the task's kind |
| Delivery at the door (driver) | `recordDelivery` form | Delivered all? → what's short → why (reason chips) → cash received? → how much (prefilled) |
| Payment received | `PaymentsPanel` form | Cash / card / cheque → amount (prefilled with the balance) → cheque details only if cheque |
| Complaint | `ComplaintsPanel` form | Which order → which product → what's wrong (chips) → photo? → what we'll do next |
| Visit check-in | none | Met anyone? → who → what happened → next action (the call flow's visit variant) |
| Stock count | table entry | Product by product: as expected? → if not, count |
| Order quick path (repeat customer) | full `OrderForm` | Same as last time? → adjust quantities → delivery day → confirm |

## 8. Anti-patterns

- A **fixed wizard** that asks every step whether or not it applies.
- A **dropdown inside a sheet.** If it needs a dropdown, it needs chips or a search step.
- **Required free text** ("describe the outcome").
- **"Are you sure?" before saving** instead of undo after saving.
- **A save button** at the end of a tap flow. The last answer is the save.
- **Asking for a name** on a first contact, when a role is all anyone knows.
- **Trusting imported data**: acting on a Google Maps record without confirming it first.
- **Silent defaults**: a value applied without appearing on the final summary.
- **Stacked modals**: calendar over sheet over page.
- **Ending on "Saved"** with no next action and no hint of where the record went.

## 9. Checklist before shipping a flow

- [ ] Common path ≤ 5 taps, longest ≤ 9 (asserted in a test)
- [ ] No question is shown whose answer is already known
- [ ] Recommended answers highlighted, not pre-selected
- [ ] Typing only for data the app can't know; notes optional
- [ ] Back keeps answers; closing keeps a draft
- [ ] Records from outside sources are verified on first contact
- [ ] People are asked for by role first; names optional; known people first
- [ ] Ends with a next action (or a reason for none)
- [ ] Last answer autosaves; done screen lists everything saved, including side-effects
- [ ] Toast with «لغو» and a 5 s countdown; undo reopens the last question with answers kept
- [ ] Auto-return after 5 s; the changed item is highlighted; toast says where it went
- [ ] Server applies effects from the same config the UI renders
- [ ] Works offline if it records something that already happened
- [ ] RTL, Persian digits, Shamsi dates, `<Icon>`, focus rings, reduced motion
