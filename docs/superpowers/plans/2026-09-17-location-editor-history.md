# Shared location editor and Jalali history implementation plan

**Goal:** Finish approved hybrid inline/expanded pin editing, map defects, and Jalali CRM history.
**Architecture:** One LocationEditor owns an unsaved pin/link draft and expands without remounting its map. LocationPinPicker adapts its existing callback contract to that editor, so lead PinStep and CRM share behavior. CustomerLocationMap supplies the existing theme-aware basemap and optional editing events. CRM saves coordinates through the existing permission-checked PATCH transaction. Dates stay ISO in storage and use faJalaliDateTime for presentation.
**Stack:** Existing React, Next, Leaflet, Vitest, Playwright and Jalali helpers; no dependencies or production build.

- [ ] Regression tests: provider coordinate shapes, atomic coordinate updates, rendered Jalali history, draft preservation/cancel/save/failure, map stacking and theme checks.
- [ ] Extend coordinate parser for Google place coordinates, encoded/integer pairs, Neshan/Balad and Waze. Reuse authenticated CRM resolve-link endpoint; keep existing network guards. Reject unresolved links in editor without replacing draft.
- [ ] Add lat/lng as an atomic validated PATCH pair, with exact precision/manual resolution and correction history. Verify on temporary test DB, including unauthorized writes.
- [ ] Add shared LocationEditor and controlled map interaction/resize behavior. Existing pin seeds draft; GPS is explicit and never overwrites an existing draft. Save awaits host callback; errors retain draft. Expand/contract keeps link/pin/view, Escape returns inline, Cancel discards via host.
- [ ] Integrate CRM editable/missing-pin states with canWrite and busy gates, and adapt LocationPinPicker for lead flow. Preserve lead approximate-location choice and skip behavior.
- [ ] Theme enlarge controls using existing tokens and consistent icon alignment/focus states. Preserve isolation boundary around map only. Check hours/enlarged dialogs above preview and pan/zoom behavior.
- [ ] Render history with semantic time and faJalaliDateTime (Tehran, Persian digits). Keep ISO dateTime and cursor data untouched.
- [ ] Run targeted unit/HTTP tests, TypeScript, lint and diff check. Run read-only browser smoke on existing :4000; any browser save check uses an intercept-only PATCH (no live writes). Do not write live customer data. Review final diff.

User approved the combined editor interaction and requested uninterrupted implementation of all pending work. Work stays in the existing dirty workspace to preserve already-applied profile changes; no unrelated commits or resets.
