# To-do report

_Condensed 2026-10-23. Each finished piece of work is one line here; the full earlier text is in git history (`git log -p TODO-REPORT.md`)._

## Done
- [x] Full-app audit, 41 findings (`docs/archive/AUDIT-2026-10-20.md`), all fixed or decided across PR #24 and the steps that followed: validation, login redirect and rate limit, scoping, accessibility (axe contrast 496 → 16), `npm audit` 15 → 5
- [x] Performance pass (PR #17): startup hang, indexes, N+1s, stored order totals, dashboard 4.6 s → ~1 s, CI workflow (`docs/perf/2026-10-20-baseline.md`)
- [x] Mobile-first TapFlow rollout (PRs #26, #27): tap flows for delivery, payments, cheques, complaints, tasks, orders, stock, expenses; bottom tabs; swipe, decks, pickers; rules in `docs/mobile-first-principles.md`, enforced by `npm run check:mobile`
- [x] Architecture audit steps 1–7 (PRs #43–#46 and later): `lib/db.ts` 5,848 → 148 lines, no route/page/component opens the database, ~20 cross-company holes closed, founder full access and optional second login step, large screens split, ratchet in `npm run check:architecture` (`docs/architecture-audit-2026-10-22.md`)
- [x] Sync pull same-millisecond tie fixed (PR #54): watermark capped at the millisecond before the pull and counts tombstones
- [x] Legacy `sales` rows carry their company; "All companies" mode is read-only for the founder
- [x] Parked features F4–F148 written up in `docs/future-features.md`; `docs/roadmap.md` groups them into themes and waves
- [x] PostgreSQL move estimated (4–7 engineer-weeks) and platform choices recorded (`docs/roadmap.md` section 10)
- [x] Library review: what to add, what to replace, what to keep (`docs/roadmap.md` 10.x, notes on features)
- [x] Owner decisions recorded: Capacitor Android shell, phone GPS, Farazsms for SMS, live updates via server-sent events first
- [x] Rules added to `CLAUDE.md`: batch-then-merge, search for existing solutions first, this report after every prompt
- [x] Roadmap small fixes: existing-code count wording, foundations sorted by in-degree, sections 6 and 8 in number order, three open decisions added to section 5, stray blank line; unverified list here matched to section 8
- [x] Six more technologies recorded in roadmap 10.8 (owner chose all six): import wizard, per-company subdomain and branding, backup fire drill, call detection on the phone, straighten photos before OCR, contact picker; notes on F1, F4, F10, F26, F34, F40, F104, F108, F126, F127, F138, F147, F148
- [x] Redundant-files clean-up (this branch): September handoffs and the 10-20 audit moved to `docs/archive/`; one avatar preset list (`lib/avatarPresets.ts`) instead of two hand-synced copies; this report condensed from 470 to under 60 lines; stale-branch script written (`delete-stale-branches.sh`, shared in the thread)

## Not done / gaps
- [ ] 38 stale GitHub branches still exist: this session can only push to its own branch, so the owner runs the tag-and-delete script
- [ ] `scripts/seed-demo.mjs` (old seeder, org 1 only) overlaps `scripts/seed-demo.ts`; kept because `tests/seed-demo-guard.test.ts` covers it and it is the only one that seeds into an existing database
- [ ] Founder's second login step is off until turned on at `/switch`
- [ ] Confirm the live `SESSION_SECRET` is 32+ characters (a short one is only a warning)
- [ ] The device ignores `tombstones` in the pull response (`lib/offline/syncEngine.ts` only upserts), so deletes never reach the offline snapshot; a long transaction in another process, or rows stamped with device time, could still fall behind the watermark (one server process today)
- [ ] Ratchet numbers (long functions 74, unused exports 223, raw role checks 57) only fall as files are touched
- [ ] Unverified claims in parked features: F51, F56, F57, F67, F69, F71, F73, F75, F97, F102, F113, F132, F147 (`docs/roadmap.md` section 8)
- [ ] Nothing tested from Iran: weather, Telegram, push services, map tiles, public OSRM, npm and container registries; `VROOM_URL` unset outside production
- [ ] Open decisions: Android distribution route and iPhone support; off-site backup location; row-level security timing; charts library vs custom
- [ ] `tests/playwrightExtract.test.ts` needs a Chromium build the cloud container lacks; smoke suite not runnable there
- [ ] 16 contrast nodes remain; soft-404 HTTP 200 on unknown ids left on purpose
- [ ] Offline covers delivery, receipts, cheques, complaints, order drafts and new customers only (not reminders, notes, tasks)

## Next steps
1. Merge the roadmap small-fixes PR once CI is green
2. Owner runs `delete-stale-branches.sh` to tag and delete the 38 stale branches
3. Check the outside services from the Iranian server
4. Decide the Android distribution route before F6 starts
5. Apply sync tombstones on the device (delete snapshot rows by entity type and id)
6. Data-layer decision record, then the PostgreSQL spike (orders vertical with row-level security)
