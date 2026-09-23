# Context-Aware Filter Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gate before each task is checked off). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the redundant filter bar on the leads page with a context-aware search box that merges filters into its dropdown.

**Architecture:** The SearchBox component expands its dropdown on focus/tap to show filter controls (sort, list, position, select-all) above search results. The page-level filter bar is stripped down to just SearchBox + PoolViewToggle.

**Tech Stack:** React/Next.js, TypeScript, Vitest, Tailwind CSS, existing design tokens

---

## File Structure

- Modify: `app/(shell)/leads/page.tsx` — remove duplicate filter controls, pass filter state to SearchBox
- Modify: `components/SearchBox.tsx` — add filter section inside dropdown, adapt search behavior
- Modify: `components/leads/views/PoolViewBatch.tsx` — ensure batch view doesn't get ✓ همه from parent

---

### Task 1: Remove duplicate filter controls from page.tsx

**Files:**
- Modify: `app/(shell)/leads/page.tsx:119-138`

- [ ] **Step 1: Remove the entire filter bar section** (lines 119-138: position button, both sort dropdowns, ✓ انتخاب همه, list dropdown, search input)

Replace the block from `{/* Search and filters */}` through the search input with a single `<SearchBox ... />` that receives all filter props.

- [ ] **Step 2: Add filter props to SearchBox call**

```tsx
<SearchBox
  customers={customers}
  districts={districts}
  onSelectCustomer={onSelectCustomer}
  onSelectDistrict={onSelectDistrict}
  onLocationFound={onLocationFound}
  inputRef={searchInputRef}
  onExpandedChange={setSearchExpanded}
  // New filter props:
  sortMode={sortMode}
  onSortModeChange={setSortMode}
  activeListId={activeListId}
  onListChange={openList}
  lists={lists}
  sortAnchor={sortAnchor}
  onPositionClear={() => setSortAnchor(null)}
  onSelectAll={handleSelectAll}
  inBatchView={activeView === "batch"}
/>
```

- [ ] **Step 3: Define handleSelectAll**

```tsx
function handleSelectAll() {
  const ids = visible.filter(({ loc }) => loc.lat !== null && loc.lng !== null).map(({ loc }) => loc.id);
  const newIds = ids.filter((id) => !run.includes(id));
  if (newIds.length === 0) return;
  updateRun([...run, ...newIds]);
}
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No type errors related to SearchBox props

- [ ] **Step 5: Commit**

```bash
git add app/\(shell\)/leads/page.tsx
git commit -m "refactor(leads): merge filter bar into SearchBox"


### Task 2: Add filter section to SearchBox dropdown

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Add new props to SearchBox interface**

```tsx
sortMode?: string;
onSortModeChange?: (mode: string) => void;
activeListId?: number | null;
onListChange?: (id: number | null) => void;
lists?: Array<{ id: number; name: string }>;
sortAnchor?: { lat: number; lng: number } | null;
onPositionClear?: () => void;
onSetPosition?: () => void;
onSelectAll?: () => void;
inBatchView?: boolean;
activeView?: string;
```

- [ ] **Step 2: Define SORT_OPTIONS constant**

```tsx
const SORT_OPTIONS = [
  { value: "nearest", label: "نزدیک‌ترین" },
  { value: "score", label: "بهترین امتیاز" },
  { value: "name", label: "نام" },


### Task 3: Context-aware sort dropdown (kanban hidden, score disabled)

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Compute visible sort options based on activeView**

```tsx
const visibleSortOptions = useMemo(() => {
  if (activeView === "kanban") return SORT_OPTIONS.filter((o) => o.value !== "status");
  if (activeView === "score") return SORT_OPTIONS.filter((o) => o.value === "score");
  return SORT_OPTIONS;
}, [activeView]);
```

- [ ] **Step 2: Disable sort dropdown when only one option**

```tsx
<select
  value={sortMode ?? "nearest"}
  onChange={(e) => onSortModeChange?.(e.target.value)}
  disabled={visibleSortOptions.length <= 1}
  className="..."
>
  {visibleSortOptions.map((o) => (
    <option key={o.value} value={o.value}>{o.label}</option>
  ))}
</select>


### Task 5: Position chip — removable when anchor is set

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: The position chip is already added in Task 2** — verify the `onPositionClear` and `onSetPosition` props are wired correctly in page.tsx:

```tsx
<SearchBox
  ...
  onSetPosition={() => { setShowManualPos(true); }}
  sortAnchor={sortAnchor}
  onPositionClear={() => setSortAnchor(null)}
/>
```

- [ ] **Step 2: Verify compilation**



### Task 7: Write tests

**Files:**
- Create: `tests/SearchBoxFilters.test.ts`

- [ ] **Step 1: Write test for sort option visibility by view**

```tsx
import { describe, expect, it } from "vitest";
import { SORT_OPTIONS } from "@/components/SearchBox";

describe("sort options by view", () => {
  it("shows all 7 options in default view", () => {
    expect(SORT_OPTIONS.length).toBe(7);
  });

  it("hides status in kanban view", () => {
    const kanbanOptions = SORT_OPTIONS.filter((o) => o.value !== "status");
    expect(kanbanOptions.length).toBe(6);
  });

  it("shows only score in score view", () => {
    const scoreOptions = SORT_OPTIONS.filter((o) => o.value === "score");
    expect(scoreOptions.length).toBe(1);
  });
});
```

