# Mobile first — how RouteFlow takes input and shows lists on a phone

RouteFlow is used standing up: at a door, in a van, on a call. This is the rulebook for everything
that is **not** "record what just happened" (that is `docs/tap-flow-principles.md`). It was written
after the patterns below were built, from `docs/superpowers/plans/mobile-first-lessons.md`; where a
rule came from a real mistake, the mistake is named.

**Status of the evidence.** Everything here was built and unit-tested, and the layout is checked by
CSS and render tests. It has **not** been run on a real phone, and the "day in the life at 375 px
per role" check the plan asked for before writing this has not been done. Treat the interaction
budgets in §5 as targets, not measurements, and correct them in this file when someone measures.

## 1. Defaults at a glance

| Default | Rule |
|---|---|
| **No keyboard unless typing is the only way** | Numbers use the keypad, choices use chips or a picker, days use words. |
| **Recents before search** | A picker opens on what this person picks most; the search box comes second and is not focused if there is a usual. |
| **Chips before dropdowns** | No `<select>` on a path a phone uses. |
| **A gesture ends in undo, not a question** | Swipe, decide, delete: act, toast, «بازگردانی ثبت» for 5 s. |
| **Never gesture-only** | Every swipe has a button (hidden but focusable on phones, visible from 768px). |
| **Sheets, not modals** | Anything that opens over a page is a bottom sheet with a grab handle, a close button and swipe-down. |
| **One markup, CSS chooses the layout** | Phone and desk layouts are both in the markup; a media query shows one. JS only decides behaviour. |
| **44 px to tap, 52 px to answer** | `touch` utility for small controls; answer buttons in flows are 52 px. |
| **Say why** | A suggestion carries a one-line reason; a banner names the place; a deck shows «۳ از ۱۲». |
| **Scope to the person's own data** | Suggestions and queues show what the signed-in person owns. |

## 2. Which pattern to use

| Situation | Pattern | Where |
|---|---|---|
| Recording what just happened | TapFlow | `components/tapflow`, `lib/flows/*` |
| Choosing a customer, product or place | SmartPicker (recents, then search) | `components/mobile/SmartPicker`, `lib/recents` |
| Entering a number | Keypad / KeypadField | `components/mobile/Keypad*`, `lib/keypad` |
| Choosing a day | DayChips (then a week strip, then the calendar) | `components/mobile/DayChips`, `lib/dayChoices` |
| Choosing a date far away | MonthGrid | `components/mobile/MonthGrid` |
| Narrowing a list | FilterChips + FilterSheet, periods as chips | `components/mobile/Filter*`, `lib/periods` |
| Acting on one row | SwipeRow (plus its buttons) | `components/mobile/SwipeRow`, `lib/swipe` |
| Judging a queue | DecisionDeck | `components/mobile/DecisionDeck`, `lib/decisions` |
| Choosing places | Map select (tap pins, nearest N, circle) | `components/LeadsMap`, `lib/mapSelect` |
| Reading numbers | KpiCarousel + DrillSheet, SummaryCards | `components/mobile/Kpi*`, `components/accounting/SummaryCards` |
| A wide table | AcctTable (cards below 768px) | `components/accounting/AcctTable`, `lib/tableCards` |
| The app should open the next step | Banner / ActionCards | `components/driver/DriverRun`, `components/mobile/ActionCard` |
| Setting up reference data | Admin presets (copy-from, chips, generated credentials) or a desk form | `lib/commission/copyPlan`, `lib/credentials` |
| Anything else | start from the nearest row and write down why in the PR | |

## 3. Anatomy of the phone shell

```
┌────────────────────────────┐
│ header (search, bell, me)  │   desk pill nav is hidden below 768px
├────────────────────────────┤
│ page content               │   board / map / list: CSS picks the phone layout
│  … StickyAction (optional) │   sits above the bar, inside the safe area
│                    [ + ثبت ]│   QuickActions: only flows the role can use
├────────────────────────────┤
│ ≤4 tabs per role  · بیشتر   │   BottomNav, derived from appTabs (a test fails on drift)
└────────────────────────────┘     env(safe-area-inset-bottom) under it
```

