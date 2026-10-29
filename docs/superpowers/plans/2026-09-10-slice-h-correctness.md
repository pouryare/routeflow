# Slice H — Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ten defects in the user's report that are *wrong* rather than unpolished, and pair each with a ratchet that makes its whole class impossible.

**Architecture:** Eight tasks. Seven are source fixes, each shipping with a vitest ratchet in the existing suite. The eighth adds a small Playwright *geometric* smoke harness — explicitly not screenshots — because half these defects are invisible to source analysis.

**Tech Stack:** Next.js 16.3.1 (App Router), React 19.2, TypeScript 5, Tailwind v4, vitest 4, `@playwright/test` (installed for this slice — see Task 8).

**Spec:** `docs/superpowers/specs/2026-09-10-remediation-and-design-language-design.md`

## Global Constraints

- **Building is allowed; leaving the service down is not.** (Revised 2026-09-10: the user confirmed the app is not yet in real production and may be stopped.) The `routeflow` systemd service has `WorkingDirectory=/srv/routeflow` and serves `next start` from `.next/`, so a build still overwrites the artifacts a *running* process holds a manifest for — it will serve 500s for chunk files while `systemctl is-active` still reports `active`. Therefore: `systemctl stop routeflow` **before** building, and `systemctl start routeflow` after. Never build under a live process.
- Production runs on `127.0.0.1:3003`. **Port 3000 is a different application** (`/root/Lightlinesllc/lightlinesllc`) — never probe it to judge RouteFlow.
- No hardcoded colours. Tokens only, or `npm run check:contrast` (500 pairs × 10 accent themes × 2 skins) stops meaning anything.
- Dates shown to a user are **Jalali**. Column naming decides which helper: `*_date` → `faJalaliDate`, `*_at` → `faJalaliDateTime`.
- Persian UI copy only. No Latin word reaches a field named `*_fa`.
- Never feed a physical measurement (`getBoundingClientRect()`) to a logical CSS property (`inset-inline-*`). In RTL `inset-inline-start` resolves to `right`.
- The app is RTL. `lib/chartScale`'s `barLayout` settles chart direction once — do not re-derive it.
- **Do not touch `PocketCard` / `Pocketed` / `.pocketed__slip`.** The user explicitly asked to keep the "two cards behind the main card" device.
- Lint baseline is **2 errors, 3 warnings** (`components/board/Board.tsx:79`, `components/board/BoardMobile.tsx:40`, both pre-existing `react-hooks/set-state-in-effect`). Do not add to it.
- Branch: `remediation-correctness`. Commit after every task.

---

### Task 1: Item 2 — the popover opens on the mirrored side

`HoverPill` measures a chip with `getBoundingClientRect()` (physical pixels) and writes the result to `inset-inline-start`, which resolves to `right` in RTL. The popover is placed its own distance from the **opposite** edge — hovering «روز من» (rightmost) drops the panel under «میدان و نقشه».

**Files:**
- Modify: `components/meridian/HoverPill.tsx:112` (the `anchor` state), `:154-161` (`openAt`), `:225-229` (the style object)
- Test: `tests/hoverPill.test.ts` (exists — add to it)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export function popoverStyle(anchor: PopAnchor | null): React.CSSProperties | undefined` and `export type PopAnchor = { left: number; top: number }` from `components/meridian/HoverPill.tsx`.

- [ ] **Step 1: Write the failing test**

Append to `tests/hoverPill.test.ts`:

```ts
import { popoverStyle } from "@/components/meridian/HoverPill";

