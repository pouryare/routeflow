# Pocket Content Design — Orders Board & Leads Pocket View

**Date:** 2026-10-05  
**Status:** Approved — ready for implementation planning

---

## 1. Overview

This spec defines the content for the "document pockets" (the peeking slips behind cards) in two views:

| View | Route | Component | Pocket Wrapper |
|------|-------|-----------|----------------|
| **Orders Board** | `/sales/orders?view=board` | `OrderPipeline` → `Pocketed` | `STAGE_DOCS` maps stage → paper count |
| **Leads Pocket** | `/leads?view=pocket` | `PoolViewPocket` → `Pocketed` | Dynamic paper count based on lead activity |

Both use the shared `Pocketed` component (`components/meridian/Pocketed.tsx`) which supports 0–3 papers via the `papers` prop and custom slip content via the `slips` prop.

---

## 2. Orders Board — Pocket Content

### 2.1 Paper Count by Stage

| Stage | Papers | Tone | Slip 1 | Slip 2 |
|-------|--------|------|--------|--------|
| `draft` | 0 | — | — | — |
| `confirmed` | 1 | `warn` (amber) | Order Summary | — |
| `on_route` | 2 | `info` (sky) | Order Summary | Run Summary |
| `delivered` | 2 | `good` (sage) | Order Summary | Run Summary |

### 2.2 Slip 1 — Order Summary (shown when papers ≥ 1)

**Static label:** «سفارش»  
**Dynamic fields:**
- Order number (`order_no`, e.g., `1404-00123`)
- Total weight (`kg` formatted, e.g., `۲۵۰ کیلو`)
- Line count (`line_count`, e.g., `۳ ردیف`)

**Visual:** Top border in stage tone (`warn`/`info`/`good`)

### 2.3 Slip 2 — Run Summary (shown when papers = 2)

**Static label:** «مسیر»  
**Dynamic fields:**
- Run ID (`run_id`, e.g., `ران #۴۲`)
- Stop position (`sort_order` from `delivery_stops`, e.g., `توقف ۳ از ۷`)

**Visual:** Top border in stage tone (`info`/`good`)

### 2.4 Empty State — Draft Orders (0 papers)

- **Plain card, no pockets** — current behavior retained
- No top padding (`padding-top: 0`)
- No slips rendered
- Clean card face only
- No "no documents" hint

### 2.5 Data Requirements

`PipelineOrder` type needs two new fields for `on_route`/`delivered` orders:
- `run_id: number | null`
- `sort_order: number | null`

These come from joining `delivery_stops` in `BoardView` (already has `onARun` set).

---

## 3. Leads Pocket View — Pocket Content

### 3.1 Paper Count by Lead Activity

| Lead State | Papers | Tone | Slip 1 | Slip 2 |
|------------|--------|------|--------|--------|
| New lead (no contacts, no visits) | 0 | `info` | — | — |
| Has contact history only | 1 | by `status` | Contact Log | — |
| Has contact history + visits | 2 | by `status` | Contact Log | Visit Log |

**Tone mapping** (from `STATUS_TONE` in `PoolViewPocket.tsx`):
- `contacted` → `good` (sage)
- `visited` → `info` (sky)
- `no_answer` → `warn` (amber)
- `declined` → `crit` (red)
- `null` (no status) → `info` (sky)

### 3.2 Slip 1 — Contact Log (shown when papers ≥ 1)

**Static label:** «تماس‌ها»  
**Dynamic fields:**
- Contact count (number of call attempts from `activities`)
- Last contact date (Jalali, e.g., `۱۴۰۴/۰۷/۱۲`)
- Last contact outcome (icon + short label)

**Visual:** Top border in lead's status tone

### 3.3 Slip 2 — Visit Log (shown when papers = 2)

**Static label:** «بازدیدها»  
**Dynamic fields:**
- Visit count (number of `lead_visit_activities` rows)
- Last visit date (Jalali)
- Last visit outcome (icon: ✓ visited, ✗ no_answer, etc.)

**Visual:** Top border in lead's status tone

### 3.4 Empty State — New Leads (0 papers)

