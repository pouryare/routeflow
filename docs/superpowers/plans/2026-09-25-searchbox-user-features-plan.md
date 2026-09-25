# SearchBox User-Facing Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gate before each task is checked off). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recent searches, saved favorites, and a one-tap "my location" button to SearchBox — all client-side, no new API.

**Architecture:** Two new `localStorage` keys (`searchbox_recent`, `searchbox_favorites`). New internal state + helpers in SearchBox. New dropdown sections render when input is empty. My-location button uses browser Geolocation API. Responsive touch targets via CSS media query.

**Tech Stack:** React (useState, useEffect), localStorage, browser Geolocation API, Tailwind CSS, Vitest

---
---

### Task 1: Recent Searches — localStorage helpers

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Add helper functions at the top of the file (after `getGeoProvider`)**

```ts
const RECENT_KEY = "searchbox_recent";
const MAX_RECENT = 10;

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}

function saveRecent(queries: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(queries)); } catch { /* storage full */ }
}

function pushRecent(query: string) {
  const q = query.trim();
  if (!q) return;
---

### Task 2: Recent Searches — state & save on search

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Add `recentSearches` state next to existing state (after line 129)**

```ts
const [recentSearches, setRecentSearches] = useState<string[]>(loadRecent);
```

- [ ] **Step 2: Call `pushRecent(trimmed)` inside `select`, `goToCoords`, `decodeLink`, `selectGeoResult` — right before `reset()`**

In `select(r)`:
```ts
function select(r: Result) {
  if (r.kind === "customer") onSelectCustomer?.(r.customer);
  else onSelectDistrict?.(r.district);
  if (trimmed) pushRecent(trimmed);
  reset();
}
```

In `goToCoords()`:
```ts
function goToCoords() {
  if (!coordMatch) return;
  onLocationFound?.(Number(coordMatch[1]), Number(coordMatch[2]), "مختصات وارد شده");
  if (trimmed) pushRecent(trimmed);
  reset();
}
```

In `decodeLink()`, after success (before `reset()`):
```ts
if (trimmed) pushRecent(trimmed);
```

---

### Task 3: Recent Searches — dropdown UI when empty

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Add recent-searches section inside the dropdown panel, before the results section (after the filter strip)**

Find the `{open && (` block and add right after the filter strip div, before the results conditional:

```tsx
{!trimmed && recentSearches.length > 0 && (
  <div className="border-b border-border px-3 py-2">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[length:var(--text-xs)] text-text-faint font-medium">🕐 Recent</span>
      <button onClick={() => { clearAllRecent(); setRecentSearches([]); }} className="text-[length:var(--text-xs)] text-accent hover:underline">Clear all</button>
    </div>
    {recentSearches.map((r, i) => (
      <button key={i} onClick={() => { changeQuery(r); setOpen(true); }} className="mapsearch__opt">
---

### Task 4: Favorites — type & localStorage helpers

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Add Favorite type and helpers after the recent-searches helpers**

```ts
interface Favorite {
  id: string;
  label: string;
  lat: number;
  lng: number;
  kind: "customer" | "district" | "geo";
}

const FAV_KEY = "searchbox_favorites";

function loadFavorites(): Favorite[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; }
}

function saveFavorites(favs: Favorite[]) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch { /* storage full */ }
}

function addFavorite(fav: Favorite) {
---

### Task 5: Favorites — star toggle on result rows

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Add `favorites` state next to `recentSearches`**

```ts
const [favorites, setFavorites] = useState<Favorite[]>(loadFavorites);
```

- [ ] **Step 2: Add `toggleFavorite` handler**

```ts
function toggleFavorite(r: Result) {
  const id = r.kind === "customer" ? `cust_${r.customer.customer_code}` : r.kind === "district" ? `dist_${r.district.properties.name}` : `geo_${r.label}`;
  if (isFavorite(id)) {
    removeFavorite(id);
  } else {
    addFavorite({ id, label: r.kind === "customer" ? r.customer.business_name : r.kind === "district" ? r.district.properties.name : r.label, lat: 0, lng: 0, kind: r.kind });
  }
  setFavorites(loadFavorites());
}
```

---

### Task 6: Favorites — ★ section in dropdown when empty

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Add favorites section inside the dropdown, right after the recent-searches section**

```tsx
{!trimmed && favorites.length > 0 && (
  <div className="border-b border-border px-3 py-2">
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-[length:var(--text-xs)] text-text-faint font-medium">★ Favorites</span>
      <button onClick={() => { localStorage.removeItem(FAV_KEY); setFavorites([]); }} className="text-[length:var(--text-xs)] text-accent hover:underline">Clear all</button>
    </div>
    {favorites.map((f) => (
      <button key={f.id} onClick={() => { changeQuery(f.label); setOpen(true); }} className="mapsearch__opt">
        <Icon name="star" size="sm" />
        <span className="mapsearch__label">{f.label}</span>
        <button onClick={(e) => { e.stopPropagation(); removeFavorite(f.id); setFavorites(loadFavorites()); }} className="text-text-faint hover:text-crit text-[length:var(--text-xs)]" aria-label="remove favorite">✕</button>
---

### Task 7: "📍 My Location" button

**Files:**
- Modify: `components/SearchBox.tsx`

- [ ] **Step 1: Add `useMyLocation` handler**

```ts
function useMyLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (trimmed) pushRecent(trimmed);
      onLocationFound?.(pos.coords.latitude, pos.coords.longitude, "موقعیت من");
      reset();
    },
    () => { /* silent fallback — drivers shouldn't be blocked */ }
  );
---

### Task 8: Responsive touch targets (mobile only)

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add responsive min-height for `.mapsearch__opt`**

Append after line 2854 in `app/globals.css`:

```css
---

### Task 9: Update docs/searchbox.md

**Files:**
- Modify: `docs/searchbox.md`

- [ ] **Step 1: Add a "User Features" section at the end of the file**

```md
---

## User Features

### Recent Searches
- Shown as a `🕐 Recent` section at the top of the dropdown when the input is empty
- Tap any entry to re-run that search
- `✕` removes a single entry; "Clear all" removes all
- Persisted in `localStorage`, capped at 10 (LRU eviction)

### Favorites
- Tap the ★ icon on any result row to save it
---

### Task 10: Tests

**Files:**
- Modify: `tests/SearchBoxFilters.test.ts`

- [ ] **Step 1: Export helpers from SearchBox for testing**

Add to `components/SearchBox.tsx` exports:

```ts
export { loadRecent, pushRecent, removeRecent, clearAllRecent, loadFavorites, addFavorite, removeFavorite, isFavorite };
```

- [ ] **Step 2: Add tests to `tests/SearchBoxFilters.test.ts`**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { loadRecent, pushRecent, removeRecent, clearAllRecent } from "@/components/SearchBox";
import { loadFavorites, addFavorite, removeFavorite } from "@/components/SearchBox";

describe("recent searches", () => {
  beforeEach(() => { localStorage.clear(); });

  it("starts empty", () => {
    expect(loadRecent()).toEqual([]);
  });

  it("saves and loads", () => {
    pushRecent("تهران");
    expect(loadRecent()).toEqual(["تهران"]);
  });

  it("deduplicates — moves existing to top", () => {
    pushRecent("تهران");
    pushRecent("مشهد");
    pushRecent("تهران");
    expect(loadRecent()).toEqual(["تهران", "مشهد"]);
  });

  it("caps at 10", () => {
    for (let i = 0; i < 12; i++) pushRecent(`query${i}`);
    expect(loadRecent().length).toBe(10);
  });

  it("removes individual entry", () => {
    pushRecent("تهران");
    pushRecent("مشهد");
    removeRecent("تهران");
    expect(loadRecent()).toEqual(["مشهد"]);
  });

  it("clear all removes everything", () => {
    pushRecent("تهران");
    clearAllRecent();
    expect(loadRecent()).toEqual([]);
  });
});

describe("favorites", () => {
  beforeEach(() => { localStorage.clear(); });

  it("starts empty", () => {
    expect(loadFavorites()).toEqual([]);
  });

  it("adds and loads", () => {
    addFavorite({ id: "cust_123", label: "حسن", lat: 0, lng: 0, kind: "customer" });
    expect(loadFavorites().length).toBe(1);
  });

  it("removes by id", () => {
    addFavorite({ id: "cust_123", label: "حسن", lat: 0, lng: 0, kind: "customer" });
    removeFavorite("cust_123");
    expect(loadFavorites()).toEqual([]);
  });

  it("deduplicates same id", () => {
    addFavorite({ id: "cust_123", label: "حسن", lat: 0, lng: 0, kind: "customer" });
    addFavorite({ id: "cust_123", label: "علی", lat: 0, lng: 0, kind: "customer" });
    expect(loadFavorites().length).toBe(1);
    expect(loadFavorites()[0].label).toBe("علی");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/SearchBoxFilters.test.ts
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/SearchBoxFilters.test.ts components/SearchBox.tsx
git commit -m "test(search): add recent-searches and favorites tests"
```
- Saved favorites appear in a `★ Favorites` section when the input is empty
- Tap a favorite to load it; `✕` removes it
- Persisted in `localStorage`

### My Location
- 📍 button appears in the filter strip when no position anchor is set
- One-tap: uses browser Geolocation → centers map on current position
- Silently ignores geolocation denial (no error popup)

### Touch Targets (Mobile)
- All dropdown rows are minimum 44×44px on screens under 768px
- Desktop layout unchanged
```

- [ ] **Step 2: Commit**

```bash
git add docs/searchbox.md
git commit -m "docs: update searchbox.md with user features"
```
@media (max-width: 767px) {
  .meridian .mapsearch__opt { min-height: 44px; }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/globals.css
git commit -m "feat(search): responsive touch targets on mobile"
```
}
```

- [ ] **Step 2: Add the button in the filter strip, next to the position indicator**

Find the position indicator section in the filter strip and add:

```tsx
{!sortAnchor && (
  <button onClick={useMyLocation} className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent transition-colors" title="Show my location">
    <Icon name="locate" size="sm" />
  </button>
)}
```

- [ ] **Step 3: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): add my-location button in filter strip"
```
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): render favorites section in dropdown"
```
- [ ] **Step 3: Add star button to each result row in the results section**

In the `results.map` block, add a star button at the end of each row:

```tsx
<button onClick={(e) => { e.stopPropagation(); toggleFavorite(r); }} className="shrink-0 text-[length:var(--text-xs)] text-text-faint hover:text-accent" aria-label="save favorite">
  {isFavorite(id) ? "★" : "☆"}
</button>
```

For customers, the `id` is `cust_${r.customer.customer_code}`. For districts, `dist_${r.district.properties.name}`.

- [ ] **Step 4: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): add star toggle to result rows"
```
  const favs = loadFavorites().filter((f) => f.id !== fav.id);
  favs.unshift(fav);
  saveFavorites(favs);
}

function removeFavorite(id: string) {
  saveFavorites(loadFavorites().filter((f) => f.id !== id));
}

function isFavorite(id: string): boolean {
  return loadFavorites().some((f) => f.id === id);
}
```

- [ ] **Step 2: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): add favorites localStorage helpers"
```
        <Icon name="clock" size="sm" />
        <span className="mapsearch__label">{r}</span>
        <button onClick={(e) => { e.stopPropagation(); removeRecent(r); setRecentSearches(loadRecent()); }} className="text-text-faint hover:text-crit text-[length:var(--text-xs)]" aria-label="remove recent">✕</button>
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): render recent-searches section in dropdown"
```
In `selectGeoResult(r)`:
```ts
function selectGeoResult(r: GeoResult) {
  onLocationFound?.(r.y, r.x, r.label);
  if (trimmed) pushRecent(trimmed);
  reset();
}
```

- [ ] **Step 3: Run existing tests**

```bash
npx vitest run tests/SearchBoxFilters.test.ts
```

Expected: all pass (no breakage)

- [ ] **Step 4: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): wire recent-searches save on selection"
```
  const existing = loadRecent().filter((r) => r !== q);
  existing.unshift(q);
  saveRecent(existing.slice(0, MAX_RECENT));
}

function removeRecent(query: string) {
  saveRecent(loadRecent().filter((r) => r !== query));
}

function clearAllRecent() {
  localStorage.removeItem(RECENT_KEY);
}
```

- [ ] **Step 2: Commit**

```bash
git add components/SearchBox.tsx
git commit -m "feat(search): add recent-searches localStorage helpers"
```

## File Structure

- Modify: `components/SearchBox.tsx` — recent searches, favorites, my-location, touch targets
- Modify: `app/globals.css` — responsive min-height for `.mapsearch__opt`
- Modify: `docs/searchbox.md` — document new features
- Modify: `tests/SearchBoxFilters.test.ts` — add tests