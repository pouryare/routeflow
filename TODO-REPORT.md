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
- [x] Small-difficulty batch (PR for `claude/project-thread-7n1enu`), first slices on existing code, no new library:
  - [x] F84 help for today, CRM, payments, planner and runs
  - [x] F58 «سبد همیشگی» in the quick order flow; F62 «خریدهای این مشتری» pinned in the product picker
  - [x] F72 duplicate order warning (same customer, same products, open, last 24 hours)
  - [x] F98 note search in the search overlay
  - [x] F54 data quality page (`/sales/data-quality`)
  - [x] F40 new customer checklist; F47 open cheques and complaints on the customer page
  - [x] F142 snooze a task an hour or to tomorrow 9:00, at most three times
  - [x] F133 required lessons per role and a manager table
  - [x] F137 lead source report (`/sales/lead-sources`)
  - [x] F101 all of a run's delivery notes in one print (`/print/run/[id]`)
  - [x] F23 printable price list (`/print/price-list`)
  - [x] F19 this month's commission so far on the seller's briefing
  - [x] F67 this week against the same days last week on the manager's briefing
  - [x] F16 owner morning digest by push and Telegram from 07:00
  - [x] F8 «موعد سفارش امروز» panel for sellers
  - [x] F112 what's-new card shown once, history at `/settings/updates`
  - [x] Built markers in `docs/future-features.md` for these and PR #57's items; roadmap section 1 status and 1a

## Not done / gaps
- [ ] Check the server's backup folder: before this batch the backup script never produced a database copy
- [ ] Off-site backup copy (F138 part 2) waits on a destination and key holder
- [ ] Nothing writes `deliveries.delay_reason_id`, so the reason report's delay section stays empty
- [ ] No record of failed notification sends exists; the status page shows the last successful one
- [ ] No product rename or deactivate route, so the product log covers create, packaging and thresholds only
- [ ] No manager reassignment of customers; owner history covers pool claims and territory moves
- [ ] The urgent commission rate is stored but never read; marking an order urgent does not change commission
- [ ] Amount in words not yet on cheque entries or the payments list; no rial wording
- [ ] 39 stale GitHub branches (the 38 listed in PR #55 plus `claude/project-thread-trrg87`, merged as PR #54): cloud sessions can only push their own branch, so they cannot delete branches or push tags. Run `delete-stale-branches.sh` from a clone with push rights, or delete them on GitHub's Branches page
- [ ] Founder's second login step off until turned on at `/switch`; confirm the live `SESSION_SECRET` is 32+ characters
- [ ] Unverified claims in parked features: F51, F56, F57, F67, F69, F71, F73, F75, F97, F102, F113, F147 (`docs/roadmap.md` section 8)
- [ ] Open decisions: Android distribution route and iPhone support; off-site backup location; row-level security timing; charts library vs custom
- [ ] Nothing tested from Iran (weather, Telegram, push, map tiles, OSRM, registries)
- [ ] `tests/playwrightExtract.test.ts` and the smoke suite need Chromium the cloud container lacks
- [ ] Ratchets (long functions 74, unused exports 221, raw role checks 57) only fall as files are touched
- [ ] Offline covers delivery, receipts, cheques, complaints, order drafts and new customers only
- [ ] F133: the required lessons per role (`content/academy/_manifest.json` `required_for`) are a guess for the owner to confirm
- [ ] F16 sends only when the rule sweep runs after 07:00 Tehran; check the cron calls `/api/rules/run` in the morning
- [ ] F23 is one list per company (prices have no per-group series) and has no shared link
- [ ] F137 has no spend entry, so no return figure; it counts all time
- [ ] F98 does not search task or complaint text; F72 checks only orders the caller can see
- [ ] F142 does not cover the old map reminders or notifications; F8 has no dismiss
- [ ] F112 card is on the sales briefing only, not the drivers' `/today`
- [ ] F101 lists reversal lines one by one, while the total is net
- [ ] Left for later: F104 (not reached; nothing blocks it), and, waiting on a missing prerequisite, F74, F77, F85, F86, F91, F114, F69, F31, F42, F34, F95, F140, F2, F5, F117, F38

## Next steps
1. Merge the small-difficulty batch PR once CI is green
2. Owner confirms the F133 required lessons and that the morning sweep runs after 07:00
3. Owner checks the backup folder and picks an off-site destination (F138 part 2)
4. Record delay reasons on deliveries so the reason report's delay section fills
5. F104 customer snapshot sheet (small, nothing blocks it)
6. Owner deletes the 39 stale branches (`delete-stale-branches.sh`, or GitHub's Branches page)
7. Check the outside services from the Iranian server
8. Decide the Android distribution route before F6 starts
9. Data-layer decision record, then the PostgreSQL spike
