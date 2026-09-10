# Slice I — Header & Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the header on one row by removing the brand block (item 1), fix the chip thumb that reads as a circle (item 13), and replace the inert search slot with one full-screen search overlay reachable from every shell page, `/map` included (items 9 and the search half of 29).

**Architecture:** Five tasks. Tasks 1–2 are markup + CSS, each held by a static vitest ratchet and a geometric Playwright assertion in the existing smoke suite. Tasks 3–4 build the overlay's brain as pure, tested code: a client-side model (`lib/searchModel.ts`) and a scoped server search (`lib/repo/search.ts` behind `GET /api/search`). Task 5 is the overlay component itself, portalled into the `.meridian` root, verified end-to-end by the smoke suite. Task 6 verifies, deploys and merges.

**Tech Stack:** Next.js 16.3.1 (App Router), React 19.2, TypeScript 5, `framer-motion` 13 (already a dependency), vitest 4, `playwright` (smoke suite, `tests/smoke/`).

**Spec:** `docs/superpowers/specs/2026-09-10-remediation-and-design-language-design.md` — sections "D4 — One search, one overlay" and "Slice I — Header & search".

## Global Constraints

- **Building is allowed; leaving the service down is not.** `systemctl stop routeflow` **before** `npm run build`, `systemctl start routeflow` after. Never build under a live process — it serves 500s for chunk files while `systemctl is-active` still says `active`.
- Production runs on `127.0.0.1:3003`. **Port 3000 is a different application** — never probe it to judge RouteFlow.
- No hardcoded colours. Tokens only (`var(--ink)`, `var(--sunk)`, `var(--surface)`, `var(--line)`, `var(--accent)`, `var(--muted)`, `var(--bg)` …), or `npm run check:contrast` stops meaning anything.
- Persian UI copy only. No emoji or Unicode glyph as an icon — `<Icon name="…" />` from `components/meridian/Icon`, icon props typed `IconName` (`tests/no-emoji-icons.test.ts` enforces).
- Dates shown to a user are **Jalali** (`faJalaliLong` / `faJalaliDate` / `faJalaliDateTime` from `lib/jalali.ts`).
- Never feed a physical measurement (`getBoundingClientRect()`) to a logical CSS property (`inset-inline-*`).
- **Do not touch `PocketCard` / `Pocketed` / `.pocketed__slip`.**
- `AppShell`'s layout stays synchronous; the session read stays in `AppHeader` (`tests/shellLayout.test.ts`).
- Scope every server read through `lib/session.ts` (`orderFilter`, `scopeGroupIds`). A search is a new read path, so it is a new place to leak another group's or tenant's data.
- Lint baseline is **2 errors, 3 warnings** (pre-existing, `components/board/Board.tsx:79`, `components/board/BoardMobile.tsx:40`). Do not add to it.
- Branch: `remediation-header-search`, cut from `main`. Commit after every task and push the branch.

## File map

| File | Responsibility | Task |
|---|---|---|
| `components/meridian/AppHeader.tsx` | one-row header: nav + actions, no brand block | 1, 5 |
| `components/meridian/HeaderSkeleton.tsx` | same shape, session-free | 1 |
| `components/meridian/PageHeader.tsx` / `PageHeaderCard.tsx` | receive the Jalali date the header gave up | 1 |
| `app/globals.css` (top bar, tabs, searchslot blocks) | one-row layout + 1024px breakpoint; chip proportion; overlay styles | 1, 2, 5 |
| `lib/searchModel.ts` (new) | pure: page ranking, recents, keyboard cursor | 3 |
| `lib/repo/search.ts` (new) | scoped customer + order search | 4 |
| `app/api/search/route.ts` (new) | HTTP face of the above | 4 |
| `components/meridian/SearchOverlay.tsx` (new) | the full-screen overlay | 5 |
| `components/meridian/SearchSlot.tsx` | trigger + ⌘K owner, opens the overlay | 5 |
| `tests/app-header.test.ts` (new) | static ratchets for items 1 and 13 | 1, 2 |
| `tests/searchModel.test.ts`, `tests/search-repo.test.ts` (new) | model + scoping | 3, 4 |
| `tests/smoke/geometry.test.ts` | geometric ratchets for 1, 13, and the overlay | 1, 2, 5 |

---

### Task 0: Branch

- [ ] **Step 1:** `cd /root/pourya/RouteFlow && git checkout main && git pull && git checkout -b remediation-header-search`
- [ ] **Step 2:** Record the lint baseline: `npx eslint 2>&1 | tail -3` — expect `2 errors, 3 warnings`.

---

### Task 1: Item 1 — the header on one row

Today `.top` holds a 46px gradient mark, a `RouteFlow` `<h1>` and the Jalali date, and the nav pill sits on its own row below (`.segwrap`, rendered by `HoverPill`). The user asked for the logo to go. With it gone the seven group chips (~632px) plus search/bell/avatar (~145px) fit one row at ≥1024px. Below that the nav wraps to its own row, on purpose, at a documented breakpoint.

The date is not deleted. It moves to the page-overview card, where it is read.

