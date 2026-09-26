# Nav Motion Duration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shell's nav popover and its auto-hiding top chrome open and close more slowly and more smoothly, on one shared duration and a curve chosen per travel distance.

**Architecture:** One new duration token `--dur-panel` (400ms) declared once in `:root`, mirrored into `lib/motion.ts` as `DUR.panel = 0.4`, plus one new curve `--ease-glide`. The chrome (pure CSS) and the popover preset (framer-motion) both read the same duration but different curves, because `--spring-pop`'s ~13% peak is a 1px whisper on the popover's 10px rise and a 6px bounce on the chrome's 64px slide. The `popover` preset is the single edit point: `HoverPill` and `CardHelp` both read it and neither file changes.

**Tech Stack:** Next.js 16.3.1, React 19.2, Tailwind 4, `framer-motion` 13, vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-26-nav-motion-duration-design.md`

## Global Constraints

- **MASTER.md is the source of truth for every curve and duration.** `lib/motion.ts` restates the framer-driven subset in framer's units (seconds, cubic-bezier 4-tuples) and `app/globals.css` keeps the CSS copy. A change to the tables is a change in all three. `tests/motion.test.ts` exists to hold that mirror and must be extended, not bypassed.
- **No hardcoded colours.** The new tokens are motion values, not colours, so this is unaffected — but do not "helpfully" add a colour while in the block.
- **Do not touch** `components/meridian/HoverPill.tsx` or `components/meridian/CardHelp.tsx`. The design's whole point is that neither call site moves.
- **Do not touch** `Chrome.tsx`'s scroll logic (`TOP_GUARD`, `DOWN_PX`, `UP_PX`). It toggles a class; all geometry is CSS.
- Reduced motion must keep working: the `@media (prefers-reduced-motion: reduce)` block at `app/globals.css:2129` and `withReducedMotion` in `lib/motion.ts` are the two gates, and neither is touched.
- No Playwright assertion on the animation. Asserting on a 400ms transform is a timing-dependent flake; the repo's precedent is geometry in the browser, values in unit tests.
- Branch: `nav-motion-duration`, cut from `main`. Commit after every task.
- Lint baseline is **46 errors, 126 warnings** (172 problems), measured on this branch at Task 0. All of it is pre-existing debt in files this plan does not touch — stray root-level scripts (`verify_fix.js`, `testExtract.js`, …) and legacy components. **Verified: zero problems in `lib/motion.ts`, `tests/motion.test.ts`, `app/globals.css`, or `MASTER.md`.** Do not fix any of it and do not add to it; compare against the count instead. `npx eslint` takes well over 30s, so run it detached (`setsid nohup … &`) and read the output file — a plain `&` dies with its shell and leaves a 0-byte file.

## File map

| File | Responsibility | Task |
|---|---|---|
| `lib/motion.ts` | `DUR.panel` + the corrected `popover` preset | 1, 2 |
| `app/globals.css` | `--dur-panel`, `--ease-glide`, the chrome's transition | 3 |
| `tests/motion.test.ts` | the mirror guard, extended to hold both | 1, 2, 3 |
| `MASTER.md` | token tables, the driver-mode exception, the shared-duration note | 4 |
| `components/meridian/HoverPill.tsx` | consumer, **unchanged** | — |
| `components/meridian/CardHelp.tsx` | consumer, **unchanged** | — |

---

### Task 0: Branch

- [ ] **Step 1:** `cd /home/pourya/Desktop/routeflow && git checkout main && git checkout -b nav-motion-duration`
- [ ] **Step 2:** Confirm the tree is clean and the existing motion guard is green, so a later failure is ours.

```bash
cd /home/pourya/Desktop/routeflow
git status --porcelain          # expect: empty
npx vitest run tests/motion.test.ts   # expect: 6 passed
```

---

### Task 1: The corrected travel — RED first

The popover currently travels 4px, which is nearly a pure fade. This task makes it travel 10px. The exit is left alone here and lengthened in Task 2, so each task has one reason to fail.

**Files:**
- Modify: `tests/motion.test.ts` (the `popover and riseIn hide then show` test)
- Modify: `lib/motion.ts:26-33` (`DUR`)

- [ ] **Step 1: Write the failing test.** Replace the existing `popover and riseIn hide then show` test with this, which asserts the new travel explicitly and keeps the existing opacity/ riseIn coverage:

```ts
  it("the popover preset travels far enough to read as a move, not a fade", () => {
    /* 4px was indistinguishable from a cross-fade. The travel is the whole point of
       the preset: on a 10px rise, spring-pop's ~13% peak is a 1px whisper, which is
       the "arrives, kisses past, settles" read. See MASTER.md "Motion". */
    expect(popover.initial.opacity).toBe(0);
    expect(popover.initial.y).toBe(-10);
    expect(popover.animate.opacity).toBe(1);
    expect(popover.animate.y).toBe(0);
    expect(riseIn.hidden.opacity).toBe(0);
    expect(riseIn.hidden.y).toBe(16);
    expect(riseIn.show.opacity).toBe(1);
  });
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run tests/motion.test.ts`
Expected: FAIL — `expected -4 to be -10` (the preset still travels 4px).

- [ ] **Step 3: Change the travel in `lib/motion.ts`.** Replace the `popover` preset:

```ts
/** The standard panel/popover enter-exit, for AnimatePresence children.
 *
 *  The travel is 10px, not the 4px this started at: 4px of movement is
 *  indistinguishable from a cross-fade, so the panel appeared rather than arrived.
 *  At 10px, EASE.pop's ~13% peak is a ~1px overshoot -- a whisper of settle rather
 *  than a bounce. The same curve on the chrome's 64px travel would be a 6px slam,
 *  which is why that element uses --ease-glide instead. One duration, curve by
 *  distance.
 *
 *  The exit does NOT use EASE.pop. A dismissal that overshoots reads as a panel that
 *  has not left yet -- it visibly bounces back off its resting place. Exit is
 *  --ease-out, which peaks at exactly 100%.
 */
