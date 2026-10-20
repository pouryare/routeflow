# RouteFlow UX Copy Audit

Method: `design:ux-copy` principles (clear, concise, consistent, useful, human) applied to every Persian
string in `app/`, `components/` and `lib/` — 4,270 source lines, ~400 distinct error strings, ~1,400 short labels
(buttons, tabs, placeholders, empty states). Counts below are occurrences in source, not page views.

**Not covered:** `lib/db.ts` seed text (notification-rule names), `content/academy/*` lesson text, and live
screenshots. **Caveat:** rewrites are proposals from a non-native reviewer — have a native Persian editor
approve them before they ship.

## Rules this audit applies (set by the product owner)

1. **Every action label is self-explanatory.** It names the action *and its object*: «بستن پنل», not «بستن» or «لغو».
   The reader is a novice with no technical literacy; the label alone must say what will happen.
2. **No bare verbs, anywhere** — including toast actions, dialog buttons and icon buttons. A visible text label is required;
   an icon with only an `aria-label` does not count, because sighted novices never see it.
3. **Labels name actions, not states.** Present-tense action or noun form («ثبت بازدید»), never past tense on a button («بله، ثبت شد»).
4. **Built for repetition.** Some flows run up to ~200× a day (delivery stops, calls, visits, order entry). In those flows
   wording and position never change between repetitions, a wrong tap must be cheap to reverse, and the destructive action
   must never look like the frequent one (see "High-frequency workflows" below).

**Why the existing audit missed this:** `scripts/audit-copy.mjs` reads only `app/(shell)/**/page.tsx`
(296 strings). It never opens `components/` or `app/api/`, where the buttons, toasts and error messages live.

## Implementation status

