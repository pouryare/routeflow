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

## Not done / gaps
- [ ] Semgrep never ran (Python dependency conflict)
- [ ] Full CRM add-lead flow and tasks-board drag-and-drop not exercised
- [ ] Stock movements, cheque lifecycle, batches, routing commit, notification delivery tested only by page load and API status

## Next steps
1. Fix the two build breakers (holidays page, driver bundle importing the database)
2. Validate order, payment and commission input (bounds, integers, dates, tenant of salesperson)
3. Fix the open redirect, the login rate-limit header trust, and driver logout
4. Fix the `/report` and runs-view crashes, and the platform_owner role checks
5. Add confirmations to cancel, delete and deactivate actions
6. Fix contrast and unlabelled controls, update dependencies
7. Optionally finish the remaining test gaps
