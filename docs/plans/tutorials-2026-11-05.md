# In-app tutorials («آموزش») for release 0.1

_Plan only, 2026-11-05. No code until the owner answers the questions at the end. Requested by the owner for the first release to real users._

## 1. The short answer

**Build our own small tutorial layer, and borrow only the "spotlight" (the dark screen with a hole around one button) from `driver.js`.**

Why, in one example. A new driver opens the app for the first time. We want:

1. a card at the bottom of the screen, in Persian, in our own style, with our own button, sound and haptics: «این دکمه را بزنید تا مسیر امروز باز شود»;
2. the rest of the screen dimmed, with a bright hole around the «شروع مسیر» button;
3. the tutorial to wait until the driver really taps that button, then move on;
4. the app to remember, on the server, that this driver finished «اولین مسیر», so it never shows again on any phone.

Points 1, 3 and 4 are about *our* app: our cards, our roles, our `users.prefs_json`, our pages. No library does them the way our rules want (HeroUI parts, `playSound`, `lib/fx.ts`, right to left). Point 2 is fiddly geometry (scrolling, resizing, rounded hole, a phone keyboard opening) that `driver.js` already does well in 8 KB with no other packages. So we write 1, 3 and 4, and let `driver.js` draw 2.

## 2. What already exists (so we do not build it twice)

| Piece | Where | What it does today | Role in tutorials |
|---|---|---|---|
| Help (i) button (F84) | `lib/help`, `components/meridian/CardHelp.tsx` | Explains a card on one tap, five screens written | "Explain this screen" stays here; a tutorial can link to it |
| What's new (F112) | `lib/whatsNew`, `components/today/WhatsNewCard.tsx` | Shows release notes once, remembers the version in `users.prefs_json` | Same "show once, remember on the server" pattern we copy |
| Academy (F133) | `/sales/academy`, `content/academy` | Lessons to read, required lessons per role, manager table | Long reading lessons stay here; tutorials are short and hands-on |
| Customer onboarding checklist (F40) | `lib/onboarding.ts` | Four steps for a new customer | Same checklist look for "first steps" |
| Training mode (F39) | parked | A practice company with demo data | Optional later, see question 3 |
| Setup checklist and first-use tour (UIB-D) | roadmap, not built | Listed in batch D | This plan is that item |
| `canvas-confetti` | installed | Not used for this yet | Small reward when a role finishes its first steps |
| `docs/decisions.md` row "Action-gated tours" | decisions table | "Later; one tour on the order screen first; check right to left" | This plan answers that row |

So three kinds of help will live side by side, each with one job:

- **(i) help**: "what is this card?" (read, one tap, any time).
- **Tutorial**: "show me how to do it" (do it for real, 3 to 6 steps, once, can be replayed).
- **Academy**: "teach me to sell" (long lessons, required by role).

## 3. What the tutorials should cover in 0.1

