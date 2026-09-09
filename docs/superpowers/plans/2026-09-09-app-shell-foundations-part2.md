# App Shell & Foundations — Part 2 (Route Groups, Shell, Header, Transitions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put one shell — theme, header, one-row hover nav, notification bell, `⌘K` slot — around every surface except `/driver`, `/login`, `/offline`, `/today`; make those four wear the palette without the shell; and make route transitions instant with per-page skeletons.

**Architecture:** Two nested route groups under the existing root layout (`app/(shell)/`, `app/(bare)/`) — **not** multiple root layouts, so no full-page-reload caveat applies. The shell layout is made **synchronous** and the session read moves into a `<Suspense>`-wrapped async `AppHeader`; this, not `loading.tsx` alone, is what fixes the transition freeze. `TabPill` becomes `HoverPill` (one row, group labels, hover-opened tab popover). `lib/salesNav.ts` becomes `lib/appNav.ts` with a `field` group carrying the newly-adopted routes.

**Tech Stack:** Next.js 16.3.1 App Router, React 19.2, Tailwind v4, TypeScript 5, Vitest 4. Primitives from Part 1: `components/meridian/Icon.tsx`, `components/meridian/CardHelp.tsx`, `lib/motion.ts`, `lib/help/`.

**Spec:** `docs/superpowers/specs/2026-09-09-app-shell-and-foundations-design.md` (Sections 1, 2, 4, and the rollout half of 3 and 5). Part 1 (`…-part1.md`, tag `app-shell-foundations-part1`) covered Section 0 and the primitives.

## Global Constraints

- **Branch:** continue on `app-shell-foundations` (Part 1 is tagged `app-shell-foundations-part1`).
- **Next.js 16 is not the Next you know.** `AGENTS.md` requires reading the relevant file under `node_modules/next/dist/docs/` before touching any Next file. The three that govern this plan are `01-app/03-api-reference/03-file-conventions/{route-groups,loading,layout}.md`. **Already read; the load-bearing facts are quoted in Task 4.**
- **Namespace:** `.meridian` scope class, `components/meridian/`. No `kargah` anywhere.
- **Palette:** cold. Do not reintroduce warm hexes. `npm run check:contrast` must stay **500/500**.
- **Lint gate is "no NEW errors".** Baseline carries 2 pre-existing `react-hooks/set-state-in-effect` errors (`components/board/Board.tsx:79`, `components/board/BoardMobile.tsx:40`). Do not fix them here; do not add more.
- **Do not alter the document-pocket device** (`components/meridian/PocketCard.tsx`, `Pocketed.tsx`, `OrdersPockets.tsx`) beyond token re-pointing. Spec decision #12 — the user explicitly asked for it to be preserved and reused. Its `<PocketCard>` reuse rollout is a later slice, not this one.
- **Auth stays where it is.** `proxy.ts` already performs the full role gate for every path (read it — it is exhaustive). The layout `redirect()` calls are belt-and-braces and are what force the layout to be async; removing them is safe **only** because `proxy.ts` covers them. Do not weaken `proxy.ts`.
- **TDD:** failing test → red → minimal implementation → green → commit. One logical change per commit.
- **Commit trailer:** end every commit body with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## The route map this plan produces

```
app/
  layout.tsx                 # unchanged root: <html>/<body>, init scripts, providers.
                             #   NotificationBell is REMOVED from here (Task 5).
  page.tsx                   # unchanged — a 20-line redirect router, renders no UI,
                             #   so it needs no shell and stays outside both groups.
  globals.css, fonts.ts, manifest.ts, favicon.ico, api/     # unchanged, stay put

  (shell)/
    layout.tsx               # NEW — <div className="meridian"> + <AppShell>. SYNCHRONOUS.
    not-found.tsx            # NEW — baseline (themed 403/404/500 is Slice C)
    error.tsx                # NEW — baseline route error boundary
    sales/…                  # moved from app/sales
    map/…                    # moved from app/map          → data-surface="map"
    facilities/…             # moved from app/facilities   → data-surface="map"
    gallery/…                # moved from app/gallery      → data-surface="map"
    planner/…                # moved from app/planner
    report/…                 # moved from app/report
    leads/…                  # moved from app/leads
    settings/…               # moved from app/settings

  (bare)/
    layout.tsx               # NEW — <div className="meridian"> ONLY. Palette, type,
                             #   tokens. No AppShell, no header, no nav. Spec decision #11.
    driver/…                 # moved from app/driver
    login/…                  # moved from app/login
    offline/…                # moved from app/offline
    today/…                  # moved from app/today (driver-only briefing)

  analytics/                 # DELETED — 308 redirect to /sales/dashboard in next.config.ts
```

Route groups do not change URLs, so `proxy.ts` matchers, every `<Link href>`, and every
API path are unaffected by the move itself.

---

## Task 1: `lib/appNav.ts` — nav registry with the `field` group

Deferred here from Part 1 because it is inseparable from `HoverPill` (Task 6).

**Files:**
- Rename: `lib/salesNav.ts` → `lib/appNav.ts`; `tests/salesNav.test.ts` → `tests/appNav.test.ts`
- Modify: `app/sales/layout.tsx`, `components/meridian/TabPill.tsx` (the only two importers — verify with `grep -rl "lib/salesNav" app components lib`)

