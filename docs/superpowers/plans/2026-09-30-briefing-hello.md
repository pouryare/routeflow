# The Windows-Hello Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the briefing's stack of equal-weight panels with a Windows-Hello-shaped screen: one face, one name, one number that says how many things need you, and a small row of cards that each name the single most urgent item.

**Architecture:** `lib/repo/briefing.ts` already branches on role and already returns `{ role, panels }`; `targetProgress` already computes a monthly target. Neither reaches most roles, and the rendering is a flat list of panels where nothing is more important than anything else. This plan adds a **`hero` section to the briefing payload** (who you are + how many things need you) and a **count-plus-one-named-item card**, then renders the Hello layout in `components/today/Briefing.tsx`.

**Why Hello and not "more cards".** A Hello screen answers exactly one question: who is this, and what do they need right now. The current briefing is the opposite — five equal panels, so nothing reads as urgent. The change is to the *hierarchy*, not the density.

---

## The decisions that shape it

**The hero photo is the person, never the role.** When a rep holding two roles lands here, the role picker sits right under the hero. The face does **not** change with the active role: a face that swaps when you tap a role button is disorienting, and the role is already stated in text directly under the name.

**Cards show a count plus ONE named, tappable item.** Not the count alone. "۳ مورد نیاز به اقدام" says *that* you are busy but not *what to do first*, which costs a second lookup — on a phone at a customer's counter that is the difference between acting and closing the app. The count is the glance; the named item is the action. Both point at the same destination.

**Depends on the avatar plan.** This screen is built around a large photograph. `components/meridian/Avatar.tsx` falls back to initials BY DESIGN, so in a 96px hero circle initials read as a bug rather than a greeting. **Plan B (`2026-09-30-avatars.md`) ships first.** If no user has a photo yet, this screen still works — it shows initials — but it is at its best once they do.

**Driver mode is out of scope.** `/driver` is a thumb in a moving vehicle and MASTER.md bans overshoot there. `/today` and `/sales/today` get the new layout; `/driver` does not.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/repo/briefing.ts` | **Modify.** Add `BriefingHero`, add the monthly target to every role, add the conservative cards. |
| `lib/repo/briefingCards.ts` | **New, pure.** `needsAttention(panels)` → count, and `mostUrgent(items)` → the one named item. Separating "which item" from the query that produced it is what makes it testable without a database. |
| `components/today/Briefing.tsx` | **Modify.** Render the hero and the new card shape; keep both variants. |
| `components/today/BriefingHero.tsx` | **New.** The photo, name, role, date and the one headline figure. |
| `app/(shell)/sales/today/page.tsx` | **Modify.** Pass the avatar and hero props. |
| `app/(bare)/today/page.tsx` | **Modify.** Same. |
| `tests/briefing-hello.test.ts` | **New.** The pure card logic. |
| `tests/briefing.test.ts` | **Modify.** Existing role assertions. |

---
### Task 1: The card logic, as pure functions

Before any rendering. "How many things need me" and "which one is most urgent" are decisions, not layout, so they belong in a module with no database and no React.

**Files:**
- Create: `lib/repo/briefingCards.ts`
- Test: `tests/briefing-hello.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/briefing-hello.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { needsAttention, mostUrgent, cardFor } from "@/lib/repo/briefingCards";
import type { BriefingPanel } from "@/lib/repo/briefing";

const item = (over: Partial<BriefingPanel["items"][0]> = {}) => ({
  label: "مورد",
  tone: "warn" as const,
  href: "/x",
  ...over,
});

const panel = (key: string, items: BriefingPanel["items"]): BriefingPanel => ({
  key,
  title: key,
  items,
});

