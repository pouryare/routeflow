# Implementation Plan: Multiple List Views for همه مکان‌ها

## Overview

Add 8 layout view variants (Compact List, Pocket Cards, Card Grid, Kanban, Score View, Table View, Batch Selection, Cluster View) to the همه مکان‌ها pool section on the `/leads` page. Users switch between views via a toggle bar styled to match the app's existing navigation chrome. The `useLeads()` hook provides canonical data; each view is a pure rendering layer over the same `visible` array. View preference persists to localStorage.

**Current state**: The pool section renders a single `<ul>` of `<LocationCard>` rows (lines 133-141 of `page.tsx`), plus a standalone `<LeadsMap>` below the route section. Sort dropdown and search bar already exist above the list.

**Target state**: A view toggle bar sits above the pool list area. The active view component renders the same `visible` data in the chosen layout. All 8 views coexist in the same page section.

---

## Types

### New type definitions

```typescript
// File: lib/leadViews.ts
export type LeadViewMode = 
  | "compact"    // Dense rows (current default)
  | "pocket"     // Cards with paper slips peeking behind
  | "grid"       // 2-3 column card grid
  | "kanban"     // Columns grouped by status
  | "score"      // Visual rating bars (potential/volume/ease)
  | "table"      // Spreadsheet-style sortable columns
  | "batch"      // Checkboxes + bulk actions for day-grouping
  | "cluster";   // Grouped by district

export interface LeadViewConfig {
  mode: LeadViewMode;
  label: string;
  icon: string;       // Icon name for the toggle bar
  description: string;
}

export const LEAD_VIEWS: LeadViewConfig[] = [
  { mode: "compact", label: "مختصر", icon: "list", description: "دوره‌های فشرده برای مرور سریع" },
  { mode: "pocket", label: "جیبی", icon: "wallet", description: "کارت‌های با کاغذ پشت آنها" },
  { mode: "grid", label: "شبکه‌ای", icon: "grid", description: "شبکه ۲-۳ ستونی" },
  { mode: "kanban", label: "کانبان", icon: "columns", description: "ستون‌ها بر اساس وضعیت" },
  { mode: "score", label: "امتیاز", icon: "star", description: "نمایش امتیازات بالقوه/حجم/راحتی" },
  { mode: "table", label: "جدول", icon: "table", description: "ستون‌های مرتب‌سازی‌پذیر" },
  { mode: "batch", label: "گروهی", icon: "checkboxes", description: "با تیک‌برگری برای تقسیم روز" },
  { mode: "cluster", label: "منطقه‌ای", icon: "map-pin", description: "گروه‌بندی بر اساس منطقه" },
];
```

### Existing types (unchanged)

- `SavedLocation` (`app/(shell)/leads/hooks/useLeads.ts:18`) — the canonical location shape
- `LocationStatus` (`app/(shell)/leads/hooks/useLeads.ts:16`) — `"contacted" | "visited" | "no_answer" | "declined"`
- `averageScore(row)` (`lib/leadScore.ts:77`) — returns `number | null`
- `LEAD_CRITERIA` (`lib/leadScore.ts:33`) — `[{key: "potential", ...}, {key: "volume", ...}, {key: "ease", ...}]`

---

## Files

### New Files

| Path | Purpose |
|---|---|
| `lib/leadViews.ts` | `LeadViewMode` type, `LEAD_VIEWS` config array, localStorage key constant |
| `components/leads/PoolViewToggle.tsx` | The view toggle bar matching nav chrome style |
| `components/leads/views/PoolViewCompact.tsx` | Current list rendering (extracted from page.tsx) |
| `components/leads/views/PoolViewPocket.tsx` | Pocket cards with paper slips peeking behind |
| `components/leads/views/PoolViewGrid.tsx` | 2-3 column CSS grid of cards |
| `components/leads/views/PoolViewKanban.tsx` | Status-column kanban board |
| `components/leads/views/PoolViewScore.tsx` | Visual rating bars per location |
| `components/leads/views/PoolViewTable.tsx` | Sortable column table |
| `components/leads/views/PoolViewBatch.tsx` | Checkbox rows with bulk action bar |
| `components/leads/views/PoolViewCluster.tsx` | Locations grouped by district |
| `components/leads/views/PoolViewWrapper.tsx` | Orchestrator: renders the active view, passes `visible` data |