export const popover = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.panel, ease: EASE.pop } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.2, ease: EASE.out } },
} as const;
```

Note the exit duration is `0.2`, in **seconds** (this module's unit), and is written inline rather than as a `DUR` entry: 200ms is this element's own exit value, not a tier in the MASTER.md table.

- [ ] **Step 4: Run it to verify it passes.**

Run: `npx vitest run tests/motion.test.ts`
Expected: this test PASSES (the enter assertions). The preset now references `DUR.panel`, which does not exist yet — if TypeScript or the runtime complains, that is Task 2's RED, which is expected and fine at this point; note it and continue.

- [ ] **Step 5: Commit.**

```bash
git add lib/motion.ts tests/motion.test.ts
git commit -m "fix(motion): the popover travels 10px, so it arrives instead of fading"
```

---

### Task 2: `DUR.panel` and the symmetric lengthening of the exit

Task 1 left `DUR.panel` referenced but undeclared. This declares it and lengthens the exit from `DUR.fast` (120ms) to 200ms.

**Files:**
- Modify: `tests/motion.test.ts` (the durations test)
- Modify: `lib/motion.ts:26-33`

- [ ] **Step 1: Write the failing test.** Add a new test after the `durations are seconds, ordered…` test:

```ts
  it("DUR.panel is the shared panel duration, and the popover exit is not DUR.fast", () => {
    /* 400ms, in seconds. Shared by the framer panels here and --dur-panel in the CSS
       copy, which the chrome also reads -- that mirror is the whole reason the value
       lives in a token rather than inline. */
    expect(DUR.panel).toBe(0.4);
    /* The exit used to be DUR.fast (0.12), a 120ms dismissal against a 300ms enter.
       An asymmetric dismissal reads as the panel being flung away. */
    expect(popover.exit.transition.duration).not.toBe(DUR.fast);
    expect(popover.exit.transition.duration).toBe(0.2);
    /* And it must not overshoot: a dismissal that bounces reads as a panel that has
       not left yet. EASE.out peaks at exactly 100%. */
    expect(popover.exit.transition.ease).toEqual(EASE.out);
  });
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run tests/motion.test.ts`
Expected: FAIL — `DUR.panel` is `undefined` (not yet declared).

- [ ] **Step 3: Declare `DUR.panel`.** In `lib/motion.ts`, replace the `DUR` block:

```ts
/** Durations in SECONDS (framer-motion's unit), from MASTER.md "Durations" (ms / 1000). */
export const DUR = {
  fast: 0.12, // --dur-fast: press/active feedback
  base: 0.18, // --dur-base: hover, focus, small transitions
  slow: 0.3, // --dur-slow: panel/modal enter-exit
  morph: 0.42, // --dur-morph: island collapse↔expand
  settle: 0.32, // --dur-settle: drag release, card landing
  draw: 0.7, // --dur-draw: chart line draw, number count-up
  /* --dur-panel: the nav popover, the card help panel, AND the auto-hiding chrome.
     One duration across both motion systems, so the two feel related. The curve is
     per-element (EASE.pop for a 10px rise, --ease-glide for a 64px slide); only the
     duration is shared, because overshoot scales with travel, not with the curve. */
  panel: 0.4,
} as const;
```

- [ ] **Step 4: Run it to verify it passes.**

Run: `npx vitest run tests/motion.test.ts`
Expected: all 7 tests PASS (6 after Task 1, plus the `DUR.panel` test this task adds).

- [ ] **Step 5: Commit.**

```bash
git add lib/motion.ts tests/motion.test.ts
git commit -m "feat(motion): a shared 400ms panel duration, and an exit that no longer snaps"
```

---

### Task 3: The CSS copy — tokens and the chrome's curve

This is the half that was the actual culprit. The chrome's 320ms read as abrupt because `--ease-out` puts it 89% of the way at 100ms.

**Files:**
- Modify: `app/globals.css:152` (the `:root` motion block — add the curve after `--ease-out`)
- Modify: `app/globals.css:163` (add the duration after `--dur-draw`)
- Modify: `app/globals.css:2118` (`.meridian .chrome` transition)
- Test: `tests/motion.test.ts`

Note: the light theme at `app/globals.css:185` redefines **no** durations and **no** curves (verified — colours only), so one declaration in `:root` serves both themes. Do not add a light-theme copy.

- [ ] **Step 1: Write the failing test.** Add after the existing `--ease-out control points also appear in the globals.css CSS copy` test:

```ts
  it("the panel duration and the glide curve are in the CSS copy, and the chrome reads them", () => {
    const css = readFileSync("app/globals.css", "utf8");
    /* The mirror this file exists to protect: lib/motion.ts speaks seconds and a
       4-tuple, globals.css speaks ms and cubic-bezier(). One motion system, two
       notations -- a change to one is a change to the other. */
    expect(css).toContain("--dur-panel: 400ms;");
    expect(css).toContain("--ease-glide: cubic-bezier(0.25, 0.8, 0.3, 1);");
    /* And the chrome actually uses them. Without this the tokens could sit in the file
       unused while the bar kept its 320ms --ease and nothing would fail. */
    expect(css).toMatch(
      /\.meridian \.chrome \{[^}]*transition: transform var\(--dur-panel\) var\(--ease-glide\)/,
    );
  });
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx vitest run tests/motion.test.ts`
Expected: FAIL — `--dur-panel: 400ms;` not found in globals.css.

- [ ] **Step 3: Add the curve.** In `app/globals.css`, replace the `--ease-out` line and its preceding comment:

```css
  /* motion */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  /* For a LONG travel. --ease-out is front-loaded by design: it puts a 64px slide 89%
     of the way at 100ms, which is right for a 10px fade and reads as a slam on the
     chrome. Glide keeps the front-load that answers a scroll and stretches the rest,
     so the bar travels the whole window and peaks at exactly 100% -- no bounce. A
     spring here would be a 6px rebound, because overshoot scales with distance. */
  --ease-glide: cubic-bezier(0.25, 0.8, 0.3, 1);
