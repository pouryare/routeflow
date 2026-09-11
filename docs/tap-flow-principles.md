# Tap flows — how RouteFlow asks questions

A **tap flow** is a bottom sheet that asks one question at a time, where every answer is a big
button and each answer decides the next question. It replaces a form wherever the person
using it is standing up, holding a phone, and in the middle of real work: at a restaurant
door, in a van, on the phone with a customer.

The after-call flow in the CRM is the reference implementation. Its clickable mockup is at
<https://claude.ai/code/artifact/bb9de4b3-5b28-4b92-b3f4-71f9cd4e1145> (private to the
owner; the CRM spec in `docs/superpowers/specs/` describes it in full). This document is the
reusable rulebook for the rest of the app.

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
│  What will be saved            │  summary chips: outcome · contact · side-effects
│  ┌ Next action ─────────────┐  │  prefilled from the answers
│  │ Call again · me          │  │
│  │ (فردا ۱۰:۰۰) (۳ روز) ... │  │  time chips, first one selected
│  └──────────────────────────┘  │
│  [          ثبت          ]     │  one big primary button
│        بدون کار بعدی…          │  escape hatch — asks for a one-tap reason
└───────────────────────────────┘
          ↓
   Confirmation: what was saved + where it now appears ("in کارهای من and امروز")
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

### Typing
8. **Typing only for what the app can't know**: a new phone number, a new person's name, an
   amount that differs from the expected one. Everything else is a chip.
9. **Notes are optional, everywhere.** A flow never requires free text to finish.
10. **Prefill from context.** Contact = the primary contact, amount = the order total,
    quantity = the last order's quantity, date = the rule's default. Show the prefilled
    value; never apply it silently.

### Moving
11. **Back goes up one step and keeps the answers below it.**
12. **Closing the sheet saves a draft**, not nothing. The card shows «نتیجه ثبت نشده»
    (outcome not logged) until it's finished or discarded.
13. **One sheet, content swaps in place.** No modal on top of a modal. A calendar or product
    picker is a step in the flow, not a pop-up over it.
14. **Auto-open when it's obviously next.** After a `tel:` call, the flow opens when the
    app becomes visible again (`visibilitychange`). After scanning a delivery, the
    delivery flow opens.

### Finishing
15. **The last screen shows what will be saved**: summary chips for every recorded fact
    and side-effect (temperature change, quote sent, sample created).
16. **Every flow ends with what happens next**: a prefilled next action with an owner and a
    time, saved with one tap. Skipping it asks for a one-tap reason.
17. **The confirmation says where things went.** «ثبت شد · در کارهای من و امروز» (saved,
    now in my tasks and today), with **undo** from the toast, not an "are you sure?" dialog
    before saving.

## 4. Tap budget

- The **most common path must finish in ≤ 5 taps**, including the final save.
  (Missed call: جواب نداد → فردا ۱۰:۰۰ → ثبت = 3 taps.)
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
- **Silent defaults**: a value applied without appearing on the final summary.
- **Stacked modals**: calendar over sheet over page.
- **Ending on "Saved"** with no next action and no hint of where the record went.

## 9. Checklist before shipping a flow

- [ ] Common path ≤ 5 taps, longest ≤ 9 (asserted in a test)
- [ ] No question is shown whose answer is already known
- [ ] Recommended answers highlighted, not pre-selected
- [ ] Typing only for data the app can't know; notes optional
- [ ] Back keeps answers; closing keeps a draft
- [ ] Final screen lists everything that will be saved, including side-effects
- [ ] Ends with a next action (or a reason for none)
- [ ] Confirmation says where the record now appears, with undo
- [ ] Server applies effects from the same config the UI renders
- [ ] Works offline if it records something that already happened
- [ ] RTL, Persian digits, Shamsi dates, `<Icon>`, focus rings, reduced motion
