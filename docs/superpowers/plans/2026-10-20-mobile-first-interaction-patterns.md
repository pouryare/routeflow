# Mobile-First Interaction Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace typing, manual data entry and `<select>` dropdowns across RouteFlow with phone-native patterns wherever TapFlow does not fit (filters, quantities, pickers, dates, lists, queues, maps, reports, admin), and finish by writing a **design-rules document** (the TapFlow-principles equivalent) so every future page follows the same patterns.

**Architecture:** TapFlow covers "record what just happened" (see `2026-10-20-mobile-first-tapflow.md`). This plan covers everything else with a small set of **named, reusable patterns**, each one a pure model in `lib/` (tested) plus a thin component in `components/mobile/`. A measurable **audit script** gives a baseline and a ratchet (counts of `<select>`, native date inputs, tiny tap targets… may only go down). After every pattern has shipped and the exit criteria in Phase 10 are met, the lessons are distilled into `docs/mobile-first-principles.md`, enforced by a check script and pointed to from `CLAUDE.md`.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching routing/caching, per `AGENTS.md`), React 19, TypeScript, Tailwind + CSS variables, Pointer Events for gestures (no new gesture library), vitest.

**Standing rules (from `.zoocode/plan.md`, still in force):**
- NEVER run `next build` / `npm run build` / `vitest.smoke.mts` (browser).
- `npx tsc --noEmit`, `npx vitest run <file>`, `npm run lint` before each commit; `npm run audit-copy` after adding Persian text.
- `sharp` stays pinned to `0.33.5`.
- Commit per task. `CLAUDE.md`: after every commit **and push**, merge the branch's open PR into `main` if it exists with no conflicts and green CI; never create a PR just to merge.
- RTL throughout (swipe/slide directions mirror), Persian digits, Shamsi dates, `<Icon>` only (never an icon without a word), 44 px minimum touch target, 52 px for answer buttons, `env(safe-area-inset-bottom)` on anything fixed to the bottom, `prefers-reduced-motion` respected.

---

## The patterns (shared vocabulary)

Each pattern has a name used in code, docs and reviews.

| Code | Pattern | Replaces | Component / model |
|---|---|---|---|
| P1 | **Phone shell** — bottom tab bar per role, quick-action button, sticky primary action | the 30-destination top pill nav on phones | `lib/mobileNav.ts`, `BottomNav`, `QuickActions`, `StickyAction` |
| P2 | **Chips & filter sheet** | filter `<select>`s, date-range pickers | `FilterChips`, `FilterSheet`, `lib/periods.ts` |
| P3 | **Keypad** — number entry without the OS keyboard | `<input type=number>` / text for money, counts, thresholds | `Keypad`, `KeypadField` |
| P4 | **Smart picker** — recents first, search last | customer/product/place `<select>` and search boxes | `SmartPicker`, `lib/recents.ts` |
| P5 | **Day chips** — "today / tomorrow / Saturday…" + week strip | `JalaliDateInput` as the first thing you see | `DayChips`, `WeekStrip`, `lib/dayChoices.ts` |
| P6 | **Swipe row** — gestures on list rows, long-press to select | per-row button clusters | `SwipeRow`, `lib/swipe.ts` |
| P7 | **Decision deck** — one card, one decision, undo | approval/triage lists | `DecisionDeck` |
| P8 | **Map select** — pick on the map, not from a list | list + map side by side | planner/leads map modes |
| P9 | **Auto-trigger & action cards** — the app opens the next step itself | navigating to the right screen | geofence → flow, `ActionCard`, notification actions |
| P10 | **Report cards** — swipeable KPI cards, tap to drill into a sheet | wide tables, range pickers | `KpiCarousel`, `DrillSheet` |
| P11 | **Admin presets** — copy-from, role chips, share-link | long admin forms | per-page |
| — | **TapFlow** (already built) | "record what happened" forms | see the TapFlow plan |

**Pattern interaction budgets** (the analogue of TapFlow's tap budget; each is asserted in the pattern's tests or checked in review):

| Situation | Budget |
|---|---|
| Reach any destination the role can use | ≤ 2 taps from the bottom bar |
| Apply a common filter | 1 tap; any combination ≤ 3 taps |
| Choose a frequently used customer/product/place | ≤ 2 taps and **no typing**; a rare one ≤ 4 typed characters |
| Enter a number equal to a suggestion | 1 tap; otherwise digits + 1 |
| Pick a day in the next 7 days | 1 tap |
| Decide a queue item | 1 gesture + the 5 s undo (no "are you sure?") |
| Select N places on the map | 1 tap each, or 1 tap for "nearest N" |

## Relationship to the TapFlow plan

| This plan needs | From TapFlow plan | Why |
|---|---|---|
| P3 Keypad shares its keys with `AmountStep` | Task 0.2 | one numeric UI, not two |
| P4 SmartPicker is the engine inside TapFlow's `PickStep` | Task 0.2 | recents ranking in one place |
| P5 DayChips replaces the host-rendered `date` step | Tasks 2.2, 6.2 | flows stop showing the full calendar first |
| P9 geofence opens `DeliveryFlow` | Phase 1 | the auto-trigger needs the flow |

So: **TapFlow Phase 0 first**, then this plan's Phase A–C can run in parallel with TapFlow Phases 1–3.

## Out of scope (parked)

Camera/OCR, voice input, paste-to-parse → `docs/future-features.md`.

---

## File structure

**Create**
- `scripts/mobile-audit.mjs`, `scripts/mobile-allowlist.json`, `docs/mobile-audit-baseline.json`
- `lib/mobileNav.ts`, `lib/periods.ts`, `lib/recents.ts`, `lib/dayChoices.ts`, `lib/swipe.ts`, `lib/keypad.ts`
- `components/mobile/BottomNav.tsx`, `QuickActions.tsx`, `StickyAction.tsx`, `FilterChips.tsx`, `FilterSheet.tsx`, `Keypad.tsx`, `KeypadField.tsx`, `SmartPicker.tsx`, `DayChips.tsx`, `WeekStrip.tsx`, `SwipeRow.tsx`, `DecisionDeck.tsx`, `ActionCard.tsx`, `KpiCarousel.tsx`, `DrillSheet.tsx`
- `tests/mobile-*.test.ts` (one per pure lib)
- `docs/superpowers/plans/mobile-first-lessons.md` (running notes, Phase 10 input)
- `docs/mobile-first-principles.md`, `scripts/check-mobile-rules.mjs` (Phase 10)

