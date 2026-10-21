# Future features (parked, not planned)

Ideas that would remove the most manual entry on a phone but are ambitious or risky. Each is **parked on purpose**: when one is picked up, it gets its own spec in `docs/superpowers/specs/` and its own plan. Until then nothing here is promised.

Every item must end in a **confirmation tap flow** (`docs/tap-flow-principles.md`): the machine proposes, the person confirms with one tap, and the usual 5 s undo applies. Nothing the machine reads is saved without that confirmation.

Origin: the 2026-10-20 mobile-first brainstorm. The pieces that are *not* ambitious live in `docs/superpowers/plans/2026-10-20-mobile-first-interaction-patterns.md`.

---

## F1. Camera capture (read a document instead of typing it)

**What:** point the phone at a paper and get a pre-filled confirmation sheet.

| Source | Fills | Used by |
|---|---|---|
| Cheque | cheque number, bank, amount, due date (Jalali), payer name | `paymentFlow` cheque branch, `/sales/cheques` |
| Supplier invoice / receipt | supplier, date, total, lines if legible | `expenseFlow`, `PurchaseEntry` |
| Delivery note / signed receipt | attaches as a photo to the stop | `DeliveryFlow` done screen |
| Batch label (QR / barcode) | product, batch code, expiry | `receiveFlow`, `stockCountFlow` |

**Why parked:** Persian cheque and invoice OCR accuracy is uncertain, handwriting is worse, and it needs a decision on where recognition runs (on device, or sent to a service, which means customer data leaves the device).

**Open questions to settle in the spec**
1. On-device (Tesseract/ML Kit via WebAssembly, works offline, lower accuracy) or a server/vision-model call (better, needs signal and a privacy decision)?
2. Do we keep the photo? `photos` and `/api/photos` exist, so storage is solved; retention is not.
3. Barcode/QR needs no OCR (`BarcodeDetector` API or a small JS decoder) and could ship **first** as its own small feature: scan a batch label, skip typing the code.
4. Field-by-field confidence: low-confidence fields are highlighted for the person to retype rather than silently accepted.

**Suggested first slice (small, low risk):** QR/barcode scan for batch code in `receiveFlow`. Cheque OCR second. Invoice OCR last.

**Prerequisites:** TapFlow plan Phases 0, 2 and 6 (amount step, payment/cheque flow, receive flow).

---

## F2. Voice input (speak instead of typing a note)

**What:** a press-and-hold microphone button next to every optional note field (`tf-input` on the `note` steps, complaint description, visit notes, reminder text). Persian speech to text, shown as editable text before saving.

**Why parked:** Persian recognition quality varies by accent, noise and phone; browser `SpeechRecognition` support is uneven (works in Chrome Android, unreliable elsewhere, often cloud-backed); vans are noisy.

**Open questions**
1. Browser API (`webkitSpeechRecognition`, free, cloud-backed, Chrome-only) or a hosted model?
2. Is audio ever stored? Default answer: no, text only.
3. Does it work offline? Probably not; the button hides when offline.
4. Which roles want it? Ask drivers and phone sales before building.

**Suggested first slice:** a `VoiceNoteButton` that only appears where `SpeechRecognition` is available and `navigator.onLine` is true, inserted into the TapFlow `input` step only. Measure how often it is used and corrected before expanding.

**Prerequisites:** TapFlow plan Phase 0.

---

## F3. Paste-to-parse (turn a pasted message into a draft)

**What:** paste a WhatsApp/Telegram/SMS message and get a draft to confirm.

| Pasted text | Draft |
|---|---|
| "سلام، ۱۰ کارتن شیر و ۵ ماست برای فردا بفرستید" from a customer | order draft for that customer: lines, delivery day |
| A lead's details ("نانوایی X، ۰۹۱۲…، خیابان…") | add-lead draft (`AddLeadFlow` basics + link) |
| A payment confirmation ("واریز ۵ میلیون") | payment draft (`paymentFlow`) |

