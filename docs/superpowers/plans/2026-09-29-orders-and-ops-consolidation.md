# Orders and the Day: Consolidating the Sales Surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn four menu entries that are really two pages into two pages with tab strips, so `/sales/board`, `/sales/journey`, `/sales/runs` and `/sales/deliveries` become redirects, and move one order's delivery-attempt history onto that order's own page.

**Architecture:** Wave 1 makes `/sales/orders` the host for three views selected by `?view=`, all three reading one `readOrders` result loaded once on the server. Wave 2 makes `/sales/schedule` the host for two views, folding the run planner into it. No API, schema, or migration change — every endpoint stays exactly where it is. The four old routes become `redirect()` calls, so bookmarks survive. `proxy.ts` is untouched: it gates by prefix and `isBatchAdmin` already covers the moved paths, so the redirect happens *after* the gate, and a `phone_sales` user is still bounced rather than landing on a tab host.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `node:sqlite` via `lib/db.ts`, Vitest. No new library.

**Spec:** `docs/superpowers/specs/2026-09-29-orders-and-ops-consolidation-design.md`

**Runs after:** `2026-09-29-leads-manager-only-driver-my-day.md`. That ordering is load-bearing — see Task 8.

---

## The shape of the code, before any task

| File | Responsibility | Task |
|---|---|---|
| `lib/viewParam.ts` | **NEW.** One `one()` helper and one view-name parser, so four pages stop hand-rolling the same thing. | 1 |
| `components/meridian/ViewTabs.tsx` | **NEW.** The in-page tab strip, in the `jmode` class the journey page already uses. | 1 |
| `app/(shell)/sales/orders/page.tsx` | Becomes the three-view host. One `readOrders`, three renders. | 2, 3 |
| `app/(shell)/sales/board/page.tsx` | Becomes `redirect("/sales/orders?view=board")`. | 4 |
| `app/(shell)/sales/journey/page.tsx` | Becomes `redirect("/sales/orders?view=journey")`. | 4 |
| `app/(shell)/sales/deliveries/page.tsx` | Becomes `redirect("/sales/orders")`. | 4 |
| `app/(shell)/sales/orders/[id]/page.tsx` | Gains the attempt-history section. | 5 |
| `app/(shell)/sales/schedule/page.tsx` | Becomes the two-view host. | 6 |
| `app/(shell)/sales/runs/page.tsx` | **Deleted**, its content moved into the `runs` view. | 6, 7 |
| `lib/pageMeta.ts` | Keeps the four redirecting entries; `/planner`'s overview string changes. | 7, 8 |
| `lib/appNav.ts` | Loses four entries. | 7 |
| `lib/repo/briefing.ts:192` | The one hardcoded href in a non-page file. | 7 |
| `components/meridian/RevealRoute.tsx` | The three stale reveal keys. | 7 |

### The one open question, decided

The spec flags §8: **`RunTimeline`'s tab placement.** It shows runs in progress and recently finished — a third question from the month ahead, neither "what happened on the 14th" nor "assign these orders".

**Decision: it stays inside the `runs` view.** A third tab would mean `/sales/schedule?view=history`, and the header's own tab row (driven by the nav group) would then show a group whose members are three *views* of one page — a second tab row answering the same question as the first. The spec calls the in-`runs` placement "the conservative choice", and it is also the one that keeps `PageHeader`'s `siblings.length > 1` invariant intact without a new mechanism. Revisit if the timeline proves to be read more than the month is.


---

## Wave 1 — Orders: one page, three views

### Task 1: The two shared pieces

**Files:**
- Create: `lib/viewParam.ts`
- Create: `components/meridian/ViewTabs.tsx`
- Test: `tests/view-param.test.ts` (new)

**Why these two files exist.** Four pages are about to read a `?view=` param, and `journey/page.tsx:29` already hand-rolls the "a query parameter may arrive repeated" guard. A copy per page is the same drift `lib/roles.ts` documents. And a tab strip is a UI element with a real contract — it must mark the current tab for screen readers, not just colour it — so it is written once rather than four times.

- [ ] **Step 1: Write the failing test**

Create `tests/view-param.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { one, oneOf } from "@/lib/viewParam";

/** A `?view=` param, read once and the same way everywhere.
 *
 *  Next hands over a string OR an array, because a URL may repeat the key
 *  (`?view=one&view=all`). `Number([..])` quietly produces NaN and
 *  `view === "board"` quietly fails, so a page that forgets the guard shows the
 *  default view for a URL that asked for another. Four pages are about to read this
 *  param, so it is read once, here. */
describe("reading a ?view= param", () => {
  it("takes the first when Next hands over an array", () => {
    expect(one({ view: ["board", "journey"] })).toBe("board");
  });

  it("passes a single string through", () => {
    expect(one({ view: "journey" })).toBe("journey");
  });

  it("is undefined when absent", () => {
    expect(one({})).toBeUndefined();
    expect(one({ other: "x" })).toBeUndefined();
  });

  it("falls back to the default for an unknown value", () => {
    expect(oneOf({ view: "nonsense" }, ["board", "journey"], "board")).toBe("board");
  });

  it("accepts a known value", () => {
    expect(oneOf({ view: "journey" }, ["board", "journey"], "board")).toBe("journey");
  });

  it("falls back when the param is absent, or an empty array", () => {
    expect(oneOf({}, ["board"], "board")).toBe("board");
    expect(oneOf({ view: [] }, ["board"], "board")).toBe("board");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/view-param.test.ts`

Expected: FAIL — `Cannot find module '@/lib/viewParam'`.

- [ ] **Step 3: Write `lib/viewParam.ts`**

```ts
/** Reading a `?view=` param, once.
 *
 *  A page selected by a query param needs three things and each is easy to get wrong:
 *  the param may arrive REPEATED (`?view=one&view=all`), in which case Next hands over an
 *  array and `Number([..])` quietly produces NaN; the value may be ABSENT, in which case
 *  the page has a default view; and it may be a value the page does not recognise, in
 *  which case an unguarded switch falls through to a branch that renders nothing.
 *
 *  `journey/page.tsx` hand-rolled the first of these. Four pages are about to read the
 *  param, so it is read once, here, and every page gets all three. */

export type SearchParams = Record<string, string | string[] | undefined>;

/** One value, or undefined. Taking the first beats letting an array surprise you. */
export function one(params: SearchParams, key = "view"): string | undefined {
  const v = params[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

/** One of a known set, or the default. A param is user input, and an unrecognised value
 *  must land on a real view rather than on nothing. */
export function oneOf<const T extends readonly string[]>(
  params: SearchParams,
  allowed: T,
  fallback: T[number],
  key = "view",
): T[number] {
  const v = one(params, key);
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback;

- [ ] **Step 5: Write `components/meridian/ViewTabs.tsx`**

```tsx
import Link from "next/link";

/** The in-page view strip, under the header's own tab row.
 *
 *  Two rows, answering two different questions, and both are deliberate (spec §6). The
 *  header row is the nav group's siblings — a way to LEAVE this area. This row is the
 *  page's own views — a way to read THIS data differently. Merging them would leave a
 *  reader with no way out of the area and no way to change lens inside it.
 *
 *  aria-current="page" rather than a class alone: the visual difference between the
 *  selected pill and the others is not something a screen reader can announce, and this is
 *  the only thing on the row that says which view is showing. */
export interface ViewTab {
  /** The `?view=` value. "" is the default view and is written as the bare path. */
  value: string;
  label: string;
  /** The route this tab lives on, so the strip is reusable by both hosts. */
  route: string;
}

