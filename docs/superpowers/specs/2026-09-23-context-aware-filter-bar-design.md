# Context-Aware Filter Bar — Design Spec

**Date:** 2026-09-23
**Status:** Draft (pending user review)
**Scope:** Leads page only

---

## Problem

The leads page filter bar has redundant and static controls:

- Sort dropdown appears **twice** (exact duplicate)
- "✓ انتخاب همه" is a one-shot button with no persistent state
- Position button becomes a static label when set (no dismiss action)
- Search dropdown mixes 4 result types with no contextual filtering
- Filter controls are always visible even when irrelevant to the current view

## Approach: Context-Aware Filter Bar (Option C + Option 4)

Merge all filter controls into the SearchBox dropdown, making the search box the single permanent fixture. The dropdown expands on focus to reveal filters, then shows results. A small `☰` button inside the search input (right side) acts as a filter-toggle: clicking it opens the dropdown with filters visible, even without typing.

---

## Section 1: Sort Dropdown (kill duplicate + context-aware)

- Remove the first sort dropdown entirely (the one near the top, next to position)
- Keep only one sort dropdown, inside the search dropdown
- Behavior by view mode:

| View Mode | Sort Dropdown |
|-----------|---------------|
| Kanban | Hidden — kanban already groups by status |
| Score | Shows "امتیاز", disabled — score view always sorts by score |
| All others | Normal dropdown with all 7 options |

- Position button next to sort:
  - No position set → `📍 تعیین موقعیت` button
  - Position set → chip `📍 شما ↵` (click X to clear)

## Section 2: "✓ انتخاب همه"

- Stays as a one-shot button (adds all routable visible leads to the run)
- Hidden in batch view (batch has its own checkbox selection)
- Visible in all other views
- When all routable leads are already in run → dims, shows "همه در مسیر"

## Section 3: Search Dropdown (merged filters)

On focus/click, the search dropdown expands to show (top to bottom):

1. **Filters** — sort, list, position, ✓ همه
2. **Results** — customers, districts, coordinates, geo-address

Search adapts to input (as-you-type, not on blur):
- Types a name → customers + districts
- Types coordinates → coordinate result only, skip address fallback
- Types an address → geo-address results only
- No results → single "جستجوی آدرس" button (no redundant "آدرسی پیدا نشد")

Coordinate result button: `📍 نمایش مختصات روی نقشه` (coords in smaller text below, not in button label)

## Section 4: Layout

```
[🔍 جستجو...                    ▾]     ← always visible (search input + filter toggle)
[📍 نزدیک‌ترین ▾] [مسیر آزاد ▾]    ← inside dropdown on focus/tap
[📍 تعیین موقعیت]  [✓ همه]
───────────────────────────────
[results...]
```

- Mobile: dropdown becomes full-screen bottom sheet — filters on top, results below
- PoolViewToggle stays outside the search box (user requirement)

## Section 5: Edge Cases

| Scenario | Behavior |
|----------|----------|
| User switches view while dropdown open | Dropdown closes, new view's rules apply |
| Position set, location deleted | Chip shows "📍 نامعتبر ↵" — click to clear |
| No routable leads visible | ✓ همه disables, search shows empty state |
| First visit discovery | Tiny tooltip on ☰ icon: "فیلترها اینجا" |

---

## Assumptions & Constraints

- Leads page only (not customer page)
- PoolViewToggle unchanged (8 view modes as-is)
- No new UI chrome — everything lives in/around the search box
- Persian UI, `text-xs` sizing, existing design tokens
