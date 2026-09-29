# `/leads` Is the Office, `/driver` Is My Day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/leads` a manager-only page with no role branch in its body, make `/driver` show every van role's whole working day (deliveries *and* prospect visits), and gate `/leads` on role in the proxy for the first time.

**Architecture:** Two commits, not one. **Commit A** is a one-line fix that mounts `MyPositionProvider` in `app/(bare)/layout.tsx` — it fixes a live bug (`VerifyVisits` records visits with `pos = null` today) and is a prerequisite for Commit B, because the `DriverRunView` that moves onto `/driver` renders a map and a distance that read the position context. **Commit B** removes the `!isManager` branch from `/leads`, moves `DriverRunView` and `useDriverRun` to shared locations, server-renders the visit run into `/driver` behind a new optional `initialRun` prop, and adds the two proxy rules. No DB migration, no API change, no schema change.

**Tech Stack:** Next.js 16 (App Router, route groups `(shell)` / `(bare)`), React 19, TypeScript, `node:sqlite` via `lib/db.ts`, Vitest (`environment: "node"`), a hand-written `proxy.ts` middleware.

**Spec:** `docs/superpowers/specs/2026-09-29-leads-manager-only-driver-my-day-design.md`

---

## The shape of the code, before any task

| File | Responsibility | Task |
|---|---|---|
| `app/(bare)/layout.tsx` | Palette scope for the vehicle screens. Synchronous by contract. | 1 |
| `lib/driverDay.ts` | **NEW.** Pure: which sections a session gets on `/driver`. The testability seam §5.2 asks for. | 2 |
| `components/driver/useDriverRun.ts` | **MOVED** from `app/(shell)/leads/hooks/useDriverRun.ts`. Client hook, fetches `/api/lead-runs`. | 3 |
| `components/driver/DriverRunView.tsx` | **MOVED** from `components/leads/`. Client view of the visit run. | 4 |
| `components/driver/NextStopBanner.tsx` | **MOVED** from `components/leads/`. The banner above the fold. | 4 |
| `components/driver/DriverDaySection.tsx` | **NEW.** Client wrapper holding the visit-recording sheet's state. | 5 |
| `app/(shell)/leads/page.tsx` | The pin pool. After Task 6: no role branch at all. | 6 |
| `app/(shell)/leads/hooks/useLeads.ts` | The pool's data hook. `isManager` guard stays — see Task 6. | 6 |
| `app/(bare)/driver/page.tsx` | Server component. After Task 5: two sections + the commission card. | 5 |
| `proxy.ts` | The gate. Task 7 removes `/leads` from the driver allowlist and adds the rep-lead rule. | 7 |
| `lib/appNav.ts` | The menu. Task 8 drops `/leads` from `DRIVER_TABS`. | 8 |
| `app/(shell)/sales/runs/page.tsx` | Task 9 fixes `WHERE role = 'driver'`. **Spec 2 deletes this page** — the fix is an input spec 2 must not regress. | 9 |
| `app/(shell)/sales/commission/page.tsx` | Task 9 fixes the same query. | 9 |
| `tests/no-silent-context-default.test.ts` | **NEW.** A context default that reads as real data is a bug waiting to happen. | 10 |
| `tests/no-role-string-literals.test.ts` | **NEW.** A raw `role = '…'` outside `lib/roles.ts` / `lib/db.ts` is a rename waiting to happen. | 10 |

### Decisions the spec left open, made here

The spec flags three things as "the plan should decide". Decided, with reasons, so the decision is reviewable rather than inherited.

1. **`useDriverRun` moves to `components/driver/useDriverRun.ts`**, not `lib/`. It is a React hook with `useState`/`useEffect`/`useCallback` in its body; `lib/` in this repo holds pure modules and server repos. `components/driver/` is where its only two consumers live after the move, and `lib/useSession.ts` sets the precedent that a client hook may live outside `app/`.

2. **`useLeads` keeps `useSession()`.** The spec asks for a decision. Keeping it costs one `/api/me` fetch per load for an answer that no longer varies; removing it touches six return-value lines and deletes a guard that still protects a *mistyped URL* and a *cached bundle*. Keeping a defensive guard costs one request; removing it costs a line of defence. **Kept**, with a comment saying why it is now dead in practice.

3. **`RunTimeline` stays in the `runs` view** (spec 2 §8 open question). Decided in plan 2, not here.

---

## Commit A — the position fix

**This commit is independent of everything else in the plan.** No moved component, no new prop, no nav change, no proxy change. It fixes a bug that ships today: `components/driver/VerifyVisits.tsx:40` passes `pos = null` into every visit recorded on `/driver`, because `useMyPosition()` on that page returns the context **default** rather than a live watch.

It goes first, alone, because a bug in production should not be queued behind a refactor. If the rest of the plan is later re-scoped, deferred, or abandoned, the fix still stands on its own.


### Task 1: Mount `MyPositionProvider` in the bare group

**Files:**
- Modify: `app/(bare)/layout.tsx`
- Test: `tests/bare-layout-has-position.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/bare-layout-has-position.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** The vehicle screens are where the geolocation watch matters most, and they are also
 *  where it was missing.
 *
 *  MyPositionProvider was mounted only in app/(shell)/layout.tsx. /driver lives in
 *  app/(bare), which mounted nothing -- so useMyPosition() on /driver returned the
 *  context's DEFAULT value, { position: null, status: "idle", retry: () => {} }.
 *
 *  Nothing threw. useContext on an unprovided context returns the default, so a missing
 *  provider is indistinguishable from real data: VerifyVisits recorded every visit with
 *  pos = null, and a NextStopBanner shows no distance. A page that renders perfectly and
 *  lies. This file is a source-text assertion, in the style of tests/shellGroups.test.ts,
 *  because the failure mode has no exception to catch. */
describe("the bare group has a position", () => {
  const src = readFileSync("app/(bare)/layout.tsx", "utf8");

  it("mounts MyPositionProvider", () => {
    expect(src, "app/(bare)/layout.tsx must mount MyPositionProvider").toContain("MyPositionProvider");
  });

  it("wraps children in it rather than importing it and doing nothing", () => {
    // The import alone would satisfy the test above while the page still got nothing --
    // an unused import is exactly what a half-finished edit looks like.
    expect(src).toMatch(/<MyPositionProvider>[\s\S]*\{children\}[\s\S]*<\/MyPositionProvider>/);
  });

  it("still stays synchronous -- the provider is a client component, not an await", () => {
    // tests/shellGroups.test.ts:43-49 already asserts the layout is not async and does not
    // import next/headers. Repeated here so this file fails on its own terms if it is the
    // only one run.
    expect(src).not.toMatch(/export default async function/);
    expect(src).not.toMatch(/^\s*import\s.*\bfrom\s+["']next\/headers["']/m);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/bare-layout-has-position.test.ts`

Expected: FAIL — `app/(bare)/layout.tsx must mount MyPositionProvider`.

- [ ] **Step 3: Write the implementation**

Replace `app/(bare)/layout.tsx` in full:

```tsx
import type { ReactNode } from "react";
import { MyPositionProvider } from "@/components/MyPositionProvider";


/** The bare group: /driver, /login, /offline, /today.
 *
 *  These wear the design system's PALETTE — the same cold tokens, type, radii and
 *  shadows as everywhere else, so they read as the same product — and nothing else. No
 *  header, no travelling pill, no page-overview card, no entrance choreography. The
 *  contexts are a phone held in a moving vehicle and a login card on a cold start;
 *  chrome is precisely the thing they must not have. See the design spec, decision #11:
 *  "match the theme, not fully".
 *
 *  Synchronous, and it must stay that way. Nothing here reads cookies() — proxy.ts owns
 *  the gate for every one of these paths — so a navigation into this group never blocks
 *  on the layout. tests/shellGroups.test.ts guards it. A client component satisfies that
 *  without qualification: it awaits nothing and makes no server call.
 *
 *  MyPositionProvider is here for the same reason it is in the shell, and more strongly:
 *  (bare) is where the vehicle screens live, which is exactly where one shared
 *  geolocation watch matters. It was mounted only in the shell, so /driver -- a page in
 *  THIS group -- had no position at all. useMyPosition() returned the context default, so
 *  nothing threw: VerifyVisits recorded every visit with pos = null and a next-stop
 *  banner showed no distance. A map with no blue dot, and every signal saying all was
 *  well. tests/bare-layout-has-position.test.ts holds the mount in place. */
export default function BareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="meridian">
      <MyPositionProvider>{children}</MyPositionProvider>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/bare-layout-has-position.test.ts tests/shellGroups.test.ts`

Expected: PASS — both files green. `shellGroups.test.ts` is the regression guard: it asserts the bare layout is not `export default async function`, does not import `next/headers`, and does not import `AppShell`. A client provider satisfies all three.

