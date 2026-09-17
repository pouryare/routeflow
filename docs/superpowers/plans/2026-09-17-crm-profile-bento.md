# CRM Profile Bento Implementation Plan

**Goal:** Implement the approved nested bento profile and saved-coordinate mini map on /crm/[id].
**Architecture:** BusinessProfile retains profile/timeline loading and existing intel/contact operations. BusinessDetails owns grouped field rendering, inline editors and a held PATCH; CustomerLocation owns lazy-loaded Leaflet rendering and enlargement. Scoped CSS avoids unrelated map-control WIP.
**Tech stack:** Next 16.3, React 19, TypeScript, existing Leaflet/react-leaflet, Vitest/jsdom and Playwright.

## Approved design and boundaries
- Header: Back and new-order CTA together, followed by business identity. Information first, intel second, then contacts/tags/order summary/history. Verification remains within the first card.
- Nested information groups: identity (name, type, price tier), communication (phone, secondary phone, WhatsApp, Instagram, website), location/hours (area, address, maps URL, working hours).
- All permitted fields show edit/add text and a full-width tap target. Read-only viewers see text, not disabled editors. Choice fields use chips. Text uses inline save/cancel; Escape cancels. Errors stay beside the draft.
- Five-second held field PATCH with undo cancelling before server mutation. No offline queue is claimed. Pending work must not be silently lost on component unmount; attempted changes remain visible on failures. Block concurrent edits during pending/saving.
- Hours reuse HoursPicker, display existing ranges, preserve current hours on skip, and use final answer to submit. Existing multi-range and overnight support is retained.
- Map uses saved finite in-range lat/lng, never a default customer pin. Empty coordinates show a missing-location message. Lazy-load browser-only Leaflet with existing QUIET_TILES and attribution; static overview does not trap scrolling, enlarged native dialog enables exploration. No geolocation requests and no coordinate editing in this scope.
- Preserve contacts and expose already-fetched WhatsApp, best contact time and notes. System-managed owner/source/stage metadata is informational, not a generic editable database dump.
- No changes to preview assets, unrelated map controls, or production database for tests. Do not production-build the running checkout.

## Tasks
- [ ] 1. API tests: PATCH secondary_phone/whatsapp/maps_url; normalized readback, null clearing, invalid inputs, existing scope rejection. Extend fields.ts whitelist and validation, retaining transaction and audit.
  Files: /home/pourya/Desktop/routeflow/tests/crm-editing-http.test.ts; /home/pourya/Desktop/routeflow/lib/repo/crm/fields.ts.
  Run: npm run test:unit -- tests/crm-editing-http.test.ts
- [ ] 2. UI regression tests: card order, top CTA, twelve fields, read-only behavior, inline save/cancel, hours display and map empty state. Run red before implementation.
  File: /home/pourya/Desktop/routeflow/tests/crm-profile-ui.test.ts.
- [ ] 3. Implement isolated BusinessDetails, CustomerLocation/CustomerLocationMap and profile CSS; integrate in BusinessProfile without changing existing intel flow contract.
  Files under /home/pourya/Desktop/routeflow/components/crm/; reuse /home/pourya/Desktop/routeflow/components/crm/HoursPicker.tsx and /home/pourya/Desktop/routeflow/lib/mapLayers.ts.
- [ ] 4. Expand UI tests for held mutation, cancel and failure paths; extend snapshot smoke for new fields, hours, actual map marker, enlargement and persistence. Update old Instagram selector to explicit add/edit name.
  Files: /home/pourya/Desktop/routeflow/tests/crm-profile-ui.test.ts; /home/pourya/Desktop/routeflow/tests/smoke/crm-profile.test.ts.
- [ ] 5. Verify targeted tests, tsc, lint, and snapshot browser test; inspect desktop/mobile screenshots and final diff. Report any unrun full-suite checks explicitly.

Validation commands (workspace /home/pourya/Desktop/routeflow):
```sh
npm run test:unit -- tests/crm-editing-http.test.ts tests/crm-profile-ui.test.ts tests/crm-hours.test.ts
npx tsc --noEmit
npx eslint components/crm/BusinessProfile.tsx components/crm/BusinessDetails.tsx components/crm/CustomerLocation.tsx components/crm/CustomerLocationMap.tsx lib/repo/crm/fields.ts
npm run test:smoke -- tests/smoke/crm-profile.test.ts
```
