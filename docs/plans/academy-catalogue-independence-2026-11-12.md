# Academy, van catalogue and operational independence: plan

_Plan, 2026-11-12. Requested by the owner after the review of four ChatGPT conversations (operational independence, 25 system types, CRM data points). The owner chose to plan everything good in it, and asked for the Academy and a catalogue for van roles "now". Everything below was discussed and decided in the thread; nothing is built._

Discussion note with the full comparison: `notes/academy-catalog-operational-independence-features-2026-11-12.md` in the project files.

## 1. The short answer

A new person, or a person covering for someone, should be able to do the job from the app alone. Three pieces:

1. **Academy that a company can fill.** Lessons shipped with the app (general and app related, the same for every company), and lessons the company writes itself in its own categories.
2. **A catalogue for the van.** A driver or field rep at a shop's door can find a product, see this shop's price, the photo, the packings and what is on the van, and add it to an order.
3. **Handover and cover.** One button to hand a person's customers, leads and tasks to a colleague with the history kept; lend them for N days; a cover card for someone on leave.

## 2. Decisions (owner, 2026-11-12)

| Question | Answer |
|---|---|
| Plan operational independence, all the good features | Yes |
| Academy now | Yes. Lessons shipped with the app are general or about using the app. Each company adds its own lessons in categories of its own |
| Catalogue now, for van roles first | Yes |
| What the van does with the catalogue | **Both, in two steps.** Step 1: take orders for later (van stock shown, marked approximate). Step 2: sell from van stock at the door, after van loading (F30) exists |
| Who writes company lessons | **Owner, managers (their own group) and any «مربی» (trainer)**, a new permission the owner can give to anyone, for example a senior driver |
| Quizzes | **Next slice.** First slice finishes a lesson with a «خواندم» button |
| Libraries and storage | **No new library.** Lessons in the database per company; photos in the company's own storage (docs/storage.md) opened in the existing photo viewer; plain text editor with headings and photos; the price list saved as a picture or PDF with the browser print we already use |
| Practice mode (F39) | **Later**, design not decided now. Tutorials with demo data cover the first weeks |

## 3. What exists today (checked in the code, `main` at cd3cd7d)

**Academy**
- Lessons are files in `content/academy` with `_manifest.json` (two stub lessons). A lesson cannot be added without a release.
- `lesson_progress` keeps who finished what, per company. `required_for` roles and a manager table exist (F133, first slice).
- Objection cards already follow the pattern wanted here: platform starter rows (no company) plus the company's own rows, the company's winning (`lib/repo/academy.ts`).
- Van roles **can** open the Academy: `/sales/academy` is in `DRIVER_TABS` (`lib/appNav.ts`) and allowed in `proxy.ts`. What they lack is a link on `/driver` and any lesson written for them.
- Tutorials (`lib/repo/tutorials.ts`, `tutorial_assignments`, `data-tour` ids) and representatives' onboarding steps exist.

**Catalogue**
- `products`, `packagings` (barcode), dated prices, customer prices and visibility (F89, F62), stock per place including vehicles, order favourites (F58). The sync pull already sends the catalogue to phones; whether the van screens read it offline is not verified (F75).
- `/sales/products` redirects van roles to `/driver`, so a driver or field rep has no catalogue page. A product has no photo, description, category or selling points.
- Both van roles can already record an order (`SELL_ROLES`).

## 4. Tasks

### Academy (AC)

| ID | Task | Needs |
|---|---|---|
| AC1 | **Data.** `academy_categories` (company, title, order) and `academy_lessons` (company, category, title, body as blocks of heading, text and photo, roles, draft or published, version). Platform lessons stay as shipped files. `lesson_progress` learns the lesson kind (platform file or company row) and the version read. Row-level security like the other tenant tables | none |
| AC2 | **Reader and library.** One screen, two sections: «RouteFlow» (shipped) and «شرکت» (company categories). Short lesson reader with photos, «خواندم», works offline (list and text) | AC1 |
| AC3 | **Company editor.** Page `/sales/academy/manage` from the Academy header. Title, category, roles, text and photo blocks, draft or published. The «مربی» permission is a flag on a user, given by the owner. A manager writes only for their own group | AC1, new permission |
| AC4 | **Required and tracked.** Required per role with days after hire, the F133 manager table includes company lessons, «به‌روز شد» when a published lesson changes and the editor chooses whether people must re-read, a gentle push when overdue | AC1, EV3 for the push |
| AC5 | **About 10 RouteFlow lessons** in Persian: new user and sign-in security, install and offline, read Today, take an order, record a payment, customer page, a driver's day, unload, pay at the door, report a problem. Drafted by the agent, reviewed by the owner in the PR | AC2 |
| AC6 | **Links.** A tutorial step opens its lesson and a lesson starts its tutorial («نشانم بده»); an objection card and a product page link to a lesson | AC2, VC1 |
| AC-L1 | **Quizzes** of 1 to 3 questions per lesson written by the authors above, no AI (decided 2026-10-27) | AC1 to AC4 |