- **Plain card, no pockets** — matches orders board behavior
- No top padding
- No slips rendered
- Clean card face only

### 3.5 Data Requirements

`PoolViewItem` needs enrichment with:
- `contactCount: number`
- `lastContactDate: string | null`
- `lastContactOutcome: string | null`
- `visitCount: number`
- `lastVisitDate: string | null`
- `lastVisitOutcome: string | null`

These come from querying `activities` (filtered to lead-related) and `lead_visit_activities` tables.

---

## 4. Shared Pocketed Component Usage

Both views use the existing `Pocketed` component:

```tsx
<Pocketed
  papers={paperCount}           // 0 | 1 | 2
  tone={tone}                   // 'good' | 'warn' | 'crit' | 'info'
  fan={true}                    // hover fan-out enabled
  slips={<CustomSlips />}       // custom slip content
>
  <CardFace />
</Pocketed>
```

**CSS classes** (already in `app/globals.css`):
- `.pocketed[data-papers="0"]` — no top padding
- `.pocketed[data-papers="1|2|3"]` — 38px top padding for slips
- `.pocketed__slip` — styled with `border-top` in tone color
- `.pocketed[data-fan]:hover .pocketed__slip` — fan-out animation

---

## 5. Implementation Notes

### 5.1 Orders Board
- Modify `BoardView` in `app/(shell)/sales/orders/page.tsx` to join `delivery_stops` for `run_id` and `sort_order`
- Update `PipelineOrder` interface
- Create slip components in `OrderPipeline.tsx` or a new `OrderPocketSlips.tsx`

### 5.2 Leads Pocket
- Modify `PoolViewWrapper.tsx` to enrich `PoolViewItem` with contact/visit counts
- Update `PoolViewPocket.tsx` to compute dynamic `papers` count (0/1/2)
- Create slip components in `PoolViewPocket.tsx` or new `LeadPocketSlips.tsx`

### 5.3 Shared Slip Pattern
Each slip follows the same structure:
```tsx
<div className="pocketed__slip" style={{ borderTopColor: `var(--${tone})` }}>
  <span className="slip-label">{label}</span>
  <span className="slip-value">{dynamicValue}</span>
  <span className="slip-meta">{metaValue}</span>
</div>
```

---

## 6. Acceptance Criteria

### Orders Board
- [ ] Draft orders show plain card (0 papers)
- [ ] Confirmed orders show 1 slip: Order Summary
- [ ] On-route orders show 2 slips: Order Summary + Run Summary
- [ ] Delivered orders show 2 slips: Order Summary + Run Summary
- [ ] Run Summary shows correct run ID and stop position
- [ ] Hover fan-out works on all slips
- [ ] Tone colors match stage (amber/sky/sage)

### Leads Pocket
- [ ] New leads show plain card (0 papers)
- [ ] Contacted leads (no visits) show 1 slip: Contact Log
- [ ] Visited leads show 2 slips: Contact Log + Visit Log
- [ ] Contact Log shows count, last date, last outcome
- [ ] Visit Log shows count, last date, last outcome
- [ ] Tone colors match lead status
- [ ] Hover fan-out works on all slips

---

## 7. Out of Scope

- Adding new database columns (uses existing tables)
- Changing the Pocketed animation/transition logic
- Modifying the Kanban/Compact/Grid/Table lead views (only Pocket view)
- Mobile-specific slip layouts (responsive handled by existing CSS)

---

## 8. Related Files

| File | Role |
|------|------|
| `components/meridian/Pocketed.tsx` | Shared pocket wrapper |
| `app/globals.css` (lines 2646–2710) | Pocket CSS |
| `app/(shell)/sales/orders/page.tsx` | BoardView + OrderPipeline |
| `components/sales/OrderPipeline.tsx` | Order cards + STAGE_DOCS |
| `components/leads/views/PoolViewWrapper.tsx` | Lead data enrichment |
| `components/leads/views/PoolViewPocket.tsx` | Lead pocket rendering |
| `lib/repo/leadRuns.ts` | Lead run/visit queries |
| `lib/crm/flows/*` | Activity/visit logging |