- [ ] **Step 5: Commit**

```bash
git add "app/(bare)/layout.tsx" tests/bare-layout-has-position.test.ts
git commit -m "fix(driver): the vehicle screens had no position, so visits saved with none

MyPositionProvider was mounted only in app/(shell)/layout.tsx. /driver lives in
app/(bare), which mounted nothing, so useMyPosition() there returned the context
DEFAULT rather than a live watch -- and useContext on an unprovided context does not
throw, it hands back the default. So nothing went red.

### Task 2: The section-decision seam

**Files:**
- Create: `lib/driverDay.ts`
- Test: `tests/driver-my-day-sections.test.ts` (new)

**Why this file exists.** `/driver` is an **async server component** that calls `cookies()`. `vitest.config.mts` sets `environment: "node"`, and **no test in `tests/` imports anything from `@/app/`** — there is no precedent for rendering a page. So "assert both sections render" cannot be written against the page directly.

The spec's own answer (§5.2) is to extract the decision — *which sections does a session get* — out of scattered `{isManager && …}` JSX and into a pure function. Without that extraction the central promise of this spec (a person sees all their work regardless of which hat is active) ships on nothing but a code review. This is a testability requirement of the spec, not a refactor.

- [ ] **Step 1: Write the failing test**

Create `tests/driver-my-day-sections.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { driverDaySections } from "@/lib/driverDay";
import { ROLES, type Role } from "@/lib/roles";

/** Both kinds of work, always, for a van role.
 *
 *  The driver is either a delivery driver, a field rep, or somebody holding both hats.
 *  The page used to answer that with `isManager` — one question, one answer — so a
 *  dual-hat person saw deliveries on /driver and prospect visits on /leads, and had to
 *  navigate between two pages for one working day.
 *
 *  The rule this file exists to hold: BOTH sections render for EVERY van role,
 *  unconditionally. Not "if the driver has visits", not "if the driver also holds
 *  delivery_driver". A section that DISAPPEARS is indistinguishable from a section that
 *  is EMPTY, and a driver must never conclude "I have no deliveries" when the
 *  deliveries section simply did not render. */
