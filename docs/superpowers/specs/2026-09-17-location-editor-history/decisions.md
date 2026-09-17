# Shared location editor + Jalali history — design decisions (2026-09-17)

Companion plan: `docs/superpowers/plans/2026-09-17-location-editor-history.md`.

## Approved interaction (hybrid inline/expanded editor)
- One reusable editor core (`components/crm/LocationEditor.tsx`) shared by the CRM profile and the lead flow (via the `LocationPinPicker` adapter). One editable map active at a time.
- Inline edit inside the profile card; «بزرگ‌نمایی» expands the same DOM node into a workspace (no remount), so the draft pin, pasted link, link text and map view all survive expand/return.
- Save commits through the host (`onConfirm`); Cancel discards via the host; Escape returns to inline without discarding; read-only enlarge stays read-only.

## Link formats
- Direct coordinates: Google `?q=lat,lng`, `@lat,lng`, `!3d..!4d..` (place pin, preferred over camera centre), `destination=`/`daddr=`, `ll=`, `query=`, separate `lat=`/`lng=`; Neshan `latitude`/`longitude`; Balad `location=lat,lng`; Waze `ll=`/`ul`. Encoded (`%2C`) and integer pairs accepted (`lib/geoLinks.ts`, tested in `tests/geoLinks.test.ts`).
- Short links (maps.app.goo.gl, nshn.ir, waze.com/…): resolved server-side by the existing authenticated `POST /api/crm/resolve-link` with its SSRF guard chain. Unresolved links (no coordinates) show an error and never invent a pin; the draft is preserved.

## Persistence
- `lat`/`lng` are written as one atomic validated PATCH pair (client and `updateBusinessFields` both validate full pairs; range-checked, finite numbers only), setting `location_precision='exact'` and writing the standard correction history row. `maps_url` saved alongside from the editor. Permission checks unchanged (`canWriteBusiness`, salesperson ownership 404).
- Dates stay ISO in SQLite; CRM history renders Jalali/Tehran wall-clock via `faJalaliDateTime` in a semantic `<time dateTime=ISO>` element; cursor pagination data untouched.

## Map fixes
- Overlap root cause: `.mini-map > .map-frame` had no stacking context so Leaflet panes escaped dialogs; fixed with `position:relative; isolation:isolate` on `.meridian .map-frame` (kept, verified by probe and live smoke pan/hit-test).
- «Stuck tiles» in the enlarged sheet: Leaflet's cached pixel size after container resize — fixed by `invalidateSize` via ResizeObserver (`MapLayout` in `CustomerLocationMap`).
- Enlarge button theming: existing tokens (`--card`/`--ink`/`--accent-text`/`--line-2`), consistent icon alignment, hover and `:focus-visible` states.
- Panning inside the lead-flow map no longer swipes its parent sheet away (touchstart stopPropagation on the map container).

## Verification gates used
- Targeted: `tests/crm-location-editor.test.ts`, `tests/crm-location-map.test.ts`, `tests/crm-editing-http.test.ts`, `tests/crm-profile-ui.test.ts`, `tests/geoLinks.test.ts`.
- Full unit suite (296 files / 2295 tests) and `npm test` unit+smoke; live read-only Playwright smoke on :4000 (`CRM_READONLY_SMOKE_URL`) exercising the inline editor, expand/return draft preservation, enlarged-map pan and stacking — with writes blocked at the route layer.