```

- [ ] **Step 4: Add the duration.** Immediately after `--dur-draw: 700ms;` in the same block:

```css
  --dur-draw: 700ms;
  /* The nav popover, the card help panel and the auto-hiding chrome all travel for
     this long. One duration across both motion systems (CSS here, framer-motion in
     lib/motion.ts) is what makes the two feel like one system. If the bar feels
     laggy on a real device, this is the single value to shorten -- 360ms is the
     first thing to try, and the curve is not the thing to revert. */
  --dur-panel: 400ms;
```

- [ ] **Step 5: Retime the chrome.** At `app/globals.css:2118`, replace:

```css
  transition: transform 320ms var(--ease);
```

with:

```css
  transition: transform var(--dur-panel) var(--ease-glide);
```

- [ ] **Step 6: Run it to verify it passes.**

Run: `npx vitest run tests/motion.test.ts`
Expected: all 8 tests PASS — the 7 already green, plus the one CSS-mirror test this task adds.

- [ ] **Step 7: Commit.**

```bash
git add app/globals.css tests/motion.test.ts
git commit -m "fix(shell): the chrome's curve, not its duration, was the abrupt part"
```

---

### Task 4: MASTER.md — the source of truth

A new token that is not in MASTER.md is not a token; it is a magic number with a comment. This task makes the tables the record.

**Files:**
- Modify: `MASTER.md:356` (the Curves table — add `--ease-glide` after `--spring-drop`)
- Modify: `MASTER.md:370` (the Durations table — add `--dur-panel` after `--dur-draw`)
- Modify: `MASTER.md:454-456` (the spring ban — record the driver-mode exception)
- Modify: `MASTER.md:95-100` (the "Two motion layers" note — record the shared duration)

- [ ] **Step 1: Add `--ease-glide` to the Curves table.** In `MASTER.md`, replace the `--spring-drop` row (`MASTER.md:356`):

```markdown
| `--spring-drop` | `cubic-bezier(0.22, 1.61, 0.36, 1)` | Heavy settle. A dragged object landing. |
| `--ease-glide` | `cubic-bezier(0.25, 0.8, 0.3, 1)` | Long travel, no overshoot. The auto-hiding chrome, which crosses 64px. |
```

- [ ] **Step 2: Add `--dur-panel` to the Durations table.** Replace the `--dur-draw` row:

```markdown
| `--dur-draw` | 700ms | Chart line draw, number count-up |
| `--dur-panel` | 400ms | Nav popover, card help panel, auto-hiding chrome |
```

- [ ] **Step 3: Record why the two elements share a duration but not a curve.** Immediately after the Durations table's closing `|`, insert:

```markdown