**Modify** (per phase): `components/meridian/AppShell.tsx`, `AppHeader.tsx`, `Chrome.tsx`, `app/globals.css`, `package.json`, `CLAUDE.md`, and the pages listed in each phase.

---

## Phase A — Measure first

### Task A.1: Mobile audit script (baseline + ratchet)

**Files:** Create `scripts/mobile-audit.mjs`, `scripts/mobile-allowlist.json`; Modify `package.json`; Test `tests/mobile-audit.test.ts`

- [ ] **Step 1: Failing test** — `tests/mobile-audit.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { countRules } from "../scripts/mobile-audit.mjs";

describe("mobile audit counters", () => {
  const src = `<select><option/></select><input type="date"/><button className="py-[2px]">x</button>
               <textarea/> {confirm("sure?")} onConfirm(x)`;
  it("counts each rule once per occurrence", () => {
    expect(countRules(src)).toEqual({ select: 1, nativeDate: 1, textField: 2, tinyTarget: 1, confirmDialog: 1 });
  });
  it("does not count onConfirm as confirm()", () => {
    expect(countRules("onConfirm(x)").confirmDialog).toBe(0);
  });
});
```
- [ ] **Step 2:** `npx vitest run tests/mobile-audit.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `scripts/mobile-audit.mjs`**
```js
#!/usr/bin/env node
// Heuristic counts of desktop-first patterns. Not a parser: it exists to make progress
// visible and to stop regressions (the ratchet), not to be exact.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(ROOT, "docs", "mobile-audit-baseline.json");
const ALLOW = path.join(ROOT, "scripts", "mobile-allowlist.json");
const DIRS = ["app", "components"];

const RULES = {
  select: /<select\b/g,
  nativeDate: /type=["']date["']/g,
  textField: /<(?:input|textarea)\b/g,
  tinyTarget: /py-\[2px\]|py-0\.5\b/g,
  confirmDialog: /(?<![\w.])(?:window\.)?(?:confirm|alert|prompt)\(/g,
};

export function countRules(src) {
  return Object.fromEntries(Object.entries(RULES).map(([k, re]) => [k, (src.match(re) ?? []).length]));
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(tsx|ts)$/.test(e.name)) yield p;
  }
}

export function auditTree() {
  const allow = fs.existsSync(ALLOW) ? JSON.parse(fs.readFileSync(ALLOW, "utf8")) : {};
  const total = Object.fromEntries(Object.keys(RULES).map((k) => [k, 0]));
  const files = {};
  for (const d of DIRS) for (const f of walk(path.join(ROOT, d))) {
    const rel = path.relative(ROOT, f);
    if (allow[rel]) continue; // desk-only surfaces, each with a written reason
    const c = countRules(fs.readFileSync(f, "utf8"));
    for (const k of Object.keys(c)) total[k] += c[k];
    if (Object.values(c).some(Boolean)) files[rel] = c;
  }
  return { total, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? "--report";
  const { total, files } = auditTree();
  if (mode === "--write") {
    fs.writeFileSync(BASELINE, JSON.stringify({ total }, null, 2) + "\n");
    console.log("baseline written", total);
  } else if (mode === "--check") {
    const base = JSON.parse(fs.readFileSync(BASELINE, "utf8")).total;
    const worse = Object.keys(total).filter((k) => total[k] > base[k]);
    if (worse.length) { console.error("mobile-audit: regressed", worse.map((k) => `${k} ${base[k]}→${total[k]}`).join(", ")); process.exit(1); }
    console.log("mobile-audit ok", total);
  } else {
    console.log(total);
    const top = Object.entries(files).sort((a, b) => Object.values(b[1]).reduce((x, y) => x + y) - Object.values(a[1]).reduce((x, y) => x + y)).slice(0, 25);
    for (const [f, c] of top) console.log(f.padEnd(60), JSON.stringify(c));
  }
}
```
`scripts/mobile-allowlist.json` starts as `{}`. Add to `package.json`: `"audit:mobile": "node scripts/mobile-audit.mjs"`, `"check:mobile": "node scripts/mobile-audit.mjs --check"`.
- [ ] **Step 4:** test → PASS. Run `npm run audit:mobile` and read the output; run `node scripts/mobile-audit.mjs --write` to record the baseline. Commit `chore: mobile audit script and baseline`.
- [ ] **Step 5 (journal habit):** create `docs/superpowers/plans/mobile-first-lessons.md` with a heading per phase. **At the end of every phase append 3–5 bullets** ("what worked, what surprised us, what the next page should copy"). This is the raw material for Phase 10.

---

## Phase B — P1 Phone shell

**Context:** `AppShell` renders `AppHeader` (async, Suspense) → `Chrome` → `HoverPill` (the travelling nav pill over 30 tabs in 8 groups, `lib/appNav.ts`), search, bell, profile. There is already `.sheet-on-mobile` CSS (`app/globals.css:~1210`) and a `pinned-bottom` helper. Drivers use `app/(bare)/driver` without the shell.

### Task B.1: `bottomTabs` model

**Files:** Create `lib/mobileNav.ts`; Test `tests/mobile-nav.test.ts`

- [ ] **Step 1: Failing test** — a drift test in the style of `tests/appNav.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ROLES } from "@/lib/roles";
import { appTabs } from "@/lib/appNav";
import { bottomTabs, PRIMARY_BY_ROLE } from "@/lib/mobileNav";

