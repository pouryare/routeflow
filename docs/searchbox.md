# SearchBox Component — Comprehensive Reference

## Overview

`SearchBox` is a context-aware search input component that merges a search box with a dropdown panel containing filter controls and search results. It was originally designed for the map page and later extended to support the leads page (where search results are suppressed via `hideResults`).

**File:** `components/SearchBox.tsx` (480 lines)

---

## Props Interface

### Customer Search Props (optional — for map pages)

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `customers` | `CustomerRow[]` | No | List of customer records to search against |
| `districts` | `DistrictFeature[]` | No | List of district features to search against |
| `onSelectCustomer` | `(c: CustomerRow) => void` | No | Callback when a customer result is selected |
| `onSelectDistrict` | `(d: DistrictFeature) => void` | No | Callback when a district result is selected |
| `onLocationFound` | `(lat: number, lng: number, label: string) => void` | No | Callback when a location (coord/address/link) is selected |

### Controlled Search Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `value` / `externalValue` | `string` | No | Controlled input value (aliased to `externalValue` internally) |
| `onChange` / `onExternalChange` | `(query: string) => void` | No | Callback when input changes (aliased to `onExternalChange` internally) |

> When `value`/`onChange` are provided, the input is fully controlled. When absent, the component manages its own internal state via `useState("")`.

### Filter Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `sortMode` | `string` | No | Current sort mode (e.g. `"nearest"`, `"score"`, `"name"`) |
| `onSortModeChange` | `(mode: string) => void` | No | Callback when sort mode changes |
| `activeListId` | `number \| null` | No | Currently active route list ID |
| `onListChange` | `(id: number \| null) => void` | No | Callback when route list changes |
| `lists` | `Array<{ id: number; name: string }>` | No | Available route lists |
| `sortAnchor` | `{ lat: number; lng: number } \| null` | No | Current position anchor for "nearest" sort |
| `onPositionClear` | `() => void` | No | Callback to clear the position anchor |
| `onSetPosition` | `() => void` | No | Callback to set a new position anchor |
| `onSelectAll` | `() => void` | No | Callback for "select all" button |
| `inBatchView` | `boolean` | No | Whether batch view is active (hides "✓ همه" button) |
| `activeView` | `string` | No | Current pool view mode (`"kanban"`, `"score"`, etc.) |
| `hideResults` | `boolean` | No | Suppresses the search results dropdown section |

### UI Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `inputRef` | `React.RefObject<HTMLInputElement \| null>` | No | Ref for keyboard shortcut focus (map's `/` key) |
| `onExpandedChange` | `(expanded: boolean) => void` | No | Callback when phone-sized box opens/closes |
| `defaultExpanded` | `boolean` | No | Whether the panel starts expanded |

---

## Constants & Helpers

### `SORT_OPTIONS`

```ts
export const SORT_OPTIONS = [
  { value: "nearest", label: "نزدیک‌ترین" },
  { value: "score", label: "بهترین امتیاز" },
  { value: "name", label: "نام" },
  { value: "newest", label: "تازه‌ترین" },
  { value: "status", label: "وضعیت" },
  { value: "route", label: "ترتیب مسیر" },
  { value: "priority", label: "اولویت" },
] as const;
```

### `detectInputType(q: string): "coord" | "address" | "name"`

Classifies user input into one of three types:
- **`"coord"`** — matches `COORD_RE` (e.g. `"35.6892, 51.3890"`)
- **`"address"`** — Persian/Arabic text with spaces (e.g. `"تهران خیابان ولیعصر"`)
- **`"name"`** — anything else (customer name, code, phone)

### `URL_RE` / `COORD_RE`

- `URL_RE = /^https?:\/\//i` — detects Google Maps links
- `COORD_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/` — detects coordinate pairs

---

## Internal State

| State | Type | Purpose |
|-------|------|---------|
| `query` | `string` | Internal search query (used when uncontrolled) |
| `open` | `boolean` | Whether the dropdown panel is open |
| `collapsed` | `boolean` | Whether the search box is collapsed to an icon (phone) |
| `linkLoading` | `boolean` | Loading state for Google Maps link decoding |
| `linkError` | `string \| null` | Error message from link decoding |
| `geoResults` | `GeoResult[] \| null` | Geo search results from OpenStreetMap |
| `geoLoading` | `boolean` | Loading state for geo search |

---

## Derived Values

### `trimmed`
The trimmed query string. Empty string means no search is active.

### `isUrl`
`URL_RE.test(trimmed)` — true if input looks like a Google Maps URL.

### `coordMatch`
`COORD_RE.exec(trimmed)` — regex match for coordinate input.

### `inputType`
`detectInputType(trimmed)` — classified input type.

### `results`
Filtered customer/district results using `matchesQuery()` against `customers` and `districts`. Capped at 8 total (6 customers + 6 districts, then sliced to 8).

### `visibleSortOptions`
Sort options filtered by `activeView`:
- `"kanban"` → hides `"status"` option
- `"score"` → shows only `"score"` option
- default → all 7 options

### `sortDisabled`
`visibleSortOptions.length <= 1` — disables sort dropdown when only one option is available.

