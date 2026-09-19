# Adaptive `/leads` Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the `/leads` page into an adaptive, role-based interface with a read-only pool catalog, day-organized route section with tap-flow on every stop, OSRM road-distance optimization, and creative features — all built on existing infrastructure.

**Architecture:** One `/leads` page adapts based on `session.isManager`. The pool becomes a read-only catalog (inline name editing + pin-on-map retained). The route becomes the central hub with day groups and tap-flow. OSRM's `fetchOsrmTable` replaces haversine for ordering/clustering. All tap-flow interactions reuse the existing `leadVisitFlow` config and `TapFlow` component.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind, existing `TapFlow` + flow machine, `lib/osrm.ts`/`lib/routing/osrmMatrix.ts` for OSRM, SQLite via `lib/repo/crm/write.ts`, Persian UI via existing vocab maps.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `components/leads/LocationCard.tsx` | Read-only pool row with status dot, inline name, rating, 3 buttons, pin-on-map |
| `components/leads/DayGroupCard.tsx` | Day group card with stops, progress, distance |
| `components/leads/LocationTapFlow.tsx` | Host wrapper for leadVisitFlow tap-flow |
| `components/leads/RouteSection.tsx` | Route section with day groups (both roles) |
| `components/leads/LocationCard.tsx` | Read-only pool row |
| `app/(shell)/leads/page.tsx` | Role-based rendering, pool simplification, OSRM integration, sorting |
| `lib/geo.ts` | Increase RESORT_THRESHOLD_KM; add `twoOptOrder` with custom distance |
| `components/leads/RunPanel.tsx` | Accept `DayGroup[]`; add progress bars |
| `components/LeadsMap.tsx` | Driver mode: show only route points |

---

## Task 1: Pool Component (`LocationCard`)

**Files:**
- Create: `components/leads/LocationCard.tsx`
- Test: `tests/LocationCard.test.tsx`

- [ ] **Step 1: Create `LocationCard` component**
  Read-only row showing: status dot, inline-editable name, address, read-only rating stars (`StarRating` with `disabled=true`), "در مسیر" badge, "بدون مخصرات" badge, "تعیین موقعیت روی نقشه" button, مسیریابی button, کپی لینک اصلی button (using `CopyButton` with maps_url), کپی پیوند button (using `CopyButton` with page URL).

```tsx
// components/leads/LocationCard.tsx
import { SavedLocation } from "@/app/(shell)/leads/page";
import StarRating from "@/components/StarRating";
import CopyButton from "@/components/CopyButton";
import { Icon } from "@/components/meridian/Icon";
import { navigateUrl } from "@/lib/navApps";
import { averageScore } from "@/lib/leadScore";
import { LOCATION_STATUS_META } from "@/app/(shell)/leads/page";
import { faNum } from "@/lib/format";

export default function LocationCard({ location, inRun, onNavigate, onCopyOriginal, onCopyPage, onPin, onNameChange }: LocationCardProps) {
  const avg = averageScore(location);
  const statusLabel = location.status ? LOCATION_STATUS_META[location.status] : "بدون وضعیت";
  const statusColor = location.status === "contacted" ? "bg-green-500" : location.status === "visited" ? "bg-blue-500" : location.status === "no_answer" ? "bg-red-500" : location.status === "declined" ? "bg-gray-500" : "bg-gray-400";

  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-surface p-3">
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <input
              type="text"
              defaultValue={location.name}
              onBlur={(e) => onNameChange?.(e.target.value)}
              className="bg-transparent text-text font-medium text-[length:var(--text-sm)] outline-none border-b border-transparent focus:border-accent"
            />
            {inRun && <span className="shrink-0 rounded px-1.5 py-0.5 text-[length:var(--text-xs)] bg-accent/15 text-accent">در مسیر</span>}
            {location.lat === null && <span className="shrink-0 rounded px-1.5 py-0.5 text-[length:var(--text-xs)] bg-border text-text-faint">بدون مخصرات</span>}
          </div>
          <p className="text-[length:var(--text-xs)] text-text-faint mt-0.5">{location.address}</p>
          <div className="mt-1 flex items-center gap-3">
            <StarRating value={avg} onChange={() => {}} disabled />
            <span className="text-[length:var(--text-xs)] text-text-faint">{statusLabel}</span>
            {avg !== null && <span className="font-mono text-[length:var(--text-xs)] text-warn">{faNum(avg.toFixed(1))}</span>}
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button onClick={() => window.open(navigateUrl(navAppId, { lat: location.lat, lng: location.lng }, location.name), "_blank")} className="rounded px-2 py-1 text-[length:var(--text-xs)] border border-border text-text-faint hover:border-accent hover:text-accent">مسیریابی</button>
        <CopyButton value={location.maps_url} what="کپی لینک اصلی" />
        <CopyButton value={() => window.location.href} what="کپی پیوند" />
        <button onClick={onPin} className="rounded px-2 py-1 text-[length:var(--text-xs)] border border-border text-text-faint hover:border-accent hover:text-accent">📌</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create test file**
  Verify: renders status dot correctly, renders read-only stars, renders badges, renders all 3 buttons, inline name edit works.

```tsx
// tests/LocationCard.test.tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import LocationCard from "@/components/leads/LocationCard";