### Files to Modify

| Path | Change |
|---|---|
| `app/(shell)/leads/page.tsx` | Add `PoolViewToggle` and `PoolViewWrapper`; replace the `<ul>` block |
| `components/leads/LocationCard.tsx` | Add optional props for reuse across views (`compactMode`, `showDistance`, `showCheckboxes`) |
| `components/leads/LocationCard.tsx` | Export `LocationCard` for use in grid/kanban views |

### Files NOT Modified

| Path | Reason |
|---|---|
| `app/(shell)/leads/hooks/useLeads.ts` | View mode is UI state; `useLeads` provides `visible` array unchanged |
| `app/(shell)/leads/hooks/useLeads.ts` | `sortMode`/`query`/`setSortMode`/`setQuery` already exist and all views share them |
| `components/LeadsMap.tsx` | Map is separate; unaffected by pool view changes |
| `components/leads/RouteSection.tsx` | Route section is separate; unaffected |
| `components/leads/RunPanel.tsx` | Unaffected |
| `components/leads/LocationTapFlow.tsx` | Unaffected |
| `lib/leadScore.ts` | Already provides `averageScore`, `LEAD_CRITERIA`, `scoreOf` |
| `app/globals.css` | Use existing CSS variables and Tailwind classes |
| `app/layout.tsx` | Unaffected |

---

## Functions

### New Functions

**`PoolViewToggle`** (`components/leads/PoolViewToggle.tsx`)
- Props: `activeView: LeadViewMode`, `onChange: (mode: LeadViewMode) => void`
- Renders a horizontal scrollable bar of view options matching nav chrome style
- Uses same styling as `NavAppSetting`: `rounded-[var(--radius-md)] border px-2.5 py-2 transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)]`
- Active item: `border-accent bg-accent/10`, text `text-accent`
- Inactive item: `border-border`, text `text-text-muted`
- Hover: `hover:border-accent hover:text-accent`
- Persists selection to `localStorage("coverage_lead_view")` on change
- Reads stored selection on mount via `readViewMode()`

**`readViewMode(): LeadViewMode`** (`lib/leadViews.ts`)
- Reads `localStorage.getItem("coverage_lead_view")`
- Returns `"compact"` if invalid/missing
- Type-guards the value against `LEAD_VIEWS.map(v => v.mode)`

**`PoolViewWrapper`** (`components/leads/views/PoolViewWrapper.tsx`)
- Props: `viewMode: LeadViewMode`, `locations: SavedLocation[]`, `sharedProps` (inRun, navAppId, onSelect, onToggleRun, etc.)
- Switch statement on `viewMode` renders the matching sub-component
- Handles empty state: if `locations.length === 0`, renders `<EmptyState>`
- Handles loading state: if `loading`, renders `<SkeletonRows>`

**`PoolViewCompact`** (`components/leads/views/PoolViewCompact.tsx`)
- Current `<ul>` + `<LocationCard>` rendering extracted from `page.tsx` lines 133-141
- Identical to current behavior

**`PoolViewPocket`** (`components/leads/views/PoolViewPocket.tsx`)
- Cards with 2 decorative paper slips peeking behind, fanning on hover
- Uses CSS `::before`/`::after` pseudo-elements or positioned divs
- Color-coded slip colors matching status (green/blue/red/gray)
- On hover: translate/rotate the slips to fan out

**`PoolViewGrid`** (`components/leads/views/PoolViewGrid.tsx`)
- CSS Grid `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`
- Each cell contains a `LocationCard` variant
- `LocationCard` needs `compactMode` prop for tighter padding in grid

