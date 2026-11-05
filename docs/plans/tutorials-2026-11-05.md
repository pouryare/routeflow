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
| 1 | _waiting_ | |