describe("popoverStyle", () => {
  /* The popover is placed from a rect measured with getBoundingClientRect, whose `left`
     is a PHYSICAL offset from the viewport's left edge. `inset-inline-start` resolves to
     `right` in RTL, so writing that number there positions the panel its own distance
     from the WRONG edge — the bug the user reported as "the menu opens on mirror".
     Physical measurement demands a physical property. */
  it("positions with a physical property, never a logical one", () => {
    const style = popoverStyle({ left: 300, top: 64 })!;
    expect(style.left).toBe(300);
    expect(style).not.toHaveProperty("insetInlineStart");
    expect(style).not.toHaveProperty("insetInlineEnd");
    expect(style).not.toHaveProperty("right");
  });

  it("is fixed, so a scroll container cannot clip it", () => {
    expect(popoverStyle({ left: 10, top: 20 })!.position).toBe("fixed");
  });

  it("returns undefined before the chip has been measured", () => {
    expect(popoverStyle(null)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/hoverPill.test.ts`
Expected: FAIL — `popoverStyle` is not exported from `HoverPill.tsx`.

- [ ] **Step 3: Implement**

In `components/meridian/HoverPill.tsx`, add above the component:

```ts
export type PopAnchor = { left: number; top: number };

/** Where the hover panel sits, as a style object.
 *
 *  `left` — physical — because the number comes from getBoundingClientRect, which is
 *  physical. This used to be `insetInlineStart`, which in RTL resolves to `right`: the
 *  panel was placed its measured distance from the opposite edge, so hovering the first
 *  chip opened a menu under the last one. Logical properties are for values expressed in
 *  logical terms; a measured viewport offset is not one.
 *
 *  Pure, so tests/hoverPill.test.ts can hold the rule without a browser.
 */
export function popoverStyle(anchor: PopAnchor | null): React.CSSProperties | undefined {
  if (!anchor) return undefined;
  return { position: "fixed", top: anchor.top, left: anchor.left };
}
```

Change the state (was `{ left; right; top }` — `right` was written but never read):

```ts
const [anchor, setAnchor] = useState<PopAnchor | null>(null);
```

In `openAt`, drop the unused `right`:

```ts
setAnchor({ left: r.left, top: r.bottom + 8 });
```

Replace the inline style with `style={popoverStyle(anchor)}`.

Add `import type React from "react";` if it is not already imported as a type.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/hoverPill.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add components/meridian/HoverPill.tsx tests/hoverPill.test.ts
git commit -m "fix: hover menu opened on the mirrored side in RTL

getBoundingClientRect().left is a physical offset; inset-inline-start is
logical and resolves to `right` in RTL, so the panel was placed its own
measured distance from the opposite edge. Hovering the first chip opened
a menu under the last one.

Extracted popoverStyle() so the rule -- physical measurement, physical
property -- is held by a test rather than by whoever reads the line next."
```

---

### Task 2: Items 19 & 21 — dates are Gregorian in Persian digits

`faDateTime` and `faDate` render `d.getFullYear()/getMonth()/getDate()` through `faDigits`. The output *looks* Persian and is off by roughly 621 years. `faJalaliDate` and `faJalaliDateTime` already exist in `lib/jalali.ts`.

**Files:**
- Modify (16 call sites in 12 files):
  - `app/(shell)/gallery/page.tsx` — `faDate(p.taken_at)`, `faDate(lightbox.taken_at)` → `faJalaliDate`
  - `app/(shell)/report/page.tsx` — `faDateTime(now.toISOString())` → `faJalaliDateTime`
  - `app/(shell)/sales/admin/representatives/page.tsx` — `faDateTime(r.created_at)`, `faDateTime(s.completed_at)` → `faJalaliDateTime`
  - `app/(shell)/sales/admin/users/page.tsx` — `faDate(u.location_consent_at)` → `faJalaliDate`
  - `app/(shell)/sales/dashboard/page.tsx` — `faDateTime(kpiComputedAt)` → `faJalaliDateTime`
  - `app/(shell)/sales/forecast/page.tsx` — `faDateTime(computedAt)` → `faJalaliDateTime`
  - `components/CustomerDetailPanel.tsx` — `faDateTime(customer.synced_at)` → `faJalaliDateTime`
  - `components/DataFreshness.tsx` — `faDate(syncedAt)` → `faJalaliDate`
  - `components/HistoryTimeline.tsx` — `faDateTime(e.created_at)` → `faJalaliDateTime`
  - `components/sales/BatchesPanel.tsx` — `faDateTime(b.expiry_date)` → **`faJalaliDate`**; `faDateTime(d.delivered_at)` → `faJalaliDateTime`
  - `components/sales/ChequesBoard.tsx` — `faDateTime(c.due_date)` → **`faJalaliDate`**
  - `components/sales/ComplaintsPanel.tsx` — `faDateTime(c.reported_at)` → `faJalaliDateTime`
  - `components/sales/PaymentsPanel.tsx` — `faDateTime(p.received_at)` → `faJalaliDateTime`
- Create: `tests/no-gregorian-dates.test.ts`

**Naming rule:** every column above is SQLite `TEXT`, so the type does not say. The convention does: `*_date` is a date and takes `faJalaliDate`; `*_at` is a timestamp and takes `faJalaliDateTime`. `expiry_date` and `due_date` are the two that were showing a spurious `۰۰:۰۰`.

**Interfaces:**
- Consumes: `faJalaliDate(iso: string): string` and `faJalaliDateTime(iso: string): string` from `@/lib/jalali` (both already exist).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing ratchet**

Create `tests/no-gregorian-dates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Every date a Persian reader sees is Jalali.
 *
 *  `faDateTime` and `faDate` in lib/format.ts print the GREGORIAN year, month and day
 *  through faDigits. The result looks Persian — «۲۰۲۶/۰۹/۱۰» — and is about 621 years
 *  wrong. Nothing about the call site reveals that; the function name says "fa" and the
 *  output is in Persian digits, so it reads as correct at a glance and in code review.
 *  Sixteen call sites across twelve files went unnoticed until a user read a batch expiry.
 *
 *  So the check is at the import, which is the one place the mistake is unambiguous.
 *  lib/ may still use them (CSV, filenames, anything not read as a date by a human);
 *  a rendered file may not.
 */
const ROOT = join(__dirname, "..");
const GREGORIAN = /import\s*\{[^}]*\bfaDate(?:Time)?\b[^}]*\}\s*from\s*["']@\/lib\/format["']/;

function renderedFiles(): string[] {
  return execFileSync("git", ["ls-files", "app/**/*.tsx", "components/**/*.tsx"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

describe("no Gregorian dates in rendered output", () => {
  it("no file under app/ or components/ imports faDate or faDateTime", () => {
    const offenders = renderedFiles().filter((f) =>
      GREGORIAN.test(readFileSync(join(ROOT, f), "utf8")),
    );
    expect(
      offenders,
      `use faJalaliDate (for *_date) or faJalaliDateTime (for *_at) from @/lib/jalali:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/no-gregorian-dates.test.ts`
Expected: FAIL listing the 12 files.

- [ ] **Step 3: Swap every call site**

Work the file list above one at a time. For each: change the `@/lib/format` import to drop `faDate`/`faDateTime` (keep `faNum`, `faToman`, `faFixed` where present), add the corresponding import from `@/lib/jalali`, and update the call. Where a file already imports from `@/lib/jalali`, extend that import rather than adding a second one.

Example — `components/sales/BatchesPanel.tsx`:

```ts
// before
import { faNum, faDateTime } from "@/lib/format";
// after
import { faNum } from "@/lib/format";
import { faJalaliDate, faJalaliDateTime } from "@/lib/jalali";
```

```tsx
// before
{b.expiry_date ? faDateTime(b.expiry_date) : "—"}
// after — expiry_date is a DATE; faDateTime was appending a meaningless ۰۰:۰۰
{b.expiry_date ? faJalaliDate(b.expiry_date) : "—"}
```

- [ ] **Step 4: Run the ratchet and the full suite**

Run: `npx vitest run tests/no-gregorian-dates.test.ts && npx tsc --noEmit && npm test`
Expected: all PASS. If a snapshot or assertion elsewhere encoded a Gregorian string, fix the assertion — the new output is the correct one.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: dates were Gregorian rendered in Persian digits

faDateTime/faDate print getFullYear()/getMonth()/getDate() through
faDigits. «۲۰۲۶/۰۹/۱۰» reads as Persian and is ~621 years wrong. Sixteen
call sites in twelve files; the user found it on a batch expiry date.

expiry_date and due_date move to faJalaliDate rather than the datetime
form -- they are dates, and were carrying a meaningless ۰۰:۰۰.

tests/no-gregorian-dates.test.ts checks the import, which is the one
place the mistake is unambiguous. lib/ may still use them; anything
rendered may not."
```

---

### Task 3: Item 3 — English strings in fields named `_fa`

`lib/repo/actionCenter.ts:58-59` assigns the alert's raw `category` (free text, defaulting to the rule's `code`) to `sub_fa`, and `severity` to `bucket`. The user saw «critical» and «credit» on screen.

**Files:**
- Modify: `lib/repo/actionCenter.ts:52-65`
- Test: `tests/action-center-repo.test.ts` (exists — add to it)

**Interfaces:**
- Consumes: nothing.
- Produces: `ALERT_CATEGORY_FA` and `SEVERITY_FA` exported from `lib/repo/actionCenter.ts` for reuse by later slices.

- [ ] **Step 1: Write the failing test**

Append to `tests/action-center-repo.test.ts`:

```ts
it("never puts a Latin word in a _fa field, even for an unmapped category", () => {
  getDb()
    .prepare(
      "INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'critical','webhook_failed','بچ رو به انقضا',?)",
    )
    .run(iso(1));
  const r = actionCenterFor(session("owner", owner, null));
  const all = [...r.critical, ...r.warning, ...r.opportunity];
  expect(all.length).toBeGreaterThan(0);
  for (const item of all) {
    /* Three or more Latin letters in a row. Shorter runs are acceptable -- «KPI» and
       «SMS» are read as-is in Persian copy -- but a word is a leak. `title_fa` comes
       from the alert row and is authored Persian; `sub_fa` is the one this code sets. */
    expect(item.sub_fa ?? "").not.toMatch(/[A-Za-z]{3,}/);
  }
});

it("labels a known alert category in Persian", () => {
  getDb()
    .prepare(
      "INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'critical','credit','سقف اعتبار',?)",
    )
    .run(iso(1));
  const hit = actionCenterFor(session("owner", owner, null)).critical.find(
    (c) => c.kind === "alert",
  );
  expect(hit?.sub_fa).toBe("اعتبار");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/action-center-repo.test.ts`
Expected: FAIL — `sub_fa` is `"webhook_failed"` / `"credit"`.

- [ ] **Step 3: Implement**

In `lib/repo/actionCenter.ts`, above the alert mapper:

```ts
/** Alert categories, in Persian.
 *
 *  `alerts.category` is free text and falls back to the firing rule's `code`, so this map
 *  can never be exhaustive. An unmapped category yields NO subtitle rather than an
 *  English one: «webhook_failed» under a Persian headline is worse than nothing, and the
 *  bucket colour and title already carry the meaning.
 */
export const ALERT_CATEGORY_FA: Record<string, string> = {
  stock: "انبار",
  credit: "اعتبار",
  delivery: "تحویل",
  payment: "پرداخت",
  quality: "کیفیت",
  route: "مسیر",
};

/** severity is CHECK-constrained to these three, so this map IS exhaustive. */
export const SEVERITY_FA: Record<string, string> = {
  critical: "بحرانی",
  warning: "هشدار",
  opportunity: "فرصت",
};
```

Change the mapper:

```ts
sub_fa: ALERT_CATEGORY_FA[a.category],
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/action-center-repo.test.ts && npx tsc --noEmit`
Expected: PASS. If `sub_fa` is typed `string` rather than `string | undefined`, widen the type on the item interface.

- [ ] **Step 5: Commit**

```bash
git add lib/repo/actionCenter.ts tests/action-center-repo.test.ts
git commit -m "fix: raw English category and severity reached a field named sub_fa

alerts.category is free text defaulting to the rule code, so it cannot be
mapped exhaustively -- an unmapped one now yields no subtitle at all
rather than «webhook_failed» under a Persian headline. severity is
CHECK-constrained to three values, so SEVERITY_FA is exhaustive."
```

---

### Task 4: Items 5 & 12 — the top accent bar on cards

One rule at `app/globals.css:2471-2510` puts a 3px gradient `::after` on `.kbar`, `.gcard`, `.prow`, `.ptile` and `.task`, plus four `[data-tone]` overrides and a dark-skin bloom. `.kbar` has zero uses.

**Files:**
- Modify: `app/globals.css` — delete lines 2471–2510 (from the `/* ---- the image-3 top bar` comment through the closing `}` of the `:root[data-skin="dark"]` block)
- Create: `tests/no-card-accent-bar.test.ts`

> **Do not touch** `app/globals.css:2450-2453` (`.pocketed[data-tone] .pocketed__slip { border-top: … }`). That is the coloured edge of the slip *behind* the card — part of the pocket device the user asked to keep. It is a different rule at different lines.

**Interfaces:**
- Consumes: nothing. Produces: nothing.

- [ ] **Step 1: Write the failing ratchet**

Create `tests/no-card-accent-bar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** No card wears a coloured hairline across its top edge.
 *
 *  The user asked for this twice, on two different pages, and added: "there are multiple
 *  errors ... that exist on multiple places, i only mentioned it once." It was one rule
 *  riding five selectors, which is exactly why spotting it on /sales/products said
 *  nothing about /sales/pocket.
 *
 *  The check is shaped as "a zero-inset full-width hairline pseudo-element", not as the
 *  five class names, so re-adding the same device under a new name still fails.
 */
const CSS = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

describe("no top accent bar on cards", () => {
  it("defines no zero-inset hairline ::after inside .meridian", () => {
    /* Tolerant of property order and whitespace: any ::after rule that pins itself to the
       block start, spans the inline axis, and is 1-4px tall. */
    const block = /::after\s*\{[^}]*inset-block-start:\s*0[^}]*height:\s*[1-4]px[^}]*\}/g;
    expect(CSS.match(block) ?? []).toEqual([]);
  });

  it("no longer selects the five card classes for a bar", () => {
    for (const sel of [".kbar::after", ".gcard::after", ".prow::after", ".ptile::after", ".task::after"]) {
      expect(CSS.includes(sel), `${sel} should be gone`).toBe(false);
    }
  });

  it("keeps the pocket slip's coloured edge — a different device the user asked to keep", () => {
    expect(CSS).toMatch(/\.pocketed\[data-tone="good"\] \.pocketed__slip/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/no-card-accent-bar.test.ts`
Expected: FAIL on the first two, PASS on the third.

- [ ] **Step 3: Delete the rule**

Open `app/globals.css`. Delete from the line reading:

```
/* ---- the image-3 top bar : a lit accent strip whose ends melt into the card edge ----
```

through the closing brace of the `:root[data-skin="dark"] … { filter: drop-shadow(…) }` block that ends immediately before `/* ---- 5 · the board (drag and drop) ---- */`. That is 40 lines: the base rule, the four `[data-tone]` overrides, and the dark-skin bloom.

- [ ] **Step 4: Run the ratchet and check contrast**

Run: `npx vitest run tests/no-card-accent-bar.test.ts && npm run check:contrast`
Expected: PASS; contrast still 500/500 (the bar was decorative and carried no text).

- [ ] **Step 5: Commit**

```bash
git add app/globals.css tests/no-card-accent-bar.test.ts
git commit -m "fix: remove the top accent bar from every card

One rule riding five selectors, which is why the user reported it on
/sales/products and /sales/pocket as if they were separate bugs.
.kbar had zero uses.

The ratchet matches the SHAPE -- a zero-inset full-width 1-4px ::after
inside .meridian -- not the five class names, so the same device cannot
return under a new name. It also asserts .pocketed__slip's coloured edge
still exists: that is the pocket device, which the user asked to keep."
```

---

### Task 5: Item 24 — seven pages lost their sibling navigation

`facilities`, `gallery`, `leads`, `planner` and the three `sales/admin/*` pages are `"use client"`, so they cannot import the async server `PageHeader` and fell back to a tab-less `PageHeaderCard`.

The fix is a `layout.tsx` per route — **and each must wrap `PageHeader` in its own `<Suspense>`.** Next's bundled docs, `layout.md:318`: *"Because `loading.js` sits below `layout.js` in the component hierarchy, it cannot show a fallback for uncached or runtime data access in the layout itself, such as calling `cookies()`."* `PageHeader` awaits `cookies()`. Without the boundary this reintroduces the navigation stall that slice A+B was built to fix.

**Files:**
- Create: `app/(shell)/facilities/layout.tsx`, `app/(shell)/gallery/layout.tsx`, `app/(shell)/leads/layout.tsx`, `app/(shell)/planner/layout.tsx`, `app/(shell)/sales/admin/users/layout.tsx`, `app/(shell)/sales/admin/groups/layout.tsx`, `app/(shell)/sales/admin/representatives/layout.tsx`
- Modify: the seven matching `page.tsx` — remove the `<PageHeaderCard {...pageMetaFor("…")} />` line and its now-unused imports
- Modify: `components/meridian/PageHeader.tsx` — its doc comment currently says "this renders inside a PAGE, not a layout", which this task makes false
- Create: `tests/shell-pages-have-tabs.test.ts`

**Interfaces:**
- Consumes: `PageHeader({ route: string })`, `PageHeaderCard({ title, overview, tabs?, currentHref? })`, `pageMetaFor(pathname: string): PageMeta`.
- Produces: nothing.

- [ ] **Step 1: Write the failing ratchet**

Create `tests/shell-pages-have-tabs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Every page inside the shell shows its sibling tabs.
 *
 *  PageHeader is async (it reads the session to know which siblings a role may reach), so
 *  a "use client" page cannot import it. Seven pages quietly fell back to the tab-less
 *  PageHeaderCard and lost their in-page navigation — a whole nav row missing, and no
 *  test had anything to say about it.
 *
 *  A page satisfies this by importing PageHeader itself, or by having any ancestor
 *  layout inside app/(shell) that does.
 */
const ROOT = join(__dirname, "..");
const IMPORTS_HEADER = /from\s*["']@\/components\/meridian\/PageHeader["']/;

function shellPages(): string[] {
  return execFileSync("git", ["ls-files", "app/(shell)/**/page.tsx"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/** Walk up from the page to app/(shell), looking for a layout that supplies the header. */
function coveredByAncestorLayout(page: string): boolean {
  let dir = dirname(page);
  while (dir.startsWith("app/(shell)")) {
    const layout = join(ROOT, dir, "layout.tsx");
    if (existsSync(layout) && IMPORTS_HEADER.test(readFileSync(layout, "utf8"))) return true;
    dir = dirname(dir);
  }
  return false;
}

describe("shell pages keep their sibling tabs", () => {
  it("every (shell) page resolves a PageHeader", () => {
    const offenders = shellPages().filter(
      (p) => !IMPORTS_HEADER.test(readFileSync(join(ROOT, p), "utf8")) && !coveredByAncestorLayout(p),
    );
    expect(
      offenders,
      `add a layout.tsx rendering <PageHeader route="…" /> inside <Suspense>:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("a layout that renders PageHeader wraps it in Suspense", () => {
    /* layout.md:318 — loading.tsx sits BELOW layout.tsx and cannot cover a layout's own
       await. PageHeader awaits cookies(). Without its own boundary the layout blocks
       every navigation into the route and loading.tsx never renders: a slow app with no
       error, which is the failure mode slice A+B existed to remove. */
    const layouts = execFileSync("git", ["ls-files", "app/(shell)/**/layout.tsx"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const offenders = layouts.filter((l) => {
      const src = readFileSync(join(ROOT, l), "utf8");
      return IMPORTS_HEADER.test(src) && !/<Suspense/.test(src);
    });
    expect(offenders, `wrap <PageHeader> in <Suspense>:\n${offenders.join("\n")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/shell-pages-have-tabs.test.ts`
Expected: FAIL listing the seven pages.

- [ ] **Step 3: Add the seven layouts**

For each route, create `layout.tsx`. Template — this is `app/(shell)/facilities/layout.tsx`; repeat for the other six, changing `ROUTE` and the function name only:

```tsx
import { Suspense, type ReactNode } from "react";
import PageHeader from "@/components/meridian/PageHeader";
import PageHeaderCard from "@/components/meridian/PageHeaderCard";
import { pageMetaFor } from "@/lib/pageMeta";

/** The page-overview card lives here rather than in page.tsx because the page is a
 *  client component and PageHeader is an async server one — a client file cannot import
 *  it, which is how this route lost its sibling tabs.
 *
 *  The <Suspense> is load-bearing, not decoration. PageHeader awaits cookies(); per Next's
 *  layout.js docs, loading.tsx sits BELOW layout.tsx and cannot cover a layout's own
 *  await, so without this boundary the layout blocks every navigation into the route and
 *  loading.tsx silently never renders. tests/shell-pages-have-tabs.test.ts holds the rule.
 *
 *  The fallback is the real card minus the tabs: title and overview are static, so the
 *  correct page name paints immediately and only the tab row streams in. That is exactly
 *  what these pages showed permanently before this file existed.
 */
const ROUTE = "/facilities";

export default function FacilitiesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<PageHeaderCard {...pageMetaFor(ROUTE)} />}>
        <PageHeader route={ROUTE} />
      </Suspense>
      {children}
    </>
  );
}
```

Routes and function names:

| File | `ROUTE` | function |
|---|---|---|
| `app/(shell)/facilities/layout.tsx` | `/facilities` | `FacilitiesLayout` |
| `app/(shell)/gallery/layout.tsx` | `/gallery` | `GalleryLayout` |
| `app/(shell)/leads/layout.tsx` | `/leads` | `LeadsLayout` |
| `app/(shell)/planner/layout.tsx` | `/planner` | `PlannerLayout` |
| `app/(shell)/sales/admin/users/layout.tsx` | `/sales/admin/users` | `AdminUsersLayout` |
| `app/(shell)/sales/admin/groups/layout.tsx` | `/sales/admin/groups` | `AdminGroupsLayout` |
| `app/(shell)/sales/admin/representatives/layout.tsx` | `/sales/admin/representatives` | `AdminRepresentativesLayout` |

- [ ] **Step 4: Remove the duplicate card from the seven pages**

In each `page.tsx`, delete the `<PageHeaderCard {...pageMetaFor("…")} />` element and any import of `PageHeaderCard` or `pageMetaFor` that is now unused. Leave the rest of the page alone. `npx tsc --noEmit` and `npx eslint` will name any import you miss.

- [ ] **Step 5: Correct PageHeader's doc comment**

In `components/meridian/PageHeader.tsx`, replace the final paragraph of the block comment:

```
 *  Async, and that is fine: this renders inside a PAGE, not a layout. loading.tsx covers
 *  a page's own awaits — it is only an await in a layout that blocks navigation.
```

with:

```
 *  Async. Rendered from a page that is itself a server component, that is free. Rendered
 *  from a layout — which seven client-component routes must do, since a client file
 *  cannot import this — it MUST be wrapped in the layout's own <Suspense>: loading.tsx
 *  sits below layout.tsx and cannot cover a layout's await, so an unwrapped one blocks
 *  every navigation into the route. tests/shell-pages-have-tabs.test.ts holds both rules.
```

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/shell-pages-have-tabs.test.ts && npx tsc --noEmit && npx eslint && npm test`
Expected: all PASS; lint still at 2 errors / 3 warnings.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix: seven shell pages had lost their sibling navigation

PageHeader is async because it reads the session to decide which sibling
tabs a role may reach, so a \"use client\" page cannot import it. Seven
pages fell back to the tab-less PageHeaderCard and quietly lost a whole
nav row.

Each now gets a layout.tsx -- with PageHeader inside its OWN <Suspense>.
Per Next's layout.js docs, loading.tsx sits below layout.tsx and cannot
cover a layout's await, so an unwrapped PageHeader would block every
navigation into the route and silently disable loading.tsx: the exact
failure slice A+B existed to remove. The ratchet tests both halves."
```

---

### Task 6: Item 8 — the sync indicator announces a state nobody needs

`components/SyncStatus.tsx` renders «آنلاین» permanently. The user wants only the states that need attention.

**Files:**
- Modify: `components/SyncStatus.tsx`
- Create: `tests/syncBadge.test.ts`

**Interfaces:**
- Produces: `export function syncBadge(s: { online: boolean; pending: number; trouble: number }): { tone: "crit" | "warn" | "muted"; label: string } | null` from `components/SyncStatus.tsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/syncBadge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { syncBadge } from "@/components/SyncStatus";

/** The indicator is for exceptions. "Online, nothing queued" is the state the app is in
 *  almost all of the time, and a badge that is always lit is a badge nobody reads — so
 *  the one state that needs no action renders nothing at all. */
describe("syncBadge", () => {
  it("shows nothing when online and fully synced", () => {
    expect(syncBadge({ online: true, pending: 0, trouble: 0 })).toBeNull();
  });

  it("shows offline", () => {
    expect(syncBadge({ online: false, pending: 0, trouble: 0 })?.label).toBe("آفلاین");
  });

  it("shows a queue while online", () => {
    const b = syncBadge({ online: true, pending: 3, trouble: 0 })!;
    expect(b.label).toContain("در صف");
    expect(b.tone).toBe("warn");
  });

  it("trouble outranks a queue", () => {
    const b = syncBadge({ online: true, pending: 3, trouble: 1 })!;
    expect(b.tone).toBe("crit");
    expect(b.label).toContain("مشکل");
  });

  it("offline outranks everything", () => {
    expect(syncBadge({ online: false, pending: 3, trouble: 1 })?.label).toBe("آفلاین");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/syncBadge.test.ts`
Expected: FAIL — `syncBadge` is not exported.

- [ ] **Step 3: Implement**

In `components/SyncStatus.tsx`, above the component:

```ts
/** What the indicator should say, or null for "say nothing".
 *
 *  Ranked, because these overlap: offline is the most actionable and hides the rest
 *  (nothing will drain while there is no connection), then failures, then a queue that is
 *  merely waiting. Pure, so the ranking is testable without a browser — the component
 *  around it is untested browser glue by repo convention.
 */
export function syncBadge(s: {
  online: boolean;
  pending: number;
  trouble: number;
}): { tone: "crit" | "warn" | "muted"; label: string } | null {
  if (!s.online) return { tone: "muted", label: "آفلاین" };
  if (s.trouble > 0) return { tone: "crit", label: `${faNum(s.trouble)} مشکل در همگام‌سازی` };
  if (s.pending > 0) return { tone: "warn", label: `${faNum(s.pending)} در صف` };
  return null;
}
```

In the component, replace the button's contents and add an early return after `pending`/`trouble` are computed:

```tsx
const badge = syncBadge({ online, pending, trouble });
if (!badge) return null;
```

and inside the button:

```tsx
<span
  className="inline-block h-2 w-2 rounded-full"
  style={{ background: `var(--${badge.tone === "muted" ? "text-faint" : badge.tone})` }}
/>
<span className="text-[var(--text-muted)]">{badge.label}</span>
```

Note the existing `if (!authed) return null;` must stay above this.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/syncBadge.test.ts && npx tsc --noEmit && npx eslint`
Expected: PASS, tsc clean, lint unchanged.

- [ ] **Step 5: Commit**

```bash
git add components/SyncStatus.tsx tests/syncBadge.test.ts
git commit -m "fix: the sync indicator no longer announces «آنلاین» forever

A badge that is always lit is a badge nobody reads. The one state
needing no action now renders nothing, and the remaining three are
ranked: offline hides the rest, because nothing drains without a
connection."
```

---

### Task 7: Items 11 & 28 — text against the edge, and a pre-rename brand mark

Two small, unrelated fixes; one commit each.

**Files:**
- Modify: `components/predict/LearnedCapacity.tsx:67` (item 11)
- Modify: `components/CoverageMap.tsx:1365` and `app/globals.css` `.side__mark` (item 28)

**Interfaces:** none.

- [ ] **Step 1: Item 11 — give the note its padding**

`components/predict/LearnedCapacity.tsx:67` renders «زیر ۵ مشاهده، همان مقدار پیش‌فرض کارخانه استفاده می‌شود.» flush against the container's inline-start edge. Add padding to the **container**, not a margin on the text — a margin moves the text and leaves the box the wrong size, and the next string added to the same box has the same bug again.

Find the element wrapping that `<p>` and give it `px-[var(--space-3)] py-[var(--space-2)]` (or extend its existing padding). Confirm visually in Task 8's harness, which asserts no element overflows its container.

- [ ] **Step 2: Commit item 11**

```bash
git add components/predict/LearnedCapacity.tsx
git commit -m "fix: capacity note sat flush against its container edge

Padding on the container, not a margin on the text: a margin moves this
one string and leaves the next one added to the same box broken."
```

- [ ] **Step 3: Item 28 — replace the «ن» tile**

`components/CoverageMap.tsx:1365` renders `<div className="side__mark">ن</div>` — a gradient tile bearing a single Persian letter, left from the pre-rename theme. Replace it with the same mark the app header wears, so both halves of the app introduce themselves identically:

```tsx
<div className="side__mark" aria-hidden="true">
  <svg viewBox="0 0 44 24" width="24" height="13" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round">
    <path d="M22 12c-3.2-4.6-6-6.2-9.4-6.2C8.4 5.8 5 8.6 5 12s3.4 6.2 7.6 6.2c3.4 0 6.2-1.6 9.4-6.2Zm0 0c3.2-4.6 6-6.2 9.4-6.2C35.6 5.8 39 8.6 39 12s-3.4 6.2-7.6 6.2c-3.4 0-6.2-1.6-9.4-6.2Z" />
  </svg>
</div>
```

In `app/globals.css`, `.side__mark` currently sets `font-size: 17px; font-weight: 600;` for the letter. Leave the gradient, size and radius; those match `.mark` in the header. Add `svg { display: block; }` handling if needed — mirror how `.meridian .mark svg { display: block; }` is declared.

- [ ] **Step 4: Verify and commit item 28**

Run: `npx tsc --noEmit && npx vitest run tests/no-emoji-icons.test.ts`
Expected: PASS.

```bash
git add components/CoverageMap.tsx app/globals.css
git commit -m "fix: map sidebar still wore the pre-rename «ن» tile

Replaced with the header's own mark so both halves of the app introduce
themselves the same way."
```

---

### Task 8: The geometric smoke harness

Half of the user's 29 defects are invisible to source analysis. `playwright` is already a
devDependency (used by `scripts/gen-basemap-thumbs.mjs`). This adds a *small* suite of
geometric invariants — **not screenshots**: this programme is a deliberate redesign, and
visual-regression baselines would fail on every intended change until somebody disabled
them.

**Two decisions worth stating, because the obvious approach is wrong here:**

1. **Bare `playwright` inside vitest, not `@playwright/test`.** `@playwright/test` is a
   *separate package* and is **not installed** — only the `playwright` library is. Adding
   it would bring a second test runner and a second config for two assertions. Driving
   `chromium` from an ordinary vitest test reuses the runner the repo already has.
2. **It runs inside `npm test`.** A smoke suite behind a `test:smoke` script that nobody
   types is not a ratchet. The cost is ~40s of `next dev` boot on a suite that already
   takes 230s, to guard the class of defect that produced fifteen of the twenty-nine.

**Files:**
- Create: `tests/smoke/server.ts` — boots and tears down `next dev -p 3100`
- Create: `tests/smoke/geometry.test.ts`
- Create: `vitest.smoke.mts`
- Modify: `package.json` — `"test": "vitest run && vitest run -c vitest.smoke.mts"`, plus `"test:smoke": "vitest run -c vitest.smoke.mts"` for running it alone
- `vitest.config.mts` needs **no change**: its `include` is `tests/**/*.test.ts`, and the smoke config overrides `include` to point at the smoke directory only. Verify the two do not both collect the file.

**Interfaces:**
- Produces: `startDevServer(): Promise<() => Promise<void>>` from `tests/smoke/server.ts` — resolves once the server answers, returning a teardown function.

> **Server:** `next dev`, never `next start`. `next dev` writes to `.next/dev/` and leaves
> the `.next/` artifacts production is serving alone. **Never run `npm run build`.**

> **Auth:** every shell route sits behind `proxy.ts`, so the first version covers `/login`,
> which is reachable unauthenticated. Minting a session cookie is a follow-up. A
> two-assertion harness that runs beats a ten-assertion one that is disabled — if auth
> proves awkward, ship the two and record the gap.

- [ ] **Step 1: Write the server helper**

Create `tests/smoke/server.ts`:

```ts
import { spawn } from "node:child_process";

const PORT = 3100;
export const BASE = `http://127.0.0.1:${PORT}`;

/** Boot `next dev` on a spare port and resolve once it answers.
 *
 *  dev, NOT `next start`: the routeflow systemd service serves .next/ out of this very
 *  directory, and a production build would pull the chunk files out from under the
 *  running process. `next dev` writes to .next/dev/ and leaves that alone.
 *
 *  Reuses an already-running server if one answers, so a developer with dev open does not
 *  pay the boot twice.
 */
export async function startDevServer(): Promise<() => Promise<void>> {
  if (await answers()) return async () => {};

  const proc = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: new URL("../..", import.meta.url).pathname,
    stdio: "ignore",
    detached: false,
  });

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await answers()) {
      return async () => {
        proc.kill("SIGTERM");
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill("SIGTERM");
  throw new Error(`next dev did not answer on ${PORT} within 120s`);
}

async function answers(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Write the invariants**

Create `tests/smoke/geometry.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { startDevServer, BASE } from "./server";

/** Geometric invariants that survive a redesign.
 *
 *  Each maps to a defect the user found that 1,930 vitest cases could not see, because
 *  the suite tests logic and these are rendered output. Deliberately NOT screenshots:
 *  this programme changes the design on purpose, and visual baselines would fail on every
 *  intended change until someone switched them off.
 */
let browser: Browser;
let stop: () => Promise<void>;

beforeAll(async () => {
  stop = await startDevServer();
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await stop?.();
});

describe("page geometry", () => {
  it("never scrolls sideways", async () => {
    /* A horizontal scrollbar on an RTL page almost always means a fixed width or a
       negative margin escaping its container -- the family behind items 4, 6 and 17. */
    const page = await browser.newPage({ locale: "fa-IR" });
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    await page.close();
    expect(overflow).toBeLessThanOrEqual(1); // 1px for sub-pixel rounding
  }, 60_000);

  it("has no element whose content overflows its own box", async () => {
    /* Items 11 and 17: text escaping its card. scrollWidth > clientWidth means the box is
       not big enough for what is inside it. Elements that scroll on purpose are exempt. */
    const page = await browser.newPage({ locale: "fa-IR" });
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    const offenders = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => {
          const s = getComputedStyle(el);
          if (s.overflowX !== "visible" || s.position === "fixed") return false;
          return el.scrollWidth - el.clientWidth > 2;
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`),
    );
    await page.close();
    expect(offenders).toEqual([]);
  }, 60_000);
});
```

- [ ] **Step 3: Add the smoke config**

Create `vitest.smoke.mts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

const dirname = path.dirname(new URL(import.meta.url).pathname);

/** Separate config because these need a browser and a server, so they are slow and must
 *  not run inside the unit suite's watch loop. They still run in `npm test` -- a ratchet
 *  behind a script nobody types is not a ratchet. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/smoke/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(dirname, ".") } },
});
```

- [ ] **Step 4: Wire the scripts and keep the two configs disjoint**

In `package.json`:

```json
"test": "vitest run && vitest run -c vitest.smoke.mts",
"test:unit": "vitest run",
"test:smoke": "vitest run -c vitest.smoke.mts"
```

`vitest.config.mts` includes `tests/**/*.test.ts`, which **would** also match
`tests/smoke/geometry.test.ts`. Add an exclude so the unit run does not try to boot a
browser:

```ts
include: ["tests/**/*.test.ts"],
exclude: ["tests/smoke/**"],
```

- [ ] **Step 5: Run it**

Run: `npm run test:smoke`
Expected: PASS. Then `npm run test:unit` — expect the same count as before (the smoke file must not be collected twice).

- [ ] **Step 6: Confirm production is untouched**

```bash
systemctl is-active routeflow
curl -s -o /dev/null -w "%{http_code}\n" -m 10 http://127.0.0.1:3003/login
curl -s -m 10 http://127.0.0.1:3003/login | grep -oE '/_next/static/chunks/[^"]+\.css' | sort -u \
  | while read u; do printf "%-45s -> %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:3003$u)"; done
```

Expected: `active`, `200`, and every stylesheet `200`. `next dev` writes only to
`.next/dev/`; if any of these fail, **stop and report** — do not rebuild.

- [ ] **Step 7: Commit**

```bash
git add tests/smoke package.json vitest.config.mts vitest.smoke.mts
git commit -m "test: geometric smoke harness for the defects vitest cannot see

Fifteen of the user's twenty-nine defects were invisible to 1,930 passing
tests, because the suite tests logic and those are rendered output.

Geometric assertions, explicitly NOT screenshots: this programme is a
deliberate redesign, and visual baselines would fail on every intended
change until someone switched them off. Nothing overflows its box,
nothing scrolls sideways -- true whatever the page looks like.

Bare playwright inside vitest rather than @playwright/test, which is a
separate package and is not installed; this repo already depends on
playwright and already has a runner. Wired into `npm test` rather than a
test:smoke script, because a ratchet nobody runs is not a ratchet.

Runs against `next dev -p 3100`. Never `next start`: the systemd service
serves .next/ from this same directory."
```

---

## Self-review

**Spec coverage.** Slice H lists items 2, 3, 5, 8, 11, 12, 19, 21, 24, 28 plus decision D2's harness. Mapped: 2 → Task 1; 19/21 → Task 2; 3 → Task 3; 5/12 → Task 4; 24 → Task 5; 8 → Task 6; 11/28 → Task 7; D2 → Task 8. No gaps.

**Type consistency.** `PopAnchor` (Task 1) is used only in Task 1. `ALERT_CATEGORY_FA`/`SEVERITY_FA` (Task 3) are exported for later slices, unused here. `syncBadge`'s return type is identical in the test and the implementation. `PageHeader({ route })` and `PageHeaderCard({ title, overview, tabs?, currentHref? })` match the real signatures verified in the source.

**Known gaps carried deliberately.**
- Task 8's authenticated coverage depends on session minting, which is flagged as an unknown with an explicit fallback rather than assumed.
- Item 2's Playwright assertion (popover within its trigger's span) is **not** in Task 8 — it needs an authenticated route. The pure-function test in Task 1 is the ratchet; add the geometric one when auth is solved.
- Item 5's scope: the accent bar is removed from `.gcard`/`.prow`/`.ptile`/`.task`. If «پاکت» still shows a top line afterwards it is `.pocketed__slip`'s coloured edge, which is the pocket device the user asked to keep — **ask before removing it**, do not decide unilaterally.