- [ ] **Step 2: Write test for input type detection**

```tsx
import { describe, expect, it } from "vitest";

describe("detectInputType", () => {
  it("detects coordinates", () => {
    expect(detectInputType("35.7, 51.4")).toBe("coord");
  });

  it("detects Persian address", () => {
    expect(detectInputType("تهران تجریش")).toBe("address");
  });

  it("detects name query", () => {
    expect(detectInputType("حسن")).toBe("name");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/SearchBoxFilters.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/SearchBoxFilters.test.ts
git commit -m "test(search): add filter and input-type tests"
```

---

### Task 8: Self-review and final verification

- [ ] **Step 1: Verify all spec requirements are covered**

| Spec Requirement | Task |
|------------------|------|
| Kill duplicate sort dropdown | Task 1 |
| Sort hidden in kanban | Task 3 |
| Sort disabled in score | Task 3 |
| Position chip removable | Task 5 |
| ✓ همه hidden in batch | Task 2 |
| Search adapts to input | Task 4 |
| Mobile bottom sheet | Task 6 |
| Filter section in dropdown | Task 2 |

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass (no regressions)

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final verification"
```
Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add components/SearchBox.tsx app/\(shell\)/leads/page.tsx
git commit -m "feat(search): wire position chip props"
```

---

### Task 6: Mobile — full-screen bottom sheet

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Add mobile detection**

```tsx
const [isMobile, setIsMobile] = useState(false);
useEffect(() => {
  const check = () => setIsMobile(window.innerWidth < 768);
  check();
  window.addEventListener("resize", check);
  return () => window.removeEventListener("resize", check);
}, []);
```

- [ ] **Step 2: Render dropdown as bottom sheet on mobile**

```tsx
<div className={isMobile ? "fixed inset-x-0 bottom-0 top-auto max-h-[80vh] rounded-t-[var(--radius-lg)] border-t border-border bg-surface-raised overflow-y-auto" : "absolute top-full left-0 right-0 mt-1 rounded-[var(--radius-md)] border border-border bg-surface-raised shadow-lg z-50 max-h-[60vh] overflow-y-auto"}>
  {/* filter strip + results */}
</div>
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): mobile bottom sheet for filter dropdown"
```
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): context-aware sort dropdown"
```

---

### Task 4: Search adapts to input type (as-you-type)

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Add input type detection helper**

```tsx
const COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
function detectInputType(query: string): "coord" | "address" | "name" {
  const trimmed = query.trim();
  if (COORD_RE.test(trimmed)) return "coord";
  if (trimmed.length >= 2 && /^[آا-یآ\s\-,./]+$/i.test(trimmed)) return "address";
  return "name";
}
```

- [ ] **Step 2: For coordinate input, skip geo search and show coordinate button**

In the results rendering, before the existing result branches:

```tsx
const inputType = detectInputType(query);

if (inputType === "coord" && coordMatch) {
  return (
    <div className="p-2">
      <button onClick={goToCoords} className="w-full rounded-[var(--radius-sm)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-accent-ink">
        <Icon name="map-pin" size="sm" /> نمایش مختصات روی نقشه
        <span className="block text-[length:var(--text-xs)] text-accent/60 font-mono">{coordMatch[1]}, {coordMatch[2]}</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: For address input, skip local search, go straight to geo**

```tsx
if (inputType === "address" && query.trim().length >= 2) {
  runGeosearch();
  return null;
}
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): adapt results to input type"
```
  { value: "newest", label: "تازه‌ترین" },
  { value: "status", label: "وضعیت" },
  { value: "route", label: "ترتیب مسیر" },
  { value: "priority", label: "اولویت" },
] as const;
```

- [ ] **Step 3: Add filter strip UI inside the dropdown**

Insert above the results section (before the `geoResults !== null` branch):

```tsx
<div className="mapsearch__filter-strip border-b border-border p-2 flex flex-wrap gap-1.5 items-center">
  <select value={sortMode ?? "nearest"} onChange={(e) => onSortModeChange?.(e.target.value)} className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-border bg-surface text-text-muted">
    {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
  <select value={activeListId ?? ""} onChange={(e) => onListChange?.(e.target.value ? Number(e.target.value) : null)} className="flex-1 min-w-0 rounded border border-border bg-surface px-2 py-1 text-[length:var(--text-xs)]">
    <option value="">مسیر آزاد</option>
    {(lists ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
  </select>
  {sortAnchor ? (
    <span className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-accent bg-accent/10 px-2 py-1 text-[length:var(--text-xs)] text-accent">
      📍 شما
      <button type="button" onClick={onPositionClear} className="text-accent/60 hover:text-accent">↵</button>
    </span>
  ) : (
    <button type="button" onClick={() => onSetPosition?.()} className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-border text-text-muted hover:border-accent hover:text-accent">
      📍 تعیین موقعیت
    </button>
  )}
  {!inBatchView && (
    <button type="button" onClick={() => onSelectAll?.()} className="rounded-[var(--radius-sm)] px-2 py-1 text-[length:var(--text-xs)] border border-accent text-accent hover:bg-accent hover:text-accent-ink">
      ✓ همه
    </button>
  )}
</div>
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): add filter section to dropdown"
```
```