describe("LocationCard", () => {
  it("renders status dot color based on status", () => { /* ... */ });
  it("renders read-only star rating", () => { /* ... */ });
  it("renders در مسیر badge when inRun", () => { /* ... */ });
  it("renders بدون مخصرات badge when no coordinates", () => { /* ... */ });
  it("renders all action buttons", () => { /* ... */ });
});
```

- [ ] **Step 3: Commit**
  `git add components/leads/LocationCard.tsx tests/LocationCard.test.tsx && git commit -m "feat(leads): add LocationCard read-only pool component"`

---

## Task 2: Day Group Card Component (`DayGroupCard`)

**Files:**
- Create: `components/leads/DayGroupCard.tsx`
- Test: `tests/DayGroupCard.test.tsx`

- [ ] **Step 1: Create `DayGroupCard` component**
  Shows day number, stop count, total km, progress bar, expandable stop list. Each stop is tappable to open tap-flow. Uses existing `RunPanel` patterns for stop display.

```tsx
// components/leads/DayGroupCard.tsx
interface DayGroup {
  title: string;
  stops: RunStop[];
  totalKm: number | null;
  completed: number;
  total: number;
}

export default function DayGroupCard({ day, onTapFlow, onNavigate }: DayGroupCardProps) {
  const progress = day.total > 0 ? day.completed / day.total : 0;

  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-surface overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-surface-raised border-b border-border">
        <h3 className="font-medium text-text text-[length:var(--text-sm)]">{day.title}</h3>
        <span className="font-mono text-[length:var(--text-xs)] text-text-faint">
          {day.totalKm !== null ? formatDistanceKm(day.totalKm) : `${day.stops.length} stops`}
        </span>
      </div>
      <div className="px-4 py-2">
        <div className="h-1.5 w-full rounded-full bg-border overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="text-[length:var(--text-xs)] text-text-faint mt-1">
          {day.completed}/{day.total} توقف تمام شد
        </p>
      </div>
      <ol className="divide-y divide-border">
        {day.stops.map((stop, i) => (
          <li key={stop.id} className="flex items-center gap-2 px-4 py-2 hover:bg-surface-raised cursor-pointer" onClick={() => onTapFlow(stop.id)}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 font-mono text-[length:var(--text-xs)] text-accent">{i + 1}</span>
            <span className="flex-1 text-text text-[length:var(--text-sm)]">{stop.name}</span>
            <button onClick={(e) => { e.stopPropagation(); onNavigate(stop); }} className="shrink-0 text-text-faint hover:text-accent"><Icon name="external-link" size="sm" /></button>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: Create test**
  Verify: progress bar width, stop count, expand/collapse, tap-flow trigger.

- [ ] **Step 3: Commit**

---

## Task 3: LocationTapFlow Component

**Files:**
- Create: `components/leads/LocationTapFlow.tsx`
- Test: `tests/LocationTapFlow.test.tsx`

- [ ] **Step 1: Create `LocationTapFlow`**
  Mirrors `components/crm/AfterCallFlow.tsx` pattern. Fetches context via `GET /api/leads/locations/[id]/visit`, owns `FlowState`, calls `TapFlow` with `config={leadVisitFlow}`. On save shows summary + 5s undo. On `handoff_sales` shows "وکالت کار به فروشنده" button.

```tsx
// components/leads/LocationTapFlow.tsx
"use client";

import { useState, useCallback } from "react";
import TapFlow from "@/components/tapflow/TapFlow";
import { leadVisitFlow } from "@/lib/crm/flows/leadVisit";
import { useFlowState } from "@/lib/crm/flows/machine";
import { fetchOsrmTable, haversineMatrix } from "@/lib/routing/matrix";
import { startFlow, viewStep } from "@/lib/crm/flows/machine";
import type { FlowState } from "@/lib/crm/flows/types";

export default function LocationTapFlow({ locationId, open, onClose }: LocationTapFlowProps) {
  const [ctx, setCtx] = useState<FlowContext | null>(null);
  const [state, setState] = useFlowState(() => startFlow(leadVisitFlow, ctx!));

  // Fetch context on mount
  useEffect(() => {
    if (!open) return;
    fetch(`/api/leads/locations/${locationId}/visit`)
      .then((r) => r.json())
      .then((data) => setCtx(data.ctx));
  }, [open, locationId]);

  const submit = useCallback((optionId: string, value?: string) => {
    const next = answerStep(leadVisitFlow, ctx!, state, optionId, value);
    setState(next);
    if (next.saved) {
      // Show undo toast
    }
  }, [ctx, state]);

  if (!ctx || !open) return null;

  return (
    <TapFlow
      open={open}
      title={location.name}
      config={leadVisitFlow}
      ctx={ctx}
      state={state}
      onState={setState}
      onSaved={(s) => { /* show toast */ }}
      onClose={onClose}
      renderCustom={(api) => <StarRatingStep api={api} />}
    />
  );
}
```

- [ ] **Step 2: Create test**
  Verify: opens tap-flow, submits answers, shows undo toast, handles handoff_sales.

- [ ] **Step 3: Commit**

---

## Task 4: OSRM Integration into Leads Page

**Files:**
- Modify: `app/(shell)/leads/page.tsx`
- Modify: `lib/geo.ts`

- [ ] **Step 1: Increase RESORT_THRESHOLD_KM from 0.05 to 0.1**
  In `lib/geo.ts`, change the constant that prevents GPS jitter re-sorting.

```ts
// lib/geo.ts — increase threshold
export const RESORT_THRESHOLD_KM = 0.1; // was 0.05
```

- [ ] **Step 2: Add `twoOptOrder` with custom distance function**
  Modify `lib/geo.ts` to accept optional distance function.

```ts
export function twoOptOrder<T extends LatLng>(
  stops: T[], origin: LatLng | null, returnToOrigin: boolean,
  distanceFn?: (a: LatLng, b: LatLng) => number
): T[] {
  const dist = distanceFn ?? distanceKm;
  // ... rest of function uses `dist` instead of `distanceKm`
}
```

- [ ] **Step 3: Import OSRM in leads page**
  In `app/(shell)/leads/page.tsx`, add imports:

```ts
import { fetchOsrmTable, haversineMatrix } from "@/lib/routing/matrix";
```

- [ ] **Step 4: Add OSRM matrix fetch before clustering**
  Before calling `clusterIntoDays`, fetch road-distance matrix:

```ts
const routablePoints = routable.map((l) => ({ lat: l.lat, lng: l.lng }));
const osrmMatrix = await fetchOsrmTable(routablePoints);
const roadDistances = osrmMatrix?.distances_km ?? haversineMatrix(routablePoints);
```

- [ ] **Step 5: Pass road distances to clustering and optimization**
  Modify `clusterIntoDays` call to use road distances. Apply `twoOptOrder` with road distances within each day group.

- [ ] **Step 6: Commit**

---

## Task 5: Sorting Improvements

**Files:**
- Modify: `app/(shell)/leads/page.tsx`
- Modify: `lib/geo.ts`

- [ ] **Step 1: Add `route` sort mode**
  Locations in current run sorted by route order first, then remaining by nearest.

```ts
function sortByRoute(locations: SavedLocation[], runIds: number[], sortAnchor: LatLng | null) {
  const inRun = locations.filter((l) => runIds.includes(l.id));
  const notInRun = locations.filter((l) => !runIds.includes(l.id));
  inRun.sort((a, b) => runIds.indexOf(a.id) - runIds.indexOf(b.id));
  notInRun.sort((a, b) => distanceKm(a, sortAnchor) - distanceKm(b, sortAnchor));
  return [...inRun, ...notInRun];
}
```

- [ ] **Step 2: Add `priority` sort mode**
  Composite: `(avgRating / 5) × 0.6 + recencyFactor × 0.2 + statusWeight × 0.2`.

- [ ] **Step 3: Add sort persistence to localStorage**

```ts
const [sortMode, setSortMode] = useState(() => {
  if (typeof window === "undefined") return "nearest";
  return (localStorage.getItem("leads_sort") as SortMode | null) ?? "nearest";
});
useEffect(() => { localStorage.setItem("leads_sort", sortMode); }, [sortMode]);
```

- [ ] **Step 4: Smart sort fallback when no GPS**
  When `sortAnchor` is null and `sortMode === "nearest"`, auto-switch to `status`.

- [ ] **Step 5: Commit**

---

## Task 6: Role-Based Rendering

**Files:**
- Modify: `app/(shell)/leads/page.tsx`
- Modify: `components/LeadsMap.tsx`

- [ ] **Step 1: Check session role and conditionally render**
  Add `const { session } = useSession()` or equivalent. Wrap pool and day-splitting in `{isManager && ...}`.

```tsx
const isManager = session?.role === "salesperson" || session?.role === "manager";
```

- [ ] **Step 2: Add "Next Stop" banner for driver view**
  Fixed top banner showing next upcoming stop name and ETA.

- [ ] **Step 3: Pass driver-only props to LeadsMap**
  `LeadsMap` receives `leads={isManager ? mapLeads : []}` and `runPoints={runPoints}`.

- [ ] **Step 4: Commit**

---

## Task 7: RunPanel Day Group Support

**Files:**
- Modify: `components/leads/RunPanel.tsx`
- Test: `tests/RunPanel.test.tsx`

- [ ] **Step 1: Add `DayGroup` interface**
  Extend `RunPanel` props to accept `DayGroup[]`.

```ts
export interface DayGroup {
  title: string;
  stops: RunStop[];
  totalKm: number | null;
  completed: number;
  total: number;
}
```

- [ ] **Step 2: Add progress bars per day**
  Each day card shows progress bar and completion count.

- [ ] **Step 3: Keep existing flat list support**
  If `DayGroup[]` not provided, fall back to flat `stops[]`.

- [ ] **Step 4: Commit**

---

## Task 8: Creative Features

**Files:**
- Modify: `app/(shell)/leads/page.tsx`
- Modify: `components/leads/DayGroupCard.tsx`
- Modify: `components/leads/LocationCard.tsx`

- [ ] **Step 1: Add route progress bar**
  Top of each day card shows "۲/۵ توقف‌ها تمام شد" with progress bar.

- [ ] **Step 2: Add priority glow**
  Pool rows with avg rating ≥ 4 get warm border/glow via CSS.

```css
.priority-high { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
```

- [ ] **Step 3: Add smart add buttons**
  Per-row "اضافه کن به مسیر" + pool-level "انتخاب همهٔ بی‌دیدن‌ها".

- [ ] **Step 4: Add color-coded status dots**
  CSS-based status indicators in pool rows.

- [ ] **Step 5: Add "Next Stop" banner for driver view**
  Fixed top banner showing next stop name + ETA.

- [ ] **Step 6: Add sort persistence**
  `localStorage.setItem('leads_sort', sortMode)`.

- [ ] **Step 7: Commit**

---

## Task 9: Integrate All Components into Leads Page

**Files:**
- Modify: `app/(shell)/leads/page.tsx`

- [ ] **Step 1: Replace inline pool rows with `<LocationCard>`**
  Import and render `LocationCard` for each location in the pool.

- [ ] **Step 2: Replace inline route with `<RouteSection>`**
  Import and render `RouteSection` with `DayGroupCard` components.

- [ ] **Step 3: Wire `<LocationTapFlow>`**
  Import and conditionally render `LocationTapFlow` when a stop is tapped.

- [ ] **Step 4: Wire search and sort dropdowns**
  Connect search bar and sort dropdown to the filtering/sorting logic.

- [ ] **Step 5: Verify all pieces work together**

- [ ] **Step 6: Commit**

---

## Task 10: Testing and Verification

- [ ] **Step 1: Run typecheck**
  `npx tsc --noEmit` — verify zero errors in new code.

- [ ] **Step 2: Run tests**
  `npx vitest run tests/LocationCard.test.tsx tests/DayGroupCard.test.tsx tests/LocationTapFlow.test.tsx tests/RunPanel.test.tsx`

- [ ] **Step 3: Manual verification**
  - Manager view: pool visible, day-splitting visible, route with day groups
  - Driver view: only route visible, no pool, no day-splitting
  - Tap-flow opens on stop tap
  - Sort modes work correctly
  - OSRM integration doesn't break existing sorting
  - Inline name editing saves correctly
  - Pin-on-map works

- [ ] **Step 4: Run full test suite**
  `npx vitest run` — verify no regressions.

- [ ] **Step 5: Commit**
  `git add -A && git commit -m "feat(leads): complete adaptive page redesign"`

---

## Self-Review

**Spec coverage:**
- ✅ D1 Adaptive page → Task 6
- ✅ D2 Role split → Task 6
- ✅ D3 Pool read-only + name editing + pin → Task 1, Task 9
- ✅ D4 Tap-flow on each stop → Task 3, Task 9
- ✅ D5 Day-splitting → Task 2, Task 7
- ✅ D6 Pool buttons → Task 1, Task 9
- ✅ D7 OSRM routing → Task 4
- ✅ D8 KNN segmentation → Task 4
- ✅ D9 Sort modes → Task 5
- ✅ D10 Tap-flow interaction → Task 3
- ✅ Creative features → Task 8
- ✅ Width change → Already done (max-w-3xl → max-w-4xl)

**Placeholder scan:** No TBD, TODO, or vague requirements found.

**Type consistency:** All new components use existing types (`SavedLocation`, `RunStop`, `FlowContext`, `FlowState`).

**Scope check:** Single feature area — the `/leads` page. No decomposition needed.