describe("bottom tabs", () => {
  it.each(ROLES)("%s: ≤ 4 primary tabs, all reachable, plus a 'more' group list", (role) => {
    const reachable = appTabs({ role }).filter((t) => t.ready);
    const m = bottomTabs({ role });
    expect(m.primary.length).toBeLessThanOrEqual(4);
    for (const t of m.primary) expect(reachable.map((r) => r.href)).toContain(t.href);
    // every other reachable destination is in 'more', so nothing becomes unreachable on a phone
    const shown = new Set([...m.primary.map((t) => t.href), ...m.more.flatMap((g) => g.tabs.map((t) => t.href))]);
    for (const r of reachable) expect(shown.has(r.href)).toBe(true);
  });
  it("PRIMARY_BY_ROLE only names hrefs the role can reach", () => {
    for (const role of ROLES) {
      const reachable = appTabs({ role }).map((t) => t.href);
      for (const h of PRIMARY_BY_ROLE[role] ?? []) expect(reachable).toContain(h);
    }
  });
});
```
- [ ] **Step 2:** FAIL. **Step 3: Implement**
```ts
import { APP_GROUPS, appTabs, type AppGroupId, type AppTab } from "./appNav";
import type { Role } from "./roles";

/** The four destinations each role reaches for dozens of times a day. Everything else lives behind «بیشتر».
 *  Order = thumb order, most used first. Verified against appTabs by tests/mobile-nav.test.ts, so a renamed
 *  route fails a test instead of silently dropping out of the bar. */
export const PRIMARY_BY_ROLE: Partial<Record<Role, string[]>> = {
  platform_owner: ["/sales/today", "/crm", "/sales/orders", "/map"],
  owner: ["/sales/today", "/crm", "/sales/orders", "/map"],
  group_manager: ["/sales/today", "/crm", "/sales/orders", "/map"],
  rep_manager: ["/sales/today", "/crm", "/sales/tasks", "/map"],
  phone_sales: ["/sales/today", "/crm", "/sales/pocket", "/sales/orders"],
};

export interface BottomTabs {
  primary: AppTab[];
  more: { id: AppGroupId; label: string; tabs: AppTab[] }[];
}

export function bottomTabs(session: { role: Role }): BottomTabs {
  const all = appTabs(session).filter((t) => t.ready);
  const wanted = PRIMARY_BY_ROLE[session.role] ?? [];
  const primary = wanted.map((h) => all.find((t) => t.href === h)).filter((t): t is AppTab => !!t).slice(0, 4);
  const taken = new Set(primary.map((t) => t.href));
  const more = APP_GROUPS.map((g) => ({ id: g.id, label: g.label, tabs: all.filter((t) => t.group === g.id && !taken.has(t.href)) }))
    .filter((g) => g.tabs.length > 0);
  return { primary, more };
}
```
If the test shows a role has `reachable` hrefs different from the guesses above, **edit the arrays to the real hrefs** (the test tells you which). If a role has fewer than 4, that is fine. Drivers keep `app/(bare)/driver` and get their own bar in Task B.3.
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(mobile): bottom tab model per role`.

### Task B.2: `BottomNav` + `QuickActions` + `StickyAction`

**Files:** Create `components/mobile/BottomNav.tsx`, `QuickActions.tsx`, `StickyAction.tsx`; Modify `components/meridian/AppHeader.tsx`, `AppShell.tsx`, `app/globals.css`

- [ ] **Step 1:** `BottomNav` (client): `<nav aria-label="ناوبری اصلی" className="bottomnav md:hidden">` with the 4 primary links + a «بیشتر» button that opens a `.sheet-on-mobile` listing `more` groups as headings with 52 px link rows. Active tab = `usePathname().startsWith(href)`. Each item shows icon **and** word. Reserve space with `padding-bottom: calc(56px + env(safe-area-inset-bottom))` on `.app` below `md`.
- [ ] **Step 2:** `QuickActions`: a floating «+ ثبت» button (above the bar, thumb side = bottom-left in RTL) opening a sheet of the role's flows: for sales roles «ثبت دریافت»، «ثبت شکایت»، «یادآوری»، «سفارش جدید»; each opens the matching TapFlow host (imports the hosts from the TapFlow plan; until those exist, the button renders only the entries whose host exists — keep the list in `lib/mobileNav.ts` as `QUICK_ACTIONS_BY_ROLE` so the bar can ship before every flow does).
- [ ] **Step 3:** `StickyAction({ label, icon, onClick, disabled })`: a bottom-anchored primary button (`pinned-bottom`, above `BottomNav`) for pages with one dominant action (order form «ثبت سفارش»، planner «تأیید مسیر»).
- [ ] **Step 4:** In `AppHeader`, below `md` hide `HoverPill`'s nav pill (keep search, bell, profile on the top row) and mount `<BottomNav {...bottomTabs(session)} />` (computed server-side, passed as props). `md:` and up is unchanged.
- [ ] **Step 5:** tests: extend `tests/app-header.test.ts` to assert the pill is still rendered and `BottomNav` receives `bottomTabs(session)`. Manual 375 px check: every page still scrolls to its end above the bar; the bar never covers a sticky action.
- [ ] **Step 6:** tsc, lint, vitest, `npm run check:mobile`. Commit `feat(mobile): bottom bar, quick actions, sticky action`.

### Task B.3: Driver bar

- [ ] `app/(bare)/driver/page.tsx` has its own header and no shell. Add a two-item `BottomNav` variant (روز من / نقشه) only if the driver page has more than one destination worth a bar; otherwise record "driver stays single-screen" in the lessons file and skip. Commit `feat(driver): phone bar` or `docs: driver stays single-screen`.

---

## Phase C — P3 Keypad, P4 Smart picker, P5 Day chips (the biggest typing savers)

### Task C.1: `lib/recents.ts` — ranking model