describe("what needs the reader's attention", () => {
  it("counts only panels that DEMAND something", () => {
    const panels = [
      panel("a", [item({ tone: "crit" }), item({ tone: "warn" })]),
      panel("b", [item({ tone: "info" })]),
      panel("c", []),
    ];
    expect(needsAttention(panels)).toBe(2);
  });

  it("counts nothing when every panel is informational", () => {
    expect(needsAttention([panel("a", [item({ tone: "info" })])])).toBe(0);
  });

  it("is 0 for no panels at all, so the hero can render honestly", () => {
    expect(needsAttention([])).toBe(0);
  });

  it("picks the crit item first when several need attention", () => {
    const panels = [
      panel("a", [item({ label: "عادی", tone: "warn" })]),
      panel("b", [item({ label: "فوری", tone: "crit" })]),
    ];
    expect(mostUrgent(panels)?.label).toBe("فوری");
  });

  it("prefers a good-tone item LAST — a win is not an action", () => {
    expect(mostUrgent([panel("a", [item({ label: "خبر خوب", tone: "good" })])])).toBeNull();
  });

  it("skips an urgent item that has no href — a tappable row needs a destination", () => {
    const panels = [panel("a", [item({ label: "بدون مقصد", tone: "crit", href: undefined })])];
    expect(mostUrgent(panels)).toBeNull();
  });

  it("returns the item itself, not a copy", () => {
    const target = item({ label: "کار", tone: "crit" });
    expect(mostUrgent([panel("a", [target])])).toBe(target);
  });

  it("cardFor gives a count and the one named item together", () => {
    const card = cardFor([
      panel("a", [item({ label: "الف", tone: "warn" }), item({ label: "ب", tone: "crit" })]),
    ]);
    expect(card).not.toBeNull();
    expect(card!.count).toBe(2);
    expect(card!.urgent?.label).toBe("ب");
  });

  it("cardFor is null when nothing is urgent — the card must not render at all", () => {
    expect(cardFor([panel("a", [item({ tone: "info" })])])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/briefing-hello.test.ts
```

Expected: FAIL — "no such module `lib/repo/briefingCards`".

- [ ] **Step 3: Write the module**

Create `lib/repo/briefingCards.ts`:

```ts
/** Which items on the briefing DEMAND something, and the one to act on first.
 *
 *  Pure, with no database and no React, because "what does this screen say is urgent" is a
 *  decision and decisions deserve tests that run in milliseconds. `briefing.ts` builds the
 *  panels; this decides which of them count.
 *
 *  The rule that makes the screen work is what is EXCLUDED:
 *
 *  - `info` is not a demand. "۳ سفارش امروز" is information; counting it as work would put a
 *    number on the hero the reader cannot act on, which is worse than no number.
 *  - `good` is never urgent. A completed thing does not need doing, and leading with it
 *    teaches the reader to ignore the one number that matters.
 *  - an item with no `href` cannot be tapped, so it cannot be "the one to act on" either —
 *    it would be a card that looks actionable and goes nowhere. */

import type { BriefingItem, BriefingPanel } from "./briefing";

/** The tones that mean "this is waiting on you". `warn` and `crit` only. */
const DEMANDING: ReadonlySet<BriefingItem["tone"]> = new Set(["warn", "crit"]);

function demandingItems(panels: readonly BriefingPanel[]): BriefingItem[] {
  return panels.flatMap((p) => p.items.filter((i) => DEMANDING.has(i.tone)));
}

/** How many things are waiting on the reader. The one number on the hero. */
export function needsAttention(panels: readonly BriefingPanel[]): number {
  return demandingItems(panels).length;
}

/** The single item to act on first, or `null` when nothing is both urgent and tappable.
 *
 *  Worst tone wins; within a tone the first listed wins, because `briefing.ts` already
 *  orders panels by how much they matter (credit approvals before unplanned routes). */
export function mostUrgent(panels: readonly BriefingPanel[]): BriefingItem | null {
  const candidates = demandingItems(panels).filter((i) => Boolean(i.href));
  if (candidates.length === 0) return null;
  const worst = candidates.some((i) => i.tone === "crit") ? "crit" : "warn";
  return candidates.find((i) => i.tone === worst) ?? null;
}

export interface BriefingCard {
  count: number;
  /** The one item to act on, or null when every urgent item is untappable. */
  urgent: BriefingItem | null;
}

export function cardFor(panels: readonly BriefingPanel[]): BriefingCard | null {
  const count = needsAttention(panels);
  if (count === 0) return null;
  return { count, urgent: mostUrgent(panels) };
}
```

- [ ] **Step 4: Run and confirm it passes**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/briefing-hello.test.ts
```

Expected: **10/10 pass.**

- [ ] **Step 5: Commit**

```bash
cd /home/pourya/Desktop/routeflow
### Task 2: The hero payload in `briefing.ts`

`todayFor` returns `{ role, panels }`. Add a `hero` so the page does not re-derive identity, and give every role the monthly target.

**Files:**
- Modify: `lib/repo/briefing.ts`
- Test: `tests/briefing-hello.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

Append to `tests/briefing-hello.test.ts`. These need a database, so add the tmp-db preamble at the **top** of the file, above every existing import, following the shape in `tests/commissionLedger.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { beforeAll, afterAll } from "vitest";

const testDbPath = path.join(
  os.tmpdir(),
  `briefing-hero-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;

const { getDb } = await import("@/lib/db");
const { todayFor } = await import("@/lib/repo/briefing");
const { setTarget } = await import("@/lib/repo/targets");
const { toJalali } = await import("@/lib/jalali");

let org = 0;
let manager = 0;
let driver = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  org = Number(db.prepare("INSERT INTO organizations (name) VALUES ('B')").run().lastInsertRowid);
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,organization_id,created_at) VALUES (?,?,?,?,?,?)",
  );
  manager = Number(u.run(`m${Date.now()}`, "x", "مدیر", "group_manager", org, now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x", "راننده", "delivery_driver", org, now).lastInsertRowid);
});

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const sessionFor = (userId: number, role: string) =>
  ({
    user: { id: userId, display_name: "x", avatar_url: null },
    role,
    organizationId: org,
    groupId: null,
    roles: [role],
  }) as never;
```

Then append the cases:

```ts
describe("the briefing hero", () => {
  it("carries the person's id, so the avatar stays the same person in any role", () => {
    expect(todayFor(sessionFor(manager, "group_manager")).hero).toMatchObject({
      userId: manager,
    });
  });

  it("gives a MANAGER the monthly target, not just phone_sales", () => {
    const j = toJalali(new Date().toISOString())!;
    const period = `${j.jy}-${String(j.jm).padStart(2, "0")}`;
    setTarget(org, {
      user_id: manager,
      period,
      metric: "revenue_toman",
      target_value: 5_000_000,
    });
    const b = todayFor(sessionFor(manager, "group_manager"));
    expect(b.panels.some((p) => p.key === "target")).toBe(true);
  });

  it("a DRIVER with no run still gets a briefing, never a blank screen", () => {
    expect(todayFor(sessionFor(driver, "delivery_driver")).panels.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/briefing-hello.test.ts
```

Expected: the two hero tests FAIL — `todayFor` returns no `hero` today.

- [ ] **Step 3: Add the hero type and payload**

In `lib/repo/briefing.ts`, extend the return type:

```ts
export interface BriefingHero {
  userId: number;
  displayName: string;
  /** Null when nobody has set a photo — the Avatar component's initials fallback is the
   *  honest answer, and in a 96px hero it is also the weakest-looking. See plan B. */
  avatarUrl: string | null;
  role: string;
}

export interface Briefing {
  role: string;
  panels: BriefingPanel[];
  hero: BriefingHero;
}
```

Then, in `todayFor`, build it before the `if (kept.length === 0)` early return and include it in **both** return paths:

```ts
  const hero: BriefingHero = {
    userId: session.user.id,
    displayName: session.user.display_name,
    avatarUrl: session.user.avatar_url ?? null,
    role: session.role,
  };
```

The empty-day path becomes:

```ts
  if (kept.length === 0) {
    return {
      role: session.role,
      hero,
      panels: [{ key: "empty_day", title: "امروز", items: [{ label: "کاری برای امروز ثبت نشده است" }] }],
    };
  }

  return { role: session.role, hero, panels: kept };
```

**Why the hero carries `userId` and not a rendered avatar:** the face belongs to the person
and never changes with the active role. A rep holding two roles taps the role picker and the
name's role line updates while the photo stays put — a face that swaps on a role tap reads as
a bug, and the role is already spelled out in the text beneath the name.

- [ ] **Step 4: Give every role the monthly target**

Today only the `phone_sales` branch reads `targetProgress`. Lift it out of that branch and
apply it to everyone, placed just before `if (kept.length === 0)` so it applies to all roles:

```ts
  /* The month's target, for EVERY role.
   *
   *  This used to live inside the `phone_sales` branch alone, so a manager staring at
   *  "سفارش‌های امروز" had no month context at all — the single biggest gap on the screen.
   *  `targets` already stores revenue_toman / kg / orders per Jalali period and
   *  `targetProgress` already computes it, so this is wiring, not a new table.
   *
   *  A manager with no personal target falls back to the GROUP target, which is the number
   *  they are actually accountable for. */
  const personal = targetProgress(org, {
    user_id: session.user.id,
    period: currentPeriod(),
    metric: "revenue_toman",
  });
  const group =
    session.groupId === null
      ? null
      : targetProgress(org, { group_id: session.groupId, period: currentPeriod(), metric: "revenue_toman" });
  const goal = personal.target > 0 ? personal : group;
  if (goal && goal.target > 0) {
    panels.push({
      key: "target",
      title: "هدف این ماه",
      items: [
        {
          label: `${Math.round(goal.fraction * 100)}٪`,
          sub: `${goal.actual.toLocaleString("fa-IR")} از ${goal.target.toLocaleString("fa-IR")}`,
          href: "/sales/commission",
          tone: goal.fraction >= 1 ? "good" : goal.fraction >= 0.6 ? "info" : "warn",
        },
      ],
    });
  }
```

Delete the now-duplicated target block from inside the `phone_sales` branch, and add
`scopeGroupIds` is already imported — reuse `session.groupId`.

- [ ] **Step 5: Run and confirm it passes**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/briefing-hello.test.ts tests/briefing.test.ts 2>&1 | tail -25
```

Expected: all pass. `tests/briefing.test.ts` is the existing role suite; if it asserts the
exact shape of the return value, add `hero` to its expectation — that is the intended change,
not a test to be weakened.

- [ ] **Step 6: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.** Any call site constructing a `Briefing` literal now needs a `hero`,
and `tsc` will name each one.

- [ ] **Step 7: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add lib/repo/briefing.ts tests/briefing-hello.test.ts tests/briefing.test.ts
git commit -m "feat(briefing): a hero, and the monthly target for every role not just phone_sales"
```

---

### Task 3: The `BriefingHero` component

**Files:**
- Create: `components/today/BriefingHero.tsx`

- [ ] **Step 1: Write it**

Create `components/today/BriefingHero.tsx`:

```tsx
import Avatar from "@/components/meridian/Avatar";
import CountUp from "@/components/meridian/CountUp";
import type { Briefing as BriefingData } from "@/lib/repo/briefing";
import type { BriefingCard } from "@/lib/repo/briefingCards";
import { faJalaliLong } from "@/lib/jalali";

/** Who this is, and how much is waiting on them.
 *
 *  The shape is a Windows Hello screen on purpose: a large photograph, the person's name,
 *  their role and today's date, and then ONE number. A Hello screen answers exactly one
 *  question — who is this, and what do they need — and answers nothing else. The previous
 *  briefing was five equal-weight panels, so nothing read as more important than anything
 *  else and the reader had to do the ranking themselves.
 *
 *  Three rules this component exists to hold:
 *
 *  1. **One headline number.** Not four. `CountUp` sweeps it on arrival, which is exactly
 *     what MASTER.md's Tier 3 motion is for, and the only place on this screen where a
 *     number animates — a card grid of moving figures is noise.
 *  2. **The photo is `aria-hidden`.** The name beside it is the accessible content. A screen
 *     reader announcing a face adds nothing the reader did not just read.
 *  3. **Zero means zero.** A quiet day says "nothing needs you" rather than hiding the
 *     number, so a blank screen is never ambiguous between "quiet" and "signed in wrong". */
export default function BriefingHero({
  data,
  card,
  roleLabel,
  dateIso,
}: {
  data: BriefingData;
  card: BriefingCard | null;
  roleLabel: string;
  dateIso: string;
}) {
  const count = card?.count ?? 0;
  return (
    <header className="hello">
      <span className="hello__photo" aria-hidden="true">
        <Avatar
          userId={data.hero.userId}
          name={data.hero.displayName}
          src={data.hero.avatarUrl}
          size={96}
        />
      </span>
      <h1 className="hello__name">{data.hero.displayName}</h1>
      <p className="hello__meta">
        {roleLabel} · {faJalaliLong(dateIso)}
      </p>

      {count === 0 ? (
        <p className="hello__quiet">امروز چیزی منتظر شما نیست.</p>
      ) : (
        <div className="hello__figure">
          <span className="hello__count">
            <CountUp value={count} />
          </span>
          <span className="hello__caption">نیاز به اقدام</span>
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 2: Style it**

In `app/globals.css`, near the existing briefing rules (`grep -n "briefing-grid" app/globals.css`):

```css
/* The Hello header: photo, name, one number.
 *
 *  Centred, generous vertical rhythm, and nothing above the fold that is not identity or
 *  "how many things need me". The figure uses --text-3xl, which MASTER.md reserves for
 *  "the one headline number on a dashboard" — this is that one number. */
.hello {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-2);
  padding: var(--space-8) var(--space-4) var(--space-6);
}
.hello__photo {
  display: block;
  border-radius: 35%;
  box-shadow: var(--sh-2);
  overflow: hidden;
}
.hello__name {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text);
}
.hello__meta {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.hello__figure {
  margin-top: var(--space-3);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
}
.hello__count {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-3xl);
  font-weight: 700;
  line-height: 1.1;
  color: var(--text);
}
.hello__caption {
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.hello__quiet {
  margin: var(--space-4) 0 0;
  font-size: var(--text-sm);
  color: var(--text-muted);
}
```

- [ ] **Step 3: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.**

- [ ] **Step 4: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add components/today/BriefingHero.tsx app/globals.css
git commit -m "feat(today): the Hello header — a face, a name, and one number"
```

---

### Task 4: The count-plus-one-item card

The card shows **two** things: the count, and the single most urgent item's name as a real
tap target. Not the count alone — that says *that* you are busy but not *what to do first*,
and the second lookup is exactly the delay this screen exists to remove.

**Files:**
- Create: `components/today/BriefingCardTile.tsx`

- [ ] **Step 1: Write it**

Create `components/today/BriefingCardTile.tsx`:

```tsx
import Link from "next/link";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import type { BriefingCard } from "@/lib/repo/briefingCards";

/** One statistic: the count, and the ONE thing to do about it.
 *
 *  The pairing is the point. A card showing only "۳" tells the reader they are busy and
 *  nothing about what to do first, so they tap, they scan a list, and they choose — three
 *  steps where one would do. Naming the single most urgent item keeps this a one-glance
 *  screen while still being actionable.
 *
 *  The whole card is one link when there is something to act on, because the tappable
 *  region a thumb actually aims at is the card, not the words inside it. */
export default function BriefingCardTile({
  title,
  card,
  href,
}: {
  title: string;
  card: BriefingCard;
  /** Fallback destination for the whole card when the urgent item has none. */
  href?: string;
}) {
  const target = card.urgent?.href ?? href;
  const body = (
    <>
      <span className="tile__count">{faNum(card.count)}</span>
      <span className="tile__title">{title}</span>
      {card.urgent ? (
        <span className="tile__urgent">
          <Icon name="arrow-left" size="sm" />
          <span className="truncate">{card.urgent.label}</span>
        </span>
      ) : null}
    </>
  );

  if (!target) {
    return <div className="tile">{body}</div>;
  }
  return (
    <Link href={target} className="tile tile--action">
      {body}
    </Link>
  );
}
```

- [ ] **Step 2: Style it**

In `app/globals.css`, beside the `.hello` block:

```css
/* A count plus the one named item to act on. */
.tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--surface);
  box-shadow: var(--sh-1);
  text-decoration: none;
  color: var(--text);
}
.tile--action:hover {
  box-shadow: var(--sh-2);
}
.tile__count {
  font-family: var(--font-num);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-2xl);
  font-weight: 700;
  line-height: 1.1;
}
.tile__title {
  font-size: var(--text-sm);
  color: var(--text-muted);
}
.tile__urgent {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-1);
  padding-top: var(--space-1);
  border-top: 1px solid var(--border);
  font-size: var(--text-sm);
  color: var(--accent);
  min-width: 0;
}
```

- [ ] **Step 3: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.**

- [ ] **Step 4: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add components/today/BriefingCardTile.tsx app/globals.css
git commit -m "feat(today): a card is a count plus the one item to act on"
```

---

### Task 5: Wire both pages

Both `/today` (bare) and `/sales/today` (shell) render the same `Briefing`, so both get the
hero. `/driver` does not — it is a thumb in a moving vehicle and MASTER.md bans overshoot there.

**Files:**
- Modify: `components/today/Briefing.tsx`
- Modify: `app/(bare)/today/page.tsx`
- Modify: `app/(shell)/sales/today/page.tsx`

- [ ] **Step 1: Add the card row to `Briefing.tsx`**

At the top of `components/today/Briefing.tsx`, add:

```tsx
import BriefingCardTile from "./BriefingCardTile";
import { cardFor, type BriefingCard } from "@/lib/repo/briefingCards";
```

Add a `showCards` prop (defaulting to `true` — both call sites want it) and compute the cards
from the two panels that answer with a number rather than a list:

```tsx
export default function Briefing({
  data,
  variant = "plain",
  showCards = true,
}: {
  data: BriefingData;
  variant?: Variant;
  showCards?: boolean;
}) {
  /** The two panels that are a FIGURE rather than a list. `target` and `credit_waiting` are
   *  the answers a reader wants as a count; the rest are worklists and stay panels. */
  const CARD_KEYS = ["target", "credit_waiting"] as const;
  const cards: Array<{ title: string; card: BriefingCard }> = showCards
    ? data.panels
        .filter((p) => (CARD_KEYS as readonly string[]).includes(p.key))
        .map((p) => ({ title: p.title, card: cardFor([p]) }))
        .filter((c): c is { title: string; card: BriefingCard } => c.card !== null)
    : [];
```

Then render the row of cards immediately before the panels, in **both** variants:

```tsx
        {cards.length > 0 ? (
          <div className="tiles" dir="rtl">
            {cards.map((c) => (
              <BriefingCardTile key={c.title} title={c.title} card={c.card} />
            ))}
          </div>
        ) : null}
```

The title travels on the card object rather than being re-derived from the panel key — a card
whose title can drift from its own panel is worse than no card at all.

Add to `app/globals.css`:

```css
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-3);
}
```

- [ ] **Step 2: Render the hero on the bare page**

In `app/(bare)/today/page.tsx`, replace the hand-rolled `<header>` (the one holding `امروز`
and the name) with the hero:

```tsx
import BriefingHero from "@/components/today/BriefingHero";
import { cardFor } from "@/lib/repo/briefingCards";
import { ROLE_LABEL } from "@/lib/roles";
```

```tsx
      <BriefingHero
        data={data}
        card={cardFor(data.panels)}
        roleLabel={ROLE_LABEL[session.role] ?? session.role}
        dateIso={new Date().toISOString()}
      />
```

Keep `RolePicker` directly beneath it — a multi-role person needs it, and it was already the
first thing under the header.

- [ ] **Step 3: Render the hero on the sales page**

In `app/(shell)/sales/today/page.tsx`, keep `<PageHeader route="/sales/today" />` (shell pages
need their tab chrome) and add the hero directly after it:

```tsx
import BriefingHero from "@/components/today/BriefingHero";
import { cardFor } from "@/lib/repo/briefingCards";
import { ROLE_LABEL } from "@/lib/roles";
```

```tsx
      <BriefingHero
        data={data}
        card={cardFor(data.panels)}
        roleLabel={ROLE_LABEL[session.role] ?? session.role}
        dateIso={new Date().toISOString()}
      />
```

Then delete the hand-rolled `<div className="bhead">…<h2>امروز</h2>…</div>` block: the hero
now says who this is, and the page header already carries the title.

- [ ] **Step 4: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.**

- [ ] **Step 5: Run the guards and the briefing suites**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/briefing-hello.test.ts tests/briefing.test.ts tests/section-headings.test.ts tests/pageMeta.test.ts 2>&1 | tail -25
```

Expected: all pass. `tests/section-headings.test.ts` bans hand-styled `h2`/`h3`; the hero uses
`<h1>` (exempt), and removing the sales page's `<h2>` keeps it green.

- [ ] **Step 6: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add components/today/Briefing.tsx 'app/(bare)/today/page.tsx' 'app/(shell)/sales/today/page.tsx' app/globals.css
git commit -m "feat(today): the Hello briefing on both /today and /sales/today"
```

---

### Task 6: Verify the whole plan

**Files:** none — verification only.

- [ ] **Step 1: Run every suite this plan touched**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/briefing-hello.test.ts tests/briefing.test.ts tests/pageMeta.test.ts tests/section-headings.test.ts
```

Expected: **all pass.**

- [ ] **Step 2: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.**

- [ ] **Step 3: Confirm `/driver` was not touched**

```bash
cd /home/pourya/Desktop/routeflow
grep -rn "BriefingHero\|hello__" 'app/(bare)/driver' components/driver 2>/dev/null | wc -l
```

Expected: **0.** Driver mode keeps its own layout — MASTER.md bans overshoot there.

- [ ] **Step 4: Run the full suite (backgrounded — ~14 min)**

```bash
cd /home/pourya/Desktop/routeflow
setsid nohup npx vitest run > /tmp/vitest-hello.log 2>&1 &
tail -20 /tmp/vitest-hello.log
```

Expected: `2 failed / 2735 passed` is a **PASS** when the two are `tests/jalali.test.ts`
("agrees with Intl for every day across 20 Jalali years") and `tests/api/routing-route.test.ts`
("plans, commits and freezes"). Re-run any other failure alone first:

```bash
npx vitest run tests/<the-failing-file>
```

---

## Verification Summary

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit                              # 0 errors
npx vitest run tests/briefing-hello.test.ts    # 13/13
npx vitest run tests/briefing.test.ts          # unchanged
git status --short                             # clean
```

The briefing opens with a face, a name, and one number; each card names the single most urgent
thing; every role sees the month's target; driver mode is untouched.

## Notes for the Engineer

- **Plan B ships first.** This screen is built around a large photograph, and `Avatar.tsx`
  falls back to initials BY DESIGN. It works without a photo, but at its best with one.
- **`CountUp` already existed** (`components/meridian/CountUp.tsx` + `lib/useCountUp.ts`,
  MASTER Tier 3). This plan *uses* it; it does not rebuild it. Under `prefers-reduced-motion` it
  renders the final figure with no sweep, which is correct — never "fix" that.
- **Never run `next build`** here. Use `npx tsc --noEmit` and `npx vitest run`.
- **`sharp` stays at exactly `0.33.5`** (`--save-exact`); this CPU has no AVX2.
