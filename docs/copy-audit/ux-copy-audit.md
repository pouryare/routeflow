# RouteFlow UX Copy Audit

Method: `design:ux-copy` principles (clear, concise, consistent, useful, human) applied to every Persian
string in `app/`, `components/` and `lib/` — 4,270 source lines, ~400 distinct error strings, ~1,400 short labels
(buttons, tabs, placeholders, empty states). Counts below are occurrences in source, not page views.

**Not covered:** `lib/db.ts` seed text (notification-rule names), `content/academy/*` lesson text, and live
screenshots. **Caveat:** rewrites are proposals from a non-native reviewer — have a native Persian editor
approve them before they ship.

**Why the existing audit missed this:** `scripts/audit-copy.mjs` reads only `app/(shell)/**/page.tsx`
(296 strings). It never opens `components/` or `app/api/`, where the buttons, toasts and error messages live.

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

### 3. «لغو» and «انصراف» mean different things but are used loosely

`لغو` 24×, `انصراف` 8×, `بستن` 24×. «لغو» labels both "dismiss this form" (`AddReminder.tsx:97`) and domain cancellation
(order cancel, toast undo). A user can't tell a harmless dismiss from a destructive cancel.
**Recommendation:** «انصراف» = leave without saving, «بستن» = close a panel, «لغو سفارش» / «لغو چک» = the domain action,
always with its noun.

---

## P2 — fix next

### 4. «ثبت» is carrying too much (287 uses)

It means save, submit, record, register, and create. Bare or vague uses:
- Bare button «ثبت» — `admin/holidays/page.tsx:139`; bare «تکمیل» — `RepDefinitions.tsx:256`; bare «ایجاد» — `RepDefinitions.tsx:177`.
- «ثبت و سپردن» (`LeadRunPlannerTabFlow.tsx:305`, `leadRun.ts:41`): «سپردن» ("entrust") isn't a task verb. Suggest «ثبت و ارسال به راننده» (check this is what the action does).
- «ثبت پلن», «ثبت نرخ», «ثبت قیمت»: fine, but nearby «ذخیره» (34×) is used for the same kind of action.

**Rule:** «ذخیره تغییرات» = editing an existing record; «افزودن X» = adding a row; «ثبت X» = recording an event with its noun
(«ثبت دریافت», «ثبت تحویل»). Never a bare verb. Also pick one of ساخت (59) / ایجاد (1) / افزودن (40) per context.

### 5. Confirmation dialogs

- Two native `window.confirm()` calls (`admin/groups/page.tsx:87`, `meridian/SearchOverlay.tsx:119`). The browser draws
  the buttons (OK / Cancel in the browser's language), so they can't say «حذف گروه» / «نگه‌داشتن». The impersonation warning
  in `SearchOverlay.tsx:119` is long and important enough for an in-app dialog.
- Inline confirms answer with «بله» (`LeadListsBar.tsx:170`) or «بله، …» (`BusinessProfile.tsx:26,195,201`). Label the button with the
  action («حذف فهرست»), and say whether it can be undone («این فهرست حذف شود؟» → «فهرست «X» حذف شود؟ این کار قابل بازگشت نیست.»).

### 6. Terminology drift (one word per thing)

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

### 7. Empty states state a fact but offer no next step

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
| انصراف (leave form) · بستن (close panel) · لغو ‹noun› (domain cancel) | bare «لغو» |
| ذخیره تغییرات · افزودن ‹noun› · ثبت ‹noun› | bare «ثبت» / «تکمیل» / «ایجاد» |
| «‹کار› نشد. ‹دلیل›؛ دوباره تلاش کنید.» | خطا در… / انجام نشد / ناموفق بود / ممکن نشد |

## Proposed order of work

1. Error layer: map API errors to friendly messages and rewrite the failure toasts (P1 #1–2). Highest user impact.
2. Glossary renames plus new guards in `tests/vocabulary.test.ts` (P2 #6, P1 #3).
3. Button labels, confirmation dialogs, empty states (P2 #4, #5, #7).
4. Extend `scripts/audit-copy.mjs` to scan `components/` and `app/api/` so these checks run automatically.