**`PoolViewKanban`** (`components/leads/views/PoolViewKanban.tsx`)
- 4 columns: تماس گرفته / بازدید شد / پاسخ نداد / رد شد
- Locations drop into columns based on `loc.status`
- Drag-and-drop optional (use existing `useCardDrag` pattern if available)
- Each column has a header with count

**`PoolViewScore`** (`components/leads/views/PoolViewScore.tsx`)
- Each location shows 3 horizontal bars (potential, volume, ease)
- Bar widths: 0-100% based on `rating_potential/volume/ease` (null = no bar)
- Average score badge on the side
- Sorted by `averageScore` descending (like `sortMode === "score"`)
- Color-coded: green (>3), blue (2-3), amber (1-2), red (<1)

**`PoolViewTable`** (`components/leads/views/PoolViewTable.tsx`)
- Columns: Name, Status, Score, Distance, Priority
- Sortable by clicking column headers (integrates with existing `setSortMode`)
- Clicking a row selects the location (same `onSelect` callback)
- Uses existing Tailwind classes for table styling

**`PoolViewBatch`** (`components/leads/views/PoolViewBatch.tsx`)
- Each row has a checkbox
- Top bar shows: selected count, "انتخاب همه" toggle, bulk actions (Add to Route, Add to Day)
- Integrates with existing `run` state (`addToRun`/`removeFromRun`)
- "انتخاب همه" button at top (mirrors existing `page.tsx` line 104)
- Batch actions button at top-right

**`PoolViewCluster`** (`components/leads/views/PoolViewCluster.tsx`)
- Groups `visible` locations by geographic proximity or manual district assignment
- Each cluster header shows: district name, count
- Locations listed under their cluster
- Uses `lat`/`lng` for clustering when no district field exists
- Falls back to showing all locations in one cluster if no coords

### Modified Functions

**`page.tsx` main render**
- Add `activeView` state (initialized from `readViewMode()`)
- Add `PoolViewToggle` above the pool list area
- Replace the `<ul>` block (lines 133-141) with `PoolViewWrapper`
- Pass `visible` array from `useLeads()` to `PoolViewWrapper`
- All existing props (`inRun`, `navAppId`, `setSelectedMapId`, `run`, `setPinningId`, `togglePriority`, `addToRun`, `removeFromRun`, etc.) passed through to wrapper

**`LocationCard`** (`components/leads/LocationCard.tsx`)
- Add optional `compactMode?: boolean` prop for tighter padding in grid/kanban views
- Add optional `showCheckboxes?: boolean` prop for batch view
- Add optional `checked?: boolean` prop for batch selection
- These are additive; existing behavior unchanged when props are omitted

---

## Classes / CSS

### New CSS (add to `app/globals.css` or inline)

**Pool toggle bar styles** — match existing `NavAppSetting` chrome:
```css
.pool-toggle-item {
  /* Same as NavAppSetting item */
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  padding: 0.5rem 1rem;
  transition: all var(--dur-base) ease var(--ease-out);
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.pool-toggle-item:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.pool-toggle-item.active {
  border-color: var(--accent);
  background: var(--accent)/10;
  color: var(--accent);
}
.pool-toggle-bar {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.5rem;
  scrollbar-width: thin;
}
```

**Pocket card paper slips** — reuse the `.kargah` pattern from `globals.css`:
```css
.pocket-slip {
  position: absolute;
  border-radius: 6px;
  opacity: 0.7;
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.pocket-card:hover .pocket-slip:nth-child(1) {
  transform: rotate(-3deg) translateY(4px);
  opacity: 1;
}
.pocket-card:hover .pocket-slip:nth-child(2) {
  transform: rotate(2deg) translateY(8px);
  opacity: 1;
}
```

**Kanban columns** — reuse existing layout patterns:
```css
.kanban-column {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 200px;
}
.kanban-column-header {
  position: sticky;
  top: 0;
  background: var(--surface-raised);
  padding: 0.5rem;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 600;
}
```