**Placement (“محل در رابط کاربری”).** Reader: existing tab «آموزش» (`/sales/academy`, group روز من / تیم, all roles, 1 tap). Editor: «مدیریت درس‌ها» button in the Academy header for owner, managers and trainers (2 taps). Van roles: a card «آموزش امروز» on `/driver` linking to the same page. Company lessons need a `data-tour` tutorial for the editor.

### Van catalogue (VC)

| ID | Task | Needs |
|---|---|---|
| VC1 | **Product information.** Photos (company storage), category, up to 3 selling points, a «how to say it» line, all edited by owner and managers in the existing product editor. Cost and margin never sent to van roles | none |
| VC2 | **Van catalogue page** for `field_rep` and `delivery_driver`: search, category chips, big cards with photo, packings and price; works offline with «قیمت‌ها تا ساعت …»; at a stop it shows this shop's price and visibility (F62, F89) and marks what they already buy | VC1, F75 check |
| VC3 | **Quick actions, step 1 (orders for later).** Add to the stop's order or a quick order from templates (F58), «show to customer» full-screen card, save a product or the price list as a picture or PDF. Sending to the shop waits for the message channel (F6, F79) | VC2 |
| VC3b | **Stock on my van.** Read from the vehicle location, labelled approximate until van loading exists | VC2 |
| VC4 | **Step 2 (sell from van stock).** A sale at the door takes stock off the van at once; samples (F52) | F30 van loading, VC3 |

**Placement.** New tab «کالاها» in `DRIVER_TABS` (group روز من) and a link «کالاهای این مشتری» on the stop card; allowlisted in `proxy.ts` (the drift test in `tests/proxy.test.ts` keeps nav and gate in step). Roles: `field_rep`, `delivery_driver`; owner roles keep `/sales/products`. 1 tap from the bottom bar. Bencho block: a card list with a pull-to-refresh and a full-screen show mode; HeroUI card parts. Tutorial: «پیدا کردن کالا و افزودن به سفارش».

### Operational independence (OI)

| ID | Task | Roadmap |
|---|---|---|
| F59 | **Handover** of a person's customers, leads and tasks, history kept, one notice to the receiver | F59, E2; needs the audit record EV4 |
| T13 | **Lend** customers for N days; access ends by itself | T13 (waits for F59) |
| S23 | **Cover card** for someone on leave | S23, no prerequisite |
| OI1 | **Manager onboarding view:** per new hire, assigned tutorials and required lessons, done or not (data exists) | F133 |
| OI2 | **First-week checklist per role** as an Academy category «هفتهٔ اول» using AC1 | AC5 |
| OI3 | **Runbook index:** one page «if X breaks, read Y» over `docs/postgres-server.md`, `docs/release-and-deploy.md` and the install guide | docs only |
| F39 | **Practice mode** with demo data | later; design open (one training company reset nightly, or a copy per learner; a practice order must never message a real customer) |

## 5. Order

1. S23 and OI3 (small, no prerequisite) and the lesson text for AC5 can start any time.
2. AC1, AC2, AC5, then AC3 and AC4; the Academy is useful as soon as AC2 and AC5 land.
3. VC1, VC2, VC3, VC3b in one batch.
4. After EV4: F59, then T13. OI1 and OI2 after AC4.
5. Later: AC-L1 quizzes, VC4 with F30, F39.

Each batch follows the batch rule (one commit per task, one draft PR, merge once at the end) and the UI rules (placement note, tutorials, look at the screen at 390 px right to left, light and dark).

## 6. Existing-solutions search

Lesson editor, photo viewer and PDF price list: the owner chose to build with what the repo has (section 2). Checked: the photo lightbox, the storage layer and Chromium print already exist; a rich-text library (for example TipTap, MIT) was left out on purpose, with Persian right-to-left behaviour and bundle size on slow phones as the reasons; it can be added later with its own decision.

## 7. Not verified

- Whether the van screens read the catalogue offline today (F75).
- Whether the product editor's photo upload can serve van-sized thumbnails without a new image step (docs/storage.md).
- That `lesson_progress` can carry the lesson kind and version without a data move (read the baseline migration before AC1).
- That the «مربی» flag fits the role checks in `lib/roles.ts` without a new role.
