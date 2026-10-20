# Mobile-First TapFlow Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RouteFlow mobile-first by moving every "record what just happened" form onto the existing TapFlow bottom sheet (one question per screen, big answer buttons, autosave + 5 s undo), and by giving every wide desk-style page a usable phone layout.

**Architecture:** TapFlow today is CRM-shaped: `FlowSet` is a closed CRM vocabulary and the only save path is `/api/crm/businesses/:id/flow`. We add a small, backwards-compatible generic layer (Phase 0): options can write plain strings into `state.values`, three native step bodies (`amount`, `pick`, `stepper`), and one shared host hook (`useFlowHost`) that owns load-context, held save, undo toast and done chips. Each new flow is then **config (pure, in `lib/flows/`) + payload builder (pure, tested) + thin host component**, and it posts to the **existing** endpoint for that domain (no new server endpoints). The old desk form stays on `md:` and up where the doc says reference data is typed at a desk.

**Tech Stack:** Next.js 16 App Router (read `node_modules/next/dist/docs/` before touching routing/caching, per `AGENTS.md`), React 19, TypeScript, Tailwind + CSS variables, `node:sqlite`, vitest.

**Companion plan:** everything that is *not* "record what just happened" (filters, keypad, smart pickers, day chips, swipe rows, decision decks, map select, phone shell, report cards, admin presets) is in `2026-10-20-mobile-first-interaction-patterns.md`, which also ends with the mobile-first design-rules document. Parked ideas (camera/OCR, voice, paste-to-parse) are in `docs/future-features.md`.

**Standing rules (from `.zoocode/plan.md`, still in force):**
- NEVER run `next build` / `npm run build` / `vitest.smoke.mts` (browser).
- `npx tsc --noEmit` for types; `npx vitest run <file>` for tests; `npm run lint` before each commit.
- `npm run audit-copy` after any task that adds Persian text.
- `sharp` stays pinned to `0.33.5`.
- Commit per task. `CLAUDE.md` says: after every commit **and push**, merge the branch's open PR into `main` if it exists, has no conflicts and CI is green; never create a PR just to merge.
- Follow `docs/tap-flow-principles.md` (§3 rules, §4 tap budgets, §9 checklist) for every flow. Persian copy, RTL, Persian digits, `<Icon>` only, 52 px answer buttons.

---

## Scope: what this plan covers

Everything from the "where else can we use tap flow" review, in priority order.

| # | Item | Today | Result | Phase |
|---|------|-------|--------|-------|
| F0 | Generic TapFlow layer | CRM-only vocabulary | `put`, `amount`/`pick`/`stepper` steps, `useFlowHost` | 0 |
| 1 | Delivery at the door | inline form in `DriverRun.tsx` (pack inputs + collected input) | `deliveryFlow` sheet | 1 |
| 2 | Payment received | `PaymentsPanel` form (4 selects, 5 inputs) | `paymentFlow` sheet | 2 |
| 3 | Cheque entry | `ChequesBoard` inline form | cheque branch of `paymentFlow` | 2 |
| 4 | Complaint | `ComplaintsPanel` one-row form | `complaintFlow` sheet | 3 |
| 5 | Task / reminder outcomes | tiny `OutcomeChips` pills, `QuickAdd`, `AddReminder` | `outcomeFlow` + `reminderFlow`, 52 px chips | 4 |
| 6 | Repeat-customer order | full `OrderForm` (483 lines) | `orderQuickFlow`, full form stays for new/custom | 5 |
| 7 | Order status changes | `OrderStatusPanel` buttons + `ConfirmOrderButton` | `orderActionFlow` (reason on cancel/fail) | 5 |
| 8 | Stock count | `InventoryBoard` row editor | `stockCountFlow` | 6 |
| 9 | Batch receiving / purchase | `BatchesPanel` / `PurchaseEntry` | `receiveFlow` (door); desk form stays | 6 |
| 10 | Customer lifecycle | select in `CustomerDetailPanel` | `lifecycleFlow` | 7 |
| 11 | Visit plan quick-add | search+add in `/planner` | `visitPlanFlow` | 7 |
| 12 | Create a place | inline row in `/facilities` | `placeFlow` | 7 |
| M | Mobile layout pass (not TapFlow) | desk layouts, small tap targets, modals | card tables, bottom sheets, 44/52 px targets | 8 |
| E | Expense entry (confirmed) | API exists, no UI | `expenseFlow` | 9 |

**Explicitly not flows** (doc §1: reference data typed at a desk): login, admin users/groups/holidays, commission rates, product catalogue, notification settings, rep definitions. They only get the Phase 8 responsive pass.

**Decisions (2026-10-20, owner):**
1. **No separate specs.** The design lives in this plan (Phase 0 + per-flow step trees); implementation starts from the plan.
2. **Expense entry is in scope** (Phase 9 is no longer optional).
3. **Sequencing is delegated** to the order under "Suggested order and sizing"; one PR per phase, Phase 8 on a parallel branch.

---

## File structure

**Create**
- `lib/flows/item.ts` — `FlowItem` type + helpers shared by non-CRM flows.
- `lib/flows/delivery.ts`, `payment.ts`, `complaint.ts`, `outcome.ts`, `orderQuick.ts`, `orderAction.ts`, `stockCount.ts`, `receive.ts`, `lifecycle.ts`, `visitPlan.ts`, `place.ts`, `expense.ts` — one flow config + one `toPayload` each. Pure, no `lib/db` imports.
- `components/tapflow/AmountStep.tsx`, `PickStep.tsx`, `StepperStep.tsx` — native step bodies.
- `components/tapflow/useFlowHost.ts` — shared host logic.
- `components/flows/DeliveryFlow.tsx`, `PaymentFlow.tsx`, `ComplaintFlow.tsx`, … — one thin host per flow.
- `tests/helpers/flowAssert.ts` — shared config assertions.
- `tests/flow-<name>.test.ts` — one per flow.
- `components/meridian/ResponsiveTable.tsx` — card-per-row fallback for wide tables (Phase 8).

**Modify**
- `lib/crm/flows/types.ts`, `lib/crm/flows/machine.ts` — `put`, new kinds, `items`.
- `components/tapflow/TapFlow.tsx` — render new kinds.
- `app/globals.css` — `.tf-amount`, `.tf-pick`, `.tf-stepper` (next to the existing `.tf-*` rules).
- The host pages/components listed per phase.

---

## Phase 0 — Generic TapFlow layer

### Task 0.1: Engine — `put`, `items`, new step kinds