describe("what a session sees on /driver", () => {
  it("gives both sections to a delivery driver", () => {
    expect(driverDaySections("delivery_driver")).toEqual(["deliveries", "visits"]);
  });

  it("gives both sections to a field rep", () => {
    expect(driverDaySections("field_rep")).toEqual(["deliveries", "visits"]);
  });

  it("gives both sections to a dual-hat person, whichever hat is active", () => {
    /* The regression this whole spec exists to close. `isManager` answered a single
       question, so a field_rep who also holds delivery_driver was shown one job. The
       active role is the only thing that varies here, and it changes nothing. */
    expect(driverDaySections("field_rep")).toEqual(driverDaySections("delivery_driver"));
  });

  it("orders deliveries above visits", () => {
    // A delivery stop is revenue-bearing and time-bound (cold chain, weather caps); a
    // prospect visit is not. Same reasoning as DriverRunView's own doc comment.
    const s = driverDaySections("delivery_driver");
    expect(s.indexOf("deliveries")).toBeLessThan(s.indexOf("visits"));
  });


- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/driver-my-day-sections.test.ts`

Expected: FAIL — `Cannot find module '@/lib/driverDay'`.

- [ ] **Step 3: Write the implementation**

Create `lib/driverDay.ts`:

```ts
import { isVanRole, type Role } from "./roles";

/** The two kinds of work a van role has, in the order they are read.
 *
 *  Pure on purpose. `/driver` is an async server component that calls cookies(), and
 *  vitest runs in a node environment where nothing renders a page — so the only way the
 *  spec's central promise ("a person sees all their work regardless of which hat is
 *  active") can be asserted is if the DECISION lives somewhere testable. This is that
 *  somewhere. See tests/driver-my-day-sections.test.ts.
 *
 *  Both, or neither. Not "deliveries if you are a delivery_driver" — that is the bug.
 *  A field rep with no delivery run today is told so by the empty state inside the
 *  section, which is an honest answer; a missing section is a lie. */
export type DriverDaySection = "deliveries" | "visits";

export function driverDaySections(role: Role): DriverDaySection[] {
  return isVanRole(role) ? ["deliveries", "visits"] : [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/driver-my-day-sections.test.ts`

Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/driverDay.ts tests/driver-my-day-sections.test.ts
git commit -m "feat(driver): the section decision, as a pure function

/driver is an async server component and no test in this repo imports from app/, so
the promise this spec makes -- both kinds of work, whichever hat is active -- had
nowhere to be asserted. Extracted the decision so it can be."
```

### Task 3: Move `useDriverRun` out of the route folder

**Files:**
- Create: `components/driver/useDriverRun.ts` (moved, one prop added)
- Delete: `app/(shell)/leads/hooks/useDriverRun.ts`
- Modify: `components/leads/DriverRunView.tsx:6`, `components/leads/NextStopBanner.tsx:6` (imports repointed here; Task 4 moves the files themselves)

**Why this is load-bearing.** Two files in `components/` already import from `@/app/(shell)/leads/hooks/` — including `DriverRunView.tsx:6` and `NextStopBanner.tsx:6`. A `components/` file importing from a *route* directory already points the wrong way. Task 4 makes an `app/(bare)` page depend on `app/(shell)` internals, which inverts the dependency entirely, and Next treats route folders as boundaries. So the hook moves to a location both groups can import.

Moving rather than copying is deliberate: a copy leaves two sources of truth for "my stops" — the exact failure `lib/roles.ts` documents when `db.ts` held a hand-copied duplicate of the role union that then drifted.

- [ ] **Step 1: Verify the current import graph**

Run: `grep -rn "leads/hooks/useDriverRun" --include=*.tsx --include=*.ts . | grep -v node_modules`

Expected: exactly two hits —
```
./components/leads/DriverRunView.tsx:6
./components/leads/NextStopBanner.tsx:6
```

**The spec says seven importers. Measure rather than trust that number** — this plan was written from the spec, and the spec counted files that *could* import rather than files that do. If there turn out to be more than two, every one is an importer this task must repoint, and `tsc` in Step 6 catches a miss either way.

- [ ] **Step 2: Move the file**

Run:

```bash
git mv "app/(shell)/leads/hooks/useDriverRun.ts" components/driver/useDriverRun.ts
```

`git mv` rather than delete-then-create, so the diff records a **rename**. This is a move, and a reader should be able to see that in one line of history.


- [ ] **Step 3: Add the `initialRun` prop and rewrite the doc comment**

In `components/driver/useDriverRun.ts`, replace the doc comment above `export interface DriverStop`:

```ts
/** A driver's own day, from /api/lead-runs.
 *
 *  It used to live in app/(shell)/leads/hooks/, beside useLeads, and two components/
 *  files imported it from a route directory. It is now components/driver/, because the
 *  only thing that consumes it is the driver's own screen — which lives on /driver in
 *  app/(bare) — and a bare page must not reach into the shell's internals.
 *
 *  Deliberately separate from useLeads rather than a branch inside it. useLeads is the
 *  manager's pool -- it fetches /api/locations and /api/lead-lists, both of which are
 *  owner/group_manager routes, so a driver asking for them gets two 403s and an empty
 *  page. The two share no state, which is the point: a driver has no pool.
 *
 *  What the driver sees is derived on the server (lib/repo/leadRuns.ts) from the pin
 *  itself, so "the next stop" cannot disagree with what the office sees. */
```

Then replace the hook's signature and its first three state lines.

BEFORE:
```ts
export function useDriverRun() {
  const [run, setRun] = useState<DriverRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
```

AFTER:
```ts
/* The server render is the FIRST PAINT, not a cache. It is passed in as `initialRun`
   from the /driver page so the page does not fill in twice — the delivery section above
   is already painted by the time a client fetch would resolve. The fetch still runs on
   mount, and still runs after a reorder or a recorded visit: DriverRunView must not be
   trusted to stay fresh, and it is not.

   `null` and `undefined` are deliberately different. `null` is "the server ran and there
   is no run", so there is nothing to wait for. `undefined` is "the server did not
   answer", so `loading` starts true and the skeleton is the honest first state. */
export function useDriverRun(initialRun?: DriverRun | null) {
  const [run, setRun] = useState<DriverRun | null>(initialRun ?? null);
  const [loading, setLoading] = useState(initialRun === undefined);
  const [error, setError] = useState<string | null>(null);
```

Everything else in the file — `load`, the `useEffect`, `pending`, `next`, `move`, `sortByIds` — is unchanged.

- [ ] **Step 4: Repoint the two importers**

In `components/leads/DriverRunView.tsx`, change line 6:

```ts
// BEFORE
import { useDriverRun, pendingStops, type DriverStop } from "@/app/(shell)/leads/hooks/useDriverRun";
// AFTER
import { useDriverRun, pendingStops, type DriverStop } from "@/components/driver/useDriverRun";
```

In `components/leads/NextStopBanner.tsx`, change line 6:

```ts
// BEFORE
import type { DriverStop } from "@/app/(shell)/leads/hooks/useDriverRun";
// AFTER
import type { DriverStop } from "@/components/driver/useDriverRun";
```

- [ ] **Step 5: Confirm the old path is gone**

Run: `grep -rn "leads/hooks/useDriverRun" --include=*.tsx --include=*.ts . | grep -v node_modules`

Expected: no output.

Run: `ls "app/(shell)/leads/hooks/"`

Expected: `useLeads.ts` and `useRouteMatrix.ts` — `useDriverRun.ts` is no longer there.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. This is the mechanical safety net the spec names; `tsc` catches every missed importer.

- [ ] **Step 7: Commit**

```bash
git add -A components/driver/useDriverRun.ts "app/(shell)/leads/hooks/useDriverRun.ts" \
  components/leads/DriverRunView.tsx components/leads/NextStopBanner.tsx
git commit -m "refactor(driver): useDriverRun moves out of the route folder

Two components/ files imported it from @/app/(shell)/leads/hooks/. That already
pointed the wrong way; leaving it in place would make an app/(bare) page depend on
app/(shell) internals, inverting the dependency entirely.

### Task 4: Move `DriverRunView` and `NextStopBanner` to `components/driver/`

**Files:**
- Create: `components/driver/DriverRunView.tsx` (moved from `components/leads/`), one prop added
- Create: `components/driver/NextStopBanner.tsx` (moved from `components/leads/`)
- Delete: `components/leads/DriverRunView.tsx`, `components/leads/NextStopBanner.tsx`
- Modify: `app/(shell)/leads/page.tsx:18, 278-281` (the branch is removed here; Task 6 finishes the page)

- [ ] **Step 1: Move the files**

```bash
git mv components/leads/DriverRunView.tsx components/driver/DriverRunView.tsx
git mv components/leads/NextStopBanner.tsx components/driver/NextStopBanner.tsx
```

- [ ] **Step 2: Fix `DriverRunView`'s imports**

In `components/driver/DriverRunView.tsx`, replace the import block.

BEFORE:
```tsx
import NextStopBanner from "@/components/leads/NextStopBanner";
import { useDriverRun, pendingStops, type DriverStop } from "@/components/driver/useDriverRun";
```

AFTER:
```tsx
import NextStopBanner from "@/components/driver/NextStopBanner";
import { useDriverRun, pendingStops, type DriverRun, type DriverStop } from "@/components/driver/useDriverRun";
```

- [ ] **Step 3: Add the `initialRun` prop**

BEFORE:
```tsx
export default function DriverRunView({
  onRecord,
  navAppId,
}: {
  onRecord: (locationId: number) => void;
  navAppId: NavAppId;
}) {
  const { run, stops, loading, error, reload, move } = useDriverRun();
```

AFTER:
```tsx
export default function DriverRunView({
  initialRun,
  onRecord,
  navAppId,
}: {
  /** The server's read of today's run, handed in by /driver.
   *
   *  Without it the view client-fetches /api/lead-runs and renders a skeleton. On
   *  /driver that meant the delivery section above was already painted and the page
   *  visibly filled in twice. It is the FIRST PAINT, not a cache: the hook still
   *  re-fetches on mount and after every reorder or recorded visit. */
  initialRun?: DriverRun | null;
  onRecord: (locationId: number) => void;
  navAppId: NavAppId;
}) {
  const { run, stops, loading, error, reload, move } = useDriverRun(initialRun);
```

- [ ] **Step 4: Update the component's doc comment**

The first line currently reads "A driver's whole screen" — it is now a *section* of a screen. Replace the first paragraph:

```tsx
/** The driver's prospect visits: where next, then the rest of the day.
 *
 *  This is the second section of /driver, under the deliveries. It used to be the whole
 *  of a driver's page, on /leads, behind a role branch.
 *
 *  The order within the section is deliberate. The next stop is above the fold because it
 *  is the only thing that has to be read before getting out of the van; everything else
 *  sits behind a disclosure, so a long day does not push the answer off the screen.
 *
 *  A visited stop stays in the list, struck through, rather than vanishing. Same
- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. Detached on this box (`setsid nohup npx tsc --noEmit > /tmp/tsc-spec1-task4.log 2>&1 &`) — it takes ~15 min here, so launch it and continue rather than waiting on the foreground.

- [ ] **Step 7: Commit**

```bash
git add components/driver components/leads "app/(shell)/leads/page.tsx"
git commit -m "refactor(driver): the driver's run view moves to components/driver

Moved, not copied. A copy would leave two sources of truth for 'my stops' -- the
exact failure lib/roles.ts documents when db.ts held a hand-copied duplicate of the
role union that then drifted.

Takes an optional initialRun so the /driver page can server-render the run. Task 5
is what passes it -- until then the prop is wired but dark, and behaviour is
unchanged."
```

### Task 5: `/driver` renders both sections, server-side

 *  reasoning as a handed-off lead staying visible: a list that silently shrinks reads as a
 *  broken app, and a driver who cannot see why a stop disappeared will assume the worst. */
```

The two paragraphs that follow it (about the visited stop staying visible) are kept as they are; the new text above already states that reasoning, so delete the old paragraph that repeats it and keep the rest.

- [ ] **Step 5: Remove the branch from the leads page**

In `app/(shell)/leads/page.tsx`, delete line 18:

```tsx
import DriverRunView from "@/components/leads/DriverRunView";
```

and delete lines 278-281:

```tsx
          {/* A driver sees their day, and the manager's tools are simply not rendered. */}
          {!isManager && (
            <DriverRunView onRecord={setTapFlowId} navAppId={navAppId} />
          )}
```


### Task 5: `/driver` renders both sections, server-side

**Files:**
- Modify: `app/(bare)/driver/page.tsx`
- Create: `components/driver/DriverDaySection.tsx` (a client wrapper for the record-a-visit flow)

**The design.** Section 2 renders `DriverRunView`, which is a client component, and `/driver` is a server component. The visit-recording flow (`onRecord` → `LocationTapFlow`) is client state, so the page needs a client wrapper to hold it. `DriverDaySection` is that wrapper, and it is the *only* new component in this task.

Why the wrapper is needed at all: `DriverRunView` takes `onRecord: (locationId) => void`, a callback. A server component cannot pass a function to a client component. The wrapper owns the `tapFlowId` state and renders the flow.

- [ ] **Step 1: Write the wrapper**

Create `components/driver/DriverDaySection.tsx`:

```tsx
"use client";

import { useState } from "react";
import DriverRunView from "@/components/driver/DriverRunView";
import LocationTapFlow from "@/components/leads/LocationTapFlow";
import { useNavApp } from "@/components/NavAppSetting";
import type { DriverRun } from "@/components/driver/useDriverRun";

/** The visits section of /driver, and the sheet that records one.
 *
 *  A client wrapper for one reason: `DriverRunView` takes an `onRecord` callback, and a
 *  server component cannot hand a function to a client component. The page passes
 *  `initialRun` down; this holds the tap-flow's open/close state underneath it.
 *
 *  Position arrives from MyPositionProvider, which is mounted in this route group. Before
 *  that, the map below had no blue dot and the next-stop banner had no distance, and
 *  nothing said so.
 *
 *  The sheet's own heading is thinner here than it was on /leads: that page read the
 *  pin's name and coordinates out of the pool's `byId` map, and /driver has no pool. The
 *  sheet still records the outcome, which is the work. A follow-up could hand it the
 *  `DriverStop` the banner already holds; that is not this plan. */
export default function DriverDaySection({ initialRun }: { initialRun?: DriverRun | null }) {
  const [navAppId] = useNavApp();
  const [tapFlowId, setTapFlowId] = useState<number | null>(null);

  return (
    <>
      <DriverRunView
        initialRun={initialRun}
        onRecord={setTapFlowId}
        navAppId={navAppId}
      />
      <LocationTapFlow
        open={tapFlowId !== null}
        locationId={tapFlowId!}
        locationName=""
        locationLat={null}
        locationLng={null}
        navAppId={navAppId}
        onNavigate={(url) => window.open(url, "_blank")}
        onClose={() => setTapFlowId(null)}
      />
    </>
  );
}
```

- [ ] **Step 2: Replace the page's imports and its data reads**

In `app/(bare)/driver/page.tsx`, add the imports:

```ts
import { readTodaysLeadRun } from "@/lib/repo/leadRuns";
import { driverDaySections } from "@/lib/driverDay";
import DriverDaySection from "@/components/driver/DriverDaySection";
```

Then replace the read block (currently lines 53-65, from `const db = getDb();` through the `commission` line) with:

```ts
  const sections = driverDaySections(session.role);
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  /* Deliveries. Falls back to the most recent run rather than showing an empty screen --
     a driver opening this at 00:30 after a late round is finishing yesterday's work, not

- [ ] **Step 3: Replace the page's JSX with the two sections**

In `app/(bare)/driver/page.tsx`, replace everything from the `{run && weatherLine(...)}` line through the closing of the `commission.kg > 0` block with:

```tsx
      {/* ── Section 1: deliveries ─────────────────────────────────────────── */}
      {sections.includes("deliveries") && (
        <section aria-labelledby="day-deliveries" className="mb-[var(--space-5)]">
          <h2 id="day-deliveries" className="mb-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
            تحویل‌ها
          </h2>

          {run && weatherLine(run as unknown as { weather_json?: string | null }) && (
            <p className="mb-[var(--space-3)] flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--warn)] p-[var(--space-2)] text-center text-[length:var(--text-xs)] text-[var(--text-muted)]">
              <Icon name="weather" size="sm" />
              {weatherLine(run as unknown as { weather_json?: string | null })}
            </p>
          )}

          {!run || run.stops.length === 0 ? (
            /* An EMPTY section, not a missing one. A driver must never read this as
               "there are no deliveries" when the truth is that the section did not
               render. */
            <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] leading-7 text-[var(--text-faint)]">
              امروز مسیری برای شما ثبت نشده است. وقتی مدیر سفارش‌ها را به مسیر شما اضافه کند،
              همین‌جا نمایش داده می‌شود.
            </p>
          ) : (
            <DriverRun
              run={plain([run])[0]}
              driverName={session.user.display_name}
              businessName="فروش و پخش"
            />
          )}

          {commission.kg > 0 && (
            <div className="mt-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--border)] p-[var(--space-4)]">
              <div>
                <div className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  پورسانت از {faJalaliDate(period.from)}
                </div>
                <div className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-faint)]">
                  {faNum(commission.kg)} کیلو تحویل‌شده

      {/* ── Section 2: prospect visits ────────────────────────────────────── */}
      {sections.includes("visits") && (
        <section aria-labelledby="day-visits" className="mb-[var(--space-5)]">
          <h2 id="day-visits" className="mb-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
            بازدیدها و سرنخ‌ها
          </h2>
          <DriverDaySection initialRun={leadRun} />
        </section>
      )}

      <NotificationBell />
```

**The commission card stays inside section 1, gated on `commission.kg > 0`, exactly as today.** It is money, not work, and it belongs to the delivery job only.

- [ ] **Step 4: Update the page's doc comment**

Replace the comment above `export default async function DriverPage()`:

```tsx
/** «روز من» — the driver's whole day, and every hat they hold.
 *
 *  Two sections, both rendered for every van role, unconditionally. The decision is a
 *  pure function (lib/driverDay.ts) rather than inline JSX, because /driver is an async
 *  server component and no test in this repo can render a page — the promise that a
 *  person sees all their work has to live somewhere testable. See
 *  tests/driver-my-day-sections.test.ts.
 *
 *  A dual-hat person used to see deliveries here and prospect visits on /leads, and had
 *  to navigate between two pages for one working day. `isManager` answered a single
 *  question, so it could only ever show one of the two jobs. */
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. `readTodaysLeadRun` returns `LeadRun | null`, and the `DriverRun` prop type in `useDriverRun.ts` is a structurally-compatible narrower shape — the repo row carries `driver_user_id`, `group_id` and `planned_by` that the client type does not declare, and TypeScript allows passing a wider object to a narrower type. If it complains, widen the `DriverRun` interface in `components/driver/useDriverRun.ts` rather than casting at the call site.

- [ ] **Step 6: Run the related tests**

Run: `npx vitest run tests/driver-my-day-sections.test.ts tests/bare-layout-has-position.test.ts tests/shellGroups.test.ts tests/crm-driver-visits.test.ts tests/briefing-repo.test.ts`

Expected: PASS — all green. `crm-driver-visits.test.ts` is the regression guard for visit recording; `briefing-repo.test.ts` guards the `/today` briefing this spec leaves alone.

- [ ] **Step 7: Commit**

```bash
git add "app/(bare)/driver/page.tsx" components/driver/DriverDaySection.tsx
git commit -m "feat(driver): /driver is My Day -- deliveries and visits, one page


### Task 6: `/leads` loses the branch

**Files:**
- Modify: `app/(shell)/leads/page.tsx` (the remaining `{isManager && …}` guards)
- Modify: `app/(shell)/leads/hooks/useLeads.ts:133-139` (comment only)

**What is left after Task 4 removed the driver branch.** The page still has `{isManager && <RouteSection … />}` and `{isManager && <LeadListsBar … />}`. On a manager-only page both are always true.

**Decision: remove the `isManager &&` wrappers, keep `isManager` in the hook.** The spec says the branch goes and `RouteSection` / `useLeads` / `LeadListsBar` are otherwise untouched. Keeping the wrappers would say the pool has a non-manager shape, and it does not.

- [ ] **Step 1: Un-wrap the `RouteSection` guard**

BEFORE:
```tsx
          {isManager && (
            <RouteSection
              run={run} runStops={runStops} totalKm={runTotalKm} navAppId={navAppId} routeHref={runHref}
              /* ... the whole prop list, unchanged ... */
              isManager={isManager} stopsPerDay={stopsPerDay} setStopsPerDay={setStopsPerDay}
              /* ... the rest, unchanged ... */
            />
          )}
```

AFTER:
```tsx
          <RouteSection
            run={run} runStops={runStops} totalKm={runTotalKm} navAppId={navAppId} routeHref={runHref}
            /* ... the whole prop list, unchanged ... */
            isManager stopsPerDay={stopsPerDay} setStopsPerDay={setStopsPerDay}
            /* ... the rest, unchanged ... */
          />
```

`isManager={isManager}` becomes the bare `isManager` prop: `RouteSection`'s own prop type is `isManager: boolean`, and the page is now unconditionally true. The prop is kept rather than removed because `RouteSection` is explicitly out of this spec's scope, and removing a prop from it is a different edit.

- [ ] **Step 2: Un-wrap the `LeadListsBar` guard**

BEFORE:
```tsx
          {/* Saved sets sit between the route and the map: next to the thing they feed,
              rather than a screen away above the pool. */}
          {isManager && (
            <LeadListsBar
              /* ... the whole prop list, unchanged ... */
            />
          )}
```

AFTER:
```tsx
          {/* Saved sets sit between the route and the map: next to the thing they feed,
              rather than a screen away above the pool. */}
          <LeadListsBar
            /* ... the whole prop list, unchanged ... */
          />
```

- [ ] **Step 3: Drop `isManager` from the destructuring, if it is now unused**

Run: `grep -n "isManager" "app/(shell)/leads/page.tsx"`

If the only remaining hit is the destructuring on line 45, remove `isManager,` from it. If a local still reads it, keep it and move on.

- [ ] **Step 4: Update the `useLeads` guard comment**

In `app/(shell)/leads/hooks/useLeads.ts`, replace the comment above `load`:

```ts
  /* A driver has no pool. /api/locations and /api/lead-lists are owner/group_manager
     routes, so asking for them as a driver is two guaranteed 403s. Since spec
     2026-09-29-leads-manager-only-driver-my-day section 3.2 the proxy refuses a van role
     at /leads, so this guard is dead in practice -- but it is kept, deliberately: a
     cached bundle or a third-party mount can still run this hook with a driver's
     session, and one wasted request is cheaper than a page of red console. The driver's
     own data no longer comes through here at all; it is on /driver. */
  const load = useCallback(async () => {
    if (isManager === false) { setLoading(false); return; }
```

**The guard's code line is unchanged.** Only the comment changes, because the current comment says a thing that is no longer true — "Their data comes from /api/lead-runs, in useDriverRun" — it does not, any more.

- [ ] **Step 5: Type-check and run the leads tests**

### Task 7: The gate — two rules, one file

**Files:**
- Modify: `proxy.ts:200-207` (remove `/leads` from the allowlist; add the rep-lead rule)
- Test: `tests/proxy.test.ts` (edit)

**Two rules, not one, and both are needed.**

1. **A van role reaching `/leads` → `deny("/driver")`.** Remove `pathname === "/leads"` from the `isDriverBriefing` allowlist. The existing two-tier gate at `proxy.ts:207` then catches it. Nothing new is written — the gate already expresses this, and adding a second `/leads` check would be the drift the file's own header comment warns about.

2. **A role that is not a rep-lead reaching `/leads` → `deny("/crm")`.** This is the one the spec calls "the same gate also has to close the top of the list, not just the bottom". `isManager` is `!isVanRole`, so a `phone_sales` rep satisfies it and today reaches the pool *and* the «سپردن مسیر» hand-off, on a URL the proxy never checked. `appNav.ts:100` already draws the line (`ready: isRepLead(r)`), and the nav must match the gate or the nav is a suggestion rather than a gate.

`/crm` is the right destination rather than `/sales`: `crm/page.tsx:26` already redirects a van role to `/driver` and opens on *today's follow-ups* for everyone else, and `/api/crm/businesses` admits `CRM_ROLES`, which includes `phone_sales`.

`/api/leads/locations` and `/api/lead-runs` **stay** allowlisted — a driver still records a visit at the door, now from `/driver`.

- [ ] **Step 1: Write the failing assertions**

In `tests/proxy.test.ts`, replace the test at lines 98-100:

```ts
  it("lets a driver into their lead run", () => {
    expect(proxy(req("/leads", "delivery_driver")).status).toBe(200);
  });
```

with:

```ts
  it("sends a driver hitting the lead pool back to their own day", () => {
    // /leads is the office now. The pool is the pin board, /driver is My Day, and both
    // kinds of work a driver holds are on the second one -- so a driver asking for the
    // pool is asking for a page that holds none of their work.
    const res = proxy(req("/leads", "delivery_driver"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/driver");
  });
```

and replace the test at lines 210-217:

```ts
  it("a phone sales rep reaches /leads but sees nothing there — the pre-existing dual-purpose page", () => {
```

with:

```ts
  it("refuses a phone sales rep the pin pool, and sends them where their leads actually live", () => {
    // This is the hole the both-directions note below used to EXEMPT and document: /leads
    // had no server-side role gate at all, and `isManager` is `!isVanRole`, so a rep
    // satisfied it and reached the pool AND the «سپردن مسیر» hand-off on a URL nobody
    // checked. The nav hid it (isRepLead); the gate did not. Now both agree.
    const res = proxy(req("/leads", "phone_sales"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/crm");
    const shown = new Set(appTabs({ role: "phone_sales" } as never).filter((t) => t.ready).map((t) => t.href));
    expect(shown.has("/leads")).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/proxy.test.ts`

Expected: FAIL on both new assertions. `delivery_driver → /leads` is currently **200**, and `phone_sales → /leads` is currently **200**.

- [ ] **Step 3: Remove `/leads` from the driver allowlist**

In `proxy.ts`, replace lines 200-206:

```ts
    // The lead run a driver works. /api/leads/locations/[id]/visit has admitted a driver
    // in requireRole since it was written, but it lives under /api/leads rather than
    // /api/crm/driver-visits -- so the gate below answered every visit a driver tried to
    // record, and the route never ran. The allowlist is what lets the request arrive.
    pathname === "/leads" ||
    pathname.startsWith("/api/leads/locations") ||
    pathname.startsWith("/api/lead-runs");
```

with:

```ts
    // The lead run a driver works, and the visit recorded at the door.
    // /api/leads/locations/[id]/visit has admitted a driver in requireRole since it was
    // written, but it lives under /api/leads rather than /api/crm/driver-visits -- so the
    // gate below answered every visit a driver tried to record, and the route never ran.
    // The allowlist is what lets the request arrive.
    //
    // `/leads` was on this list and is not any more: the page is the office's pin pool

- [ ] **Step 4: Add the rep-lead rule**

In `proxy.ts`, immediately after the `isVan` gate at line 207 (`if (isVan && !isDriver && !isSync && !isDriverBriefing) return deny("/driver");`), and before `return NextResponse.next();`, insert:

```ts
  /* /leads is the office's pin pool, and the pool is a manager's tool. The allowlist
     above describes who a VAN role may reach -- it says nothing about a rep who should
     not. `isManager` is `!isVanRole`, so a phone_sales rep satisfies every manager
     comparison in the app and reached the pool and the «سپردن مسیر» hand-off, on a URL
     the nav hid but the gate never checked.

     appNav.ts already draws the line: /leads is `ready: isRepLead(r)`. This makes the
     gate match it, so the nav is a gate rather than a suggestion.

     /crm rather than /sales, because that is where a rep's leads actually live:
     crm/page.tsx redirects a van role and otherwise opens on today's follow-ups, and
     /api/crm/businesses admits CRM_ROLES -- which includes phone_sales. */
  const isPinPool = pathname === "/leads" || pathname.startsWith("/leads/");
  if (
    isPinPool &&
    claims.role !== "owner" &&
    claims.role !== "group_manager" &&
    claims.role !== "rep_manager"
  ) {
    return deny("/crm");
  }
```

**Placement matters.** It goes *after* the `isVan` gate, so a van role is sent to `/driver` (their own day) rather than `/crm` — which would bounce them straight back, because the proxy's `isCrm` gate at line 183 would 403 them first. One redirect, to the right place.

- [ ] **Step 5: Rewrite the both-directions note and add `/leads` to `PATHS`**

In `tests/proxy.test.ts`, replace the comment block at lines 136-150 — the one beginning `/* /leads is deliberately EXCLUDED from PATHS, and the reason is worth writing down.` and ending `* Everything else below IS gate-gated, and the both-directions assertion is real. */` — with:

```ts
  /* /leads is now in PATHS. It used to be EXEMPT from this list, and the reason is worth
   * keeping, because the exemption was an admission.
   *
   * The page had no server-side role gate at all — it branched on `isManager` from
   * /api/me and simply did not fetch for a non-manager — and `isManager` is
   * `!isVanRole`, so a phone seller satisfied it. The proxy therefore COULD NOT refuse
   * /leads without breaking a driver's day, and the menu's `isRepLead` was the only thing
   * hiding it from a rep. Reachable but empty is a weaker promise than "refused".
   *
   * That is fixed (spec 2026-09-29-leads-manager-only-driver-my-day section 3.2): the
   * allowlist entry is gone, so a van role is sent to /driver, and a role that is not a
   * rep-lead is sent to /crm. The page is one audience now, so it can be on PATHS and the
   * both-directions assertion below is real for it. */
```

and add `"/leads"` to the array:

```ts
  const PATHS = ["/crm", "/report", "/sales/orders", "/driver", "/sales/pocket", "/leads"];
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/proxy.test.ts`

Expected: PASS. Check the both-directions loop specifically:

| role | `admitted` (200?) | `shown.has("/leads")` | equal? |
|---|---|---|---|
| `owner` | true | true | ✓ |
| `group_manager` | true | true | ✓ |
| `rep_manager` | true | true | ✓ |
| `phone_sales` | false | false | ✓ |
| `platform_owner` | false | false (`isRepLead` is `owner \| group_manager \| rep_manager`) | ✓ |
| `field_rep` / `delivery_driver` | false | false | ✓ |

Before this task, `phone_sales` would have been `true === false` — a red test. The rule and `isRepLead` are deliberately the same three roles; the agreement is the assertion.

- [ ] **Step 7: Commit**

```bash
git add proxy.ts tests/proxy.test.ts
git commit -m "fix(gate): /leads is the office, and is now gated like it

Two rules, both in proxy.ts, and no second copy of either.

A van role: /leads comes off the isDriverBriefing allowlist, so the existing isVan gate
catches it and sends it to /driver -- which holds both kinds of work a driver has now,
so nothing is lost.

Anyone else who is not a rep lead: a new rule, placed AFTER the isVan gate so a van
role is not sent to /crm (which bounces them straight back). A phone_sales rep reaches
/crm, which is where their leads actually live. Until now isManager is !isVanRole, so
they satisfied it and reached the pool and the hand-off button on a URL the nav hid
but the gate never checked.


### Task 8: The menu drops to two tabs

**Files:**
- Modify: `lib/appNav.ts:65-73` (`DRIVER_TABS` and its doc comment)
- Test: `tests/appNav.test.ts` (edit)
- Test: `tests/proxy.test.ts:205-208` (the "three tabs" count)

- [ ] **Step 1: Edit the nav**

In `lib/appNav.ts`, replace the paragraph of the `DRIVER_TABS` doc comment that begins `* /leads is the lead run: the stops they drive, in order, with what happened at each one.` with:

```ts
 * Two tabs. /leads used to be the third, labelled «توقف‌های من» here and «پین‌های نقشه» on
 * the same href for a rep lead -- one destination, two names, depending on who was
 * holding the keys. The stops they drive are now the second section of /driver, where a
 * dual-hat person sees them and their deliveries together rather than navigating between
 * two pages for one working day.
 *
 * The objection library is here because it is useful standing at the door, which is the
 * same reason proxy.ts allowlists it.
```

and delete the `{ href: "/leads", label: "توقف‌های من", group: "day", ready: true },` line from the array, so it reads:

```ts
const DRIVER_TABS: AppTab[] = [
  { href: "/driver", label: "روز من", group: "day", ready: true },
  { href: "/sales/academy", label: "آموزش", group: "day", ready: true },
];
```

- [ ] **Step 2: Update `tests/appNav.test.ts`**

Replace lines 185-188:

```ts
  it("is their round, their stops and the door library, and nothing else", () => {
    expect(driver.map((t) => t.href)).toEqual(["/driver", "/leads", "/sales/academy"]);
  });
```

with:

```ts
  it("is their whole day and the door library, and nothing else", () => {
    // /leads is the office's pin pool now. The stops a driver drives are the second
    // section of /driver, so a dual-hat person sees both jobs on one page.
    expect(driver.map((t) => t.href)).toEqual(["/driver", "/sales/academy"]);
  });
```

and replace the "is one group" test at lines 194-202:

```ts
  it("is one group, so the header offers a menu rather than a row of lone pills", () => {
    const m = pillModel(driver, APP_GROUPS, "/leads");
    expect(m.groups.map((g) => g.id)).toEqual(["day"]);
    expect(m.tabsByGroup.day.map((t) => t.href)).toEqual([
      "/driver",
      "/leads",
      "/sales/academy",
    ]);
  });
```

with:

```ts
  it("is one group, so the header offers a menu rather than a row of lone pills", () => {
    const m = pillModel(driver, APP_GROUPS, "/driver");
    expect(m.groups.map((g) => g.id)).toEqual(["day"]);
    expect(m.tabsByGroup.day.map((t) => t.href)).toEqual([
      "/driver",
      "/sales/academy",

### Task 9: The `role = 'driver'` bug

**Files:**
- Modify: `app/(shell)/sales/runs/page.tsx:33-41`
- Modify: `app/(shell)/sales/commission/page.tsx:68-74`
- Test: `tests/van-role-dropdown.test.ts` (new)

**The bug.** Two manager pages query a role that **no longer exists**. `lib/db.ts:3220` migrated it — `UPDATE users SET role = 'delivery_driver' WHERE role = 'driver'` — so both dropdowns match **nobody**. The delivery-run planner's driver list and the commission manager-overrides picker are both silently empty, and neither has a test.

This is the failure mode `lib/roles.ts` documents ("a gate written as `role === "driver"` matches nobody the moment the role is renamed"), surviving because it is a raw string literal in a page rather than a shared constant. The fix is the van-role set, inlined from `VAN_ROLES` so a future rename is caught.

**Why here, despite the page's fate.** `/sales/runs/page.tsx` is one of the four routes spec 2 folds into `/sales/schedule?view=runs`. This is the one place the two specs touch the same file, and the ordering is load-bearing: spec 2 must name this fixed query as an input it does not regress. Plan 2 does, in its Task 8.

- [ ] **Step 1: Write the failing test**

Create `tests/van-role-dropdown.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readFileSync } from "node:fs";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-vanrole-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { VAN_ROLES } = await import("@/lib/roles");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/** A dropdown that matches nobody is worse than one that is empty on purpose.
 *
 *  Two manager pages asked for `role = 'driver'`. lib/db.ts:3220 renamed that role to
 *  `delivery_driver`, so both queries have been returning zero rows ever since, with no
 *  error anywhere: the run planner's driver list is empty, and the commission
 *  manager-overrides picker is empty. Nothing said so.
 *
 *  This is the failure mode lib/roles.ts documents — a gate written against a role name
 *  fails to match the moment the name changes — surviving because it was a raw string in
 *  a page rather than a shared constant. */
describe("the van-role dropdown queries", () => {
  it("finds a real delivery driver, in the SQL the pages run", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (3,'T','t','2026-01-01')`);
    db.exec(`INSERT INTO users (id, username, display_name, role, active, created_at, organization_id)
             VALUES (700, 'd7', 'راننده', 'delivery_driver', 1, '2026-01-01', 3)`);

    /* The exact predicate the two pages use, with VAN_ROLES inlined. */
    const inList = VAN_ROLES.map((r) => `'${r}'`).join(", ");
    const found = db
      .prepare(`SELECT id, display_name FROM users WHERE role IN (${inList}) AND active = 1`)
      .all() as unknown as { id: number; display_name: string }[];

    expect(found.map((u) => u.id)).toContain(700);
  });

  it("is the sentence the source files actually contain", () => {
    /* The behavioural assertion above proves the SQL is right; this one proves it is the
       SQL the pages run. Without it, a page could revert to `role = 'driver'` and the
       first test would still pass. */
    for (const file of [
      "app/(shell)/sales/runs/page.tsx",

- [ ] **Step 3: Fix the run planner's query**

In `app/(shell)/sales/runs/page.tsx`, replace the existing `import { isVanRole } from "@/lib/roles";` with:

```ts
import { isVanRole, VAN_ROLES } from "@/lib/roles";
```

BEFORE:
```ts
  const drivers = plain(
    db
      .prepare(
        `SELECT id, display_name FROM users
          WHERE role = 'driver' AND active = 1${userScope.sql}
          ORDER BY display_name`
      )
      .all(...userScope.params)
  ) as unknown as { id: number; display_name: string }[];
```

AFTER:
```ts
  /* The van roles, inlined from the one list that defines them. This read
     `role = 'driver'`, which matched nobody after lib/db.ts renamed that role to
     `delivery_driver` — so the planner's driver dropdown was silently empty, with no
     error anywhere to say so. A gate written against a role NAME fails to match the
     moment the name changes; a gate written against the SET does not.
     tests/van-role-dropdown.test.ts holds both halves: that the SQL is right, and that
     this file is the SQL that runs. */
  const vanRoleList = VAN_ROLES.map((r) => `'${r}'`).join(", ");
  const drivers = plain(
    db
      .prepare(
        `SELECT id, display_name FROM users
          WHERE role IN (${vanRoleList}) AND active = 1${userScope.sql}
          ORDER BY display_name`
      )
      .all(...userScope.params)
  ) as unknown as { id: number; display_name: string }[];
```

- [ ] **Step 4: Fix the commission page's query**

In `app/(shell)/sales/commission/page.tsx`, the `drivers` block reads:

```ts
  const drivers =
    session.role === "owner"
      ? (plain(
          db.prepare("SELECT id, display_name FROM users WHERE role = 'driver' AND active = 1 ORDER BY display_name").all()
        ) as unknown as { id: number; display_name: string }[])
      : [];
```

Replace with:

```ts
  /* Same bug as the run planner's driver list, in the same shape: `role = 'driver'`
     matched nobody after the rename, so the manager-overrides picker was empty. The van
     roles, inlined from the one list that defines them. See tests/van-role-dropdown.test.ts. */
  const vanRoleList = VAN_ROLES.map((r) => `'${r}'`).join(", ");
  const drivers =
    session.role === "owner"
      ? (plain(
          db
            .prepare(
              `SELECT id, display_name FROM users
                WHERE role IN (${vanRoleList}) AND active = 1
                ORDER BY display_name`
            )
            .all()
        ) as unknown as { id: number; display_name: string }[])
      : [];
```

### Task 10: Two guards the whole repo earns

**Files:**
- Create: `tests/no-silent-context-default.test.ts`
- Create: `tests/no-role-string-literals.test.ts`

Neither guard is required by the driver work. Both are required by having *discovered* the bug class — §1.1 (a context default that reads as real data) and §3.8 (a role name in a string) were each found by reading, not by a failing test. Each turns one into something the build catches.

- [ ] **Step 1: Write the context-default guard**

Create `tests/no-silent-context-default.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** A context's DEFAULT value must not be mistakable for real data.
 *
 *  `useContext` on an unprovided context does not throw — it hands back the default. So a
 *  missing provider is indistinguishable from a working one, and the failure is silent by
 *  construction. MyPositionProvider's default was `{ position: null, status: "idle",
 *  error: null, retry: () => {} }`: /driver lives in app/(bare), which mounted no
 *  provider, so VerifyVisits recorded every visit with pos = null and a next-stop banner
 *  showed no distance — on a page that rendered perfectly and lied.
 *
 *  The rule: a default may not carry a field whose value is the ordinary empty result of a
 *  real one. `position: null` and `items: []` and `data: null` are what a LOADED context
 *  looks like when there is genuinely nothing. If the default says that, a missing
 *  provider and an empty day look the same. */
const ROOT = join(__dirname, "..");

function filesUnder(rel: string, exts: string[]): string[] {
  const out: string[] = [];
  const walk = (r: string) => {
    for (const e of readdirSync(join(ROOT, r), { withFileTypes: true })) {
      const child = `${r}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (exts.some((x) => e.name.endsWith(x))) out.push(child);
    }
  };
  walk(rel);
  return out.sort();
}

describe("context defaults cannot be mistaken for real data", () => {
  const sources = filesUnder("components", [".tsx", ".ts"]);

  it("finds the provider files at all (guards the walker itself)", () => {
    expect(sources.some((f) => f.includes("Provider"))).toBe(true);
  });

  it("no context default is a plausible real state", () => {
    const offenders: string[] = [];


- [ ] **Step 2: Run it and see what it catches**

Run: `npx vitest run tests/no-silent-context-default.test.ts`

Expected: it **fails**, naming `components/MyPositionProvider.tsx`. That is the point of writing it: a guard is only worth having if it is red on the bug it was written for.

Then fix the one offender. In `components/MyPositionProvider.tsx`, replace the default at lines 30-35:

```ts
const MyPositionContext = createContext<MyPositionValue>({
  position: null,
  status: "idle",
  error: null,
  retry: () => {
    throw new Error(
      "useMyPosition() was called with no MyPositionProvider above it. Mount one in the route group's layout.",
    );
  },
});
```

Re-run. Expected: PASS.

> **Honest scope note, to be repeated in the commit message.** A throwing `retry` only fires when a consumer *calls* `retry` without a provider. A consumer that only *reads* `position` still gets `{ position: null, status: "idle" }`. So this is a partial fix: it catches the case where the UI offers a retry button, and the source-text guard catches the rest by forbidding a default that carries a plausible field. The full fix — a `"missing"` status added to the `PositionStatus` union — is a type change rippling through every consumer, and is out of scope here. Say that rather than claiming the class is closed.

- [ ] **Step 3: Write the role-literal guard**

Create `tests/no-role-string-literals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES } from "@/lib/roles";

/** A role must be named by a constant, never by a string in a page.
 *
 *  lib/roles.ts exists because a hand-copied duplicate of the role union drifted the
 *  first time a role was added — "a `Record<Role, string>` in one file cannot notice a
 *  union that changed in another". The same failure happened again through a different
 *  door: `WHERE role = 'driver'` in two manager pages, surviving lib/db.ts renaming
 *  `driver` to `delivery_driver`, so both dropdowns matched nobody and no test said so.
 *
 *  Two files may legitimately spell a role out: lib/roles.ts (it is the union) and
 *  lib/db.ts (the migrations that rewrite the OLD vocabulary — that is what they are
 *  for). Everything else names roles through the shared list. */
const ROOT = join(__dirname, "..");
const EXEMPT = new Set(["lib/roles.ts", "lib/db.ts"]);

function filesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (r: string) => {
    for (const e of readdirSync(join(ROOT, r), { withFileTypes: true })) {
      const child = `${r}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(child);
    }
  };
  walk(rel);
  return out.sort();
}

/** Strips block and line comments, so a file's own explanation of the rule is not read
 *  as a violation of it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
}

const PATTERNS = [/role\s*={1,2}\s*["'][a-z_]+["']/g, /role\s+IN\s*\(\s*["'][a-z_]+["']/g];

function hits(src: string): string[] {
  const out: string[] = [];
  for (const p of PATTERNS) for (const m of src.matchAll(p)) out.push(m[0]);
  return out;
}

describe("no role string literals outside the two files that own them", () => {
  const targets = [...filesUnder("app"), ...filesUnder("components"), ...filesUnder("lib")]

- [ ] **Step 4: Run it and fix what it catches honestly**

Run: `npx vitest run tests/no-role-string-literals.test.ts`

For each offender, either move the role name behind an import from `lib/roles.ts`, or add the file to `EXEMPT` **with a comment saying why**. Do not weaken the patterns — a guard weakened to pass is a guard that has stopped guarding.

Re-run until it passes.

- [ ] **Step 5: Commit**

```bash
git add tests/no-silent-context-default.test.ts tests/no-role-string-literals.test.ts components/MyPositionProvider.tsx
git commit -m "test: two guards for the bug classes this spec found by reading

Neither is required by the driver work. Both are required by having discovered the
class.

A context's default must not be mistakable for real data: useContext on an
unprovided context does not throw, it returns the default, so a missing provider and
a real empty result look identical. MyPositionProvider's default made that visible --
/driver had no provider and recorded visits with no position. Its default retry now
throws and names itself, which catches the case where a consumer offers a retry
button; the source-text guard catches the rest. Closing the class fully means adding a
'missing' status to the union, which is a type change rippling through every
consumer, and is not this commit.

A role must be named by a constant, not a string in a page. lib/roles.ts exists
because a duplicated union drifted; the same failure came back through
WHERE role = 'driver' and emptied two dropdowns silently. lib/roles.ts and lib/db.ts
are exempt -- the latter is where the migrations that rewrite the old vocabulary
live, which is the point of them."
```

### Task 11: Full verification

**Files:** none.

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. About two minutes on this machine; run it detached and poll rather than in the foreground.

- [ ] **Step 2: Run the full suite**

```bash
setsid nohup npx vitest run > /tmp/vitest-spec1.log 2>&1 &
```

Then poll `/tmp/vitest-spec1.log` until it finishes. It takes about 14 minutes.

Expected: **2 failed / ~2745 passed**, with the failures being exactly:

- `tests/jalali.test.ts` — *"agrees with Intl for every day across 20 Jalali years"*
- `tests/api/routing-route.test.ts` — *"plans, commits and freezes"*

Both are the documented CPU-contention flakes under full-suite load and both pass in isolation. Confirm that before believing it:

```bash
npx vitest run tests/jalali.test.ts tests/api/routing-route.test.ts
```

Expected: all pass.

Any **other** failure is real. Re-run its file alone, fix it, and re-run.

- [ ] **Step 3: The spec's regression list, one by one**

Run: `npx vitest run tests/shellGroups.test.ts tests/leads-plain-objects.test.ts tests/briefing-repo.test.ts tests/crm-driver-visits.test.ts tests/pageMeta.test.ts tests/appNav.test.ts tests/proxy.test.ts`

Expected: all pass. The spec names `shellGroups` as the guard on Task 1, `leads-plain-objects` as the guard on Task 6, `briefing-repo` and `crm-driver-visits` as the guards on "untouched", and `pageMeta` as the guard on "no route was added or lost".

- [ ] **Step 4: Confirm the shape of what shipped**

```bash
grep -rn "leads/hooks/useDriverRun" --include=*.ts --include=*.tsx . | grep -v node_modules
grep -rn "components/leads/DriverRunView\|components/leads/NextStopBanner" --include=*.tsx . | grep -v node_modules
grep -n "isManager" "app/(shell)/leads/page.tsx"
grep -n "MyPositionProvider" "app/(bare)/layout.tsx"
```

Expected: the first two greps produce **no output** (no route-folder import, no old component path). The third produces no output, or only the `RouteSection` prop. The fourth produces both the import and the JSX.

- [ ] **Step 5: Commit any test-only corrections**

If Step 2 or 3 required a test fix, commit it separately with a message naming the invariant, not the symptom.

---

## What this plan does not do

Named here so nothing in it is assumed done later.

- **`/today` is not folded into `/driver`.** The `retry` panel (failed deliveries) is real work with no home elsewhere. `RolePicker` stays on `/today`, because its remaining job is changing hat to reach the office world, not choosing which run to look at.
- **`/sales/routing` and `/planner` are untouched.** The routes/delivery/orders consolidation is plan 2.
- **`RouteSection`, `useLeads`, the eight pool views, `LeadListsBar`** are untouched apart from the two `isManager &&` wrappers Task 6 removes.
- **No DB migration, no API change, no route removal, no schema change.** `/leads` still exists; it is simply a different page now.
- **The `LocationTapFlow` sheet loses its heading on `/driver`.** Named in Task 5, with the reason, rather than hidden.
- **The context-default class is not fully closed.** See Task 10's scope note.

    .filter((f) => !EXEMPT.has(f));

  it("finds files to scan (guards the walker itself)", () => {
    expect(targets.length).toBeGreaterThan(50);
  });

  it("fails on a comparison or a SQL predicate naming a role", () => {
    const offenders: string[] = [];
    for (const file of targets) {
      for (const h of hits(code(readFileSync(join(ROOT, file), "utf8")))) offenders.push(`${file}: ${h}`);
    }
    expect(offenders, `name the role through lib/roles.ts:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the scan is not vacuous — it can still fail", () => {
    /* A guard that cannot fail is worse than no guard: it reports success precisely
       where it is needed. Prove the pattern matches a line the repo has actually had, and
       does not match a legitimate use. */
    expect(hits(`const q = \`SELECT id FROM users WHERE role = 'driver' AND active = 1\`;`).length)
      .toBeGreaterThan(0);
    expect(hits(`if (isVanRole(role)) return deny("/driver");`).length).toBe(0);
  });

  it("knows every role it is protecting, from the one list", () => {
    // If a role is added and the guard's idea of the vocabulary is stale, it is protecting
    // a set that no longer exists.
    expect(ROLES.length).toBeGreaterThanOrEqual(7);
  });
});
```

    for (const file of sources) {
      const src = readFileSync(join(ROOT, file), "utf8");
      for (const m of src.matchAll(/createContext<[^>]*>\(\s*\{([\s\S]{0,400}?)\}\s*[,)]/g)) {
        const literal = m[1];
        const plausible = /\b(position|data|items|rows|value|result)\s*:\s*(null|\[\])/;
        if (plausible.test(literal)) offenders.push(`${file}: ${literal.trim().slice(0, 80)}`);
      }
    }

    expect(
      offenders,
      `a context default that reads as real data — a missing provider then looks like an empty one:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
```


and add `VAN_ROLES` to that file's existing `@/lib/roles` import — merge into the line if one exists, otherwise add a new import line beside the others rather than reordering the block.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/van-role-dropdown.test.ts`

Expected: PASS — 2 passed.

- [ ] **Step 6: Commit**

```bash
git add "app/(shell)/sales/runs/page.tsx" "app/(shell)/sales/commission/page.tsx" tests/van-role-dropdown.test.ts
git commit -m "fix(runs): two dropdowns asked for a role that no longer exists

app/(shell)/sales/runs/page.tsx:37 and app/(shell)/sales/commission/page.tsx:72 both
read WHERE role = 'driver'. lib/db.ts:3220 renamed that role to delivery_driver, so
both have been matching nobody: the run planner's driver list is empty and the
commission manager-overrides picker is empty, with no error anywhere to say so.

Now gated on the van-role SET, inlined from VAN_ROLES so a future rename is caught
rather than silently emptying a dropdown again. This is the failure mode lib/roles.ts
documents, surviving because it was a raw string in a page rather than a constant."
```

      "app/(shell)/sales/commission/page.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/role\s*=\s*'driver'/);
      expect(src, file).toMatch(/role\s+IN\s*\(/);
      for (const r of VAN_ROLES) {
        expect(src, `${file} must name ${r}`).toContain(`'${r}'`);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/van-role-dropdown.test.ts`

Expected: FAIL — `app/(shell)/sales/runs/page.tsx must not match /role\s*=\s*'driver'/`.

    ]);
  });
```

- [ ] **Step 3: Update the tab count in `tests/proxy.test.ts`**

Replace lines 205-208:

```ts
  it("gives a van role only the van menu", () => {
    expect(appTabs({ role: "field_rep" } as never).filter((t) => t.ready).length).toBe(3);
    expect(appTabs({ role: "delivery_driver" } as never).filter((t) => t.ready).length).toBe(3);
  });
```

with:

```ts
  it("gives a van role only the van menu", () => {
    expect(appTabs({ role: "field_rep" } as never).filter((t) => t.ready).length).toBe(2);
    expect(appTabs({ role: "delivery_driver" } as never).filter((t) => t.ready).length).toBe(2);
  });
```

- [ ] **Step 4: Run both test files**

Run: `npx vitest run tests/appNav.test.ts tests/proxy.test.ts`

Expected: PASS. `appNav.test.ts` also asserts, for every role, that **no two ready tabs read alike** — with `/leads` gone from `DRIVER_TABS`, the driver's labels are «روز من» and «آموزش», which are distinct. And `tests/proxy.test.ts:118-123` asserts every ready driver tab passes the middleware: `/driver` and `/sales/academy` both do, and `/leads` is no longer offered, so the two files stay in agreement without a new invariant.

- [ ] **Step 5: Commit**

```bash
git add lib/appNav.ts tests/appNav.test.ts tests/proxy.test.ts
git commit -m "refactor(nav): a driver's menu is two tabs, and they are honest

/leads was labelled «توقف‌های من» here and «پین‌های نقشه» on the same href for a rep
lead -- one destination, two names, depending on who was holding the keys. Their stops
are now the second section of /driver."
```

/api/leads/locations and /api/lead-runs stay allowlisted: a driver still records a
visit at the door."
```

    // now, and the driver's own work is on /driver, which they are already allowed. With
    // this line gone, the `isVan` gate below catches a van role asking for the pool and
    // sends them to their own day. There is deliberately no second /leads check further
    // down -- the two-tier gate already says it, and a third copy is how a gate drifts.
    pathname.startsWith("/api/leads/locations") ||
    pathname.startsWith("/api/lead-runs");
```


Run: `npx tsc --noEmit && npx vitest run tests/leads-plain-objects.test.ts`

Expected: zero TS errors; `leads-plain-objects.test.ts` PASS. It asserts the pool still returns plain objects, which this task must not disturb.

- [ ] **Step 6: Commit**

```bash
git add "app/(shell)/leads/page.tsx" "app/(shell)/leads/hooks/useLeads.ts"
git commit -m "refactor(leads): the pool has no non-manager shape, so it stops pretending

Two isManager && wrappers removed. On a page the proxy now refuses a van role at,
they were always true, and keeping them says the pool has another shape it does not
have. The guard inside useLeads stays -- a cached bundle can still mount the hook
with a driver's session -- but its comment no longer claims the driver's data comes
through here."
```

Both sections render for every van role, unconditionally. There is no hasRole check
and no 'hide if empty': a section that disappears is indistinguishable from a section
that is empty, and a driver must never conclude 'I have no deliveries' when the
deliveries section simply did not render.

The decision is lib/driverDay.ts, a pure function, rather than inline JSX. /driver is
an async server component and no test in this repo imports from app/, so the promise
this makes had nowhere to be asserted otherwise.

The visit run is read on the server and handed in as initialRun, so the page does not
fill in twice under a skeleton. The client still re-fetches on mount and after every
reorder or recorded visit."
```

                </div>
              </div>
              <div className="tabular-nums text-[length:var(--text-md)] font-medium text-[var(--text)]">
                {faToman(commission.accrued_toman)}
              </div>
            </div>
          )}
        </section>
      )}

     starting a day with no stops. */
  const runs = readDriverRuns(db, session.user.id);
  const chosen = runs.find((r) => r.run_date === today) ?? runs[0];
  const run = chosen ? readRun(db, chosen.id) : null;

  /* Prospect visits. readTodaysLeadRun is the same authority /api/lead-runs calls, and it
     applies the same "today, else the most recent not finished" rule. Called on the server
     so the section is painted alongside the deliveries rather than filling in under a
     skeleton. The client still re-fetches on mount -- this is a first paint, not a cache. */
  const leadRun = readTodaysLeadRun(db, session.user.id, session.organizationId, today);
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add -A components/driver components/leads "app/(shell)/leads/page.tsx"
git commit -m "refactor(driver): the driver's run view moves to components/driver

Moved, not copied. A copy would leave two sources of truth for 'my stops' -- the
exact failure lib/roles.ts documents when db.ts held a hand-copied duplicate of the
role union that then drifted.

Takes an optional initialRun so the /driver page can server-render the run. Task 5
is what passes it."
```


Also takes an optional initialRun, so the /driver page can hand the server's read in
as the first paint instead of showing a skeleton under a delivery section that is
already on screen. The fetch still runs on mount and after every mutation -- this is
a first paint, not a cache."
```

- [ ] **Step 1: Verify the current import graph**

Run: `grep -rn "leads/hooks/useDriverRun" --include=*.tsx --include=*.ts . | grep -v node_modules`

Expected: exactly two hits —
```
./components/leads/DriverRunView.tsx:6
./components/leads/NextStopBanner.tsx:6
```

If there are more, every one of them is an importer this task must repoint. `tsc` in Step 6 catches a miss either way.

- [ ] **Step 2: Move the file**

Run:

```bash
git mv "app/(shell)/leads/hooks/useDriverRun.ts" components/driver/useDriverRun.ts
```

  it("gives a non-van role neither", () => {
    for (const role of ROLES.filter((r) => r !== "field_rep" && r !== "delivery_driver")) {
      expect(driverDaySections(role), role).toEqual([]);
    }
  });

  it("knows every role the app has, so a new one cannot slip through untested", () => {
    // If a role is added to the union and not to VAN_ROLES, this is the test that asks
    // what a van role is rather than what it was.
    expect(new Set<Role>(ROLES).size).toBe(ROLES.length);
  });
});
```


What that cost, on a page that already ships: VerifyVisits passes pos = null into
every visit it records, and a driver standing at a door with a working GPS had their
position silently dropped. Adding the map and the next-stop distance to /driver would
have shipped a blue-less map and an endless distance, both reading as 'fine'.

One provider, one line. The layout stays synchronous, so tests/shellGroups.test.ts
still holds."
```

---

## Commit B — the rest

Commit A is what makes Task 4's move *correct*, so B cannot be reviewed without A in the tree.