**Files:** Create `lib/recents.ts`; Test `tests/mobile-recents.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { rank, record } from "@/lib/recents";

const items = [{ id: "1", label: "نانوایی سنگک" }, { id: "2", label: "بقالی رضا" }, { id: "3", label: "سوپر علی" }];

describe("recents ranking", () => {
  it("frequent beats recent beats alphabetical", () => {
    let h = {};
    h = record(h, "2", 1000); h = record(h, "2", 2000); h = record(h, "3", 3000);
    expect(rank(items, h, "", 3000).map((i) => i.id)).toEqual(["2", "3", "1"]);
  });
  it("a typed query filters and normalises Persian/Arabic variants", () => {
    expect(rank(items, {}, "بقالي", 0).map((i) => i.id)).toEqual(["2"]);
  });
  it("shows at most `limit` and never hides an exact match", () => {
    expect(rank(items, {}, "سوپر", 0, 1).map((i) => i.id)).toEqual(["3"]);
  });
});
```
- [ ] **Step 2:** FAIL. **Step 3: Implement** `lib/recents.ts`:
```ts
export type History = Record<string, { n: number; last: number }>;

export const normalizeFa = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
   .replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/‌/g, "").toLowerCase().trim();

export function record(h: History, id: string, now: number): History {
  const cur = h[id] ?? { n: 0, last: 0 };
  return { ...h, [id]: { n: cur.n + 1, last: now } };
}

/** Score = uses, with a recency tiebreak. With a query: filter first, then the same order. */
export function rank<T extends { id: string; label: string }>(items: T[], h: History, q: string, now: number, limit = 8): T[] {
  const n = normalizeFa(q);
  const pool = n ? items.filter((i) => normalizeFa(i.label).includes(n)) : items;
  return [...pool]
    .sort((a, b) => (h[b.id]?.n ?? 0) - (h[a.id]?.n ?? 0) || (h[b.id]?.last ?? 0) - (h[a.id]?.last ?? 0) || a.label.localeCompare(b.label, "fa"))
    .slice(0, limit);
}

const key = (userId: number, scope: string) => `recents:${userId}:${scope}`;
export function loadHistory(userId: number, scope: string): History {
  try { return JSON.parse(localStorage.getItem(key(userId, scope)) ?? "{}") as History; } catch { return {}; }
}
export function saveHistory(userId: number, scope: string, h: History) {
  try { localStorage.setItem(key(userId, scope), JSON.stringify(h)); } catch { /* private mode: ranking just resets */ }
}
```
This is the same normaliser Task 0.2 of the TapFlow plan looks for: **if `normalizeSearch` already exists, re-export it here instead of defining `normalizeFa`** (grep first; one implementation only).
- [ ] **Step 4:** PASS. **Step 5:** commit `feat(mobile): recents ranking model`.

### Task C.2: `SmartPicker` and adoption

**Files:** Create `components/mobile/SmartPicker.tsx`; Modify `components/tapflow/PickStep.tsx`, `components/sales/OrderForm.tsx`, `ComplaintsPanel.tsx`, `PaymentsPanel.tsx`, `ChequesBoard.tsx`, `BatchesPanel.tsx`, `app/(shell)/planner/page.tsx`

- [ ] **Step 1:** `SmartPicker({ scope, userId, items, value, onChange, placeholder })`: closed state shows the chosen label (52 px button, «تغییر»); open state is a `.sheet-on-mobile` with the top 5 ranked chips (no typing needed), a search field below, and results as 52 px rows. Calls `record`+`saveHistory` on pick. Hard rule: **the search field is never focused automatically if there are ≥ 3 history items** (keyboard stays down until the person asks for it).
- [ ] **Step 2:** `PickStep` (TapFlow) delegates to `rank`/`record` instead of its own filter (no behaviour change besides ordering).
- [ ] **Step 3:** replace each customer/product `<select>` (list from the audit: OrderForm ×2, ComplaintsPanel ×2, PaymentsPanel customer, ChequesBoard customer, BatchesPanel product, RepDefinitions customer) with `SmartPicker`. One commit per file; run `npm run audit:mobile` after each and watch `select` fall.
- [ ] **Step 4:** commit messages `feat(mobile): smart picker in <page>`; append lessons.

### Task C.3: `Keypad` / `KeypadField`

**Files:** Create `lib/keypad.ts`, `components/mobile/Keypad.tsx`, `KeypadField.tsx`; Test `tests/mobile-keypad.test.ts`

- [ ] **Step 1: Failing test** for the pure reducer:
```ts
import { press, quickAmounts } from "@/lib/keypad";
it("builds digits, backspaces, and caps length", () => {
  expect(press("", "5")).toBe("5");
  expect(press("12", "⌫")).toBe("1");
  expect(press("", "000")).toBe("");            // a leading triple-zero is ignored
  expect(press("5", "000")).toBe("5000");
  expect(press("1".repeat(12), "1")).toBe("1".repeat(12)); // 12-digit cap
});
it("quick amounts: the suggestion, its round-ups, nothing duplicated", () => {
  expect(quickAmounts(1234000)).toEqual([1234000, 1250000, 1300000, 1500000]);
});
```
- [ ] **Step 2:** FAIL. **Step 3:** implement `press(value, key)` (digits, `000`, `⌫`) and `quickAmounts(suggested)` (the suggestion + next 3 "round" values at 50 k/100 k/500 k granularity, deduped, ascending). `Keypad` renders a 3×4 grid of 56 px keys (Persian digits shown, ASCII stored), the live value formatted with `faNum`, the quick-amount chips above, and a confirm button. `KeypadField` replaces `<input type=number>`: a read-only button showing the value that opens the keypad in a sheet (so the OS keyboard never appears). `AmountStep` (TapFlow Task 0.2) renders `Keypad` inside itself so there is one numeric UI.
- [ ] **Step 4:** adopt in `OrderForm` (pack counts), `InventoryBoard` (threshold editor), `CommissionEditor` (rates), `ChequesBoard` and `PaymentsPanel` amounts, `BatchesPanel` quantity. Commit per file.
- [ ] **Step 5:** tests PASS; commit `feat(mobile): keypad`.