**Files:**
- Modify: `lib/crm/flows/types.ts`
- Modify: `lib/crm/flows/machine.ts:67-85` (`answerStep`)
- Create: `lib/flows/item.ts`
- Test: `tests/crm-flow-machine.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `tests/crm-flow-machine.test.ts`)

```ts
import type { FlowConfig } from "@/lib/crm/flows/types";

describe("generic flows: put + new kinds", () => {
  const cfg: FlowConfig = {
    id: "t", start: () => "a", budget: { common: 2, longest: 2 },
    steps: {
      a: { id: "a", kind: "choice", q: "؟", options: [
        { id: "x", label: "ایکس", next: "b", put: { method: "CASH" } },
      ] },
      b: { id: "b", kind: "amount", q: "مبلغ", options: [{ id: "ok", label: "ثبت", save: true }] },
    },
  };
  it("merges put into values and keeps a typed amount under the step id", () => {
    let st = startFlow(cfg, EMPTY_CONTEXT);
    st = answerStep(cfg, EMPTY_CONTEXT, st, "x");
    expect(st.values.method).toBe("CASH");
    st = answerStep(cfg, EMPTY_CONTEXT, st, "ok", "250000");
    expect(st.saved).toBe(true);
    expect(st.values.b).toBe("250000");
  });
});
```

(Use the file's existing imports for `startFlow`, `answerStep`, `EMPTY_CONTEXT`; add any missing ones.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/crm-flow-machine.test.ts`
Expected: FAIL (type error `put` not on `FlowOption`, or `values.method` undefined).

- [ ] **Step 3: Implement**

`lib/flows/item.ts`:
```ts
/** A line a non-CRM flow asks about: a delivery line, a product, a customer. `qty` is what the
 *  system expects; the flow's answer is what actually happened. */
export interface FlowItem {
  id: number;
  label: string;
  qty?: number;
  unit?: string;
  price?: number;
}
```

`lib/crm/flows/types.ts`:
```ts
import type { FlowItem } from "../../flows/item";

export type StepKind =
  | "choice" | "multi" | "input" | "roles" | "basics" | "link" | "pin" | "hours" | "stars" | "driver" | "date"
  | "amount"   // numeric entry, prefilled from ctx.vars[step.input.field]
  | "pick"     // searchable list from step.choices
  | "stepper"; // one +/- row per ctx.items entry

// FlowOption: add
//   /** Plain strings written into `state.values` when this option is tapped (non-CRM flows). */
//   put?: Record<string, string>;

// FlowContext: widen `entry` and add `items`
//   entry: "call" | "talked_now" | "add_lead" | "driver_visit"
//        | "delivery" | "payment" | "complaint" | "outcome" | "order_quick" | "order_action"
//        | "stock_count" | "receive" | "lifecycle" | "visit_plan" | "place" | "expense";
//   items?: FlowItem[];
```
Apply the three edits in place (the comments above mark exactly what to add; keep `EMPTY_CONTEXT` unchanged because `items` is optional).

`lib/crm/flows/machine.ts`, in `answerStep` after `const values = { ...st.values };`:
```ts
  if (opt.put) Object.assign(values, opt.put);
```
(before the `has` handling, so a typed value still wins for its own key).

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/crm-flow-machine.test.ts tests/crm-flow-configs.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors (existing CRM flows are unaffected because both additions are optional).

- [ ] **Step 5: Commit**
```bash
git add lib/crm/flows lib/flows tests/crm-flow-machine.test.ts
git commit -m "feat(tapflow): generic put/items and amount/pick/stepper step kinds"
```

### Task 0.2: Native step bodies

**Files:**
- Create: `components/tapflow/AmountStep.tsx`, `PickStep.tsx`, `StepperStep.tsx`
- Modify: `components/tapflow/TapFlow.tsx` (the `StepBody` dispatch, near line 160 where `view.kind === "choice"` is handled), `app/globals.css`

Answer convention (so `checkFlow` and `replayAnswers` keep working): every body calls `submit(optionId, value)` with a string. `amount` → digits only, **prefilled from `ctx.vars[input.field]` and stored in `state.values[input.field]`** (the step id when there is no `input`); `pick` → the chosen choice id; `stepper` → `JSON.stringify({ [itemId]: n })`.

- [ ] **Step 1: `AmountStep.tsx`**
```tsx
"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import type { ResolvedOption } from "@/lib/crm/flows/types";

/** One number, prefilled, with the likeliest alternatives as chips. The prefill is shown, never
 *  applied silently: the tap on the confirm button is the driver's/cashier's confirmation. */
export default function AmountStep({ prefill, chips, option, submit }: {
  prefill: number | null;
  chips?: { label: string; value: number }[];
  option: ResolvedOption;
  submit: (optionId: string, value: string) => void;
}) {
  const [text, setText] = useState(prefill === null ? "" : String(prefill));
  const n = Number(text.replace(/[^\d]/g, ""));
  return (
    <div className="tf-amount">
      <input className="tf-input ltr" inputMode="numeric" aria-label="مبلغ به تومان" value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))} autoFocus />
      <p className="tf-sub">{n > 0 ? `${faNum(n)} تومان` : "مبلغ را وارد کنید"}</p>
      {chips?.length ? (
        <div className="tf-grid">
          {chips.map((c) => (
            <button key={c.label} type="button" className="tf-opt" onClick={() => setText(String(c.value))}>
              {c.label}<small>{faNum(c.value)}</small>
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-go"
        disabled={!(n > 0)} onClick={() => submit(option.id, String(n))}>
        <Icon name="check" size="md" />{option.label}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `PickStep.tsx`** — search box + list of `choices`, 52 px rows, each row `submit(optionId, choice.id)`; shows the first 8, filters as you type (`String.includes` after Persian-digit/Arabic-yeh normalisation using the helper `normalizeSearch` already used by `SearchBox.tsx` — read it and import, do not re-implement).
```tsx
"use client";

import { useMemo, useState } from "react";
import { normalizeSearch } from "@/lib/search/normalize";

export default function PickStep({ choices, optionId, submit, placeholder = "جستجو…" }: {
  choices: { id: string; label: string }[];
  optionId: string;
  submit: (optionId: string, value: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = normalizeSearch(q);
    return (n ? choices.filter((c) => normalizeSearch(c.label).includes(n)) : choices).slice(0, 8);
  }, [q, choices]);
  return (
    <div className="tf-pick">
      <input className="tf-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <div className="tf-grid one">
        {shown.map((c) => (
          <button key={c.id} type="button" className="tf-opt" onClick={() => submit(optionId, c.id)}>{c.label}</button>
        ))}
      </div>
    </div>
  );
}
```
Before writing, run `grep -rn "normalize" components/SearchBox.tsx lib | head` to find the real helper path/name and use it; if none exists, create `lib/search/normalize.ts` exporting `normalizeSearch(s: string): string` that maps Persian/Arabic digits to ASCII, `ي→ی`, `ك→ک`, strips ZWNJ and lower-cases, with a 4-line test.

- [ ] **Step 3: `StepperStep.tsx`** — one row per `items` entry: label, `−` / count / `+` (each 52 px), prefilled to `item.qty`; clamp `0..qty`; confirm button submits `JSON.stringify(counts)`.
```tsx
"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import type { FlowItem } from "@/lib/flows/item";
import type { ResolvedOption } from "@/lib/crm/flows/types";

