# Pocket Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement content for the document-pocket slips behind order cards on the Orders Board view and behind lead cards on the Leads Pocket view.

**Architecture:** Two independent but parallel features. Both use the existing `Pocketed` component via its `slips` prop. The orders board gets richer data joins; the leads pocket gets dynamic paper counts from visit data.

**Tech Stack:** Next.js 16, TypeScript, node:sqlite, React 19, Vitest for tests.

---

**Standing rules:**
- NEVER run `next build` / `npm run build`. Use `npx tsc --noEmit`.
- Do NOT run vitest per task — write tests, run at phase gates and end.
- `sharp` stays pinned to exactly `0.33.5`.
- Commit per logical task.

---

## Task 1: Order Pipeline — Slip Data Enrichment

**Files:**
- Modify: `app/(shell)/sales/orders/page.tsx:182-214` (BoardView)
- Modify: `components/sales/OrderPipeline.tsx:17-22` (PipelineOrder interface, STAGE_DOCS)

Order cards need `run_id` and `sort_order` to identify which delivery run they're on. The `BoardView` already computes `onARun` as a Set — we need the actual IDs instead.

### Step 1: Write the failing test

```ts
// tests/orders-board-slips.test.ts
import { describe, it, expect } from "vitest";

describe("orders board slip data", () => {
  it("BoardView attaches run_id and sort_order to orders on a run", () => {
    // When an order is on a delivery stop, BoardView should join
    // delivery_stops to provide run_id and sort_order on the PipelineOrder
    // Verify: the mapping from OrderSummary to PipelineOrder includes these fields
  });
});
```

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add `run_id` and `sort_order` to `PipelineOrder`**
- [ ] **Step 4: Join `delivery_stops` in `BoardView` to populate them**
- [ ] **Step 5: Run `npx tsc --noEmit`**
- [ ] **Step 6: Commit**

---

## Task 2: Order Pipeline — Render Slips

**Files:**
- Modify: `components/sales/OrderPipeline.tsx:15-22` (SLIP content), `:219-258` (card rendering)

Render actual content in the `Pocketed` slips instead of blank spans. The `STAGE_DOCS` config maps stage → paper count + tone. We extend the rendering to pass custom `slips` to `<Pocketed>`.

### Step 1: Write the failing test

```ts
// tests/orders-board-slips.test.ts (continued)
describe("order slip content", () => {
  it("renders Order Summary with order_no, kg, line_count", () => {
    // Slip 1 content: label «سفارش» + order_no + kg + line_count
  });
  it("renders Run Summary with run_id and sort_order when on a run", () => {
    // Slip 2 content: label «مسیر» + run_id + stop position
  });
  it("passes custom slips to Pocketed instead of blank spans", () => {
    // When papers >= 1, the slips prop should be set with OrderSummarySlip
    // When papers == 2, second slip should be RunSummarySlip
  });
});
```

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Create `OrderSummarySlip` component**
- [ ] **Step 4: Create `RunSummarySlip` component**
- [ ] **Step 5: Pass `slips` prop to `<Pocketed>` in OrderPipeline**
- [ ] **Step 6: Run `npx tsc --noEmit`**
- [ ] **Step 7: Commit**

---

## Task 3: Leads Pocket — Visit Data Enrichment

**Files:**
- Modify: `components/leads/views/PoolViewWrapper.tsx:44-51` (PoolViewItem interface)
- Modify: `components/leads/views/PoolViewWrapper.tsx:66-80` (item enrichment)
- Create: `lib/repo/leadVisits.ts` (query helper)

`PoolViewItem` needs visit count and last visit info. We query `lead_visit_activities` per location_id.

### Step 1: Write the failing test

```ts
// tests/leads-pocket-visit-data.test.ts
import { describe, it, expect } from "vitest";

describe("leads pocket visit enrichment", () => {
  it("enriches PoolViewItem with visitCount, lastVisitDate, lastVisitOutcome", () => {
    // A location with 2 lead_visit_activities rows should have visitCount: 2
    // and lastVisitDate/lastVisitOutcome from the most recent row
  });
});
```

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Create `lib/repo/leadVisits.ts` — `visitSummaryForLocations(db, locationIds)`**
- [ ] **Step 4: Enrich `PoolViewItem` with visit fields**
- [ ] **Step 5: Pass `navAppId` and session scope to the enrichment**
- [ ] **Step 6: Run `npx tsc --noEmit`**
- [ ] **Step 7: Commit**

---

## Task 4: Leads Pocket — Dynamic Paper Count

**Files:**
- Modify: `components/leads/views/PoolViewPocket.tsx:34-123`

Currently `papers={2}` is hardcoded. Change to compute 0/1/2 from visit count:
- 0 visits → papers=0
- 1 visit → papers=1
- 2+ visits → papers=2

### Step 1: Write the failing test

```ts
// tests/leads-pocket-view.test.ts
describe("leads pocket paper count", () => {
  it("renders papers=0 for a new lead with no visits", () => {
    // PoolViewPocket with a location having visitCount=0 → <Pocketed papers={0}>
  });
  it("renders papers=1 for a lead with one visit", () => {
    // visitCount=1 → <Pocketed papers={1}>
  });
  it("renders papers=2 for a lead with two+ visits", () => {
    // visitCount=2 → <Pocketed papers={2}>
  });
});
```

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Replace hardcoded `papers={2}` with computed value**
- [ ] **Step 4: Run `npx tsc --noEmit`**
- [ ] **Step 5: Commit**

---

## Task 5: Leads Pocket — Render Slips

**Files:**
- Modify: `components/leads/views/PoolViewPocket.tsx:16` (imports)
- Modify: `components/leads/views/PoolViewPocket.tsx:86-119` (Pocketed rendering)

Render custom slip content: Lead Profile slip and Visit Log slip, passed via the `slips` prop.

### Step 1: Write the failing test

```ts
// tests/leads-pocket-slips.test.ts
describe("lead pocket slip content", () => {
  it("renders Lead Profile slip with name, status, ratings", () => {
    // Slip 1: label «سرنخ» + name + status + ratings
  });
  it("renders Visit Log slip with count, date, outcome", () => {
    // Slip 2: label «بازدیدها» + visitCount + lastVisitDate + outcome
  });
});
```

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Create `LeadProfileSlip` component**
- [ ] **Step 4: Create `VisitLogSlip` component**
- [ ] **Step 5: Pass `slips` prop to `<Pocketed>` in PoolViewPocket**
- [ ] **Step 6: Run `npx tsc --noEmit`**
- [ ] **Step 7: Commit**

---

## Phase Gates

### After Tasks 1-2 (Orders Board)
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run tests/orders-board-slips.test.ts` — all pass
- [ ] Orders board renders slips correctly in browser

### After Tasks 3-5 (Leads Pocket)
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run tests/leads-pocket-*.test.ts` — all pass
- [ ] Leads pocket renders slips correctly in browser

### Final
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npx vitest run` — full suite (background, poll log)
  - Known flakes: `tests/district-coverage.test.ts`, `tests/api/routing-route.test.ts`, `tests/routing-repo.test.ts` (CPU contention, pass alone)
- [ ] No regressions in orders board or leads pocket rendering