**Table styles** — reuse existing table patterns from the orders page:
```css
.lead-table {
  width: 100%;
  border-collapse: collapse;
}
.lead-table th {
  text-align: right;
  padding: 0.5rem;
  border-bottom: 2px solid var(--border);
  font-size: var(--text-xs);
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}
.lead-table td {
  padding: 0.5rem;
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
}
```

**Grid layout** — responsive CSS grid:
```css
.lead-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
}
```

---

## Dependencies

**No new dependencies required.** All views use:
- React (already installed)
- Tailwind CSS (already installed, configured in `globals.css`)
- `@/lib/leadScore` (`averageScore`, `LEAD_CRITERIA`) — already exists
- `@/lib/format` (`faNum`) — already exists
- `@/lib/geo` (`distanceKm`) — already exists
- `@/components/meridian/Icon` — already exists
- `@/components/StarRating` — already exists (for score view)
- `@/components/CopyButton` — already exists (for table view)
- `react-leaflet` / `Leaflet` — already installed (for map, not directly affected)

**Optional future**: `@dnd-kit` was explicitly rejected per `2026-09-10-remediation-and-design-language-design.md`. Kanban drag-and-drop can use the existing `useCardDrag` hook pattern if needed.

---

## Testing Strategy

### Unit Tests

| Test File | What to Test |
|---|---|
| `tests/leadViews.test.ts` | `readViewMode()` returns correct default and stored value; `LEAD_VIEWS` has 8 entries; `LeadViewMode` type is exhaustive |
| `tests/PoolViewCompact.test.ts` | Renders correct number of cards; matches current behavior |
| `tests/PoolViewGrid.test.ts` | Renders grid layout; correct column count |
| `tests/PoolViewKanban.test.ts` | Correct distribution across 4 columns |
| `tests/PoolViewScore.test.ts` | Correct bar widths; null scores handled |
| `tests/PoolViewTable.test.ts` | Correct columns; sort functionality |
| `tests/PoolViewBatch.test.ts` | Checkbox state; bulk actions; "انتخاب همه" |
| `tests/PoolViewCluster.test.ts` | Correct grouping; fallback behavior |
| `tests/PoolViewPocket.test.ts` | Paper slips render; hover animation classes applied |
| `tests/PoolViewToggle.test.ts` | Renders 8 options; active state persists to localStorage |

### Integration Tests

| Test File | What to Test |
|---|---|
| `tests/leads-page-views.test.ts` | Full page renders with each view mode; toggle bar switches views; `visible` data flows correctly |
| `tests/leads-page-views.test.ts` | Switching views preserves sort/query state |
| `tests/leads-page-views.test.ts` | `LocationCard` works in all view contexts |

### Manual/Visual Tests

- Toggle bar matches nav chrome styling (`NavAppSetting`)
- Pocket cards have the signature "two cards behind" effect
- Score bars are color-coded per `LEAD_CRITERIA`
- Table columns are sortable
- Batch mode checkboxes work with existing `addToRun`/`removeFromRun`
- Cluster view handles locations without coordinates gracefully

---

## Implementation Order

### Phase 1: Foundation (Types & Config)

1. **Create `lib/leadViews.ts`**
   - Define `LeadViewMode` type
   - Define `LEAD_VIEWS` config array (8 entries)
   - Define `readViewMode()` / `saveViewMode()` functions
   - Define localStorage key constant `"coverage_lead_view"`

### Phase 2: Core Infrastructure

2. **Create `components/leads/PoolViewToggle.tsx`**
   - Toggle bar component matching `NavAppSetting` chrome style
   - 8 view options with icon + label
   - Persist to localStorage on change
   - Scrollable horizontal bar for mobile

3. **Create `components/leads/views/PoolViewWrapper.tsx`**
   - Switch statement rendering the active view
   - Passes `visible` data and shared callbacks
   - Handles loading/empty states

4. **Modify `app/(shell)/leads/page.tsx`**
   - Import `PoolViewToggle` and `PoolViewWrapper`
   - Add `activeView` state (initialize from `readViewMode()`)
   - Add `PoolViewToggle` above the list area
   - Replace `<ul>` block with `PoolViewWrapper`
   - Pass all relevant props through