export default function StepperStep({ items, option, submit }: {
  items: FlowItem[]; option: ResolvedOption; submit: (id: string, value: string) => void;
}) {
  const [n, setN] = useState<Record<number, number>>(() => Object.fromEntries(items.map((i) => [i.id, i.qty ?? 0])));
  const bump = (i: FlowItem, d: number) =>
    setN((s) => ({ ...s, [i.id]: Math.min(i.qty ?? 0, Math.max(0, (s[i.id] ?? 0) + d)) }));
  return (
    <div className="tf-stepper">
      {items.map((i) => (
        <div key={i.id} className="tf-row">
          <span>{i.label}<small>{i.unit ? ` · ${i.unit}` : ""}</small></span>
          <button type="button" className="tf-opt" aria-label={`کم کردن ${i.label}`} onClick={() => bump(i, -1)}><Icon name="minus" size="md" /></button>
          <b>{faNum(n[i.id] ?? 0)}</b>
          <button type="button" className="tf-opt" aria-label={`اضافه کردن ${i.label}`} onClick={() => bump(i, 1)}><Icon name="plus" size="md" /></button>
        </div>
      ))}
      <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-go"
        onClick={() => submit(option.id, JSON.stringify(n))}><Icon name="check" size="md" />{option.label}</button>
    </div>
  );
}
```
Confirm `minus` and `plus` exist in `components/meridian/icon-map.ts`; if `minus` is missing, add it there following the neighbouring entries (the icon rule in `docs/superpowers/plans/2026-09-30-icon-rule.md` applies).

- [ ] **Step 4: Dispatch in `TapFlow.tsx`.** Pass `ctx` into `StepBody` (new prop `items={p.ctx.items ?? []}` and `vars={p.ctx.vars}`), then before the `view.kind === "choice"` block:
```tsx
{view.kind === "amount" && view.input ? (
  <AmountStep prefill={vars[view.input.field] ? Number(vars[view.input.field]) : null}
    chips={undefined} option={view.options[0]} submit={submit} />
) : null}
{view.kind === "pick" ? <PickStep choices={view.choices} optionId={view.options[0].id} submit={submit} /> : null}
{view.kind === "stepper" ? <StepperStep items={items} option={view.options[0]} submit={submit} /> : null}
```
and make the generic option grid skip these three kinds (`view.kind !== "amount" && …`), because their single option is rendered by the body itself.

- [ ] **Step 5: CSS** in `app/globals.css` beside the `.tf-opt` rules: `.tf-stepper .tf-row{display:grid;grid-template-columns:1fr 52px auto 52px;align-items:center;gap:var(--space-2);min-height:52px}`, `.tf-amount .tf-input{font-size:var(--text-xl);text-align:center}`. Use only existing CSS variables.

- [ ] **Step 6: Tests** — `tests/tapflow-steps.test.ts`: render each body with `react-dom/server`'s `renderToStaticMarkup` (the repo has no DOM test env; check `vitest.config.*` first and follow whatever existing component tests do) and assert the confirm button label and the 52 px class are present. If no component-test pattern exists, test only the pure parts (`StepperStep` clamping logic extracted to `lib/flows/item.ts` as `clampCount(qty, n)`).

- [ ] **Step 7:** `npx tsc --noEmit && npm run lint && npx vitest run` → all PASS. Commit: `feat(tapflow): amount, pick and stepper step bodies`.

### Task 0.3: Shared host hook `useFlowHost`

**Files:** Create `components/tapflow/useFlowHost.ts`. Reference implementation to extract from: `components/crm/AfterCallFlow.tsx:50-105` (load → `startFlow` → `hold` → toast with «بازگردانی ثبت»).

- [ ] **Step 1: Write the hook**
```ts
"use client";

