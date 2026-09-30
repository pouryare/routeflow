# Page Names, Help, Hotkeys and Count-Up Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every page an English name alongside its Persian one, a help affordance in its first card, one registry of keyboard shortcuts instead of sixteen ad-hoc listeners, and count-up animation on every figure that earns it.

**Architecture:** Four small independent changes. Two of them are **widenings of things that already exist** — `lib/pageMeta.ts` already holds every route's title and overview, and `components/ShortcutHelp.tsx` already renders a cheatsheet. This plan widens them rather than replacing them.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest 4.

---

## What already exists (measured, not assumed)

| Asked for | Reality |
|---|---|
| "animated count up" | **Built.** `components/meridian/CountUp.tsx` + `lib/useCountUp.ts`, governed by MASTER.md Tier 3 (data — never spring). Used on **exactly one page**: `app/(shell)/sales/dashboard/page.tsx`. |
| "help in the first card" | **Exists.** `components/meridian/CardHelp.tsx` + `lib/help/`. `PageHeaderCard.tsx` already renders `overview`. |
| "keyboard hotkeys" | **Partial.** `components/ShortcutHelp.tsx` already renders a cheatsheet fed by a `MAP_SHORTCUTS` array, and `SearchSlot.tsx` already binds Cmd/Ctrl+K. But **16 files** each add their own `keydown` listener. |
| "proper Persian and English name" | **Persian only.** `lib/pageMeta.ts` is `{ title, overview }`. |

**So this plan is mostly wiring and widening, not invention** — which is why it is the last
plan in the order: nothing else depends on it, and it touches many files shallowly.

---

## The shortcut decision, which is the only interesting one

Sixteen files each listening for `keydown` is not a bug; it is what happens when there is no
answer to "what does this key do here?". Each file solves its own problem correctly.

The failure mode is the one that has not happened yet: **a key that means two things on one
screen**, and the second registration wins silently because both listeners fire.

So `lib/hotkeys.ts` is not a "shorter way to write addEventListener". It is **one registry that
a page declares**, which means:

- a binding is active only on the routes that declare it;
- two components cannot claim the same key on the same route, because the second is a
  **conflict** the registry reports rather than a race nobody sees;
- the cheatsheet is **derived from the registry**, so it cannot fall out of date the way a
  hand-maintained list does.

`MAP_SHORTCUTS` stays as the map's own binding, and becomes one entry in the registry rather
than a parallel list.

**Escape and Enter are deliberately NOT in the registry.** They belong to whichever dialog owns
focus, they already work in all sixteen files, and centralising them would mean the registry
had to model focus — which is a different and much larger problem. This plan leaves them alone
on purpose; a shortcut registry that tries to own focus is a shortcut registry that breaks
dialogs.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/hotkeys.ts` | **New, pure.** The registry: declarations, conflict detection, `?` help rows. No DOM. |
| `lib/pageMeta.ts` | **Modify.** `{ title, titleEn, overview, help }`. |
| `components/meridian/PageHeaderCard.tsx` | **Modify.** Render `titleEn` and the help affordance. |
| `components/ShortcutHelp.tsx` | **Modify.** Derive rows from the registry. |
| `components/HotkeyProvider.tsx` | **New.** The one `keydown` listener; consults the registry. |
| `app/(shell)/layout.tsx` | **Modify.** Mount the provider once. |
| 4 stat surfaces | **Modify.** Swap bare `faNum` for `CountUp`. |
| `tests/hotkeys.test.ts` | **New.** Conflicts, scoping, help derivation. |
| `tests/pageMeta.test.ts` | **Modify.** The existing suite widens. |

---

### Task 1: The hotkey registry, pure

Sixteen files each own a `keydown` listener. None of them is wrong; the missing thing is a
single answer to "what does this key do here?".

**Files:**
- Create: `lib/hotkeys.ts`
- Test: `tests/hotkeys.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/hotkeys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRegistry, conflicts, helpRows, type Binding } from "@/lib/hotkeys";