**Why parked:** needs a parser that copes with informal Persian, Persian/Arabic digits, units ("کارتن", "بسته", "کیلو"), and fuzzy product names. The lead-import decoder (`app/api/geo/decode-link`, `components/leadImport/DecodeConsole`) already shows the pattern for links; free-text is much harder.

**Open questions**
1. Rule-based (regex + product-name fuzzy match against the catalogue; predictable, offline, limited) or an LLM call (flexible, needs signal, needs a data-handling decision)?
2. How is a customer matched when the sender is a phone number: `customers.phone_norm` exact match first.
3. Share-target: register the PWA as a share target so "Share → RouteFlow" works straight from WhatsApp (`share_target` in `app/manifest.ts`).
4. **Ask first:** do phone sales actually receive orders as messages? If not, drop this.

**Suggested first slice:** share-target + order drafts using rule-based matching against `readCatalogue()`, confirmation via `orderQuickFlow`'s final screen.

**Prerequisites:** TapFlow plan Phase 5 (`orderQuickFlow`).

---

## F4. Wazo VoIP inside the CRM/ERP (call from, and log to, the customer record)

**What:** use [Wazo](https://wazo.io) (open-source, API-driven telephony platform) as the phone system behind RouteFlow, so calls are placed, received and recorded inside the app instead of in a separate dialer.

| Moment | What the app does | Used by |
|---|---|---|
| Salesperson taps a phone number | click-to-call through Wazo (the user's softphone/desk phone rings, then the customer) | call list, customer page, lead page |
| Incoming call | screen pop: caller matched by `customers.phone_norm` (or lead), shows open orders, balance, last visit | phone sales, group manager |
| Call ends | proposes a call-outcome sheet (outcome, note, recall date, optional follow-up task) pre-filled with number, direction and duration | existing call-outcome step of `AddLeadFlow` / CRM |
| Missed call | alert + task "call back" on the customer | tasks board, notifications |
| Manager review | call history per customer, per rep, per day (talk time, answered/missed) | analytics |

**Why parked:** needs a Wazo server (self-hosted or hosted) and SIP trunk with an Iranian carrier; WebRTC softphone in a PWA is unreliable on locked phones (calls arrive only when the app is open); call recording has legal and consent implications; per-tenant isolation (one Wazo tenant per RouteFlow organisation) must be designed.

**Open questions to settle in the spec**
1. Integration level: click-to-call and call logging through the Wazo REST API plus webhooks/websocket events (small, server-side) or an in-browser WebRTC softphone (large)? Phones keep using a normal SIP app or the native dialer first.
2. Where does Wazo run, and which carrier/trunk provides the numbers? Does it work on the deployment network (`deploy/`)?
3. Identity mapping: RouteFlow user ↔ Wazo user/extension, organisation ↔ Wazo tenant. Where are Wazo credentials stored (per organisation, encrypted)?
4. Recording: off by default; if on, who is told, how long is audio kept, and who may play it back?
5. Number matching: normalise Persian digits and `+98`/`09…` forms before matching `phone_norm`; what happens when two customers share a number?
6. Offline/PWA: logging must queue and sync when the connection returns; the call itself needs signal anyway.

**Suggested first slice (small, low risk):** server-side only. A Wazo webhook endpoint that writes a call-log row (number, direction, duration, matched customer/lead, user) and a click-to-call button on the customer and lead pages that asks Wazo to originate the call. No softphone, no recording, no screen pop. Call-outcome capture reuses the existing confirmation sheet, so nothing is saved without a tap.

**Prerequisites:** a reachable Wazo instance and a decision on the carrier/trunk (infrastructure, not code). In code: the call-outcome step and `customers.phone_norm` already exist.

---

## How to promote an item

1. Write `docs/superpowers/specs/YYYY-MM-DD-<item>-design.md` (answer the open questions, pick the first slice).
2. Write the plan with `writing-plans`.
3. Add the new flow/step to the design rules (`docs/mobile-first-principles.md`, once it exists) so it follows the same anatomy.
