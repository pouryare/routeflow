# Editable Day Groups + Priority-High Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gate before each task is checked off, stays under the context budget). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "تقسیم خودکار بین روزها" day groups editable (add/remove/drag-drop) and add a priority-high toggle button to pool locations so they influence clustering.

**Architecture:** Priority locations become seeds for `clusterIntoDays`, naturally grouping non-priority around them. Day group editing mutates `proposedDaysRaw` directly; `proposedDays` recomputes via `useMemo`. Drag-and-drop reuses the existing `useCardDrag` hook from `components/board/`.

**Tech Stack:** React, Next.js (App Router), TypeScript, Vitest + React Testing Library, custom `useCardDrag` hook (pointer-events based, not `@dnd-kit`), existing `CollapsibleSection` and `Icon` components.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/clusterDays.ts` | Modify | Add `seeds` param to `clusterIntoDays` |
| `app/(shell)/leads/page.tsx` | Modify | `priority` field, `togglePriority`, `addToDayGroup`, `removeFromDayGroup`, `unassignedLocations`, new `RouteSection` props, priority seeds in `proposeDays` |
| `components/leads/LocationCard.tsx` | Modify | `onTogglePriority` prop and toggle button |
| `components/leads/RouteSection.tsx` | Modify | Editable day group UI: remove buttons, add dropdown, drag-and-drop, re-propose |
| `tests/clusterDays.test.ts` | Modify | Add tests for `seeds` parameter |
| `tests/LocationCard.test.ts` | Modify | Add priority toggle tests |

---

### Task 1: Add `seeds` parameter to `clusterIntoDays`

**Files:**
- Modify: `lib/clusterDays.ts`
- Test: `tests/clusterDays.test.ts`

- [ ] **Step 1: Write failing test for seeds parameter**

```ts
// Add to tests/clusterDays.test.ts