**Files:**
- Modify: `components/meridian/AppHeader.tsx` (the whole `return`, plus the `faJalaliLong` import and the doc comment's first line)
- Modify: `components/meridian/HeaderSkeleton.tsx` (the whole `return`)
- Modify: `components/meridian/PageHeader.tsx` (both `<PageHeaderCard …>` calls)
- Modify: `components/meridian/PageHeaderCard.tsx` (props + one line before `<h1 className="phc__title">`)
- Modify: `app/globals.css` — the `/* ---- top bar */` block (~line 1863) and the `.segwrap` rule (~line 2002)
- Test: `tests/app-header.test.ts` (create), `tests/smoke/geometry.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `PageHeaderCard` gains an optional `date?: string` prop. `HoverPill`'s `.segwrap` is now a child of `.top`, and Task 5 relies on `.topright` remaining the last child of `.top`.

- [ ] **Step 1: Write the failing static ratchet**

Create `tests/app-header.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** Item 1. The user asked for the logo to go, and removing it is what lets seven group
 *  chips and the action cluster share one row. A brand block that creeps back pushes the
 *  nav onto a second row again, silently, at every width. */
describe("the header is one row", () => {
  const header = read("components/meridian/AppHeader.tsx");
  const skeleton = read("components/meridian/HeaderSkeleton.tsx");

  it("carries no brand mark, wordmark or date", () => {
    for (const src of [header, skeleton]) {
      expect(src).not.toMatch(/brandwrap|className="mark"|<h1|faJalaliLong/);
    }
  });

  it("puts the nav inside .top, before the actions", () => {
    const top = header.indexOf('className="top"');
    const nav = header.indexOf("<HoverPill");
    const actions = header.indexOf('className="topright"');
    expect(top).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(top);
    expect(actions).toBeGreaterThan(nav);
  });

  it("the date moved to the page-overview card rather than disappearing", () => {
    expect(read("components/meridian/PageHeader.tsx")).toMatch(/faJalaliLong/);
    expect(read("components/meridian/PageHeaderCard.tsx")).toMatch(/phc__date/);
  });

  it("the brand-block CSS is gone with it", () => {
    const css = read("app/globals.css");
    expect(css).not.toMatch(/\.meridian \.brandwrap|\.meridian \.mark\b|\.meridian \.top h1|\.meridian \.top \.sub/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/app-header.test.ts`
Expected: FAIL on all four — `brandwrap` is present, `<HoverPill` comes after `.top` closes, and so on.

- [ ] **Step 3: Rewrite the header**

In `components/meridian/AppHeader.tsx`, delete the `faJalaliLong` import. Change the doc comment's first line to `/** The shell's top chrome, on one row: the travelling nav pill, then search, the bell and` / ` *  the viewer's avatar menu. No brand block — see tests/app-header.test.ts.` Replace the `return` with:

```tsx
  return (
    <Chrome>
      <div className="top">
        <HoverPill tabs={tabs} groups={APP_GROUPS} />
        <div className="topright">
          <SearchSlot />
          <NotificationBell placement="header" />
          <ProfileMenu
            userId={session.user.id}
            name={session.user.display_name}
            roleLabel={ROLE_LABEL[session.role]}
          />
        </div>
      </div>
    </Chrome>
  );
```

- [ ] **Step 4: Match the skeleton**

Replace `HeaderSkeleton`'s `return` so the first frame has the final shape:

```tsx
  return (
    <div className="chrome" aria-hidden="true">
      <div className="top">
        <div className="segwrap">
          <nav className="seg seg-groups" />
        </div>
        <div className="topright">
          <span
            className="skeleton"
            style={{ width: 34, height: 34, borderRadius: 999, display: "block" }}
          />
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 5: Give the date to the page-overview card**

In `PageHeaderCard.tsx`, add `date?: string` to the props type and destructure `date`. Immediately before `<h1 className="phc__title">{title}</h1>` add:

```tsx
          {date ? <p className="phc__date">{date}</p> : null}
```

In `PageHeader.tsx`, `import { faJalaliLong } from "@/lib/jalali";`, add `const date = faJalaliLong(new Date().toISOString());` as the first line of the function body, and pass `date={date}` to **both** `<PageHeaderCard>` calls. It is computed on the server and passed as a prop, so the client card cannot render a different day during hydration.

- [ ] **Step 6: CSS — one row, and the breakpoint**

In `app/globals.css`, delete these rules from the top-bar block: `.meridian .brandwrap`, `.meridian .mark`, `.meridian .mark svg`, `.meridian .top h1`, and further down `.meridian .top .sub`. Nothing else uses them (checked: `app/(bare)` and `components/` have no other reference). Then add, directly after the `.meridian .top { … }` rule:

```css
/* The nav pill lives IN the top row now (item 1: the brand block that used to hold this
   space is gone). It takes whatever the action cluster leaves and scrolls inside itself
   if that is not enough. Below 1024px seven chips and the actions no longer fit side by
   side, so the nav drops to its own full-width row: a breakpoint by design, not overflow.
   tests/app-header.test.ts and the smoke suite's header block hold both halves. */
.meridian .top > .segwrap { flex: 1 1 auto; min-width: 0; margin-bottom: 0; }
.meridian .top > .topright { flex: none; }
@media (max-width: 1023px) {
  .meridian .top { flex-wrap: wrap; row-gap: 12px; }
  .meridian .top > .segwrap { order: 2; flex-basis: 100%; }
  .meridian .top > .topright { margin-inline-start: auto; }
}
```

Replace the tabs-block comment above `.meridian .segwrap` ("Two rows, both with a pill…") with: `/* ---- tabs ---- One row of group chips with a pill that travels between them; a group's tabs open on hover (HoverPill). The row is centred in the space the header gives it and scrolls inside itself rather than pushing the page wide. */`

Add the card's date style next to the other `.phc__` rules (`grep -n "phc__overview" app/globals.css`):

```css
.meridian .phc__date { margin: 0 0 2px; font-size: 12.5px; color: var(--muted); }
```

- [ ] **Step 7: Run the static ratchet**

Run: `npx vitest run tests/app-header.test.ts tests/shellLayout.test.ts tests/shell-pages-have-tabs.test.ts tests/hoverPill.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 8: Add the geometric ratchet**

Append to `tests/smoke/geometry.test.ts`, after the `describe.each(ROUTES)` block:

```ts
describe("header", () => {
  /* Item 1, rendered. The static test proves the markup order; only a browser proves the
     chips and the actions actually share a line at the widths the user works at. */
  it.each([
    { name: "desktop", width: 1440, height: 900 },
    { name: "laptop", width: 1280, height: 800 },
    { name: "small laptop", width: 1024, height: 768 },
  ])("keeps nav and actions on one row at $name", async (viewport) => {
    const { page, close } = await open("/sales/dashboard", viewport);
    const [nav, actions] = await page.evaluate(() =>
      [".chrome .top .seg-groups", ".chrome .top .topright"].map((s) => {
        const r = document.querySelector(s)!.getBoundingClientRect();
        return { mid: r.top + r.height / 2, h: r.height };
      }),
    );
    await close();
    expect(nav.h, "the nav did not render").toBeGreaterThan(0);
    expect(Math.abs(nav.mid - actions.mid), "nav and actions sit on different rows").toBeLessThanOrEqual(4);
  }, 90_000);
});
```

- [ ] **Step 9: Run the smoke suite**

Run: `npm run test:smoke`
Expected: PASS. Then confirm the ratchet bites: temporarily add `.meridian .top > .segwrap { flex-basis: 100%; }` at the end of `globals.css`, rerun, and see the new test FAIL. Remove the line.

- [ ] **Step 10: Commit**

```bash
git add components/meridian/AppHeader.tsx components/meridian/HeaderSkeleton.tsx components/meridian/PageHeader.tsx components/meridian/PageHeaderCard.tsx app/globals.css tests/app-header.test.ts tests/smoke/geometry.test.ts
git commit -m "fix: header fits on one row -- logo removed, nav moved up

The brand block (mark, wordmark, date) cost ~180px and forced the seven
group chips onto their own row at every width. The user asked for the
logo to go; with it gone the nav and the action cluster share one row
down to 1024px, and below that the nav wraps to a full-width row on
purpose.

The Jalali date is not lost: it moved to the page-overview card, computed
on the server so hydration cannot disagree about which day it is."
git push -u origin remediation-header-search
```

---

### Task 2: Item 13 — the chip thumb reads as a circle

`.seg` has `padding: 5px` and each group chip `padding-block: 8px`, which puts a ~36px-tall thumb behind a ~71px chip. On short labels like «انبار» that reads as a circle rather than a pill. Taking the row to 3px and the chip to 5px gives ~30px against the same width.

**Files:**
- Modify: `app/globals.css` — the `.meridian .seg-groups > .seg-item > a` rule (~line 2016); add two rules after it
- Test: `tests/app-header.test.ts`, `tests/smoke/geometry.test.ts` (both append)

**Interfaces:** none.

- [ ] **Step 1: Write the failing static ratchet**

Append to `tests/app-header.test.ts`:

```ts
/** Item 13. The thumb's height is the row padding plus the chip's block padding plus one
 *  line of text; at 5px + 8px it came out ~36px behind a ~71px chip, and a short label
 *  read as a circle. Pin both paddings so a well-meant "more breathing room" cannot undo
 *  it. The geometric twin in tests/smoke measures the result. */
describe("group chips are pills, not circles", () => {
  const css = read("app/globals.css");
  it("the group row pads 3px, and its thumb insets to match", () => {
    expect(css).toMatch(/\.meridian \.seg\.seg-groups \{[^}]*padding: 3px/);
    expect(css).toMatch(/\.meridian \.seg-groups \.thumb \{[^}]*top: 3px; bottom: 3px/);
  });
  it("a group chip pads 5px on the block axis", () => {
    expect(css).toMatch(/\.meridian \.seg-groups > \.seg-item > a \{[^}]*padding-block: 5px/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/app-header.test.ts`
Expected: the two new tests FAIL; Task 1's still pass.

- [ ] **Step 3: Implement**

In `app/globals.css`, change `padding-block: 8px;` in `.meridian .seg-groups > .seg-item > a` to `padding-block: 5px;`, and add directly below it:

```css
/* Item 13: 3px row + 5px chip keeps the thumb ~30px tall behind a ~71px chip, which
   reads as a pill. The shared .seg values (5px, thumb inset 5px) gave ~36px, a circle
   on short labels. The thumb inset must equal the row padding or it sits off-centre. */
.meridian .seg.seg-groups { padding: 3px; }
.meridian .seg-groups .thumb { top: 3px; bottom: 3px; }
```

- [ ] **Step 4: Add the geometric twin**

Append inside the `describe("header", …)` block in `tests/smoke/geometry.test.ts`:

```ts
  it("every group chip is clearly wider than tall", async () => {
    const { page, close } = await open("/sales/dashboard", { width: 1440, height: 900 });
    const ratios = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".seg-groups .seg-item > a")).map((a) => {
        const r = a.getBoundingClientRect();
        return { label: (a.textContent ?? "").trim(), ratio: r.height / r.width };
      }),
    );
    await close();
    expect(ratios.length).toBeGreaterThan(3);
    /* 0.45 separates the two states: 36/71 = 0.51 was the circle, 30/71 = 0.42 the pill. */
    const round = ratios.filter((r) => r.ratio > 0.45).map((r) => `«${r.label}» ${r.ratio.toFixed(2)}`);
    expect(round, `chips that read as circles:\n${round.join("\n")}`).toEqual([]);
  }, 90_000);
```

- [ ] **Step 5: Run both, and confirm the smoke twin bites**

Run: `npx vitest run tests/app-header.test.ts && npm run test:smoke`
Expected: PASS. Temporarily set `padding-block: 8px` back, rerun smoke, see «انبار» (or the shortest label) reported. Restore `5px`.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css tests/app-header.test.ts tests/smoke/geometry.test.ts
git commit -m "fix: group chip thumb read as a circle on short labels

5px row padding + 8px chip padding put a ~36px thumb behind a ~71px
chip. 3px + 5px gives ~30px, a pill. Pinned statically and measured in
the smoke suite (height/width <= 0.45 for every chip)."
git push
```

---

### Task 3: The overlay's model — pure, and tested

Everything the overlay *decides* lives here, so it is testable in a repo that does not render components in tests (the same split as `HoverPill`'s `pillModel`).

**Files:**
- Create: `lib/searchModel.ts`
- Test: `tests/searchModel.test.ts` (create)

**Interfaces:**
- Consumes: `AppTab` from `lib/appNav.ts`; `normalisePersian` from `lib/persian.ts`.
- Produces (Tasks 4 and 5 use these exact names):
  - `export type SearchKind = "page" | "customer" | "order";`
  - `export type SearchHit = { kind: SearchKind; id: string; label: string; sub?: string; href: string };`
  - `export const RECENT_KEY = "meridian.search.recent";`
  - `export const RECENT_MAX = 6;`
  - `export const MIN_REMOTE_QUERY = 2;`
  - `export function rankPages(tabs: AppTab[], q: string, limit?: number): SearchHit[]`
  - `export function pushRecent(list: SearchHit[], hit: SearchHit): SearchHit[]`
  - `export function parseRecent(raw: string | null): SearchHit[]`
  - `export function moveActive(i: number, delta: 1 | -1, n: number): number`

- [ ] **Step 1: Write the failing tests**

Create `tests/searchModel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rankPages, pushRecent, parseRecent, moveActive, RECENT_MAX, type SearchHit } from "@/lib/searchModel";
import { appTabs } from "@/lib/appNav";

const owner = appTabs({ role: "owner" });
const hit = (n: number): SearchHit => ({ kind: "page", id: `page:/p${n}`, label: `p${n}`, href: `/p${n}` });

describe("rankPages", () => {
  it("finds a page by any part of its Persian label", () => {
    expect(rankPages(owner, "سفارش").map((h) => h.href)).toContain("/sales/orders");
  });

  it("ranks a label that STARTS with the query above one that merely contains it", () => {
    const hrefs = rankPages(owner, "مسیر").map((h) => h.href);
    // «مسیر سفارش» / «مسیر تحویل» start with it; «برنامه‌ریز مسیر» only contains it.
    expect(hrefs.indexOf("/planner")).toBeGreaterThan(hrefs.indexOf("/sales/journey"));
  });

  it("folds Arabic ي/ك into Persian ی/ک, so a keyboard layout cannot hide a page", () => {
    expect(rankPages(owner, "كالا").map((h) => h.href)).toContain("/sales/products");
  });

  it("never offers a page the role cannot reach", () => {
    const hrefs = rankPages(appTabs({ role: "salesperson" }), "کاربران").map((h) => h.href);
    expect(hrefs).not.toContain("/sales/admin/users");
  });

  it("returns nothing for an empty or whitespace query", () => {
    expect(rankPages(owner, "   ")).toEqual([]);
  });
});

describe("recents", () => {
  it("puts the newest first and does not duplicate", () => {
    expect(pushRecent([hit(1), hit(2)], hit(2)).map((h) => h.id)).toEqual(["page:/p2", "page:/p1"]);
  });

  it(`keeps at most ${RECENT_MAX}`, () => {
    let list: SearchHit[] = [];
    for (let i = 0; i < 10; i++) list = pushRecent(list, hit(i));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].id).toBe("page:/p9");
  });

  it("survives garbage in storage: another tab, an old format, a hand edit", () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent("{not json")).toEqual([]);
    expect(parseRecent('{"a":1}')).toEqual([]);
    expect(parseRecent(JSON.stringify([hit(1), { kind: "page", label: 3 }]))).toEqual([hit(1)]);
  });

  it("drops a stored href that leaves the app, so storage cannot become an open redirect", () => {
    const evil = { ...hit(1), href: "https://evil.example" };
    const protoRelative = { ...hit(2), href: "//evil.example" };
    expect(parseRecent(JSON.stringify([evil, protoRelative]))).toEqual([]);
  });
});

describe("moveActive", () => {
  it("enters the list from nothing at the start going down and the end going up", () => {
    expect(moveActive(-1, 1, 4)).toBe(0);
    expect(moveActive(-1, -1, 4)).toBe(3);
  });
  it("wraps at both ends", () => {
    expect(moveActive(3, 1, 4)).toBe(0);
    expect(moveActive(0, -1, 4)).toBe(3);
  });
  it("has nowhere to go in an empty list", () => {
    expect(moveActive(0, 1, 0)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/searchModel.test.ts`
Expected: FAIL — `@/lib/searchModel` does not exist.

- [ ] **Step 3: Implement**

Create `lib/searchModel.ts`:

```ts
import type { AppTab } from "@/lib/appNav";
import { normalisePersian } from "@/lib/persian";

/** Everything the search overlay decides, as pure functions.
 *
 *  components/meridian/SearchOverlay.tsx renders; this module decides. The split is what
 *  makes the overlay testable in a repo that does not render components in tests: the
 *  same arrangement as HoverPill's pillModel. Safe to import on the server: no DOM. */

export type SearchKind = "page" | "customer" | "order";

export type SearchHit = {
  kind: SearchKind;
  /** Stable across sessions (`customer:12`), so a recent survives a reload and dedupes. */
  id: string;
  label: string;
  sub?: string;
  /** Always an in-app path; parseRecent enforces it for anything read back from storage. */
  href: string;
};

export const RECENT_KEY = "meridian.search.recent";
export const RECENT_MAX = 6;
/** Below this the server is not asked: one letter matches most of the customer table. */
export const MIN_REMOTE_QUERY = 2;

/** The reader's reachable pages whose label contains the query. A label that starts with
 *  it outranks one that merely contains it; ties go to the shorter label, which is the
 *  more specific page. */
export function rankPages(tabs: AppTab[], q: string, limit = 6): SearchHit[] {
  const needle = normalisePersian(q.trim());
  if (!needle) return [];
  return tabs
    .filter((t) => t.ready)
    .map((t) => ({ t, at: normalisePersian(t.label).indexOf(needle) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at || a.t.label.length - b.t.label.length)
    .slice(0, limit)
    .map(({ t }) => ({ kind: "page" as const, id: `page:${t.href}`, label: t.label, href: t.href }));
}

export function pushRecent(list: SearchHit[], hit: SearchHit): SearchHit[] {
  return [hit, ...list.filter((h) => h.id !== hit.id)].slice(0, RECENT_MAX);
}

const KINDS: readonly string[] = ["page", "customer", "order"];

/** An in-app path, and only that: `/x` yes; `//host` and `https://…` no. localStorage is
 *  writable by anything on this origin, and a stored href is navigated to on Enter. */
const isInternal = (href: string) => href.startsWith("/") && !href.startsWith("//");

function isHit(v: unknown): v is SearchHit {
  if (!v || typeof v !== "object") return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.kind === "string" && KINDS.includes(h.kind) &&
    typeof h.id === "string" && typeof h.label === "string" &&
    typeof h.href === "string" && isInternal(h.href) &&
    (h.sub === undefined || typeof h.sub === "string")
  );
}

/** Reads what localStorage held. Never throws: storage is written by other tabs and older
 *  builds, and a broken recents list must not take the search box down with it. */
export function parseRecent(raw: string | null): SearchHit[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter(isHit).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** The keyboard cursor. -1 is "nothing highlighted", the state before the first arrow. */
export function moveActive(i: number, delta: 1 | -1, n: number): number {
  if (n === 0) return -1;
  if (i < 0) return delta > 0 ? 0 : n - 1;
  return (i + delta + n) % n;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/searchModel.test.ts && npx tsc --noEmit`
Expected: PASS. If the `كالا` case fails, check `CHAR_MAP` in `lib/persian.ts` folds `ك`→`ک` and `ي`→`ی`; if it does not, add those two entries there (it is the app-wide normaliser, and `matchesQuery` on the map has the same gap) and rerun `npx vitest run tests/persian*`.

- [ ] **Step 5: Commit**

```bash
git add lib/searchModel.ts tests/searchModel.test.ts
git commit -m "feat: search model -- page ranking, recents, keyboard cursor

Pure so the overlay's decisions are tested without rendering. parseRecent
refuses any stored href that leaves the app: localStorage is writable by
anything on the origin and a recent is navigated to on Enter."
git push
```

---

### Task 4: Scoped server search

A search is a new read path into customers and orders, which makes it a new way to leak another group's or tenant's rows. It reuses the exact scoping the list endpoints use and invents none:

- **customers**: only for roles `/api/customers` serves (`owner`, `group_manager`), via `readCustomers(db, scopeGroupIds(session))`. A salesperson gets none. They do not get the customer list today either, and search must not become the side door. `platform_owner` also gets none: `scopeGroupIds` returns `"all"` for them, and `readCustomers("all")` has no tenant filter.
- **orders**: for `owner`, `group_manager`, `salesperson` (the `CAN_SELL` roles of `/api/sales/orders`), via `orderFilter(session)`. A salesperson sees only their own.

Matching is done in JS with `matchesQuery` rather than SQL `LIKE`, because `LIKE` does not fold Arabic/Persian letter variants or Persian digits and `normalisePersian` does. The scoped customer list is one indexed `SELECT` (the same one `/api/customers` runs on every map load). Orders are capped at the newest 2000 before matching.

**Files:**
- Create: `lib/repo/search.ts`, `app/api/search/route.ts`
- Test: `tests/search-repo.test.ts` (create)

**Interfaces:**
- Consumes: `SearchHit`, `MIN_REMOTE_QUERY` from `lib/searchModel.ts` (Task 3).
- Produces:
  - `export function searchCustomers(db: DatabaseSync, session: Session, q: string, limit?: number): SearchHit[]`
  - `export function searchOrders(db: DatabaseSync, session: Session, q: string, limit?: number): SearchHit[]`
  - `GET /api/search?q=…` → `{ ok: true, customers: SearchHit[], orders: SearchHit[] }`, `Cache-Control: no-store`; 401/403 via `requireRole`.

- [ ] **Step 1: Write the failing tests**

Create `tests/search-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Session } from "@/lib/session";

const testDbPath = path.join(os.tmpdir(), `rf-search-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { searchCustomers, searchOrders } = await import("@/lib/repo/search");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const sess = (id: number, role: string, gid: number | null): Session =>
  ({ user: { id } as never, role: role as never, groupId: gid, organizationId: 1 }) as Session;

let owner = 0, mgrA = 0, sellerA = 0, sellerA2 = 0, groupA = 0, groupB = 0, custA = 0, custB = 0;
let orderMineId = 0, orderOther = "";

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM groups; DELETE FROM users WHERE id>0; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  const g = db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES (?,?,?,1)");
  groupA = Number(g.run("A", "a", now).lastInsertRowid);
  groupB = Number(g.run("B", "b", now).lastInsertRowid);
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)"
  );
  const tag = Date.now();
  owner = Number(u.run(`o${tag}`, "x", "م", "owner", null, now).lastInsertRowid);
  mgrA = Number(u.run(`m${tag}`, "x", "مد", "group_manager", groupA, now).lastInsertRowid);
  sellerA = Number(u.run(`s${tag}`, "x", "ف", "salesperson", groupA, now).lastInsertRowid);
  sellerA2 = Number(u.run(`t${tag}`, "x", "ف۲", "salesperson", groupA, now).lastInsertRowid);
  const c = db.prepare(
    "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES (?,?,'active',?,?,1)"
  );
  custA = Number(c.run("CA1", "سوپر یاس", now, groupA).lastInsertRowid);
  custB = Number(c.run("CB1", "سوپر یاسمن", now, groupB).lastInsertRowid);

  const product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  const packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
  const line = [{ product_id: product, packaging_id: packaging, packs: 1 }];
  const today = now.slice(0, 10);
  orderMineId = createOrder(db, { customer_id: custA, order_date: today, created_by: owner, organization_id: 1, salesperson_user_id: sellerA, lines: line }).id;
  orderOther = createOrder(db, { customer_id: custA, order_date: today, created_by: owner, organization_id: 1, salesperson_user_id: sellerA2, lines: line }).order_no;
});

describe("searchCustomers", () => {
  it("a group manager finds their own group's shop and not the other group's", () => {
    const ids = searchCustomers(getDb(), sess(mgrA, "group_manager", groupA), "سوپر").map((h) => h.id);
    expect(ids).toEqual([`customer:${custA}`]);
  });

  it("an owner reaches every group in their organisation", () => {
    const ids = searchCustomers(getDb(), sess(owner, "owner", null), "سوپر").map((h) => h.id).sort();
    expect(ids).toEqual([`customer:${custA}`, `customer:${custB}`].sort());
  });

  it("a salesperson gets no customers: search must not be a side door to a list they cannot open", () => {
    expect(searchCustomers(getDb(), sess(sellerA, "salesperson", groupA), "سوپر")).toEqual([]);
  });

  it("folds Arabic ي into Persian ی", () => {
    expect(searchCustomers(getDb(), sess(owner, "owner", null), "ياسمن").map((h) => h.id)).toEqual([`customer:${custB}`]);
  });

  it("matches the customer code too, and links to the shop on the map", () => {
    const [h] = searchCustomers(getDb(), sess(owner, "owner", null), "CB1");
    expect(h.href).toBe(`/map?c=${custB}`);
  });

  it("does not answer a one-letter query", () => {
    expect(searchCustomers(getDb(), sess(owner, "owner", null), "س")).toEqual([]);
  });
});

describe("searchOrders", () => {
  it("a salesperson finds only their own order", () => {
    const ids = searchOrders(getDb(), sess(sellerA, "salesperson", groupA), "سوپر").map((h) => h.id);
    expect(ids).toEqual([`order:${orderMineId}`]);
  });

  it("an owner finds both, newest first, linked to the order page", () => {
    const hits = searchOrders(getDb(), sess(owner, "owner", null), "سوپر");
    expect(hits).toHaveLength(2);
    expect(hits[0].href).toMatch(/^\/sales\/orders\/\d+$/);
  });

  it("finds an order number typed in Persian digits", () => {
    const persian = orderOther.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
    const hits = searchOrders(getDb(), sess(owner, "owner", null), persian);
    expect(hits.map((h) => h.id)).toHaveLength(1);
  });

  it("prints no raw English status to a Persian reader", () => {
    for (const h of searchOrders(getDb(), sess(owner, "owner", null), "سوپر")) {
      expect(h.sub ?? "").not.toMatch(/[A-Z_]{4,}/);
    }
  });

  it("gives a driver nothing", () => {
    expect(searchOrders(getDb(), sess(sellerA, "driver", groupA), "سوپر")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/search-repo.test.ts`
Expected: FAIL — `@/lib/repo/search` does not exist.

- [ ] **Step 3: Implement the repo**

Create `lib/repo/search.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { readCustomers } from "@/lib/customers";
import { orderFilter, scopeGroupIds, type Session } from "@/lib/session";
import { matchesQuery, normalisePersian } from "@/lib/persian";
import { faDigits } from "@/lib/format";
import { buildMapLink } from "@/lib/deepLink";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orderStateMachine";
import { MIN_REMOTE_QUERY, type SearchHit } from "@/lib/searchModel";

/** The server half of the search overlay (components/meridian/SearchOverlay.tsx).
 *
 *  A search is a new read path, so it is a new place to leak rows. It invents no scoping
 *  of its own. Customers follow /api/customers (owner + group_manager, scopeGroupIds),
 *  orders follow /api/sales/orders (orderFilter). If search offered a salesperson a
 *  customer list, it would be a side door to a page they cannot open.
 *
 *  Matching is matchesQuery, not SQL LIKE: LIKE does not fold ي/ی, ك/ک or Persian digits,
 *  and people type all three. */

const CUSTOMER_ROLES: readonly string[] = ["owner", "group_manager"];
const ORDER_ROLES: readonly string[] = ["owner", "group_manager", "salesperson"];
const DEFAULT_LIMIT = 6;
/** Newest orders considered before matching. Search is for "that order from last week",
 *  not for archaeology; the orders page has filters for that. */
const ORDER_WINDOW = 2000;

const tooShort = (q: string) => normalisePersian(q.trim()).length < MIN_REMOTE_QUERY;

export function searchCustomers(db: DatabaseSync, session: Session, q: string, limit = DEFAULT_LIMIT): SearchHit[] {
  if (!CUSTOMER_ROLES.includes(session.role) || tooShort(q)) return [];
  return readCustomers(db, scopeGroupIds(session))
    .filter((c) =>
      matchesQuery([c.business_name, c.customer_code, c.contact_person ?? "", c.phone ?? ""].join(" "), q),
    )
    .slice(0, limit)
    .map((c) => ({
      kind: "customer",
      id: `customer:${c.id}`,
      label: c.business_name,
      sub: c.customer_code ? faDigits(c.customer_code) : undefined,
      href: `/map${buildMapLink({ customerId: c.id })}`,
    }));
}

export function searchOrders(db: DatabaseSync, session: Session, q: string, limit = DEFAULT_LIMIT): SearchHit[] {
  if (!ORDER_ROLES.includes(session.role) || tooShort(q)) return [];
  const scope = orderFilter(session);
  const rows = db
    .prepare(
      `SELECT o.id, o.order_no, o.status, c.business_name AS customer_name
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE 1 = 1${scope.sql}
        ORDER BY o.id DESC
        LIMIT ?`,
    )
    .all(...scope.params, ORDER_WINDOW) as unknown as {
    id: number;
    order_no: string;
    status: OrderStatus;
    customer_name: string;
  }[];
  return rows
    .filter((r) => matchesQuery(`${r.order_no} ${r.customer_name}`, q))
    .slice(0, limit)
    .map((r) => ({
      kind: "order",
      id: `order:${r.id}`,
      label: `سفارش ${faDigits(r.order_no)}`,
      sub: `${r.customer_name} · ${ORDER_STATUS_LABEL[r.status] ?? "نامشخص"}`,
      href: `/sales/orders/${r.id}`,
    }));
}
```

If `Customer` types `contact_person`/`phone` as non-nullable, drop the `?? ""`; tsc will say.

- [ ] **Step 4: Run the repo tests**

Run: `npx vitest run tests/search-repo.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: The route**

Create `app/api/search/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { searchCustomers, searchOrders } from "@/lib/repo/search";

/** GET /api/search?q=… for the search overlay. Pages are matched client-side from the
 *  tabs the header already holds; this answers only what needs the database. Each half
 *  applies its own role and scope rules in lib/repo/search.ts. The role list here is
 *  just the union, so a driver is refused at the door. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson"]);
  if (!guard.ok) return guard.response;

  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  const db = getDb();
  return NextResponse.json(
    { ok: true, customers: searchCustomers(db, guard.session, q), orders: searchOrders(db, guard.session, q) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

Check `proxy.ts` does not need `/api/search` listed anywhere: `grep -n "api/" proxy.ts`. If it keeps an allowlist of API prefixes, add `/api/search` beside `/api/sales`.

- [ ] **Step 6: Commit**

```bash
git add lib/repo/search.ts app/api/search/route.ts tests/search-repo.test.ts
git commit -m "feat: scoped server search for customers and orders

Reuses the list endpoints' scoping exactly (scopeGroupIds, orderFilter)
and invents none: a salesperson gets their own orders and no customer
list, because search must not be a side door to a page they cannot open.
Matches with matchesQuery so ي/ی, ك/ک and Persian digits all find."
git push
```

---

### Task 5: The overlay (items 9 and the search half of 29)

`SearchSlot` owns ⌘K and does nothing with it. It becomes the trigger for a full-screen overlay: recents when the box is empty, then pages / customers / orders as you type, arrow keys and Enter, Escape or a backdrop click to close. The overlay is part of the shell header, and `/map` is a shell route, so the map gets the same search from the same key (29, search half). Replacing the map's own `SearchBox` with it is slice L.

Two mechanics that are easy to get wrong:

1. **Portal into `.meridian`, not `document.body`.** `.chrome` has `will-change: transform`, which makes it the containing block for `position: fixed` descendants. Rendered in place, the "full-screen" overlay would be clipped to the header. `document.body` escapes that but sits outside `.meridian`, where every design token is defined. The overlay would lose its colours.
2. **Only ⌘K / Ctrl-K.** The map already binds `/` to its own box (`CoverageMap.tsx`). Do not take it.

**Files:**
- Create: `components/meridian/SearchOverlay.tsx`
- Modify: `components/meridian/SearchSlot.tsx` (whole file), `components/meridian/AppHeader.tsx` (`<SearchSlot />` → `<SearchSlot tabs={tabs} />`)
- Modify: `app/globals.css` — the `.searchslot` comment, plus a new `.sov` block after the `.searchslot` media query
- Test: `tests/smoke/geometry.test.ts` (append)

**Interfaces:**
- Consumes: everything Task 3 exports; `GET /api/search` from Task 4; `DUR`, `EASE` from `lib/motion.ts`; `IconName` from `components/meridian/Icon`.
- Produces: `export default function SearchSlot({ tabs }: { tabs: AppTab[] })`; `export default function SearchOverlay(props: { open: boolean; onClose: () => void; tabs: AppTab[] })`. DOM contract the smoke test uses: `[role="dialog"][aria-label="جستجو"]`, options are `a[role="option"]` with the hit's `href`.

- [ ] **Step 1: Write the failing smoke test**

In `tests/smoke/geometry.test.ts`, give `open` an optional wait mode, because map tiles can keep the network busy past `networkidle`. Change its signature and `goto` line to:

```ts
async function open(
  route: string,
  viewport: { width: number; height: number },
  waitUntil: "networkidle" | "load" = "networkidle",
) {
  // …
  await page.goto(`${BASE}${route}`, { waitUntil });
```

Then append:

```ts
describe("search overlay", () => {
  /* Items 9 and 29. The search box was inert: ⌘K focused it and nothing else. The overlay
     is one component on every shell page, the map included, so both halves are asserted
     from the same key. Page results are used because they exist for every role, which
     keeps this independent of whichever user the smoke session mints. */
  it.each([
    { route: "/sales/dashboard", wait: "networkidle" as const },
    { route: "/map", wait: "load" as const },
  ])("⌘K opens it full-screen on $route, finds a page, Escape closes it", async ({ route, wait }) => {
    const { page, close } = await open(route, { width: 1440, height: 900 }, wait);
    await page.keyboard.press("Control+k");
    const dialog = page.locator('[role="dialog"][aria-label="جستجو"]');
    await dialog.waitFor({ state: "visible", timeout: 5000 });

    const box = await dialog.boundingBox();
    expect(box, "the overlay has no box").not.toBeNull();
    expect(box!.width, "the overlay does not cover the viewport: is it trapped in .chrome?").toBeGreaterThanOrEqual(1439);
    expect(box!.height).toBeGreaterThanOrEqual(899);

    await page.keyboard.type("سفارش");
    await page.locator('a[role="option"][href="/sales/orders"]').waitFor({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 });
    await close();
  }, 90_000);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:smoke`
Expected: the two new cases FAIL — no dialog appears.

- [ ] **Step 3: The overlay component**

Create `components/meridian/SearchOverlay.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Icon, type IconName } from "@/components/meridian/Icon";
import type { AppTab } from "@/lib/appNav";
import { DUR, EASE } from "@/lib/motion";
import { normalisePersian } from "@/lib/persian";
import {
  MIN_REMOTE_QUERY, RECENT_KEY, moveActive, parseRecent, pushRecent, rankPages,
  type SearchHit, type SearchKind,
} from "@/lib/searchModel";

const KIND_ICON: Record<SearchKind, IconName> = { page: "link", customer: "building", order: "receipt" };
const SECTION: Record<SearchKind | "recent", string> = {
  recent: "اخیر", page: "صفحه‌ها", customer: "مشتریان", order: "سفارش‌ها",
};

type Section = { key: SearchKind | "recent"; hits: SearchHit[] };

/** One search for the whole app (spec D4): pages, customers and orders, full-screen.
 *
 *  Portalled into the `.meridian` root. Rendered in place it would sit inside `.chrome`,
 *  whose `will-change: transform` makes it the containing block for position:fixed, so
 *  a "full-screen" overlay came out header-sized. document.body escapes that but is
 *  outside `.meridian`, where every token lives. The smoke suite measures the box.
 *
 *  Decisions (ranking, recents, cursor) are in lib/searchModel.ts; this file renders. */
export default function SearchOverlay({ open, onClose, tabs }: { open: boolean; onClose: () => void; tabs: AppTab[] }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<{ customers: SearchHit[]; orders: SearchHit[] }>({ customers: [], orders: [] });
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(-1);

  useEffect(() => setHost(document.querySelector<HTMLElement>(".meridian") ?? document.body), []);

  /* Each opening starts clean, with this viewer's recents. Storage can throw (private
     mode, blocked site data); a search box that works without recents beats none. */
  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(-1);
    setRemote({ customers: [], orders: [] });
    try { setRecent(parseRecent(localStorage.getItem(RECENT_KEY))); } catch { setRecent([]); }
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => { html.style.overflow = prev; };
  }, [open]);

  /* Debounced; each keystroke aborts the request before it, so a slow early answer
     cannot overwrite a later one. */
  useEffect(() => {
    if (!open || normalisePersian(q.trim()).length < MIN_REMOTE_QUERY) {
      setRemote({ customers: [], orders: [] });
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { customers: [], orders: [] }))
        .then((j) => { setRemote({ customers: j.customers ?? [], orders: j.orders ?? [] }); setLoading(false); })
        .catch((e) => { if (e?.name !== "AbortError") setLoading(false); });
    }, 180);
    return () => { window.clearTimeout(t); ctl.abort(); };
  }, [q, open]);

  const sections: Section[] = useMemo(() => {
    if (!q.trim()) return recent.length ? [{ key: "recent", hits: recent }] : [];
    return ([
      { key: "page", hits: rankPages(tabs, q) },
      { key: "customer", hits: remote.customers },
      { key: "order", hits: remote.orders },
    ] as Section[]).filter((s) => s.hits.length > 0);
  }, [q, recent, remote, tabs]);

  const flat = useMemo(() => sections.flatMap((s) => s.hits), [sections]);
  useEffect(() => setActive(-1), [flat]);

  const choose = (hit: SearchHit) => {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(recent, hit))); } catch { /* per-viewer nicety only */ }
    onClose();
    router.push(hit.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => moveActive(i, 1, flat.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => moveActive(i, -1, flat.length)); }
    else if (e.key === "Enter") {
      const hit = flat[active >= 0 ? active : 0];
      if (hit) { e.preventDefault(); choose(hit); }
    }
  };

  if (!host) return null;
  const optionId = (i: number) => `sov-opt-${i}`;
  let index = -1;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="sov"
          role="dialog"
          aria-modal="true"
          aria-label="جستجو"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : DUR.slow, ease: EASE.out }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
          onKeyDown={onKey}
        >
          <motion.div
            className="sov__panel"
            initial={reduce ? false : { y: -12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={reduce ? undefined : { y: -8, scale: 0.98 }}
            transition={{ duration: reduce ? 0 : DUR.slow, ease: EASE.out }}
          >
            <div className="sov__field">
              <Icon name="search" size="md" />
              <input
                ref={input}
                autoFocus
                className="sov__input"
                role="combobox"
                aria-expanded={flat.length > 0}
                aria-controls="sov-list"
                aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                placeholder="جستجوی صفحه، مشتری یا سفارش…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button type="button" className="sov__close" aria-label="بستن" onClick={onClose}>
                <Icon name="x" size="sm" />
              </button>
            </div>

            <div id="sov-list" role="listbox" className="sov__list" aria-label="نتیجه‌ها">
              {sections.map((s) => (
                <div key={s.key} role="group" aria-label={SECTION[s.key]} className="sov__section">
                  <div className="sov__heading">{SECTION[s.key]}</div>
                  {s.hits.map((h) => {
                    index += 1;
                    const i = index;
                    return (
                      <a
                        key={h.id}
                        id={optionId(i)}
                        role="option"
                        aria-selected={i === active}
                        href={h.href}
                        className="sov__opt"
                        onMouseEnter={() => setActive(i)}
                        onClick={(e) => { e.preventDefault(); choose(h); }}
                      >
                        <Icon name={KIND_ICON[h.kind]} size="sm" />
                        <span className="sov__label">{h.label}</span>
                        {h.sub ? <span className="sov__sub">{h.sub}</span> : null}
                      </a>
                    );
                  })}
                </div>
              ))}
              {q.trim() && flat.length === 0 ? (
                <p className="sov__empty">{loading ? "در حال جستجو…" : "چیزی پیدا نشد"}</p>
              ) : null}
              {!q.trim() && flat.length === 0 ? (
                <p className="sov__empty">نام صفحه، مشتری یا شمارهٔ سفارش را بنویسید</p>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    host,
  );
}
```

If `Icon` does not re-export `IconName` as a value-less type from `components/meridian/Icon` (it does today: `export type { IconName, IconSize }`), import it from `./icon-map`.

- [ ] **Step 4: Rewire the trigger**

Replace `components/meridian/SearchSlot.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import SearchOverlay from "@/components/meridian/SearchOverlay";
import type { AppTab } from "@/lib/appNav";

/** The header's search button, and the owner of ⌘K / Ctrl-K.
 *
 *  Opens the one search overlay (spec D4). It lives in the shell header, so every shell
 *  page, /map included, gets the same search from the same key. Only ⌘K is bound: the
 *  map already uses "/" for its own box. Focus returns here on close, so a keyboard user
 *  is not dropped at the top of the document. */
export default function SearchSlot({ tabs }: { tabs: AppTab[] }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (wasOpen.current && !open) btn.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="searchslot"
        aria-label="جستجو"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Icon name="search" size="sm" />
        <span className="searchslot__label">جستجو…</span>
        <kbd className="searchslot__kbd" aria-hidden="true">Ctrl K</kbd>
      </button>
      <SearchOverlay open={open} onClose={() => setOpen(false)} tabs={tabs} />
    </>
  );
}
```

(The `⌘` glyph is dropped for `Ctrl K` in Latin keycap text: it is a symbol glyph, which `no-emoji-use-icon-library` forbids, and most of this app's users are on Windows/Android.)

In `AppHeader.tsx`, change `<SearchSlot />` to `<SearchSlot tabs={tabs} />`. `AppTab` is plain data, so it crosses the server→client boundary as a prop.

- [ ] **Step 5: Styles**

In `app/globals.css`, replace the comment above `.meridian .searchslot` with `/* The header's search button. Opens SearchOverlay (.sov below). Collapses to its icon on narrow viewports, where the label and the hint are noise. */`. After the `.searchslot` `@media (max-width: 860px)` block add:

```css
/* ---- search overlay (SearchOverlay.tsx) --------------------------------------
   Full-screen, portalled into .meridian so it inherits the tokens but escapes .chrome's
   containing block. The panel is capped for reading, not stretched to the viewport. */
.meridian .sov {
  position: fixed; inset: 0; z-index: 100;
  display: flex; justify-content: center; align-items: flex-start;
  padding: min(12vh, 96px) 16px 16px;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: blur(8px);
}
.meridian .sov__panel {
  width: min(40rem, 100%); max-height: min(70vh, 36rem);
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-2xl); box-shadow: var(--sh-3);
}
.meridian .sov__field {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid var(--line); color: var(--muted);
}
.meridian .sov__input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
  font: inherit; font-size: 16px; color: var(--ink);
}
.meridian .sov__input::placeholder { color: var(--muted); }
.meridian .sov__close {
  border: 0; background: var(--sunk); color: var(--muted); cursor: pointer;
  width: 28px; height: 28px; border-radius: 999px; display: grid; place-items: center;
}
.meridian .sov__close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.meridian .sov__list { overflow-y: auto; padding: 8px; }
.meridian .sov__section + .sov__section { margin-top: 6px; }
.meridian .sov__heading { padding: 8px 10px 4px; font-size: 11.5px; font-weight: 600; color: var(--muted); }
.meridian .sov__opt {
  display: flex; align-items: center; gap: 10px;
  padding: 10px; border-radius: var(--r-sm);
  color: var(--ink-2); text-decoration: none; font-size: 13.5px;
}
.meridian .sov__opt[aria-selected="true"] { background: var(--sunk); color: var(--ink); }
.meridian .sov__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meridian .sov__sub { margin-inline-start: auto; flex: none; font-size: 12px; color: var(--muted); }
.meridian .sov__empty { margin: 0; padding: 18px 10px; text-align: center; font-size: 13px; color: var(--muted); }
@media (max-width: 620px) {
  .meridian .sov { padding: 0; }
  .meridian .sov__panel { width: 100%; max-height: 100%; height: 100%; border-radius: 0; border: 0; }
}
```

`--r-2xl`, `--r-sm`, `--sh-3`, `--surface` are existing tokens (used by `.kblock`, `.seg-pop`, `.pm__panel`).

- [ ] **Step 6: Run everything that could notice**

Run: `npx tsc --noEmit && npx vitest run && npm run test:smoke && npm run check:contrast && npx eslint 2>&1 | tail -3`
Expected: all PASS, contrast 100%, lint still `2 errors, 3 warnings`. Confirm the smoke test's container check bites: temporarily render the overlay without the portal (`return <AnimatePresence>…` instead of `createPortal(…)`), rerun smoke, see "trapped in .chrome" FAIL. Restore.

- [ ] **Step 7: Manual check in the dev server**

`npx next dev -p 3100`, sign in, and on `/sales/dashboard` and `/map`: Ctrl-K opens; type «یاس» (or any real customer fragment) as the owner and see customers and orders; arrow keys move the highlight; Enter navigates; a customer result lands on `/map?c=<id>` with the shop selected; reopen and see it under «اخیر»; Escape returns focus to the button. Toggle the dark skin and a second accent theme and check the overlay reads correctly in both.

- [ ] **Step 8: Commit**

```bash
git add components/meridian/SearchOverlay.tsx components/meridian/SearchSlot.tsx components/meridian/AppHeader.tsx app/globals.css tests/smoke/geometry.test.ts
git commit -m "feat: one full-screen search for the whole app (items 9, 29)

