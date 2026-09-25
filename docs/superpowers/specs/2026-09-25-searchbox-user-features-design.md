# SearchBox — User-Facing Features Design

**Date:** 2026-09-25
**Status:** Draft (pending user review)
**Scope:** SearchBox component (`components/SearchBox.tsx`) + doc update (`docs/searchbox.md`)

---

## Problem

Sales reps and drivers use SearchBox daily but the component currently offers no memory of past searches, no way to save frequent locations, and no one-tap GPS. The doc (`docs/searchbox.md`) lists props but doesn't guide end users on how to get the most out of the search box.

---

## Features

### 1. Recent Searches
- Stored in `localStorage`, capped at 10 entries (LRU eviction)
- Appears as a section at the top of the dropdown when input is empty or on focus
- Each entry shows query text + relative timestamp ("۲ ساعت پیش")
- `✕` on each entry to remove individually; "Clear all" link below list
- Selecting a recent search runs it identically to typing it fresh

### 2. Saved / Favorite Locations
- Star icon on each result row (customer, district, geo result) — tap to toggle save
- Persisted in `localStorage` with: label, coordinates, source kind (`customer` | `district` | `geo`)
- A "★ Favorites" section appears in the dropdown when input is empty
- Tap to load; mobile: long-press to rename or delete, desktop: hover reveals delete button

### 3. "📍 My Location" Button
- Replaces the existing static position indicator when no `sortAnchor` is set
- One-tap: calls browser Geolocation API → `onLocationFound(lat, lng, "موقعیت من")`
- Graceful fallback if geolocation denied or unavailable (silent, no error UI — drivers shouldn't be blocked)
- When `sortAnchor` is already set, the existing position chip (`📍 شما ↵`) remains; my-location button hides

### 4. Responsive Touch Targets (Mobile Only)
- All interactive elements in the dropdown: minimum 44×44px tap target on screens < 768px
- Increased padding on result rows and filter buttons for mobile
- Desktop layout unchanged

---

## Data Model / Storage

| Key | Type | Purpose |
|-----|------|---------|
| `searchbox_recent` | `string[]` | Recent query strings (LRU, max 10) |
| `searchbox_favorites` | `Array<{ id: string; label: string; lat: number; lng: number; kind: string }>` | Saved locations |

Keys are namespaced (`searchbox_*`) to avoid collisions. No backend changes — purely client-side.

---

## Component Changes

- **New internal state:**
  - `recentSearches: string[]` — loaded from `localStorage` on mount
  - `favorites: Favorite[]` — loaded from `localStorage` on mount
- **New handlers:**
  - `saveFavorite(result)` — star/unstar a result
  - `removeRecent(query)` — delete single recent entry
  - `clearAllRecent()` — clear entire recent list
  - `useMyLocation()` — geolocation → `onLocationFound`
- **New dropdown sections (when input empty):**
  - "★ Favorites" row list
  - "🕐 Recent Searches" row list
- **Props unchanged** — all features are internal; no new public API needed

---

## Edge Cases / Error Handling

| Scenario | Behavior |
|----------|----------|
| Geolocation denied | Silent fallback; my-location button dims, no error toast |
| `localStorage` full | Evict oldest recent entry automatically; ignore favorite save |
| Empty favorites + empty recent | Show a small hint: "جستجوی سریع با ⭐ یا 🕐" |
| User switches view while dropdown open | No special handling; dropdown closes naturally |
| Same query searched twice | Recent list deduplicated — moves to top, no duplicate entries |

---

## Out of Scope
- Voice input (future)
- "Today's Route" shortcut (deferred)
- Backend sync for favorites/recent (future)

---

## Design Doc Notes
- This spec covers the user-facing features; the existing `docs/searchbox.md` should be updated to document the new behavior (recent searches section, favorites section, my-location button) alongside the existing props reference.
- Persian UI, `text-xs` sizing, existing design tokens.