**One duration, curve by distance.** The nav popover, the card help panel and the
auto-hiding chrome all travel for `--dur-panel`. They do *not* share a curve, because
overshoot is a function of travel rather than of the curve: `--spring-pop`'s ~13% peak
is a 1px overshoot on the panels' 10px rise and a 6px rebound on the chrome's 64px
slide. So the panels use `--spring-pop` and the chrome uses `--ease-glide`, and the
shared value is the duration only. A dismissal is the exception in the other
direction — the panel's *exit* is `--ease-out` at 200ms, because a dismissal that
overshoots reads as a panel that has not left yet.
```

- [ ] **Step 4: Record the driver-mode exception.** In `MASTER.md`'s "Where spring stays banned" list, replace the `Driver mode, entirely.` bullet:

```markdown
- **Driver mode, entirely.** `.driver-mode` is, in this codebase's own words, "the same
  app, sized for one thumb in a moving vehicle." Overshoot animation read inside a moving
  vehicle is a motion-sickness trigger, and the person is driving. Driver mode gets
  `--ease-out`, short durations, and no ambient loops. **One named exception:** the
  shell header's nav popover, which is reachable while driver mode is active (the class
  is set on `<html>` by `CoverageMap`, and `/map` is a shell page) but is chrome the
  driver reaches only by scrolling up off the map. The map itself — markers, controls,
  the bottom bar — keeps every rule on this list. The exception is the header popover by
  name, not "the shell", and it is not a precedent for overshooting anywhere else.
```

- [ ] **Step 5: Update the "Two motion layers" note.** In `MASTER.md`, replace the paragraph beginning `**Two motion layers, one set of values.**`:

```markdown
**Two motion layers, one set of values.** The entrance choreography (RevealRoute,
RouteFade) is pure CSS and stays that way — it is deterministic, fires on every
navigation, and needs no JavaScript to be correct. Interactive motion added since
(the nav popover, the help panel) uses `framer-motion`, with `lib/motion.ts` restating
the curves and durations above in its units so nothing hand-rolls a value. A change to
the tables above is a change in both places. The two layers now also share a duration:
`--dur-panel` (400ms) is read by the framer panels as `DUR.panel` and by the CSS chrome
as a custom property, which is what makes the nav's popover and its sliding bar feel
like one motion system rather than two that happen to share a header.
```

- [ ] **Step 6: Verify MASTER.md is the only doc claiming the old values.** Nothing in `MASTER.md` should still describe the chrome as 320ms or the popover as 4px.

```bash
cd /home/pourya/Desktop/routeflow
grep -nE '320ms|y: -4|4px' MASTER.md | head
```

Expected: no output, or hits that are unrelated to these two elements. If a hit is about them, fix it.

- [ ] **Step 7: Commit.**

```bash
git add MASTER.md
git commit -m "docs: --dur-panel and --ease-glide, and the driver-mode exception by name"
```

---

### Task 5: Full gate

**Files:** none — verification only.

- [ ] **Step 1: The whole unit suite, not just the motion test.**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run 2>&1 | tail -20
```

Expected: all suites pass. Any failure here is a regression from Tasks 1–4 and must be fixed before continuing.

