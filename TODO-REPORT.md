# To-do report

## Done
- [x] Read all pages and routes; documented purpose and page interactions (`AUDIT-2026-10-20.md` Part 1)
- [x] Checked for a code-audit skill: none exists; did not install unreviewed third-party ones
- [x] Static checks: `tsc`, `eslint`, `npm audit`, `vitest`
- [x] Playwright crawl: 55 routes x 7 roles (desktop), 12 routes x 3 roles (mobile)
- [x] Accessibility scan, API permission matrix (221 endpoints x 8 identities), tenant-isolation probes
- [x] Login/logout flows, input-validation probes, click-testing for all roles, form-testing with hostile input
- [x] Driver stop actions and order status flow tested
- [x] 41 findings listed in `AUDIT-2026-10-20.md`
- [x] Always-on rule added to `CLAUDE.md`: this report is rewritten after every prompt

- [x] Step 1: fixed build breakers (holidays page moved header into a layout; driver bundle no longer imports the database); `next build` passes
- [x] Step 2: input validation (order lines/dates/notes/seller, payment amount/date, money cap for all `_toman` fields, cheque/payment/order forms, commission rows stamped with organization, user/group/product/complaint limits) + tests
- [x] Step 3: login `?next=` restricted to same-site paths; rate limit uses the proxy-appended address and per-username buckets; van roles can sign out (`/api/logout`, `/api/me`, `/api/prefs`) — verified in browser + tests
- [x] Step 4: `/report` (districts filter) and runs view (scope spliced into plannable-orders SQL) fixed; platform_owner now treated as owner on pages, nav, sweeps, order transitions; analytics customers keep the organization guard — verified on a production build for 4 roles + tests
- [x] Step 5: confirmation before order cancel/return/credit-reject, facility, photo, holiday and lead-list/pin deletes, and user deactivation (`lib/confirm.ts`); verified in browser (dismiss = no request, accept = request) + guard test
- [x] Step 6: accessibility — contrast tokens (`--muted`, `--text-faint`, amber, status text via `STATUS_TEXT`, `.text-accent`), labelled selects/inputs, marker titles, `inert` closed sheets: axe contrast nodes 496 → 16 across 32 owner pages (reduced motion); markers/labels/aria-hidden-focus issues cleared
- [x] Step 6: dependencies — `npm audit` 15 → 5 (critical and moderate cleared): next 16.4.2, maplibre-gl 6, sharp 0.35, vitest 5, xmldom, js-yaml, undici, source-map-js, brace-expansion; remaining 5 are eslint-config-next transitive (dev tooling only; npm's suggested fix is a downgrade)
- [x] Step 7: remaining audit items — payments/tasks/alerts scoped (group manager = own group, salesperson = own); map data routes readable by the roles the nav sends there; /planner, /facilities (and receipts/complaints for rep manager) gated to match; driver stop resubmission (identical = no-op, different = 409) and cash cap; payment POST refuses another group's customer; module-level shared `NextResponse` fixed (empty 404 bodies); raw state code replaced by label; geolocation no longer requested on /login and /offline; notification popover width — verified on a production build + tests

## Not done / gaps
- [ ] Semgrep never ran (Python dependency conflict)
- [ ] Vector basemaps (maplibre-gl 6) cannot be rendered offline here; module shape verified only. Smoke suite (needs Chromium + server) not runnable in this container
- [ ] 16 contrast nodes remain (faint-on-sunk tint, one hover label, one accent-fill label); two selects and one link-in-text still unlabelled/unstyled for axe
- [ ] Deliberately not done: redirecting a signed-in user away from /login (a valid-signature cookie for a since-deactivated user would loop between proxy and page); soft-404 HTTP 200 on unknown ids (Next streaming behaviour); /leads for rep_manager (nav and proxy admit it, the data routes are manager-only — needs a product decision on what a rep manager may see)
- [ ] Full CRM add-lead flow and tasks-board drag-and-drop not exercised
- [ ] Stock movements, cheque lifecycle, batches, routing commit, notification delivery tested only by page load and API status

## Notes
- Audit item 16 correction: `/api/sync/*` refusing platform_owner is intentional (`hasSyncClient`), not a bug.

## Next steps
1. Decide the `/leads` access for rep_manager (see Not done), then align nav, proxy and data routes
2. Optionally finish the remaining test gaps (CRM add-lead, tasks drag-and-drop, stock/cheque/batch flows)

---

# Performance pass (PR [#17](https://github.com/pouryare/routeflow/pull/17) merged; follow-ups on branch `claude/inspiring-einstein-wqv8v2`)

_Updated 2026-10-20. Details and measurements: `docs/perf/2026-10-20-baseline.md`._

## Done
- [x] Startup hang fixed (missing boot-backfill indexes): `getDb()` on 78k orders never finished → 0.6 s
- [x] More indexes; N+1s removed (health, CRM counts, journal, commission); journal/ledger paging; trial balance 244 → 45 ms
- [x] Dashboard first content 4.6 s → ~1.0 s (SQL aggregation, per-render memo, streamed sections)
- [x] Stored order weight and order total/cost (`kg_total`, `total_toman`, `cost_toman`), trigger-voided and backfilled; debts, dashboard, commission read them; payroll byte-identical; `/map` 876 → ~265 ms
- [x] Slow-SQL log, boot-index test, CI workflow, page-time budget; lint 31 → 0; CI green
- [x] **PR #17 merged into `main`**
- [x] Intermittent test failure investigated: not reproducible in 11 full runs (closed as unexplained)
- [x] Phone layout: page-header tabs no longer clipped; accounting tables scroll sideways instead of cramping
- [x] Rep detail page checked on desktop and phone (HTTP 200, no console errors, no overflow)
- [x] Graphify review on PR #22: backfill now takes the write lock before reading; balance-sheet tables no longer force sideways scroll on desktop
- [x] Demo seed: delivery now dated to the order's day (was stamped with today → 552-day average lead time)

## Not done / gaps
- [ ] `tests/playwrightExtract.test.ts` fails in this container only (Playwright headless-shell binary missing; fails without my changes too)
- [ ] `/map` ~265 ms and owner dashboard ~2.4 s end to end (line-level scans: product breakdown, cross-sell, fill rate, stock)
- [ ] Six Graphify "fan-out" comments on merged PR #17 left as is (external bot; coupling metric on composition functions)

## Next steps
1. Decide whether the Graphify coupling check should block merges or be tuned (your call)
2. (done) Re-seeded a smoke DB: average delivery time 0 days
3. Cache line-level aggregates (product breakdown, fill rate) if the 2.4 s dashboard matters