Sheets live in the `.meridian` root through `useSheetHost` (a transformed ancestor cannot misplace
them). A drivers' page is a bare single screen without the bar.

## 4. The rules

1. **Thumb zone.** Primary actions sit in the bottom half. *(The detection flash on the board came from choosing the layout in JS on a server that cannot know the device.)*
2. **No keyboard unless typing is the only way.** A numeric text field raises the OS keyboard over half the screen; the keypad is ours. Free text is for names, notes, phone numbers.
3. **Recents before search.** The history is per person and per device (`lib/recents`, keyed by user id), and only things actually used become "usual".
4. **Chips before dropdowns.** A `<select>` is a full-screen wheel on a phone and hides the options. Filters, sort orders, methods and statuses are chips; a long list is a picker.
5. **Days are words.** «امروز / فردا / پس‌فردا / شنبه ۱۲…», then a week strip, then the calendar. The browser's date field is Gregorian and is never used; `JalaliDateInput` is for desk forms and the DayChips fallback only, and a script limits who may import it.
6. **A gesture ends in undo, not a question.** «Are you sure?» is a second tap nobody reads; the 5 s undo costs nothing when the tap was right. A destructive answer is tinted and asks once with its consequence (the TapFlow rule); everything else just acts.
7. **Never gesture-only.** *(Rows that already had their own buttons pass `ownButtons={false}` rather than showing two.)* Screen readers and keyboards need the button.
8. **RTL mirrors.** "Start" is the right in Persian. `lib/swipe` speaks in start/end, never left/right. A mostly-vertical drag is a scroll.
9. **Sheets, not modals.** Same scrim, grab handle, close and swipe-down everywhere. Never put a swipe row inside a sheet (both listen for the same touches), and render a sheet's host outside a swipe face: portal events bubble up React's tree.
10. **Fixed-bottom elements clear the bar and the safe area.** The order form's total bar, the map's overlays and the sync badge all had to move. Anything new at the bottom edge measures `.bottomnav`.
11. **Offline is stated, not assumed.** Only a delivery at the door queues on the device. Everything else is online-only; say so in the failure toast, never lose a typed answer.
12. **Every pattern has loading, empty and error.** An empty deck says «موردی برای تصمیم‌گیری نیست»; a failed write says what failed and what to do.
13. **Labels name what they act on, and every button has an icon or a recorded reason.** «تأیید» alone fails a test; «تأیید عدد» passes. A picture-only button (a day cell, a KPI card) carries a comment saying why it needs no icon. Roles are `ul/li`, not `role="list"`.
14. **Sizes.** 44 px minimum to tap (`touch`), 52 px for answer buttons, tabular Persian digits, `prefers-reduced-motion` respected.
15. **One markup, CSS chooses.** Both layouts render; a media query shows one. `useIsNarrow` is for behaviour (does the drill open as a sheet?), never layout. The same query string is in the hook and the stylesheet, held by a test.
16. **Pure model, thin component, test.** The decision (which three suggestions, which cheques are due, what a swipe means) is a function in `lib/` with a test; the component renders it. Components that are pure layout are listed in `scripts/check-mobile-rules.mjs` with a reason.
17. **Explain suggestions, and scope them.** «آخرین سفارش ۴۲ روز پیش، معمولاً هر ۲۸ روز». Show a salesperson their own customers only. Dismissals that are per device must say so in a comment.
18. **An auto-trigger is a banner, not a question.** «به {name} رسیدید» with one button and «فعلاً نه» per place. Put the trigger where the data is (the driver run knows its stops; the map does not).
19. **Check what there is before promising a feature.** Credit approvals had no screen and an id-only list; push notifications are one digest, so there was no item to hang a button on; a group has nothing to copy. Read the code path first.
20. **Shortcuts that save secrets save them first.** «ارسال مشخصات ورود» flushes the held write before sharing, so the details work on arrival.

