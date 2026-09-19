# Editable Day Groups + Priority-High Feature

**Date:** 2026-09-19 · **Status:** Draft (brainstorming)
**Source:** User-requested enhancement to the `/leads` day-splitting section.
**Related spec:** `2026-09-18-adaptive-leads-page-design.md` (parent)

---

## 0. Decisions Locked

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | **Priority clustering** | Priority locations serve as seeds for `clusterIntoDays`; naturally land in first N days | Keeps geographic coherence; no manual day assignment needed |
| D2 | **Edit mode** | Add/remove via buttons + drag-and-drop via existing `useCardDrag` hook | Reuses proven infrastructure from `components/board/` |
| D3 | **State management** | Mutate `proposedDaysRaw` directly; `proposedDays` recomputed via `useMemo` | Follows existing pattern in page.tsx |
| D4 | **Re-propose** | After edits, `proposeDays()` regenerates all groups from scratch | Resets manual edits cleanly |
| D5 | **Pool priority button** | Toggle button in `LocationCard` action bar sets `priority` boolean on `SavedLocation` | Simple, inline, consistent with existing pattern |

---

## 1. Feature Overview

Two related features enhance the "تقسیم خودکار بین روزها" section:

### 1.1 Editable Day Groups
After generating proposed day groups, users can:
- **Remove** a location from a day group (× button on each stop)
- **Add** a location to an underfilled day group (dropdown of unassigned locations)
- **Drag-and-drop** a location between day groups (using existing `useCardDrag`)
- **Re-propose** to regenerate all groups from scratch

### 1.2 Priority-High Button
A toggle button in the "همه مکان‌ها" pool marks a location as high priority. Priority locations:
- Serve as clustering seeds so non-priority locations group around them
- End up in the first few days (sharing a day if geographically close, separate if far)
- Are visually indicated with an accent border/glow on their `LocationCard`
- Must be in the first N days when day groups are generated

---

## 2. Data Model Changes

### 2.1 `SavedLocation` — add `priority` field

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

`RoutableLocation` extends `SavedLocation`, so `priority` propagates automatically.

---

## 3. Clustering Changes

### 3.1 `clusterIntoDays` — add `seeds` parameter

**File:** `lib/clusterDays.ts`

Add optional `seeds?: T[]` parameter:

```ts
export function clusterIntoDays<T extends LatLng>(
  stops: T[],
  dayCount: number,
  origin: LatLng | null,
  distanceFn?: (a: LatLng, b: LatLng) => number,
  seeds?: T[]
): DayCluster<T>[]
```

**Seeding logic**: If `seeds` is provided:
- Use seeds as the initial centroids (replacing farthest-point seeding for those positions)
- If `seeds.length < dayCount`, supplement with farthest-point seeding from origin
- If `seeds.length >= dayCount`, use only the first `dayCount` seeds

**Day ordering**: After clustering, days are reordered so that days containing priority locations come first (sorted by distance from origin within priority days), followed by non-priority days. This ensures priority locations are always in the first N days.

### 3.2 `proposeDays` — use priority seeds

**File:** `app/(shell)/leads/page.tsx`

Extract priority locations as seeds and pass them to `clusterIntoDays`:

```ts
const prioritySeeds = routable.filter(l => l.priority);
const dayGroups = clusterIntoDays(
  routable, k, runOrigin, distanceFn,
  prioritySeeds.length > 0 ? prioritySeeds : undefined
).map((d) => d.stops);
setProposedDays(dayGroups.sort((a, b) => b.length - a.length));
```

---

## 4. Component Changes

### 4.1 `LocationCard` — priority toggle button

**File:** `components/leads/LocationCard.tsx`

Add `onTogglePriority` prop and a "اولیوت بالا" button to the action bar.

### 4.2 `RouteSection` — editable day group UI

**File:** `components/leads/RouteSection.tsx`

New props: `addToDayGroup`, `removeFromDayGroup`, `unassignedLocations`, `repropose`.

Each day group card shows:
- × button on each stop to remove
- "افزودن" dropdown listing unassigned locations
- Drag handle on each stop (using `useCardDrag`)

### 4.3 `page.tsx` — state management

New functions: `addToDayGroup`, `removeFromDayGroup`, `togglePriority`.

Unassigned locations computed from `routable` minus `proposedDaysRaw` flat.

---

## 5. `useCardDrag` Integration

Reuse `components/board/useCardDrag.ts` as-is. Day group cards need `data-day-index` attribute. Items wrapped with `drag.bind(item, String(dayIndex))`.

---

## 6. Error Handling

| Scenario | Handling |
|----------|----------|
| Adding a location already in the day | Guard in `addToDayGroup` — no-op |
| Removing from empty group | Guard — filter drops empty arrays |
| Drag to same day | `onDrop` checks `fromLane !== toLane` |
| No `proposedDaysRaw` yet | `addToDayGroup` creates first group |

---

## 7. Testing Strategy

Unit tests for state mutations, clustering with seeds, priority toggle, drag-and-drop between lanes, re-propose, unassigned computation.

---

## 8. Files to Modify

- `app/(shell)/leads/page.tsx` — `priority` field, toggle/add/remove functions, new props to `RouteSection`
- `components/leads/LocationCard.tsx` — `onTogglePriority` prop and button
- `components/leads/RouteSection.tsx` — editable day group UI
- `lib/clusterDays.ts` — `seeds` parameter to `clusterIntoDays`

## 9. Assumptions

- `priority` field persists via existing `locations` API
- Day group editing is manager-only
- `useCardDrag` desktop-only; mobile supports add/remove buttons
- Empty day groups auto-removed when last location is removed