**Known pre-existing flake:** `tests/jalali.test.ts > agrees with Intl for every day across 20 Jalali years` times out at 5000ms when the machine is loaded (it takes ~3.5s standalone, so it has ~1.5s of headroom). It fails on `main` too, under CPU contention, and `lib/jalali.ts` never imports `lib/motion.ts` — this plan cannot affect it. Do not "fix" it here; if it fails, re-run that file alone to confirm, and note it in the commit.

- [ ] **Step 2: Typecheck.** `DUR.panel` is consumed through `as const`, so a typo would not surface in vitest.

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit 2>&1 | tail -20
```

Expected: no errors. If `next-env.d.ts` churn appears, that is the framework regenerating it — do not commit it.

- [ ] **Step 3: Lint, against the baseline.** `npx eslint` exceeds a 30s foreground timeout here, so background it and read the file.

```bash
cd /home/pourya/Desktop/routeflow
setsid nohup npx eslint > /tmp/lint-after.txt 2>&1 < /dev/null & disown
```

Then compare `/tmp/lint-after.txt` against the Task 0 baseline. Expected: the same **46 errors, 126 warnings** (172 problems), and specifically still **zero** in `lib/motion.ts`, `tests/motion.test.ts`, `app/globals.css` or `MASTER.md`:

```bash
grep -E '✖' /tmp/lint-after.txt
grep -nE '^/home/pourya/Desktop/routeflow/(lib/motion\.ts|tests/motion\.test\.ts)$' /tmp/lint-after.txt || echo "clean: none of our files"
```

A new error or warning in our four files is ours and must be fixed.

- [ ] **Step 4: Confirm the consumers really are untouched.** The design's central claim is that no call site moves.

```bash
cd /home/pourya/Desktop/routeflow
git diff main --stat -- components/meridian/HoverPill.tsx components/meridian/CardHelp.tsx
```

Expected: **empty output**. If either file appears, something edited it and the preset indirection has been bypassed.

- [ ] **Step 5: Confirm the reduced-motion gates are intact.** The longer duration must not leak past either one.

```bash
cd /home/pourya/Desktop/routeflow
sed -n '/prefers-reduced-motion: reduce/,+4p' app/globals.css | grep -A3 '\.meridian \.chrome'
```

Expected: the block still sets `transition: none` and `transform: none` for `.meridian .chrome`.

- [ ] **Step 6: Build.**

```bash
cd /home/pourya/Desktop/routeflow
npm run build 2>&1 | tail -25
```

There is no systemd unit on this machine (`systemctl is-active routeflow` → `inactive`), so there is no live process to stop first. Expected: build succeeds.

- [ ] **Step 7: Read the motion in a browser.** This is the one gate no test can do, and the one that decides whether the change is any good.

```bash
cd /home/pourya/Desktop/routeflow
npm run dev
```

Open `/sales/dashboard` and check three things:

1. Hover a group chip with two or more tabs (e.g. «فروش و سفارش»). The panel should visibly rise ~10px and settle with a barely-perceptible kiss past its resting place — not bounce, not fade.
2. Move the pointer off it. The dismissal should feel deliberate, not sluggish. If it feels slow, that is the accepted 380ms total; if it feels *broken*, the curve is wrong.
3. Scroll down then up. The bar should travel the whole window, answering the scroll immediately but not slamming shut. **If it reads laggy, shorten `--dur-panel` to 360ms and re-check** — do not revert the curve, and do not touch `Chrome.tsx`.

Also open a card's `(i)` help panel to confirm the second `popover` consumer inherits the same motion.

- [ ] **Step 8: Commit any adjustment, and the plan's own completion.**

```bash
cd /home/pourya/Desktop/routeflow
git add -A
git commit -m "chore(motion): nav motion gate green"
```

---

## Self-review notes

- **Spec coverage:** every spec section has a task — the shared duration (Tasks 2–3), the curves (1, 3), the exit (1, 2), the driver-mode exception (4), the files table (all), verification (5), and the "not in scope" list (Task 5 Step 4 proves the consumers are untouched).
- **Task 1 intentionally leaves `DUR.panel` undeclared** so that each task has exactly one reason to fail. `npx tsc --noEmit` is deferred to Task 5 Step 2 for that reason; the vitest run in Step 4 passes because the test asserts values, not types.
- **Test counts are cumulative:** 6 existing → 6 after Task 1 → 7 after Task 2 → 8 after Task 3. Task 1 *replaces* the old popover test rather than adding one, which is why the count does not move until Task 2.

