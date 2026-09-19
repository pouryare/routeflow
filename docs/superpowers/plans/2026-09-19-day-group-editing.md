# Editable Day Groups + Priority-High Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gate before each task is checked off, stays under the context budget). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "تقسیم خودکار بین روزها" day groups editable (add/remove/drag-drop) and add a priority-high toggle button to pool locations so they influence clustering.

**Architecture:** Priority locations become seeds for `clusterIntoDays`, naturally grouping non-priority around them. Day group editing mutates `proposedDaysRaw` directly; `proposedDays` recomputes via `useMemo`. Drag-and-drop reuses the existing `useCardDrag` hook from `components/board/`.

**Tech Stack:** React, Next.js (App Router), TypeScript, Vitest + React Testing Library, custom `useCardDrag` hook (pointer-events based, not `@dnd-kit`), existing `CollapsibleSection` and `Icon` components.

---

## Execution Summary

All 6 tasks completed. 26 tests passing across 3 test files.

| Task | Status | Commit |
|------|--------|--------|
| 1. Add `seeds` parameter to `clusterIntoDays` | ✅ Done | `fcf86eb` |
| 2. Add `priority` to `SavedLocation` + toggle in `LocationCard` | ✅ Done | `157ac8a` |
| 3. Add priority state and seeds to `proposeDays` | ✅ Done | `b936a01` |
| 4. Add day-group editing state in `page.tsx` | ✅ Done | `0470f07` |
| 5. Add editable day group UI to `RouteSection` | ✅ Done | `e70feed` |
| 6. Integration tests | ✅ Done | `79dd862` |

---

## File Structure (final state)

| File | Action |
|------|--------|
| `lib/clusterDays.ts` | Modified: added `seeds` param, `seedFromSources` helper, inline reorder logic |
| `app/(shell)/leads/page.tsx` | Modified: `priority` field, `togglePriority`, `addToDayGroup`, `removeFromDayGroup`, `unassignedLocations`, `proposeDays` with seeds |
| `components/leads/LocationCard.tsx` | Modified: `onTogglePriority` prop + star toggle button |
| `components/leads/RouteSection.tsx` | Modified: `useCardDrag` integration, editable day cards with remove/add/drag |
| `components/meridian/icon-map.ts` | Modified: added `StarOff` and `GripVertical` icons |
| `tests/clusterDays.test.ts` | Modified: 3 new tests for seeds |