import { useCallback, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { useToast } from "@/components/ToastProvider";
import { useHeldSave } from "@/components/crm/useHeldSave";
import { backStep, startFlow } from "@/lib/crm/flows/machine";
import type { FlowConfig, FlowContext, FlowState } from "@/lib/crm/flows/types";

/** Everything a non-CRM flow host repeats: seed the state once per open (never `stack: []` —
 *  see the `unknown step undefined` note in LeadRunPlannerTabFlow), hold the save for the 5 s
 *  undo window, and toast with «بازگردانی ثبت». The host supplies only `send` and `summary`. */
export function useFlowHost(cfg: FlowConfig, ctx: FlowContext, opts: {
  send: (s: FlowState) => Promise<{ ok: boolean; error?: string }>;
  summary: (s: FlowState) => string;
  failure: string;           // explicit Persian sentence: what failed + what to do
  onFinished?: () => void;
  onReopen?: () => void;
}) {
  const toast = useToast();
  const { hold, cancel, flush } = useHeldSave();
  const [state, setState] = useState<FlowState>(() => startFlow(cfg, ctx));

  const onSaved = useCallback((st: FlowState) => {
    hold(async () => {
      const r = await opts.send(st).catch(() => ({ ok: false, error: undefined }));
      if (!r.ok) toast(friendlyError(r.error, opts.failure), "error");
      else opts.onFinished?.();
    });
    toast(opts.summary(st), "success", {
      label: "بازگردانی ثبت",
      onClick: () => { if (cancel()) { setState(backStep(cfg, ctx, st)); opts.onReopen?.(); } },
    });
  }, [cfg, ctx, hold, cancel, toast, opts]);

  return { state, setState, onSaved, flush };
}
```
- [ ] **Step 2: Test** the pure part only: add `tests/flow-host-restart.test.ts` asserting that `backStep(cfg, ctx, savedState)` returns a state with `saved === false` and the last question on top (use `deliveryFlow` from Task 1.1 once it exists; until then use the inline `cfg` from Task 0.1).
- [ ] **Step 3:** tsc + lint, commit `feat(tapflow): useFlowHost shared host hook`.

### Task 0.4: Shared config assertions

**Files:** Create `tests/helpers/flowAssert.ts`.

- [ ] **Step 1:**
```ts
import { expect } from "vitest";
import { checkFlow, type FlowVariant } from "@/lib/crm/flows/validate";
import type { FlowConfig } from "@/lib/crm/flows/types";

/** Doc §6.4: no dead ends, common path <= declared common, every path <= declared longest,
 *  and the declared budget itself honours §4 (5 / 9, or 7 / 12 for capture flows). */
export function assertFlowBudget(cfg: FlowConfig, variants: FlowVariant[], cap: { common: number; longest: number } = { common: 5, longest: 9 }) {
  const r = checkFlow(cfg, variants);
  expect(r.deadEnds).toEqual([]);
  expect(r.shortest).toBeLessThanOrEqual(cfg.budget.common);
  expect(r.longest).toBeLessThanOrEqual(cfg.budget.longest);
  expect(cfg.budget.common).toBeLessThanOrEqual(cap.common);
  expect(cfg.budget.longest).toBeLessThanOrEqual(cap.longest);
}

/** Every option label is real Persian copy, not a code: rejects ALL_CAPS or snake_case labels. */
export function assertNoRawEnumLabels(cfg: FlowConfig) {
  for (const s of Object.values(cfg.steps)) {
    const opts = typeof s.options === "function" ? [] : s.options;
    for (const o of opts) expect(o.label).not.toMatch(/^[A-Z_]+$|^[a-z]+_[a-z_]+$/);
  }
}
```
Dynamic `options` functions are exercised by `checkFlow`; this helper only inspects static ones.
- [ ] **Step 2:** tsc, commit `test(tapflow): shared flow budget assertions`.

---

## Phase 1 — Delivery at the door (highest value)

**Context:** `components/driver/DriverRun.tsx:160-376` renders, per stop, a number input per line (prefilled to `packs_ordered`) plus a collected-amount input; `record()` enqueues to `lib/deliveryQueue`, POSTs `/api/driver/stops/:id` (`{ lines:[{line_id,packs_delivered}], collected_toman, notes }`), then prints a receipt. The endpoint is idempotent (assignments, not increments), so queue + retry stays as is.

**Step tree** (budget `common: 2`, `longest: 5`):
```
all   "همهٔ اقلام تحویل شد؟"   [بله، همه ✓rec → cash] [نه، کم شد → short]
short (stepper)  per-line counts, prefilled to ordered  [ادامه → why]
why   "چرا کم شد؟"  [موجودی کم بود][مشتری نپذیرفت][خراب بود][سایر] → cash   (put short_reason)
cash  "پول گرفتید؟"  [کل مبلغ · {total} ✓rec → SAVE][چیزی نگرفتم → SAVE (0)][مبلغ دیگر… → amount]
amount (amount, prefilled with total) [ثبت → SAVE]
```
Common path: بله → کل مبلغ = **2 taps**. Longest: نه → ادامه → why → مبلغ دیگر → ثبت = **5 taps**.

### Task 1.1: `deliveryFlow` config + payload builder

**Files:** Create `lib/flows/delivery.ts`; Test `tests/flow-delivery.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep } from "@/lib/crm/flows/machine";
import { deliveryFlow, deliveryPayload } from "@/lib/flows/delivery";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const ctx: FlowContext = {
  ...EMPTY_CONTEXT, entry: "delivery",
  vars: { customer: "نانوایی سنگک", total_toman: "1200000", total_label: "۱٬۲۰۰٬۰۰۰ تومان" },
  items: [{ id: 11, label: "شیر ۱ لیتری", qty: 10, price: 60000 }, { id: 12, label: "ماست", qty: 6, price: 100000 }],
};

describe("delivery flow", () => {
  it("meets its tap budget with no dead ends", () => {
    assertFlowBudget(deliveryFlow, [{ ctx, values: { collected_amount: "500000" } }]);
    assertNoRawEnumLabels(deliveryFlow);
  });
  it("all delivered + full cash = the 2-tap path", () => {
    let st = startFlow(deliveryFlow, ctx);
    st = answerStep(deliveryFlow, ctx, st, "yes");
    st = answerStep(deliveryFlow, ctx, st, "full");
    expect(st.saved).toBe(true);
    expect(deliveryPayload(ctx, st)).toEqual({
      lines: [{ line_id: 11, packs_delivered: 10 }, { line_id: 12, packs_delivered: 6 }],
      collected_toman: 1200000, notes: null,
    });
  });
  it("short delivery records the counts, the reason, and the typed amount", () => {
    let st = startFlow(deliveryFlow, ctx);
    st = answerStep(deliveryFlow, ctx, st, "no");
    st = answerStep(deliveryFlow, ctx, st, "ok", JSON.stringify({ 11: 10, 12: 4 }));
    st = answerStep(deliveryFlow, ctx, st, "stock");
    st = answerStep(deliveryFlow, ctx, st, "other");
    st = answerStep(deliveryFlow, ctx, st, "ok", "500000"); // stored under values.collected_amount
    expect(deliveryPayload(ctx, st)).toEqual({
      lines: [{ line_id: 11, packs_delivered: 10 }, { line_id: 12, packs_delivered: 4 }],
      collected_toman: 500000, notes: "موجودی کم بود",
    });
  });
  it("collecting nothing sends 0, never the total", () => {
    let st = startFlow(deliveryFlow, ctx);
    st = answerStep(deliveryFlow, ctx, st, "yes");
    st = answerStep(deliveryFlow, ctx, st, "none");
    expect(deliveryPayload(ctx, st).collected_toman).toBe(0);
  });
});
```
- [ ] **Step 2:** `npx vitest run tests/flow-delivery.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `lib/flows/delivery.ts`**
```ts
import type { FlowConfig, FlowContext, FlowState } from "@/lib/crm/flows/types";

const REASON: Record<string, string> = {
  stock: "موجودی کم بود", refused: "مشتری نپذیرفت", damaged: "خراب بود", other: "سایر",
};

export const deliveryFlow: FlowConfig = {
  id: "delivery",
  start: () => "all",
  budget: { common: 2, longest: 5 },
  steps: {
    all: {
      id: "all", kind: "choice", q: "همهٔ اقلام تحویل شد؟", sub: "{customer} · جمع {total_label}",
      options: [
        { id: "yes", label: "بله، همه", sub: "تعداد همان سفارش است", tone: "rec", next: "cash", put: { counts: "ordered" } },
        { id: "no", label: "نه، کم شد", sub: "تعداد هر قلم را اصلاح می‌کنید", next: "short" },
      ],
    },
    short: {
      id: "short", kind: "stepper", q: "از هر قلم چند بسته تحویل شد؟",
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "why" }],
    },
    why: {
      id: "why", kind: "choice", q: "چرا کم شد؟",
      options: Object.entries(REASON).map(([id, label]) => ({ id, label, next: "cash", put: { reason: label } })),
    },
    cash: {
      id: "cash", kind: "choice", q: "پول گرفتید؟", sub: "جمع فاکتور: {total_label}",
      options: [
        { id: "full", label: "کل مبلغ", sub: "{total_label}", tone: "rec", save: true, put: { collected: "total" } },
        { id: "none", label: "چیزی نگرفتم", sub: "به حساب مشتری می‌ماند", save: true, put: { collected: "0" } },
        { id: "other", label: "مبلغ دیگر…", next: "amount" },
      ],
    },
    amount: {
      id: "amount", kind: "amount", q: "چقدر گرفتید؟", input: { field: "collected_amount", placeholder: "مبلغ به تومان", ltr: true },
      options: [{ id: "ok", label: "ثبت", tone: "rec", save: true }],
    },
  },
};

/** The exact body POST /api/driver/stops/:id expects. */
export function deliveryPayload(ctx: FlowContext, st: FlowState) {
  const items = ctx.items ?? [];
  const counts: Record<string, number> = st.values.short ? JSON.parse(st.values.short) : {};
  const lines = items.map((i) => ({
    line_id: i.id,
    packs_delivered: st.values.counts === "ordered" ? (i.qty ?? 0) : Number(counts[i.id] ?? 0),
  }));
  const total = Number(ctx.vars.total_toman ?? 0);
  const collected =
    st.values.collected_amount !== undefined ? Number(st.values.collected_amount)
    : st.values.collected === "total" ? total
    : Number(st.values.collected ?? 0);
  return { lines, collected_toman: collected, notes: st.values.reason ?? null };
}
```
Note: a stepper's total must reflect reduced counts. `total_toman` in `ctx.vars` is the ordered total; in the host (Task 1.2) recompute `total_label`/`total_toman` for the `cash` step from the stepper answer by passing `ctx` through a `useMemo` that reads `state.values.short` (see Step 3 of Task 1.2) — the config itself stays pure.
- [ ] **Step 4:** `npx vitest run tests/flow-delivery.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(flows): delivery tap flow config and payload`.