### Task C.4: Day chips and week strip

**Files:** Create `lib/dayChoices.ts`, `components/mobile/DayChips.tsx`, `WeekStrip.tsx`; Test `tests/mobile-day-choices.test.ts`; Modify `components/meridian/JalaliDateInput.tsx` callers

- [ ] **Step 1: Failing test** (uses `lib/holidays.ts` and `lib/jalali.ts`; read both for the exact exports first):
```ts
import { dayChoices } from "@/lib/dayChoices";
it("offers today, tomorrow, then the next weekdays, skipping holidays, then 'other'", () => {
  const out = dayChoices("2026-10-20", { holidays: new Set(["2026-10-22"]), count: 5 });
  expect(out[0]).toMatchObject({ iso: "2026-10-20", label: "امروز" });
  expect(out[1]).toMatchObject({ iso: "2026-10-21", label: "فردا" });
  expect(out.map((d) => d.iso)).not.toContain("2026-10-22");
  expect(out.at(-1)).toMatchObject({ kind: "other" });
});
it("marks Friday as a weekend (Iran) and keeps it selectable but flagged", () => {
  const fri = dayChoices("2026-10-20", { holidays: new Set(), count: 8 }).find((d) => d.iso === "2026-10-23");
  expect(fri?.flag).toBe("weekend");
});
```
(2026-10-23 is a Friday; adjust dates only if `lib/jalali` week logic says otherwise.)
- [ ] **Step 2:** FAIL. **Step 3:** implement `dayChoices(todayIso, { holidays, count })` returning `{ kind:"day"|"other", iso?, label, flag?:"weekend"|"holiday" }`: labels «امروز»، «فردا»، «پس‌فردا»، then the weekday name («شنبه»…) with the Jalali day number; holidays are **removed by default** (`skipHolidays: true`, for "when can we deliver" style pickers) and **flagged but kept** when `skipHolidays: false` (free picking, e.g. a reminder date). Fridays are always kept and flagged `"weekend"`. Add a test for each mode.
- [ ] **Step 4:** `DayChips({ value, onChange, count=5 })` renders the chips (52 px) + «روز دیگر…» which opens `WeekStrip` (a horizontally swipeable strip of 14 days) and, from there, «تقویم کامل» → `JalaliDateInput`. Adopt in TapFlow `date` steps (TapFlow Tasks 2.2, 6.2, 7.2), `ReminderFlow`, `AddReminder`, `OrderForm` requested date, `BatchesPanel` expiry, `ScheduleBoard` day selection, `PaymentsPanel` received-at. `JalaliDateInput` itself stays for desk (`md:`) and as the last step.
- [ ] **Step 5:** tests PASS; commit `feat(mobile): day chips and week strip`.

---

## Phase D — P2 Chips & filter sheet

### Task D.1: `lib/periods.ts` + `FilterChips` / `FilterSheet`

**Files:** Create `lib/periods.ts`, `components/mobile/FilterChips.tsx`, `FilterSheet.tsx`; Test `tests/mobile-periods.test.ts`

- [ ] **Step 1: Failing test:** `periodRange("this_month", "2026-10-20")` returns the Jalali month bounds as ISO (`{from:"2026-09-23", to:"2026-10-22"}` — Mehr 1405 starts 2026-09-23; confirm with `lib/jalali.ts` and use its real output); `periodRange("last_7_days", today)`; `periodRange("custom", …)` passes through.
- [ ] **Step 2:** FAIL. **Step 3:** implement `PERIODS = ["today","yesterday","last_7_days","this_month","last_month","custom"]` with Persian labels and `periodRange` built on `lib/jalali.ts` helpers (`toJalali`, `jalaliToIsoDate`).
- [ ] **Step 4:** `FilterChips({ groups })`: horizontally scrolling single-row of toggle chips (44 px), one group per filter (`single` or `multi`), with an active-count badge on «فیلترها»; `FilterSheet` holds the rarer filters as chip groups and a «اعمال» sticky action (one tap closes and applies; «پاک کردن» clears). **No `<select>` inside either.**
- [ ] **Step 5:** adopt: `CustomerFilters` (salespeople → multi chips), `PaymentsPanel` filters (method, period, voided), `InventoryBoard` sort select → 3 sort chips, `ComplaintsPanel` status, `ChequesBoard` status, `OrderPipeline` filters, `CrmBoard` views (`crm-views` toolbar already chip-like; just ensure 44 px), accounting date ranges via `periods`. One commit per page; `select` count in the audit falls.
- [ ] **Step 6:** commit messages `feat(mobile): chip filters in <page>`; lessons.

---

## Phase E — P6 Swipe rows and P7 Decision decks

### Task E.1: `lib/swipe.ts` — gesture model

**Files:** Create `lib/swipe.ts`; Test `tests/mobile-swipe.test.ts`

- [ ] **Step 1: Failing test** — pure decision function, RTL-aware:
```ts
import { decide } from "@/lib/swipe";
const cfg = { threshold: 72, commit: 140, rtl: true };
it("a short drag does nothing; reveal past threshold; commit past commit", () => {
  expect(decide({ dx: 20 }, cfg)).toEqual({ state: "idle" });
  expect(decide({ dx: 90 }, cfg)).toEqual({ state: "reveal", side: "start" });
  expect(decide({ dx: 200 }, cfg)).toEqual({ state: "commit", side: "start" });
});
it("RTL mirrors: dragging right is the 'end' side in LTR but 'start' in RTL", () => {
  expect(decide({ dx: -90 }, cfg)).toEqual({ state: "reveal", side: "end" });
  expect(decide({ dx: 90 }, { ...cfg, rtl: false })).toEqual({ state: "reveal", side: "end" });
});
it("a mostly-vertical gesture is a scroll, not a swipe", () => {
  expect(decide({ dx: 100, dy: 90 }, cfg)).toEqual({ state: "idle" });
});
```
- [ ] **Step 2:** FAIL. **Step 3:** implement `decide({dx,dy=0}, {threshold,commit,rtl})` returning `idle | reveal | commit` with `side: "start"|"end"` (start = the reading-direction start). Rule: `|dy| > |dx| * 0.6` → idle. Same file exports `LONG_PRESS_MS = 450`.
- [ ] **Step 4:** PASS; commit `feat(mobile): swipe gesture model`.