**Interfaces:**
- Produces:
  - `export type AppGroupId = "day" | "sales" | "delivery" | "money" | "stock" | "admin" | "field"`
  - `export const APP_GROUPS: { id: AppGroupId; label: string }[]` — the six existing, plus `{ id: "field", label: "میدان و نقشه" }` appended last
  - `export type AppTab = { href: string; label: string; group: AppGroupId; ready: boolean }`
  - `export function appTabs(session: { role: Role }): AppTab[]`
  - `export function activeGroup(pathname: string, tabs: AppTab[]): AppGroupId`

- [ ] **Step 1: Move the two files**

```bash
git mv lib/salesNav.ts lib/appNav.ts
git mv tests/salesNav.test.ts tests/appNav.test.ts
```

- [ ] **Step 2: Write the failing test additions**

In `tests/appNav.test.ts`, change the import to `@/lib/appNav` and the symbols
(`SALES_GROUPS`→`APP_GROUPS`, `salesTabs`→`appTabs`, `activeSalesGroup`→`activeGroup`),
then append:

```ts
describe("the field group", () => {
  const tabs = appTabs({ role: "owner" });
  const field = tabs.filter((t) => t.group === "field");

  it("carries the routes that join the shell", () => {
    expect(field.map((t) => t.href).sort()).toEqual(["/leads", "/map", "/planner"]);
  });

  it("is a real group in APP_GROUPS", () => {
    expect(APP_GROUPS.some((g) => g.id === "field")).toBe(true);
  });

  it("/report joins the money group", () => {
    const r = tabs.find((t) => t.href === "/report");
    expect(r?.group).toBe("money");
  });

  it("nothing points at the retired /analytics", () => {
    expect(tabs.some((t) => t.href.startsWith("/analytics"))).toBe(false);
  });

  it("activeGroup resolves a field path by longest prefix", () => {
    expect(activeGroup("/planner", tabs)).toBe("field");
    expect(activeGroup("/sales/orders/12", tabs)).toBe("sales");
  });
});
```

- [ ] **Step 3: Run it red**

Run: `npx vitest run tests/appNav.test.ts`
Expected: FAIL — the symbols are not renamed and the `field` group does not exist.

- [ ] **Step 4: Rename the symbols and add the group in `lib/appNav.ts`**

Apply the renames from the Interfaces block. Append to `APP_GROUPS`:

```ts
  { id: "field", label: "میدان و نقشه" },
```

And append to the array returned by `appTabs`, keeping the existing `isManager` /
`isRepLead` helpers:

```ts
    // میدان و نقشه — the surfaces that join the shell in this slice
    { href: "/map", label: "نقشهٔ پوشش", group: "field", ready: true },
    { href: "/planner", label: "برنامه‌ریز مسیر", group: "field", ready: r !== "salesperson" },
    { href: "/leads", label: "سرنخ‌ها", group: "field", ready: isRepLead(r) },
    // مالی — the coverage report is a money-group read; proxy.ts already denies
    // salesperson, so `ready` mirrors that rather than inventing a second rule.
    { href: "/report", label: "گزارش پوشش", group: "money", ready: r !== "salesperson" },
```

- [ ] **Step 5: Update the two importers**

```bash
grep -rl 'lib/salesNav\|salesTabs\|SALES_GROUPS\|activeSalesGroup\|SalesGroupId\|SalesTab' app components \
  | xargs sed -i -e 's#lib/salesNav#lib/appNav#g' -e 's/salesTabs/appTabs/g' \
      -e 's/SALES_GROUPS/APP_GROUPS/g' -e 's/activeSalesGroup/activeGroup/g' \
      -e 's/SalesGroupId/AppGroupId/g' -e 's/SalesTab/AppTab/g'
```
Then read `app/sales/layout.tsx` and `components/meridian/TabPill.tsx` and fix any local
identifier the sed mangled (e.g. a prop literally named `salesTabs`).

- [ ] **Step 6: Green**

```bash
npx vitest run tests/appNav.test.ts && npx tsc --noEmit && npm run build
```
Expected: all pass. `TabPill` now renders seven group chips instead of six — that is
correct and temporary; Task 6 replaces it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: lib/salesNav -> lib/appNav, add the field group

/map, /planner and /leads become first-class nav destinations ahead of the
shell that themes them; /report joins the money group. Same ready/role
gating, mirroring proxy.ts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `app/(bare)/` — the palette-only group

Done **before** the shell group so the risky move lands in two reviewable halves.

**Files:**
- Create: `app/(bare)/layout.tsx`
- Move: `app/driver` → `app/(bare)/driver`, `app/login` → `app/(bare)/login`, `app/offline` → `app/(bare)/offline`, `app/today` → `app/(bare)/today`

**Interfaces:**
- Produces: the four bare routes rendering under `.meridian` (palette, type, radii) with no shell chrome. URLs unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/shellGroups.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";

/** The route-group split is a structural invariant: a page in the wrong group either
 *  loses the shell or gains chrome it must not have (a driver in a moving vehicle). */
