# To-do report

_Condensed 2026-10-23. Each finished piece of work is one line here; the full earlier text is in git history (`git log -p TODO-REPORT.md`)._

## Done
- [x] Full-app audit, 41 findings (`docs/archive/AUDIT-2026-10-20.md`), all fixed or decided across PR #24 and the steps that followed
- [x] Performance pass (PR #17), mobile-first TapFlow rollout (PRs #26, #27), architecture audit steps 1–7 (PRs #43–#46 and later)
- [x] Sync pull same-millisecond tie fixed (PR #54); parked features F4–F148 written up; roadmap themes and waves; platform decisions in `docs/roadmap.md` section 10
- [x] Roadmap small fixes, and six more technologies recorded in roadmap 10.8 (import wizard, per-company subdomain, backup fire drill, call detection, photo straightening before OCR, contact picker)
- [x] Redundant-files clean-up; rules in `CLAUDE.md` (batch-then-merge, look for existing solutions, this report)
- [x] Quick wins batch (PR #57):
  - [x] Phones apply deletes during sync (tombstones), and the server now writes tombstones for run, stop, facility, location, lead-import and unpromote deletes
  - [x] F144 failure-reason report (`/sales/reasons`)
  - [x] F99 product change log (catalogue changes on the products page)
  - [x] F100 customer owner history (pool claims and territory moves on the customer timeline)
  - [x] F107 sign out everywhere (`/settings/security`)
  - [x] F110 sign-in log (`/sales/admin/logins`, last sign-in column, own sign-ins)
  - [x] F138 part 1: backup script fixed (it failed on every run) and each backup is checked, with `backup-status.json`
  - [x] F108 owner status page (`/sales/admin/status`)
  - [x] F132 urgent flag on orders, shown on the order page, the board and the driver's stop
  - [x] F89 prices a customer paid, beside the list price, on the customer page and map panel
  - [x] F35 a password an owner chose must be replaced at first sign-in (`/password`)
  - [x] F116 amount in words (our own function) on the delivery receipt and payment confirmation

## Not done / gaps
- [ ] Check the server's backup folder: before this batch the backup script never produced a database copy
- [ ] Off-site backup copy (F138 part 2) waits on a destination and key holder
- [ ] Nothing writes `deliveries.delay_reason_id`, so the reason report's delay section stays empty
- [ ] No record of failed notification sends exists; the status page shows the last successful one
- [ ] No product rename or deactivate route, so the product log covers create, packaging and thresholds only
- [ ] No manager reassignment of customers; owner history covers pool claims and territory moves
- [ ] The urgent commission rate is stored but never read; marking an order urgent does not change commission
- [ ] Amount in words not yet on cheque entries or the payments list; no rial wording
- [ ] 38 stale GitHub branches; owner runs `delete-stale-branches.sh`
- [ ] Founder's second login step off until turned on at `/switch`; confirm the live `SESSION_SECRET` is 32+ characters
- [ ] Unverified claims in parked features: F51, F56, F57, F67, F69, F71, F73, F75, F97, F102, F113, F147 (`docs/roadmap.md` section 8)
- [ ] Open decisions: Android distribution route and iPhone support; off-site backup location; row-level security timing; charts library vs custom
- [ ] Nothing tested from Iran (weather, Telegram, push, map tiles, OSRM, registries)
- [ ] `tests/playwrightExtract.test.ts` and the smoke suite need Chromium the cloud container lacks
- [ ] Ratchets (long functions 74, unused exports 221, raw role checks 57) only fall as files are touched
- [ ] Offline covers delivery, receipts, cheques, complaints, order drafts and new customers only

## Next steps
1. Merge PR #57 once CI is green
2. Owner checks the backup folder and picks an off-site destination (F138 part 2)
3. Record delay reasons on deliveries so the reason report's delay section fills
4. Owner runs `delete-stale-branches.sh`
5. Check the outside services from the Iranian server
6. Decide the Android distribution route before F6 starts
7. Data-layer decision record, then the PostgreSQL spike