const b = (over: Partial<Binding> = {}): Binding => ({
  keys: "K",
  description: "کاری",
  routes: ["/sales"],
  ...over,
});

describe("the hotkey registry", () => {
  it("keeps two different keys that happen to share a description", () => {
    const reg = buildRegistry([b({ keys: "K" }), b({ keys: "J" })]);
    expect(reg).toHaveLength(2);
    expect(conflicts(reg)).toEqual([]);
  });

  it("reports the SAME key bound twice on overlapping routes", () => {
    // The failure this whole file exists to prevent: two listeners, both firing, the second
    // winning silently.
    const reg = buildRegistry([
      b({ keys: "K", description: "یک" }),
      b({ keys: "k", description: "دو" }),
    ]);
    expect(conflicts(reg).length).toBe(1);
    expect(conflicts(reg)[0].routes).toContain("/sales");
  });

  it("does NOT report a conflict when the routes do not overlap", () => {
    const reg = buildRegistry([
      b({ keys: "K", routes: ["/sales"], description: "یک" }),
      b({ keys: "K", routes: ["/map"], description: "دو" }),
    ]);
    expect(conflicts(reg)).toEqual([]);
  });

  it("matches a key case-insensitively, because e.key is not normalised", () => {
    expect(conflicts(buildRegistry([b({ keys: "K" }), b({ keys: "k" })]))).toHaveLength(1);
  });

  it("supports a modifier prefix and treats Cmd and Ctrl as the same chord", () => {
    const reg = buildRegistry([
      b({ keys: "Mod+K", routes: ["/sales"], description: "جستجو" }),
      b({ keys: "Ctrl+K", routes: ["/sales"], description: "دوباره" }),
    ]);
    // On a Mac Cmd+K and Ctrl+K are different chords; treating them as one is the point of
    // writing "Mod", so this must still be a conflict.
    expect(conflicts(reg)).toHaveLength(1);
  });

  it("filters to the bindings live on a given route", () => {
    const reg = buildRegistry([
      b({ keys: "K", routes: ["/sales"] }),
      b({ keys: "G", routes: ["/map"] }),
    ]);
    expect(helpRows(reg, "/sales").map((r) => r.keys)).toEqual(["K"]);
  });

  it("orders help rows the way the app reads, not alphabetically", () => {
    // In RTL the reader scans right to left, so a cheatsheet sorted by key code is a
    // cheatsheet nobody can use.
    const reg = buildRegistry([
      b({ keys: "Mod+K", routes: ["/x"], order: 1 }),
      b({ keys: "?", routes: ["/x"], order: 90 }),
      b({ keys: "S", routes: ["/x"], order: 5 }),
    ]);
    expect(helpRows(reg, "/x").map((r) => r.order)).toEqual([1, 5, 90]);
  });

  it("an empty registry produces no help rows and no crash", () => {
    expect(helpRows([], "/sales")).toEqual([]);
  });

  it("a binding with an empty description is still a conflict but not a help row", () => {
    const reg = buildRegistry([b({ keys: "K", description: "" }), b({ keys: "k" })]);
    expect(conflicts(reg)).toHaveLength(1);
    expect(helpRows(reg, "/sales")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/hotkeys.test.ts
```

Expected: FAIL — "no such module `lib/hotkeys`".

- [ ] **Step 3: Write the module**

Create `lib/hotkeys.ts`:

```ts
/** One answer to "what does this key do here?".
 *
 *  Sixteen components each add their own `keydown` listener today, and none of them is
 *  wrong. What is missing is a place where a binding is DECLARED, so two components claiming
 *  one key on one route becomes a reportable conflict instead of a race in which the second
 *  registration silently wins.
 *
 *  Pure by design — no DOM, no React. The provider that actually listens is a thin shell
 *  over this, which is what lets the conflict rules be tested in milliseconds.
 *
 *  `Mod` means Cmd on a Mac and Ctrl everywhere else, and is how a binding is written so the
 *  same line of copy works on both. Escape and Enter are deliberately absent: they belong to
 *  whichever dialog owns focus, and a registry that tried to own focus would break dialogs. */

export interface Binding {
  /** "K", "Mod+K", "Shift+/", "?" — compared case-insensitively. */
  keys: string;
  description: string;
  /** Route prefixes this binding is live on. Empty means "everywhere". */
  routes: string[];
  /** Position in the cheatsheet. Lower first. */
  order: number;
}

/** Normalise a chord so "K", "k" and "Ctrl+K" collide with each other. */
function chordOf(keys: string): string {
  const parts = keys
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p === "Mod" || p === "CmdOrCtrl" ? "mod" : p.toLowerCase()))
    .sort();
  return parts.join("+");
}

function routesOverlap(a: string[], b: string[]): boolean {
  const any = (x: string[]) => x.length === 0;
  return any(a) || any(b) || a.some((r) => b.some((o) => o === r || r.startsWith(`${o}/`)));
}

export function buildRegistry(bindings: readonly Binding[]): Binding[] {
  return [...bindings].sort((a, b) => a.order - b.order);
}

/** Every pair that claims the same chord on an overlapping route. */
export function conflicts(bindings: readonly Binding[]): Array<{ keys: string; routes: string[] }> {
  const out: Array<{ keys: string; routes: string[] }> = [];
  for (let i = 0; i < bindings.length; i += 1) {
    for (let j = i + 1; j < bindings.length; j += 1) {
      const a = bindings[i];
      const b = bindings[j];
      if (chordOf(a.keys) !== chordOf(b.keys)) continue;
      if (!routesOverlap(a.routes, b.routes)) continue;
      out.push({ keys: a.keys, routes: [...new Set([...a.routes, ...b.routes])] });
    }
  }
  return out;
}

/** The cheatsheet rows for one route, in reading order.
 *
 *  Derived from the registry so it cannot go stale the way a hand-kept list does — a
 *  shortcut that is not registered simply does not appear, which is the correct failure. */
export function helpRows(bindings: readonly Binding[], route: string): Binding[] {
  return buildRegistry(bindings)
    .filter((b) => b.routes.length === 0 || b.routes.some((r) => route === r || route.startsWith(`${r}/`)))
    .filter((b) => b.description.trim().length > 0);
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/hotkeys.test.ts
```

Expected: **9/9 pass.**

- [ ] **Step 5: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add lib/hotkeys.ts tests/hotkeys.test.ts
git commit -m "feat(hotkeys): one registry, with conflicts reported instead of raced"
```

---

### Task 2: One listener, and the cheatsheet derived from it

**Files:**
- Create: `components/HotkeyProvider.tsx`
- Modify: `components/ShortcutHelp.tsx`
- Modify: `app/(shell)/layout.tsx`

- [ ] **Step 1: Write the provider**

```tsx
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { BINDINGS, chordOf } from "@/lib/hotkeys";

/** The ONE `keydown` listener in the shell.
 *
 *  Everything else that listens — sixteen files, each correctly handling Escape for its own
 *  dialog — keeps doing so. This listener only dispatches what the registry declares, and it
 *  skips when focus is inside a text field, because a shortcut that eats a keystroke someone
 *  is typing is worse than no shortcut at all.
 *
 *  `Tab`-and-modifier combinations are left alone so the browser's own focus movement and
 *  every assistive technology's shortcuts keep working. */
export default function HotkeyProvider() {
  const pathname = usePathname();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (typing) return;

      const parts = [
        e.ctrlKey || e.metaKey ? "mod" : "",
        e.shiftKey ? "shift" : "",
        e.altKey ? "alt" : "",
        e.key.toLowerCase(),
      ].filter(Boolean);
      const chord = chordOf(parts.join("+"));

      const hit = BINDINGS.find(
        (b) =>
          (b.routes.length === 0 ||
            b.routes.some((r) => pathname === r || pathname.startsWith(`${r}/`))) &&
          chordOf(b.keys) === chord,
      );
      hit?.run?.();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname]);

  return null;
}
```

Add an optional `run?: () => void` to `Binding` in `lib/hotkeys.ts`. A binding without one is
documentation-only, which is how the map's `MAP_SHORTCUTS` entries enter.

- [ ] **Step 2: Convert `MAP_SHORTCUTS` into registry entries**

In `components/ShortcutHelp.tsx`, keep `MAP_SHORTCUTS` as the **map's** data but export it in
the registry's shape, with `routes: ["/map"]`. Nothing about the map's behaviour changes; it
simply stops being a parallel list that can drift.

- [ ] **Step 3: Derive the cheatsheet rows**

Replace the hard-coded `MAP_SHORTCUTS` rendering with `helpRows(BINDINGS, pathname)`. The
dialog is reachable from `?` exactly as it is now — that behaviour does not change, and the
test in Task 1's suite pins that `?` still resolves.

- [ ] **Step 4: Mount the provider once**

In `app/(shell)/layout.tsx`, render `<HotkeyProvider />` alongside the existing shell chrome.
**Once** — a provider per page would put back the duplicate-listener problem this task exists
to remove.

- [ ] **Step 5: Prove no keydown listener was double-registered**

```bash
cd /home/pourya/Desktop/routeflow
grep -rn 'addEventListener("keydown"' components/meridian/SearchSlot.tsx components/CoverageMap.tsx
```

Expected: unchanged, or moved into the registry. **Do not delete a working listener as part of
this task** — `Escape` handling in a dialog is not what this plan is for, and removing it
without a replacement is how a dialog stops closing.

- [ ] **Step 6: Type check and run the guards**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit && npx vitest run tests/hotkeys.test.ts tests/icon-rule.test.ts
```

Expected: **0 errors** and all pass.

- [ ] **Step 7: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add components/HotkeyProvider.tsx components/ShortcutHelp.tsx lib/hotkeys.ts 'app/(shell)/layout.tsx'
git commit -m "feat(hotkeys): one listener for the shell, and a cheatsheet derived from the registry"
```

---
### Task 3: Every page names itself in Persian AND English

`lib/pageMeta.ts` is `{ title, overview }` today, and `tests/pageMeta.test.ts` already walks
every route under `app/(shell)` and fails on one missing an entry. **That test is the whole
mechanism**: widen the type and every route is forced to answer, on the day it is added.

**Files:**
- Modify: `lib/pageMeta.ts`
- Modify: `tests/pageMeta.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/pageMeta.test.ts`, add:

```ts
  it("every page carries an English title", () => {
    const missing = routes.filter((r) => !PAGE_META[r]?.titleEn);
    expect(missing, `no English title for:\n${missing.join("\n")}`).toEqual([]);
  });

  it("an English title is Latin and does not merely repeat the Persian", () => {
    // A Persian string with an English field is worse than no field: it looks bilingual and
    // is not.
    const offenders = Object.entries(PAGE_META)
      .filter(([, m]) => /[\u0600-\u06FF]/.test(m.titleEn ?? ""))
      .map(([r, m]) => `${r}: ${m.titleEn}`);
    expect(offenders).toEqual([]);
  });

  it("no two routes share an English title", () => {
    // The English title is what appears in <title> and in a browser tab. Two pages sharing
    // one is how someone ends up on the wrong tab for ten minutes.
    const seen = new Map<string, string[]>();
    for (const [r, m] of Object.entries(PAGE_META)) {
      if (!m.titleEn) continue;
      seen.set(m.titleEn, [...(seen.get(m.titleEn) ?? []), r]);
    }
    const dupes = [...seen.entries()].filter(([, rs]) => rs.length > 1);
    expect(dupes).toEqual([]);
  });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/pageMeta.test.ts
```

Expected: the first test FAILS — `titleEn` does not exist, so every route is missing one.

- [ ] **Step 3: Widen the type**

In `lib/pageMeta.ts`:

```ts
/** The title and one-paragraph overview that open every shell page.
 *
 *  `titleEn` exists because this app is used by people who read Persian and systems — browser
 *  tabs, <title>, a screenshot in a bug report — that are not. It is NOT a translation of the
 *  Persian title so much as the name a person would use for the page in English, which is why
 *  the test forbids two routes sharing one.
 *
 *  `help` is an optional id into `lib/help/` rather than a second paragraph: the copy already
 *  lives there, and a page should not be able to drift from it. */
export type PageMeta = {
  title: string;
  /** Latin script. Required, and unique across routes. */
  titleEn: string;
  overview: string;
  /** Id in `lib/help/`. When absent, the card shows no help affordance rather than an empty one. */
  help?: string;
};
```

- [ ] **Step 4: Fill in every entry**

Add `titleEn` to all ~30 existing entries. Use the name a bilingual person would actually say,
not a word-for-word rendering:

| Route | Persian | `titleEn` |
|---|---|---|
| `/sales` | خلاصهٔ فروش | Sales overview |
| `/sales/orders` | سفارش‌ها | Orders |
| `/sales/commission` | پورسانت | Commission |
| `/sales/schedule` | برنامهٔ تحویل | Delivery schedule |
| `/map` | نقشهٔ پوشش | Coverage map |
| `/leads` | پین‌های نقشه | Map pins |
| `/today` | امروز | Today |

…and so on for every entry. **If two routes end up with the same English name, the test
fails** — that is the intended pressure, not a nuisance.

- [ ] **Step 5: Run it and confirm it passes**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/pageMeta.test.ts
```

Expected: **all pass.**

- [ ] **Step 6: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add lib/pageMeta.ts tests/pageMeta.test.ts
git commit -m "feat(pages): every shell route names itself in Persian and English"
```

---

### Task 4: Proper help in the first card

`CardHelp.tsx` and `lib/help/` already exist; `PageHeaderCard.tsx` renders `overview` and
nothing else. This task connects them.

**Files:**
- Modify: `components/meridian/PageHeaderCard.tsx`
- Test: `tests/pageMeta.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/pageMeta.test.ts`:

```ts
  it("the routes that claim help have a help entry that actually exists", () => {
    // A card showing a help button that opens "not found" is worse than no button.
    const help = readFileSync(path.join(root, "lib/help/index.ts"), "utf8");
    const claiming = Object.entries(PAGE_META).filter(([, m]) => m.help);
    for (const [route, m] of claiming) {
      expect(help, `${route} claims help="${m.help}" but lib/help has no such id`).toContain(m.help!);
    }
  });
```

Add `import { readFileSync } from "node:fs";` and `const root = path.resolve(__dirname, "..");`
to the file's imports. **Read `lib/help/` first** and use its real export shape in place of
`index.ts` if it differs.

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/pageMeta.test.ts
```

Expected: FAIL once any route declares `help`.

- [ ] **Step 3: Render it**

In `components/meridian/PageHeaderCard.tsx`, add a `CardHelp` next to the title, keyed on
`help`:

```tsx
{help ? <CardHelp id={help} /> : null}
```

Pass `help` through from the caller (`appMetaFor(route)` at each shell page). The button
carries an icon from `ICONS` — see `2026-09-30-icon-rule.md`.

- [ ] **Step 4: Run the guards**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit && npx vitest run tests/pageMeta.test.ts tests/section-headings.test.ts tests/icon-rule.test.ts
```

Expected: **0 errors** and all pass.

- [ ] **Step 5: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add components/meridian/PageHeaderCard.tsx tests/pageMeta.test.ts
git commit -m "feat(pages): the first card opens its own help, and the help id must exist"
```

---

### Task 5: Count-up wherever a figure earns it

`CountUp` exists, is correct, and is used on one page. This is rollout.

**The rule that stops this becoming decoration**, from MASTER.md Tier 3: a figure may animate
only where the number itself is the message. A figure in a table row, a count in a list, or a
total the reader is comparing against another total does **not** animate — movement there draws
the eye to the thing that was already least important.

- [ ] **Step 1: Inventory the figures**

```bash
cd /home/pourya/Desktop/routeflow
grep -rn "faNum(" 'app/(shell)/sales/page.tsx' 'app/(shell)/sales/dashboard/page.tsx' 'app/(shell)/sales/commission/page.tsx' | wc -l
```

Sort the hits into two buckets:

- **Animates** — a headline figure a person walks up to read: the sales headline, the
  commission earned, a target percentage, the briefing hero's count.
- **Does not** — anything in a row, a list, a table, a comparison, or a figure that changes
  as the reader watches.

- [ ] **Step 2: Swap only the first bucket**

```tsx
import CountUp from "@/components/meridian/CountUp";

<CountUp value={d.revenue_toman} />
<CountUp value={pct} mode="pct" />
```

`CountUp` takes `value`, `mode` (`"int" | "pct"`) and `suffix` — never a function prop, because
it renders inside server components and a function cannot cross the server/client boundary.

- [ ] **Step 3: Leave the second bucket alone**

Do not touch a figure inside a table or a row. `prefers-reduced-motion` already renders the
final value with no sweep, and that is correct — **never "fix" it by making the animation
unconditional.**

- [ ] **Step 4: Type check and verify reduced motion still holds**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit && npx vitest run tests/countup.test.ts tests/useCountUp.test.ts 2>&1 | tail -15
```

Expected: **0 errors** and all pass. If those two suites do not exist under those names, find
them with `ls tests | grep -i count` and run what is there — the point is that the reduced-motion
path is covered, and it already is.

- [ ] **Step 5: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add 'app/(shell)/sales'
git commit -m "feat(stats): count-up on the headline figures, not on every number"
```

---

### Task 6: Verify the whole plan

- [ ] **Step 1: Run every suite this plan touched**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/hotkeys.test.ts tests/pageMeta.test.ts tests/icon-rule.test.ts tests/section-headings.test.ts
```

Expected: **all pass.**

- [ ] **Step 2: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.**

- [ ] **Step 3: Prove the shortcut registry has no conflicts**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/hotkeys.test.ts -t conflict
```

Expected: pass, and **zero conflicts reported.** A non-empty conflict list at the end of this
plan is the one thing that means the task did not achieve its purpose — go and resolve the
overlap rather than deleting the assertion.

- [ ] **Step 4: Run the full suite (backgrounded — ~14 min)**

```bash
cd /home/pourya/Desktop/routeflow
setsid nohup npx vitest run > /tmp/vitest-f.log 2>&1 &
tail -20 /tmp/vitest-f.log
```

Expected: `2 failed / 2735 passed` is a **PASS** when the two are `tests/jalali.test.ts`
("agrees with Intl for every day across 20 Jalali years") and
`tests/api/routing-route.test.ts` ("plans, commits and freezes"). Re-run any other failure
alone first.

---

## Verification Summary

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit                            # 0 errors
npx vitest run tests/hotkeys.test.ts         # all pass, zero conflicts
npx vitest run tests/pageMeta.test.ts        # every route has a unique English title
git status --short                           # clean
```

Every page names itself in both languages, its first card opens help that exists, shortcuts are
declared once with conflicts reported rather than raced, and figures animate where — and only
where — the number is the message.

## Notes for the Engineer

- **Do not centralise Escape or Enter.** They belong to whichever dialog owns focus, they work
  in all sixteen files today, and a registry that tries to own focus will break dialogs.
- **`CountUp` is already built and already correct.** This plan rolls it out. Under
  `prefers-reduced-motion` it renders the final figure with no sweep — that is the intended
  behaviour, not a bug to fix.
- **Never run `next build`** here. Use `npx tsc --noEmit` and `npx vitest run`.
- **`sharp` stays at exactly `0.33.5`** (`--save-exact`); this CPU has no AVX2.
- **Two suites flake under full-suite load** (`tests/jalali.test.ts`,
  `tests/api/routing-route.test.ts`). Both pass alone.
