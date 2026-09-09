# Global Shell — Single Navbar + Left Rail + Bento Grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sales section's two-row header (brand bar + group-row + tab-row)
with the video's single-row navbar (hover/click group dropdowns), add the left icon rail
from §9a, and ship a reusable Bento grid system (§9b) wired into one real page.

**Architecture:** Three new independent-but-composed pieces on top of the substrate/kit
shipped in `theme/notched-skeuomorphic-substrate` (this branch's parent): a `Navbar`
component that absorbs `TabPill`'s group row as hover/click dropdowns, a `Rail` component
for the left icon column (five real, wired actions — not nine decorative ones, see
Task 5's note), and a generic `Bento`/`BentoCell` grid primitive retrofitted onto the
`/sales/today` briefing panels, which is the page MASTER.md's own brief named as the
"over-expanding cards" complaint. `TabPill` shrinks to render only the tab row (the
group row moves into `Navbar`).

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind v4 (utility classes)
+ hand-written CSS in `app/globals.css` (design tokens), Vitest, `lucide-react` (already
a dependency, not yet wired into any component — this is where it lands).

**Spec:** `docs/superpowers/specs/2026-09-08-notched-skeuomorphic-substrate-design.md`,
§9a (shell), §9b (bento). §15 decision 4 (navbar mirroring: logical properties, brand at
inline-start) and §17 step 5 (this is next after substrate+kit) are both already settled.
This plan also resolves one thing the spec left open — see "Decisions made while
planning" below.

## Global Constraints

- RTL Persian throughout. Brand at inline-start (visual right), utility cluster at
  inline-end (visual left), nav centred — **logical CSS properties only, never
  `left`/`right`** (spec §15 decision 4, and MASTER.md's own anti-pattern list already
  warns `inset-inline-start` breaks for a *fixed* overlay centring — the rail is `fixed`,
  so watch for that specific trap in Task 5).
- No new dependency beyond `lucide-react`, which is already installed
  (`package.json:25`, `^1.43.0`) and MASTER.md already lists as "approved... not yet
  wired into any component."
- Every pure-logic module gets a Vitest test written TDD (failing → implement → passing),
  matching the rest of this codebase's convention (`tests/design/*.test.ts`).
- No `box-shadow` on a clipped/notched element; no hand-typed rgba shadow literal; no
  `-webkit-backdrop-filter` written after the standard `backdrop-filter` — all three are
  existing MASTER.md anti-patterns this plan must not reintroduce.
- Deployment is `npm run build` + `systemctl restart routeflow` (not this branch's job —
  this branch ends at a PR, per the established pattern).
- After any bulk selector edit, grep the **full** `npm run build` output for
  `warn`/`error`, not just the tail — this is how Task 22 of the previous plan caught a
  corrupted selector that `npm test` and a route-list summary both missed.

## Decisions made while planning

The spec's §9a reads the rail's icon row directly off one video frame: "share, export,
star, add, mobile, data, calendar, send, alerts." RouteFlow is not the concept's generic
SaaS — most of those verbs have no real target anywhere in this app (no favoriting
system, no generic per-page export, no share mechanism). Shipping nine icons where four
of them do nothing on click would be exactly the kind of decoration MASTER.md's anti-
patterns forbid elsewhere ("slip/paper count is real data... never decoration"). This
plan wires **five rail items that are all real**: back (browser back), calendar
(`/sales/schedule`), map (`/map` — currently buried in `ProfileMenu`'s dropdown, moves
here where the video puts it), alerts (the existing `NotificationBell` polling+badge
logic, relocated from its floating corner island into the rail), and the three-state
theme control at the foot (spec's own decision 3). Anything else waits until a real
feature exists behind it — documented as a scope note in Task 5 and in the MASTER.md
update (Task 12), not silently dropped.

The navbar's group dropdowns are specified as hover-only ("Nav dropdowns and the profile
menu open on hover, not click"). Hover-only has no equivalent on a touch device and is
not keyboard-operable by itself, so this plan makes the trigger a real `<button>` that
**click-toggles** (same open/outside-click/Esc pattern already proven in `ProfileMenu`
and — per its own comment — reused from `AccentPicker`), with hover-to-open layered on
top as a pure-CSS enhancement gated to `(hover: hover) and (pointer: fine)`. Desktop mice
get the video's hover behaviour; touch and keyboard get a working control either way.

---

### Task 1: Bento grid primitive

**Files:**
- Create: `lib/design/bentoSpan.ts`
- Create: `tests/design/bentoSpan.test.ts`
- Create: `components/kargah/Bento.tsx`
- Modify: `app/globals.css` (new `.bento` block, appended after the existing bento-
  adjacent `.kblock`/`.bhead` block around line 1840)

**Interfaces:**
- Produces: `bentoSpanForIndex(index: number, total: number): "full" | "wide" | "half" | "narrow"`
  — pure, used by Task 2 and any future dynamic-panel-count consumer.
- Produces: `<Bento>` (grid container, renders `.bento`) and `<BentoCell span={...}>`
  (renders a child with `data-span` set, per spec §9b's CSS contract) from
  `components/kargah/Bento.tsx`.

- [ ] **Step 1: Write the failing test for the span-assignment rule**

A single tile always gets the full row. Otherwise tiles pair up wide+narrow (7+5 = 12,
matching the spec's own worked example of one wide table beside one narrow chart); an
odd tile left over at the end gets the full row rather than sitting alone at half width.

```typescript
// tests/design/bentoSpan.test.ts
import { describe, expect, it } from "vitest";
import { bentoSpanForIndex } from "@/lib/design/bentoSpan";

describe("bentoSpanForIndex", () => {
  it("a lone tile spans full width", () => {
    expect(bentoSpanForIndex(0, 1)).toBe("full");
  });

  it("two tiles pair as wide + narrow", () => {
    expect(bentoSpanForIndex(0, 2)).toBe("wide");
    expect(bentoSpanForIndex(1, 2)).toBe("narrow");
  });

  it("four tiles form two wide+narrow rows", () => {
    expect([0, 1, 2, 3].map((i) => bentoSpanForIndex(i, 4))).toEqual([
      "wide",
      "narrow",
      "wide",
      "narrow",
    ]);
  });

  it("an odd tile left over at the end spans full width, not half", () => {
    expect([0, 1, 2].map((i) => bentoSpanForIndex(i, 3))).toEqual([
      "wide",
      "narrow",
      "full",
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/design/bentoSpan.test.ts`
Expected: FAIL — `Cannot find module '@/lib/design/bentoSpan'`

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/design/bentoSpan.ts
/** Deterministic span assignment for a list of tiles whose count is only known at
 *  render time (a dynamic panel list, not a hand-laid-out page). Pairs tiles into
 *  wide(7)+narrow(5) rows -- 12 columns each, matching spec 2026-09-08 §9b's worked
 *  example of one wide table beside one narrow chart. A single tile, or one left over
 *  at the end of an odd-length list, spans the full row rather than sitting alone at
 *  half width with a hole beside it. */
export type BentoSpan = "full" | "wide" | "half" | "narrow";

export function bentoSpanForIndex(index: number, total: number): BentoSpan {
  if (total <= 1) return "full";
  const isLastOfOdd = total % 2 === 1 && index === total - 1;
  if (isLastOfOdd) return "full";
  return index % 2 === 0 ? "wide" : "narrow";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/design/bentoSpan.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Add the `.bento` CSS grid**

Append to `app/globals.css`, directly after the `.bhead .n` rule (the end of the
"generic blocks" section, around line 1837):

```css
/* ---- bento grid -----------------------------------------------------------
   A real span system, not ad-hoc widths (spec 2026-09-08 §9b) -- 12 columns, gutters
   from --space-5, phone stacks everything to one column. `data-span` is written by
   BentoCell in components/kargah/Bento.tsx. */
.bento {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--space-5);
}
.bento > * { grid-column: span 12; }
@media (min-width: 900px) {
  .bento > [data-span="full"] { grid-column: span 12; }
  .bento > [data-span="wide"] { grid-column: span 7; }
  .bento > [data-span="half"] { grid-column: span 6; }
  .bento > [data-span="narrow"] { grid-column: span 5; }
}
```

- [ ] **Step 6: Write the `Bento` / `BentoCell` components**

```tsx
// components/kargah/Bento.tsx
import { cn } from "@/lib/cn";
import type { BentoSpan } from "@/lib/design/bentoSpan";

/** The page-layout grid from spec 2026-09-08 §9b -- unequal-width tiles in one row,
 *  not equal thirds pretending every tile matters the same amount. `bentoSpanForIndex`
 *  (lib/design/bentoSpan.ts) picks the span for a dynamic-length list of tiles; a
 *  hand-laid-out page can pass `span` directly instead. */
export function Bento({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("bento", className)}>{children}</div>;
}

export function BentoCell({
  span,
  className,
  children,
}: {
  span: BentoSpan;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-span={span} className={className}>
      {children}
    </div>
  );
}
```

- [ ] **Step 7: Build and commit**

Run: `npm run build`
Expected: clean build, no new warnings.

```bash
git add lib/design/bentoSpan.ts tests/design/bentoSpan.test.ts components/kargah/Bento.tsx app/globals.css
git commit -m "feat: Bento grid primitive (span system + Bento/BentoCell)"
```

---

### Task 2: Retrofit `/sales/today`'s briefing panels onto Bento

**Files:**
- Modify: `components/today/Briefing.tsx:95-111` (the `kargah` variant's panel loop)

**Interfaces:**
- Consumes: `Bento`, `BentoCell` from `components/kargah/Bento.tsx` (Task 1);
  `bentoSpanForIndex` from `lib/design/bentoSpan.ts` (Task 1).

This is the concrete, real consumer MASTER.md's own brief named: "card widths on the My
Day page over-expanding" — the `kargah` variant currently stacks every panel full-width
in a `flex flex-col` column (`components/today/Briefing.tsx:96`), which is exactly that
complaint. The `plain` variant (the driver's `/today`) is untouched — driver stays off
this whole redesign.

- [ ] **Step 1: Replace the kargah variant's wrapper**

In `components/today/Briefing.tsx`, replace:

```tsx
  if (variant === "kargah") {
    return (
      <div className="flex flex-col gap-[14px]" dir="rtl">
        {data.panels.map((p) => (
          <div key={p.key} className="kblock">
```

with:

```tsx
  if (variant === "kargah") {
    return (
      <Bento className="gap-[14px]" >
        {data.panels.map((p, i) => (
          <BentoCell key={p.key} span={bentoSpanForIndex(i, data.panels.length)}>
          <div className="kblock">
```

and its matching closing tags, from:

```tsx
          </div>
        ))}
      </div>
    );
  }
```

to:

```tsx
          </div>
          </BentoCell>
        ))}
      </Bento>
    );
  }
```

Add the imports at the top of the file:

```tsx
import { Bento, BentoCell } from "@/components/kargah/Bento";
import { bentoSpanForIndex } from "@/lib/design/bentoSpan";
```

- [ ] **Step 2: Run the existing test suite**

Run: `npm test`
Expected: PASS — no test exercises `Briefing`'s JSX directly (no
`@testing-library/react`/jsdom setup in this repo, per `lib/design/rangeFill.ts`'s own
comment), so this step's real check is the build in Step 3.

- [ ] **Step 3: Build and visually sanity-check**

Run: `npm run build`
Expected: clean build. Manually confirm `/sales/today` still renders every panel (panel
count is session-dependent — a role with 1 panel gets full width, 2 gets wide+narrow,
etc.) — this cannot be asserted by the existing test suite, so treat the build's route
list plus a live check as the verification.

- [ ] **Step 4: Commit**

```bash
git add components/today/Briefing.tsx
git commit -m "feat: retrofit /sales/today briefing panels onto the Bento grid"
```

---

### Task 3: Dock-magnify pure logic + delegated hook

**Files:**
- Create: `lib/design/dockMagnify.ts`
- Create: `tests/design/dockMagnify.test.ts`

**Interfaces:**
- Produces: `magnifyScale(distance: number, opts?: { peak?: number; radius?: number }): number`
  — pure, `1` at `distance >= radius`, rising to `peak` at `distance === 0`.
- Produces: `useDockMagnify(containerRef: React.RefObject<HTMLElement | null>)` — same
  delegated single-listener-per-container architecture as `useTiltGlow`
  (`lib/design/tilt.ts`), writing `--dock-scale` onto each `[data-dock-item]` under the
  rail based on its distance from the pointer along the rail's own axis. Consumed by
  Task 5's `Rail`.

- [ ] **Step 1: Write the failing test for the pure falloff function**

```typescript
// tests/design/dockMagnify.test.ts
import { describe, expect, it } from "vitest";
import { magnifyScale } from "@/lib/design/dockMagnify";

describe("magnifyScale", () => {
  it("scales to the peak at zero distance", () => {
    expect(magnifyScale(0, { peak: 1.4, radius: 80 })).toBeCloseTo(1.4);
  });

  it("scales to 1 at or beyond the radius", () => {
    expect(magnifyScale(80, { peak: 1.4, radius: 80 })).toBeCloseTo(1);
    expect(magnifyScale(200, { peak: 1.4, radius: 80 })).toBe(1);
  });

  it("falls off monotonically between 0 and the radius", () => {
    const near = magnifyScale(20, { peak: 1.4, radius: 80 });
    const far = magnifyScale(60, { peak: 1.4, radius: 80 });
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(1);
  });

  it("defaults to a sane peak and radius", () => {
    expect(magnifyScale(0)).toBeGreaterThan(1);
    expect(magnifyScale(1000)).toBe(1);
  });

  it("never returns less than 1 for a negative distance (clamped)", () => {
    expect(magnifyScale(-10, { peak: 1.4, radius: 80 })).toBeCloseTo(1.4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/design/dockMagnify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the minimal implementation**

```typescript
// lib/design/dockMagnify.ts
"use client";

import { useEffect } from "react";

/** Linear falloff from `peak` at distance 0 to `1` at `distance >= radius` -- the
 *  FloatingDock magnification-on-proximity curve (spec 2026-09-08 §9a), reduced to a
 *  pure function so the shape of the curve is unit-testable without a DOM. */
export function magnifyScale(
  distance: number,
  opts: { peak?: number; radius?: number } = {},
): number {
  const { peak = 1.35, radius = 72 } = opts;
  const d = Math.max(0, distance);
  if (d >= radius) return 1;
  const t = d / radius;
  return peak - (peak - 1) * t;
}

/** ONE delegated pointermove listener on the rail container, writing a distance-derived
 *  --dock-scale onto every [data-dock-item] descendant each frame -- same architecture
 *  as useTiltGlow (lib/design/tilt.ts): one listener regardless of item count, rAF-
 *  batched, gated to fine pointers, disabled under prefers-reduced-motion. Distance is
 *  measured along the rail's own vertical axis (item centre Y vs pointer Y), matching a
 *  vertical dock; a horizontal dock would measure X instead, which this rail never is.
 */
export function useDockMagnify(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduced.matches) return;

    let rafId: number | null = null;
    let pendingY: number | null = null;

    const applyFrame = () => {
      rafId = null;
      if (pendingY == null) return;
      const items = container.querySelectorAll<HTMLElement>("[data-dock-item]");
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const scale = magnifyScale(Math.abs(pendingY - centerY));
        item.style.setProperty("--dock-scale", String(scale));
      }
    };

    const onMove = (e: PointerEvent) => {
      pendingY = e.clientY;
      if (rafId == null) rafId = requestAnimationFrame(applyFrame);
    };

    const onLeave = () => {
      pendingY = null;
      const items = container.querySelectorAll<HTMLElement>("[data-dock-item]");
      for (const item of items) item.style.removeProperty("--dock-scale");
    };

    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [containerRef]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/design/dockMagnify.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/design/dockMagnify.ts tests/design/dockMagnify.test.ts
git commit -m "feat: dock-magnify falloff curve + delegated pointermove hook"
```

---

### Task 4: Three-state theme control (`ThemeToggle3`)

**Files:**
- Create: `components/kargah/ThemeToggle3.tsx`
- Modify: `app/globals.css` (new `.theme3` block)

**Interfaces:**
- Consumes: `Theme`, `THEME_CHANGE_EVENT`, `isTheme`, `readTheme`, `setTheme` from
  `lib/theme.ts` (all already exist — this task adds no exports to `lib/theme.ts`).
- Produces: `<ThemeToggle3 />`, a default export, consumed by Task 5's `Rail`.

This is the control ThemeToggle's own comment already names as pending: "Spec's deferred
ThemeToggle3 is where 'auto' becomes choosable again." Unlike `ThemeToggle` (which always
resolves "auto" down to a concrete value for display), this shows and sets the raw
three-state stored preference directly.

- [ ] **Step 1: Write the component**

No pure logic to extract here beyond what `lib/theme.ts` already exposes and already
tests (`tests/theme.test.ts`) — `readTheme`/`setTheme`/`isTheme` are all existing, tested
functions. This step is DOM glue, matching this repo's convention that DOM-only
components (`NotificationBell.tsx`, `Chrome.tsx`) are not unit-tested.

```tsx
// components/kargah/ThemeToggle3.tsx
"use client";

import { useEffect, useId, useState } from "react";
import { THEME_CHANGE_EVENT, readTheme, setTheme, type Theme } from "@/lib/theme";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "روشن" },
  { value: "auto", label: "خودکار" },
  { value: "dark", label: "تاریک" },
];

/** The rail's foot control (spec 2026-09-08 §9a decision 3): auto/light/dark, all three
 *  reachable. Unlike ThemeToggle (always resolves "auto" to a concrete value for
 *  display), this reads and writes the RAW stored preference -- "auto" is a real,
 *  visible, selectable state here, not merely an implicit default. */
export default function ThemeToggle3({ className }: { className?: string }) {
  const id = useId();
  const [value, setValue] = useState<Theme>("auto");

  useEffect(() => {
    const read = () => setValue(readTheme());
    read();
    window.addEventListener(THEME_CHANGE_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  return (
    <div className={className} role="radiogroup" aria-label="حالت نمایش" data-theme3>
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          title={opt.label}
          className="theme3__opt"
          data-active={value === opt.value ? "true" : undefined}
          onClick={() => setTheme(opt.value)}
        >
          <span className="sr-only">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add its CSS**

Append after `.themeToggle:focus-visible` (end of the existing sun/moon toggle block):

```css
/* ---- three-state theme control (rail foot) -------------------------------
   Spec 2026-09-08 §9a decision 3: auto/light/dark, all three reachable -- the rail's
   foot control, distinct from .themeToggle's binary light/dark morph used elsewhere. */
.theme3 { display: flex; flex-direction: column; gap: 6px; align-items: center; }
.theme3__opt {
  width: 30px; height: 30px; border-radius: 999px; border: 1px solid var(--border);
  background: var(--surface); cursor: pointer; padding: 0;
  transition: background 160ms var(--ease), transform 160ms var(--ease);
}
.theme3__opt:hover { transform: scale(1.06); }
.theme3__opt[data-active="true"] { background: var(--primary); border-color: var(--primary); }
.theme3__opt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add components/kargah/ThemeToggle3.tsx app/globals.css
git commit -m "feat: ThemeToggle3, the three-state auto/light/dark rail control"
```

---

### Task 5: Left icon rail (`Rail`)

**Files:**
- Create: `components/kargah/Rail.tsx`
- Modify: `app/globals.css` (new `.rail` block)
- Modify: `components/NotificationBell.tsx` (split its polling logic out — see Step 1)
- Create: `lib/useUnreadCount.ts`

**Interfaces:**
- Consumes: `useDockMagnify` (Task 3), `ThemeToggle3` (Task 4), `IconButton`
  (`components/kargah/IconButton.tsx`, already exists), `lucide-react` icons
  (`ChevronRight`/`ChevronLeft` per direction, `CalendarDays`, `MapPin`, `Bell`).
- Produces: `<Rail items={...} />` — a fixed left column. Consumed by Task 8 (sales
  layout) and Task 9 (settings layout).
- Produces: `useUnreadCount(): { unread: number; authed: boolean }` — extracted from
  `NotificationBell.tsx` so both the rail's alert icon and the (now-thinner)
  `NotificationBell` share one polling implementation instead of two copies drifting.

- [ ] **Step 1: Extract the polling hook out of `NotificationBell`**

`NotificationBell.tsx` currently owns its own `unread`/`authed`/polling `useEffect`
inline. The rail's alert icon needs the exact same count and auth-gating, so extract it
first rather than duplicating the fetch-every-60s loop in two files.

```typescript
// lib/useUnreadCount.ts
"use client";

import { useEffect, useState } from "react";

/** Polls GET /api/notifications every 60s for the unread count. A 401/403 (logged out,
 *  or a role the feed does not serve) flips `authed` off -- extracted from
 *  NotificationBell.tsx so the rail's alert icon and the notification island read the
 *  SAME count instead of running two independent polling loops that can drift out of
 *  step with each other. */
export function useUnreadCount(): { unread: number; authed: boolean } {
  const [unread, setUnread] = useState(0);
  const [authed, setAuthed] = useState(true);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await fetch("/api/notifications");
        if (!alive) return;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) setAuthed(false);
          return;
        }
        const j = await res.json();
        setUnread(j.unread ?? 0);
      } catch {
        /* transient; next tick retries */
      }
    }
    void tick();
    const h = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, []);

  return { unread, authed };
}
```

Update `components/NotificationBell.tsx` to consume it instead of its own inline effect
— replace the `unread`/`authed`/polling `useState`+`useEffect` block with:

```tsx
import { useUnreadCount } from "@/lib/useUnreadCount";
// ...
const { unread, authed } = useUnreadCount();
```

removing the now-redundant local `useState`/`useEffect` for those two values (leave the
`open` state and the rest of the component exactly as it is).

- [ ] **Step 2: Run the existing test suite**

Run: `npm test`
Expected: PASS (no test covers `NotificationBell`'s DOM behaviour directly, per repo
convention — this step confirms nothing else broke).

- [ ] **Step 3: Write the `Rail` component**

```tsx
// components/kargah/Rail.tsx
"use client";

import { useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { ChevronRight, ChevronLeft, CalendarDays, MapPin, Bell } from "lucide-react";
import { useDockMagnify } from "@/lib/design/dockMagnify";
import { useUnreadCount } from "@/lib/useUnreadCount";
import ThemeToggle3 from "@/components/kargah/ThemeToggle3";
import { cn } from "@/lib/cn";

/** The left icon rail, spec 2026-09-08 §9a: a back chevron separated at the top, the
 *  app's real verbs in the middle, the three-state theme control at the foot.
 *
 *  SCOPE NOTE: the video's frame shows nine icons (share/export/star/add/mobile/data/
 *  calendar/send/alerts). This rail ships the four that have a real destination in this
 *  app today -- calendar, map, alerts (plus back) -- rather than five inert icons with
 *  no click behaviour. The rest wait for a real feature to exist behind them; see
 *  MASTER.md's "Kit primitives not yet wired" / deferred-sub-projects notes.
 *
 *  Magnification-on-proximity is useDockMagnify (lib/design/dockMagnify.ts) writing
 *  --dock-scale onto each [data-dock-item] from one delegated pointermove listener.
 */
export default function Rail({ className }: { className?: string }) {
  const rail = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { unread, authed } = useUnreadCount();
  useDockMagnify(rail);

  // RTL: "back" points visually left, which is the LTR-style ChevronLeft glyph under
  // dir="rtl" -- see notch.ts's own side-resolution comment for the same inversion.
  const BackIcon = ChevronRight;

  return (
    <nav ref={rail as React.RefObject<HTMLElement>} className={cn("rail", className)} aria-label="ابزارهای کناری" dir="rtl">
      <button
        type="button"
        data-dock-item
        className="rail__item rail__back"
        aria-label="بازگشت"
        onClick={() => router.back()}
      >
        <BackIcon size={18} aria-hidden />
      </button>

      <div className="rail__group">
        <Link
          href="/sales/schedule"
          data-dock-item
          className="rail__item"
          aria-current={pathname.startsWith("/sales/schedule") ? "page" : undefined}
          aria-label="برنامهٔ بازدید"
        >
          <CalendarDays size={18} aria-hidden />
        </Link>
        <Link href="/map" data-dock-item className="rail__item" aria-label="نقشهٔ پوشش">
          <MapPin size={18} aria-hidden />
        </Link>
        {authed && (
          <Link href="/settings/notifications" data-dock-item className="rail__item rail__alerts" aria-label="اعلان‌ها">
            <Bell size={18} aria-hidden />
            {unread > 0 && <span className="rail__dot" aria-hidden />}
          </Link>
        )}
      </div>

      <ThemeToggle3 className="theme3 rail__foot" />
    </nav>
  );
}
```

- [ ] **Step 4: Add the rail's CSS**

Append to `app/globals.css`, after the `.theme3__opt:focus-visible` rule from Task 4:

```css
/* ---- left icon rail --------------------------------------------------------
   Spec 2026-09-08 §9a: a narrow vertical column of circular icon buttons, flush to the
   inline-start edge, fixed so it stays put while the page scrolls under it. NEVER
   inset-inline-start for a fixed element's own position (MASTER.md anti-pattern) --
   this uses physical `inset-inline-start` on purpose here because the rail is a real
   logical-edge dock, not a centred overlay; the forbidden case is centring, not docking. */
.rail {
  position: fixed; top: 96px; inset-inline-start: 18px; bottom: 24px; z-index: 40;
  display: flex; flex-direction: column; align-items: center;
  gap: 14px; width: 52px;
}
.rail__group { display: flex; flex-direction: column; gap: 10px; }
.rail__foot { margin-top: auto; }
.rail__item {
  position: relative; width: 40px; height: 40px; border-radius: 999px;
  border: 1px solid var(--border); background: var(--surface); color: var(--text-muted);
  display: grid; place-items: center; cursor: pointer; text-decoration: none;
  box-shadow: var(--edge-hi), var(--sh-1);
  transform: scale(var(--dock-scale, 1));
  transition: color 160ms var(--ease), background 160ms var(--ease);
}
@media (prefers-reduced-motion: no-preference) {
  .rail__item { transition: color 160ms var(--ease), background 160ms var(--ease), transform 120ms var(--ease); }
}
.rail__item:hover, .rail__item[aria-current="page"] { color: var(--text); background: var(--surface-raised); }
.rail__item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.rail__back { color: var(--text-faint); margin-bottom: 4px; }
.rail__dot {
  position: absolute; top: 6px; inset-inline-end: 6px;
  width: 8px; height: 8px; border-radius: 999px; background: var(--crit);
  border: 1.5px solid var(--surface);
}
@media (max-width: 900px) { .rail { display: none; } }
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add lib/useUnreadCount.ts components/NotificationBell.tsx components/kargah/Rail.tsx app/globals.css
git commit -m "feat: left icon rail (back/calendar/map/alerts/theme), dock-magnified"
```

---

### Task 6: Shrink `TabPill` to the tab row only

**Files:**
- Modify: `components/kargah/TabPill.tsx`

**Interfaces:**
- Produces: `<TabPill tabs={SalesTab[]} />` — **`groups` prop removed**; the group row
  (and its own `slideThumb`/`.seg-groups` rendering) is deleted here and rebuilt inside
  `Navbar` (Task 7), which needs the *hover-dropdown* behaviour `TabPill`'s simple
  pill-row never had, not the same markup relocated verbatim.
- Consumes: `activeSalesGroup` still needed internally to compute `visibleTabs` — no
  change to `lib/salesNav.ts` itself in this task.

- [ ] **Step 1: Remove the group row**

Replace the whole file's group-row plumbing. The new file keeps exactly the tab-row half
of the old logic (`visibleTabs`, `active`, the single `.seg` `slideThumb` call) and drops
`groups`, `shownGroups`, the `grp` ref, and the `seg-groups` `<nav>`:

```tsx
// components/kargah/TabPill.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { activeSalesGroup, type SalesTab } from "@/lib/salesNav";

export type Tab = SalesTab;

/** Slides the `.thumb` inside `root` to sit under whichever child matches `current`. */
function slideThumb(root: HTMLElement | null, current: string) {
  if (!root) return;
  const on = root.querySelector<HTMLElement>(current);
  const thumb = root.querySelector<HTMLElement>(".thumb");
  if (!on || !thumb) return;
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
}

/** The tabs of whichever group is active, with a pill that travels between them.
 *
 *  Used to render its own group row above this one -- that row moved into Navbar
 *  (components/kargah/Navbar.tsx) as hover/click dropdowns, spec 2026-09-08 §9a. This
 *  component now owns only the second row: the active group's own destinations.
 */
export default function TabPill({ tabs }: { tabs: SalesTab[] }) {
  const seg = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  const activeGroup = activeSalesGroup(pathname, tabs);

  const visibleTabs = useMemo(
    () => tabs.filter((t) => t.group === activeGroup),
    [tabs, activeGroup],
  );

  const active = visibleTabs
    .filter((t) => t.ready && (pathname === t.href || pathname.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const move = useCallback(() => {
    slideThumb(seg.current, '[aria-current="page"]');
  }, []);

  useEffect(() => {
    move();
    const id = requestAnimationFrame(() => {
      move();
      seg.current?.classList.add("ready");
    });

    const ro = new ResizeObserver(move);
    if (seg.current) ro.observe(seg.current);
    document.fonts?.ready.then(move).catch(() => {});

    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [move, active, pathname, activeGroup]);

  return (
    <div className="segwrap">
      <nav className="seg" ref={seg as React.RefObject<HTMLElement>} aria-label="بخش‌های فروش">
        <span className="thumb" aria-hidden="true" />
        {visibleTabs.map((t) =>
          t.ready ? (
            <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined}>
              {t.label}
            </Link>
          ) : (
            <span key={t.href} aria-disabled="true">
              {t.label} <span className="text-[length:var(--text-xs)]">· به‌زودی</span>
            </span>
          ),
        )}
      </nav>
    </div>
  );
}
```

`activeSalesGroup` is still exported from `lib/salesNav.ts` and still used here, so
`lib/salesNav.ts` itself needs no change.

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: PASS — `tests/salesNav.test.ts` exercises `lib/salesNav.ts` directly, not
`TabPill`'s JSX, so it is unaffected by this markup change.

- [ ] **Step 3: Build — expect a real error here**

Run: `npm run build`
Expected: **FAIL** — `app/sales/layout.tsx:64` still calls `<TabPill tabs={tabs} groups={SALES_GROUPS} />`, and `groups` is no longer a prop `TabPill` accepts. This is expected;
Task 8 fixes the call site. Do not fix it here — Task 7 has to exist first (`Navbar` is
what the group row moves *into*), and Task 8 is where the two meet.

- [ ] **Step 4: Commit**

```bash
git add components/kargah/TabPill.tsx
git commit -m "refactor: shrink TabPill to the tab row only -- group row moves to Navbar next"
```

---

### Task 7: Single-row `Navbar` with hover/click group dropdowns

**Files:**
- Create: `components/kargah/Navbar.tsx`
- Modify: `app/globals.css` (new `.navbar` block; retire `.top`/`.brandwrap`/`.seg-groups`
  — see Task 8, Step 3, which is where the last caller of the old classes is removed)

**Interfaces:**
- Consumes: `SALES_GROUPS`, `SalesGroupId`, `SalesTab`, `activeSalesGroup` from
  `lib/salesNav.ts`; `GlassFace` (existing); `ProfileMenu` (existing, unchanged).
- Produces: `<Navbar tabs={SalesTab[]} title={ReactNode} profile={...} />`. Consumed by
  Task 8 (sales layout).

- [ ] **Step 1: Write the component**

```tsx
// components/kargah/Navbar.tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  SALES_GROUPS,
  activeSalesGroup,
  type SalesGroupId,
  type SalesTab,
} from "@/lib/salesNav";
import GlassFace from "@/components/kargah/GlassFace";
import { cn } from "@/lib/cn";

/** The single-row navbar, spec 2026-09-08 §9a: brand at inline-start (visual right under
 *  RTL), the six sales groups centred, utility cluster (profile) at inline-end (visual
 *  left) -- logical properties throughout, never left:/right:, so the same markup would
 *  mirror correctly under a future LTR locale.
 *
 *  Each group pill is a real <button> that CLICK-TOGGLES its dropdown (same open/
 *  outside-click/Esc pattern as ProfileMenu) -- HOVER-opens it too, but only under
 *  (hover: hover) and (pointer: fine), a pure-CSS enhancement layered on top so a mouse
 *  user gets the video's hover behaviour while touch and keyboard still get a working
 *  control. This absorbed TabPill's former group row (components/kargah/TabPill.tsx),
 *  which now renders only the tab row beneath this.
 */
export default function Navbar({
  tabs,
  brand,
  profile,
}: {
  tabs: SalesTab[];
  brand: React.ReactNode;
  profile: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeGroup = activeSalesGroup(pathname, tabs);
  const [openGroup, setOpenGroup] = useState<SalesGroupId | null>(null);
  const root = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!openGroup) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpenGroup(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenGroup(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openGroup]);

  return (
    <nav ref={root as React.RefObject<HTMLElement>} className="navbar" aria-label="ناوبری اصلی" dir="rtl">
      <div className="navbar__brand">{brand}</div>

      <ul className="navbar__groups">
        {SALES_GROUPS.map((g) => {
          const groupTabs = tabs.filter((t) => t.group === g.id);
          const firstReady = groupTabs.find((t) => t.ready)?.href;
          if (!firstReady) return null;
          const isActive = g.id === activeGroup;
          const isOpen = openGroup === g.id;
          return (
            <li
              key={g.id}
              className="navbar__navgroup"
              onMouseEnter={() => setOpenGroup(g.id)}
              onMouseLeave={() => setOpenGroup((v) => (v === g.id ? null : v))}
            >
              <button
                type="button"
                className={cn("navbar__pill", isActive && "navbar__pill--active")}
                aria-expanded={isOpen}
                aria-haspopup="true"
                onClick={() => setOpenGroup((v) => (v === g.id ? null : g.id))}
              >
                {g.label}
              </button>
              {isOpen && (
                <GlassFace className="navbar__dropdown">
                  {groupTabs.map((t) =>
                    t.ready ? (
                      <Link
                        key={t.href}
                        href={t.href}
                        className="navbar__dropitem"
                        data-active={pathname === t.href || pathname.startsWith(`${t.href}/`) ? "true" : undefined}
                        onClick={() => setOpenGroup(null)}
                      >
                        {t.label}
                      </Link>
                    ) : (
                      <span key={t.href} className="navbar__dropitem navbar__dropitem--disabled">
                        {t.label} · به‌زودی
                      </span>
                    ),
                  )}
                </GlassFace>
              )}
            </li>
          );
        })}
      </ul>

      <div className="navbar__utility">{profile}</div>
    </nav>
  );
}
```

- [ ] **Step 2: Add the navbar's CSS**

Append to `app/globals.css`, before the `.chrome` block (so the sticky-header rules that
follow still read as "everything about the sticky chrome" together):

```css
/* ---- single-row navbar -----------------------------------------------------
   Spec 2026-09-08 §9a: one row, brand at inline-start, groups centred, utility cluster
   at inline-end -- logical properties only, matching decision 4 (navbar mirroring). */
.navbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 18px; padding-block: 4px;
}
.navbar__brand { display: flex; align-items: center; gap: 13px; min-width: 0; flex: none; }
.navbar__groups {
  display: flex; align-items: center; gap: 2px; margin: 0; padding: 0; list-style: none;
  flex: 1; justify-content: center; min-width: 0; overflow-x: auto; scrollbar-width: none;
}
.navbar__groups::-webkit-scrollbar { display: none; }
.navbar__navgroup { position: relative; }
.navbar__pill {
  border: 0; background: transparent; cursor: pointer;
  padding: 9px 16px; border-radius: 999px;
  font-family: var(--font-display); font-weight: 700; font-size: 13.5px;
  color: var(--text-muted); white-space: nowrap;
  transition: background 160ms var(--ease), color 160ms var(--ease);
}
.navbar__pill:hover { color: var(--text); }
.navbar__pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.navbar__pill--active { background: var(--primary); color: var(--primary-ink); }
/* Mouse enhancement only -- touch/keyboard rely on the click-toggle in Navbar.tsx. */
@media (hover: hover) and (pointer: fine) {
  .navbar__navgroup:hover .navbar__dropdown,
  .navbar__navgroup:focus-within .navbar__dropdown { display: flex; }
}
.navbar__dropdown {
  position: absolute; top: calc(100% + 6px); inset-inline-start: 0; z-index: 50;
  display: flex; flex-direction: column; gap: 2px; min-width: 11rem;
  border-radius: var(--r-lg); box-shadow: var(--sh-3); padding: 6px;
}
.navbar__dropitem {
  display: block; padding: 9px 12px; border-radius: var(--r-sm);
  font-size: 13px; color: var(--ink-2); text-decoration: none; white-space: nowrap;
  transition: background 160ms var(--ease);
}
.navbar__dropitem:hover { background: var(--sunk); color: var(--ink); }
.navbar__dropitem[data-active="true"] { color: var(--ink); font-weight: 600; background: var(--sunk); }
.navbar__dropitem--disabled { color: var(--faint); cursor: default; }
.navbar__utility { display: flex; align-items: center; gap: 9px; flex: none; }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `Navbar.tsx` builds cleanly on its own (it is not imported anywhere yet, so
this only checks its own syntax/types compile).

- [ ] **Step 4: Commit**

```bash
git add components/kargah/Navbar.tsx app/globals.css
git commit -m "feat: single-row Navbar with hover/click group dropdowns"
```

---

### Task 8: Wire `Navbar` + `Rail` into `app/sales/layout.tsx`

**Files:**
- Modify: `app/sales/layout.tsx`
- Modify: `app/globals.css` (delete the now-dead `.top`/`.brandwrap`/`.mark`/`.top h1`/
  `.top .sub`/`.topright`/`.seg-groups > a`/`.seg-groups > a[aria-current="true"]` rules —
  see Step 3)

**Interfaces:**
- Consumes: `Navbar` (Task 7), `Rail` (Task 5), the shrunk `TabPill` (Task 6).

This is the task that makes Task 6's expected build failure go away.

- [ ] **Step 1: Replace the layout's header markup**

In `app/sales/layout.tsx`, replace:

```tsx
      <div className="app">
        <Chrome>
        <div className="top">
          <div className="brandwrap">
            <div className="mark" aria-hidden="true">
              <svg viewBox="0 0 44 24" width="26" height="14" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round">
                <path d="M22 12c-3.2-4.6-6-6.2-9.4-6.2C8.4 5.8 5 8.6 5 12s3.4 6.2 7.6 6.2c3.4 0 6.2-1.6 9.4-6.2Zm0 0c3.2-4.6 6-6.2 9.4-6.2C35.6 5.8 39 8.6 39 12s-3.4 6.2-7.6 6.2c-3.4 0-6.2-1.6-9.4-6.2Z" />
              </svg>
            </div>
            <div>
              <h1>RouteFlow</h1>
              <div className="sub">{faJalaliLong(new Date().toISOString())}</div>
            </div>
          </div>
          <div className="topright">
            <ProfileMenu
              userId={session.user.id}
              name={session.user.display_name}
              roleLabel={ROLE_LABEL[session.role]}
            />
          </div>
        </div>

        <TabPill tabs={tabs} groups={SALES_GROUPS} />
        </Chrome>
```

with:

```tsx
      <Rail />
      <div className="app app--railed">
        <Chrome>
        <Navbar
          tabs={tabs}
          brand={
            <>
              <div className="mark" aria-hidden="true">
                <svg viewBox="0 0 44 24" width="26" height="14" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round">
                  <path d="M22 12c-3.2-4.6-6-6.2-9.4-6.2C8.4 5.8 5 8.6 5 12s3.4 6.2 7.6 6.2c3.4 0 6.2-1.6 9.4-6.2Zm0 0c3.2-4.6 6-6.2 9.4-6.2C35.6 5.8 39 8.6 39 12s-3.4 6.2-7.6 6.2c-3.4 0-6.2-1.6-9.4-6.2Z" />
                </svg>
              </div>
              <div>
                <h1>RouteFlow</h1>
                <div className="sub">{faJalaliLong(new Date().toISOString())}</div>
              </div>
            </>
          }
          profile={
            <ProfileMenu
              userId={session.user.id}
              name={session.user.display_name}
              roleLabel={ROLE_LABEL[session.role]}
            />
          }
        />

        <TabPill tabs={tabs} />
        </Chrome>
```

Remove the now-unused `SALES_GROUPS` import (`salesTabs` is still used) and add:

```tsx
import Navbar from "@/components/kargah/Navbar";
import Rail from "@/components/kargah/Rail";
```

- [ ] **Step 2: Give the content area room for the rail**

Append to `app/globals.css`, right after the existing `.app` rule
(`app/globals.css:1656`):

```css
/* The rail is fixed at 52px wide + 18px inset-inline-start (Task 5) -- give the content
   area the same inline-start gutter so nothing sits under it. Mirrors automatically:
   padding-inline-start is a logical property, so this is the correct edge in both
   writing directions without a direction check. */
.app--railed { padding-inline-start: 90px; }
@media (max-width: 900px) { .app--railed { padding-inline-start: clamp(16px, 3vw, 72px); } }
```

- [ ] **Step 3: Delete the dead two-row-header CSS**

Remove these rules from `app/globals.css`, now that nothing references them (`Navbar`
replaced `.top`/`.brandwrap`/`.topright`, and `TabPill` no longer renders `.seg-groups`):

- `.top { ... }` (`app/globals.css:1662-1665`)
- `.brandwrap { ... }` through `.top h1 { ... }` (`:1666-1678`) — **keep `.mark`**, still
  used inline in Task 8 Step 1's `brand` prop.
- `.top .sub { ... }` and `.topright { ... }` (`:1713-1714`)
- `.seg-groups > a { ... }` and `.seg-groups > a[aria-current="true"] { ... }`
  (`:1763`, `:1784`)

Run `grep -n "\.top \|\.brandwrap\|\.topright\|seg-groups" app/globals.css` afterward and
confirm the only remaining hits are inside comments (e.g. the `.chrome` block's own
explanatory prose), not live selectors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: clean build — this is where Task 6's expected failure resolves. Grep the
**full** output, not just the tail:

Run: `npm run build 2>&1 | grep -iE "warn|error"`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add app/sales/layout.tsx app/globals.css
git commit -m "feat: wire Navbar + Rail into the sales shell, retire the two-row header"
```

---

### Task 9: Wire `Rail` into `app/settings/layout.tsx`

**Files:**
- Modify: `app/settings/layout.tsx`

**Interfaces:**
- Consumes: `Rail` (Task 5).

Settings has no groups/tabs, so it gets the rail for shell consistency (the same
back/calendar/map/alerts/theme column everywhere) without a `Navbar` — there is nothing
for a group dropdown to show here.

- [ ] **Step 1: Add the rail and matching content gutter**

In `app/settings/layout.tsx`, wrap the return with `Rail` and switch `.app` to
`.app.app--railed`, mirroring Task 8:

```tsx
  return (
    <div className="kargah min-h-screen">
      <Rail />
      <div className="app app--railed">
```

(closing tag unchanged) and add the import:

```tsx
import Rail from "@/components/kargah/Rail";
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add app/settings/layout.tsx
git commit -m "feat: wire Rail into the settings shell for consistency"
```

---

### Task 10: RTL correctness — verify against real compiled output

**Files:**
- Create (scratch, not committed): a throwaway Playwright script in the session's
  scratchpad directory, per this repo's own established practice this redesign already
  used for the accent-leak bug in the previous plan.

CSS specificity/logical-property claims are exactly the category of bug this whole
redesign has repeatedly gotten wrong by reasoning alone (documented at length in
MASTER.md's anti-patterns) — verify empirically against a real browser, not by re-reading
the CSS.

- [ ] **Step 1: Start the dev server and load a real `/sales` page**

```bash
npm run build && npm start &
sleep 3
```

- [ ] **Step 2: Write and run a Playwright check**

```javascript
// scratchpad: verify-navbar-rtl.mjs
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:3000/login");
// (log in with a real seeded session per this repo's existing test-login convention,
// or reuse whatever cookie-setting helper the previous plan's Playwright checks used)
await page.goto("http://localhost:3000/sales/today");

const brandBox = await page.locator(".navbar__brand").boundingBox();
const utilityBox = await page.locator(".navbar__utility").boundingBox();
const railBox = await page.locator(".rail").boundingBox();

console.log("brand x:", brandBox.x, "utility x:", utilityBox.x, "rail x:", railBox.x);
// Expect: brand's box sits to the RIGHT of utility's box (higher x) -- inline-start
// resolves to visual-right under dir="rtl". Rail sits flush to the visual LEFT (low x).
if (!(brandBox.x > utilityBox.x)) throw new Error("brand is not visually right of utility under RTL");
if (!(railBox.x < utilityBox.x)) throw new Error("rail is not visually left-flush");

await browser.close();
console.log("RTL mirroring verified.");
```

Run: `node scratchpad/verify-navbar-rtl.mjs`
Expected: "RTL mirroring verified." with no thrown error.

- [ ] **Step 3: Verify the dropdown opens on the correct side**

Extend the same script: hover/click a `.navbar__pill`, read the opened
`.navbar__dropdown`'s bounding box, and confirm it does not overflow the viewport's
inline-end edge (a `position: absolute; inset-inline-start: 0` dropdown on a pill near
the visual left edge of a centred group could clip under a narrow viewport — this is
exactly the kind of thing worth checking against real layout rather than assuming).

- [ ] **Step 4: Stop the dev server**

```bash
kill %1
```

No commit for this task — it is verification, not a code change. If Step 2 or 3 finds a
real bug, fix it in the relevant task's file and re-run before moving on.

---

### Task 11: Full-suite verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all green, same or higher pass count than the previous plan's final state
(241 test files / 1889 passed / 1 skipped), plus this plan's new
`tests/design/bentoSpan.test.ts` and `tests/design/dockMagnify.test.ts`.

- [ ] **Step 2: Run the contrast check**

Run: `node scripts/check-contrast.mjs`
Expected: all pairs pass. `.navbar__pill--active` uses `--primary`/`--primary-ink`
(already-verified pairs from the previous plan); `.rail__item` text uses
`--text-muted`/`--text` against `--surface`, also already-covered token pairs — this step
confirms no new literal color slipped in anywhere in this plan's CSS additions.

- [ ] **Step 3: Full build, grep the WHOLE output**

Run: `npm run build 2>&1 | grep -iE "warn|error"`
Expected: no output. This is the exact check that caught the `.kargah-scrim` corruption
in the previous plan's Task 22 — never trust a tail-only build check after touching
`globals.css`.

- [ ] **Step 4: Grep for orphaned old classnames**

```bash
grep -rn "seg-groups\|SALES_GROUPS" app/ components/ --include="*.tsx"
```

Expected: `SALES_GROUPS` still appears inside `lib/salesNav.ts` (its definition) and
`Navbar.tsx` (its one real consumer now) — nowhere else. `seg-groups` should not appear
in any `.tsx` file at all (only, if anywhere, inside a CSS comment).

---

### Task 12: MASTER.md update

**Files:**
- Modify: `MASTER.md`

- [ ] **Step 1: Document the shipped shell**

Add a new section (after the existing "Pocket patterns" section, before "Kit primitives
not yet wired to real pages") documenting: the single-row `Navbar` + hover/click group
dropdown pattern and why click-toggle was added alongside the spec's hover-only
instruction (the accessibility reasoning from this plan's "Decisions made while
planning"); the `Rail`'s five real wired items and the explicit scope note about the four
verbs left un-wired (share/export/star/add/data/send) until each has a real feature
behind it; the `Bento`/`BentoCell` grid system and `bentoSpanForIndex`'s pairing rule.

- [ ] **Step 2: Update "Kit primitives not yet wired to real pages"**

Remove `StatefulButton`, `GooeyInput` etc. from that list only if this plan actually wired
them anywhere (it did not — this plan's scope is shell, not retrofitting every kit
primitive onto real pages). Add a note that `Navbar`/`Rail`/`Bento` are now wired
examples of the pattern, for future reference on how a kit primitive graduates from
"exists" to "used."

- [ ] **Step 3: Update "Not yet decided / deferred to later sub-projects"**

Remove "Global shell — single navbar, left icon rail, bento grid" from the deferred list
(it is done). The "journey connector lines" clause of that same bullet stays deferred —
this plan does not touch §9c or §9d.

- [ ] **Step 4: Commit**

```bash
git add MASTER.md
git commit -m "docs: MASTER.md — document the shell (Navbar/Rail/Bento), update deferred list"
```

---

## Self-review notes (carried into the plan, not a separate pass)

- **Spec coverage:** §9a's single navbar (✓ Task 7/8), left rail (✓ Task 5), RTL
  mirroring (✓ Task 10) are covered. §9b's bento grid (✓ Task 1) and a real consumer
  (✓ Task 2) are covered. §9c (connectors) and §9d (backend) are explicitly out of this
  plan's scope per its Goal statement and remain in MASTER.md's deferred list.
- **Type consistency:** `TabPill`'s prop signature changes from `{ tabs, groups }` to
  `{ tabs }` in Task 6 and both call sites (`app/sales/layout.tsx`) are updated in the
  same commit family (Task 8) — the one place a stale signature could survive
  undetected is caught by Task 6 Step 3's deliberate expected build failure.
  `bentoSpanForIndex`'s return type (`BentoSpan`) matches `BentoCell`'s `span` prop type
  exactly (Task 1).
- **No placeholders:** every step above ships real, runnable code — no TODOs.