### Task 1.2: Host + wire into `DriverRun`

**Files:** Create `components/flows/DeliveryFlow.tsx`; Modify `components/driver/DriverRun.tsx`

- [ ] **Step 1:** `DeliveryFlow` props: `{ open, stop: RunStop, runDate, driverName, businessName, onRecorded, onPrint, onClose }`. Build `ctx` with `useMemo` from `stop.lines` (`items: lines.map(l => ({id:l.id,label:`${l.product_name} · ${l.packaging_name}`,qty:l.packs_ordered,price:l.unit_price_toman}))`, `vars: { customer: stop.customer_name, total_toman, total_label: faToman(total_toman) }`). Recompute `total_toman` from the stepper answer when `state.values.short` is set (sum `roundToman(count * price)`), so «کل مبلغ» is the *delivered* total. Use `useFlowHost(deliveryFlow, ctx, { send, summary, failure })` where `send` does exactly what `record()` does today:
```ts
const body = deliveryPayload(ctx, st);
enqueue({ stopId: stop.id, body, recordedAt: new Date().toISOString() });
const res = await send(stop.id, body);           // existing helper in DriverRun.tsx — move it to lib/deliveryQueue.ts and export
if (res.ok || (res.status >= 400 && res.status < 500)) dequeue(stop.id);
return { ok: res.ok, error: res.ok ? undefined : (await res.json().catch(() => ({}))).error };
```
Keep the 5xx/network behaviour: stays queued, toast says it will be sent when online.
- [ ] **Step 2:** Done screen: `FlowDone` chips = «تحویل کامل»/«تحویل ناقص», collected label, reason if any; action button «چاپ رسید» → `await flush(); onPrint(receiptFor(...))` (move `receiptFor` out of `DriverRun.tsx` into `lib/flows/delivery.ts`'s sibling `lib/deliveryReceipt.ts` so both can use it).
- [ ] **Step 3:** In `DriverRun.tsx` replace the expanded form body (inputs, collected input, record button) with one button «ثبت تحویل این مشتری» that opens `DeliveryFlow`. Keep the stop header, address, navigation and phone buttons. Delete the now-unused `packs`/`collected` state.
- [ ] **Step 4:** Offline check: `OFFLINE_OPS["delivery.complete"]` is already a `fact`; verify `lib/offline/safety.ts` needs no change and that a flow finished with no signal leaves the entry in `deliveryQueue` (manual: DevTools offline → finish → `localStorage["delivery-queue-v1"]` has one item).
- [ ] **Step 5:** `npx tsc --noEmit && npm run lint && npx vitest run && npm run audit-copy`. Commit `feat(driver): delivery at the door as a tap flow`.

---

## Phase 2 — Payments and cheques

**Context:** `PaymentsPanel` POSTs `/api/payments` `{ customer_id, amount_toman, method, received_at, reference, note, allocations? }` with methods `CASH | POS | CARD_TO_CARD | CHEQUE | CREDIT_NOTE | OTHER`. A cheque goes to `/api/cheques` `{ customer_id, amount_toman, cheque_no, bank_name, due_date, received_at, note }` (server runs `recordChequePayment`, which creates both the cheque and its payment). Filters, allocation editor and the history list are **not** flows and stay.

**Step tree** (budget `common: 3`, `longest: 7`; `common` counts customer pick):
```
who    (pick)  customer search; skipped when ctx.vars.customer_id is set
method "چطور پرداخت شد؟"  [نقد][کارتخوان][کارت به کارت][چک][سایر]   (CHEQUE → cheque_no, others → amount)
amount (amount, prefilled with ctx.vars.balance_toman, chips: «کل مانده»)  [ثبت → SAVE]
cheque_no (input, required, ltr) → bank (choice of 6 common banks + سایر) → due (date) → cheque_amount (amount) [ثبت → SAVE]
```
Common: who → method → amount = 3 taps (2 from a customer screen). Longest: who, method=چک, no, bank, due, amount = 7... (`input` counts one tap on its confirm button).

### Task 2.1: `paymentFlow` config + payloads

**Files:** Create `lib/flows/payment.ts`; Test `tests/flow-payment.test.ts`

- [ ] **Step 1: Failing test**
```ts
const ctx = { ...EMPTY_CONTEXT, entry: "payment" as const,
  vars: { balance_toman: "800000", received_at: "2026-10-20" },
  recentCustomers: [{ id: 5, name: "بقالی رضا" }] };

it("cash for a known customer = 2 taps and the right body", () => {
  const c = { ...ctx, vars: { ...ctx.vars, customer_id: "5" } };
  let st = startFlow(paymentFlow, c);
  st = answerStep(paymentFlow, c, st, "CASH");
  st = answerStep(paymentFlow, c, st, "ok", "800000");
  expect(st.saved).toBe(true);
  expect(paymentRequest(c, st)).toEqual({ url: "/api/payments", body: {
    customer_id: 5, amount_toman: 800000, method: "CASH", received_at: "2026-10-20", reference: null, note: null } });
});
it("cheque goes to /api/cheques with number, bank and due date", () => {
  const c = { ...ctx, vars: { ...ctx.vars, customer_id: "5" } };
  let st = startFlow(paymentFlow, c);
  st = answerStep(paymentFlow, c, st, "CHEQUE");
  st = answerStep(paymentFlow, c, st, "ok", "123456");        // cheque_no input step
  st = answerStep(paymentFlow, c, st, "melli");
  st = answerStep(paymentFlow, c, st, "ok", "2026-12-01");    // due date step
  st = answerStep(paymentFlow, c, st, "ok", "800000");
  expect(paymentRequest(c, st).url).toBe("/api/cheques");
  expect(paymentRequest(c, st).body).toMatchObject({ customer_id: 5, cheque_no: "123456", bank_name: "ملی", due_date: "2026-12-01", amount_toman: 800000 });
});
it("budget", () => assertFlowBudget(paymentFlow, [
  { ctx: { ...ctx, vars: { ...ctx.vars, customer_id: "5" } }, values: { amount: "1", cheque_no: "1", due: "2026-12-01" } },
  { ctx, values: { who: "5", amount: "1", cheque_no: "1", due: "2026-12-01" } },
], { common: 5, longest: 9 }));
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `lib/flows/payment.ts` with: `start: ctx => ctx.vars.customer_id ? "method" : "who"`; `who` is `kind:"pick"`, `choices: ctx => ctx.recentCustomers.map(c => ({id:String(c.id), label:c.name}))`, one option `{id:"pick", label:"ادامه", next:"method", put:{}}` (the picked id arrives as the answer value and is stored under `values.who`); `method` options with `put: { method: "CASH" }` etc. and `next` = `"cheque_no"` for CHEQUE else `"amount"`; `amount` is `kind:"amount"`, `input.field:"balance_toman"`, option `ok` saves; `cheque_no` is `kind:"input"` with `input:{field:"cheque_no",placeholder:"شمارهٔ چک",ltr:true}` and option `ok` → `bank`; `bank` choice with ids `melli, mellat, saderat, tejarat, parsian, other` (labels ملی، ملت، صادرات، تجارت، پارسیان، سایر) each `next:"due", put:{bank_name: label}`; `due` is `kind:"date"` (host renders with `JalaliDateInput`, see Task 2.2) option `ok → cheque_amount`; `cheque_amount` = amount step saving. Export
```ts
export function paymentRequest(ctx: FlowContext, st: FlowState): { url: string; body: Record<string, unknown> }
```
that reads `customer_id = Number(ctx.vars.customer_id ?? st.values.who)`, `amount = Number(st.values.cheque_amount ?? st.values.amount)`, and returns the cheque body when `st.values.method === "CHEQUE"`, else the payment body (`reference: null, note: null`).
- [ ] **Step 4:** tests PASS; Step 5 commit `feat(flows): payment and cheque tap flow config`.

### Task 2.2: Hosts and wiring

**Files:** Create `components/flows/PaymentFlow.tsx`; Modify `components/sales/PaymentsPanel.tsx`, `components/sales/ChequesBoard.tsx`, `components/CustomerDetailPanel.tsx`

- [ ] **Step 1:** `PaymentFlow` props `{ open, customers, customerId?, balanceToman?, defaultMethod?, onRecorded, onClose }`. `renderCustom` for `kind:"date"` returns `<JalaliDateInput …/>` + «ثبت» that calls `api.submit("ok", iso)` (copy the pattern from `LeadRunPlannerTabFlow.tsx:233+`). `send` POSTs `paymentRequest(...)`. Offline: route through the existing outbox for `payment.record` only if `PaymentsPanel` already does; otherwise leave online-only and say so in the failure copy.
- [ ] **Step 2:** `PaymentsPanel`: add a top button «ثبت دریافت جدید» (full-width on mobile) that opens `PaymentFlow`. Hide the existing `<form>` below `md` (`hidden md:flex`) and keep it on desktop. Keep filters, allocation editor and list unchanged.
- [ ] **Step 3:** `ChequesBoard`: same, with `defaultMethod="CHEQUE"` so the flow starts at the cheque branch (add `start: ctx => ctx.vars.customer_id ? (ctx.vars.method === "CHEQUE" ? "cheque_no" : "method") : "who"` and `put` the method when `defaultMethod` is given by seeding `state.values.method`).
- [ ] **Step 4:** `CustomerDetailPanel`: add «ثبت دریافت» using the customer id and balance (read from the existing statement fetch).
- [ ] **Step 5:** tsc, lint, vitest, audit-copy. Commit `feat(sales): payments and cheques as tap flows`.

---

## Phase 3 — Complaints

**Context:** `/api/sales/complaints` POST takes `{ customer_id, order_id, product_id, batch_id, category, severity, description }`; categories `spoilage, packaging, foreign_object, short_weight, wrong_product, other`; severities low/medium/high/critical (labels in `ComplaintsPanel.tsx:9-25`; move both label maps to `lib/flows/complaint.ts` and import them back, one source).

**Step tree** (`common: 4`, `longest: 6`): `who (pick customer)` → `what (pick product, or «نامشخص»)` → `kind (6 chips)` → `severity (4 chips, «متوسط» rec)` → `note (input, optional) [ثبت → SAVE]`. Spoilage/foreign_object/packaging additionally ask `photo` (optional, reuses `PhotoGallery` upload endpoint `/api/photos`) — **only if** the Phase 3 Step 2 check below shows a complaint photo column exists; otherwise skip photo and note it in the journal.

### Task 3.1: Config + payload + test
- [ ] **Step 1:** `tests/flow-complaint.test.ts`: walk `who=5, what=9, spoilage, high, note ok` and assert `complaintPayload` equals `{ customer_id:5, product_id:9, category:"spoilage", severity:"high", description:null, order_id:null, batch_id:null }`; budget via `assertFlowBudget(complaintFlow, [{ctx, values:{who:"5",what:"9"}}], {common:5,longest:9})`; a note typed as `"بوی بد"` lands in `description`.
- [ ] **Step 2:** FAIL. **Step 3:** implement `lib/flows/complaint.ts` (steps above; `pick` choices from `ctx.recentCustomers` and `ctx.products`; categories/severities as `choice` options with `put`). **Step 4:** PASS. **Step 5:** `grep -n "photo" lib/repo/complaints.ts` to settle the photo question. Commit `feat(flows): complaint tap flow config`.

### Task 3.2: Host + wiring
- [ ] **Step 1:** `components/flows/ComplaintFlow.tsx` (POST `/api/sales/complaints`). **Step 2:** `ComplaintsPanel`: «ثبت شکایت» button; hide the one-row form below `md`; keep the list, clusters and status controls. **Step 3:** also offer «ثبت شکایت» from `orders/[id]/page.tsx` with `order_id` prefilled (add `order_id` to `put`/payload when `ctx.vars.order_id` is set). **Step 4:** checks + commit `feat(sales): complaints as a tap flow`.

---

## Phase 4 — Task and reminder outcomes (mobile tap targets)

**Context:** `components/today/OutcomeChips.tsx` renders four ~24 px pills (`py-[2px]`) used by `TaskRow` (`/today`, `/sales/today`) and the Board's "drop into انجام‌شده". `QuickAdd` (Pocket) and `AddReminder` are small inline forms.

### Task 4.1: `outcomeFlow`
- [ ] Tree (`common: 2`, `longest: 4`): `outcome` ([تماس گرفتم][سفارش داد][قیمت را زیاد دانست][علاقه ندارد][جواب نداد]) → `when` (time chips: امروز عصر / فردا ۱۰:۰۰ / ۲ روز دیگر / روز دیگر… / بدون کار بعدی… with the standard `timeOptions` helper from `lib/crm/flows/common.ts`). Reuse `OUTCOMES` from `lib/crm/outcomes` so codes stay in one place. Payload = what `TaskRow` already PATCHes (`/api/tasks/:id`); read `TaskRow.tsx` first and mirror its body exactly — do not invent a new field.
- [ ] Test `tests/flow-outcome.test.ts` (budget + payload for «سفارش داد» → فردا). Host `components/flows/OutcomeFlow.tsx`. In `TaskRow` replace the four inline chips with one 52 px button «ثبت نتیجه» (keep chips at `md:`). Same swap in `Board.tsx`/`BoardMobile.tsx`. Commit `feat(today): task outcome as a tap flow`.

### Task 4.2: `reminderFlow`
- [ ] Tree (`common: 2`, `longest: 3`): `kind` ([یادآوری][یادداشت]) → `when` (only for reminder: time chips) → `text` (input, required) [ثبت → SAVE]. Replace `QuickAdd`'s and `AddReminder`'s inline forms on mobile with one «+ افزودن» button opening it; reuse their existing POST (`/api/reminders`). Commit `feat(pocket): reminder and note as a tap flow`.

---

## Phase 5 — Orders

### Task 5.1: `orderQuickFlow` (repeat customer)
**Context:** `OrderForm.tsx` posts the order (read its `submit` for the exact body and endpoint; reuse the same function by extracting it to `lib/flows/orderQuick.ts`'s sibling `lib/orderSubmit.ts` so desk and flow share it).
- [ ] Tree (`common: 4`, `longest: 8`): `who (pick)` → `same (same as last time? [بله، همان سفارش قبلی ✓rec][تغییر می‌دهم][سفارش تازه → opens full OrderForm])` → (`adjust` stepper, only on تغییر) → `day` (chips: زودترین / فردا / پس‌فردا / روز دیگر…) → `confirm` (summary line + [ثبت سفارش → SAVE]). Last order lines come from `GET /api/sales/customers/:id/summary` (already exists) — extend nothing server-side if it returns lines; otherwise add the lines to that response and cover it with a repo test.
- [ ] Tests: budget, payload equality with `OrderForm`'s body for the "same as last time" path. Host `components/flows/OrderQuickFlow.tsx`; on `/sales/orders/new` show the flow first on mobile with a link «سفارش تازه (فرم کامل)». Commit `feat(orders): repeat-order quick flow`.

### Task 5.2: `orderActionFlow`
**Context:** `OrderStatusPanel` runs `run(action)` against `/api/sales/orders/:id/transition`; `ConfirmOrderButton` already has an "asking" state (an *are-you-sure*, which the doc §8 forbids).
- [ ] Tree: `reason` only for destructive actions (cancel, fail): chips from `/api/sales/reason-codes` (existing), `tone:"bad"`, then SAVE; non-destructive actions save immediately with the 5 s undo toast and **no** confirm. Replace `ConfirmOrderButton`'s "asking" state with undo. Tests: cancel requires a reason, confirm does not (`checkFlow` shortest = 1 for confirm, 2 for cancel). Commit `feat(orders): status actions with undo instead of confirm`.

---

## Phase 6 — Stock

### Task 6.1: `stockCountFlow`
**Context:** `InventoryBoard.tsx:273+` edits a threshold/value per row via `/api/sales/products/:id/stock-thresholds` and `/api/sales/stock/movements`; read both routes to decide which one a *count* should write (a count is a movement of type "adjust" if the movements route supports it — confirm in `app/api/sales/stock/movements/route.ts` before coding; if it does not, the flow records into the existing endpoint the board uses and the journal notes the gap).
- [ ] Tree per product (`common: 1` per product, `longest: 3`): `asExpected ([درست است ✓rec → SAVE][فرق دارد → count])` → `count (amount, prefilled with system qty)` → `why (chips: خراب، تاریخ گذشته، گم شده، نمونه — reuse `DISPOSITIONS` from `lib/repo/unload`)`. A host loops through products with an in-sheet «بعدی» (rule 16: one sheet; the loop is the host's, each product is one flow instance with a progress label «۳ از ۱۲»).
- [ ] Test: budget + `why` required only when the count differs. Commit `feat(stock): count flow`.

### Task 6.2: `receiveFlow` (goods at the door)
- [ ] Tree (`common: 4`, `longest: 7`): `product (pick)` → `qty (amount)` → `supplierBatch (input, optional)` → `expiry (date, optional skip)` → SAVE to `/api/sales/batches` (body from `BatchesPanel`'s `submit`). `PurchaseEntry` (multi-line invoice with costs) stays a desk form; add a mobile-only «دریافت کالا» button on `/sales/stock`. Commit `feat(stock): receive-goods flow`.

---

## Phase 7 — Customer, planner, places

### Task 7.1: `lifecycleFlow`
- [ ] Source of truth: `LIFECYCLE_TRANSITIONS` in `lib/customerLifecycle.ts`; options are generated from it for the current state, each with a consequence sub-label; destructive targets (`tone:"bad"`) ask one `reason` step (reuse `LOST_REASON_LABEL`) with a gentler alternative offered (doc rule 7). Writes via the existing `PATCH /api/customers/:id/lifecycle`. Replace the `<select>` in `CustomerDetailPanel`. Tests: every transition in `LIFECYCLE_TRANSITIONS` is reachable; no option outside the table exists. Commit `feat(customers): lifecycle as a tap flow`.

### Task 7.2: `visitPlanFlow`
- [ ] `/planner` search → add becomes: `who (pick customer or lead)` → `day (chips: امروز / فردا / این هفته / روز دیگر…)` → SAVE to `/api/visit-plans`. Mobile-only entry button; the large planner map/table stays (see Phase 8). Commit `feat(planner): visit plan quick-add flow`.

### Task 7.3: `placeFlow`
- [ ] `/facilities` new place: `kind (chips: انبار، دفتر، …)` → `name (input)` → `where` (reuse `PlacePicker` as a host-rendered `pin` step) → SAVE to `/api/facilities`. Inline rename stays inline (doc §1). Commit `feat(facilities): create-place flow`.

---

## Phase 8 — Mobile-first layout pass (no new flows)

Do this in the order below; each task is independently shippable and verified at a 375 px viewport with `chrome-devtools`/Playwright screenshots saved to the scratchpad (do **not** run `next build`).

### Task 8.1: Touch-target audit
- [ ] **Step 1:** `grep -rn "py-\[2px\]\|py-\[var(--space-1)\]" components app | wc -l` to size it. **Step 2:** add a `.touch` utility (`min-height:44px;min-width:44px`) to `app/globals.css` and apply it to the smallest interactive controls found (status action buttons, chips, icon-only buttons); answer buttons in flows stay 52 px. **Step 3:** extend `scripts/check-contrast.mjs`-style script `scripts/check-touch-targets.mjs` that greps for `py-[2px]` on `<button` and fails if any remain; wire into `package.json` as `check:touch`. Commit `style: 44px minimum touch targets`.

### Task 8.2: `ResponsiveTable` + accounting pages
- [ ] Create `components/meridian/ResponsiveTable.tsx`: renders a normal `<table>` at `md:` and above, and at narrower widths one card per row (label/value pairs) from the same `columns` definition. Adopt in `AcctTable` first (journal, ledger, trial balance, balance sheet, income statement, payables, suppliers, expenses all inherit it). Test the pure column→card mapping function. Commit `feat(accounting): card rows on phones`.

### Task 8.3: Orders, schedule, dashboard, analytics
- [ ] `/sales/orders` (pipeline + journey views): default to the existing `BoardMobile` pager pattern on phones. `/sales/schedule`: day strip + one day list below `md`. `/sales/dashboard` and `/analytics`: single-column stack, charts at full width with `ChartFrame` min-height, tables via `ResponsiveTable`. One commit per page.

### Task 8.4: `/planner` (1121 lines)
- [ ] Split into `PlannerMap` and `PlannerList` panes with a bottom segmented control («نقشه» / «فهرست») below `md`; no logic changes. Extract first (pure move, tests unchanged), then add the toggle. Two commits.

### Task 8.5: Modals → bottom sheets
- [ ] `ProcessingModal` → render inside the same `.sheet` container TapFlow uses (shared swipe-dismiss via `useSwipeDismiss`). `CustomerDetailPanel`: default `orient` to `"bottom"` when `matchMedia("(max-width: 767px)")` and no saved preference. Commit `style: phone-first sheets`.

---

## Phase 9 — Expense entry (confirmed)

`app/api/accounting/expenses/route.ts` has a POST but no UI. If you want entry on mobile: `category (chips) → amount (amount) → supplier (pick, optional) → photo (optional) [ثبت → SAVE]`, budget `common: 3`. **Confirmed in scope.** Add `lib/flows/expense.ts` + `components/flows/ExpenseFlow.tsx` and a «+ هزینه» button on `/accounting/expenses`, following the Task 2.1/2.2 pattern.

---

## Verification (every phase)

- [ ] `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (unit only), `npm run audit-copy`.
- [ ] `docs/tap-flow-principles.md` §9 checklist ticked per flow in the journal: common ≤ 5 taps, longest ≤ 9, nothing already known is asked, recommended answer highlighted not pre-selected, typing only where the app can't know, back keeps answers, ends autosaved with 5 s undo toast and 5 s auto-return, server effects unchanged, works offline where the op is a `fact`, RTL + Persian digits + Shamsi dates + `<Icon>`.
- [ ] Manual 375 px pass on each touched screen in `npm run dev` (dev server is allowed; `next build` is not).

## Self-review (against the review list)

| Review item | Task |
|---|---|
| 1 Delivery at the door | 1.1–1.2 |
| 2 Payment received | 2.1–2.2 |
| 3 Cheque entry | 2.1–2.2 (cheque branch, `ChequesBoard`) |
| 4 Complaint | 3.1–3.2 |
| 5 Task / reminder outcomes, tiny pills | 4.1–4.2, 8.1 |
| 6 Repeat-customer order | 5.1 |
| 7 Order status changes, confirm → undo | 5.2 |
| 8 Stock count | 6.1 |
| 9 Batch receiving / purchase | 6.2 |
| 10 Customer lifecycle | 7.1 |
| 11 Visit plan quick-add | 7.2 |
| 12 Create a place | 7.3 |
| Expense entry | 9 |
| Wide pages, accounting tables, planner, dashboard, schedule, orders | 8.2–8.4 |
| Modals/sheets, touch targets | 8.1, 8.5 |

**Known open points to settle during implementation (each has a concrete check in its task):** whether complaints have a photo column (3.1 step 5); whether the movements route accepts a count adjustment (6.1); whether `/api/sales/customers/:id/summary` returns last-order lines (5.1); whether payments already go through the offline outbox (2.2 step 1); whether `normalizeSearch` already exists (0.2 step 2).

## Suggested order and sizing

1. Phase 0 (4 tasks) — unblocks everything.
2. Phase 1 → 2 → 3 — highest field value, one PR each.
3. Phase 4, then 8.1 (touch targets) — cheap, broad mobile win.
4. Phase 5–7 — as capacity allows.
5. Phase 8.2–8.5 — can run in parallel with 5–7 on a separate branch (different files).
6. Phase 9 — expense entry, after Phase 2 (reuses its amount/pick steps).
