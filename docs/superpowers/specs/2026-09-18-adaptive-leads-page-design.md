# Adaptive `/leads` Page — Design Spec

**Date:** 2026-09-18 · **Status:** Draft (brainstorming)
**Source:** User-directed redesign of the `/leads` page in RouteFlow CRM.
**Companion rulebook:** [`docs/tap-flow-principles.md`](../../tap-flow-principles.md) — every interaction is a tap flow.
**Existing infrastructure:** `lib/osrm.ts`, `lib/routing/osrmMatrix.ts`, `lib/routing/matrix.ts`, `lib/routing/vroom.ts`, `lib/repo/routing.ts` — all OSRM integration already built and tested.

---

## 0. Decisions Locked

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | **Page architecture** | One adaptive `/leads` page, role-based rendering | No tab switching or context switching on mobile |
| D2 | **Role split** | Manager/Owner sees pool + day-splitting + route + map; Driver sees route + map only | Driver only needs the plan; planning is a manager activity |
| D3 | **Pool** | Read-only catalog — shows rating, status badges, 3 action buttons (nav, copy-original-link, copy-page-link) | Pool is a dashboard, not a control panel; editing moves to tap-flow |
| D4 | **Tap-flow** | Full `leadVisitFlow` (navigate → what_happened → detail_status → convert → rate) on each route stop | Complete driver visit experience; existing flow config |
| D5 | **Day-splitting** | Auto-organizes route into day groups; applied within route section | Manager/Owner only; day groups are cards with stops |
| D6 | **Pool buttons** | Three always-visible buttons per row: مسیریابی, کپی لینک اصلی, کپی پیوند | Mobile-first; one-tap access |
| D7 | **Routing engine** | OSRM (`fetchOsrmTable`) for road-distance ordering; haversine fallback; keep `routeLengthKm` for display | OSRM already built, tested, and integrated in `lib/repo/routing.ts` |
| D8 | **Optimization pipeline** | Segment via k-means clustering (existing `clusterIntoDays`), then OSRM within each day segment | Avoids O(n²) all-pairs for large datasets; segment count = day count |
| D9 | **Sort modes** | `nearest` (smart fallback), `score`, `name`, `newest`, `status`, `route` (NEW), `priority` (NEW) | Route-aware and priority-aware sorting for managers |
| D10 | **Interaction model** | Tap-flow for all route stop interactions; no inline editing anywhere | Consistent with tap-flow principles; pool is view-only |

---

## 1. Page Architecture

### 1.1 Role Detection

Uses existing `session` system (`isManager`, `isCrmManager`). If role cannot be determined → default to driver view (fail-safe). No new auth code needed.

### 1.2 Manager/Owner View (4 sections, top to bottom)

```
Header + GPS status bar
همه مکان‌ها (READ-ONLY CATALOG) — search, sort, rows with status dot/rating/3 buttons
تقسیم خودکار بین روزها (MANAGER ONLY) — stops-per-day, propose, day group proposals
مسیر فعلی (ROUTE) — day group cards with tap-flow stops
Map (LeadsMap — all locations + route points)
```

### 1.3 Driver View (2 sections, top to bottom)

```
"مسیر فعلی" banner + Next Stop info
Day group cards with tap-flow stops (no pool, no day-splitting)
Map (LeadsMap — route points only)
```

### 1.4 Implementation

The `LeadsPage` component checks `session.isManager` and conditionally renders sections. Pool and day-splitting sections are wrapped in `{isManager && ...}`.

---

## 2. Pool Section (همه مکان‌ها) — Read-Only Catalog

### 2.1 Row Layout

Each pool row shows:
- **Status dot**: 🟢 تماس گرفته / 🔵 بازدید شد / 🔴 پاسخ نداد / ⚪ رد شد / ⚫ بدون وضعیت
- **Location name** (truncated), **Address** (truncated)
- **Average rating**: read-only star row (reuse `StarRating` with `disabled=true`)
- **"در مسیر" badge**: shown if location is already in the current run
- **"بدون مخصرات" badge**: shown if lat/lng is null
- **3 action buttons**: مسیریابی, کپی لینک اصلی, کپی پیوند

### 2.2 NOT Shown in Pool

Removed from pool rows: editable rating stars, status dropdown, "امتیازدهی" button, "تبدیل به مشتری" button, "تعیین موقعیت روی نقشه" button. Delete button kept.

### 2.3 Search & Sort

Sort dropdown modes: `nearest` (smart fallback), `score`, `name`, `newest`, `status`, `route` (NEW — route stops first), `priority` (NEW — composite score). Sort preference persisted to localStorage.

### 2.4 Smart Sort Default

When `sortAnchor` is null (no GPS), auto-switch from `nearest` to `status`. GPS resort threshold increases from 0.05km to 0.1km.

### 2.5 Component: `LocationCard`

New `components/leads/LocationCard.tsx` — read-only row with status dot, name, address, rating, badges, 3 buttons. Reuses existing `CopyButton`.