### Task E.2: `SwipeRow` and adoption

**Files:** Create `components/mobile/SwipeRow.tsx`; Modify `components/today/TaskRow.tsx`, `components/pocket/Pocket.tsx`, `components/sales/ChequesBoard.tsx`, `components/driver/DriverRun.tsx`, `components/board/BoardMobile.tsx`, `components/sales/OrderPipeline.tsx`

- [ ] **Step 1:** `SwipeRow({ start, end, children, onLongPress })`: pointer-events implementation using the capture/threshold/click-guard mechanics documented at the top of `components/board/useCardDrag.ts` (capture on the row, travel threshold, 60 ms click guard after release). `start`/`end` are `{ label, icon, tone, run }`; every action runs through the 5 s undo (`useHeldSave` + toast «بازگردانی»). Buttons for the same actions stay available for keyboard/AT users (`aria-label`s) and for `md:` and up.
- [ ] **Step 2:** mappings (start = reading-start side, i.e. right in RTL): `TaskRow` start «انجام شد» (opens `outcomeFlow`), end «به بعد» (snooze to tomorrow 10:00); `Pocket` reminders start «انجام شد» / end «فردا»; `ChequesBoard` start «وصول شد» / end «برگشت خورد» (the existing status transitions); `DriverRun` stop start «رسیدم» (opens `DeliveryFlow`) / end «رد کردن» (skip with reason chips); `OrderPipeline`/`BoardMobile` card start = advance stage, end = back.
- [ ] **Step 3:** long-press on a row enters **selection mode** (checkbox column, bottom action bar «انتخاب شده: N» with the page's bulk actions). First adopter: `ChequesBoard` and `/sales/orders` (bulk advance).
- [ ] **Step 4:** tests on the pure model only (E.1). Manual: verify the swipe does not fight page scroll or the `useSwipeDismiss` sheet gesture (the sheet listens on the sheet body; rows inside sheets must not use `SwipeRow`).
- [ ] **Step 5:** commits per page; lessons.

### Task E.3: `DecisionDeck`

**Files:** Create `components/mobile/DecisionDeck.tsx`; Modify pages per queue below

- [ ] **Step 1:** `DecisionDeck<T>({ items, render, actions:{ yes, no, later }, onDecide })`: shows the top card large with context; buttons ≥ 52 px under it (✓ / ✗ / «بعداً») **and** the same as swipes; progress «۳ از ۱۲»; each decision goes through `useHeldSave` with the 5 s undo toast, then the next card slides in. Empty state: «همه تصمیم‌ها گرفته شد» with the count decided.
- [ ] **Step 2:** first queue — **credit approvals** (`GET /api/admin/credit-approvals`, `POST …/:id/decide`): card shows customer, requested limit, current balance, last payment; approve/reject (reject asks one reason chip step, the way TapFlow does for destructive answers). Surface as a Briefing action card for managers («۴ مورد منتظر تصمیم») linking to the deck sheet.
- [ ] **Step 3:** **CRM duplicates** (`/api/crm/businesses/dedupe`): card shows the two records side by side (name, phone, area); ✓ «ادغام» / ✗ «جدا هستند» / «بعداً». Verify the endpoint's request shape before wiring.
- [ ] **Step 4:** **Cheques due** (status filter on `/api/cheques`): ✓ «وصول شد» / ✗ «برگشت خورد» / «بعداً». **Complaints triage** (`/api/sales/complaints/:id`): chips «در حال بررسی / رفع شد / رد شد».
- [ ] **Step 5:** one test per queue's pure mapping (`decision → request body`), written before the component. Commits per queue.

---

## Phase F — P8 Map select

**Files:** `app/(shell)/planner/page.tsx`, `app/(shell)/leads/page.tsx`, `components/LeadsMap.tsx`, `PlannerRouteMap.tsx`, `lib/geo.ts`; Create `lib/mapSelect.ts`; Test `tests/mobile-map-select.test.ts`

- [ ] **Step 1: Failing test** for pure helpers on top of `distanceKm` from `lib/geo.ts`: `nearestN(points, origin, n)` returns the n closest ids ordered; `withinRadius(points, center, km)`; `toggle(set, id)`.
- [ ] **Step 2:** FAIL → implement `lib/mapSelect.ts` → PASS.
- [ ] **Step 3:** UI: a **selection mode** on the map: tapping a pin toggles it (selected pins get a ring + number badge in tap order); a bottom tray (`.sheet-on-mobile`, collapsed to one line «۵ انتخاب شد · ۱۲٫۴ کم») offers «نزدیک‌ترین ۱۰»، «دایره…» (tap a centre, drag the radius), «پاک کردن», and the page's primary action via `StickyAction`. Reordering stops = drag handles in the tray list (reuse `useCardDrag`). The existing list stays as the fallback / desk view.
- [ ] **Step 4:** adopt first in `/leads` (build a run from pins → `LeadRunPlannerTabFlow` already assigns it), then `/planner`.
- [ ] **Step 5:** `npx tsc --noEmit`, lint, vitest; manual 375 px check that the tray never covers the geolocate/zoom controls (see the `pinned-bottom` notes in `globals.css`). Commits; lessons.

---

## Phase G — P9 Auto-triggers and action cards

### Task G.1: Arrival opens the delivery flow

**Files:** `components/GeofenceWatcher.tsx`, `components/driver/DriverRun.tsx`, `components/flows/DeliveryFlow.tsx` (from the TapFlow plan)

- [ ] **Step 1:** read `GeofenceWatcher` fully. Its prompt kinds are `customer | facility_arrive | lead`; the customer prompt currently asks a question with its own buttons. Change the `customer` prompt, **only when the customer is a pending stop on today's run**, to a one-line banner «به {name} رسیدید» with one button «ثبت تحویل» that opens `DeliveryFlow` for that stop (doc rule 17: auto-open when obviously next). Keep the 150 m trigger and the snooze constants.
- [ ] **Step 2:** test the pure decision: `shouldOffer(stops, customerId)` is true only for a pending stop. Commit `feat(driver): arrival opens the delivery flow`.
- [ ] **Step 3:** for `lead` arrivals the banner opens `LocationTapFlow` (already exists).

### Task G.2: Predictive action cards on the briefing

**Files:** Create `components/mobile/ActionCard.tsx`; Modify `components/today/Briefing.tsx`, `lib/repo/briefingCards.ts`

- [ ] **Step 1:** read `lib/repo/briefingCards.ts`, `lib/repo/churn.ts`, `lib/repo/forecast.ts`. Add card kinds: «ممکن است ریزش کند: {customer}» (churn risk) with one button «تماس بگیر» (opens the dialer and then `AfterCallFlow`), and «موعد سفارش مجدد: {customer}» (demand forecast) with «ساخت سفارش» (opens `orderQuickFlow` with that customer). Rank by existing scores; show at most 3.
- [ ] **Step 2:** `ActionCard({ title, why, primary, secondary })`: the *why* line is mandatory ("آخرین سفارش ۴۲ روز پیش، معمولاً هر ۲۸ روز") so the person trusts the suggestion; dismiss = swipe or «الان نه» which suppresses it for 7 days (server-side, reuse the dismiss mechanism `Briefing`/`TaskRow` already has).
- [ ] **Step 3:** test: card builder returns ≤ 3 cards, sorted, each with a non-empty `why`. Commit `feat(briefing): predictive action cards`.

### Task G.3: Act from the notification

**Files:** `public/sw.js` (read it first; the registration is `components/ServiceWorkerRegister.tsx`), `app/api/push/subscribe/route.ts`, `lib/repo/notifications.ts`

- [ ] **Step 1:** read how push payloads are built and what `notificationclick` does today. For notification kinds that map to a one-tap action (a reminder is due → «انجام شد» / «۱ ساعت بعد»; a cheque is due → «وصول شد»), add `actions` to `showNotification` and handle them in `notificationclick` with a `fetch` to the existing endpoint using `credentials: "include"`. Everything else keeps opening the app.
- [ ] **Step 2:** test the pure mapping `notificationActions(kind)`. Commit `feat(push): act from the notification`. (If action buttons are unsupported on the browser, the payload degrades to today's behaviour; no new failure mode.)

---

## Phase H — P10 Report cards

**Files:** Create `components/mobile/KpiCarousel.tsx`, `DrillSheet.tsx`; Modify `components/analysis/KpiStrip.tsx`, `ActionCenter.tsx`, `WhyDrilldown.tsx`, `components/accounting/AcctTable.tsx` and the accounting/analytics/dashboard pages

- [ ] **Step 1:** `KpiCarousel`: CSS scroll-snap row of cards (value, delta vs previous period, 7-point sparkline from `components/charts/Sparkline`), 80 % width so the next card peeks; dots for position. Tap a card → `DrillSheet` (the `.sheet-on-mobile` container) with the breakdown (the same data `WhyDrilldown` already computes) instead of navigating away.
- [ ] **Step 2:** `/sales/dashboard`, `/analytics`, `/sales/forecast`: KPI strip → carousel below `md`; long tables → `ResponsiveTable` from TapFlow Task 8.2; range pickers → `FilterChips` with `periods`.
- [ ] **Step 3:** accounting: `income-statement`, `balance-sheet`, `trial-balance` show a summary card per section (total + sign), tapping opens the `DrillSheet` with the lines; the ledger link is the last row.
- [ ] **Step 4:** test the pure card builder (given KPI rows → cards with correct delta sign/format). Commits per page; lessons.

---

## Phase I — P11 Admin presets

**Files:** `app/(shell)/sales/admin/users/page.tsx` (480 lines, 9 inputs), `groups/page.tsx`, `holidays/page.tsx`, `components/sales/CommissionEditor.tsx`

- [ ] **Step 1:** Users: «کاربر جدید» → role chips (`ROLES` labels) → display name + phone (the only typing) → creates the user with a generated one-time password shown once with «ارسال» (Web Share API; fallback copy button). Read `app/api/admin/users/route.ts` and `scripts/create-user.mjs` to see how passwords are created and whether first-login change exists; if it does not, record "force password change on first login" in `docs/future-features.md` rather than expanding this task.
- [ ] **Step 2:** Groups / commission tiers: «کپی از …» (copy-from an existing group or rate set, then edit only what differs) as the first action; steppers/`Keypad` for rates.
- [ ] **Step 3:** Holidays: month grid with tap-to-toggle days (no typing the date); title chosen from chips of common occasions, free text last.
- [ ] **Step 4:** pure tests for the copy-from mapping. Commits; lessons.

---

## Phase 10 — Distil the design rules (only after everything above worked)

**Gate — start only when ALL of these are true** (otherwise keep iterating on the earlier phases):

- [ ] `npm run check:mobile` passes, and `npm run audit:mobile` shows: `select` ≤ 15 % of baseline (the rest listed in `mobile-allowlist.json`, each with a reason), `nativeDate` = 0 outside the allowlist, `tinyTarget` = 0, `confirmDialog` = 0.
- [ ] Every pattern P1–P11 shipped on ≥ 2 real screens, and every TapFlow phase (1–7) shipped.
- [ ] A manual run-through at 375 px of one full day per role (driver, phone sales, field rep, owner), done on a real phone or device emulation, written up in the lessons file, with the taps counted for the ten most frequent tasks and compared with the interaction budgets above. Budgets that real use shows are wrong are corrected *in the rules*, not hidden.
- [ ] `docs/superpowers/plans/mobile-first-lessons.md` has entries for every phase.

### Task 10.1: Write `docs/mobile-first-principles.md`

Model it on `docs/tap-flow-principles.md` (it is the reference for form and tone). Required sections, in this order, filled from the lessons file and the shipped code, not from this plan:

- [ ] **1. Defaults at a glance** (table): the 8–10 rules a reviewer needs in 30 seconds.
- [ ] **2. Which pattern to use** — the decision table that makes the document useful:

| Situation | Pattern |
|---|---|
| Recording what just happened | TapFlow |
| Choosing a customer/product/place | SmartPicker |
| Entering a number | Keypad |
| Choosing a day | DayChips |
| Narrowing a list | FilterChips + FilterSheet |
| Acting on one row | SwipeRow |
| Judging a queue | DecisionDeck |
| Choosing places | Map select |
| Reading numbers | Report cards |
| Setting up reference data | Admin presets or a desk form |
| Anything else | start from the table's nearest row and write down why in the PR |

- [ ] **3. Anatomy** of the phone shell (bottom bar, quick actions, sticky action, safe areas, where sheets live) with a diagram.
- [ ] **4. The rules**, numbered like TapFlow's, each with one sentence of *why* from a real incident or lesson: thumb zone, no keyboard unless typing is the only way, recents before search, chips before selects, one gesture + undo instead of confirm, never gesture-only (every swipe has a button), RTL gesture mirroring, sheets not modals, offline behaviour (what queues), loading/empty/error states per pattern, copy rules (explicit labels, glossary).
- [ ] **5. Interaction budgets** (the table above, corrected with real data).
- [ ] **6. Look and feel**: sizes (44/52 px), spacing tokens, motion + reduced motion, contrast, the `.sheet-on-mobile` container, icon rule.
- [ ] **7. How to build one**: the pure model + thin component + test pattern, with the file layout used in this plan, and "where the recents live / what to log".
- [ ] **8. Where it does NOT apply**: desk-only surfaces and the allowlist policy (a file may keep a `<select>` only with a written reason in `scripts/mobile-allowlist.json`).
- [ ] **9. Anti-patterns**: native date/select on a primary mobile path, "are you sure?" dialogs, hover-only affordances, tables as the only view, fixed-position elements without safe-area padding, a gesture with no button, auto-focused keyboards, modals over sheets.
- [ ] **10. Checklist before shipping a page/component** (checkbox list, like TapFlow §9), including "run `npm run check:mobile`" and "375 px screenshot attached".
- [ ] **11. Parked ideas** → link `docs/future-features.md`.

### Task 10.2: Enforce it

**Files:** Create `scripts/check-mobile-rules.mjs`, `tests/mobile-rules.test.ts`; Modify `package.json`, `CLAUDE.md`, `docs/tap-flow-principles.md`, `README.md`

- [ ] **Step 1:** `check-mobile-rules.mjs` = the audit ratchet (`--check`) **plus** two structural checks: (a) every `components/mobile/*.tsx` has a matching pure model test in `tests/mobile-*.test.ts` or is listed as presentational-only; (b) no file outside the allowlist imports `JalaliDateInput` directly except `DayChips`/desk components. Failure messages cite the rule number in `mobile-first-principles.md`.
- [ ] **Step 2:** `tests/mobile-rules.test.ts` runs the check in vitest (so CI enforces it without a browser) and asserts every allowlist entry has a non-empty `reason` and the file still exists.
- [ ] **Step 3:** `package.json`: `"check:mobile": "node scripts/check-mobile-rules.mjs"` (replaces the Phase A script alias).
- [ ] **Step 4: Pointers** — `CLAUDE.md` (project instructions every session reads; **not** `AGENTS.md`, which `next dev` regenerates) gets a short section: *"UI work follows `docs/mobile-first-principles.md` (and `docs/tap-flow-principles.md` for record-what-happened flows). Run `npm run check:mobile` before committing UI changes."* Keep the existing auto-merge rule untouched. Add a cross-link from `docs/tap-flow-principles.md` §7 and from `README.md`.
- [ ] **Step 5:** verify by deliberately adding a `<select>` to a scratch component → check fails with a rule citation → revert. Commit `docs: mobile-first design rules and enforcement`.

### Task 10.3: Close out

- [ ] Update both plans' checkboxes; move `.zoocode` journal entries into `.zoocode/archive/<date>-mobile-first/`; list anything cut or deferred in `docs/future-features.md` with a reason.

---

## Self-review

| Brainstorm item | Where |
|---|---|
| 1 Decision queues | E.3 |
| 2 Swipe actions | E.1–E.2 |
| 3 Filter chips / sheet | D.1 |
| 4 Keypad | C.3 |
| 5 Smart pickers | C.1–C.2 |
| 6 Date chips / week strip | C.4 |
| 7 Camera/OCR, 8 Voice, 9 Paste-to-parse | **parked** → `docs/future-features.md` |
| 10 Map-first selection | F |
| 11 Auto-triggers, predictions | G.1–G.2 |
| 12 Phone shell, quick actions, notification actions | B, G.3 |
| 13 Report cards | H |
| 14 Admin presets | I |
| Final: design rules like TapFlow | Phase 10 |

**Open points each with a concrete check in its task:** real hrefs per role (B.1 test tells you), whether `normalizeSearch` exists (C.1), the holiday/weekend handling decision (C.4 — the option `skipHolidays` makes both behaviours explicit, tests cover both), dedupe endpoint request shape (E.3), push action support (G.3), password-change policy (I.1).

## Suggested order

1. TapFlow Phase 0 (other plan) and **Phase A** here — baseline first.
2. **B** (shell) and **C** (keypad, picker, day chips) — biggest daily-typing savings; these are what TapFlow flows reuse.
3. **D** (filters), then **E** (swipe, decks).
4. **G.1** once TapFlow Phase 1 has shipped; **F**, **H**, **I** as capacity allows.
5. **Phase 10** last, only through the gate.