**Done**
- High-frequency flows (P1 #4): geofence prompt, next-stop bar, driver run, unload, visit verification, after-call, task row, quick-add, planner rows. Task deletion takes an explicit second tap; there is no undo for it because the API cannot reopen a dismissed task.
- Error layer (P1 #1–2): `lib/userMessage.ts` (`friendlyError`) wraps every place the client shows a server message; ~100 failure messages follow «X نشد؛ دوباره تلاش کنید»; English field names removed from API messages; whole-toman validators say «…را به تومان و بدون اعشار وارد کنید».
- Bare-verb labels (P1 #3): replaced across the app and in the tap-flow definitions (`lib/crm/flows/*.ts`); `CopyButton` always shows text; undo is «بازگردانی …» everywhere (`docs/tap-flow-principles.md` updated); every close button (sheets, search overlay, customer panel, layers panel, district editor, shortcut help) shows «بستن …» next to the icon and has a matching accessible name.
- Glossary: جستجو, لینک, گوگل‌مپ, تأیید, سرنخ, «سفارش تازه» (UI, seeded rules and notification types, with `REWORDED` entries so existing installs update in place), no «لوکیشن». The Kanban column now reads «سرنخ‌های تازه».
- Every browser dialog is gone (`window.confirm/prompt/alert`): group delete and rename, payment void (with its reversing-entry explanation), cheque replacement (Shamsi date picker instead of a typed ISO date), password reset (masked field), and both "view as another user" entry points (nothing is sent until the confirm button is tapped).
- Empty states say what to do next; double negatives rewritten; placeholder-only inputs have accessible names; ellipses unified; the driver's nav tab no longer repeats its group's name.
- Guards: `tests/no-bare-verb-labels.test.ts`, `tests/no-native-dialogs.test.ts`, `tests/userMessage.test.ts`, extra entries in `tests/vocabulary.test.ts`.
- `scripts/audit-copy.mjs` now also writes `docs/copy-audit/catalogue-wide.md` (flagged-only) covering `components/`, `app/api/` and tap flows, with bare-label and developer-jargon detectors.
- Found while checking in a browser: the driver page returned 500 because the unload sheet imported its constants from a module that opens the database. Fixed (`lib/unloadDispositions.ts`).

**Decision recorded — مکان vs موقعیت.** Both stay, with fixed meanings: **مکان** is a place the business keeps a record of (a customer, lead or depot, as in «مکان‌های ما»); **موقعیت** is a position on the map (a GPS fix or a pin: «موقعیت من», «ثبت موقعیت»). Neither is renamed.

**Also fixed (found by running the smoke suite)**
- Bottom sheets (customer sheet, tap-flow sheet) opened at the bottom of the *card* they were opened from, about 6 800 px down a long orders list, because a `position: fixed` element is placed against its nearest transformed ancestor and the scroll-reveal leaves a `transform` on every card. They now draw into the `.meridian` root (`components/meridian/useSheetHost.ts`).
- Income statement: a missing React `key` on the expense rows.
- Smoke harness: waited on scroll-driven animations that never finish, listed redirect pages as routes, and slept a fixed time for the sheet slide-in; all corrected.

- Visible labels on every data-entry field that only had a placeholder (users, groups, places, login, reminders, quick-add, purchases, cheques, complaints, batches, payment void). Search boxes keep their placeholder, and tap-flow fields are labelled by the question above them.
- The next-stop bar's dismiss button now reads «پنهان کردن نوار», and the bar wraps on phones.
- `/report` threw «no such column: organization_id» for every owner: it applied the tenant filter to `districts`, which is shared reference data with no such column. Regression test added in `tests/tenancy-scoping.test.ts`.
- The planner and leads maps logged «Cannot read properties of null (reading 'removeLayer')»: a routing answer arriving after the control was removed. Late answers are now ignored (`lib/guardedRouter.ts`).
- Cheques form: the date field overlapped the submit button on phones.

**Open**
- Smoke suite (`npm run test:smoke`), run here against a freshly seeded demo database: 164 passed, 1 failed. The failure is the `/leads` console check, caused by a blocked request to the public OSRM demo server (this environment has no internet). Run it once in a networked environment.
- Flagged rows in `catalogue-wide.md` are review candidates, not all defects (e.g. file names ending in `.csv`, search keywords).

---

## What already works (keep)

- Error pages use a clear eyebrow / title / hint triad: «این نشانی به جایی نمی‌رسد», «این صفحه بدون اینترنت در دسترس نیست».
- Some failures already follow what + why + fix. These are the template for the rest:
  - «دسترسی اعلان مسدود شده — از تنظیمات مرورگر فعال کنید» (`NotificationSettings.tsx:165`)
  - «ذخیره نشد؛ دوباره امتحان کنید» (`AfterCallFlow.tsx:89`)
  - «مسیر خالی شد.» with an undo action «بازگردان» (`useLeads.ts:217`)
- Confirmations that state the consequence: «گروه «X» حذف شود؟ محدوده‌هایش بدون گروه می‌شوند.» (`admin/groups/page.tsx:87`).
- One register throughout (formal «شما»), consistent «» quoting, and retired-word guards in `tests/vocabulary.test.ts`.

---

## P1 — fix first

### 1. Developer-facing validation messages reach users

API routes return terse validation strings and the UI shows them as-is (`toast(data.error …)` in
`DistrictEditor.tsx:57`, `CustomerDetailPanel.tsx:185`, `OrderPipeline.tsx:109`, `login/page.tsx:48`).

| Seen by user | Count / location | Problem |
|---|---|---|
| «شناسه نامعتبر است» | 25× `api/activity/route.ts:80` and others | User can't act on it; "ID" means nothing to them |
| «یافت نشد» | 20× `api/activity/route.ts:89` | Found *what*? |
| «بدنه درخواست نامعتبر است» | 8× `api/activity/route.ts:74` | "Request body" is pure jargon |
| «id لازم است», «code لازم است», «entity نامعتبر», «metric نامعتبر», «مقدار enabled نامعتبر است», «lat, lng و date لازم است» | `api/alerts`, `api/rules`, `api/predict/demand`, `api/notifications/prefs`, `api/sales/weather` | English field names leak into a Persian UI |
| «قیمت باید عدد صحیح تومان باشد: ${input.price_toman}» | `lib/catalogue.ts:181`, `lib/commissionLedger.ts:67`, `lib/purchases.ts:69` | Prints a raw variable and asks for an "integer" |
| «داده تصویر N بایت است، انتظار M بایت بود» | `lib/escpos.ts:74` | Byte counts on a receipt-printing failure |

**Recommendation:** split errors into two tiers.
- *Malformed-request errors* (bad id, bad body, unknown enum) can't be caused by a user. Show one friendly line, log the detail:
  «این کار انجام نشد. صفحه را تازه کنید و دوباره تلاش کنید.»
- *Field errors* a user can cause name the field and say how to fix it:
  «قیمت را به تومان و بدون اعشار وارد کنید.» instead of «…عدد صحیح تومان باشد: 12.5».

### 2. Failure messages say that it failed, not why or what to do

Six patterns for the same situation: «خطا در X» (51), «X انجام نشد» (20), «X ناموفق بود» (10), «X ممکن نشد» (6),
«X نشد» (`ثبت نشد` 64, `ذخیره نشد` 10), and a bare «خطا» (`api/admin/groups/[id]/route.ts:55`, 8×).
Worst offenders:

| Current | Where | Suggested |
|---|---|---|
| «خطا در حذف» | `planner/page.tsx:384` | «حذف نشد. اتصال برقرار نشد؛ دوباره تلاش کنید.» |
| «خطا در بازگردانی» | `planner/page.tsx:365`, `facilities/page.tsx:159` | «بازگردانی نشد؛ دوباره تلاش کنید.» |
| «انجام نشد» (9×, no subject at all) | `admin/holidays/page.tsx:43` | Name the action: «تعطیلی ثبت نشد؛ دوباره تلاش کنید.» |
| «ثبت نشد» (8×, no object) | `DriverRun.tsx:233` | «تحویل ثبت نشد. اینترنت را بررسی کنید و دوباره بزنید.» |
| «خطا» | `api/admin/groups/[id]/route.ts:55` | Same as above |

**Recommendation:** one pattern — «‹کار› نشد. ‹دلیل، اگر معلوم است›؛ ‹کار بعدی›.» Retry wording is also split
(`تلاش دوباره` 9, `دوباره تلاش کنید` 5, `دوباره امتحان کنید` 4, `امتحان کنید` 5) — standardize on «دوباره تلاش کنید».

### 3. Bare-verb labels (rules 1–2): 77 occurrences

Labels that never say what they act on. «لغو» also carries three meanings at once: dismiss a form (`AddReminder.tsx:97`),
cancel a domain object (order, cheque), and undo (toast action, `VerifyVisits.tsx:53`, `AfterCallFlow.tsx:93`) — while other
toasts say «بازگردان» for undo (`NextStopBar.tsx:101`, `useLeads.ts:217`). A novice cannot tell a harmless dismiss from a destructive cancel.

| Bare label | Count (example) | Replace with |
|---|---|---|
| بستن | 12 (`gallery/page.tsx:151`, `DriverRun.tsx:128`) | بستن عکس · بستن رسید · بستن پنل … |
| لغو | 9 (`AddReminder.tsx:97`, `QuickAdd.tsx:96`) | انصراف از یادآوری · انصراف از یادداشت · لغو سفارش |
| انصراف | 8 (`facilities/page.tsx:299`, `UnloadTapFlow.tsx:160`) | انصراف از افزودن مکان · انصراف از تخلیه |
| حذف | 8 (`holidays/page.tsx:185`, `TaskRow.tsx:62`) | حذف این تعطیلی · حذف این کار |
| ذخیره | 5 (`facilities/page.tsx:291`, `QuickAdd.tsx:92`) | ذخیره مکان · ذخیرهٔ یادداشت |
| ادامه | 4 (`LinkStep.tsx:49`) | ادامه و خواندن لینک (say what the next step is) |
| ویرایش | 4 (`BusinessProfile.tsx:127`) | ویرایش مشخصات · ویرایش مخاطب |
| جدید | 4 (`PoolViewKanban.tsx:80`) | سرنخ‌های تازه (if it is a column title) |
| افزودن | 3 (`BusinessDetails.tsx:142`) | افزودن مخاطب · افزودن ساعت کاری |
| ثبت | 3 (`holidays/page.tsx:139`) | ثبت تعطیلی |
| نقشه | 3 (`not-found.tsx:21`, `NextStopBar.tsx:176`) | نمایش روی نقشه |
| بعدی / قبلی | 4 (`PaymentsPanel.tsx:498`) | صفحهٔ بعد · صفحهٔ قبل |
| تأیید · تکمیل · ایجاد · بله · بعداً · بازگشت | 1–2 each | name the object, e.g. «تأیید سفارش», «حذف فهرست» instead of «بله» |

Undo needs one name everywhere. Proposal: toast action «بازگردانی ثبت» (with the 5 s countdown), and keep «لغو»/«انصراف»
only in the noun-bearing forms above. Note `docs/tap-flow-principles.md` currently specifies bare «لغو» for undo and would need the same update.

### 4. High-frequency workflows (rule 4)

Screens used all day: driver run (`NextStopBar`, `DriverRun`, `UnloadTapFlow`, `VerifyVisits`), calls (`AfterCallFlow`),
tasks (`TaskRow`), geofence prompts, quick notes (`QuickAdd`), order entry. At ~200 repetitions a day, small wording
problems become daily mistakes. Findings from those files:

| # | Problem | Where | Fix |
|---|---|---|---|
| a | **Question and answer disagree in tense.** The prompt asks «بازدید ثبت شود؟» ("should the visit be recorded?") but the confirm button says «بله، ثبت شد» ("yes, it was recorded"). The dismiss button «بعداً» ("later") doesn't say whether the prompt will return. | `GeofenceWatcher.tsx:225,240,248` | «ثبت بازدید» / «الان نه» — or «ثبت بازدید» / «ثبت نکن»; decide whether "not now" re-prompts and say so |
| b | **Icon-only "done" button** for the most-repeated action. The label «انجام شد» exists only as `aria-label`/`title`, so a novice sees a bare checkmark; and «انجام شد» doesn't say *what* was done (delivered? visited?). | `NextStopBar.tsx:183-184` | Visible text: «ثبت تحویل این توقف» (or «ثبت بازدید این توقف» by stop type) |
| c | **Destructive action sits beside the primary one, looks like a caption.** A small faint «حذف» with a trash icon is next to «ثبت نتیجه»; it resolves the task with one tap. Verify an undo exists. | `TaskRow.tsx:51-62` | «حذف این کار», visually separated, with the 5 s undo toast naming the task |
| d | **Loading state erases the label.** The button becomes «…» or «...» so the user can't tell *what* is being submitted or whether to tap again. | `DriverRun.tsx:359`, `GeofenceWatcher.tsx:240` | Keep the noun: «در حال ثبت تحویل…», disabled |
| e | **Same action, different words each time.** Record-visit is «ثبت بازدید» (button, `VerifyVisits.tsx:74`), «بازدید ثبت شد» (toast), «بله، ثبت شد» (geofence); `+ بازدید` and `+ سفارش` (`Pocket.tsx:216,219`) are bare plus-signs. | multiple | One label per action, reused in button, toast and undo: «ثبت بازدید» → «بازدید از «X» ثبت شد» → «بازگردانی ثبت بازدید» |
| f | **Toasts that don't say which record.** Good: «بازدید از «X» ثبت شد.» (`GeofenceWatcher.tsx:144`). Weak: «یادداشت ثبت شد.» (`QuickAdd.tsx:39`), «ثبت شد» (`BusinessProfile.tsx:60,72`), «ذخیره شد» (`LocationTapFlow.tsx:55`). Naming the record is what lets a tired user catch a wrong-record tap. | listed | Always include the name or number |
| g | **Limits are checked after the tap.** E.g. «تعداد تحویل‌شده از تعداد سفارش بیشتر است» comes from the server (`lib/delivery.ts:414`). Verify the delivery form also stops it inline. | `DriverRun.tsx:305-336` | Inline hint under the field before the user can submit: «بیش از سفارش (۱۲ بسته) نمی‌شود» |
| h | **Confirm vs undo.** Don't add «آیا مطمئنید؟» to frequent, reversible actions — at 200×/day people stop reading it. The 5 s undo already used in tap flows is the right pattern; reserve a confirm dialog for irreversible actions and give *that* button a distinct, explicit label («حذف دائمی فهرست»). | app-wide | Keep undo for frequent actions; confirm only for irreversible ones |
| i | **Register.** Most copy is polite («کنید»), but some actions are informal imperatives: «+ یادآوری بگذار» (`QuickAdd.tsx:65`), «بازگردان», «همین حالا برگرد». | listed | Use noun form («ثبت یادآوری», «بازگردانی ثبت») — also fixes consistency |

**Length check:** explicit labels are longer in Persian. Keep them to a verb-noun pair of ≤ 3 words, let buttons wrap, and keep the
tap target ≥ 52 px (the tap-flow rule) so the label never gets shortened to fit.

---

## P2 — fix next

### 5. «ثبت» is carrying too much (287 uses)

It means save, submit, record, register, and create. Bare or vague uses:
- Bare button «ثبت» — `admin/holidays/page.tsx:139`; bare «تکمیل» — `RepDefinitions.tsx:256`; bare «ایجاد» — `RepDefinitions.tsx:177`.
- «ثبت و سپردن» (`LeadRunPlannerTabFlow.tsx:305`, `leadRun.ts:41`): «سپردن» ("entrust") isn't a task verb. Suggest «ثبت و ارسال به راننده» (check this is what the action does).
- «ثبت پلن», «ثبت نرخ», «ثبت قیمت»: fine, but nearby «ذخیره» (34×) is used for the same kind of action.

**Rule:** «ذخیره تغییرات» = editing an existing record; «افزودن X» = adding a row; «ثبت X» = recording an event with its noun
(«ثبت دریافت», «ثبت تحویل»). Never a bare verb. Also pick one of ساخت (59) / ایجاد (1) / افزودن (40) per context.

### 6. Confirmation dialogs

- Two native `window.confirm()` calls (`admin/groups/page.tsx:87`, `meridian/SearchOverlay.tsx:119`). The browser draws
  the buttons (OK / Cancel in the browser's language), so they can't say «حذف گروه» / «نگه‌داشتن». The impersonation warning
  in `SearchOverlay.tsx:119` is long and important enough for an in-app dialog.
- Inline confirms answer with «بله» (`LeadListsBar.tsx:170`) or «بله، …» (`BusinessProfile.tsx:26,195,201`). Label the button with the
  action («حذف فهرست»), and say whether it can be undone («این فهرست حذف شود؟» → «فهرست «X» حذف شود؟ این کار قابل بازگشت نیست.»).

### 7. Terminology drift (one word per thing)

| Concept | Variants in code | Proposed |
|---|---|---|
| Search | جستجو 24 · جست‌وجو 3 (`GroupTerritoryEditor.tsx:92`, `InventoryBoard.tsx:119,149`) | جستجو |
| Link | لینک 37 · پیوند 19 · آدرس 26 — e.g. «پیوند گوگل‌مپ» (`LocationEditor.tsx:105`) vs «لینک» (`LinkStep.tsx:41`); spellings گوگل‌مپ / گوگل‌مپس | لینک; reserve آدرس for postal address |
| New order | «سفارش تازه» (5) vs «سفارش جدید» (5): page title «سفارش جدید» (`pageMeta.ts:112`), button «ثبت سفارش تازه» (`orders/page.tsx:118`) | سفارش تازه (matches the app's تازه 44 : جدید 27) |
| Lead | «لید» in `planner/page.tsx:778` vs «سرنخ» (36) elsewhere | سرنخ |
| Location | لوکیشن (`PoolViewCluster.tsx:74`) · موقعیت 56 · مکان 96 · پین 13 («پین‌های نقشه» is the nav label for `/leads`) | Confirm intended glossary — مکان vs موقعیت may be deliberate |
| Confirm | «تایید و ثبت» (`leadRun.ts:37`) vs تأیید ×74 | تأیید |
| Required field | لازم است 38 · الزامی است 12 · وارد نشده 4 · وارد کنید 5 | Instruction form: «نام مکان را وارد کنید» (already used at `facilities/page.tsx:119`) |
| Invalid | نامعتبر است 157 · معتبر نیست 41 | Say what is wrong, not that it's "invalid" |

Add the unambiguous pairs to `tests/vocabulary.test.ts` (`جست‌وجو`, `لوکیشن`, `تایید`) so they stay fixed.

### 8. Empty states state a fact but offer no next step

~25 strings follow «هنوز X ثبت نشده است» with no way forward, e.g. «هنوز فهرستی ساخته نشده است.» (`LeadListsBar.tsx:106`),
«هنوز مکانی ثبت نشده است.» (`PlacePicker.tsx:90`), «هنوز فروشنده‌ای ثبت نشده است.» (`commission/page.tsx:115`).
Add the action: «هنوز فهرستی ندارید. با «فهرست تازه» اولین فهرست را بسازید.»

Vague or negative-phrased ones:
- «اینجا چیزی نیست.» (`CrmBoard.tsx:114`), «موردی نیست» (`BoardMobile.tsx:152`), «خالی» (`Board.tsx:370`), «کاری برای نمایش نیست.» (`Pocket.tsx:255`) — say what would normally be here and why it's empty (filter? nothing yet?).
- Double negatives: «هیچ مشتری فعالی بیش از ۳۰ روز بدون خرید نیست» (`CoverageMap.tsx:1674`) → «همهٔ مشتریان فعال در ۳۰ روز گذشته خرید داشته‌اند.»; «مشتری پرخطری نیست.» → «مشتری پرخطری ندارید.»

---

## P3 — polish

- **Placeholder as the only label.** `BatchesPanel.tsx:134-136`, `ChequesBoard.tsx:123-136`, `ComplaintsPanel.tsx:166` appear to rely on placeholders
  («مبلغ (تومان)», «شمارهٔ چک», «بانک», «توضیح»), which vanish while typing. Verify a visible label exists; if not, add one.
- **Ellipsis style.** «…» is the norm; `DistrictEditor.tsx:124` («در حال ذخیره...») and `login/page.tsx:113` («در حال ورود...») use three dots.
- **Navigation duplicates.** Group «روز من» and its first item «روز من» (`appNav.ts:33,88`); «آموزش» appears in two groups (`appNav.ts:89,156`).
- **Loading copy** is fine («در حال بارگذاری…»). Where a wait is long (printing, import parsing) add the expected duration or progress, as `ReceiptPrinter` already does with «(۳ از ۱۰)».

---

## Suggested glossary (needs your sign-off before any code changes)

| Use | Not |
|---|---|
| جستجو | جست‌وجو |
| لینک | پیوند، آدرس (for URLs) |
| سفارش تازه | سفارش جدید |
| سرنخ | لید |
| تأیید | تایید |
| Every action = verb + object: «بستن پنل», «انصراف از تخلیه», «لغو سفارش», «حذف این کار», «ذخیرهٔ یادداشت» | any bare «بستن» / «لغو» / «انصراف» / «حذف» / «ذخیره» / «ثبت» / «ادامه» / «بله» |
| «ثبت ‹noun›» for recording events · «افزودن ‹noun›» for adding a row · «ذخیره ‹noun›» for editing | bare «تکمیل» / «ایجاد»; past tense on buttons («بله، ثبت شد») |
| Undo = «بازگردانی ثبت» (one name, everywhere) | «لغو» or «بازگردان» as undo |
| Visible text on every button, including the most frequent one | icon-only buttons with only `aria-label` |
| «‹کار› نشد. ‹دلیل›؛ دوباره تلاش کنید.» | خطا در… / انجام نشد / ناموفق بود / ممکن نشد |

## Proposed order of work

1. High-frequency flows first (P1 #4, #3): driver run, geofence prompt, task row, quick-add, after-call. Highest daily error exposure.
2. Error layer: map API errors to friendly messages and rewrite the failure toasts (P1 #1–2).
3. Remaining bare-verb labels across the app, glossary renames, dialogs, empty states (P2).
4. Guards so it stays fixed: extend `tests/vocabulary.test.ts` with the retired variants, and add a test that fails on any
   bare-verb button label from the table in P1 #3. Extend `scripts/audit-copy.mjs` to scan `components/` and `app/api/`.