describe("route groups", () => {
  const bare = ["driver", "login", "offline", "today"];

  it("every bare route lives under app/(bare)", () => {
    for (const r of bare) {
      expect(existsSync(`app/(bare)/${r}`), `app/(bare)/${r}`).toBe(true);
      expect(existsSync(`app/${r}`), `app/${r} should be gone`).toBe(false);
    }
  });

  it("the bare group has a layout that is NOT the shell", async () => {
    expect(existsSync("app/(bare)/layout.tsx")).toBe(true);
    const src = await import("node:fs").then((m) => m.readFileSync("app/(bare)/layout.tsx", "utf8"));
    expect(src).toContain("meridian");
    expect(src).not.toContain("AppShell");
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/shellGroups.test.ts`
Expected: FAIL — `app/(bare)` does not exist.

- [ ] **Step 3: Move the four routes**

```bash
mkdir -p "app/(bare)"
git mv app/driver "app/(bare)/driver"
git mv app/login "app/(bare)/login"
git mv app/offline "app/(bare)/offline"
git mv app/today "app/(bare)/today"
```

- [ ] **Step 4: Write `app/(bare)/layout.tsx`**

```tsx
import type { ReactNode } from "react";

/** The bare group: /driver, /login, /offline, /today.
 *
 *  These wear the design system's PALETTE — the same cold tokens, type and radii as
 *  everywhere else, so they read as the same product — and nothing else. No header, no
 *  travelling pill, no page-overview card, no entrance choreography. The contexts are a
 *  phone in a moving vehicle and a login card; chrome is the thing they must not have.
 *  See the spec, decision #11: "match the theme, not fully".
 *
 *  Synchronous on purpose. Nothing here reads cookies() — proxy.ts owns the gate — so a
 *  navigation into this group never blocks on the layout.
 */
export default function BareLayout({ children }: { children: ReactNode }) {
  return <div className="meridian">{children}</div>;
}
```

- [ ] **Step 5: Green**

```bash
npx vitest run tests/shellGroups.test.ts && npx tsc --noEmit && npm run build
```
Expected: pass; build lists `/driver`, `/login`, `/offline`, `/today` at the same URLs.

- [ ] **Step 6: Verify the URLs did not move**

```bash
npm run build 2>&1 | grep -E "/driver|/login|/offline|/today"
```
Expected: the four routes present, no `(bare)` in any path.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: app/(bare) — driver, login, offline, today wear the palette, not the shell

Spec decision #11. The group layout applies .meridian and nothing else;
these four contexts keep their stripped, purpose-built layouts. URLs are
unchanged — a route group is organisational only.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `app/(shell)/` — move the eight themed routes

**Files:**
- Move: `app/{sales,map,facilities,gallery,planner,report,leads,settings}` → `app/(shell)/…`
- Create: `app/(shell)/layout.tsx` (temporary passthrough; Task 4 gives it the shell)

- [ ] **Step 1: Extend the failing test**

Append to `tests/shellGroups.test.ts`:

```ts
  const shell = ["sales", "map", "facilities", "gallery", "planner", "report", "leads", "settings"];

  it("every shell route lives under app/(shell)", () => {
    for (const r of shell) {
      expect(existsSync(`app/(shell)/${r}`), `app/(shell)/${r}`).toBe(true);
      expect(existsSync(`app/${r}`), `app/${r} should be gone`).toBe(false);
    }
  });

  it("the redirect-only root page stays outside both groups", () => {
    expect(existsSync("app/page.tsx")).toBe(true);
    expect(existsSync("app/(shell)/page.tsx")).toBe(false);
  });
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/shellGroups.test.ts`
Expected: FAIL on the shell assertions.

- [ ] **Step 3: Move the eight routes**

```bash
mkdir -p "app/(shell)"
for r in sales map facilities gallery planner report leads settings; do
  git mv "app/$r" "app/(shell)/$r"
done
```

- [ ] **Step 4: Add a temporary passthrough layout**

```tsx
// app/(shell)/layout.tsx
import type { ReactNode } from "react";

/** Replaced in the next commit by the real shell. Exists now so the group is valid and
 *  the move can be reviewed on its own. */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **Step 5: Sweep for anything the move broke**

Imports are `@/`-absolute so they survive, but check these four explicitly:

```bash
# 1. relative imports that climbed out of a moved directory
grep -rn 'from "\.\./\.\./\.\./' "app/(shell)" "app/(bare)" | grep -v node_modules
# 2. route strings that assumed a path (should be none — groups don't change URLs)
grep -rn '"/sales\|"/map\|"/planner\|"/leads\|"/report\|"/settings' next.config.ts proxy.ts
# 3. test fixtures naming an app path
grep -rn 'app/sales\|app/map\|app/leads\|app/planner\|app/report\|app/settings\|app/driver\|app/login' tests scripts
# 4. the manifest and any generateMetadata that names a file path
grep -rn 'app/' app/manifest.ts
```
Fix each hit by pointing it at the new location. Route *URLs* must not change.

- [ ] **Step 6: Green**

```bash
npx vitest run tests/shellGroups.test.ts && npx tsc --noEmit && npm test && npm run build
```
Expected: all pass. In the build output every URL is exactly what it was before —
diff it against the Part 1 build if unsure.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: move the eight themed routes into app/(shell)

sales, map, facilities, gallery, planner, report, leads, settings. Route
groups are organisational — every URL is unchanged. The group layout is a
passthrough for this commit; the shell lands next.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: The shell layout — synchronous, so navigation stops blocking

**This is the load-bearing task of the plan.** From
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md`:

> Because `loading.js` sits below `layout.js` in the component hierarchy, it cannot show
> a fallback for uncached or runtime data access in the layout itself, such as calling
> `cookies()`, `headers()`, or making uncached fetches.
> **Without Cache Components: The navigation will block until the layout finishes
> rendering, and the `loading.js` fallback will not be shown.**
> … to ensure instant navigation, either: wrap runtime data access in your layout in its
> own `<Suspense>` boundary with a fallback; or move uncached data fetching from
> `layout.js` into `page.js`.

`app/(shell)/sales/layout.tsx` today does `await cookies()` + `getSessionFromCookies()` +
two `redirect()`s at its top level. That is the freeze. Cache Components is **not**
enabled (`next.config.ts` has no `cacheComponents`), so we are in the "navigation blocks"
case, and adding `loading.tsx` later would do nothing until this is fixed.

**Files:**
- Create: `components/meridian/AppShell.tsx`, `components/meridian/HeaderSkeleton.tsx`
- Rewrite: `app/(shell)/layout.tsx`
- Delete: `app/(shell)/sales/layout.tsx` (its content becomes the shell; its redirects are dropped — see below)

**Interfaces:**
- Produces:
  - `AppShell({ children }: { children: ReactNode })` — **synchronous** server component.
  - `HeaderSkeleton()` — a static, session-free stand-in the same height as the real header.
  - `AppHeader` is referenced here but implemented in Task 5; for this task, stub it as an async server component that reads the session and renders today's `.top` + `TabPill` markup.

**Dropping the layout redirects is safe:** `proxy.ts` denies an unauthenticated request
(`!claims` → redirect to `/login`, clearing the cookie) and denies a driver on any
non-driver path (`claims.role === "driver" && !isDriver && …` → `deny("/driver")`), for
the matcher `/((?!_next/static|_next/image|favicon.ico).*)` — i.e. every shell route.
The layout's own comment already calls them "the belt to its braces". Read `proxy.ts`
and confirm before deleting.

- [ ] **Step 1: Write the failing test**

Create `tests/shellLayout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** The shell layout must stay synchronous. If it ever awaits cookies()/headers() again,
 *  every navigation blocks on it and loading.tsx silently stops working — a regression
 *  with no error message. See node_modules/next/dist/docs/.../layout.md, "Interaction
 *  with loading.js". */
describe("the shell layout is non-blocking", () => {
  const src = readFileSync("app/(shell)/layout.tsx", "utf8");

  it("is not an async component", () => {
    expect(src).not.toMatch(/export default async function/);
  });

  it("does not read runtime data at its top level", () => {
    expect(src).not.toContain("cookies(");
    expect(src).not.toContain("headers(");
  });

  it("applies the meridian scope and mounts the shell", () => {
    expect(src).toContain("meridian");
    expect(src).toContain("AppShell");
  });
});

describe("the shell's session read is suspended", () => {
  const src = readFileSync("components/meridian/AppShell.tsx", "utf8");
  it("wraps the header in a Suspense boundary with a fallback", () => {
    expect(src).toContain("Suspense");
    expect(src).toContain("HeaderSkeleton");
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/shellLayout.test.ts`
Expected: FAIL — `AppShell.tsx` does not exist.

- [ ] **Step 3: Write `HeaderSkeleton`**

```tsx
// components/meridian/HeaderSkeleton.tsx
/** The header's shape without its session. Rendered while AppHeader resolves, so the
 *  chrome occupies its final height from the first frame and nothing below it jumps.
 *  Static and session-free on purpose — that is what lets the layout stay synchronous. */
export default function HeaderSkeleton() {
  return (
    <div className="chrome" aria-hidden="true">
      <div className="top">
        <div className="brandwrap">
          <div className="mark skeleton" style={{ width: 26, height: 14 }} />
          <div>
            <span className="skeleton block h-4 w-28" />
            <span className="skeleton block h-3 w-40" style={{ marginTop: 6 }} />
          </div>
        </div>
        <div className="topright">
          <span className="skeleton block" style={{ width: 34, height: 34, borderRadius: 999 }} />
        </div>
      </div>
      <div className="segwrap">
        <nav className="seg seg-groups" />
      </div>
    </div>
  );
}
```
(`.skeleton` already exists in `app/globals.css` — it is what `components/Skeleton.tsx`
uses. Confirm with `grep -n "^\.skeleton\|\.skeleton {" app/globals.css` and match it.)

- [ ] **Step 4: Write `AppShell`**

```tsx
// components/meridian/AppShell.tsx
import { Suspense, type ReactNode } from "react";
import AppHeader from "@/components/meridian/AppHeader";
import HeaderSkeleton from "@/components/meridian/HeaderSkeleton";
import RevealRoute from "@/components/meridian/RevealRoute";
import RouteFade from "@/components/meridian/RouteFade";
import SyncStatus from "@/components/SyncStatus";

/** Everything every shell route wears.
 *
 *  AppHeader is async — it reads the session to render the viewer's name, role and the
 *  tabs their role can reach. It is wrapped in its own Suspense boundary because a
 *  layout that awaits runtime data blocks every navigation on itself and silently
 *  disables loading.tsx (see node_modules/next/dist/docs/.../layout.md). Suspending it
 *  here is what makes the transition instant: the shell paints immediately with
 *  HeaderSkeleton, the header swaps in, and the page's own loading.tsx runs underneath.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <Suspense fallback={<HeaderSkeleton />}>
        <AppHeader />
      </Suspense>
      <RevealRoute />
      <RouteFade>{children}</RouteFade>
      <SyncStatus />
    </div>
  );
}
```

- [ ] **Step 5: Write the real `app/(shell)/layout.tsx`**

```tsx
import type { ReactNode } from "react";
import AppShell from "@/components/meridian/AppShell";

/** The shell group's layout.
 *
 *  SYNCHRONOUS, deliberately and permanently. It reads no cookies, awaits nothing, and
 *  performs no redirect — proxy.ts owns the gate for every path this group serves, and
 *  a layout that awaits runtime data blocks every navigation on itself. tests/
 *  shellLayout.test.ts guards this.
 *
 *  `.meridian` is the design system's scope; every token in app/globals.css hangs off it.
 */
export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <div className="meridian min-h-screen">
      <AppShell>{children}</AppShell>
    </div>
  );
}
```

- [ ] **Step 6: Move the old sales layout's body into `AppHeader` and delete it**

Create `components/meridian/AppHeader.tsx` as an **async server component** holding what
`app/(shell)/sales/layout.tsx` had between `<Chrome>` and `</Chrome>` — the session read,
`ROLE_LABEL`, `faJalaliLong`, the brand mark, `ProfileMenu`, and `<TabPill tabs groups>`
— but **no `redirect()`**:

```tsx
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/roles";
import { faJalaliLong } from "@/lib/jalali";
import ProfileMenu from "@/components/meridian/ProfileMenu";
import TabPill from "@/components/meridian/TabPill";
import Chrome from "@/components/meridian/Chrome";
import HeaderSkeleton from "@/components/meridian/HeaderSkeleton";
import { APP_GROUPS, appTabs } from "@/lib/appNav";

export default async function AppHeader() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  // proxy.ts has already refused an unauthenticated request and a driver. If the cookie
  // is somehow unreadable here, render the skeleton rather than throwing inside a
  // Suspense boundary — the request is on its way to /login regardless.
  if (!session) return <HeaderSkeleton />;

  const tabs = appTabs(session);
  return (
    <Chrome>
      <div className="top">
        {/* brand mark + <h1>RouteFlow</h1> + faJalaliLong(...) — copied verbatim from
            the old app/sales/layout.tsx */}
        <div className="topright">
          <ProfileMenu
            userId={session.user.id}
            name={session.user.display_name}
            roleLabel={ROLE_LABEL[session.role]}
          />
        </div>
      </div>
      <TabPill tabs={tabs} groups={APP_GROUPS} />
    </Chrome>
  );
}
```
Then `git rm "app/(shell)/sales/layout.tsx"`. Keep `app/(shell)/sales/admin/layout.tsx`
and `app/(shell)/settings/layout.tsx` — read each and strip only chrome the shell now
provides; their own role guards stay.

- [ ] **Step 7: Green**

```bash
npx vitest run tests/shellLayout.test.ts tests/shellGroups.test.ts && npx tsc --noEmit && npm test && npm run build
```
Expected: all pass. Every shell route now has the header; `/planner`, `/leads`, `/report`
have it for the first time.

- [ ] **Step 8: Verify the freeze is actually gone**

```bash
npm run dev
```
Open `/sales/today`, throttle the network to Slow 3G in devtools, and navigate to
`/sales/orders`. Expected: the header stays put and the *new* page's frame appears
immediately (the old view must not hold). If the old view still holds, the layout is
still awaiting something — re-check Step 5.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: app/(shell) — one synchronous shell around every themed route

The shell layout reads no cookies and awaits nothing; the session read
moves into an async AppHeader behind its own Suspense boundary with a
HeaderSkeleton fallback. Per Next 16's layout.js docs, a layout that awaits
runtime data blocks every navigation on itself and silently disables
loading.tsx — that was the page-transition freeze.

The old sales layout's redirects are dropped: proxy.ts already gates every
path in this group (unauthenticated -> /login, driver -> /driver).

/planner, /leads, /report, /map, /facilities, /gallery and /settings get
the header and theme for the first time.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Map surfaces stay dark; notification bell moves to the header

**Files:**
- Modify: `app/layout.tsx` (drop `<NotificationBell />`), `components/meridian/AppHeader.tsx` (mount it), `app/globals.css` (`data-surface="map"` block)
- Create: `app/(shell)/map/layout.tsx`, `app/(shell)/facilities/layout.tsx`, `app/(shell)/gallery/layout.tsx`

- [ ] **Step 1: Failing test**

Append to `tests/shellLayout.test.ts`:

```ts
describe("map surfaces and the bell", () => {
  it("the root layout no longer mounts the bell", () => {
    expect(readFileSync("app/layout.tsx", "utf8")).not.toContain("NotificationBell");
  });
  it("the header does", () => {
    expect(readFileSync("components/meridian/AppHeader.tsx", "utf8")).toContain("NotificationBell");
  });
  it("globals.css pins the map surface to the dark palette", () => {
    expect(readFileSync("app/globals.css", "utf8")).toContain('[data-surface="map"]');
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run tests/shellLayout.test.ts -t "map surfaces"` → FAIL.

- [ ] **Step 3: Move the bell**

Remove `import NotificationBell` and `<NotificationBell />` from `app/layout.tsx`. In
`AppHeader`, render it inside `.topright`, before `<ProfileMenu>`. Read
`components/NotificationBell.tsx` first — if it positions itself `fixed`, add a variant
prop (`placement="header"`) rather than changing its only mode, and keep the
`NotificationCenter` panel/portal exactly as it is.

- [ ] **Step 4: Add the three map layouts**

```tsx
// app/(shell)/map/layout.tsx  (and facilities/, gallery/ — identical)
import type { ReactNode } from "react";

/** The map canvas keeps its own dark identity whatever skin the viewer chose — two
 *  thousand lines of map chrome are tuned for a near-black ground. The header and the
 *  page's own tokens follow the normal theme. See MASTER.md "Product shape".
 *  Synchronous: nothing here reads runtime data. */
export default function MapSurfaceLayout({ children }: { children: ReactNode }) {
  return <div data-surface="map">{children}</div>;
}
```

- [ ] **Step 5: Add the CSS override**

In `app/globals.css`, inside the `.meridian` region, add a block that re-points the
ground tokens to the dark values **only** under `[data-surface="map"]`. Copy the exact
hexes from the `:root[data-skin="dark"] .meridian` block — do not re-derive them:

```css
/* The map canvas keeps its dark identity under a light skin. Ground tokens only —
   the header above it and any non-map chrome follow the viewer's skin. */
.meridian [data-surface="map"] {
  --bg: #0F1214; --surface: #171B20; --surface-2: #1D2228; --surface-sunk: #232A31;
  --border: #28323A; --border-strong: #37414A;
  --text: #EDF1F5; --text-muted: #8B98A5; --text-faint: #828C97;
  --card: #171B20; --card-2: #1D2228; --sunk: #232A31; --ink: #EDF1F5;
  --line: #28323A; --line-2: #37414A;
}
```

- [ ] **Step 6: Green**

```bash
npx vitest run tests/shellLayout.test.ts && npm run check:contrast && npx tsc --noEmit && npm run build
```
Expected: pass, contrast still 500/500.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: bell into the header; map surfaces pinned dark under any skin

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: `HoverPill` — one row, hover-opened group menus

**Files:**
- Create: `components/meridian/HoverPill.tsx`, `tests/hoverPill.test.ts`
- Modify: `components/meridian/AppHeader.tsx`, `app/globals.css`
- Delete: `components/meridian/TabPill.tsx` (after the swap)

**Interfaces:**
- Produces: `HoverPill({ tabs, groups }: { tabs: AppTab[]; groups: { id: AppGroupId; label: string }[] })`.
- The pure part, extracted so it is testable the way this repo tests everything else:
  `export function pillModel(tabs: AppTab[], groups: …[], pathname: string): { groups: { id; label; href; active }[]; tabsByGroup: Record<AppGroupId, AppTab[]> }`

**Design (spec Section 2, decision #2 — keep the pill, make it hover):**
- The pill carries **group labels only**, one row, beside the brand. The animated `.thumb`
  sits under the active group. Keep `slideThumb`, the `ResizeObserver`, and the
  `document.fonts.ready` re-measure from `TabPill` verbatim — that is the signature
  motion and the reason the pill survives.
- **Hover a group → popover** listing that group's `ready` tabs; click navigates.
- **Pointer-leave** closes after ~180ms with a hover corridor, so a diagonal move into
  the popover does not dismiss it.
- **Touch / no-hover:** `(hover: none)` → tap opens, tap a tab navigates.
- **Keyboard:** Tab focuses a group, `ArrowDown`/`Enter` opens, arrows move inside,
  `Esc` closes and restores focus.
- Motion via `AnimatePresence` + `lib/motion.ts`'s `popover` preset and
  `withReducedMotion`.
- The second permanent row is **gone**; the group's tabs stay reachable without hover via
  the `PageHeaderCard` notch (Task 8).

- [ ] **Step 1: Failing test for the pure model**

```ts
// tests/hoverPill.test.ts
import { describe, it, expect } from "vitest";
import { pillModel } from "@/components/meridian/HoverPill";
import { APP_GROUPS, appTabs } from "@/lib/appNav";

const tabs = appTabs({ role: "owner" });

describe("pillModel", () => {
  it("shows only groups that have at least one ready tab", () => {
    const m = pillModel(tabs, APP_GROUPS, "/sales");
    for (const g of m.groups) expect(m.tabsByGroup[g.id].length).toBeGreaterThan(0);
  });

  it("marks exactly one group active, by longest prefix", () => {
    const m = pillModel(tabs, APP_GROUPS, "/sales/orders/12");
    expect(m.groups.filter((g) => g.active)).toHaveLength(1);
    expect(m.groups.find((g) => g.active)?.id).toBe("sales");
  });

  it("a group's href is its first ready tab", () => {
    const m = pillModel(tabs, APP_GROUPS, "/sales");
    for (const g of m.groups) expect(g.href).toBe(m.tabsByGroup[g.id][0].href);
  });

  it("never lists a tab the role cannot reach", () => {
    const sp = appTabs({ role: "salesperson" });
    const m = pillModel(sp, APP_GROUPS, "/sales");
    for (const list of Object.values(m.tabsByGroup)) {
      for (const t of list) expect(t.ready).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it red** — `npx vitest run tests/hoverPill.test.ts` → module missing.

- [ ] **Step 3: Implement `pillModel` + `HoverPill`**

Port `slideThumb` and the effect body from `TabPill.tsx` unchanged (it is correct and
hard-won); replace the second `<nav className="seg">` row with the hover popover. Export
`pillModel` from the same file so the test can reach it without rendering.

- [ ] **Step 4: Add the popover CSS**

In `app/globals.css`, next to `.meridian .seg`, add `.meridian .seg-pop` (absolute,
`background: var(--surface)`, `border: 1px solid var(--line)`,
`border-radius: var(--r-lg)`, `box-shadow: var(--sh-3)`, `z-index` above the chrome) and
`.meridian .seg-pop a` matching `.pm__link`. Verify every token name against the file —
no literals.

- [ ] **Step 5: Swap it in and delete `TabPill`**

Replace `<TabPill …>` with `<HoverPill …>` in `AppHeader`, then `git rm
components/meridian/TabPill.tsx`. Update `MASTER.md`'s "Travelling tab pill" subsection
to name `HoverPill.tsx`.

- [ ] **Step 6: Green**

```bash
npx vitest run tests/hoverPill.test.ts && npx tsc --noEmit && npm test && npm run build
```

- [ ] **Step 7: Manual check** — `npm run dev`: hover each group, keyboard-navigate it,
      toggle `prefers-reduced-motion`, and check it on a narrow viewport.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: HoverPill — one nav row, hover-opened group menus

Keeps the travelling pill and its thumb (spec decision #2); the second
permanent row becomes a hover popover. Touch taps, keyboard arrows, Esc,
and reduced motion all handled.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: `ProfileMenu` on hover + the `⌘K` search slot

**Files:**
- Modify: `components/meridian/ProfileMenu.tsx`, `components/meridian/AppHeader.tsx`, `app/globals.css`
- Create: `components/meridian/SearchSlot.tsx`

- [ ] **Step 1: `ProfileMenu` — click → hover**

Open on `pointerenter`; close on `pointerleave` after a ~180 ms timer, cleared if the
pointer re-enters either the trigger or the panel. Keep: `Esc` closes, click on the
trigger toggles (the touch path), `aria-haspopup`/`aria-expanded`, and the existing
click-outside handler. Guard the hover path behind `matchMedia("(hover: hover)")` so a
touch device does not open a menu on the tap that was meant to activate it.

- [ ] **Step 2: `SearchSlot` — reserved, inert**

```tsx
// components/meridian/SearchSlot.tsx
"use client";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/meridian/Icon";

/** The header's search affordance. Inert in this slice — it reserves the space and owns
 *  the ⌘K / Ctrl-K binding so the command palette (its own slice) drops in without
 *  touching AppHeader. */
export default function SearchSlot() {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        btn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <button ref={btn} type="button" className="searchslot" aria-label="جستجو">
      <Icon name="search" size="sm" />
      <span className="searchslot__label">جستجو…</span>
      <kbd className="searchslot__kbd">⌘K</kbd>
    </button>
  );
}
```

- [ ] **Step 3: Mount both** — `SearchSlot` before `NotificationBell` in `.topright`.

- [ ] **Step 4: CSS** — `.meridian .searchslot` and its two children, tokens only.

- [ ] **Step 5: Green + manual** — `npx tsc --noEmit && npm test && npm run build`, then
      `npm run dev`: hover the avatar, press `⌘K`, tab to the slot, `Esc` from the menu.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: profile menu opens on hover; reserved ⌘K search slot in the header

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: `PageHeaderCard` + `lib/pageMeta.ts`

**Files:**
- Create: `components/meridian/PageHeaderCard.tsx`, `lib/pageMeta.ts`, `tests/pageMeta.test.ts`
- Modify: every `page.tsx` under `app/(shell)`

**Interfaces:**
- `lib/pageMeta.ts`: `export const PAGE_META: Record<string, { title: string; overview: string }>`;
  `export function pageMetaFor(pathname: string): { title: string; overview: string }` —
  longest-prefix match, throwing in development and falling back to a neutral title in
  production.
- `PageHeaderCard({ route, tabs }: { route: string; tabs: AppTab[] })` — title + overview
  in the body, the active group's sibling tabs in the notch (spec decision #7).

- [ ] **Step 1: Failing completeness test**

```ts
// tests/pageMeta.test.ts
import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PAGE_META } from "@/lib/pageMeta";

/** Every shell route needs an overview, or the top card on that page is empty. Walking
 *  the tree rather than listing routes means a new page fails this test the day it is
 *  added, which is the point. */
function routes(dir: string, base = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith("[") || e.name.startsWith("(")) continue; // dynamic + groups
    const url = `${base}/${e.name}`;
    if (existsSync(join(dir, e.name, "page.tsx"))) out.push(url);
    out.push(...routes(join(dir, e.name), url));
  }
  return out;
}

describe("pageMeta", () => {
  it("covers every static route under app/(shell)", () => {
    const missing = routes("app/(shell)").filter((r) => !PAGE_META[r]);
    expect(missing, `missing overview copy for: ${missing.join(", ")}`).toEqual([]);
  });

  it("every overview is a real sentence, not a placeholder", () => {
    for (const [k, v] of Object.entries(PAGE_META)) {
      expect(v.title.length, k).toBeGreaterThan(1);
      expect(v.overview.length, k).toBeGreaterThan(20);
      expect(v.overview).not.toMatch(/TODO|TBD|placeholder/i);
    }
  });
});
```

- [ ] **Step 2: Run it red** — module missing.

- [ ] **Step 3: Write `lib/pageMeta.ts`** with real Persian copy for every route the walker
      finds. Run the walker first to get the list:
      `node -e "…"` or just let the test failure print the missing routes.

- [ ] **Step 4: Write `PageHeaderCard`**, reusing `CarvedCard`'s notch vocabulary — read
      `components/meridian/CarvedCard.tsx` and `lib/design/carve.ts` and put the sibling
      tabs in the bay where the avatars go, rather than inventing a second notch
      mechanism.

- [ ] **Step 5: Add it to every shell page**, top of the content, above everything else.

- [ ] **Step 6: Green + commit** — `npm test && npm run build`, then commit.

---

## Task 9: `loading.tsx` per segment + `<Suspense>` boundaries

Only now does this work, because Task 4 unblocked it.

**Files:** `app/(shell)/**/loading.tsx` (one per route segment with a `page.tsx`)

- [ ] **Step 1: Failing coverage test** — same walker as Task 8, asserting a `loading.tsx`
      beside every `page.tsx` under `app/(shell)`.
- [ ] **Step 2: Red.**
- [ ] **Step 3:** For each segment write a `loading.tsx` that renders the **real**
      `PageHeaderCard` (title/overview/tabs are static and known instantly) above a body
      skeleton built from `components/Skeleton.tsx`, shaped like that page's real layout.
- [ ] **Step 4:** Add `<Suspense>` inside the heavier pages so fast regions paint before
      slow ones — start with `/sales/dashboard` (headline stats before the cost-to-serve
      table folded in by Task 10).
- [ ] **Step 5:** Manual throttled-navigation check on six pages.
- [ ] **Step 6: Green + commit.**

---

## Task 10: `/analytics` merge, the icon/card sweep, MASTER.md reconciliation

- [ ] **Step 1:** Move `CostToServePanel` and its server data assembly from
      `app/analytics/page.tsx` into `/sales/dashboard` behind its own `<Suspense>`.
- [ ] **Step 2:** Delete `app/analytics/` and add to `next.config.ts`:

```ts
  async redirects() {
    return [{ source: "/analytics", destination: "/sales/dashboard", permanent: true }];
  },
```
      Note `proxy.ts` gates `/analytics` against `salesperson`; the redirect target
      carries its own gate, so the rule can be dropped from `proxy.ts` in the same commit.
- [ ] **Step 3:** Icon sweep — replace every inline `<svg>` icon and emoji-as-icon with
      `<Icon>`; the documented exceptions stay (`app/(shell)`'s brand mark,
      `components/facilityIcon.ts`, `components/facilityArt.ts`). Add a test asserting no
      new bespoke `<svg>` outside the exception list.
- [ ] **Step 4:** Card sweep — remove top coloured accent borders (`border-top`,
      `border-t-*`, `::before` accent bars) and unify hover to the one rule. **Do not
      touch `PocketCard`/`Pocketed`/`OrdersPockets`.**
- [ ] **Step 5:** Cool the deferred decorative tokens in `app/globals.css`'s hand-written
      `.meridian` blocks: `--gcard-*`, `--frost`, `--frost-edge`, `--island-*`,
      `--tick-ink`, `--notice-ink`, `--serie-b`, `--ev-*-ink`, `--wash-mint/sand/sky`.
      Re-run `npm run check:contrast`.
- [ ] **Step 6:** `MASTER.md`: rewrite "Product shape" (the map is `/map`, not `/`; the
      shell/bare split), the map paragraph in "Visual thesis" (canvas keeps dark, tokens
      unify), and the "Motion" section (pure-CSS entrance and framer-motion coexist;
      `lib/motion.ts` mirrors the tokens).
- [ ] **Step 7:** Full gate + tag `app-shell-foundations-part2`.

---

## Self-Review

**Spec coverage.** Section 1 (route groups, theme scope, map override, `AppShell`, bell,
`/analytics`) → Tasks 2, 3, 4, 5, 10. Section 2 (one-row header, `HoverPill`, nav
registry, search slot, hover `ProfileMenu`) → Tasks 1, 6, 7. Section 3's rollout half
(`PageHeaderCard`, icon/card sweep) → Tasks 8, 10. Section 4 (instant transitions,
skeletons, baseline error routes) → Tasks 4, 9, and `not-found.tsx`/`error.tsx` in Task 4's
file list. Section 5 (ordering, testing, MASTER.md) → the task order and Task 10.
Decision #11 (bare routes wear the palette) → Task 2. Decision #12 (pocket card
preserved) → Global Constraints and Task 10 Step 4.

**Gap found and closed while reviewing:** the plan originally put `loading.tsx` before the
layout fix; per the Next 16 docs that would have shipped a no-op. Task 4 now precedes
Task 9 and carries the guard test.

**Gap accepted:** `app/(shell)/not-found.tsx` and `error.tsx` are listed in Task 4's
Files but have no dedicated steps — they are two ~15-line components and the themed
versions belong to the error-pages slice. Write them in Task 4 Step 5.

**Type consistency.** `AppTab` / `AppGroupId` / `appTabs` / `activeGroup` defined in
Task 1, consumed in Tasks 4, 6, 8. `pillModel` defined and consumed in Task 6.
`PAGE_META` / `pageMetaFor` defined in Task 8, consumed in Tasks 8 and 9.
`AppShell` / `AppHeader` / `HeaderSkeleton` defined in Task 4, consumed in Tasks 5, 6, 7.
No drift found.

**Risk ordering.** The two riskiest changes are separated: Task 2 moves four low-traffic
routes and Task 3 moves the eight real ones, each with the build green and its own
commit, before Task 4 changes any behaviour.