export default function ViewTabs({ tabs, current }: { tabs: ViewTab[]; current: string }) {
  const href = (t: ViewTab) => (t.value === "" ? t.route : `${t.route}?view=${t.value}`);
  return (
    <nav className="jmode" aria-label="نمای این صفحه">
      {tabs.map((t) => (
        <Link
          key={t.value || "default"}
          className={`btn ${current === t.value ? "solid" : "ghost"}`}
          aria-current={current === t.value ? "page" : undefined}
          href={href(t)}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/viewParam.ts components/meridian/ViewTabs.tsx tests/view-param.test.ts
git commit -m "feat(sales): one place to read a ?view= param, and one tab strip

Four pages are about to select a view by query param. journey/page.tsx already
hand-rolled the repeated-key guard; a copy per page is the drift lib/roles.ts
documents. A repeated ?view= is not a hypothetical -- Next hands over an array and
Number([..]) quietly produces NaN.

The strip carries aria-current, not just a class: the difference between the selected

### Task 2: The failing test for the orders host

**Files:**
- Test: `tests/orders-tabs.test.ts` (new)

The test comes before the implementation because most of it is **source-text assertion** — the redirect targets and the tab wiring cannot be reached any other way without rendering a page, and `vitest.config.mts` runs in a node environment where nothing renders. That is the same constraint the spec records in spec 1 §5, applied here.

- [ ] **Step 1: Write the test**

Create `tests/orders-tabs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** Three pages were one query, listed adjacently in the same nav group.
 *
 *  /sales/orders, /sales/board and /sales/journey each called readOrders over the same
 *  scope, with limits 100 / 60 / 60, and appeared as three menu items next to each other.
 *  The header already renders the nav group's ready tabs as a tab row, so a manager
 *  opening /sales/orders was already looking at something shaped like a tab host. This
 *  makes the markup match what the header already promised.
 *
 *  The REDIRECT test is the one that matters. A consolidation that silently 404s an old
 *  bookmark is worse than no consolidation — so each old href must land on the right host
 *  AND the right view, not merely on the host. */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(`${ROOT}/${p}`, "utf8");

describe("the orders host serves three views", () => {
  const host = read("app/(shell)/sales/orders/page.tsx");

  it("names all three views", () => {
    for (const v of ["board", "journey"]) {
      expect(host, `the host must know the ${v} view`).toContain(`"${v}"`);
    }
  });

  it("renders each view's own component", () => {
    expect(host, "the list view is OrdersPockets").toContain("OrdersPockets");
    expect(host, "the board view is OrderPipeline").toContain("OrderPipeline");
    expect(host, "the journey view is OrderSpine").toContain("OrderSpine");
    expect(host, "the journey view also carries the funnel").toContain("OrderFunnel");
  });

  it("reads orders ONCE, not once per view", () => {
    // Three pages, one table, one reader function. If the host grows a second
    // readOrders call the consolidation has only changed the URLs.
    expect(host.match(/readOrders\(/g) ?? []).toHaveLength(1);
  });

  it("all three views use the same limit", () => {
    // 100 / 60 / 60 meant the two quieter pages silently truncated. 100 is the one that
    // was not truncating, so it is the one the host uses.
    expect(host).toMatch(/limit:\s*100\b/);
    expect(host).not.toMatch(/limit:\s*60\b/);
  });

  it("still carries the tab strip", () => {
    expect(host).toContain("ViewTabs");
  });
});

describe("the three old order hrefs redirect to the right host AND view", () => {
  const CASES: [string, string][] = [
    ["app/(shell)/sales/board/page.tsx", "/sales/orders?view=board"],
    ["app/(shell)/sales/journey/page.tsx", "/sales/orders?view=journey"],
    ["app/(shell)/sales/deliveries/page.tsx", "/sales/orders"],
  ];

  for (const [file, target] of CASES) {
    it(`${file} → ${target}`, () => {
      const src = read(file);
      expect(src, "a redirect page must not also render").not.toContain("PageHeader");
      expect(src).toMatch(/redirect\(\s*["']/);
      // The exact target string, so /sales/board cannot land on a bare /sales/orders
      // and lose the view.
      expect(src.replace(/\s+/g, " ")).toContain(`redirect("${target}")`);
    });
  }

  it("each redirect page still has a PAGE_META entry", () => {
    // tests/pageMeta.test.ts walks app/(shell) and fails on a route with no entry AND on
    // an entry whose route has gone. The routes resolve, so the entries must stay.
    const meta = read("lib/pageMeta.ts");
    for (const r of ["/sales/board", "/sales/journey", "/sales/deliveries"]) {
      expect(meta, `${r} must keep its meta`).toContain(`"${r}":`);
    }
  });
});

describe("the menu no longer offers the merged routes", () => {
  const nav = read("lib/appNav.ts");
  it("has no href entries for the four merged routes", () => {
    for (const href of ["/sales/board", "/sales/journey", "/sales/runs", "/sales/deliveries"]) {
      expect(nav, `${href} must be gone from appNav`).not.toMatch(
        new RegExp(`href:\\s*"${href.replace("/", "\\/")}"`),
      );
    }
  });
  it("keeps the briefing's link pointing at a real host", () => {
    // lib/repo/briefing.ts is a server DATA file, not a page, so a page-by-page review
    // never sees it -- and it is the status row a manager taps all day.
    const briefing = read("lib/repo/briefing.ts");
    expect(briefing, "the briefing must not link at a route that is now a redirect")

### Task 3: Make `/sales/orders` the host

**Files:**
- Modify: `app/(shell)/sales/orders/page.tsx`
- Test: `tests/orders-tabs.test.ts` (from Task 2)

- [ ] **Step 1: Add the imports, drop the local `one()`**

In `app/(shell)/sales/orders/page.tsx`, add:

```ts
import OrderPipeline, { type PipelineOrder } from "@/components/sales/OrderPipeline";
import OrderSpine from "@/components/sales/OrderSpine";
import OrderFunnel from "@/components/sales/OrderFunnel";
import { readJourney, buildJourney } from "@/lib/orderJourney";
import { eventsByStep } from "@/lib/orderEvents";
import { buildFunnel } from "@/lib/orderFunnel";
import { readOrderEvents, readFunnelRows } from "@/lib/repo/journey";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orderStateMachine";
import ViewTabs, { type ViewTab } from "@/components/meridian/ViewTabs";
import { oneOf, one, type SearchParams } from "@/lib/viewParam";
```

`faToman` joins the existing `@/lib/format` import; `faJalaliDate` and `faJalaliDateTime` already come from `@/lib/jalali` on the board/journey views. Delete the local `function one(...)` at lines 53-55 — `lib/viewParam.ts` owns it now.

- [ ] **Step 2: Add the view constant and the tab list**

After `export const dynamic = "force-dynamic";`:

```ts
/** The three ways to read the same orders, selected by `?view=`.
 *
 *  `""` is the default: the pocket list, which is what this route has always shown. The
 *  other two were their own routes over their own `readOrders` call at a lower limit.
 *  One table, one reader, one limit, three lenses. */
const VIEWS = ["", "board", "journey"] as const;
type OrdersView = (typeof VIEWS)[number];

const VIEW_TABS: ViewTab[] = [
  { value: "", label: "فهرست", route: "/sales/orders" },
  { value: "board", label: "تابلو", route: "/sales/orders" },
  { value: "journey", label: "پیگیری", route: "/sales/orders" },
];
```

- [ ] **Step 3: Read the view, and reuse the existing `one()` call site**

In the component signature, add after the `searchParams` destructuring:

```ts
  const params = (await searchParams) as SearchParams;
  const view: OrdersView = oneOf(params, VIEWS, "");
  const customerParam = one(params, "customer");
```

and replace:

- [ ] **Step 5: Add the three view functions above `OrdersPage`**

These are server functions in the same file — a server component returning server components, so no new files. `readOrders` returns `OrderSummary[]`; import that type from `@/lib/orders` alongside the function.

**`ListView` — the pocket list, moved verbatim out of the current page body.** The `kblock` currently rendered by `OrdersPage` moves here unchanged, taking `orders`, `onARun` and `focused` as props:

```tsx
/** «فهرست» — the pocket list, which is what this route has always shown. */
function ListView({
  orders,
  onARun,
  focused,
}: {
  orders: OrderSummary[];
  onARun: Set<number>;
  focused: { id: number; business_name: string } | null;
}) {
  const customerCount = new Set(orders.map((o) => o.customer_name)).size;
  return (
    <div className="kblock">
      {/* ... the existing kblock body, moved here verbatim, unchanged ... */}
    </div>
  );
}
```

**`BoardView` — the pipeline, moved out of `board/page.tsx`:**

```tsx
/** «تابلو» — the stage pipeline, which was /sales/board.
 *
 *  Same orders as the list, read once. The card's own fields are unchanged; what changed
 *  is that they come from the host's single readOrders rather than this page's own,
 *  truncated to 60. */
function BoardView({ orders, onARun }: { orders: OrderSummary[]; onARun: Set<number> }) {
  const board: PipelineOrder[] = orders.map((o) => ({
    id: o.id,
    order_no: o.order_no,
    customer_name: o.customer_name,
    salesperson_name: o.salesperson_name,
    status: o.status,
    order_date: o.order_date,
    total_toman: o.total_toman,
    paid_toman: o.paid_toman,
    payment_status: o.payment_status,
    kg: o.kg,
    line_count: o.line_count,
    on_run: onARun.has(o.id),
  }));

  return (
    <div className="kblock">
      <div className="bhead">
        <div>
          <h2>خط سفارش‌ها</h2>
          <div className="n">
            کارت را بکشید تا مرحله‌اش عوض شود · روی کارت بزنید تا پردازش شود

**`JourneyView` — the spine and the funnel, moved out of `journey/page.tsx`:**

```tsx
/** «پیگیری» — one order's life, or the funnel of them all. Which was /sales/journey.
 *
 *  A server function, so it cannot read search params itself: `mode` and
 *  `askedOrderId` come in as props from the host. The mode that page called
 *  `one`/`all` survives as `?mode=all` on the host -- a DIFFERENT key from the host's
 *  own `?view=`, so `oneOf(params, VIEWS, "")` still resolves the outer view. Two params
 *  would both be called `view` and the reader takes the first, silently losing the mode.
 */
function JourneyView({
  db,
  scope,
  orders,
  mode,
  askedOrderId,
}: {
  db: DatabaseSync;
  scope: { sql: string; params: number[] };
  orders: OrderSummary[];
  /** "one" is the spine for a single order; "all" is the funnel. `?view=all` still
   *  selects it, so a funnel link survives the move. */
  mode: "one" | "all";
  askedOrderId: number | undefined;
}) {
  /* Chosen from the list this session can already see, so the journey cannot be used to
     probe for an order in another group by its id -- the scope decision stays in
     orderFilter and is not re-derived here. */
  const focus = orders.find((o) => o.id === askedOrderId) ?? orders[0];
  const journey = mode === "one" && focus ? readJourney(db, focus.id) : null;
  const nodes = journey ? buildJourney(journey) : [];
  const current = nodes.find((n) => n.state === "current");
  const events = journey && focus ? eventsByStep(readOrderEvents(db, focus.id)) : null;
  /* The same scope as the list above: the funnel cannot count an order the list hides. */
  const funnel = mode === "all" ? buildFunnel(readFunnelRows(db, scope)) : null;
  const keep = focus ? `&order=${focus.id}` : "";

  return (
    <div className="kblock">
      <div className="bhead">
        <div>
          <h2>{mode === "all" ? "همهٔ سفارش‌ها" : "پیگیری سفارش"}</h2>
          <div className="n">{/* the existing subtitle, unchanged */}</div>
        </div>
        <div className="acts">
          <nav className="jmode" aria-label="نمای مسیر">
            <Link
              className={`btn ${mode === "one" ? "solid" : "ghost"}`}
              aria-current={mode === "one" ? "page" : undefined}
              href={`/sales/orders?view=journey${keep}`}
            >
              این سفارش
            </Link>
            <Link
              className={`btn ${mode === "all" ? "solid" : "ghost"}`}
              aria-current={mode === "all" ? "page" : undefined}
              href={`/sales/orders?view=journey&mode=all${keep}`}
            >
              همهٔ سفارش‌ها
            </Link>
          </nav>
          {mode === "one" && focus ? (
            <Link className="btn ghost" href={`/sales/orders/${focus.id}`}>
              صفحهٔ سفارش
            </Link>
          ) : null}
        </div>
      </div>

      {mode === "all" && funnel ? (
        <div className="kblock__body">
          <OrderFunnel stages={funnel} />
        </div>
      ) : (
        <>
          {orders.length > 0 && (
            <div className="picker">
              <span className="picker__label">سفارش:</span>
              <div className="picker__row">
                {orders.slice(0, 12).map((o) => (
                  <Link
                    key={o.id}
                    href={`/sales/orders?view=journey&order=${o.id}`}
                    className={`picker__chip${o.id === focus?.id ? " on" : ""}`}
                  >
                    <span className="mono">{faNum(Number(o.order_no.split("-")[1] ?? 0))}#</span>
                    <span className="picker__who">{o.customer_name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {focus && journey && events ? (
            <>
              {/* What this order IS, before how far along it is. */}
              <dl className="jsum">
                <div><dt>مشتری</dt><dd>{focus.customer_name}</dd></div>
                <div><dt>مبلغ</dt><dd className="mono">{faToman(focus.total_toman)}</dd></div>
                <div><dt>وزن</dt><dd className="mono">{faNum(focus.kg)} کیلو</dd></div>

- [ ] **Step 6: Replace `OrdersPage`'s body with the branch**

In Step 3, add the two extra param reads alongside `customerParam`:

```ts
  const orderParam = one(params, "order");
```

and in Step 4, store the scope in a local so it is built once:

```ts
  const scope = orderFilter(session);
  const orders = readOrders(db, scope, { limit: 100, customerId: focused?.id });
```

Then replace everything from `return (` to the end of the file in `OrdersPage` with:

```tsx
  const mode = one(params, "mode") === "all" ? "all" : "one";
  const askedOrderId = orderParam !== undefined && /^\d+$/.test(orderParam) ? Number(orderParam) : undefined;

  return (
    <>
      <PageHeader route="/sales/orders" />
      <ViewTabs tabs={VIEW_TABS} current={view} />
      {view === "board" ? (
        <BoardView orders={orders} onARun={onARun} />
      ) : view === "journey" ? (
        <JourneyView
          db={db}
          scope={scope}
          orders={orders}
          mode={mode}
          askedOrderId={askedOrderId}
        />
      ) : (
        <ListView orders={orders} onARun={onARun} focused={focused} />
      )}
    </>
  );
}
```

`askedOrderId` reads `?order=`, not `?customer=` — the journey's own picker wrote `?order=`, and that must keep working.

- [ ] **Step 7: Update `OrdersPage`'s doc comment**

There is none today; add one above the function:

```tsx
/** سفارش‌ها, in three views of one read.
 *
 *  The pocket list, the stage board and the order journey were three routes over one
 *  `readOrders` call, at limits 100 / 60 / 60, listed adjacently in the same nav group.
 *  The header already renders that group's tabs as a row, so this page already looked
 *  like a tab host. It is one now, and the ?view= param survives a reload and can be
 *  linked — the mechanism /sales/journey shipped, and this is where it moved to. */
```

- [ ] **Step 8: Type-check and run the test**

Run: `npx tsc --noEmit && npx vitest run tests/orders-tabs.test.ts`


### Task 4: The three old routes become redirects

**Files:**
- Replace: `app/(shell)/sales/board/page.tsx`
- Replace: `app/(shell)/sales/journey/page.tsx`
- Replace: `app/(shell)/sales/deliveries/page.tsx`
- Delete: `app/(shell)/sales/board/loading.tsx`, `journey/loading.tsx`, `deliveries/loading.tsx` (each beside its page)

**The redirect test is the one that matters.** A consolidation that silently 404s an old bookmark is worse than no consolidation. All three old hrefs must land on the right host *and the right view* — not just on the host.

- [ ] **Step 1: Write the redirect pages**

`app/(shell)/sales/board/page.tsx`, in full:

```tsx
import { redirect } from "next/navigation";

/** /sales/board is now the «تابلو» view of /sales/orders.
 *
 *  A redirect, not a deletion: the board is one of the three ways to read one table, and
 *  a bookmark, a shared link or a manager's muscle memory all still point here. A 404
 *  would be a worse answer than the extra hop.
 *
 *  The view travels WITH the redirect. /sales/board → a bare /sales/orders would show the
 *  pocket list, which is not what the person who clicked expected -- a consolidation that
 *  changes what a link means is not a consolidation. */
export default function BoardPage() {
  redirect("/sales/orders?view=board");
}
```

`app/(shell)/sales/journey/page.tsx`, in full:

```tsx
import { redirect } from "next/navigation";

/** /sales/journey is now the «پیگیری» view of /sales/orders.
 *
 *  A redirect, for the reason board/page.tsx gives. The old page's own `?view=one|all`
 *  switch did NOT survive: a deep link into the funnel arrives at the spine instead, and
 *  the mode picker is one click away. Carrying it would mean reading searchParams and
 *  rebuilding the query string, which is not worth the surface for a link nobody has
 *  bookmarked. Named here rather than hidden. */
export default function JourneyPage() {
  redirect("/sales/orders?view=journey");
}
```

`app/(shell)/sales/deliveries/page.tsx`, in full:

```tsx
import { redirect } from "next/navigation";

/** /sales/deliveries is gone, and its content went in two directions.
 *
 *  `deliveries` is keyed by order_id + seq: it is the history of attempts on ONE order --
 *  status, planned vs actual arrival, fail and delay reasons, receiver, signature, photo,
 *  GPS. That belongs on the order, and Task 5 puts it there.
 *
 *  The cross-order exception queue does NOT move here. It already exists, as the `retry`
 *  panel on the /today briefing, and it answers a different question -- "what needs
 *  attention today" rather than "what happened to this one". Splitting it this way is the
 *  point: one order's history on the order, today's queue on the day. */
export default function DeliveriesPage() {
  redirect("/sales/orders");
}
```

- [ ] **Step 2: Delete the three orphaned `loading.tsx` files**

A `loading.tsx` beside a page that only redirects is dead weight. `tests/pageMeta.test.ts:77-84` walks every static route and requires one, but its exemption is `if (/redirect\(["'`]/.test(src) && !src.includes("PageHeader")) return false;` — which these pages now match, so the files are optional. Delete them anyway: the spec names this as risk #2 ("a `loading.tsx` orphaned by its route's move, producing a 404 on a slow connection").

```bash
git rm "app/(shell)/sales/board/loading.tsx" "app/(shell)/sales/journey/loading.tsx" "app/(shell)/sales/deliveries/loading.tsx"
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run tests/orders-tabs.test.ts tests/pageMeta.test.ts`

Expected: the three redirect cases in `orders-tabs.test.ts` now PASS. `pageMeta.test.ts` must stay green — the routes still resolve, so their `PAGE_META` entries stay and no entry has gone stale.

- [ ] **Step 4: Commit**

```bash
git add -A "app/(shell)/sales/board" "app/(shell)/sales/journey" "app/(shell)/sales/deliveries"
git commit -m "refactor(sales): board, journey and deliveries redirect to their host

A redirect, not a deletion: the board and the journey are two of the three ways to
read one table, and a bookmark, a shared link or a manager's muscle memory all still
point here. A 404 would be a worse answer than the extra hop.

Each carries its view WITH it. /sales/board to a bare /sales/orders would show the
pocket list, which is not what the person who clicked expected -- a consolidation that

### Task 5: The delivery history lands on the order

**Files:**
- Create: `lib/repo/orderDeliveries.ts`
- Modify: `app/(shell)/sales/orders/[id]/page.tsx`
- Test: `tests/order-delivery-history.test.ts` (new)

**Why a new repo function.** `listDeliveries(orgId, { order_id })` already exists and does the right query, but it is a whole-org read the page would then filter, and it selects `d.*` — photo and signature paths for rows the page does not show. A purpose-built read states exactly what the history table needs, and gives the reason codes their labels in one place.

- [ ] **Step 1: Write the failing test**

Create `tests/order-delivery-history.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-orderhist-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { readOrderDeliveryHistory } = await import("@/lib/repo/orderDeliveries");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

/** One order's attempts, oldest first, with the reason each one failed for.
 *
 *  `deliveries` is keyed by order_id + seq: the history of attempts on ONE order. It was
 *  listed on a cross-order page at /sales/deliveries, where it answered "what happened
 *  recently" and not "what happened to this". The order's own page contained ZERO
 *  references to it -- a gap, not a page. */
describe("an order's delivery history", () => {
  const org = 4;

  function seed() {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (${org},'H','h','2026-01-01')`);
    db.exec(`INSERT INTO groups (id,name,slug,created_at,organization_id) VALUES (40,'G','g','2026-01-01',${org})`);
    db.exec(`INSERT INTO customers (id,customer_code,business_name,lat,lng,synced_at,organization_id,group_id)
             VALUES (60,'C-1','فروشگاه',35.7,51.4,'2026-01-01',${org},40)`);
    db.exec(`INSERT INTO orders (id,order_no,customer_id,status,order_date,created_by,organization_id,created_at)
             VALUES (900,'O-900',60,'CONFIRMED','2026-01-01',1,${org},'2026-01-01')`);
    return db;
  }

  it("returns every attempt for that order, oldest first", () => {
    const db = seed();
    const ins = db.prepare(
      `INSERT INTO deliveries (organization_id, order_id, seq, status, planned_arrival, actual_arrival, created_at)
       VALUES (?, 900, ?, ?, ?, ?, ?)`,
    );
    ins.run(org, 1, "FAILED", "2026-01-01T09:00:00Z", null, "2026-01-01T09:30:00Z");
    ins.run(org, 2, "DELIVERED", "2026-01-02T09:00:00Z", "2026-01-02T09:12:00Z", "2026-01-02T09:20:00Z");

    const rows = readOrderDeliveryHistory(getDb(), org, 900);
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(rows[0].status).toBe("FAILED");
    expect(rows[1].actual_arrival).toBe("2026-01-02T09:12:00Z");
  });

  it("is empty for an order that has never shipped", () => {
    seed();
    expect(readOrderDeliveryHistory(getDb(), org, 901)).toEqual([]);
  });

  it("never returns another order's attempts", () => {
    const db = seed();
    db.prepare(
      `INSERT INTO orders (id,order_no,customer_id,status,order_date,created_by,organization_id,created_at)
       VALUES (901,'O-901',60,'CONFIRMED','2026-01-01',1,${org},'2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO deliveries (organization_id, order_id, seq, status, created_at) VALUES (?, 901, 1, 'DELIVERED', ?)`,
    ).run(org, "2026-01-01T10:00:00Z");

    expect(readOrderDeliveryHistory(getDb(), org, 900)).toEqual([]);

- [ ] **Step 3: Write the repo function**

Create `lib/repo/orderDeliveries.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import type { DeliveryStatus } from "./deliveries";

/** One attempt at delivering one order — the row the order's own page shows.
 *
 *  `deliveries` is keyed by order_id + seq, so it is the history of attempts on a single
 *  order rather than a queue. It used to be listed on a cross-order page, where it
 *  answered "what happened recently"; the order's own page had no trace of it, which is a
 *  gap rather than a design.
 *
 *  `listDeliveries` reads the same table and would work, but it takes the WHOLE
 *  organisation and filters afterwards, and it selects `d.*` — photo and signature paths
 *  for rows this table does not show. This read states the columns the history actually
 *  renders, and joins the two reason codes so a failed attempt says WHY without a second
 *  query per row.
 *
 *  Oldest first, and that is the reading order: a manager asking "what happened to this
 *  order" wants the sequence, not the latest entry. `seq` is the natural order and matches
 *  created_at without needing it. */
export interface OrderDeliveryAttempt {
  id: number;
  seq: number;
  status: DeliveryStatus;
  planned_arrival: string | null;
  actual_arrival: string | null;
  completed_at: string | null;
  /** Why it failed, in words. Null when the attempt succeeded or none was given. */
  fail_reason: string | null;
  /** Why it was late, in words. Independent of `fail_reason`. */
  delay_reason: string | null;
  receiver_name: string | null;
  /** Whether there is a photo, without carrying its path to a table that does not show
   *  it. `number`, not `boolean`: SQLite hands back 0/1 here. */
  has_photo: number;
}

export function readOrderDeliveryHistory(
  conn: DatabaseSync,
  organizationId: number,
  orderId: number,
): OrderDeliveryAttempt[] {
  return conn
    .prepare(
      `SELECT d.id, d.seq, d.status, d.planned_arrival, d.actual_arrival, d.completed_at,
              fr.label_fa AS fail_reason, dr.label_fa AS delay_reason,
              d.receiver_name,
              (d.photo_path IS NOT NULL AND d.photo_path != '') AS has_photo
         FROM deliveries d
         LEFT JOIN reason_codes fr ON fr.id = d.fail_reason_id
         LEFT JOIN reason_codes dr ON dr.id = d.delay_reason_id
        WHERE d.organization_id = ? AND d.order_id = ?
        ORDER BY d.seq`,
    )
    .all(organizationId, orderId) as unknown as OrderDeliveryAttempt[];

- [ ] **Step 5: Render the history on the order page**

In `app/(shell)/sales/orders/[id]/page.tsx`, add the import:

```ts
import { readOrderDeliveryHistory } from "@/lib/repo/orderDeliveries";
```

Add the status labels after `export const dynamic = "force-dynamic";`:

```ts
/** The nine delivery states, in the words the office uses. */
const ATTEMPT_LABEL: Record<string, string> = {
  PLANNED: "برنامه‌ریزی‌شده",
  ASSIGNED: "تخصیص‌یافته",
  LOADED: "بارگیری‌شده",
  IN_TRANSIT: "در مسیر",
  DELIVERED: "تحویل‌شده",
  PARTIAL: "تحویل ناقص",
  FAILED: "ناموفق",
  RETURNED: "مرجوعی",
  CANCELLED: "لغوشده",
};
```

After the `if (!order) notFound();` line, add the read:

```ts
  /* Every attempt at delivering THIS order, oldest first. It lived on a cross-order page
     at /sales/deliveries, which answered "what happened recently" and not "what happened
     to this" — and this page had no trace of it. */
  const attempts = readOrderDeliveryHistory(db, session.organizationId, order.id);
```

Then insert the section immediately after the `</table>` that holds the order's lines:

```tsx
      {/* One order's attempts, which is what `deliveries` records. Absent, not empty:
          an order that has never shipped says so in a sentence. */}
      <section className="mt-[var(--space-5)]">
        <h2 className="sechead__title">تلاش‌های تحویل</h2>
        {attempts.length === 0 ? (
          <p className="m-0 mt-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
            برای این سفارش هنوز تلاشی برای تحویل ثبت نشده است.
          </p>
        ) : (
          <ol className="m-0 mt-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0">
            {attempts.map((a) => (
              <li
                key={a.id}
                className="rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                  <span className="text-[length:var(--text-sm)] font-medium text-[var(--text)]">
                    تلاش {faNum(a.seq)} · {ATTEMPT_LABEL[a.status] ?? "نامشخص"}
                  </span>
                  <span className="text-[length:var(--text-xs)] tabular-nums text-[var(--text-muted)]">
                    {a.actual_arrival
                      ? faJalaliDateTime(a.actual_arrival)
                      : a.planned_arrival
                        ? `برنامه: ${faJalaliDateTime(a.planned_arrival)}`
                        : "—"}
                  </span>
                </div>
                {(a.fail_reason || a.delay_reason) && (
                  <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    {a.fail_reason ? `دلیل ناموفقی: ${a.fail_reason}` : null}
                    {a.fail_reason && a.delay_reason ? " · " : null}
                    {a.delay_reason ? `دلیل تأخیر: ${a.delay_reason}` : null}
                  </p>
                )}
                {a.receiver_name && (
                  <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    تحویل به {a.receiver_name}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. `tsc` cannot catch a wrong column name in a SQL string — that is what Step 4's test is for.

- [ ] **Step 7: Commit**

```bash
git add lib/repo/orderDeliveries.ts "app/(shell)/sales/orders/[id]/page.tsx" tests/order-delivery-history.test.ts
git commit -m "feat(orders): one order's delivery history, on that order

deliveries is keyed by order_id + seq -- the history of attempts on ONE order: status,
planned vs actual arrival, fail and delay reasons, receiver, signature, photo, GPS. It
was listed on a cross-order page at /sales/deliveries, which answered 'what happened
recently' and not 'what happened to this', and the order's own page contained zero
references to it. That was a gap, not a page.

The cross-order queue does not move: it already exists as the retry panel on the /today

---

## Wave 2 — The day: schedule + runs, one page, two views

### Task 6: The failing test for the day host

**Files:**
- Test: `tests/day-tabs.test.ts` (new)

- [ ] **Step 1: Write the test**

Create `tests/day-tabs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/** The month ahead and the day's assignment were two verbs pretending to be two pages.
 *
 *  /sales/schedule shows the month. /sales/runs assigns work to vans. They are not
 *  variants of each other, but they are the same subject -- one delivery day -- and the
 *  calendar already queries BOTH delivery_runs and visit_plans and merges them into one
 *  month. The month grid is the natural spine: "what is planned" and "who is carrying it"
 *  are read off the same grid.
 *
 *  The redirect assertion matters for the same reason the orders one does: a
 *  consolidation that 404s an old bookmark is worse than no consolidation. */
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

describe("the day host serves two views", () => {
  const host = read("app/(shell)/sales/schedule/page.tsx");

  it("names the runs view", () => {
    expect(host).toContain('"runs"');
  });

  it("renders the month grid by default and the planner on ?view=runs", () => {
    expect(host, "the default view is the month").toContain("ScheduleBoard");
    expect(host, "the runs view is the planner").toContain("RunPlanner");
    expect(host, "and the assignment board").toContain("AssignmentBoard");
    expect(host, "and the timeline").toContain("RunTimeline");
  });

  it("carries the tab strip", () => {
    expect(host).toContain("ViewTabs");
  });

  it("still reads BOTH tables for the month", () => {
    // The thing that made it the natural spine: one calendar over two kinds of plan.
    expect(host, "the month reads delivery_runs").toContain("delivery_runs");
    expect(host, "and visit_plans").toContain("visit_plans");
  });
});

describe("/sales/runs redirects to the day host with its view", () => {
  it("lands on /sales/schedule?view=runs, not on a bare /sales/schedule", () => {
    const src = read("app/(shell)/sales/runs/page.tsx");
    expect(src, "a redirect page must not also render").not.toContain("PageHeader");
    expect(src.replace(/\s+/g, " ")).toContain('redirect("/sales/schedule?view=runs")');
  });

  it("keeps a PAGE_META entry for the route it still resolves", () => {
    // tests/pageMeta.test.ts fails on an entry whose route has gone. /sales/runs still
    // resolves -- it redirects -- so the entry stays.
    expect(read("lib/pageMeta.ts")).toContain('"/sales/runs":');
  });
});

describe("the two host groups still hold more than one tab", () => {
  /* PageHeader.tsx:54 renders the row only when `siblings.length > 1`, so a group that
     drops to one tab silently loses the header's navigation. Both specs narrow the menu;
     this is the invariant that has to be re-checked after each one. */
  it("sales and ops each keep at least two ready tabs, for an owner", async () => {
    const { appTabs, APP_GROUPS } = await import("@/lib/appNav");
    const tabs = appTabs({ role: "owner" });
    for (const group of ["sales", "ops"] as const) {
      const n = tabs.filter((t) => t.group === group && t.ready).length;

### Task 7: Make `/sales/schedule` the day host

**Files:**
- Modify: `app/(shell)/sales/schedule/page.tsx`
- Replace: `app/(shell)/sales/runs/page.tsx`
- Delete: `app/(shell)/sales/runs/loading.tsx`

**The order here is load-bearing, and it is the one place this spec touches a file spec 1 also touches.** `app/(shell)/sales/runs/page.tsx:37` was `WHERE role = 'driver'` — a query that matched nobody after `lib/db.ts` renamed that role. Spec 1 Task 9 fixes it to the van-role **set**. This task must carry that fix into the new file, not retype the query from the old page.

- [ ] **Step 1: Confirm the fix is in the tree before moving anything**

Run: `grep -n "role IN (" "app/(shell)/sales/runs/page.tsx"`

Expected: a match. If there is none, the file still says `role = 'driver'` and **spec 1 has not landed**. Stop and land it first — the whole point of the ordering is that this plan inherits a corrected query.

- [ ] **Step 2: Add the imports and the view plumbing**

In `app/(shell)/sales/schedule/page.tsx`, add:

```ts
import type { DatabaseSync } from "node:sqlite";
import type { Session } from "@/lib/session";
import RunPlanner from "@/components/sales/RunPlanner";
import AssignmentBoard from "@/components/sales/AssignmentBoard";
import RunTimeline, { type TimelineStop } from "@/components/sales/RunTimeline";
import DriverStreaks from "@/components/sales/DriverStreaks";
import { readDriverActivity } from "@/lib/repo/driverActivity";
import { buildStreak } from "@/lib/streak";
import { readOrders } from "@/lib/orders";
import ViewTabs, { type ViewTab } from "@/components/meridian/ViewTabs";
import { oneOf, type SearchParams } from "@/lib/viewParam";
import { isVanRole, VAN_ROLES } from "@/lib/roles";
```

`orderFilter` joins the existing `@/lib/session` import; `isVanRole` joins the existing `@/lib/roles` import. Merge, do not duplicate.

Add after `export const dynamic = "force-dynamic";`:

```ts
/** برنامه / سفرها — what is planned, and who is carrying it.
 *
 *  The month grid was already the spine: this page queries delivery_runs AND
 *  visit_plans and merges them into one calendar, which is the answer to "the day's
 *  plan". Assignment is the same subject read one verb later -- "whose van is it" rather
 *  than "what is on". So it is a second view of this page, not a separate route.
 *
 *  `RunTimeline` stays inside the runs view rather than earning a third tab. It shows
 *  runs in progress and recently finished, which is a third question from the month
 *  ahead -- but a third tab here would put three *views* of one page into the nav group
 *  the header draws its own tab row from, so the two rows would answer the same
 *  question. Spec 2 section 8 flags this; the conservative placement wins for now. */
const DAY_VIEWS = ["", "runs"] as const;
type DayView = (typeof DAY_VIEWS)[number];

const DAY_TABS: ViewTab[] = [
  { value: "", label: "برنامه", route: "/sales/schedule" },
  { value: "runs", label: "سفرها", route: "/sales/schedule" },
];
```

- [ ] **Step 3: Give the page its `searchParams` and the `phone_sales` guard it inherits**


- [ ] **Step 4: Add the `runs` view as a function in the same file**

Above `export default async function SchedulePage`, add `RunsView`. First half — the driver list and the runs list:

```tsx
/** «سفرها» — assigning the day's orders to vans. Which was /sales/runs.
 *
 *  The queries below are moved, not retyped. The driver list in particular: it read
 *  `role = 'driver'`, which matched nobody after lib/db.ts renamed that role to
 *  `delivery_driver`, and spec 1 (2026-09-29-leads-manager-only-driver-my-day section
 *  3.8) fixed it to the van-role set. Carrying the SET is the point of this comment: a
 *  copy of the old query would silently reintroduce the empty dropdown.
 *
 *  Only confirmed orders are offered. A draft is a list somebody is still editing, and
 *  loading a van from one means the quantities can change after it has left the depot. */
function RunsView({ db, session }: { db: DatabaseSync; session: Session }) {
  const userScope = groupFilter(session);

  const vanRoleList = VAN_ROLES.map((r) => `'${r}'`).join(", ");
  const drivers = plain(
    db
      .prepare(
        `SELECT id, display_name FROM users
          WHERE role IN (${vanRoleList}) AND active = 1${userScope.sql}
          ORDER BY display_name`,
      )
      .all(...userScope.params),
  ) as unknown as { id: number; display_name: string }[];

  const runScope = groupFilter(session, "dr.group_id");
  const runs = plain(
    db
      .prepare(
        `SELECT dr.id, dr.run_date, dr.status, dr.driver_user_id, u.display_name AS driver_name,
                COUNT(ds.id) AS stop_count,
                COALESCE(SUM(CASE WHEN ds.status = 'pending' THEN 1 ELSE 0 END), 0) AS remaining
           FROM delivery_runs dr
           JOIN users u ON u.id = dr.driver_user_id
           LEFT JOIN delivery_stops ds ON ds.run_id = dr.id
          WHERE 1 = 1${runScope.sql}
          GROUP BY dr.id
          ORDER BY dr.run_date DESC, dr.id DESC
          LIMIT 30`,
      )
      .all(...runScope.params),
  ) as unknown as {
    id: number;
    run_date: string;
    status: string;
    driver_user_id: number;
    driver_name: string;
    stop_count: number;
    remaining: number;
  }[];
```

Second half — the stops, the pool, and the render, continuing the same function:

```tsx
  /* Every stop on the runs above, in delivery order, with the order total each carries.
     One query for all runs rather than one per run: at 30 runs the per-run version is
     30 round trips to answer a question SQLite can answer once. */
  const stopScope = groupFilter(session, "dr.group_id");
  const stopRows = plain(
    db
      .prepare(
        `SELECT ds.id, ds.run_id, ds.status, o.order_no,
                COALESCE(c.business_name, '—') AS customer_name,
                COALESCE(SUM(ol.packs_ordered * ol.unit_price_toman), 0) AS total_toman
           FROM delivery_stops ds
           JOIN delivery_runs dr ON dr.id = ds.run_id
           JOIN orders o ON o.id = ds.order_id
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN order_lines ol ON ol.order_id = o.id
          WHERE 1 = 1${stopScope.sql}
          GROUP BY ds.id
          ORDER BY ds.run_id, ds.sort_order, ds.id`,
      )
      .all(...stopScope.params),
  ) as unknown as (TimelineStop & { run_id: number })[];

  const stopsByRun = new Map<number, TimelineStop[]>();
  for (const row of stopRows) {
    const { run_id, ...stop } = row;
    if (!stopsByRun.has(run_id)) stopsByRun.set(run_id, []);
    stopsByRun.get(run_id)!.push(stop);
  }

  // Confirmed orders not already on a run -- the pool a manager is choosing from.
  const unassigned = readOrders(db, orderFilter(session), { status: "CONFIRMED", limit: 200 }).filter(
    (order) => db.prepare("SELECT 1 FROM delivery_stops WHERE order_id = ?").get(order.id) === undefined,
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-[var(--space-6)]">
      <RunPlanner drivers={drivers} />
      <AssignmentBoard
        runs={runs}
        orders={unassigned.map((o) => ({
          id: o.id,
          order_no: o.order_no,
          customer_name: o.customer_name,
          total_toman: o.total_toman,
          order_date: o.order_date,
        }))}
      />
      <RunTimeline
        runs={runs.filter((r) => r.status !== "done").map((r) => ({ ...r, stops: stopsByRun.get(r.id) ?? [] }))}
      />
      <DriverStreaks
        people={readDriverActivity(db, session, today).map((d) => ({
          id: d.id,

- [ ] **Step 5: Branch the page's render**

Replace the `return (` … `</>` tail of `SchedulePage` with:

```tsx
  if (view === "runs") return <RunsView db={db} session={session} />;

  return (
    <>
      <PageHeader route="/sales/schedule" />
      <ViewTabs tabs={DAY_TABS} current={view} />
      {/* ... the existing legend2 + ScheduleBoard, moved here unchanged ... */}
    </>
  );
```

**The `runs` view returns without its own `PageHeader`, deliberately.** `tests/shell-pages-have-tabs.test.ts` requires every shell page to resolve one, but the host is `/sales/schedule` and `PageHeader route="/sales/schedule"` is what the header must say — pointing it at `/sales/runs` would light the wrong tab, since `/sales/runs` is no longer a nav entry and `activeGroup` would fall back to the first group. Both views carry the host's header, exactly as the orders host does.

- [ ] **Step 6: Replace `/sales/runs` with a redirect**

`app/(shell)/sales/runs/page.tsx`, in full:

```tsx
import { redirect } from "next/navigation";

/** /sales/runs is now the «سفرها» view of /sales/schedule.
 *
 *  A redirect, not a deletion: this is where a manager has typed the URL for years, and
 *  a 404 would be a worse answer than the extra hop. The view travels with it, because
 *  /sales/runs → a bare /sales/schedule would show the month, which is not what the
 *  person who clicked expected.
 *
 *  The page's own `phone_sales` guard moved with the planner, onto the host's
 *  `?view=runs` branch. proxy.ts's isBatchAdmin still names /sales/runs, so an API call
 *  there is still bounced for the same roles; only the page is gone. */
export default function RunsPage() {
  redirect("/sales/schedule?view=runs");
}
```

```bash
git rm "app/(shell)/sales/runs/loading.tsx"
```

- [ ] **Step 7: Type-check and run**

Run: `npx tsc --noEmit && npx vitest run tests/day-tabs.test.ts tests/pageMeta.test.ts tests/briefing-repo.test.ts`

Expected: zero TS errors; `day-tabs.test.ts` PASS; `pageMeta.test.ts` PASS (the `/sales/runs` entry stays, the route still resolves); `briefing-repo.test.ts` PASS.

- [ ] **Step 8: Commit**

```bash
git add -A "app/(shell)/sales/schedule" "app/(shell)/sales/runs"
git commit -m "refactor(sales): the month and the assignment are one page, two views

schedule/page.tsx already queried delivery_runs AND visit_plans and merged them into
one calendar -- it was answering 'the day's plan'. Assignment is the same subject read
one verb later, whose van is it rather than what is on. So it is a second view of the
same page, not a separate route.

### Task 8: The menu, the briefing link, and the reveal keys

**Files:**
- Modify: `lib/appNav.ts:105-118`
- Modify: `lib/repo/briefing.ts:192`
- Modify: `components/meridian/RevealRoute.tsx:20-29`
- Test: `tests/appNav.test.ts` (edit)
- Test: `tests/orders-tabs.test.ts` (already asserts the nav and the briefing href)

**The nav loses four entries and gains none.** `/sales/schedule` keeps its entry — it was already in the `day` group, and it is now also the host for the delivery runs. Its label changes, because «برنامهٔ بازدید» (visit schedule) no longer describes a page that also assigns vans.

- [ ] **Step 1: Edit `appNav.ts`**

Delete four entries from the inline (non-driver) list:

```ts
    { href: "/sales/board", label: "تابلوی سفارش‌ها", group: "sales", ready: true },
    { href: "/sales/journey", label: "پیگیری سفارش", group: "sales", ready: true },
    { href: "/sales/runs", label: "سفرهای تحویل", group: "ops", ready: r !== "phone_sales" },
    { href: "/sales/deliveries", label: "تحویل‌ها", group: "ops", ready: isManager(r) },
```

Replace the `/sales/schedule` entry:

BEFORE:
```ts
    { href: "/sales/schedule", label: "برنامهٔ بازدید", group: "day", ready: true },
```

AFTER:
```ts
    { href: "/sales/schedule", label: "برنامهٔ تحویل", group: "day", ready: true },
```

**The `ready` conditions do not move to the host.** `/sales/schedule` was `ready: true` for every role, and its `?view=runs` branch refuses a `phone_sales` rep in the page (Task 7 Step 3) rather than hiding the tab. Both `sales` and `day` are the office's and a rep is welcome in both; what they may not do is assign vans, which the page says.

- [ ] **Step 2: Repoint the briefing's link**

In `lib/repo/briefing.ts`, at line 192:

BEFORE:
```ts
        byState.map((s) => ({ label: s.status, sub: String(s.n), href: "/sales/board" }))
```

AFTER:
```ts
        byState.map((s) => ({
          label: s.status,
          sub: String(s.n),
          /* The board is a view of the orders page now, and the link carries the view --
             without it a manager tapping today's order counts lands on the pocket list,
             which answers a different question from the one they asked. */
          href: "/sales/orders?view=board",
        }))
```

**This is the one that is easy to miss.** It is a server *data* file, not a page, so a page-by-page review never sees it — and it is the status row on the `/today` briefing that a manager taps all day.

- [ ] **Step 3: Fix the stale reveal keys**

`REVEAL` is keyed by pathname with longest-prefix match. Three keys now name routes that only redirect, so the animation would never fire for them — and `/sales/orders` would swallow `?view=board` and animate the *pocket* selectors instead of the board's.

BEFORE:
```ts
  "/sales/orders": [".bhead", ".pocket"],
  "/sales/board": [".hint", ".col"],
  "/sales/journey": [".bhead", ".spine__step", ".funnel__row"],
  "/sales/schedule": [".notice", ".sched > .kblock"],
  ...
  "/sales/runs": [".card", ".kblock", ".run-column"],
```

AFTER:
```ts
  /* One key per HOST now, not per view. The reveal reads the pathname, which does not
     carry `?view=` -- so the board and the journey would animate as the orders list
     unless their selectors join it here. That means a page can animate a list it is not
     showing, which is a lesser evil than a page animating the wrong thing outright. */

- [ ] **Step 4: Update `tests/appNav.test.ts`**

Replace the ops assertion at lines 110-114:

```ts
  it("delivery and stock share one operations group", () => {
    expect(hrefsIn("ops")).toEqual(
      ["/sales/batches", "/sales/deliveries", "/sales/routing", "/sales/runs", "/sales/stock"].sort(),
    );
  });
```

with:

```ts
  it("delivery and stock share one operations group", () => {
    // /sales/runs and /sales/deliveries are a view and a redirect now; the planner moved
    // to /sales/schedule, which sits in the day group beside the month it plans against.
    expect(hrefsIn("ops")).toEqual(["/sales/batches", "/sales/routing", "/sales/stock"].sort());
  });
```

Replace the board/journey assertion at lines 99-102:

```ts
  it("the order pipeline board sits with orders, not with team management", () => {
    expect(groupOf("/sales/board")).toBe("sales");
    expect(groupOf("/sales/journey")).toBe("sales");
  });
```

with:

```ts
  it("the order pipeline board and the journey are views of the orders page", () => {
    // They were three adjacent entries in the sales group over one readOrders. The host
    // is one entry now, and the other two are ?view= values on it.
    expect(groupOf("/sales/orders")).toBe("sales");
    expect(appTabs({ role: "owner" }).some((t) => t.href === "/sales/board")).toBe(false);
    expect(appTabs({ role: "owner" }).some((t) => t.href === "/sales/journey")).toBe(false);
  });
```

And add, next to it:

```ts
  it("sales and ops each keep more than one ready tab, so the header keeps its row", () => {
    // PageHeader.tsx:54 renders the tab row only when siblings.length > 1. A group that
    // drops to one silently loses the header's navigation -- which is how this
    // consolidation could have broken navigation without breaking a single page.
    for (const role of ["owner", "group_manager", "rep_manager", "phone_sales"] as const) {
      for (const group of ["sales", "ops"] as const) {
        const n = appTabs({ role }).filter((t) => t.group === group && t.ready).length;
        if (n === 0) continue; // a role is not offered this group at all
        expect(n, `${role} → ${group}`).toBeGreaterThan(1);
      }
    }
  });
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/appNav.test.ts tests/orders-tabs.test.ts tests/day-tabs.test.ts tests/briefing-repo.test.ts tests/proxy.test.ts`

Expected: all pass. `proxy.test.ts` matters because its both-directions loop walks `PATHS`; `/sales/runs` and `/sales/deliveries` are not on it, and `isBatchAdmin` still gates them in the proxy even though the pages redirect — so a `phone_sales` user hitting `/sales/runs` is bounced by the proxy and never reaches the redirect. That is the order the spec wants: **the gate, then the redirect.**

- [ ] **Step 6: Commit**

```bash
git add lib/appNav.ts lib/repo/briefing.ts components/meridian/RevealRoute.tsx tests/appNav.test.ts
git commit -m "refactor(nav): four menu entries, folded into two pages

sales: سفارش‌ها · کالاها · دریافت‌ها · چک‌ها · پورسانت
ops:   مسیریابی · انبار و خرید · سری‌های ساخت
day:   برنامهٔ تحویل

Nothing gained an entry. /sales/schedule was relabelled from برنامهٔ بازدید, because a
page that also assigns vans is not only about visits.

lib/repo/briefing.ts is the one link that is easy to miss: it is a server DATA file, not
a page, so a page-by-page review never sees it -- and it is the status row a manager
taps all day. It now carries ?view=board, because without the view a manager tapping
today's order counts lands on the pocket list, which is a different question.

RevealRoute is keyed by pathname, which does not carry ?view=, so the board and the
journey's selectors moved under the orders host. A page can now animate a list it is
not showing -- a lesser evil than animating the wrong one."
```

  "/sales/orders": [".bhead", ".pocket", ".hint", ".col", ".spine__step", ".funnel__row"],

### Task 9: The vocabulary fix, and the four titles

**Files:**
- Modify: `lib/pageMeta.ts` (four redirecting overviews, two host overviews, `/planner`)

**The one-line copy fix.** Measured, the app's vocabulary is already disciplined: **سفر** for a run, **بازدید** for a planned visit, **مسیر** for the *optimized order*. `/planner` is the one page that breaks it — it calls an ordered sequence of **visits** a *مسیر*. By the app's own rule that is a **بازدید** sequence, and the same sentence's first half already says «ترتیب بهینهٔ بازدید», so the string contradicts itself.

- [ ] **Step 1: Fix `/planner`'s overview**

BEFORE:
```ts
  "/planner": {
    title: "برنامه‌ریز مسیر",
    overview:
      "مقصدهای یک روز را انتخاب کنید و ترتیب بهینهٔ بازدید را بگیرید. مسیر پیشنهادی را می‌توانید دستی جابه‌جا کنید و در پایان به ناوبری گوشی بفرستید.",
  },
```

AFTER:
```ts
  "/planner": {
    title: "برنامه‌ریز مسیر",
    overview:
      /* «مسیر» is the app's word for the optimized order; a sequence of VISITS is a
         بازدید sequence. The first sentence below already said ترتیب بهینهٔ بازدید --
         so the second one contradicted it. One string, and the vocabulary is then
         consistent across every page. */
      "مقصدهای یک روز را انتخاب کنید و ترتیب بهینهٔ بازدید را بگیرید. ترتیب پیشنهادی بازدیدها را می‌توانید جابه‌جا کنید و در پایان به ناوبری گوشی بفرستید.",
  },
```

`title` is unchanged: `/planner` genuinely does build a route, and the spec keeps that.

- [ ] **Step 2: Update the four redirecting overviews so they name their host**

`tests/pageMeta.test.ts` requires these entries to keep existing, and their `overview` is what a reader would see if anything ever read it for a redirected route. Make them say where the thing went — the `admin/representatives` entry already sets this precedent.

- `/sales/board`: prepend `این نمای از «سفارش‌ها» است. `
- `/sales/journey`: prepend the same.
- `/sales/runs`: prepend `این نمای از «برنامهٔ تحویل» است. `
- `/sales/deliveries`: **replaced entirely** —
  `"تلاش‌های تحویل هر سفارش روی صفحهٔ همان سفارش است؛ فهرست کارهای امروز در «مسیر امروز»."`

**`/sales/deliveries` changes meaning entirely**, and that is correct: the route redirects, and the two things that used to be on it now live in the two places they belong.

- [ ] **Step 3: Update the two hosts' overviews to name their views**

`/sales/orders`:

```ts
  "/sales/orders": {
    title: "سفارش‌ها",
    overview:
      "همهٔ سفارش‌ها با وضعیت و مدارکشان، در سه نما: فهرست کارت‌ها، تابلوی مرحله‌ها، و پیگیری یک سفارش از ثبت تا تسویه. روی هر کارت بزنید تا جزئیاتش باز شود.",
  },
```

`/sales/schedule`:

```ts
  "/sales/schedule": {
    title: "برنامهٔ تحویل",
    overview:
      "تقویم ماه، از بازدیدها و سفرهای تحویل با هم. در نمای «سفرها» سفارش‌های تأییدشده را به راننده‌ها تخصیص دهید و برگهٔ مسیرها را ببینید.",
  },
```

`tests/pageMeta.test.ts:45-51` requires every overview to be a real sentence of more than 25 characters, so these are comfortably over.

- [ ] **Step 4: Run the copy audit and the meta test**

Run: `npm run audit-copy && npx vitest run tests/pageMeta.test.ts`

Expected: the audit passes (or reports only pre-existing notes), and `pageMeta.test.ts` passes — no entry went stale, every route is still covered, every overview is a sentence.

- [ ] **Step 5: Commit**

```bash

### Task 10: Full verification

**Files:** none.

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. About two minutes; run it detached and poll.

- [ ] **Step 2: Run the full suite**

```bash
setsid nohup npx vitest run > /tmp/vitest-spec2.log 2>&1 &
```

Poll `/tmp/vitest-spec2.log` until it finishes. About 14 minutes.

Expected: **2 failed / ~2760 passed**, failures being exactly `tests/jalali.test.ts` and `tests/api/routing-route.test.ts`. Confirm with `npx vitest run tests/jalali.test.ts tests/api/routing-route.test.ts` — both pass alone. Any other failure is real.

- [ ] **Step 3: The spec's regression list, one by one**

Run: `npx vitest run tests/orders-tabs.test.ts tests/day-tabs.test.ts tests/appNav.test.ts tests/pageMeta.test.ts tests/briefing-repo.test.ts tests/proxy.test.ts tests/order-delivery-history.test.ts tests/shell-pages-have-tabs.test.ts tests/kblock-children-are-inset.test.ts`

Expected: all pass. The spec names `pageMeta`, `briefing-repo` and `proxy` as the three that **must stay green** — they are the ones standing between a clean merge and a plausible-looking one that is quietly broken. `kblock-children-are-inset` is the fourth, and it is here because its doc comment names the `/sales/deliveries` table: the route redirects, and the new history section is a plain `<section>`, not a `.kblock` child.

- [ ] **Step 4: Confirm no stale references remain**

```bash
grep -rn '"/sales/board"\|"/sales/journey"\|"/sales/runs"\|"/sales/deliveries"' --include=*.ts --include=*.tsx app components lib | grep -v "/api/"
```

Expected: only `proxy.ts` (the `isBatchAdmin` prefix checks), `lib/pageMeta.ts` (the four entries), and the four redirect pages themselves. **No `href` anywhere pointing at a redirecting route without its view.**

- [ ] **Step 5: Commit any test-only corrections**

If a test needed fixing, commit it separately, naming the invariant rather than the symptom.

---

## What this plan does not do

Named here so nothing in it is assumed done later.

- **`/sales/routing` stays its own page.** It is a batch optimizer — `eta_min`, `duration_min`, `cold_chain_capped`, `source: "vroom" | "greedy"` — a tool you invoke before a day, not a destination you browse. Route4me and Onfleet both treat "optimize" as an action, not a tab.
- **`/planner` is untouched** apart from one string. It optimizes `visit_plans` for customers and districts, a different question from the delivery day. A future spec may fold it in as a fourth view of the day host; naming that here prevents it being assumed done.
- **No API, schema, or migration change.** Every endpoint stays exactly where it is; this is a routing and rendering consolidation only.
- **`RunTimeline` does not get its own tab** — the spec's open question, decided in this plan's header.
- **`/today`'s `retry` panel does not move.** It is the cross-order exception queue, and it stays where the answer to "what needs attention today" lives.

git add lib/pageMeta.ts
git commit -m "docs(copy): one stale word, and four titles that say where they went

/planner called an ordered sequence of VISITS a مسیر. The app's own rule is that مسیر
is the optimized order and بازدید is a visit -- and the same sentence's first half
already said ترتیب بهینهٔ بازدید, so it contradicted itself. One string.

The four redirecting routes keep their PAGE_META entries (tests/pageMeta.test.ts fails
on an entry whose route has gone, and these routes still resolve), and their overviews
now say which host holds the thing they used to. /sales/deliveries changes meaning
entirely, which is correct: the two things that were on it now live in the two places
they belong."
```

  "/sales/schedule": [".notice", ".sched > .kblock", ".card", ".kblock", ".run-column"],
```

and delete the standalone `/sales/board`, `/sales/journey` and `/sales/runs` lines.


The queries are moved, not retyped, and the driver list in particular carries the van
ROLE SET rather than the old role = 'driver', which matched nobody after the rename
(lib/db.ts:3220). Copying that query from the old page would have silently reintroduced
an empty dropdown.

The phone_sales guard moved with it: proxy.ts's isBatchAdmin covers /sales/runs by
PREFIX, so once the page moved the gate has to be the host's own or a rep finds the run
planner by typing the URL."
```

          name: d.name,
          streak: buildStreak(d.dates, today, 12),
        }))}
      />
    </div>
  );
}
```

`/sales/runs` refused a `phone_sales` rep in the page body (`runs/page.tsx:28`). That gate has to survive the move, or a rep would find the run planner by typing the URL. Change the signature and the guards:

```tsx
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const params = (await searchParams) as SearchParams;
  const view: DayView = oneOf(params, DAY_VIEWS, "");

  /* Carried over from /sales/runs, and load-bearing. proxy.ts's isBatchAdmin covers
     /sales/runs and /sales/deliveries by PREFIX, so it no longer covers this page once
     the planner moved here -- a phone_sales rep would otherwise be let in and shown the
     delivery-run planner. The gate is now the page's own, and it must stay. */
  if (view === "runs" && session.role === "phone_sales") redirect("/sales");
```

      expect(n, `${group} must keep a tab row`).toBeGreaterThan(1);
    }
    expect(APP_GROUPS.map((g) => g.id)).toContain("sales");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/day-tabs.test.ts`

Expected: FAIL on the schedule assertions and the runs redirect; the tab-count test may already pass, which is fine — it is a regression guard, not a driver.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/day-tabs.test.ts
git commit -m "test(day): the month host, its two views, and where /sales/runs lands

Also re-checks the invariant PageHeader.tsx:54 depends on: a nav group that drops
to one ready tab silently loses the header's navigation, and both this spec and spec 1
narrow the menu."
```

briefing, and 'what needs attention today' is a different question from 'what happened to
this one'."
```

}
```

`reason_codes.label_fa` is the real column (`lib/db.ts:1194`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/order-delivery-history.test.ts`

Expected: PASS — 5 passed.

  });

  it("is empty rather than wrong for another organisation's order", () => {
    // Tenant safety: an order in org 2 is not this org's row, whatever the id.
    expect(readOrderDeliveryHistory(getDb(), org + 1, 900)).toEqual([]);
  });

  it("carries the reason a failed attempt failed for", () => {
    const db = seed();
    db.prepare(
      `INSERT INTO reason_codes (id, domain, code, label_fa, created_at)
       VALUES (500, 'delivery_fail', 'CLOSED', 'مغازه بسته بود', '2026-01-01')`,
    ).run();
    db.prepare(
      `INSERT INTO deliveries (organization_id, order_id, seq, status, fail_reason_id, created_at)
       VALUES (?, 900, 1, 'FAILED', 500, ?)`,
    ).run(org, "2026-01-01T09:30:00Z");

    expect(readOrderDeliveryHistory(getDb(), org, 900)[0].fail_reason).toBe("مغازه بسته بود");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/order-delivery-history.test.ts`

Expected: FAIL — `Cannot find module '@/lib/repo/orderDeliveries'`.

changes what a link means is not a consolidation.

The three loading.tsx go with their routes rather than being left orphaned."
```

Expected: zero TS errors. The assertions that can pass now will — "names all three views", "renders each view's component", "reads orders ONCE", "all three views use the same limit", "still carries the tab strip". The redirect and nav assertions will still fail; those are Tasks 4 and 7. That is fine — the test is red overall and each task closes part of it.

- [ ] **Step 9: Commit**

```bash
git add "app/(shell)/sales/orders/page.tsx"
git commit -m "feat(orders): one page, three views, one readOrders

The pocket list, the stage board and the order journey were three routes over one
readOrders call, at limits 100/60/60, listed adjacently in the same nav group. The
header already drew that group's tabs as a row, so the page already looked like a tab
host; it is one now.

One read, limit 100, shared by all three. The two quieter pages were truncating to 60
while the list showed 100, so 'the same data' was three different windows.

The journey's own one/all switch moves to ?mode= rather than a second ?view=, because
oneOf takes the first value of a repeated key and would have silently dropped the mode."
```

                <div><dt>تاریخ ثبت</dt><dd className="mono">{faJalaliDate(focus.order_date)}</dd></div>
                <div><dt>وضعیت</dt><dd>{ORDER_STATUS_LABEL[focus.status as OrderStatus] ?? "نامشخص"}</dd></div>
                <div><dt>پرداخت</dt><dd>{PAYMENT_STATUS_LABEL[focus.payment_status as PaymentStatus] ?? "نامشخص"}</dd></div>
              </dl>

              <p className="jnow">
                {current ? (
                  <>
                    این سفارش الان روی مرحلهٔ <b>{current.label}</b> است — {current.note}
                  </>
                ) : (
                  <>این سفارش کامل شده: تحویل داده و تسویه شده است.</>
                )}
              </p>

              <div className="kblock__body">
                <OrderSpine nodes={nodes} events={events} />
              </div>
            </>
          ) : (
            <p className="kblock__body" style={{ color: "var(--muted)", fontSize: 13.5 }}>
              هنوز سفارشی برای نمایش مسیرش ثبت نشده است.
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

          </div>
        </div>
      </div>
      <div className="hint">
        <b>روی موبایل:</b> انگشت را روی کارت نگه دارید و بکشید — همان کار را می‌کند.
      </div>
      <OrderPipeline orders={board} />
    </div>
  );
}
```


```ts
  const raw = one((await searchParams).customer);
  const customerId = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;
```

with:

```ts
  const customerId = customerParam !== undefined && /^\d+$/.test(customerParam) ? Number(customerParam) : undefined;
```

- [ ] **Step 4: Keep ONE `readOrders`**

The existing line is already correct and needs no change:

```ts
  const orders = readOrders(db, orderFilter(session), { limit: 100, customerId: focused?.id });
```

**It is the only `readOrders` in the file**, and all three views read it. That is the point of the consolidation: the two quieter pages were truncating to 60 while the list showed 100, so "the same data" was three different windows.

      .not.toContain('href: "/sales/board"');
    expect(briefing).toContain('href: "/sales/orders?view=board"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/orders-tabs.test.ts`

Expected: FAIL on most assertions — the host knows no views, the three pages still render, and `appNav` still lists all four hrefs.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/orders-tabs.test.ts
git commit -m "test(orders): the three views, and where each old href must land

Written first because most of it is source-text: a redirect target and a tab wiring
cannot be reached by rendering, and vitest runs in a node environment. The redirect
assertion is the one that matters -- a consolidation that 404s an old bookmark is
worse than no consolidation, so each old href must land on the right host AND the
right view, not merely on the host."
```

pill and the others is not something a screen reader can announce."
```

}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/view-param.test.ts`

Expected: PASS — 6 passed.
