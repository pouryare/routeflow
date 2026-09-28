# Merge the day split and the day groups

**Date:** 2026-09-27
**Status:** approved
**Surface:** `components/leads/RouteSection.tsx`, `components/CollapsibleSection.tsx`

## Why

The page draws the same day split twice.

**تقسیم خودکار بین روزها** renders a read-only preview: a card per day with a count, a
straight-line distance, two buttons, and the stops as one joined string of names.

**پیشنهادات روز** renders the same `proposedDays` as editable lanes: draggable stops, an ✕
per stop, a dropdown to add a location, and the same two buttons again.

They are not two views of one thing. They are the same array, drawn by two blocks of JSX,
sitting in two different cards. And the duplication goes further than it looks:

- `پیشنهاد بده` at the top and `پیشنهاد مجدد` on every lane are the **same function**. The
  page passes `repropose={enhancedProposeDays}` and the controls use `proposeDays`, which is
  also `enhancedProposeDays`. Two names, one behaviour, four buttons for one operation.
- `بستن پیشنهاد` appears in both blocks and does the same `setProposedDays(null)`.
- `بردن به مسیر` and `ذخیره به‌عنوان فهرست` are on every day in both blocks.

The editable lanes are a strict superset of the read-only cards, with one exception: the
straight-line distance. That is the whole of what the read-only block adds.

## The merge

The day groups move **up** into **تقسیم خودکار بین روزها**, which becomes the only place a
split is shown. **مسیر فعلی** keeps its card and shrinks back to what it always was: the
heading, the stops, the actions.

```
تقسیم خودکار بین روزها  ۳
  the explanation, once
  تعداد مقصد در هر روز: [8]   [پیشنهاد بده]   [بستن پیشنهاد]
  ┌─ روز ۱ — ۸ مقصد · ۱۲٫۴ کیلومتر ─────┐
  │  draggable stops, ✕ per stop          │
  │  [افزودن مکان به این روز…      ▾]     │
  │  [بردن به مسیر] [ذخیره به‌عنوان فهرست] │
  └────────────────────────────────────────┘
  روز ۲ …  روز ۳ …
مسیر فعلی
  the route
```

## What goes, and what crosses over

| Gone | Why |
|---|---|
| the read-only day-card list | same array, drawn twice |
| `پیشنهاد مجدد` per lane | the same function as `پیشنهاد بده` |
| the second `بستن پیشنهاد` | the same `setProposedDays(null)` |
| the `پیشنهادات روز` heading | the separate thing it named no longer exists |

Crossing over: the **straight-line distance** (`dayKm`) joins each lane header. It needs
`runOrigin` and `routeLengthKm`, both already props of `RouteSection`.

**One trigger and one close**, at the top beside the setting. Each lane keeps only what is
genuinely per-day: its count, its distance, its stops, and the two actions.

## The heading shows a count

`CollapsibleSection` already has a `count` prop, rendered as `title (count)`. The day count
goes there, so a collapsed section holding three days still says three.

## A proposal must never be hidden

**The risk the merge creates:** the day groups are always visible today, because they live in
the route card. The day-split card is a `CollapsibleSection` that starts collapsed and
remembers its state. Move the days in there and a proposal made earlier can sit behind a
closed heading, with no hint it exists.

`defaultOpen` cannot fix this. It only seeds `useState`, and the localStorage effect then
overwrites it — so a section the manager collapsed once stays collapsed with a live proposal
inside it. That is the exact failure being prevented.

So `CollapsibleSection` gains one optional prop:

```ts
/** Set when the section holds something the reader must not miss. Beats the remembered
 *  state in both directions, so a proposal is never hidden behind a heading somebody
 *  collapsed an hour ago. */
forceOpen?: boolean;
```

and one line changes: `const expanded = filter ? true : (forceOpen ?? open);`

`??` and not `||`, so `false` means "no" rather than "fall through to the remembered state".
No other section passes it, so nothing else on the page changes behaviour.

The day-split card passes `forceOpen={proposedDays !== null}` and `count={proposedDays?.length}`.

## Testing

No component tests in this repo, so this is a layout change verified by types and by looking
at it. The one behaviour worth pinning is the decision itself:

- `forceOpen` beats a remembered `"0"`, and `undefined` leaves the remembered state alone

## The risk tests cannot cover

Collapsing is remembered per `storageKey`, and this section keeps the same `leads_split` key,
so anyone who has it open today finds it open after the merge. But the lane heights change
and the drag targets move. Only a browser can confirm that.