## 5. Interaction budgets (targets; not yet measured on a phone)

| Situation | Budget |
|---|---|
| Reach any destination the role can use | ≤ 2 taps from the bottom bar |
| Apply a common filter | 1 tap; any combination ≤ 3 taps |
| Choose a frequently used customer / product / place | ≤ 2 taps and no typing; a rare one ≤ 4 typed characters |
| Enter a number equal to a suggestion | 1 tap; otherwise digits + 1 |
| Pick a day in the next 7 days | 1 tap |
| Decide a queue item | 1 tap + the 5 s undo |
| Select N places on the map | 1 tap each, or 1 tap for «نزدیک‌ترین N» |
| Add an expense | 4 taps + the amount |
| Create an account | role, group, name (+ phone) |

## 6. Look and feel

Spacing and colour come from the `.meridian` tokens (`var(--space-*)`, `var(--accent)`, `--line`,
`--card`); chosen state is the accent fill **plus** a check icon, never colour alone. Icons come from
`<Icon>` only. The sheet container is `.sheet` (via `BottomSheet`); `.sheet-on-mobile` turns older
side panels into bottom sheets. Motion is short and disabled for reduced motion.

## 7. How to build one

1. `lib/<thing>.ts` — the pure model (inputs in, decision out). No React, no database.
2. `tests/mobile-<thing>.test.ts` — the model, including the awkward cases (year boundaries, empty, ties).
3. `components/mobile/<Thing>.tsx` — renders the model; no logic worth testing that is not in step 1.
4. A render test with `import "./helpers/sheetHost"` first if it opens a sheet; component tests use `createElement` (vitest only picks `tests/**/*.test.ts`).
5. Adopt it on two real screens, not one.
6. Append what surprised you to `docs/superpowers/plans/mobile-first-lessons.md`.

Raw SQL stays in `lib/repo/`. Clocks are read through a module-level helper (`const stamp = () => Date.now()`), not inside render.

## 8. Where it does not apply, and the allowlist

Desk-only surfaces — product catalogue, commission configuration, admin tables, district and group
editors — may keep a `<select>`. The exemption is written down in `scripts/mobile-allowlist.json`
as `{ "file": { "rules": ["select"], "reason": "…" } }`; a reason of fewer than 20 characters or a
file that no longer exists fails `npm run check:mobile`. Limit the exemption to the rules it needs
so the rest of the file still ratchets down.

## 9. Anti-patterns

- A native date or `<select>` on a primary phone path.
- "Are you sure?" dialogs (`confirm()` / `alert()`).
- Hover-only affordances; a gesture with no button.
- A table as the only view of a report.
- A fixed element without safe-area padding or clearance for the bottom bar.
- An auto-focused text field that raises the keyboard when a usual could be tapped.
- A modal over a sheet; a swipe row inside a sheet.
- Suggestions without a reason, or about someone else's customers.
- Splitting a phone and a desk page into two components when one markup and a media query will do.

## 10. Checklist before shipping a page or component

- [ ] No `<select>`, native date, or numeric text field on a phone path (or an allowlist entry with a reason).
- [ ] Anything you tap is 44 px (`touch`); answers 52 px.
- [ ] Every swipe or gesture has a button; destructive actions undo, not confirm.
- [ ] Both layouts in the markup, chosen by CSS; fixed-bottom elements clear the bar.
- [ ] A pure model with a test; a render test for the component.
- [ ] Persian digits, Shamsi dates, `<Icon>` on every button (or a recorded reason), no bare verbs.
- [ ] Loading, empty and error states.
- [ ] `npm run check:mobile` passes; a 375 px screenshot attached to the PR.

## 11. Parked ideas

Camera/OCR, voice input, paste-to-parse, forced password change on first sign-in:
`docs/future-features.md`.