---

## Effects

### `onClickOutside`
Listens for `mousedown` on `document`. If the click is outside the component, closes the panel (`setOpen(false)`).

### Address Auto-Search
When `inputType === "address"` and `trimmed.length >= 2`, automatically calls `runGeosearch()` on every keystroke.

---

## Event Handlers

### `select(r: Result)`
Calls `onSelectCustomer(r.customer)` or `onSelectDistrict(r.district)` based on result kind, then resets.

### `reset()`
Clears query and closes panel.

### `goToCoords()`
Calls `onLocationFound(Number(coordMatch[1]), Number(coordMatch[2]), "مختصات وارد شده")`, then resets.

### `decodeLink()`
Fetches `/api/geo/decode-link?url=...`, calls `onLocationFound(data.lat, data.lng, "لینک نقشه")` on success, shows error on failure.

### `runGeosearch()`
Asks Nominatim (`format=json`, `countrycodes=ir`, `accept-language=fa`) for `trimmed` with a plain `fetch`, stores top 5 results.

### `selectGeoResult(r: GeoResult)`
Calls `onLocationFound(r.y, r.x, r.label)`, then resets.

### `onKeyDown(e)`
- `Enter` + URL → `decodeLink()`
- `Enter` + coord → `goToCoords()`
- `Enter` + no results → `runGeosearch()`

### `expand()` / `collapse()`
Toggle collapsed state (phone only).

---

## Dropdown Panel Structure

The panel renders when `open` is true and has two sections:

### Filter Strip (always visible when panel is open)
A horizontal strip containing:
1. **Sort mode select** — dropdown with `visibleSortOptions`, disabled when only one option
2. **Route list select** — dropdown with lists, `"مسیر آزاد"` as default
3. **Position indicator** — if `sortAnchor` is set, shows `"📍 شما"` with a clear button (`↵`); otherwise shows a `"📍 تعیین موقعیت"` button
4. **Select all button** — `"✓ همه"` button, hidden when `inBatchView` is true

### Results Section (guarded by `trimmed && !hideResults`)
When `hideResults` is false and there's a trimmed query, renders one of:

1. **URL result** — "نمایش این لینک روی نقشه" button (with loading state)
2. **Coordinate result** — "نمایش مختصات روی نقشه" button with coordinates
3. **Geo search results** — list of addresses from OpenStreetMap (or "آدرسی پیدا نشد")
4. **Local search results** — customer cards (with business name + code) and district cards (with name + parent name)
5. **No results** — "نتیجه‌ای یافت نشد" + "جستجوی «{trimmed}» به‌عنوان آدرس" button

---

## Layout Modes (Three Arrangements)

| Mode | `inline` | `collapsed` | Screen | Positioning |
|------|----------|-------------|--------|-------------|
| **Inline** | `true` | — | Any | `relative mx-auto w-72 max-w-full` — document flow, centered |
| **Collapsed** | `false` | `true` | Phone | `absolute right-[4.5rem] top-4` — icon button only |
| **Expanded** | `false` | `false` | Phone | `absolute left-14 right-4 top-4` — full row |
| **Expanded** | `false` | `false` | Desktop | `absolute left-4 right-[4.5rem] top-4 mx-auto w-72 max-w-[calc(100vw-5.5rem)]` |

---

## Usage on Leads Page

```tsx
<SearchBox
  value={query}
  onChange={setQuery}
  sortMode={sortMode}
  onSortModeChange={(mode) => setSortMode(mode as any)}
  activeListId={activeListId}
  onListChange={openList}
  lists={lists}
  sortAnchor={sortAnchor}
  onPositionClear={() => { setSortAnchor(null); setShowManualPos(false); }}
  onSetPosition={() => setShowManualPos(true)}
  onSelectAll={handleSelectAll}
  inBatchView={false}
  activeView={activeView}
  hideResults
/>
```

Key points for leads page:
- `value`/`onChange` make it a controlled component
- `hideResults` suppresses the search results dropdown (results render in PoolViewWrapper instead)
- No `customers`/`districts` props needed (CustomerSearch props are optional)
- `onSortModeChange` uses `as any` cast because `setSortMode` expects `SortMode` but the prop accepts `string`

---

## CSS Classes Used

| Class | Purpose |
|-------|---------|
| `mapsearch__input` | Search input styling |
| `mapsearch__panel` | Dropdown panel container |
| `mapsearch__filter-strip` | Filter controls strip |
| `mapsearch__opt` | Individual result option button |
| `mapsearch__label` | Result label text |
| `mapbtn` | Collapsed icon button |

---

## Dependencies

- `@/lib/persian` — `matchesQuery()` for Persian/fuzzy matching
- `@/lib/types` — `CustomerRow`, `DistrictFeature` types
- `@/components/meridian/Icon` — icon component

---

## User Features

### Recent Searches
- Shown as a `🕐 Recent` section at the top of the dropdown when the input is empty
- Tap any entry to re-run that search
- `✕` removes a single entry; "Clear all" removes all
- Persisted in `localStorage`, capped at 10 (LRU eviction)

### Favorites
- Tap the ★ icon on any result row to save it
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

