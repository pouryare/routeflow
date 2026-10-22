# Plan: pocket content for orders board and leads pocket view

**Goal:** Implement document-pocket slip content (what peeks behind each card) for two views: the Orders Board (orders on a pipeline) and the Leads Pocket view (location pins). Both use the existing Pocketed component's `slips` prop.

**Full plan:** `docs/superpowers/plans/2026-10-05-pocket-content-implementation.md`
**Spec:** `docs/superpowers/specs/2026-10-05-pocket-content-design.md`

---

## Standing rules
- NEVER run `next build` / `npm run build` / `vitest.smoke.mts` (browser)
- `npx tsc --noEmit` for type safety
- `sharp` pinned to `0.33.5` exactly
- Commit per task

---

- [ ] **Task 1:** Order Pipeline — Slip Data Enrichment (run_id, sort_order on PipelineOrder)
- [ ] **Task 2:** Order Pipeline — Render slips (OrderSummarySlip, RunSummarySlip)
- [ ] **Task 3:** Leads Pocket — Visit data enrichment (visitCount, lastVisitDate, lastVisitOutcome on PoolViewItem)
- [ ] **Task 4:** Leads Pocket — Dynamic paper count (0/1/2 based on visit count)
- [ ] **Task 5:** Leads Pocket — Render slips (LeadProfileSlip, VisitLogSlip)

---
_Archived 2026-10-22 from `.zoocode/plan.md` when that tool's workspace was removed from the repository (it stays in git history). Its "standing rules" are stale (for example `sharp` is no longer pinned to 0.33.5); the live rules are in `CLAUDE.md`, `AGENTS.md` and `docs/mobile-first-principles.md`._