---

## 3. Route Section (مسیر فعلی) — The Central Hub

### 3.1 Day Group Cards

Each day group card shows: day number/title, stop count, total km, progress bar, distance summary, expandable stop list with tap-flow on each stop.

### 3.2 Stop Card within Day Group

Sequential number, name, status badge (from tap-flow result), average rating, "تاپ فلو باز کردن" button, distance from previous stop, copy + navigation buttons.

### 3.3 RunPanel Modifications

`components/leads/RunPanel.tsx` accepts `DayGroup[]` instead of flat `stops[]`. Adds progress bars per day, completion badges, distance per day. Keeps move/remove/clear/optimize buttons.

### 3.4 Route Without Day-Splitting

Flat list of stops (backward compatible). Day-splitting adds grouping.

---

## 4. Day-Splitting Integration (تقسیم خودکار بین روزها)

### 4.1 Flow

1. User sets stops-per-day (default 8)
2. Clicks "پیشنهاد بده"
3. `clusterIntoDays(routable, k, runOrigin)` runs with OSRM distances
4. Shows day group proposals
5. "بردن به مسیر" applies to route section

### 4.2 KNN Segmentation Strategy

For 50+ stops: segment via k-means (clusters = days), then OSRM within each segment. Cost: O(k × m²) instead of O(n²). `fetchOsrmTable` accepts up to 100 points — well within day-group sizes.

### 4.3 Fallback

OSRM fails → `haversineMatrix`. Already handled by `fetchOsrmTable` returning null.

---

## 5. Tap-Flow Interaction

Every route stop → `leadVisitFlow` (navigate → what_happened → detail_status → convert → rate). New `components/leads/LocationTapFlow.tsx` mirrors `AfterCallFlow` pattern. Fetches context via `GET /api/leads/locations/[id]/visit`, owns `FlowState`, calls `TapFlow` with `config={leadVisitFlow}`.

---

## 6. OSRM Routing Integration

### 6.1 Existing Infrastructure (Already Built)

| File | Function |
|------|----------|
| `lib/osrm.ts` | `fetchDrivingRoute(a, b)` |
| `lib/routing/osrmMatrix.ts` | `fetchOsrmTable(points)` — road matrix (up to 100 points) |
| `lib/routing/matrix.ts` | `haversineMatrix` + `durationMatrixFromKm` |
| `lib/repo/routing.ts` | Already uses OSRM with fallback |
| `lib/routing/vroom.ts` | VROOM VRP solver |

### 6.2 Integration

Import `fetchOsrmTable` into leads page. Before `clusterIntoDays`, fetch OSRM matrix. Modify `clusterIntoDays` and `twoOptOrder` to accept road-distance matrices. Keep `routeLengthKm` for display (labeled "خط مستقیم").

### 6.3 Graceful Degradation

OSRM fails → haversine fallback. Timeout 8s. No new error states needed.

---

## 7. Creative Features

Route Progress Bar, Priority Glow, Smart Add Buttons, Day Group Cards, Color-Coded Status Dots, Distance per Day, "Next Stop" Banner, Location Badges, Sort Persistence, Road Distance Preview.

---

## 8. Sorting Improvements

GPS threshold 0.05 → 0.1km. New `route` sort (route stops first). New `priority` sort (composite score). Route badge in pool for in-run locations.

---

## 9. Error Handling & Edge Cases

No GPS → status sort. No coordinates → "بدون مخصرات" badge. Role unknown → driver view. OSRM down → haversine fallback. >100 points → batch processing. Network drops → 5s undo preserved.

---

## 10. Files to Create/Modify

**New**: `components/leads/LocationCard.tsx`, `components/leads/DayGroupCard.tsx`, `components/leads/LocationTapFlow.tsx`, `components/leads/RouteSection.tsx`

**Modified**: `app/(shell)/leads/page.tsx` (role rendering, pool simplification, OSRM, sorting), `lib/geo.ts` (threshold + custom distance), `components/leads/RunPanel.tsx` (day groups), `components/LeadsMap.tsx` (driver mode)

**No changes needed**: `lib/osrm.ts`, `lib/routing/osrmMatrix.ts`, `lib/routing/matrix.ts`, `lib/repo/routing.ts`, `lib/crm/flows/leadVisit.ts`, `components/tapflow/TapFlow.tsx`, `components/CopyButton.tsx`, `components/StarRating.tsx`, `app/api/leads/locations/[id]/visit/route.ts`

---

## 11. Testing Strategy

Unit tests for LocationCard, DayGroupCard, twoOptOrder with custom distance, fetchOsrmTable fallback, sort modes. Integration tests for role-based rendering, tap-flow, day group application. Manual tests for all scenarios.

---

## 12. Out of Scope

VROOM multi-vehicle optimization (separate), real-time traffic (separate), virtualized scrolling (future), Google Maps Distance Matrix (OSRM sufficient), route history (separate), offline map tiles (separate).