### Phase 3: View Components (8 views)

5. **Create `components/leads/views/PoolViewCompact.tsx`**
   - Extract current `<ul>` + `<LocationCard>` from page.tsx
   - Identical to current behavior

6. **Create `components/leads/views/PoolViewPocket.tsx`**
   - Card layout with 2 paper slips peeking behind
   - CSS `::before`/`::after` or positioned divs for slips
   - Hover fan animation

7. **Create `components/leads/views/PoolViewGrid.tsx`**
   - CSS Grid `auto-fill, minmax(280px, 1fr)`
   - Each cell is a compact `LocationCard`

8. **Create `components/leads/views/PoolViewKanban.tsx`**
   - 4 status columns
   - Locations grouped by `loc.status`
   - Column headers with counts

9. **Create `components/leads/views/PoolViewScore.tsx`**
   - 3 horizontal bars per location (potential/volume/ease)
   - Average score badge
   - Color-coded bars

10. **Create `components/leads/views/PoolViewTable.tsx`**
    - 5 columns: Name, Status, Score, Distance, Priority
    - Sortable headers
    - Click-to-select

11. **Create `components/leads/views/PoolViewBatch.tsx`**
    - Checkbox rows
    - Bulk action bar
    - "انتخاب همه" toggle
    - Integrates with `run` state

12. **Create `components/leads/views/PoolViewCluster.tsx`**
    - Group locations by district/proximity
    - Cluster headers with counts
    - Fallback for no coordinates

### Phase 4: Component Refinements

13. **Modify `components/leads/LocationCard.tsx`**
    - Add `compactMode?: boolean` prop
    - Add `showCheckboxes?: boolean` prop
    - Add `checked?: boolean` prop
    - Keep existing behavior default

### Phase 5: Testing

14. **Create test files** for all 8 views + toggle + wrapper
15. **Run test suite**: `npx vitest run`
16. **Verify**: `npm run check:contrast` if contrast checks apply
17. **Manual verification**: Open `/leads`, switch all 8 views

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| `PoolViewWrapper` switch statement becomes large | Medium | Each view is a separate component file; wrapper is just a switch |
| `LocationCard` props bloat | Medium | Add props as optional; use `Partial<LocationCardProps>` pattern; views that don't need extra props just omit them |
| Pocket card CSS conflicts with `.kargah` styles | Low | Use scoped class names like `.pool-pocket` to avoid global `.kargah` conflicts |
| Grid view `LocationCard` layout differs from list | Low | `compactMode` prop adjusts padding; test visually |
| Kanban drag-and-drop complexity | Medium | Start with static columns; add drag-and-drop as follow-up using `useCardDrag` pattern |
| Batch view state management | Medium | Reuse existing `run` state; `addToRun`/`removeFromRun` already handle batch operations |
| Cluster grouping quality | Medium | Use k-means or simple distance threshold; fallback to single cluster |

## Assumptions

1. `useLeads()` provides the canonical `visible` array; views are pure renderers
2. `sortMode` and `query` from `useLeads` apply to all views (each view may interpret sort differently)
3. `LocationCard` is reused across multiple views with optional props
4. CSS uses existing design tokens from `globals.css`
5. No server-side preference storage — localStorage only for now
6. Default view mode is `"compact"` (current behavior)
7. All 8 views render the same `visible` data from `useLeads()`
8. The toggle bar is visible to both managers and drivers

## Out of Scope

- Role-based view filtering (drivers see all views; managers see all views)
- Server-side view preference sync
- Kanban drag-and-drop implementation
- Virtualized scrolling for large datasets (>100 locations)
- Custom user-defined view configurations
- Export to different formats per view
- Analytics/dashboard integration per view
- Accessibility improvements beyond existing WCAG compliance
- Tablet-specific responsive breakpoints (beyond existing Tailwind responsive)