The header's search button owned Ctrl-K and did nothing with it. It now
opens a full-screen overlay: recents, then pages, customers and orders,
keyboard-driven. It lives in the shell header, so /map gets the same
search from the same key.

Portalled into .meridian: in place, .chrome's will-change:transform made
it the containing block and the 'full-screen' overlay came out
header-sized. The smoke suite measures the box on both pages."
git push
```

---

### Task 6: Verify, deploy, merge

- [ ] **Step 1: Full gate**

Run: `npx tsc --noEmit && npm test && npm run check:contrast && npx eslint 2>&1 | tail -3`
Expected: all green; lint `2 errors, 3 warnings`. Paste the tail of each into the handoff. If anything fails, stop and fix. Do not deploy red.

- [ ] **Step 2: Deploy**

```bash
systemctl stop routeflow
npm run build
systemctl start routeflow
sleep 3; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3003/login
```

Expected: `200`. If a page then loads unstyled, a stale `next-server` survived: find it by port (`ss -ltnp | grep 3003`), kill that PID, `systemctl start routeflow`.

- [ ] **Step 3: Merge**

```bash
git checkout main && git pull && git merge --no-ff remediation-header-search -m "merge: slice I -- header on one row, pill proportion, one search overlay"
git push
```

- [ ] **Step 4: Update memory** — `remediation-programme.md`: slice I done (items 1, 13, 9, 29-search), with the merge hash and the deploy date; slice J next.

---

## Self-review

- **Spec coverage.** Item 1: Task 1 (logo removed, one row, ~1024px breakpoint, date to overview card). Item 13: Task 2 (3px/5px, ~30px vs ~71px). Items 9/29-search: Tasks 3–5 (full-screen overlay per D4, framer-motion, recents in localStorage per-viewer, grouped customers/orders/pages, available on `/map`). **Deferred per spec:** the Login-As user switcher inside the overlay is slice N, and replacing the map's own `SearchBox` is slice L. The overlay's `sections` array is where N adds a `users` section.
- **Ratchets.** Item 1: static + geometric. Item 13: static + geometric. Overlay: scoping by repo tests, model by unit tests, "is actually full-screen and actually works on both surfaces" by smoke. Each geometric test has a "confirm it bites" step.
- **Types.** `SearchHit`/`SearchKind`/`RECENT_KEY`/`MIN_REMOTE_QUERY`/`rankPages`/`pushRecent`/`parseRecent`/`moveActive` are defined in Task 3 and used with the same names in Tasks 4–5. `SearchSlot({ tabs })` in Task 5 matches the `AppHeader` edit in the same task.