A tutorial is one job, 3 to 6 steps, under a minute. Each role gets a **"first steps" checklist** of 3 to 5 tutorials on its home screen (`/sales/today` or the driver's today page). Ticks come from what the person really did, not from pressing «بعدی».

| Role | First-steps checklist (proposal) | Example step |
|---|---|---|
| Owner | 1. Add your company details and logo · 2. Add a staff account (driver or sales) · 3. Add your first product with a price · 4. Add your first customer · 5. Turn on the authenticator (2FA) | «روی "افزودن کاربر" بزنید، نقش را "راننده" بگذارید» |
| Phone sales | 1. Find a customer · 2. Take your first order · 3. Record a call result · 4. Finish a task | «مقدار را با لغزنده تنظیم کنید و "ثبت سفارش" را بزنید» |
| Field rep | 1. See today's visits on the map · 2. Record a visit (photo + note) · 3. Take an order at the shop · 4. Record a payment | «عکس ویترین را بگیرید؛ بدون اینترنت هم ذخیره می‌شود» |
| Driver | 1. Open today's run · 2. Arrive at a stop · 3. Mark «تحویل شد» (slide to confirm) · 4. Record cash or a cheque · 5. End the day and unload | «برای تأیید، دکمه را به چپ بکشید» |
| Group / rep manager | 1. See your team today · 2. Assign a task · 3. Read the required-lessons table | — |
| Shareholder | No checklist; one 3-step tour of «سهم من» | — |

Plus, for everyone: a short **"where things are"** tour of the bottom bar on the first sign-in (4 steps: «روز من», «مشتریان», the + button, «بیشتر»).

## 4. Phone and right-to-left rules for tutorials

- **The text card sits at the bottom**, in the thumb zone, as a fixed card above the bottom bar, not a floating bubble next to the button. On a 390 px phone a bubble covers half the screen and jumps when the keyboard opens.
- **Right to left**: «بعدی» on the left, «قبلی» on the right, arrows mirrored, Persian digits (۱ از ۴).
- **Every step can be skipped**: «رد کردن» on every card and «بعداً» closes the whole tutorial; the checklist stays, so nothing is lost.
- **Do it for real** wherever it is safe: the step waits for the real tap (open the run, tap the + button). A step that would save real money or send a message (record a payment, send an SMS) only *shows* the button and explains it, unless training mode exists (question 3).
- **Offline**: tutorial text ships inside the app, progress is saved through the same offline outbox, so a driver with no signal can still follow it.
- **Effects**: the dim and the hole respect `lib/fx.ts` (reduced motion, weak phones); sounds go through `playSound` (`climb` for a step done, a short success at the end); confetti only when effects are on.
- **A missing button never traps anyone**: if the target is not on the screen (a role without that tab, the list is empty), the step turns into a plain text card with «ادامه».
- **Replay**: a «آموزش‌ها» list in the account menu (and on each screen's (i) panel, «نمایش آموزش») lets anyone run any tutorial again.

## 5. Ready libraries compared

Checked on npm on 2026-11-05.

| Library | Version, date | Licence | Size (gzip) | Right to left | Fits our rules? | Verdict |
|---|---|---|---|---|---|---|
| **driver.js** | 1.10.2, 2026-10-18 | MIT | about 8 KB, no dependencies | No switch, but the bubble is optional, and the hole has no direction | Yes, if we turn its bubble off and draw our own card | **Use for the spotlight only** |
| react-joyride | 3.2.0, 2026-07-09 | MIT | about 20 KB plus 10 small packages | Not built in | Its tooltip can be replaced, but it still owns the flow, scrolling and buttons | Second choice |
| @reactour/tour | 3.8.0, 2025-05-07 | MIT | small | Has an `rtl` switch | Older, last release 18 months ago | No |
| NextStep (nextstepjs) | 2.3.0, 2026-07-20 | MIT | about 9 KB | Physical left/right only | Needs the `motion` 14 package, which would load a second copy of framer-motion next to our 13 | No |
| Onborda | 1.2.5, 2024-12-22 | MIT | small | No | Not updated for almost two years | No |
| Shepherd.js / react-shepherd | 15.3.0, 2026-08-24 | **AGPL-3.0** | — | — | AGPL would force us to publish RouteFlow's source, because staff use it over the network | **No** |
| Intro.js | 8.6.0, 2026-09-21 | **AGPL-3.0** (paid licence for closed apps) | — | Has RTL | Same AGPL problem, or a foreign payment | **No** |
| OnboardJS | 1.0.0-rc.4 | MIT | small | Headless (no UI) | Still a release candidate; it only stores steps, which we can do in 50 lines | No |
| HeroUI | already installed, 3.2.6 | MIT | 0 KB extra | Yes | Has Popover and Card, but no spotlight or tour | **Use for our card** |

None of these needs a foreign server or key, and all install from npm like our other packages. The two AGPL ones are ruled out by licence, not quality.

## 6. The three real options

**A. Our own layer + driver.js for the spotlight (recommended).**
We write: the tutorial list per role (a plain TypeScript file like `lib/whatsNew/notes.ts`), the bottom card on HeroUI Card, the "wait for the real tap" logic, the progress in `users.prefs_json`, the first-steps checklist card and the replay list. `driver.js` only draws the dim and the hole.
*Example of how a tutorial would be written:*

```ts
{
  id: "driver-first-run",
  roles: ["delivery_driver"],
  title: "اولین مسیر",
  steps: [
    { target: "[data-tour=run-start]", text: "مسیر امروز را از اینجا باز کنید.", waitFor: "click" },
    { target: "[data-tour=stop-arrive]", text: "به هر مشتری که رسیدید این را بزنید.", waitFor: "click" },
    { target: "[data-tour=deliver-slide]", text: "برای «تحویل شد» دکمه را بکشید.", waitFor: "event:delivered" },
  ],
  doneWhen: "event:first-delivery",
}
```
Cost: about 1 to 1.5 weeks with tests and the first tutorials. Buys: our look, our sounds, our rules, one 8 KB package that is easy to remove.

**B. Everything from scratch on HeroUI.**
Same as A, and we also draw the hole ourselves (an SVG mask over the button's position, kept in place while the page scrolls or the keyboard opens).
Cost: about 2 to 3 more days, plus the odd bugs the library already fixed (a target inside a scrolling sheet, a page that resizes mid-step). Buys: no new package at all.

**C. react-joyride as the whole engine.**
Quickest to a first tour (a day), but it decides the scrolling, buttons and flow; making it look like HeroUI, right to left, with our sounds and the "wait for the real tap" rule means fighting it, and it brings 10 packages.

## 7. Bencho block check (owner rule)

`docs/bencho-blocks-and-sounds.md` has no tour or spotlight block. Two fit: **checklist** (MIT, we already have it: the box fills and the tick draws) for the first-steps card, and the **`climb`** sound for "step done". No Pro block is needed.

## 8. Where it lives in the app (placement note)

- **First-steps card**: top of each role's today page, under the what's-new card, 0 taps. Hides itself when all ticks are done.
- **Tour card**: bottom of the screen above the bottom bar, only while a tutorial runs.
- **Replay list «آموزش‌ها»**: account menu, 2 taps (`accountLinks`); also «نمایش آموزش» inside a screen's (i) panel.
- **Owner view** (later): who finished their first steps, next to the academy's required-lessons table.

## 9. Open questions (asked one at a time, a recommended answer first)

1. **Library or our own?** Recommended: A (our own layer, driver.js for the spotlight).
2. **Do it for real, or next-next slides?** Recommended: do it for real where safe; money and messages are shown, not done.
3. **Practice on real data, or a training company (F39)?** Recommended: real data in 0.1, training company later.
4. **Which tutorials ship in 0.1?** Recommended: the bottom-bar tour plus the first-steps lists in section 3.
5. **Who writes and edits the text?** Recommended: written in the code by us, reviewed by the owner in the pull request; owner editing later.
6. **Shown automatically on first sign-in, or only when tapped?** Recommended: the bottom-bar tour starts by itself once; the rest wait on the checklist card.

## 10. Answers log

| # | Answer | Date |
|---|---|---|
| 1 | **Own layer + driver.js for the spotlight only** (option A) | 2026-11-05 |
| 2 | **Real taps where safe; steps that save money or send a message only point and explain** | 2026-11-05 |
| 3 | Owner chose a third way: **demo data inside the real page while a tutorial runs**, swapped to real data with no reload (section 11). A separate training company is not needed | 2026-11-05 |
| 4 (was 6) | **Bottom-bar tour on first sign-in, then each tutorial offers itself the first time a screen or sheet is opened**, plus the replay list | 2026-11-05 |
| 5 (was 4) | **All ~75 main actions get a tutorial before 0.1** (owner accepts about 2 to 3 more weeks); the CI gap list must be empty to release | 2026-11-05 |
| 6 (was 5) | **The agent drafts all Persian text in code; the owner reviews it on a phone in the batch PR** | 2026-11-05 |
| 7 | Owner: discuss the 12 ideas one by one (answers below as I1 to I12), then add a rule: a new or changed page or feature checks whether tutorials need an update, like the skeleton recapture | 2026-11-05 |
| I1 | Just in time: **a chip «۳۰ ثانیه آموزش؟», asked at most twice** (again the next day after «بعداً»), then only the list and the (i) panel | 2026-11-05 |
| I2 | «چطور…؟»: **tutorials are found from the app's main search and the (i) panel**; one tap starts one | 2026-11-05 |
| I3 | Voice: **try a free offline Persian voice engine at build time (Piper or similar, licence and quality checked first)**; clips regenerate when text changes; dropped if it sounds bad | 2026-11-05 |
| I4 | Pointer: **soft pulse on the button plus a small hand that glides to it and taps**; off when effects are off | 2026-11-05 |
| I5 | Ghost demo: **for jobs of 3 or more taps the hand plays the whole job once on demo data, then «حالا شما»**; short jobs skip it | 2026-11-05 |
| I6 | Stuck detector: **no**. Help comes only from the first-time chip, search and the list | 2026-11-05 |
| I7 | Manager sends a tutorial: **yes, shown on the person's today page with the manager's name; the manager sees sent, seen and done** | 2026-11-05 |
| I8 | _waiting_ | |

## 11. Owner's direction (2026-11-05): many tutorials, practice on demo data in the page

The owner wants **a tutorial for almost every action**, because many users are not used to apps, and **demo data shown on the page while a tutorial runs, replaced by the real data the moment it ends, with no page reload**.

### Is it possible? Yes. How it works

Today a page reads from the database on the server and passes the rows to a client part. For example, `/sales/today` reads the tasks and hands them to `TaskRow`. So the real rows are already in the phone's memory. We add a thin layer in the browser:

1. **`TutorialProvider`** (one, in the shell) knows whether a tutorial is running and which demo set it uses.
2. **`useTutorialData(key, realRows)`**: one line in each list part. It returns the demo rows while a tutorial runs and the real rows otherwise:
   ```ts
   const tasks = useTutorialData("tasks", props.tasks); // demo while learning, real after
   ```
3. **Demo sets** live in code next to the tutorial (`lib/tutorials/demo/*.ts`): «فروشگاه نمونهٔ رضایی», three orders, one cheque and so on, in Persian, with ids that start with `demo-`.
4. **Pretend saves**: while a tutorial runs, `postJSON` and the offline outbox (`lib/offline/net.ts`, `outbox.ts`) answer «ذخیره شد» themselves and send nothing. The server also refuses any id that starts with `demo-` as a second lock. So now even a payment or an SMS step can be done for real, on pretend data (this upgrades answer 2: money steps are no longer explain-only inside a tutorial).
5. **The swap**: when the tutorial ends, the provider switches off. React redraws the same parts with the real rows already in memory. That's instant, with no reload, and a short fade with the effects switch. Then `router.refresh()` quietly fetches fresh rows from the server without reloading the page, in case something changed meanwhile.

Example: a driver starts «ثبت چک». The run shows a demo stop «سوپرمارکت نمونه». The driver slides «تحویل شد», types a cheque amount, takes a photo, and gets the success sound. The tutorial ends, the demo stop fades out, and their real 14 stops are there.

### Limits to know

- Every list or card that shows demo data needs that one `useTutorialData` line. Reports drawn only on the server (accounting tables) can't swap that way. There, a tutorial points at the real screen, or we turn that list into a client part.
- Demo rows always wear a «نمونه» chip and a faint striped edge, and a banner reads «حالت آموزش: این اطلاعات واقعی نیست». Nobody can mistake them for real data.
- Maps: demo pins are drawn as an extra layer and removed at the end, and the real pins stay underneath.
- **Many tutorials = much writing.** About 60 to 80 actions × 3 to 6 Persian lines. A CI check lists every main button (`data-tour` id) that has no tutorial yet, the same way the help-debt test lists unwritten (i) entries, so the gaps stay visible.

## 12. Ideas to make it great

1. **Just in time, not all at once.** The first time someone opens the payment sheet, a small chip offers «۳۰ ثانیه آموزش؟». Nobody sits through a 20-step tour on day one.
2. **Ask for help in words.** A «چطور…؟» search in the (i) panel: typing «چک» lists «ثبت چک», «برگشت چک» and so on, and one tap starts it.
3. **Voice-over in Persian.** Each step can play a short recorded voice clip, which helps people who read slowly. The owner or a staff member records it on the phone, and it's stored with the tutorial.
4. **Big-finger mode.** During a tutorial the target button gets a soft pulse and a pointing hand that moves to it, like a game's first level.
5. **Show me, then let me.** Step 1 plays a ghost hand doing the action on demo data (like a short video, but live). Step 2 says «حالا شما».
6. **Stuck detector.** If someone opens the same sheet three times and closes it without saving, a calm chip offers the tutorial for it.
7. **Manager sends a tutorial.** A manager taps a person and picks «ارسال آموزش ثبت چک». It shows up on that person's today page with the manager's name.
8. **Progress you can see.** A ring on the profile picture fills as first-steps are done, and a small «استاد مسیر» badge comes when the driver set is complete. Confetti and a sound play once, then never again.
9. **Phone-less practice.** «تمرین» mode repeats a tutorial with different demo data and no hints, and gives a gentle time («۴۲ ثانیه، دفعه قبل ۷۰»).
10. **Fresh after an update.** When a release changes a screen, the what's-new card offers «ببینید چه عوض شد» and runs a 2-step tour of just the change.
11. **Offline-proof.** Tutorials, demo data and voice clips ship in the app bundle, so a driver in a basement can still learn.
12. **Tutorial health for the owner.** The owner sees which steps people skip or quit on most. A step everyone quits is a confusing screen, and that's worth fixing in the screen itself.