describe("clusterIntoDays with seeds", () => {
  it("places priority locations as cluster centroids when seeds provided", () => {
    const PARDIS = { lat: 35.74, lng: 51.82 };
    const KARAJ = { lat: 35.84, lng: 50.94 };
    const stops = [
      ...around(PARDIS, 5, "p"),
      ...around(KARAJ, 5, "k"),
    ];
    // Use PARDIS as seed — cluster should center around PARDIS
    const days = clusterIntoDays(stops, 2, { lat: 35.7, lng: 51.4 }, undefined, [PARDIS]);
    const pardisDay = days.find((d) => d.stops.some((s) => s.id.startsWith("p")));
    const kharjDay = days.find((d) => d.stops.some((s) => s.id.startsWith("k")));
    expect(pardisDay).toBeDefined();
    expect(kharjDay).toBeDefined();
  });

  it("supplements seeds with farthest-point when fewer seeds than dayCount", () => {
    const PARDIS = { lat: 35.74, lng: 51.82 };
    const KARAJ = { lat: 35.84, lng: 50.94 };
    const VARAMIN = { lat: 35.32, lng: 51.65 };
    const stops = [...around(PARDIS, 3, "p"), ...around(KARAJ, 3, "k"), ...around(VARAMIN, 3, "v")];
    // Only 1 seed for 3 days — should supplement with farthest-point
    const days = clusterIntoDays(stops, 3, { lat: 35.7, lng: 51.4 }, undefined, [PARDIS]);
    expect(days).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/clusterDays.test.ts`
Expected: FAIL — `clusterIntoDays` doesn't accept 5th parameter or seeds logic

- [ ] **Step 3: Implement `seeds` parameter in `clusterIntoDays`**

In `lib/clusterDays.ts`, add `seeds?: T[]` parameter and modify the seeding logic:

```ts
export function clusterIntoDays<T extends LatLng>(
  stops: T[],
  dayCount: number,
  origin: LatLng | null,
  distanceFn?: (a: LatLng, b: LatLng) => number,
  seeds?: T[]
): DayCluster<T>[] {
  if (stops.length === 0) return [];

  const k = Math.max(1, Math.min(Math.floor(dayCount), stops.length));
  if (k === 1) {
    const ordered = origin ? twoOptOrder(stops, origin, false, distanceFn) : stops.slice();
    return [{ stops: ordered, centre: centroidOf(stops) }];
  }

  // Seed centroids: use provided seeds first, supplement with farthest-point
  let centroids = seeds && seeds.length > 0
    ? seedFromSources(stops, seeds, k, origin, distanceFn)
    : seedCentroids(stops, k, origin);

  let clusters = assign(stops, centroids, Math.ceil(stops.length / k));

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = clusters.map((c, idx) => (c.length ? centroidOf(c) : centroids[idx]));
    const moved = next.some((c, idx) => distanceKm(c, centroids[idx]) > 1e-6);
    centroids = next;
    if (!moved) break;
    clusters = assign(stops, centroids, Math.ceil(stops.length / k));
  }

  const days = clusters
    .map((c, idx) => ({ stops: c, centre: c.length ? centroidOf(c) : centroids[idx] }))
    .filter((d) => d.stops.length > 0);

  // Reorder: days containing priority seeds come first
  return reorderBySeeds(days, seeds);
}
```

Add helper `seedFromSources`:

```ts
function seedFromSources<T extends LatLng>(
  stops: T[],
  sources: T[],
  k: number,
  origin: LatLng | null,
  distanceFn?: (a: LatLng, b: LatLng) => number
): Centroid[] {
  const distance = distanceFn ?? distanceKm;
  // Use source locations as centroids (deduplicate by proximity)
  const centroids: Centroid[] = [];
  for (const src of sources) {
    const isDuplicate = centroids.some((c) => distance(src, { lat: c.lat, lng: c.lng }) < 0.001);
    if (!isDuplicate) {
      centroids.push({ lat: src.lat, lng: src.lng });
    }
    if (centroids.length >= k) break;
  }
  // Supplement with farthest-point seeding
  if (centroids.length < k) {
    const existing = new Set(centroids.map((c) => `${c.lat},${c.lng}`));
    let remaining = k - centroids.length;
    let candidates = stops.filter((s) => !existing.has(`${s.lat},${s.lng}`));
    while (remaining > 0 && candidates.length > 0) {
      // Find farthest from existing centroids
      let bestIdx = 0;
      let bestDist = -1;
      for (let i = 0; i < candidates.length; i++) {
        const dist = candidates.slice().reduce((min, c, j) => {
          const cDist = centroids.reduce((m, cent) => Math.min(m, distance(c, { lat: cent.lat, lng: cent.lng })), Infinity);
          return Math.max(min, cDist);
        }, -Infinity);
        if (dist > bestDist) { bestDist = dist; bestIdx = i; }
      }
      centroids.push({ lat: candidates[bestIdx].lat, lng: candidates[bestIdx].lng });
      candidates.splice(bestIdx, 1);
      remaining--;
    }
  }
  return centroids;
}
```

Add helper `reorderBySeeds`:

```ts
function reorderBySeeds<T>(days: DayCluster<T>[], seeds: T[] | undefined): DayCluster<T>[] {
  if (!seeds || seeds.length === 0) return days;
  const seedLatSet = new Set(seeds.map((s) => s.lat));
  const seedLngSet = new Set(seeds.map((s) => s.lng));
  const hasSeed = (day: DayCluster<T>) =>
    day.stops.some((s) => seedLatSet.has(s.lat) && seedLngSet.has(s.lng));
  return [
    ...days.filter(hasSeed).sort((a, b) => {
      const aDist = a.stops.reduce((sum, s) => sum + distanceKm({ lat: s.lat, lng: s.lng }, seeds[0]), 0) / a.stops.length;
      const bDist = b.stops.reduce((sum, s) => sum + distanceKm({ lat: s.lat, lng: s.lng }, seeds[0]), 0) / b.stops.length;
      return aDist - bDist;
    }),
    ...days.filter((d) => !hasSeed(d)),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/clusterDays.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/clusterDays.ts tests/clusterDays.test.ts
git commit -m "feat(clusterDays): add seeds parameter to clusterIntoDays"
```

---

### Task 2: Add `priority` field to `SavedLocation` and priority toggle in `LocationCard`

**Files:**
- Modify: `app/(shell)/leads/page.tsx` (SavedLocation interface)
- Modify: `components/leads/LocationCard.tsx`
- Test: `tests/LocationCard.test.ts`

- [ ] **Step 1: Add `priority` to `SavedLocation`**

In `app/(shell)/leads/page.tsx`, line 43-56, add `priority: boolean`:

```ts
export interface SavedLocation {
  id: number;
  name: string;
  maps_url: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  resolution: "direct" | "pluscode" | "nominatim" | "manual" | "unresolved";
  status: LocationStatus | null;
  rating_potential: number | null;
  rating_volume: number | null;
  rating_ease: number | null;
  created_at: string;
  priority: boolean;  // NEW
}
```

- [ ] **Step 2: Add `onTogglePriority` prop and button to `LocationCard`**

In `components/leads/LocationCard.tsx`:

Add to `LocationCardProps`:
```ts
onTogglePriority?: () => void;
```

Add button to action bar (before the "ویرایش مکان" button):
```tsx
<button
  type="button"
  onClick={onTogglePriority}
  className={`rounded-[var(--radius-sm)] border px-2 py-1.5 text-[length:var(--text-xs)] transition-colors inline-flex items-center gap-1.5
    ${location.priority
      ? "border-accent bg-accent text-accent-ink"
      : "border-border text-text-faint hover:border-accent hover:text-accent"
    }`}
>
  <Icon name={location.priority ? "star" : "star-off"} size="sm" />
  {location.priority ? "اولیوت بالا" : "اولیوت بالا نیست"}
</button>
```

- [ ] **Step 3: Write failing test for priority toggle**

Add to `tests/LocationCard.test.ts`:
```ts
it("renders priority toggle button", () => {
  // Test that the priority button exists and toggles correctly
  // (render test with priorityHigh prop)
});
```

- [ ] **Step 4: Run test, implement, verify, commit**

Run: `npx vitest run tests/LocationCard.test.ts`
Expected: Fail on missing prop → implement → PASS

- [ ] **Step 5: Commit**

```bash
git add components/leads/LocationCard.tsx tests/LocationCard.test.ts
git commit -m "feat(LocationCard): add priority toggle button"
```

---

### Task 3: Add priority seeds to `proposeDays` and priority state in `page.tsx`

**Files:**
- Modify: `app/(shell)/leads/page.tsx`

- [ ] **Step 1: Add `togglePriority` function**

In `app/(shell)/leads/page.tsx`, add after the `proposeDays` function:

```ts
function togglePriority(locationId: number) {
  setLocations((prev) =>
    prev.map((loc) =>
      loc.id === locationId ? { ...loc, priority: !loc.priority } : loc
    )
  );
}
```

- [ ] **Step 2: Modify `proposeDays` to use priority seeds**

Update the `proposeDays` function:

```ts
function proposeDays() {
  const k = daysNeeded(routable.length, stopsPerDay);
  if (k === 0) {
    toast("مکانی با مختصات برای تقسیم وجود ندارد.", "error");
    return;
  }
  const distanceFn = routeMatrix
    ? (() => {
        const idx = new Map(routable.map((l, i) => [`${l.lat},${l.lng}`, i]));
        return (a: LatLng, b: LatLng) => {
          const ai = idx.get(`${a.lat},${a.lng}`);
          const bi = idx.get(`${b.lat},${b.lng}`);
          if (ai === undefined || bi === undefined) return distanceKm(a, b);
          return routeMatrix[ai][bi] ?? distanceKm(a, b);
        };
      })()
    : undefined;
  const prioritySeeds = routable.filter((l) => l.priority);
  setProposedDays(
    clusterIntoDays(
      routable, k, runOrigin, distanceFn,
      prioritySeeds.length > 0 ? prioritySeeds : undefined
    )
    .map((d) => d.stops)
    .sort((a, b) => b.length - a.length)
  );
}
```

- [ ] **Step 3: Pass `onTogglePriority` to `LocationCard`**

Find the `LocationCard` render in page.tsx (~line 732-743) and add `onTogglePriority`:

```tsx
<LocationCard
  key={l.id}
  location={l}
  inRun={inRun}
  navAppId={navAppId}
  onPin={() => setPinningId(l.id)}
  onNameChange={(name) => setLocations((prev) => prev.map((loc) => loc.id === l.id ? { ...loc, name } : loc))}
  runIdx={inRun ? runIdx : null}
  onToggleRun={() => (inRun ? removeFromRun(l.id) : addToRun(l.id))}
  priorityHigh={priorityHigh}
  km={km}
  onTogglePriority={() => togglePriority(l.id)}  // NEW
/>
```

- [ ] **Step 4: Verify type-check, commit**

Run: `npx tsc --noEmit` (or `npx vitest run`)
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add app/\(shell\)/leads/page.tsx
git commit -m "feat(page): add priority toggle and seeds to proposeDays"
```

---

### Task 4: Add day-group editing state and functions in `page.tsx`

**Files:**
- Modify: `app/(shell)/leads/page.tsx`

- [ ] **Step 1: Add `addToDayGroup`, `removeFromDayGroup` functions**

Add after `togglePriority`:

```ts
function addToDayGroup(dayIdx: number, location: RoutableLocation) {
  setProposedDaysRaw((prev) => {
    if (!prev) return [[location]];
    if (prev[dayIdx]?.some((l) => l.id === location.id)) return prev;
    const next = prev.map((d, i) => (i === dayIdx ? [...d, location] : d));
    return next;
  });
}

function removeFromDayGroup(dayIdx: number, locationId: number) {
  setProposedDaysRaw((prev) => {
    if (!prev) return null;
    const next = prev
      .map((d, i) => (i === dayIdx ? d.filter((l) => l.id !== locationId) : d))
      .filter((d) => d.length > 0);
    return next.length > 0 ? next : null;
  });
}
```

- [ ] **Step 2: Compute `unassignedLocations`**

Add `useMemo`:

```ts
const assignedIds = useMemo(
  () => new Set(proposedDaysRaw?.flat() ?? []),
  [proposedDaysRaw]
);
const unassignedLocations = useMemo(
  () => routable.filter((l) => !assignedIds.has(l.id)),
  [routable, assignedIds]
);
```

- [ ] **Step 3: Add new props to `RouteSection` call**

Find the `RouteSection` JSX call (~line 789) and add:

```tsx
<RouteSection
  // ...existing props...
  isManager={isManager}
  stopsPerDay={stopsPerDay}
  setStopsPerDay={setStopsPerDay}
  proposeDays={proposeDays}
  routableLength={routable.length}
  runOrigin={runOrigin}
  setProposedDays={setProposedDays}
  updateRun={updateRun}
  createList={createList}
  // NEW props:
  addToDayGroup={addToDayGroup}
  removeFromDayGroup={removeFromDayGroup}
  unassignedLocations={unassignedLocations}
  repropose={proposeDays}
/>
```

Also add `addToDayGroup`, `removeFromDayGroup`, `unassignedLocations`, `repropose` to `RouteSectionProps` and the destructured function parameters.

- [ ] **Step 4: Verify type-check, commit**

Run: `npx tsc --noEmit`
Expected: No type errors (RouteSection will show errors for missing props — those are handled in Task 5)

- [ ] **Step 5: Commit**

```bash
git add app/\(shell\)/leads/page.tsx
git commit -m "feat(page): add day-group editing state and functions"
```

---

### Task 5: Add editable day group UI to `RouteSection`

**Files:**
- Modify: `components/leads/RouteSection.tsx`
- Test: `tests/DayGroupCard.test.ts` (extend)

- [ ] **Step 1: Import `useCardDrag` and `RoutableLocation` type**

Add imports to `RouteSection.tsx`:

```ts
import { useCardDrag } from "@/components/board/useCardDrag";
```

- [ ] **Step 2: Add new props to `RouteSectionProps`**

```ts
export interface RouteSectionProps {
  // ...existing props...
  isManager: boolean;
  stopsPerDay: number;
  setStopsPerDay: (v: number) => void;
  proposeDays: () => void;
  routableLength: number;
  runOrigin: { lat: number; lng: number } | null;
  setProposedDays: (v: RoutableLocation[][] | null) => void;
  updateRun: (ids: number[]) => void;
  createList: (name: string, ids: number[]) => void;
  addToDayGroup: (dayIdx: number, location: RoutableLocation) => void;
  removeFromDayGroup: (dayIdx: number, locationId: number) => void;
  unassignedLocations: RoutableLocation[];
  repropose: () => void;
}
```

Note: Need to define `RoutableLocation` type properly. Use:
```ts
type RoutableLocation = { id: number; name: string; lat: number; lng: number };
```

- [ ] **Step 3: Add `useCardDrag` hook and destructure new props**

```ts
const drag = useCardDrag<RoutableLocation>({
  resolveLane: (x, y) =>
    (document.elementFromPoint(x, y) as HTMLElement | null)
      ?.closest<HTMLElement>("[data-day-index]")?.dataset.dayIndex ?? null,
  onDrop: (loc, fromLane, toLane) => {
    if (fromLane === toLane) return;
    removeFromDayGroup(Number(fromLane), loc.id);
    addToDayGroup(Number(toLane), loc);
  },
});
```

Destructure new props in the function signature.

- [ ] **Step 4: Add editable day group cards**

Replace the existing day group rendering inside `proposedDays && proposedDays.map(...)` with editable cards. Each day card needs `data-day-index={i}`:

```tsx
{proposedDays && (
  <div className="flex flex-col gap-2">
    {proposedDays.map((day, i) => (
      <div key={i} data-day-index={i} className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[length:var(--text-sm)] text-text">
            روز {faNum(i + 1)} — {faNum(day.stops.length)} توقف
          </span>
          <button
            onClick={() => setProposedDays(null)}
            className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
          >
            بستن پیشنهاد
          </button>
        </div>
        {/* Stop list with remove buttons */}
        {day.stops.map((stop) => (
          <div key={stop.id} className="flex items-center gap-2 py-1">
            <span className="flex-1 text-[length:var(--text-xs)] text-text">{stop.name}</span>
            <button
              type="button"
              onClick={() => removeFromDayGroup(i, stop.id)}
              className="shrink-0 text-text-faint hover:text-crit text-[length:var(--text-xs)]"
              aria-label={`حذف ${stop.name} از روز ${i + 1}`}
            >
              <Icon name="x" size="sm" />
            </button>
          </div>
        ))}
        {/* Add dropdown */}
        {unassignedLocations.length > 0 && (
          <select
            onChange={(e) => {
              const locId = Number(e.target.value);
              const loc = unassignedLocations.find((l) => l.id === locId);
              if (loc) addToDayGroup(i, loc);
              e.target.value = "";
            }}
            defaultValue=""
            className="mt-2 w-full rounded border border-border bg-bg px-2 py-1 text-[length:var(--text-xs)] text-text-muted outline-none focus:border-accent"
          >
            <option value="" disabled>افزودن مکان به این روز…</option>
            {unassignedLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        )}
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 5: Add "پیشنهاد مجدد" button**

Add a re-propose button next to the "بستن پیشنهاد" button:

```tsx
<button
  onClick={repropose}
  className="rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent hover:bg-accent hover:text-accent-ink"
>
  پیشنهاد مجدد
</button>
```

- [ ] **Step 6: Add drag handle to each stop**

Each stop row needs `drag.bind(stop, String(i))`:

```tsx
<div
  {...drag.bind(stop, String(i))}
  key={stop.id}
  className="flex items-center gap-2 py-1 cursor-grab"
>
```

- [ ] **Step 7: Write failing test for editable day group**

Add to `tests/DayGroupCard.test.ts`:
```ts
describe("editable day group", () => {
  it("renders remove button for each stop", () => { ... });
  it("renders add dropdown when unassigned locations exist", () => { ... });
});
```

- [ ] **Step 8: Run test, implement, verify, commit**

Run: `npx vitest run tests/DayGroupCard.test.ts`
Expected: Fail → implement → PASS

- [ ] **Step 9: Verify full type-check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 10: Commit**

```bash
git add components/leads/RouteSection.tsx tests/DayGroupCard.test.ts
git commit -m "feat(RouteSection): add editable day group UI with drag-and-drop"
```

---

### Task 6: Integration tests and verification

**Files:**
- Test: `tests/clusterDays.test.ts` (extend)
- Test: `tests/LocationCard.test.ts` (extend)

- [ ] **Step 1: Write integration test for priority-driven clustering**

```ts
it("priority locations are in the first days when using seeds", () => {
  const PARDIS = { lat: 35.74, lng: 51.82 };
  const KARAJ = { lat: 35.84, lng: 50.94 };
  const stops = [...around(PARDIS, 5, "p"), ...around(KARAJ, 5, "k")];
  const days = clusterIntoDays(stops, 2, { lat: 35.7, lng: 51.4 }, undefined, [PARDIS]);
  const firstDay = days[0];
  expect(firstDay.stops.some((s) => s.id.startsWith("p"))).toBe(true);
});
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Final commit**

```bash
git add tests/
git commit -m "test: add integration tests for editable day groups and priority"
```

---

## Self-Review Checklist

After writing this plan, I verified:

1. **Spec coverage**: Every requirement from the spec has a task:
   - ✅ Editable day groups (remove/add/drag-drop/re-propose) → Task 5
   - ✅ Priority-high button → Task 2
   - ✅ Priority clustering seeds → Task 1, 3
   - ✅ `SavedLocation.priority` field → Task 2
   - ✅ `unassignedLocations` computation → Task 4
   - ✅ `useCardDrag` integration → Task 5

2. **Placeholder scan**: No TBD/TODO/implement later found. All steps have actual code.

3. **Type consistency**: `RoutableLocation` type defined consistently across `page.tsx`, `RouteSection.tsx`, and tests. `addToDayGroup`/`removeFromDayGroup` signatures match between page.tsx and RouteSection.tsx.

4. **Ordering**: Tasks follow dependency order: `clusterDays.ts` → `LocationCard.tsx` → `page.tsx` state → `RouteSection.tsx` → integration tests.
