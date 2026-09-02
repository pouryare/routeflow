# Per-agent audit findings (full)


---

## /sales document-pocket ("cards behind the card") effect — regression analysis + restore/generalise spec

The peeking-cards-behind effect is NOT structurally deleted on this branch — the peek band and the hover fan still render, because the `.doc` slips are SIBLINGS of `.face` (not children), so neither `overflow:hidden` on `.face` nor the pre-existing `overflow:hidden` on the `.kblock` wrapper can clip them. What regressed is the *read* of the effect, from two additive rules: (1) commit 01c69fa put a hard 3px saturated `::after` bar on `.face` exactly along the pocket's fold line — the seam the papers tuck behind — which turns "papers in a pocket" into "papers behind a card with a header stripe"; (2) commit 3156a50 gave every `.doc` a `1px solid var(--border-strong)` edge (plus a dark-skin box-shadow) so the slips read as stacked UI panels rather than paper. On `main` the live effect appears on exactly ONE screen, `/sales/orders` (OrdersPockets → PocketCard); the global-scope `.pocket__papers` system (components/sales/OrderPocketCard.tsx) is dead code on BOTH branches (defined, never imported), and app/sales/pocket is an unrelated customer window. Fix = drop `.face` from the top-bar list, revert `.face` overflow, scope the `.doc` border to the dark skin only; then promote one reusable `.pocketed` treatment + a tiny `<Pocketed>` wrapper and apply it to kanban task cards, cheque cards, batch cards, the پاکت customer card, and delivery/payment receipts.

### [REGRESSION] PRIMARY: .face::after status/accent bar is painted across the pocket fold line, destroying the 'tucked-in papers' read

**Root cause:** Commit 01c69fa ('Adopt status top bar on pocket cards; .face gets the bar primitive') added `.kargah .face::after` to the shared top-bar selector list at app/globals.css ~line 2624-2631. That pseudo is `position:absolute; inset-block-start:0; inset-inline:0; height:3px; z-index:2` inside `.face` (which is `position:relative; z-index:1`, a stacking context), with `background: linear-gradient(90deg,var(--accent),var(--accent-2),var(--tint-plum))` by default and a solid `var(--good)/var(--info)` when PocketCard passes `data-tone` (STATUS_TONE map, PocketCard.tsx line 17 + line 74). `.face`'s top edge sits at y~=82 in pocket coords; the `.doc` slips at rest occupy y~=52..124 (`.doc{inset-block-start:0}` inside `.docs{inset-block-start:0}` then `transform:translateY(52px/56px)`), so the ~30px visible peek is the band y~=52..82 — directly under this new 3px bar. The bar does not cover the peek pixel-for-pixel, but it draws a bright saturated line exactly on the seam where the papers disappear behind the face, so the composition stops reading as a pocket. This is the change explicitly aimed at these cards and is the dominant cause of the user's 'you removed it'.

- `app/globals.css` @ 2622-2638 (.kcard/.card/.kblock/.prow/.ptile/.gcard/.face ::after list + [data-tone] ::after overrides) — `.kargah .face::after,` is the offending selector in the list; remove that one line
- `app/globals.css` @ 2154 (.kargah .face) — `.face` is `position:relative; z-index:1` — the stacking context the bar lives in
- `components/kargah/PocketCard.tsx` @ 15-19 STATUS_TONE, 74 <div className="face" data-tone=...> — component feeds the tone that makes the fold bar green/blue

**Fix:**
In app/globals.css, delete the line `  .kargah .face::after,` from the top-bar selector group (the group starting `.kargah .kcard::after,` around line 2624). The other six selectors keep their bars. Then in components/kargah/PocketCard.tsx revert the branch additions: delete the STATUS_TONE const (lines 15-19) and change `<div className="face" data-tone={STATUS_TONE[status]}>` back to `<div className="face">` (line 74). Status is already carried by `.pill ${status}` in the foot, so nothing is lost. If a status cue on the pocket itself is still wanted later, add it as a short inset-inline-start tab that does NOT touch the top edge: `.kargah .face[data-tone]::after{content:"";position:absolute;inset-block:12px auto;inset-inline-start:0;width:3px;height:32px;border-radius:0 3px 3px 0;z-index:3;background:var(--accent)} .kargah .face[data-tone="good"]::after{background:var(--good)} .kargah .face[data-tone="warn"]::after{background:var(--warn)} .kargah .face[data-tone="crit"]::after{background:var(--crit)} .kargah .face[data-tone="info"]::after{background:var(--info)}` — a side rail, never a fold bar.

**Risk:** The generic `.kargah [data-tone="good"]::after` etc. rules (globals.css ~2635-2638) still exist; once `.face::after` has no `content` they are inert no-ops on `.face`, but audit that no other branch element carries both `data-tone` and a content-bearing `::after` unintentionally. Verify on /sales/orders in both skins and 2-3 accents that the fold is now a clean frosted edge with the papers emerging from behind it.

### [REGRESSION] SECONDARY: .doc slips got a hard border + dark-skin shadow on the light skin too, so they read as stacked UI panels not paper

**Root cause:** Commit 3156a50 ('Image-2: give pocket doc cards a visible edge on the dark skin') added `border: 1px solid var(--border-strong)` to `.kargah .doc` UNCONDITIONALLY (app/globals.css line 2126) plus a `:root[data-skin="dark"] .kargah .doc` override with an extra `0 0 0 1px rgba(255,255,255,.06)` ring and heavier casts (lines 2131-2137). On `main` `.doc` had NO border — just the soft warm double box-shadow (`0 2px 6px rgba(62,44,28,.10), 0 10px 24px -12px rgba(62,44,28,.3)`). `--border-strong` in the `.kargah` scope resolves to `#DED4C6` (globals.css line 1506) on the default light skin — a visible warm hairline that, combined with the new fold bar, makes the two slips look like duplicated card chrome rather than sheets of paper peeking out. The dark-skin problem the commit set out to fix was real; the fix should have been dark-skin-only.

- `app/globals.css` @ 2124-2137 (.kargah .doc and :root[data-skin="dark"] .kargah .doc) — unconditional `border` on line 2126; dark-skin override block 2131-2137
- `app/globals.css` @ 1506 (.kargah { --border-strong:#DED4C6 }) — what the light-skin border resolves to

**Fix:**
Restore main's light-skin look and keep only the dark-skin fix. Change line 2126 from `  border-radius: 12px; border: 1px solid var(--border-strong);` back to `  border-radius: 12px;` (no border). Keep the dark-skin override but drop the double ring: `:root[data-skin="dark"] .kargah .doc { border: 1px solid rgba(255,255,255,.09); box-shadow: 0 2px 8px rgba(0,0,0,.45), 0 12px 28px -14px rgba(0,0,0,.6); }`. Everything else in the `.doc` block (`width:138px`, `background:var(--card)`, `padding:10px 12px`, `transition: transform 520ms var(--spring), box-shadow 340ms var(--ease)`, the `:nth-child` rest transforms `translateY(52px) rotate(3.5deg)` / `translateY(56px) rotate(-4deg)` and the hover transforms `translate(-32px,-2px) rotate(7deg) scale(1.03)` / `translate(30px,4px) rotate(-8deg) scale(1.03)` with `box-shadow: var(--sh-lift)`) is already identical to main — leave it untouched.

**Risk:** Low. On the dark skin re-check that the slips still have a visible edge against the near-black `--card` (they will: the `.09` white rim + black casts). Light skin returns exactly to main.

### [REGRESSION] CLARIFICATION: .face{overflow:hidden} and the .kcard primitive on .kblock are NOT what clips the slips — do not chase them

**Root cause:** Task 3.5 added `overflow:hidden` to `.kargah .face` (globals.css line 2154) and the `.kcard` primitive (commit 5a4c1c9) added `overflow:hidden; isolation:isolate; position:relative` plus `::before` (hover rail) and `::after` (top bar) at `z-index:2` to `.kargah .card, .kargah .kblock` (globals.css 2607-2657). The orders grid renders inside `<div className="kblock">` (app/sales/orders/page.tsx line 104, markup unchanged from main). It is tempting to blame these for clipping — but the `.doc`/`.docs` slips are SIBLINGS of `.face` inside `button.pocket`, not descendants of `.face`, so `overflow:hidden` on `.face` cannot clip them. `.kblock` ALREADY had `overflow:hidden` on main (globals.css line 1846 / main line 1846) so that is not a regression; and `isolation:isolate` on an ancestor does not reorder `.docs`(z0) vs `.face`(z1) inside `.pocket`. The slips also only ever translate DOWN at rest and by tiny y offsets on hover (never negative), so no ancestor top-clip applies. Net: these changes add visual noise (a hover rail + accent bar on the orders panel shell, hard face corners) but do not remove the effect.

- `app/globals.css` @ 2154 (.kargah .face { ... overflow:hidden ... }) — revert for fidelity only; not the bug
- `app/globals.css` @ 2607-2657 (.kcard/.card/.kblock primitive: overflow, isolation, ::before rail, ::after bar) — decorates the orders .kblock shell; optional opt-out
- `app/sales/orders/page.tsx` @ 104 return <div className="kblock">, 133 <OrdersPockets> — wrapper nesting: kblock > bhead + pockets > pocket > docs + face

**Fix:**
For fidelity, delete `overflow: hidden;` from `.kargah .face` (line 2154) so it reads `position: relative; z-index: 1; border-radius: var(--r-xl); padding: 20px 20px 18px;` as on main. Optionally quiet the primitive on the pockets panel so a slip can overhang the block edge horizontally and the shell stops competing with the cards: `.kargah .kblock:has(.pockets){isolation:auto} .kargah .kblock:has(.pockets)::before,.kargah .kblock:has(.pockets)::after{content:none}` (leave its `overflow:hidden` — pre-existing and harmless vertically; only change to `overflow:visible` here if QA shows edge-column slips being shaved on hover-fan). Do NOT spend time trying to make `overflow:hidden` on `.face` the culprit.

**Risk:** `:has()` is fine in this app's browser targets (2026). If the primitive opt-out is applied, confirm the orders panel still has a border/shadow (it does — from the base `.kblock` rule at line 1845).

### [NEW] RESTORE FULL FIDELITY then GENERALISE: reusable .pocketed treatment + <Pocketed> component + 5 placements

**Root cause:** User wants the effect back AND used more widely. Today the metaphor is bespoke to PocketCard (`.pocket/.docs/.doc/.face`) and can't be reused. The global-scope `.pocket/.pocket__papers/.pocket__paper/.pocket__card` system (globals.css ~345-411, unchanged from main) is dead code — components/sales/OrderPocketCard.tsx defines it but nothing imports it on main or branch — so there are two half-systems and neither is a primitive. Generalise into one class family + a thin wrapper, driven by data-* hooks, with the fan optional for dense lists.

- `app/globals.css` @ new block in .kargah scope, next to the existing '4 · document-pocket cards' section ~2115 — add the .pocketed treatment
- `components/kargah/Pocketed.tsx` @ new file — wrapper component
- `components/board/Board.tsx` @ 212 and 365 (className="task"), components/board/BoardMobile.tsx:55 — wrap kanban task cards on /sales/board and /sales/tasks
- `components/sales/ChequesBoard.tsx` @ cheque card render (~ChequesBoard list item) — cheque = one slip; tone from CHEQUE_STATUS
- `components/sales/BatchesPanel.tsx` @ batches list render ~165 — batch = 2 slips (supplier ref + QC/trace); tone from batch status
- `components/pocket/Pocket.tsx` @ 45 summary card — the پاکت screen — wrap the summary card, papers = open-order count clamped 0..3

**Fix:**
STEP 1 — restore PocketCard to main fidelity: apply the fixes in the first three findings (remove `.face::after`, revert `.face` overflow, scope `.doc` border to dark skin, drop component `data-tone`). That alone gives the user the effect back on /sales/orders.

STEP 2 — add the generalised treatment. New CSS in app/globals.css (.kargah scope):

/* Document-pocket, generalised. Any card sits in a pocket: 1-3 slips peek over its top edge, fan on hover. Slips are SIBLINGS of the face and the face is NEVER overflow:hidden — z-index does the layering, exactly like the original. */
.kargah .pocketed{position:relative;z-index:0}
.kargah .pocketed[data-papers="0"]{padding-top:0}
.kargah .pocketed[data-papers="1"],.kargah .pocketed[data-papers="2"],.kargah .pocketed[data-papers="3"]{padding-top:40px}
.kargah .pocketed:hover,.kargah .pocketed:focus-within{z-index:5}
.kargah .pocketed__slips{position:absolute;inset-block-start:0;inset-inline:16px;height:38px;z-index:0;pointer-events:none}
.kargah .pocketed:hover .pocketed__slips,.kargah .pocketed:focus-within .pocketed__slips{z-index:3}
.kargah .pocketed__slip{position:absolute;inset-block-start:0;inset-inline-end:calc(var(--si,0)*32px);width:min(64%,150px);height:44px;background:var(--card);border-radius:10px 10px 4px 4px;box-shadow:0 2px 6px rgba(62,44,28,.10),0 10px 24px -12px rgba(62,44,28,.30);transform:translateY(calc(18px + var(--si,0)*4px)) rotate(calc((var(--si,0) - .5)*6deg));transform-origin:bottom center;transition:transform 520ms var(--spring),box-shadow 340ms var(--ease)}
.kargah .pocketed__slip:nth-child(1){--si:0}
.kargah .pocketed__slip:nth-child(2){--si:1}
.kargah .pocketed__slip:nth-child(3){--si:2}
.kargah .pocketed[data-fan]:hover .pocketed__slip,.kargah .pocketed[data-fan]:focus-within .pocketed__slip{box-shadow:var(--sh-lift)}
.kargah .pocketed[data-fan]:hover .pocketed__slip:nth-child(1),.kargah .pocketed[data-fan]:focus-within .pocketed__slip:nth-child(1){transform:translate(-30px,-2px) rotate(7deg) scale(1.03)}
.kargah .pocketed[data-fan]:hover .pocketed__slip:nth-child(2),.kargah .pocketed[data-fan]:focus-within .pocketed__slip:nth-child(2){transform:translate(28px,4px) rotate(-8deg) scale(1.03)}
.kargah .pocketed[data-fan]:hover .pocketed__slip:nth-child(3),.kargah .pocketed[data-fan]:focus-within .pocketed__slip:nth-child(3){transform:translate(50px,10px) rotate(-13deg) scale(1.02)}
.kargah .pocketed[data-tone="good"] .pocketed__slip{border-top:2px solid var(--good)}
.kargah .pocketed[data-tone="warn"] .pocketed__slip{border-top:2px solid var(--warn)}
.kargah .pocketed[data-tone="crit"] .pocketed__slip{border-top:2px solid var(--crit)}
.kargah .pocketed[data-tone="info"] .pocketed__slip{border-top:2px solid var(--info)}
.kargah .pocketed__face{position:relative;z-index:1;border-radius:var(--r-xl);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1);transition:transform 300ms var(--ease),box-shadow 300ms var(--ease)}
.kargah .pocketed:hover .pocketed__face{transform:translateY(-2px);box-shadow:var(--sh-lift)}
:root[data-skin="dark"] .kargah .pocketed__slip{border:1px solid rgba(255,255,255,.09);box-shadow:0 2px 8px rgba(0,0,0,.45),0 12px 28px -14px rgba(0,0,0,.6)}
:root[data-skin="dark"] .kargah .pocketed[data-tone] .pocketed__slip{border-top-width:2px}
@media (prefers-reduced-motion:reduce){.kargah .pocketed__slip,.kargah .pocketed__face{transition:none}.kargah .pocketed[data-fan]:hover .pocketed__slip,.kargah .pocketed[data-fan]:focus-within .pocketed__slip{transform:translateY(16px) rotate(0)}}

STEP 3 — component API, new file components/kargah/Pocketed.tsx:

"use client";
import type { HTMLAttributes, ReactNode } from "react";
export default function Pocketed({
  papers = 2, tone, fan = true, slips, children, className = "", ...rest
}: {
  /** how many slips peek out; drive from real attachment count, clamp 0..3 */
  papers?: 0 | 1 | 2 | 3;
  /** status colour on the slip top-edge */
  tone?: "good" | "warn" | "crit" | "info";
  /** hover/focus fan-out; turn OFF for dense lists (12 fanning cards = noise) */
  fan?: boolean;
  /** custom slip contents (e.g. PocketCard's rich .doc markup); defaults to blank sheets */
  slips?: ReactNode;
  /** the real card face */
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  const n = Math.max(0, Math.min(3, papers)) as 0 | 1 | 2 | 3;
  return (
    <div className={`pocketed ${className}`.trim()} data-papers={n}
         data-tone={tone} data-fan={fan ? "" : undefined} {...rest}>
      {n > 0 && (
        <div className="pocketed__slips" aria-hidden="true">
          {slips ?? Array.from({ length: n }, (_, i) => <span className="pocketed__slip" key={i} />)}
        </div>
      )}
      <div className="pocketed__face">{children}</div>
    </div>
  );
}

data-* hooks (all authored on the wrapper): data-papers 0..3 (count of real docs, clamped), data-tone good|warn|crit|info (status mapper output), data-fan boolean (presence = fan enabled). `--si` is internal, set by :nth-child, never authored.

STEP 4 — placements (each: compute papers from real attachments, tone from the existing status mapper):
1. Kanban task cards — /sales/board + /sales/tasks: in components/board/Board.tsx wrap the `.task` button (lines 212, 365) and components/board/BoardMobile.tsx:55 with <Pocketed papers={order.docCount} tone={toneFor(order.status)} fan className="task-pocket">; slips = the docs the order already has (pre-invoice, delivery note). Set fan only on desktop Board, fan={false} on BoardMobile.
2. Order rows / OrdersPockets — canonical, already restored; optionally migrate PocketCard to render <Pocketed papers={docs.length} tone={STATUS_TONE[status]} slips={docs.map(d => <div className="pocketed__slip doc">...</div>)}> keeping the rich .doc inner markup, so there is ONE system.
3. Cheque cards — components/sales/ChequesBoard.tsx: <Pocketed papers={1} tone={chequeTone(c.status)} fan={false}> — a cheque literally is a sheet; cleared=good, bounced=crit, pending/deposited=warn (from CHEQUE_STATUS_LABEL/TRANSITIONS).
4. Batch cards — components/sales/BatchesPanel.tsx (~line 165 list): <Pocketed papers={b.supplier_batch_ref ? 2 : 1} tone={batchTone(b.status)} fan> — slip 1 = supplier batch ref doc, slip 2 = QC/trace sheet (the code already has a /trace fetch).
5. پاکت customer card — components/pocket/Pocket.tsx (~line 45): wrap the summary card with <Pocketed papers={Math.min(3, openOrders)} tone={debtTone}> — the screen is named 'pocket/envelope', so it should visibly be one.
Bonus: /sales/payments receipt cards and /sales/deliveries delivery cards — <Pocketed papers={1}> = the signed receipt.

**Risk:** The 40px top gutter is added above every wrapped card — in tight kanban columns that costs vertical space; mitigate by passing papers={0} when an order has no docs (renders as a plain card, no gutter, no slips). With fan enabled, edge-column cards fan ~30-50px past their column; ensure the board container is not overflow:hidden (the `.kargah .board` and `.kargah .col` rules are not — verified) or the outermost fanned slip clips. Verify: toggle light/dark skin and 2-3 accents; keyboard-tab to a card and confirm :focus-within fans; confirm reduced-motion shows a static peek with no fan; confirm the /sales/orders `.rev` entrance still clears the peek (slips translate DOWN only, top row never shaved — matches the PocketCard doc comment).

### [NEW] INVENTORY: which screens showed the effect on main vs now

**Root cause:** Fact-finding for the spec. Live usage traced by grepping imports of PocketCard/OrdersPockets/OrderPocketCard and className="pocket"/"docs"/"doc" across app + components on both refs.

- `components/kargah/OrdersPockets.tsx` @ 31 <div className="pockets"> ... 33 <PocketCard> — the ONE live mount of the effect; rendered by app/sales/orders/page.tsx:133
- `components/sales/OrderPocketCard.tsx` @ whole file — global-scope .pocket__papers variant — DEAD CODE on main AND branch (no importer either place; `git grep OrderPocketCard main` and branch both return only the definition)
- `app/globals.css` @ main 327-411 / branch 345-433 (.pocket, .pocket__papers, .pocket__paper, .pocket__card) — global-scope pocket CSS — byte-identical main vs branch (diff empty), and unused
- `app/sales/pocket/page.tsx` @ 6-24 — unrelated: renders components/pocket/Pocket.tsx (پنجرهٔ مشتری customer window), no peeking-cards effect

**Fix:**
State plainly in the restore PR: on main the peeking-cards-behind effect is visible on exactly one screen, /sales/orders (recent orders grid). On sales-redesign it is still only /sales/orders, now degraded by the fold bar + hard slip borders. After STEP 4 of the generalisation it will additionally appear on /sales/board, /sales/tasks, /sales/cheques, /sales/batches, /sales/pocket (and optionally /sales/payments, /sales/deliveries). The dead global-scope `.pocket__papers` system and components/sales/OrderPocketCard.tsx should be deleted in the same PR to avoid a third half-system — the new `.pocketed` primitive replaces both intents.

**Risk:** Deleting OrderPocketCard.tsx + the global .pocket* CSS: grep once more for `pocket__` and `OrderPocketCard` before removal (currently zero importers). No runtime risk; purely dead-code removal.


---

## /sales redesign — card entrance animation (RevealRoute) and cross-page route transition

The eased, staggered card entrance did not "get faster" — its spring-lift half was silently switched off. RevealRoute picks between a 620ms translateY `--spring` lift and a plain 300ms opacity fade by counting matched elements: `items.length <= LIFT_MAX` (6). This branch added `.kblock` and `.kcard` UNQUALIFIED to `REVEAL["/sales/dashboard"]`, so RevealRoute now also collects every `.kblock` nested inside every `.sect` (ActionCenter, KpiStrip, MarginTable) plus the merged-analysis blocks. The count jumps from ~8 to ~15, `lift` flips to false, and every card degrades to a 300ms opacity-only fade with no movement — which reads exactly as "gone / too fast / no ease." The same unqualified selectors make a `.sect` and its own inner `.kblock` animate on two independent `transition-delay` clocks (compounded opacity 0×0, the "second clock" the file's own header warns about), and any `.sect` that opens after hydration misses the effect window entirely so its cards never animate at all. Separately, `.route-fade` is not a cross-page transition: it is a permanent node in the layout, so the outgoing page is hard-cut with no animation, and the incoming "dip" is driven by a double-`requestAnimationFrame` class toggle inside a `[pathname]` effect that the browser routinely coalesces to nothing (or a one-frame blank flash). Finally the new `.kcard` primitive carries its own `transition: box-shadow, transform`, which `.rev-in` (never removed after entrance) permanently overrides, so post-entrance hovers on revealed cards snap instead of easing.

### [REGRESSION] Spring-lift entrance silently disabled on /sales/dashboard — unqualified .kblock/.kcard inflate the item count past LIFT_MAX, so every card drops to a 300ms opacity-only fade

**Root cause:** components/kargah/RevealRoute.tsx line 24 changed REVEAL["/sales/dashboard"] from [".gcard", ".dash-top > .card", ".sect"] to add ".kblock", ".kcard" with NO combinator. On the merged dashboard, document.querySelectorAll('.kblock') now returns every block nested inside every CollapsibleSection body (ActionCenter, KpiStrip, MarginTable each render `<div className="kblock">`), plus the top-level health block. Combined with ~6 .gcard, 2 .dash-top>.card and ~4 .sect, `items.length` is ~15. Line 95 `const lift = items.length <= LIFT_MAX` (LIFT_MAX=6) therefore evaluates false, so line 98 `el.classList.toggle('rev-lift', lift)` removes the lift from ALL cards. `.kargah .rev.rev-in` then applies `transition: opacity 300ms var(--ease)` with NO transform — the 620ms `transform ... var(--spring)` translateY(16px) lift in `.kargah .rev.rev-lift.rev-in` (app/globals.css:1774) never runs. A 300ms opacity fade with zero movement is what now reads as 'gone / too fast / no ease'. The `--ease` curve itself is unchanged (cubic-bezier(.16,1,.3,1)); the perceived easing came from the spring translate that is now gone.

- `components/kargah/RevealRoute.tsx` @ line 24 (REVEAL['/sales/dashboard']) and lines 77-109 (item collection, lift decision, reset/apply loops) — unqualified .kblock/.kcard selectors + global all-or-nothing lift toggle keyed on total count
- `app/globals.css` @ lines 1767-1779 (.rev / .rev-lift / .rev-in / .rev-lift.rev-in) — the lift variant carries the only spring transform; the non-lift variant is opacity-only
- `app/sales/dashboard/page.tsx` @ lines 235, 265-446 (CollapsibleSection blocks) + components/analysis/{ActionCenter,KpiStrip,MarginTable}.tsx — nested .kblock instances that the unqualified selector now sweeps in

**Fix:**
Replace components/kargah/RevealRoute.tsx wholesale with the version below. It (a) filters out any matched element nested inside another matched element (kills the double-clock, makes broad selectors safe), (b) decides the lift PER CARD by index instead of one global boolean so the first cards always keep the spring even on dense pages, (c) raises LIFT_MAX to 8, (d) adds a 60ms BASE offset so the cascade starts after the route fade begins, (e) hands each card back to its own stylesheet on transitionend (fixes finding 4), (f) drops the broken .route-fade toggling (moved to finding 3's RouteFade).

---- components/kargah/RevealRoute.tsx ----
"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** What counts as "a card" differs per screen, so they are NAMED, not guessed at with
 *  one broad selector. A JS nesting guard below drops any matched element that sits
 *  inside another matched element, so a selector that is a little too broad (a bare
 *  `.kblock` that also catches blocks nested in a `.sect`) can no longer put a parent
 *  and its own child on two different delays.
 *
 *  Longest-prefix match, so /sales/orders/12 uses the orders list.
 */
const REVEAL: Record<string, string[]> = {
  "/sales": [".gcard", ".kblock", ".cradlewrap"],
  "/sales/orders": [".bhead", ".pocket"],
  "/sales/orders/new": [".card", ".kblock"],
  "/sales/board": [".hint", ".col"],
  "/sales/journey": [".bhead", ".lane2"],
  "/sales/schedule": [".notice", ".sched > .kblock"],
  "/sales/dashboard": [".gcard", ".dash-top > .card", ".sect", ".kblock"],
  "/sales/products": [".card", ".kblock"],
  "/sales/commission": [".card", ".kblock"],
  "/sales/stock": [".gcard", ".stalert", ".stcard", ".card"],
  "/sales/runs": [".card", ".kblock", ".run-column"],
  "/sales/admin/users": [".card", ".kblock"],
  "/sales/admin/groups": [".card", ".kblock"],
};

/** Milliseconds between one card and the next. */
const STAGGER = 38;
/** Delay before the first card, so the whole-view route fade (.route-fade,
 *  kargah-route-in) is already moving when the per-card cascade starts. */
const BASE = 60;
/** Cards at or past this index fade instead of spring-lifting. A springy overshoot on
 *  the first few cards is liveliness; on a dozen at once it is the page wobbling, so
 *  the lift rides the leading cards (the ones the reader actually watches) and the
 *  tail just fades. Decided per card, not as one all-or-nothing switch for the page. */
const LIFT_MAX = 8;
/** Past this many the stagger reads as lag rather than rhythm, so the delay stops
 *  growing rather than the cards stopping. */
const CAP = 8;

function selectorsFor(pathname: string): string[] {
  const key = Object.keys(REVEAL)
    .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  return REVEAL[key ?? "/sales"] ?? [];
}

/** The entrance, for every sales screen, from one place. */
export default function RevealRoute() {
  const pathname = usePathname();

  useEffect(() => {
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    const selectors = selectorsFor(pathname);
    if (!selectors.length) return;

    const matched: HTMLElement[] = [];
    for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        if (!matched.includes(el)) matched.push(el);
      }
    }
    // Keep only the outermost of any matched ancestor/descendant pair. A parent and a
    // card nested inside it must never both animate: they run on two different delays,
    // the block fading in while its own contents are still fading in, and the opacities
    // multiply (0.4 x 0.4) so the inner card barely appears.
    const items = matched.filter(
      (el) => !matched.some((other) => other !== el && other.contains(el)),
    );
    if (!items.length) return;

    /* The reset must not itself be delayed: a zero-duration transition that still
       carries a DELAY holds the old value for the length of that delay, which would
       postpone the reset past the moment the entrance is switched back on. */
    for (let i = 0; i < items.length; i++) {
      const el = items[i];
      el.classList.add("rev");
      el.classList.toggle("rev-lift", !reduced && i < LIFT_MAX);
      el.classList.remove("rev-in");
      el.style.transition = "none";
      el.style.transitionDelay = "";
    }
    void document.body.offsetHeight;

    const detach: Array<() => void> = [];
    items.forEach((el, i) => {
      el.style.transition = "";
      el.style.transitionDelay = reduced
        ? "0ms"
        : `${BASE + Math.min(i, CAP) * STAGGER}ms`;
      el.classList.add("rev-in");
      if (reduced) return;
      // When the entrance finishes, hand the element back to its own stylesheet.
      // Left on, `.rev-in`'s opacity/transform-only transition permanently overrides
      // the `.kcard` primitive's `transition: box-shadow, transform`, so every later
      // hover on a revealed card snaps (or inherits the 620ms spring) instead of easing.
      const done = (e: TransitionEvent) => {
        if (e.target !== el || e.propertyName !== "opacity") return;
        el.classList.remove("rev", "rev-lift", "rev-in");
        el.style.transition = "";
        el.style.transitionDelay = "";
        el.removeEventListener("transitionend", done);
      };
      el.addEventListener("transitionend", done);
      detach.push(() => el.removeEventListener("transitionend", done));
    });

    return () => {
      for (const off of detach) off();
      for (const el of items) {
        el.classList.remove("rev", "rev-lift", "rev-in");
        el.style.transition = "";
        el.style.transitionDelay = "";
      }
    };
  }, [pathname]);

  return null;
}

---- app/globals.css: replace the .rev.rev-lift.rev-in rule (currently line 1774-1776) so the tail-fade cards still ease and the leading cards keep the spring ----
.kargah .rev.rev-in {
  opacity: 1;
  transform: none;
  transition: opacity 340ms var(--ease);
}
.kargah .rev.rev-lift.rev-in {
  transition: opacity 460ms var(--ease), transform 620ms var(--spring);
}
(only change here is 300ms -> 340ms on the plain fade so the non-lift tail does not out-run the lifted head; leave the .rev and .rev-lift base rules and the reduced-motion block exactly as they are.)

**Risk:** Nesting filter runs O(n^2) over matched nodes — n is tens at most per route, negligible. Per-index lift means a dense page shows a spring on the first 8 cards and a plain fade on the rest; verify on /sales/dashboard and /sales/orders (12+ pockets) that the boundary is not jarring — if it is, lower LIFT_MAX to 6. `transitionend` cleanup: guarded to propertyName==='opacity' and e.target===el so pseudo-element (`.kcard::before`) hover transitions cannot trigger it; the useEffect return handles the case where the event never fires (interrupted nav). Verify with DevTools 'Emulate prefers-reduced-motion' that cards are visible with no transition. To confirm: navigate Dashboard -> Orders -> Dashboard and watch the cascade; each card should translateY(16px)->0 on the spring, 38ms apart.

### [REGRESSION] Parent .sect and its nested .kblock animate on two independent stagger clocks; sections opened after hydration miss the entrance entirely

**Root cause:** Same line 24 change. Before the nesting filter, `items` contains both a CollapsibleSection's `<section class="sect">` AND the `<div class="kblock">` rendered inside its body by ActionCenter/KpiStrip/MarginTable. Both get `.rev` (opacity:0) and separate `el.style.transitionDelay` values in the loop at RevealRoute.tsx:105-109, so the outer section fades over 300ms at delay N*38ms while the inner block independently fades at delay M*38ms — visible opacity multiplication and a block that is still resolving after its container looks settled. Worse: CollapsibleSection (components/CollapsibleSection.tsx:56, `{expanded && <div className="sect__body">}`) renders its body conditionally from a state value hydrated from localStorage; a section that starts collapsed and expands after mount inserts its `.kblock` children into the DOM AFTER RevealRoute's `[pathname]` effect has already run, so those cards get no `.rev`/`.rev-in` at all and simply appear — the 'entrance is gone' symptom for part of the page.

- `components/kargah/RevealRoute.tsx` @ lines 77-84 (flat collection, no ancestor/descendant dedupe) and 105-109 (per-element independent delay) — no guard against a matched element being a descendant of another matched element
- `components/CollapsibleSection.tsx` @ line 91 (`<section className="sect">`), line 111 (`{expanded && <div className="sect__body">`) — section body enters the DOM after RevealRoute's effect for sections that open post-hydration

**Fix:**
The nesting filter in finding 1's RevealRoute rewrite (`items = matched.filter(el => !matched.some(other => other !== el && other.contains(el)))`) fully resolves the double-clock: a `.kblock` inside a matched `.sect` is dropped, and the whole section fades in as ONE gesture with its body content riding along. Keeping `.kblock` in `REVEAL['/sales/dashboard']` is then safe and intentional — it still catches the one top-level health block at app/sales/dashboard/page.tsx:235 that is not inside a `.sect`, giving it an entrance it would otherwise lack. For the post-hydration case, no code change is needed once sections animate as a unit: an expanding section's body simply appears with its parent's already-completed reveal, which is the correct behaviour (the fold open is its own interaction). If a per-row entrance inside a late-opening section is wanted, that is what components/kargah/Stagger.tsx / `.stag` already exists for — wire `<Stagger>` inside the section body, do not widen RevealRoute's selectors.

**Risk:** Confirm the health block at dashboard/page.tsx:235 still animates (it is a direct child of a plain `<section className="flex flex-col">`, not a `.sect`, so it survives the nesting filter as a top-level item). Confirm no route's REVEAL list depends on a child AND its parent both animating — grep shows none do; `/sales/schedule` already uses the `.sched > .kblock` combinator for exactly this reason and is unaffected.

### [NEW] .route-fade is not a cross-page transition — outgoing page is hard-cut, incoming 'dip' is a non-deterministic double-rAF toggle that the browser coalesces to nothing

**Root cause:** app/sales/layout.tsx:66 wraps `{children}` in a permanent `<div className="route-fade">`. On App Router client navigation Next swaps the children synchronously; the wrapper node itself never unmounts, so there is NOTHING animating the old page out — it is replaced instantly. The incoming animation is RevealRoute.tsx:64-72: inside a `useEffect(..., [pathname])` (which fires AFTER the new content is committed and — in React 19 — after paint) it does `fade.classList.add('route-out')` then `requestAnimationFrame(() => requestAnimationFrame(() => fade.classList.remove('route-out')))`. There is no forced style flush between the add and the rAF chain, so the engine frequently collapses add+remove into a single recalc and paints no transition at all; when the later `void document.body.offsetHeight` on line 103 does happen to flush it, you get one blank frame at opacity:0 then a 220ms fade-in — a flash, not a transition. `.route-fade` also does not survive React reconciliation as an animation trigger because it is the same DOM node every navigation.

- `app/sales/layout.tsx` @ line 66 (`<div className="route-fade">{children}</div>`), line 11-15 imports — wrapper is a stable node; no key, no remount, so no CSS entrance replays and there is no outgoing animation
- `components/kargah/RevealRoute.tsx` @ lines 64-72 (route-fade class toggle via double rAF inside the [pathname] effect) — non-deterministic; runs post-paint; cannot animate the outgoing view because pathname already changed and new children are already committed
- `app/globals.css` @ lines 1791-1798 (.route-fade / .route-fade.route-out / reduced-motion) — transition + toggled class model that depends on the fragile JS above

**Fix:**
Drive the transition off a key={pathname} REMOUNT of the wrapper with a pure CSS keyframe — deterministic, replays on every navigation, no rAF, and the keyframe's `from{opacity:0}` under `both` fill also masks the one-frame flash of un-revealed cards before RevealRoute's effect runs. Layout is a server component so the wrapper needs a tiny client shim.

---- NEW FILE components/kargah/RouteFade.tsx ----
"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/** Remounts its subtree on every sales path change so the CSS entrance in
 *  app/globals.css (`.route-fade` -> @keyframes kargah-route-in) replays. Pure CSS:
 *  deterministic, fires on every navigation, no requestAnimationFrame. The per-card
 *  spring cascade (RevealRoute) layers on top of this whole-view fade. */
export default function RouteFade({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="route-fade" key={pathname}>
      {children}
    </div>
  );
}

---- app/sales/layout.tsx ----
Add with the other component imports (after line 13):
  import RouteFade from "@/components/kargah/RouteFade";
Replace lines 63-66:
        {/* One entrance for every sales screen — see RevealRoute. The whole-view
            fade on navigation is RouteFade (key={pathname} remount + CSS keyframe). */}
        <RevealRoute />
        <RouteFade>{children}</RouteFade>

---- app/globals.css: replace the whole .route-fade block (lines 1791-1798) ----
/* Route transition: the whole sales view fades + rises on every path change, driven
   by a key={pathname} remount of the .route-fade wrapper (components/kargah/RouteFade.tsx)
   so it is a pure CSS keyframe — deterministic, replays on every navigation, no rAF.
   `both` holds the from-state on the first frame, which also masks the flash of cards
   that RevealRoute has not yet set to opacity:0. The per-card spring cascade layers over. */
@keyframes kargah-route-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}
.kargah .route-fade {
  animation: kargah-route-in 240ms var(--ease) both;
  will-change: opacity, transform;
}
@media (prefers-reduced-motion: reduce) {
  .kargah .route-fade { animation: none; }
}

Note: this gives a genuine fade of the NEW view on every navigation and removes the flash. It does not animate the OUTGOING view (React unmounts it immediately). If a true out+in cross-fade is wanted, that requires the View Transitions API — Next 16.3 exposes it via `experimental.viewTransition` in next.config.ts plus React's <ViewTransition>; treat that as a follow-up, not part of this fix.

**Risk:** key={pathname} remounts the entire page subtree on every navigation, including when only a dynamic param changes (/sales/orders/1 -> /sales/orders/2) — this discards in-page React state and resets scroll for that transition. CollapsibleSection open/closed state is persisted to localStorage so it survives; audit any other /sales page holding important unpersisted client state across a param change. `will-change` on a large subtree is a compositor hint — fine for a 240ms one-shot, but drop it if you see memory pressure on low-end devices. Verify: every Tab-bar navigation now shows the fade+rise; reduced-motion shows an instant swap with no flash (cards are opacity:1 via the existing @media block in the .rev rules).

### [REGRESSION] .rev-in permanently overrides the .kcard primitive's own transition, so hover on any revealed card snaps instead of easing

**Root cause:** The new card primitive (app/globals.css:2607-2618) sets `transition: box-shadow 260ms var(--ease), transform 260ms var(--ease)` on `.kcard, .card, .kblock`, and `.kcard:hover` (line 2651-2653) does `box-shadow: var(--sh-2); transform: translateY(-2px)`. RevealRoute adds `.rev-in` and never removes it, so `.kargah .rev.rev-in` (specificity 0,3,0, beats `.kargah .kcard` at 0,2,0) keeps `transition: opacity 300ms var(--ease)` — no box-shadow, no transform — applied for the life of the page. Result on a lifted card: `.kargah .rev.rev-lift.rev-in` supplies `transform 620ms var(--spring)`, so a hover translateY that should take 260ms wobbles for 620ms. On a non-lifted card: transform/box-shadow have no transition entry at all, so hover snaps instantly. Either way the pre-existing hover ease is gone on every card RevealRoute touched.

- `app/globals.css` @ lines 2607-2618 (.kcard/.card/.kblock transition) vs lines 1769-1776 (.rev.rev-in / .rev-lift.rev-in transition) — two rules set `transition` on the same element; the .rev-in one wins on specificity and omits box-shadow/transform
- `components/kargah/RevealRoute.tsx` @ lines 105-109 (adds .rev-in, never removes it) — entrance classes are left on the element forever after the animation completes

**Fix:**
Primary fix is the transitionend cleanup already included in finding 1's RevealRoute rewrite — on the entrance's `opacity` transitionend it removes `rev`, `rev-lift`, `rev-in` and clears the inline `transition`/`transitionDelay`, returning the element to the `.kcard` stylesheet rule so hover eases at 260ms again. Belt-and-braces CSS in case a transitionend is ever missed (interrupted navigation): give `.rev-in` a box-shadow passthrough so a still-classed card is not frozen — in app/globals.css change the two rules to:
.kargah .rev.rev-in {
  opacity: 1;
  transform: none;
  transition: opacity 340ms var(--ease), box-shadow 260ms var(--ease);
}
.kargah .rev.rev-lift.rev-in {
  transition: opacity 460ms var(--ease), transform 620ms var(--spring), box-shadow 260ms var(--ease);
}
This is not enough on its own (hover transform on a still-lifted card would still ride 620ms) — the JS cleanup is what makes hover fully correct — but it keeps box-shadow feedback alive in the degenerate case.

**Risk:** The JS class removal on transitionend must run after BOTH the opacity and transform transitions have visually settled; keying it to `propertyName === 'opacity'` is safe because opacity (340/460ms) finishes before or with the observation window and the transform spring (620ms) is visually done by the time opacity ends given equal delay. If you see a card flicker at cleanup, gate on `transform` instead for lifted cards. Verify by hovering a dashboard card ~1s after the entrance: box-shadow + 2px lift should ease over ~260ms, not snap and not wobble.


---

## /sales (کارگاه) — .kcard top bar (globals.css, .kargah scope)

The sales-redesign branch introduced a card top bar (.kargah .kcard::after and 6 aliased selectors, globals.css ~2623-2638) as a dead-flat 3px linear-gradient strip: hard square corners where it meets the card's rounded overflow:hidden clip, and no glow. Image 3 shows a lit ("neon") accent bar whose left/right ends fade smoothly to transparent and which casts a soft bloom. main never had any card top bar at all (only .prow's leading-edge hover rail and .ptile's radial hover wash), so this is a new feature that does not match its own reference image, not a restore. The fix: mask the ends to transparent with a fade zone wider than the largest card corner radius, and add the glow as filter: drop-shadow() (not box-shadow, which the card's overflow:hidden clips) so the halo follows the faded ends and blooms downward onto the card surface. Glow is dark-skin only; on the cream light ground a blur reads as a smudge (MASTER.md "glow, not shadow"), so light keeps only a 1px hairline. One --bar variable drives both the gradient default and every data-tone status colour so the halo always matches the strip.

### [NEW] Image-3 top bar is a flat, hard-cornered, glow-less strip — needs end-fade mask + dark-skin neon bloom

**Root cause:** main has NO card top bar in the .kargah scope: .kargah .card (globals.css main ~2505) and .kargah .kblock (~1845) are plain 1px border + --sh-1; the only edge-marks are .kargah .prow::before (~2601, a 3px leading-edge hover rail) and .kargah .ptile::before (~2640, a radial --accent-soft hover wash). The 'neon' box-shadow: 0 0 Npx -1px var(--accent) vocabulary image 3 quotes exists only on map markers (globals.css ~783/832/1055/1086/1345). sales-redesign added .kargah .kcard::after / .card::after / .kblock::after / .prow::after / .ptile::after / .gcard::after / .face::after (globals.css 2623-2634) as content:''; position:absolute; inset-block-start:0; inset-inline:0; height:3px; background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--tint-plum)); z-index:2 — no mask, no filter/box-shadow. The [data-tone] rules (2635-2638) only swap background to a solid var(--good|--warn|--crit|--info), still flat. The design spec §7.2 (docs/superpowers/specs/2026-09-02-sales-redesign-design.md lines 176-190) under-specified the bar as '3px strip pinned to inset-block-start:0', so the code matched the spec, not image 3. Because .kcard/.card/.kblock/.prow/.ptile/.gcard/.face all set overflow:hidden + border-radius (--r-xl 20px, --r-2xl 26px, --r-lg 16px), the strip's ends are clipped square by the corner arc (the 'hard squared corner' complaint) and any outward box-shadow glow would be clipped at the border-box and never show.

- `/root/pourya/coverage-map/app/globals.css` @ 2623-2638 (.kargah .kcard::after, .card::after, .kblock::after, .prow::after, .ptile::after, .gcard::after, .face::after and the four .kargah [data-tone=...]::after rules) — The flat strip + solid-tone swap to replace with the masked/lit version below.
- `/root/pourya/coverage-map/app/globals.css` @ 2607-2621 (.kargah .kcard/.card/.kblock primitive) plus .gcard ~1961, .prow ~2760, .ptile ~2800, .face ~2154 — All seven selectors carry overflow:hidden + border-radius; this clip dictates the technique — mask fade wider than the radius, and drop-shadow (not box-shadow) so the bloom is not clipped away and spreads downward onto the surface.
- `/root/pourya/coverage-map/docs/superpowers/specs/2026-09-02-sales-redesign-design.md` @ 176-190 (§7.2 Colorful top bar (image 3)) — Spec text says only '3px strip pinned to inset-block-start:0'; update it to require the transparent-end mask, the fade-zone-vs-corner-radius rule, and the dark-skin-only drop-shadow bloom with a light-skin hairline fallback.

**Fix:**
Replace globals.css 2623-2638 with:

/* image-3 top bar : a lit accent strip whose ends melt into the card edge.
   --bar is the strip's glow colour, so ONE rule covers the gradient default
   AND every data-tone, and the halo always matches the strip. */
.kargah .kcard::after,
.kargah .card::after,
.kargah .kblock::after,
.kargah .prow::after,
.kargah .ptile::after,
.kargah .gcard::after,
.kargah .face::after {
  content: "";
  position: absolute;
  inset-block-start: 0;
  inset-inline: 0;
  height: 3px;
  z-index: 2;
  pointer-events: none;
  --bar: var(--accent-2);                       /* mid gradient stop = single glow hue */
  background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--tint-plum));
  /* ends fade to transparent; fade zone is wider than the largest card corner
     radius (--r-2xl 26px), so the strip never collides with the rounded corner */
  --bar-fade: clamp(20px, 12%, 44px);
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 var(--bar-fade), #000 calc(100% - var(--bar-fade)), transparent 100%);
          mask-image: linear-gradient(90deg, transparent 0, #000 var(--bar-fade), #000 calc(100% - var(--bar-fade)), transparent 100%);
  /* light skin default: NO blur (it smears on the cream ground). A 1px hairline
     of the same hue is the only lift that survives on paper-white. */
  filter: drop-shadow(0 1px 0 color-mix(in srgb, var(--bar) 26%, transparent));
}

/* status mode : strip AND glow both follow --bar */
.kargah [data-tone="good"]::after { background: var(--good); --bar: var(--good); }
.kargah [data-tone="warn"]::after { background: var(--warn); --bar: var(--warn); }
.kargah [data-tone="crit"]::after { background: var(--crit); --bar: var(--crit); }
.kargah [data-tone="info"]::after { background: var(--info); --bar: var(--info); }

/* dark skin : the neon bloom. drop-shadow (NOT box-shadow) so the halo inherits
   the end-fade mask; the card's overflow:hidden keeps it spreading downward onto
   the surface, which is the image-3 read exactly. */
:root[data-skin="dark"] .kargah .kcard::after,
:root[data-skin="dark"] .kargah .card::after,
:root[data-skin="dark"] .kargah .kblock::after,
:root[data-skin="dark"] .kargah .prow::after,
:root[data-skin="dark"] .kargah .ptile::after,
:root[data-skin="dark"] .kargah .gcard::after,
:root[data-skin="dark"] .kargah .face::after {
  filter:
    drop-shadow(0 0 5px  color-mix(in srgb, var(--bar) 70%, transparent))
    drop-shadow(0 2px 12px color-mix(in srgb, var(--bar) 32%, transparent));
}

Notes:
- data-skin is always written positively ('dark' or 'light') by lib/theme.ts (init script + applyTheme), but keeping the light treatment on the BASE rule and overriding only for dark matches house style (:root[data-skin="dark"] .kargah ...) and is safe if the attribute is ever missing.
- Leave .kcard::before (the inline-start hover rail, 2641-2656) untouched — it is identity-correct and separate from the bar.
- --bar default: var(--accent-2) is the middle gradient stop; var(--accent) also works if a warmer halo is wanted.
- border-radius interaction: because --bar-fade (min 20px) always exceeds the corner radius in play (16/20/26px), the strip is fully transparent before the corner arc begins, so it reads as a floating lit line inset from the corners — matching image 3 — regardless of which card radius token applies.
- reduced motion: the bar is static, no @media (prefers-reduced-motion) entry needed.

**Risk:** 1) The downward bloom renders above card content (::after z-index:2); keep the blur/alpha as specified (<=0.7 near, <=0.32 far, 5px/12px blur) so it does not wash a card header sitting flush to the top. 2) .gcard (peach/mint/sand mesh) and .face (frosted, over rotated .doc papers) inherit the same ::after list from the branch; an orange bloom over a mint mesh in dark can muddy it — if that reads badly, drop .gcard::after / .face::after from the dark-skin bloom selector and let them keep only the masked strip. 3) mask-image + filter on one pseudo-element is fine on all evergreen targets (Next 16 / React 19); -webkit-mask-image prefix included for older WebKit, consistent with the -webkit-backdrop-filter already in .face. 4) Verify at 127.0.0.1:3003 on /sales/dashboard (gradient default), /sales/pocket (.face + dark skin), and an orders/tasks view (data-tone status bars) in both skins; confirm the strip ends are invisible at the corners on the narrowest .ptile and the widest .kblock, and that the light skin shows a crisp line with no halo.


---

## Sales nav (components/kargah/TabPill.tsx + .kargah .seg* CSS + app/sales/layout.tsx): group-row travelling pill, centered rows, scroll-away chrome

The branch (commit b5593f9) split the old single pill nav into two rows: a new .seg-groups row of six group links whose active state is a flat --accent-soft background with no motion, sitting above the original .seg tab row that still has the travelling .thumb pill. TabPill.move() only measures the .seg row, so the "main menu" (group row) never got a pill. Separately, both rows are start-aligned (justify-content defaults to flex-start) and nothing watches scroll direction, so the user's two asks — give the group row the same pill, center both rows, and auto-hide the whole brand bar + nav on scroll-down — are all unimplemented. None are strict regressions (the group row and centering never existed on main), but the travelling-pill animation itself is pre-existing and just needs to be extended to the second row. Fixes below: a shared slideThumb() helper driving both rows off one effect, a .segwrap flex-column with align-items:center plus max-width:100% on .seg so rows center yet still scroll on overflow, and a new client <Chrome> wrapper that toggles a transform class on a position:sticky container.

### [NEW] Group row (.seg-groups) has no travelling pill — extend the .seg .thumb mechanism to it

**Root cause:** On main, TabPill rendered one <nav class="seg"> with a travelling .thumb. Commit b5593f9 added a second row <nav class="seg-groups"> above it whose only active affordance is `.kargah .seg-groups > a[aria-current="true"] { background: var(--accent-soft); color: var(--accent-text); }` (globals.css ~1888) — a flat swap, no thumb, no spring. TabPill.move() (TabPill.tsx:51-59) queries a single `seg` ref for `[aria-current="page"]` + `.thumb`; the group row is never measured and has no .thumb element. The group buttons also use aria-current="true" (string), not "page", so even the existing .seg selectors would not target them.

- `/root/pourya/coverage-map/components/kargah/TabPill.tsx` @ whole file (1-111) — Add a second ref `grp`, a shared `slideThumb(root, currentSelector)` helper, render <nav class="seg seg-groups"> with its own <span class="thumb">, drive both rows from the one effect, add .ready to both.
- `/root/pourya/coverage-map/app/globals.css` @ .kargah .seg-groups block, lines 1878-1891 — Replace the standalone group-row styling with a thin override on top of the .seg primitive (the element now carries both classes).
- `/root/pourya/coverage-map/app/globals.css` @ .kargah .seg, lines 1893-1897 — No change needed for the pill itself — .seg.ready .thumb transition already applies once the element has class "seg"; see finding 2 for the max-width/min-width add.

**Fix:**
REPLACE components/kargah/TabPill.tsx entirely with:

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  activeSalesGroup,
  type SalesGroupId,
  type SalesTab,
} from "@/lib/salesNav";

export type Tab = SalesTab;

/** Slides the `.thumb` inside `root` to sit under the element `root` matches with
 *  `current`. One measure-then-move for BOTH nav rows; offsetLeft/offsetWidth are read
 *  from the row's own box, so it stays correct wherever the (now centred) row sits and
 *  in both writing directions. Call it once BEFORE the row gets `.ready`, so the first
 *  placement is not animated up from width:0 — see `.kargah .seg.ready .thumb`. */
function slideThumb(root: HTMLElement | null, current: string) {
  if (!root) return;
  const on = root.querySelector<HTMLElement>(current);
  const thumb = root.querySelector<HTMLElement>(".thumb");
  if (!on || !thumb) return;
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
}

/** Two rows: the six groups, then the tabs of whichever group is active — and now BOTH
 *  rows carry a pill that travels between their items on the same spring. The movement
 *  is what tells you which way you went; the group row keeps twenty-six destinations
 *  from being one scroll.
 */
export default function TabPill({
  tabs,
  groups,
}: {
  tabs: SalesTab[];
  groups: { id: SalesGroupId; label: string }[];
}) {
  const seg = useRef<HTMLElement | null>(null);
  const grp = useRef<HTMLElement | null>(null);
  const pathname = usePathname();

  const activeGroup = activeSalesGroup(pathname, tabs);

  const shownGroups = useMemo(
    () =>
      groups
        .map((g) => ({ ...g, first: tabs.find((t) => t.group === g.id && t.ready)?.href }))
        .filter((g): g is typeof g & { first: string } => Boolean(g.first)),
    [groups, tabs],
  );

  const visibleTabs = useMemo(
    () => tabs.filter((t) => t.group === activeGroup),
    [tabs, activeGroup],
  );

  /* Longest match, not equality: /sales/orders/new must light سفارش‌ها, and /sales is a
     prefix of everything so it only wins when nothing longer does. */
  const active = visibleTabs
    .filter((t) => t.ready && (pathname === t.href || pathname.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const move = useCallback(() => {
    slideThumb(grp.current, '[aria-current="true"]');
    slideThumb(seg.current, '[aria-current="page"]');
  }, []);

  useEffect(() => {
    /* Place both thumbs BEFORE their transition is enabled -- see .seg.ready in globals.css. */
    move();
    const id = requestAnimationFrame(() => {
      move();
      seg.current?.classList.add("ready");
      grp.current?.classList.add("ready");
    });

    const ro = new ResizeObserver(move);
    if (seg.current) ro.observe(seg.current);
    if (grp.current) ro.observe(grp.current);
    /* Persian glyph widths change when the webfont lands, moving every item under a thumb
       that was already measured. */
    document.fonts?.ready.then(move).catch(() => {});

    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
    };
  }, [move, active, pathname, activeGroup]);

  return (
    <div className="segwrap">
      <nav
        className="seg seg-groups"
        ref={grp as React.RefObject<HTMLElement>}
        aria-label="گروه‌های فروش"
      >
        <span className="thumb" aria-hidden="true" />
        {shownGroups.map((g) => (
          <Link
            key={g.id}
            href={g.first}
            aria-current={g.id === activeGroup ? "true" : undefined}
          >
            {g.label}
          </Link>
        ))}
      </nav>

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

---

In app/globals.css, REPLACE lines 1878-1891 (the whole `.kargah .seg-groups` ... `:focus-visible` block) with:

/* The group row is the SAME primitive as the tab row: it carries class="seg seg-groups",
   so the sunk track, the travelling .thumb and the .ready spring all come from the .seg
   rules below. Only the type differs -- one notch smaller, in the display face. Focus,
   hover and the disabled state are inherited from `.kargah .seg > a`. */
.kargah .seg-groups > a { font-family: var(--font-display); font-size: 13px; font-weight: 800; padding: 7px 15px; }
.kargah .seg-groups > a[aria-current="true"] { color: var(--ink); font-weight: 800; }

Nothing else in the .seg block changes for this finding; `.kargah .seg.ready .thumb { transition: transform 520ms var(--spring), width 520ms var(--spring); }` (line 1903-1905) now governs both rows because both elements match `.seg.ready`.

**Risk:** The group <a> uses aria-current="true"; confirm the new `.seg-groups > a[aria-current="true"]` selector is what colours the active label (the generic `.seg > a[aria-current="page"]` will not match it — intended). Because the group row now has `overflow-x: auto` and `flex-wrap: nowrap` (inherited from .seg) instead of the old `flex-wrap: wrap`, six groups on a very narrow phone scroll horizontally rather than wrapping to two lines — this is required for the thumb math (offsetLeft is single-line only) and matches the tab row's existing behaviour. Verify with all roles: a role that sees only 2-3 groups still centres fine (finding 2). ResizeObserver now observes two elements; move() is cheap (two querySelector + style writes) so no perf concern. Test: load /sales/today (group روز من active) then click through to /sales/orders — both thumbs should spring, not jump, and the group thumb should sit under فروش و سفارش.

### [NEW] Center both nav rows horizontally, keep them scrollable when they overflow

**Root cause:** .kargah .segwrap (globals.css:1877) is a plain block, and .kargah .seg (1893-1897) is display:flex with the default justify-content:flex-start plus overflow-x:auto, so both rows hug the leading (right, in this RTL app) edge. Simply adding justify-content:center to .seg triggers the well-known flex+scroll bug: when the row is wider than the bar, the overflow past the start edge becomes unreachable by scroll. The fix is to center via the parent's cross axis instead, and let each row shrink-wrap.

- `/root/pourya/coverage-map/app/globals.css` @ .kargah .segwrap, line 1877 — Make it a centered flex column.
- `/root/pourya/coverage-map/app/globals.css` @ .kargah .seg, lines 1893-1897 — Add max-width:100%; min-width:0 so each row shrink-wraps and centers when it fits, and scrolls inside itself when it does not.

**Fix:**
In app/globals.css:

REPLACE line 1877:
  .kargah .segwrap { margin-bottom: 20px; }
WITH:
  /* Both nav rows are centred. Each shrink-wraps its content (align-items:center on the
     cross axis of this column) and, when a row is wider than the bar, is capped at 100%
     and scrolls inside itself -- never pushing the page wide, never the unreachable
     start-overflow that justify-content:center on the row itself would cause. */
  .kargah .segwrap {
    display: flex; flex-direction: column; align-items: center;
    gap: 10px; margin-bottom: 20px;
  }

REPLACE lines 1893-1897:
  .kargah .seg {
    position: relative; display: flex; gap: 4px;
    background: var(--sunk); border-radius: 999px; padding: 5px;
    overflow-x: auto; scrollbar-width: none;
  }
WITH:
  .kargah .seg {
    position: relative; display: flex; gap: 4px;
    max-width: 100%; min-width: 0;
    background: var(--sunk); border-radius: 999px; padding: 5px;
    overflow-x: auto; scrollbar-width: none;
  }

No JS change: slideThumb() reads offsetLeft/offsetWidth from the row's own box, so a centred row is measured correctly, and the existing ResizeObserver on each row re-runs move() when centring changes the row's width on viewport resize.

**Risk:** align-items:center on a flex COLUMN centers on the horizontal (cross) axis — correct here. min-width:0 is needed so the flex item may be capped below its content size and scroll internally rather than overflowing .segwrap. The old `.seg-groups { margin-bottom: 10px }` is removed by finding 1; the new `gap: 10px` on .segwrap replaces it, so vertical spacing between the two rows is unchanged. Check a narrow viewport (<=620px) where a long tab row (e.g. the مدیریت group, 8 tabs) must still scroll and its thumb must track under the active tab while scrolled. Check RTL scroll start position still shows the active/first tab.

### [NEW] Auto-hide the brand bar + nav on scroll-down, reveal on scroll-up

**Root cause:** In app/sales/layout.tsx the brand bar (<div class="top">) and the nav (<TabPill> -> <div class="segwrap">) are static, non-sticky block elements, and no code observes scroll direction. There is no mechanism to hide/show them. Needs a position:sticky wrapper plus a small client component that watches scrollY direction and toggles a transform class.

- `/root/pourya/coverage-map/components/kargah/Chrome.tsx` @ new file — Client wrapper: watches scroll direction via a rAF-throttled passive listener, toggles `.chrome-hidden`. Reveals on route change. No-ops under reduced motion.
- `/root/pourya/coverage-map/app/sales/layout.tsx` @ lines 40-66 (the .app div) — Wrap <div class="top">...</div> and <TabPill/> together in <Chrome>...</Chrome>; leave <RevealRoute/> and <div class="route-fade"> as siblings after it.
- `/root/pourya/coverage-map/app/globals.css` @ after line 1918 (end of the tabs block) — New `.kargah .chrome` rules: position:sticky, full-bleed backdrop, transform transition, .chrome-hidden translateY(-100%), :focus-within and reduced-motion guards.

**Fix:**
NEW FILE components/kargah/Chrome.tsx:

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

/** The sticky top chrome -- brand bar + both nav rows -- that slides up out of view on a
 *  downward scroll and back on an upward one, the way a mobile browser toolbar does.
 *  Only a class toggle here; all geometry is in `.kargah .chrome` in globals.css.
 *
 *  RTL: the motion is translateY, identical in both writing directions.
 *  Reduced motion: `.chrome-hidden` is never applied (and the global reduced-motion
 *    block at globals.css:753 zeroes the CSS transition anyway), so the bar stays put.
 *  RevealRoute / .route-fade: that wrapper is a SIBLING and animates opacity + translateY
 *    on the CONTENT; this animates transform on the CHROME and only reads scrollY. They
 *    never touch the same node or the same property. A route change also force-reveals
 *    the chrome here, so a new page never opens with the nav hidden.
 */
const TOP_GUARD = 64; // never hide within this many px of the top
const DOWN_PX = 12;   // downward travel (px) before committing to hide
const UP_PX = 6;      // upward travel (px) before revealing

export default function Chrome({ children }: { children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);

  // A new route always shows the chrome, whatever the last scroll left it as.
  useEffect(() => {
    setHidden(false);
  }, [pathname]);

  useEffect(() => {
    if (reduced) {
      setHidden(false);
      return;
    }

    let last = window.scrollY;
    let anchor = last; // where the current one-directional run began
    let dir: 1 | -1 | 0 = 0;
    let queued = false;

    const evaluate = () => {
      queued = false;
      const y = window.scrollY;
      const delta = y - last;
      last = y;
      if (delta === 0) return;

      const nextDir = delta > 0 ? 1 : -1;
      if (nextDir !== dir) {
        dir = nextDir;
        anchor = y;
      }
      const travel = Math.abs(y - anchor);

      if (y <= TOP_GUARD) setHidden(false);
      else if (dir === 1 && travel > DOWN_PX) setHidden(true);
      else if (dir === -1 && travel > UP_PX) setHidden(false);
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(evaluate);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reduced]);

  return <div className={`chrome${hidden ? " chrome-hidden" : ""}`}>{children}</div>;
}

---

app/sales/layout.tsx -- add the import and wrap. Change the imports block to include:
  import Chrome from "@/components/kargah/Chrome";

and replace the body of <div className="app"> (lines 41-67) with:

      <div className="app">
        <Chrome>
          <div className="top">
            <div className="brandwrap">
              <div className="mark">ف</div>
              <div>
                <h1>فروش و سفارش‌ها</h1>
                <div className="sub">{faJalaliLong(new Date().toISOString())}</div>
              </div>
            </div>
            <div className="topright">
              <Link className="chip" href="/map">↗ نقشه</Link>
              <SkinToggle />
              <FontPicker />
              <AccentPicker />
              <div className="me" title={`${session.user.display_name} · ${ROLE_LABEL[session.role]}`}>
                {initial}
              </div>
            </div>
          </div>

          <TabPill tabs={tabs} groups={SALES_GROUPS} />
        </Chrome>

        {/* One entrance for every sales screen -- see RevealRoute. It also drives the
            .route-fade wrapper's cross-fade. Sibling of <Chrome>, never nested. */}
        <RevealRoute />
        <div className="route-fade">{children}</div>
      </div>

---

app/globals.css -- INSERT after line 1918 (right after `.kargah .seg > span[aria-disabled] { ... }`, before the `/* ---- generic blocks ---- */` comment):

/* ---- sticky auto-hiding chrome -----------------------------------------------
   The brand bar + both nav rows ride in one position:sticky wrapper that slides up out
   of view on a downward scroll and back on an upward one (components/kargah/Chrome.tsx
   decides which). It bleeds over the .app side padding so its backdrop is full-width,
   and pulls up into the .app top padding so it sits flush to the viewport edge when
   pinned. The transition is on transform ALONE, so it never contends with .route-fade
   (a sibling that animates opacity + translateY on the content). translateY only --
   RTL-agnostic. globals.css:753 already zeroes the transition under reduced motion;
   Chrome.tsx additionally never sets .chrome-hidden then, and :focus-within keeps the
   bar down for a keyboard user tabbing through the nav. */
.kargah .chrome {
  position: sticky; top: 0; z-index: 40;
  background: var(--bg);
  margin-inline: calc(-1 * clamp(14px, 4vw, 64px));
  padding-inline: clamp(14px, 4vw, 64px);
  margin-top: -26px; padding-top: 26px; padding-bottom: 10px;
  transition: transform 320ms var(--ease);
  will-change: transform;
}
.kargah .chrome.chrome-hidden { transform: translateY(-100%); }
.kargah .chrome.chrome-hidden:focus-within { transform: none; }
@media (max-width: 620px) {
  .kargah .chrome {
    margin-inline: -14px; padding-inline: 14px;
    margin-top: -18px; padding-top: 18px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .kargah .chrome { transition: none; }
  .kargah .chrome.chrome-hidden { transform: none; }
}

The negative margin-top/padding-top pair nets to zero at-rest shift (they equal the .app top padding: 26px normally, 18px under 620px); the negative margin-inline/padding-inline pair equals the .app horizontal padding (clamp(14px,4vw,64px) normally, 14px under 620px) so the backdrop is edge-to-edge with no content shift. If .app's padding in globals.css:1819-1820 ever changes, these four values must change with it.

**Risk:** position:sticky needs no scroll-clipping or transformed ancestor: verified -- body/html/:root (globals.css:266,321) and .kargah (1499) set no overflow/transform, and .app (1819) is overflow-visible. z-index:40 sits above sales page content (max observed z-index ~5 on .pocket:hover) and below modals/sheets (z-index 70-75, position:fixed, globals.css:2278,2505,2511) and every --z-* token (1000+), so a modal still covers the nav and the nav still covers the page. The sticky bar can cover the top of a long form when pinned; the :focus-within guard drops it back while any descendant link/control is focused, but a focused input INSIDE .route-fade is not covered by that guard -- acceptable since the bar auto-reveals on the next upward scroll and on route change. Throttle is one rAF per scroll burst; passive listener, so no scroll jank. Test matrix: scroll down a long page (/sales/orders) -> chrome slides up; nudge up -> slides back; near top (<64px) -> always visible; navigate while hidden -> chrome reappears; OS reduced-motion on -> chrome never moves; narrow phone -> full-bleed backdrop still edge-to-edge, no horizontal page scroll.


---

## /sales kanban — task card & column density (/sales/board OrderPipeline, /sales/tasks Board)

The `.kargah .task` / `.col` / `.colhead` / `.board` CSS is byte-identical between main and sales-redesign, and OrderPipeline.tsx / Board.tsx are untouched by the branch. The only relevant change is `.kargah .app` going full-bleed: main had `max-width: 1240px; margin: 0 auto`, the branch has `width: 100%; max-width: none; margin: 0; padding: 26px clamp(14px,4vw,64px) 120px`. The board grid is `repeat(3,1fr)` (and `.pipe` `repeat(4,1fr)`) with no column-width cap, so once the page is wider than ~1300px the columns — and every `.task` inside them — stretch without limit: ~560px columns at 1800px, ~785px at 2560px. Card content is all short strings (status dot + label, a bold title, a "…" button, avatar + name), so 300–500px of each row becomes trailing whitespace. That is the "so much white space" the user sees. Secondary: the pre-existing task/column paddings were tuned for a ~380px card and read loose at any width, and `min-height: 240px` on a near-empty lane is a tall grey void.

### [REGRESSION] Full-bleed .app + uncapped board grid makes kanban columns (and task cards) arbitrarily wide

**Root cause:** app/globals.css line 1819: the branch dropped `max-width: 1240px; margin: 0 auto` from `.kargah .app` in favour of `width: 100%; max-width: none; margin: 0`. `.kargah .board` (line 2196) is `grid-template-columns: repeat(3,1fr)` and `.kargah .board.pipe` (line 2260) is `repeat(4,1fr)` with no track ceiling and `justify-content` unset (default stretch). Previously the 1240px container held the board to ~388px (3-col) / ~290px (4-col) columns; now on a 1920px monitor columns are ~590px/~440px and on a 2560px monitor ~785px/~588px. Every `.kargah .task` is `display:block; width:100%`, so each card inherits that width while its content stays ~30 characters -- the remainder renders as empty card. `.kargah .task .top` is `justify-content: space-between`, so on a wide card the title and amount are flung to opposite edges with a canyon between them.

- `/root/pourya/coverage-map/app/globals.css` @ 1819 (.kargah .app) — lost max-width/centring; now full-bleed with a clamp gutter
- `/root/pourya/coverage-map/app/globals.css` @ 2196-2200 (.kargah .board) and 2260 (.kargah .board.pipe) — grid tracks are repeat(3,1fr)/repeat(4,1fr) with no max column width and no justify-content
- `/root/pourya/coverage-map/components/sales/OrderPipeline.tsx` @ 169 (div.board.pipe) — renders the 4-lane order pipeline at /sales/board -- unchanged by branch, inherits the width blow-up
- `/root/pourya/coverage-map/components/board/Board.tsx` @ ~150 (div.board), 160-330 (div.task) — renders the 3/4-lane task board at /sales/tasks -- unchanged by branch, inherits the width blow-up; note inline style={{ padding: "6px 24px 20px" }} on the board div

**Fix:**
Cap the column tracks and park the board on the reading edge. Replace the two rules in app/globals.css:

.kargah .board {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 340px));
  justify-content: start;
  gap: 16px;
  padding: 6px 24px 24px;
  align-items: start;
  user-select: none; -webkit-user-select: none;
}
.kargah .board.pipe { grid-template-columns: repeat(4, minmax(0, 300px)); }

Why this shape: minmax(0, 340px) caps each column at a normal kanban width on big monitors but still lets columns shrink below 340/300 on <1080px laptops exactly as they do today, so no overflow and no edit to the existing @media (max-width:1080px)/(940px) collapse rules is needed. justify-content: start pins the board to the RTL start (right) edge instead of stretch. Result: a .pipe card is 300px outer -> ~274px content after the 13px side padding; a plain-board card is 340px -> ~312px content. The .top space-between row then has a sane gap. If you prefer 'more columns' over a hard cap for the non-pipe board, use grid-template-columns: repeat(auto-fill, minmax(300px, 340px)); justify-content: start; -- but the order pipeline is a fixed 4-stage flow, so keep the fixed repeat(4, ...) for .pipe.

**Risk:** minmax(0, ...px) with justify-content:start means on an ultrawide monitor there is now deliberate empty space to the left of the board -- that is correct (a kanban is not meant to be 2500px wide) but visually different from the current stretch. Verify at 1280px, 1440px, 1920px and one ultrawide that: (a) 4 pipe lanes still fit above 1080px without horizontal scroll, (b) lanes collapse to 2-up at <=1080px and 1-up at <=940px via the untouched media queries, (c) drop zones are still wide enough to target. Pure CSS in the .kargah scope; no JS or build risk.

### [NEW] Task card and column padding/min-height are tuned for a wide card and read loose -- tighten for density

**Root cause:** Pre-existing values in app/globals.css: .kargah .task (2229-2237) has padding: 13px 14px; margin-bottom: 9px. .kargah .col (2201-2211) has padding: 14px; min-height: 240px. .kargah .colhead (2216-2219) has margin-bottom: 12px. .kargah .task .m (2243-2246) is font-size: 12px. On the artifact's 2-cards-per-lane demo these felt fine; with real data and (even after Finding 1) a ~300px card the internal rhythm is still airy, and a near-empty lane is a 240px grey void. Board.tsx also adds inline style={{ marginTop: 8 }} on the second .top row and style={{ marginTop: 4 }} on the title.

- `/root/pourya/coverage-map/app/globals.css` @ 2201-2211 (.kargah .col) — padding 14px, min-height 240px
- `/root/pourya/coverage-map/app/globals.css` @ 2216-2219 (.kargah .colhead) — margin-bottom 12px
- `/root/pourya/coverage-map/app/globals.css` @ 2229-2246 (.kargah .task, .task .n, .task .m) — padding 13px 14px, margin-bottom 9px, .m font-size 12px
- `/root/pourya/coverage-map/app/globals.css` @ 2263-2266 (.kargah .task .asg) — margin-top 8px, font-size 11.5px
- `/root/pourya/coverage-map/components/board/Board.tsx` @ ~250 (title div), ~275 (second .top row) — inline marginTop: 4 on title, marginTop: 8 on the drag-handle/menu row

**Fix:**
Apply these exact values in app/globals.css (keep every other property on each rule as-is):

.kargah .col {
  background: var(--card-2); border: 1px solid var(--line); border-radius: var(--r-xl);
  padding: 10px 10px 4px; min-height: 160px;
  max-height: 62vh; overflow-y: auto; overscroll-behavior: contain;
  transition: background 200ms var(--ease), border-color 200ms var(--ease), box-shadow 200ms var(--ease);
}
.kargah .colhead {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 8px; padding: 0 4px;
}
.kargah .task {
  background: var(--card); border-radius: var(--r-md); box-shadow: var(--sh-1);
  padding: 10px 12px; margin-bottom: 6px; cursor: grab;
  user-select: none; -webkit-user-select: none; touch-action: none;
  display: block; width: 100%; text-align: start; border: 0; font-family: var(--fa);
  transition: transform 220ms var(--spring), box-shadow 220ms var(--ease), opacity 180ms linear;
}
.kargah .task .n { font-size: 13.5px; font-weight: 600; line-height: 1.45; }
.kargah .task .m {
  font-size: 11px; color: var(--muted); display: flex; gap: 2px 9px;
  flex-wrap: wrap; margin-top: 2px;
}
.kargah .task .asg {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 6px;
  font-size: 11px; color: var(--muted);
}

Deltas: task padding 13/14 -> 10/12; card gap (margin-bottom) 9 -> 6; column padding 14 -> 10 10 4 (only 4px at the bottom because each card already carries its own margin-bottom); min-height 240 -> 160 so an empty lane is not a tall void; colhead margin-bottom 12 -> 8; metadata row .m 12px -> 11px with row-gap 4 -> 2. Optional matching JS nudge in components/board/Board.tsx: title inline marginTop: 4 -> 3, second .top row marginTop: 8 -> 6, and set the board div inline padding to "6px 16px 16px" (OrderPipeline reads the CSS value, so also set .kargah .board padding to 6px 16px 16px if you want them identical).

**Risk:** Lower min-height means very short lanes lose a little vertical drop area; 160px still holds ~2 cards plus the header, and the drag resolver targets [data-lane]/[data-stage] on the section which keeps its border, so drops still register. Smaller .m font (11px) on Farsi digits -- check legibility at 100% zoom. line-height 1.45 on .task .n prevents a two-line Farsi title clipping against the tighter padding. Pure CSS; verify one lane with a long title, one empty lane, one full lane at LANE_CAP.

### [NEW] Scope note: .kblock wrapper picks up the new .kcard top bar + hover rail, but that is not the whitespace source

**Root cause:** The branch's .kcard primitive (app/globals.css 2607-2665) aliases .card and .kblock, adding a 3px ::after top bar, a ::before hover rail, overflow:hidden and isolation. The board pages wrap everything in <div className="kblock">, so the section shell gains the bar/rail. .kargah .task is NOT in any .kcard selector list, so task cards get no extra bar and no extra inset. .kcard__body / .kblock__body padding: 0 24px 20px is a new class the board markup does not use. So the primitive does not inflate the task cards; the whitespace is entirely Finding 1 (width) plus Finding 2 (internal padding).

- `/root/pourya/coverage-map/app/globals.css` @ 2607-2665 (.kcard primitive), 2660-2661 (.kcard__body padding: 0 24px 20px) — aliases .card/.kblock and adds edge marks; does not target .task; __body inset unused by board markup

**Fix:**
No change required. Recorded so the reviewer does not chase the .kcard__body `0 24px 20px` inset -- it does not apply to the kanban. If the section shell's own 3px bar feels heavy above the toolbar, `.kargah .kblock:has(.board) { overflow: visible }` is a cosmetic option unrelated to the complaint.

**Risk:** None -- informational.


---

## /sales top bar (app/sales/layout.tsx + app/globals.css ".kargah") — brand mark/title, profile dropdown, and a unified user Avatar across the sales section. Reviewed on branch sales-redesign vs main.

None of the three complaints are regressions — they are additive asks the 25-commit redesign never touched. The top bar still renders a literal placeholder brand (a "ف" glyph in .kargah .mark and the hard-coded string "فروش و سفارش‌ها" in the h1); there is no infinity logo and the app name (RouteFlow, per package.json "routeflow", MASTER.md and README) appears nowhere. The appearance controls (map chip, SkinToggle, FontPicker, AccentPicker) sit loose in .topright next to a bare-initial .me circle, with no dropdown. And there is no shared user avatar: the users table (lib/db.ts) has no photo/avatar/image column, so a first-initial-in-a-coloured-circle is re-implemented ad hoc in at least six places (local AV_TONE = ["plum","sage","sky","amber"] keyed on name length), while components/AvatarStack.tsx's Avatar is a separate neutral two-initial squircle — inconsistent shape, colour seed, and initial count.

### [NEW] Brand: swap the placeholder "ف" mark for an infinity logo and the h1 string for the app name (RouteFlow)

**Root cause:** app/sales/layout.tsx renders `<div className="mark">ف</div>` and `<h1>فروش و سفارش‌ها</h1>` as literals; commit b5593f9 and the rest of sales-redesign never touched the brandwrap block, so the section has no logo mark and never shows the product name. app/globals.css:1832 styles .kargah .mark as a gradient tile sized for a single display-font glyph. App name is a judgement call but well-attested: package.json name "routeflow", MASTER.md "MASTER — RouteFlow Design System", README.md "RouteFlow — سامانه فروش، پخش و مدیریت مسیر". Recommend the Latin wordmark "RouteFlow" (brand names stay Latin even in this RTL UI); the existing Jalali date stays as the .sub line beneath it.

- `app/sales/layout.tsx` @ lines 44-49 (brandwrap: .mark glyph + h1 + .sub) — replace glyph with inline infinity SVG; replace h1 text with RouteFlow; keep the faJalaliLong .sub line
- `app/globals.css` @ .kargah .mark (~line 1832) and .kargah .top h1 (~line 1839) — restyle .mark to host an accent-stroke SVG; add a Latin fallback to the h1 font stack
- `package.json` @ "name": "routeflow" — source for the proposed app name
- `MASTER.md` @ line 1 heading — confirms the name RouteFlow

**Fix:**
layout.tsx — replace the brandwrap block verbatim:

          <div className="brandwrap">
            <div className="mark" aria-hidden="true">
              <svg className="mark__glyph" viewBox="0 0 40 24" role="img" aria-label="RouteFlow">
                <path
                  d="M20 12C15 4 4 4 4 12s11 8 16 0c5-8 16-8 16 0s-11 8-16 0Z"
                  fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <h1>RouteFlow</h1>
              <div className="sub">{faJalaliLong(new Date().toISOString())}</div>
            </div>
          </div>

globals.css — replace .kargah .mark and tweak the h1:

.kargah .mark {
  width: 46px; height: 46px; border-radius: 15px;
  background: var(--accent-soft);
  color: var(--accent);
  display: grid; place-items: center; flex: none;
  box-shadow: 0 6px 16px -6px color-mix(in srgb, var(--accent) 45%, transparent);
}
.kargah .mark__glyph { width: 30px; height: auto; display: block; }
.kargah .top h1 {
  margin: 0;
  font-family: var(--font-display), "Inter", system-ui, sans-serif; /* Damavand is a Persian face; add a Latin fallback for the wordmark */
  font-size: 22px; font-weight: 800; letter-spacing: -.02em;
}

Judgement call to confirm with the user: wordmark text = "RouteFlow" (Latin). If they want Persian, use "روت‌فلو" and drop the h1 font fallback. The infinity path above is a symmetric stroked lemniscate (two lobes crossing at x=20); accent stroke via currentColor, which .mark sets to var(--accent).

**Risk:** Grep confirms .kargah .mark is used only in app/sales/layout.tsx, so restyling is contained. --accent-soft / --accent are defined (AccentPicker relies on them). Verify Damavand/--font-display has usable Latin glyphs at /sales; if it substitutes poorly the Inter/system-ui fallback covers it. Purely visual — no data or auth path touched.

### [NEW] Profile dropdown: turn .me into a button opening a popover that hosts the map link, SkinToggle, FontPicker, AccentPicker

**Root cause:** app/sales/layout.tsx .topright renders `<Link className="chip" href="/map">`, `<SkinToggle/>`, `<FontPicker/>`, `<AccentPicker/>` and a non-interactive `<div className="me">{initial}</div>` side by side. The redesign added FontPicker (commit eebe15c) into this row but never consolidated it — there is no dropdown mechanism on .me at all. AccentPicker/FontPicker already carry the exact popover mechanics wanted (click-outside on a root ref + Escape); they just need a third render variant so they can sit inside another popover without opening a second one.

- `components/kargah/ProfileMenu.tsx` @ new file — client component: avatar-button trigger + popover panel with rows
- `app/sales/layout.tsx` @ imports (lines 8-10) and .topright block (lines 50-58), plus the `initial` const line 35 — drop the three picker imports + Link + initial; render <ProfileMenu/> only
- `components/AccentPicker.tsx` @ variant prop type (line ~52) and the return (line ~85) — add variant "menu": inline expanding row, reusing the ACCENT_THEMES swatch grid
- `components/FontPicker.tsx` @ variant prop type (line ~54) and the return (line ~88) — add variant "menu": inline expanding row, reusing the FONT_CHOICES grid
- `app/globals.css` @ after .kargah .me (~line 1855) — add .pmenu / .pmenu__panel / .pmenu__row styles; make button.me a bare button

**Fix:**
NEW FILE components/kargah/ProfileMenu.tsx (in full):

"use client";

/** The top-bar profile menu: the viewer's avatar, and behind it every app-appearance
 *  control that used to sit loose in the header. Popover mechanics are a straight copy
 *  of AccentPicker/FontPicker — click-outside closes, Escape closes, the trigger carries
 *  aria-haspopup/expanded. The three pickers render in their "menu" variant: a
 *  full-width row that expands its choices inline instead of opening a second popover. */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/kargah/Avatar";
import SkinToggle from "@/components/kargah/SkinToggle";
import FontPicker from "@/components/FontPicker";
import AccentPicker from "@/components/AccentPicker";

export default function ProfileMenu({
  userId,
  name,
  roleLabel,
}: {
  userId: number | string;
  name: string;
  roleLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="pmenu">
      <button
        type="button"
        className="me"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${name} · ${roleLabel}`}
        title={`${name} · ${roleLabel}`}
      >
        <Avatar user={{ id: userId, name }} size={42} />
      </button>

      {open && (
        <div dir="rtl" role="dialog" aria-label="حساب کاربری" className="pmenu__panel">
          <div className="pmenu__id">
            <Avatar user={{ id: userId, name }} size={38} />
            <div className="min-w-0">
              <strong>{name}</strong>
              <span>{roleLabel}</span>
            </div>
          </div>

          <Link className="pmenu__row" href="/map" onClick={() => setOpen(false)}>
            <span>نقشه</span>
            <span aria-hidden="true">↗</span>
          </Link>

          <div className="pmenu__row">
            <span>پوستهٔ روشن / تاریک</span>
            <SkinToggle />
          </div>

          <FontPicker variant="menu" />
          <AccentPicker variant="menu" />
        </div>
      )}
    </div>
  );
}

(Use real Persian literals when typing the file; escapes shown only to keep this spec ASCII. Rows: نقشه / پوستهٔ روشن / تاریک.)

--- AccentPicker.tsx / FontPicker.tsx: add the "menu" variant ---
1. Widen the prop type: `variant?: "header" | "map" | "menu";`
2. Immediately before the existing `return (` add:

  if (variant === "menu") {
    return (
      <div ref={root} className="pmenu__row pmenu__row--stack">
        <button type="button" className="pmenu__rowhead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span>{/* AccentPicker: 'رنگ ظاهر'  |  FontPicker: 'قلم' */}</span>
          <span className="pmenu__cur">{current.label}</span>
        </button>
        {open && (
          <div className="grid grid-cols-5 gap-1.5 pt-1.5">{/* AccentPicker: cols-5; FontPicker: cols-2 */}
            {/* paste the EXISTING ACCENT_THEMES.map(...) / FONT_CHOICES.map(...) <button> block unchanged */}
          </div>
        )}
      </div>
    );
  }

Keeping `ref={root}` on that wrapper means each picker's own outside-click listener still works, and because the swatch buttons live inside both that root and ProfileMenu's root, clicking one never closes the parent menu. The "map" variant (used on /map) is untouched.

--- app/sales/layout.tsx edits ---
- Delete imports of SkinToggle, AccentPicker, FontPicker; delete `import Link` (only the map chip used it); add `import ProfileMenu from "@/components/kargah/ProfileMenu";`
- Delete `const initial = session.user.display_name.trim()[0] ?? "؟";`
- Replace the whole `.topright` block with:

          <div className="topright">
            <ProfileMenu
              userId={session.user.id}
              name={session.user.display_name}
              roleLabel={ROLE_LABEL[session.role]}
            />
          </div>

--- app/globals.css, after .kargah .me (~1855) ---

.kargah .pmenu { position: relative; }
.kargah button.me { border: 0; padding: 0; background: none; cursor: pointer; line-height: 0; }
.kargah .pmenu__panel {
  position: absolute; inset-inline-end: 0; top: calc(100% + 8px);
  z-index: var(--z-panel);
  width: 264px; max-width: calc(100vw - 2rem);
  background: var(--card); border: 1px solid var(--line);
  border-radius: 14px; box-shadow: var(--sh-2);
  padding: 8px; display: flex; flex-direction: column; gap: 2px;
}
.kargah .pmenu__id {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 8px 10px; border-bottom: 1px solid var(--line); margin-bottom: 4px;
}
.kargah .pmenu__id strong { display: block; font-size: 13.5px; font-weight: 650; }
.kargah .pmenu__id span { display: block; font-size: 11.5px; color: var(--muted); }
.kargah .pmenu__row,
.kargah .pmenu__rowhead {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  width: 100%; padding: 9px 8px; border: 0; background: none;
  font: inherit; color: var(--ink-2); text-decoration: none;
  border-radius: 9px; cursor: pointer;
}
.kargah .pmenu__row:hover,
.kargah .pmenu__rowhead:hover { background: color-mix(in srgb, var(--ink) 6%, transparent); }
.kargah .pmenu__row--stack { flex-direction: column; align-items: stretch; gap: 0; padding: 0; }
.kargah .pmenu__cur { font-size: 12px; color: var(--muted); }

**Risk:** Three outside-click listeners now stack (ProfileMenu + both pickers) and all fire on one mousedown; each guards on its own ref so the order is harmless, and Escape closing all layers at once is acceptable. The "menu" branch must be placed before each picker's existing return or the old header popover renders too. --card/--line/--sh-2/--muted/--ink-2/--z-panel are all already used in the .kargah block. Verify: open menu, change skin/font/accent, click outside, press Esc; confirm /map's own FontPicker/AccentPicker still work (variant="map", untouched). SkinToggle is unchanged — it is already a self-contained button.

### [NEW] Avatars: one <Avatar user={..} size={..} /> — the user model has no photo field, so ship a deterministic id-seeded coloured initial and swap every ad-hoc initial in /sales

**Root cause:** The `users` table in lib/db.ts (~line 886) has columns id, username, password_hash, display_name, role, group_id, organization_id, staff_code, phone, active, token_version, location_consent_at, created_at — no avatar/photo/picture/image. UserRow (lib/db.ts:3115) matches. Grep of lib/ and types/ for avatar|photo|picture on the user model finds only the `photos` table (entity_type/entity_id, scoped to orders and payment receipts), deliveries.photo_path, and payments.receipt_photo_stem — nothing for people. So a user is drawn as the first character of display_name in a coloured circle, re-implemented independently in components/kargah/EarnerCard.tsx (AV_TONE keyed on displayName.length), components/sales/OrderPipeline.tsx, components/sales/ProcessingModal.tsx, app/sales/page.tsx, app/sales/commission/page.tsx, and app/sales/layout.tsx (.me), while components/AvatarStack.tsx exports a different Avatar (neutral squircle, two initials, no colour). Different shapes, different colour seeds, different initial counts.

- `components/kargah/Avatar.tsx` @ new file — the single Avatar component: photo if user.src, else id-seeded coloured initial squircle
- `components/AvatarStack.tsx` @ Avatar export (whole) + AvatarStack people type (lines ~63-100) — delete the local Avatar; re-export/import the new one; StackPerson gains id
- `app/sales/layout.tsx` @ line 55 .me initial — handled by ProfileMenu (finding 2) which renders <Avatar user={{id: session.user.id, name}} size={42}/>
- `components/kargah/EarnerCard.tsx` @ lines 3, 41, 49-56 (AV_TONE, tone, .pcard__av span) — replace .pcard__av initial with <Avatar user={{id, name: displayName}} size={46}/>; delete AV_TONE
- `app/sales/commission/page.tsx` @ line 154 manager .pcard__av; lines 100-135 EarnerCard calls already pass id — swap the manager-card initial for <Avatar user={{id: m.manager_user_id, name: m.display_name}} size={46}/>
- `components/sales/OrderPipeline.tsx` @ lines 37, 194, 219-227 — swap salesperson initial for <Avatar user={{id: o.salesperson_id, name: o.salesperson_name}}/>; add salesperson_id to the row type + feeding SQL
- `components/sales/ProcessingModal.tsx` @ lines 9, 104-111 — same swap; needs order.salesperson_id
- `app/sales/page.tsx` @ lines 70 (SQL), 95, 173-181 — add u.id AS user_id to the SELECT; swap {t.name.trim()[0]} for <Avatar user={{id: t.user_id, name: t.name}}/>
- `components/sales/AssignmentBoard.tsx` @ lines 8, 14, 249, 349 — import the new Avatar; pass user={{id: r.driver_id, name: r.driver_name}}; add driver_id to the row type
- `components/sales/RunTimeline.tsx` @ lines 3, 17, 74 — same; add run.driver_id (add u.id AS driver_id in app/sales/runs/page.tsx:42)
- `components/sales/OrderJourney.tsx` @ lines 23, 40; lib/orderJourney.ts:151-154 SQL — add created_by/driver/delivered_by id columns to the journey query, carry personId on each node, swap the initial for <Avatar user={{id: n.personId, name: n.person}}/>
- `components/board/Board.tsx` @ line 251 card.assignee.name — prepend <Avatar user={{id: card.assignee.id, name: card.assignee.name}} size={20}/> (assignee already carries an id in lib/tasks)

**Fix:**
RECOMMENDATION: deterministic generated avatar seeded by user id — NOT a DB migration. There is no user-photo pipeline (the photos table + lib/photos.ts + data/photos are entity-scoped to orders/payments), and AvatarStack.tsx already made the deliberate call that a letter avatar is 'honest about exactly what the system knows.' Seed the colour on user.id (stable across renames, unlike the current name-length hash). Pre-wire a `src` prop so a future `users.avatar_stem` column is a one-line change. If real photos are ever wanted: add `avatar_stem TEXT` to users, reuse lib/photos.ts with entity_type='user', and add an upload control on app/sales/admin/users/page.tsx.

NEW FILE components/kargah/Avatar.tsx (in full):

import { faNum } from "@/lib/format";

/** One person, drawn. The users table has a display name and no image (lib/db.ts —
 *  no avatar column; the photos table is orders/payments only). So this is a coloured
 *  initial, seeded by user id so a person keeps one colour everywhere and across a
 *  rename. `src` is already wired: the day the model grows a photo, pass it. */

const PALETTE = ["plum", "sage", "sky", "amber", "rose", "teal"] as const;

function hash(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface AvatarUser {
  id: number | string;
  name: string;
  src?: string | null;
}

export default function Avatar({
  user,
  size = 28,
  count,
  title,
  className = "",
}: {
  user: AvatarUser;
  size?: number;
  count?: number;
  title?: string;
  className?: string;
}) {
  const label = title ?? user.name;
  const tone = PALETTE[hash(String(user.id)) % PALETTE.length];
  const initial = user.name.trim()[0] ?? "؟";

  return (
    <span className={`relative inline-flex shrink-0 ${className}`} title={label}>
      {user.src ? (
        <img
          src={user.src}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          style={{ width: size, height: size }}
          className="inline-block rounded-[35%] border border-[var(--line)] object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: size,
            height: size,
            fontSize: Math.round(size * 0.42),
            background: `var(--${tone}-soft)`,
            color: `var(--${tone})`,
          }}
          className="inline-flex items-center justify-center rounded-[35%] border border-[var(--line)] font-semibold"
        >
          {initial}
        </span>
      )}
      <span className="sr-only">{user.name}</span>
      {count !== undefined && count > 0 && (
        <span
          aria-hidden="true"
          style={{ fontSize: Math.max(9, Math.round(size * 0.3)) }}
          className="absolute -bottom-1 -left-1 inline-flex min-w-[14px] items-center justify-center rounded-full border border-[var(--surface)] bg-[var(--accent)] px-[3px] font-mono leading-[14px] text-accent-ink"
        >
          {faNum(count)}
        </span>
      )}
    </span>
  );
}

PALETTE tokens: --plum/-soft, --sage/-soft, --sky/-soft, --amber/-soft already exist; add --rose/-soft and --teal/-soft to the .kargah token block in globals.css (or trim PALETTE to the existing four).

components/AvatarStack.tsx: delete its local `Avatar`, `import Avatar from "@/components/kargah/Avatar"`, change StackPerson to `{ id: number | string; name: string; count?: number }`, and in the map render `<Avatar user={{ id: p.id, name: p.name }} size={size} count={p.count} />`. Both current callers (RunTimeline, AssignmentBoard) already have the driver id in scope once the row types below carry it.

SWAP LIST — every place a user renders in /sales:
1. Top-bar .me — via ProfileMenu (finding 2). size 42.
2. Commission salesperson/driver cards — EarnerCard.tsx .pcard__av -> <Avatar user={{id, name: displayName}} size={46}/>. `id` is already a prop. Delete AV_TONE.
3. Commission manager card — commission/page.tsx:154 -> <Avatar user={{id: m.manager_user_id, name: m.display_name}} size={46}/>.
4. Order pipeline lane cards — OrderPipeline.tsx:219-227 -> <Avatar user={{id: o.salesperson_id, name: o.salesperson_name ?? ''}} size={22}/>. Add `salesperson_id` to the pipeline row type and the SQL that builds it (board/page.tsx + lib feeding it — the query already selects u.display_name AS salesperson_name; add o.salesperson_id / u.id).
5. ProcessingModal.tsx:104-111 -> same, needs order.salesperson_id.
6. Today rep list — app/sales/page.tsx: add `u.id AS user_id` at the SELECT (line ~70), then :175-181 -> <Avatar user={{id: t.user_id, name: t.name}} size={32}/>. Delete the local AV_TONE.
7. Assignment board — AssignmentBoard.tsx:249 & :349: <Avatar user={{id: r.driver_id, name: r.driver_name}} .../>. Add `driver_id` to the row type + query.
8. Run timeline — RunTimeline.tsx:74: <Avatar user={{id: run.driver_id, name: run.driver_name}} count={run.stops.length}/>. runs/page.tsx:42 — add `u.id AS driver_id`.
9. Order journey — OrderJourney.tsx:23,40: lib/orderJourney.ts:151-154 selects cb/dv/db_ .display_name; also select cb.id etc., put `personId` on each node, then <Avatar user={{id: n.personId, name: n.person ?? ''}} size={24}/>.
10. Task board cards — components/board/Board.tsx:251: render <Avatar user={{id: card.assignee.id, name: card.assignee.name}} size={20}/> before the name span (assignee already has an id in lib/tasks).
11. Pocket cards — audit components/kargah/OrdersPockets.tsx / PocketCard.tsx / components/sales/OrderPocketCard.tsx: they currently show only the status bar, no person — nothing to change unless a rep line is added.
12. Complaints — components/sales/ComplaintsPanel.tsx renders customer business_name only, no app user — nothing to change.
13. Reps list/detail (app/sales/reps) — these are representative businesses, not app users; leave as-is (out of scope).
14. Selects — OrderForm.tsx:251, RunPlanner.tsx:86, CommissionEditor.tsx:155/220 render display_name inside <option>; SVG can't go in <option>, leave. If CommissionEditor rows are visible list rows (not options), add <Avatar> there too.
15. Schedule board — app/sales/schedule/page.tsx:42 / components/kargah/ScheduleBoard.tsx: if a driver lane header shows a name, add <Avatar>; add u.id to the SELECT.
16. Dashboard commission charts — dashboard/page.tsx:387+ use display_name as a BarChart axis label (text), no avatar.

Out of the review's stated /sales scope but the complaint says 'everywhere': the same <Avatar> should also replace the user chip in the /map header and the rows of app/sales/admin/users/page.tsx.

**Risk:** The component itself is inert until a photo column exists (the <img> branch never runs). Main risk is the several SQL queries that must start selecting a `*_id` next to an existing `*_name` alias — each is a one-column add on a join that is already present; a wrong alias shows a blank/wrong initial, not a crash (Avatar falls back to '؟'). Squircle (border-radius 35%) replaces the circular .me and .pcard__av — purely visual, matches the house call in MASTER.md/AvatarStack. Seeding on id (not name length) changes which colour each person gets — expected and desired. Verify: open each of the ~12 screens; confirm one person shows the same colour in every place, and initials render for Persian names. Run the sales page tests + tsc after adding the id fields to the row types.


---

## /sales (کارگاه) redesign — main..sales-redesign visible-behaviour diff

Most of the diff matches the approved spec (self-hosted fonts + picker, per-theme surface tint, full-bleed .app, grouped nav, dashboard/analysis merge, animation CSS). The accidental regressions cluster in the .kcard primitive migration and the full-bleed change. Worst: making legacy .card an alias of .kcard silently adds overflow:hidden + isolation:isolate + position:relative to every form section, which clips the JalaliDatePicker calendar and other absolute popovers rendered inside .card. Full-bleed dropped the 1240px cap but only statrow/pockets/ptiles got density guards, so the kanban board, customer bento and schedule calendar now stretch edge-to-edge. Secondary: the .kblock/.card hover lift is applied to full-width page shells and nested blocks; the .kblock__body inset fix was applied to only some consumers (KpiStrip / ActionCenter still bleed); the Stagger component and its CSS shipped unwired; the ::after top bar was extended to .gcard/.face beyond spec; the new group nav row wraps instead of scrolling; and the FaNum numeral fonts (--font-num and every picker *-num face) are unreachable inside .kargah because --en/--fa alias to --font-ui.

### [REGRESSION] Legacy .card alias silently gains overflow:hidden + isolation:isolate + position:relative, clipping the JalaliDatePicker calendar and any absolute popover inside a form card

**Root cause:** app/globals.css:2607-2619 collapses `.kargah .kcard, .kargah .card, .kargah .kblock` into one rule that sets position:relative; overflow:hidden; isolation:isolate. On main, `.kargah .card` was only border+bg+shadow with NO overflow/position/isolation. `.card` is used purely as a form-section wrapper on /sales/products, /sales/stock, /sales/commission, /sales/admin/representatives and inside OrderForm.tsx (3 sections), CatalogueEditor, CommissionEditor, PurchaseEntry, RunPlanner. OrderForm.tsx:235 `<section className="grid ... card ...">` contains <JalaliDatePicker>, which at JalaliDatePicker.tsx:117 renders its calendar as `absolute z-[var(--z-panel)] w-[280px]`. overflow:hidden on the now-.card ancestor clips that ~280x300px popover to the card box (worse when the field is near the card bottom and dropUp is false); isolation:isolate traps its z-index below anything outside the card. Same hazard for any future absolute menu/tooltip in a .card.

- `app/globals.css` @ 2607-2619 (.kargah .kcard, .kargah .card, .kargah .kblock) — adds overflow:hidden + isolation:isolate + position:relative to the .card alias
- `components/JalaliDatePicker.tsx` @ line 117 (role=dialog absolute popover) — calendar is absolutely positioned; gets clipped by the card
- `components/sales/OrderForm.tsx` @ line 235 (section.card containing JalaliDatePicker) — concrete break site on the order create/edit form

**Fix:**
Split the shared rule so the compatibility alias does not hard-clip. Keep `position:relative; overflow:hidden; isolation:isolate` on `.kargah .kcard` (new markup) and `.kargah .kblock` (already had overflow:hidden on main). For `.kargah .card` set only `position:relative` (needed to anchor ::before/::after) and leave overflow visible / isolation auto. Make the 3px bar not need clipping: on `.kargah .card::after` add `border-start-start-radius:var(--r-xl); border-start-end-radius:var(--r-xl);` so its square corners are not visible past the card's radius. Result: `.kargah .kcard,.kargah .kblock{overflow:hidden;isolation:isolate} .kargah .card{position:relative} .kargah .card::after{border-start-start-radius:var(--r-xl);border-start-end-radius:var(--r-xl)}`.

**Risk:** Without overflow:hidden the bar's square corners could poke ~1px past the 12px radius; the border-radius on the pseudo removes that. Verify: /sales/orders/new, focus تاریخ سفارش in the middle card, the full calendar shows uncut; check the .card hover rail still clips to the rounded left edge (add border-radius to ::before if needed).

### [REGRESSION] Full-bleed .app dropped the 1240px cap but .board / .bento / .sched / .lanes / .chartbox got no width guard

**Root cause:** app/globals.css:1819 changed `.kargah .app` from max-width:1240px; margin:0 auto to width:100%; max-width:none; margin:0. Spec section 6 asked for density guards on the grids that assumed the cap; implementation only added max-width:1400px to .statrow and clamp() ceilings to .pockets/.ptiles. Untouched: `.kargah .board { grid-template-columns: repeat(3,1fr) }` (2196), `.kargah .bento { 1.5fr 1fr 1fr }` (2531, used by CustomerBento.tsx:47), `.kargah .sched { 1fr 1.15fr }` (2453), `.kargah .lanes` (2351), `.kargah .chartbox` (2022). On a 1920px+/21:9 monitor the kanban columns, customer bento tiles and schedule calendar stretch to 600-900px each with no measure - the layout breakage the old cap prevented.

- `app/globals.css` @ 1819 (.kargah .app), 2196 (.board), 2531 (.bento), 2453 (.sched), 2351 (.lanes) — full-bleed with no compensating max-width on fixed multi-column layouts
- `components/kargah/CustomerBento.tsx` @ line 47 (div.bento) — renders the unguarded .bento grid

**Fix:**
Cap the fixed-column layouts (not the auto-fill ones): `.kargah .board, .kargah .bento, .kargah .sched, .kargah .lanes { max-width: 1500px; }` (tune ~1400-1600). For `.kargah .chartbox` cap the SVG container: `.kargah .chartbox { max-width: 1200px; }` or give the chart a fixed aspect box. Leave .pockets/.ptiles/tables full-width (they answer width with more columns, per spec).

**Risk:** Purely visual; no logic. Verify on >1920px that /sales/board, /sales (customer bento) and /sales/schedule no longer span the whole viewport, and that at 1280-1440px nothing shrank vs today.

### [REGRESSION] .kblock / .card hover lift (translateY(-2px) + growing rail) now fires on full-width page shells and nested blocks

**Root cause:** app/globals.css ~2650 `.kargah .kcard:hover, .kargah .card:hover, .kargah .kblock:hover { box-shadow:var(--sh-2); transform:translateY(-2px); }` plus the ::before rail. On main only .prow and .ptile had a hover transform, never .kblock. .kblock wraps the largest containers on almost every sales page (orders table, board, schedule, journey, academy, reps, and the merged dashboard's KpiStrip / ActionCenter / MarginTable / سلامت مشتری blocks as siblings). Each now jumps 2px and casts a bigger shadow when the pointer merely passes over it; where a .kblock/.card nests inside another (e.g. .dash-top > .card charts, RevealRoute.tsx:24) parent and child both animate on adjacent hovers. Spec 7.1's 'aliases (same)' line technically sanctions it, but a card-primitive hover on page-section shells reads as jank.

- `app/globals.css` @ 2607-2666 (.kcard/.card/.kblock shared rule + :hover + ::before) — hover lift + rail on every alias including big shells
- `components/analysis/KpiStrip.tsx` @ line 58 (div.kblock) — full-width shell that now lifts on hover

**Fix:**
Scope the hover affordance to real cards. Either (a) only `.kargah .kcard:hover` and `.kargah .card:hover` get transform:translateY(-2px) + the rail, while `.kargah .kblock:hover` gets at most the shadow bump (no transform, no rail); or (b) suppress when nested: `.kargah .kblock .kblock:hover, .kargah .kblock .card:hover, .kargah .card .card:hover { transform:none; box-shadow:var(--sh-1); }` and drop the ::before rail for .kblock. Keep the static ::after top bar on all of them.

**Risk:** Low; removing motion only. Verify hover over the orders table / dashboard sections no longer shifts layout and small product/pocket cards still lift.

### [NEW] image-1 body-inset fix applied to only some .kblock consumers - KpiStrip and ActionCenter still bleed to the card edge

**Root cause:** The redesign added `.kargah .kblock__body { padding: 0 24px 20px }` (app/globals.css:2658) and wrapped DemandTable, ChurnList, LearnedCapacity, MarginTable and the dashboard سلامت مشتری block in it. But KpiStrip.tsx:58 and ActionCenter.tsx:27 - both prominent on the merged /sales/dashboard under تحلیل عمیق - still put their grid/<p> as a direct child of .kblock with no .kblock__body. Their content starts at the card's physical edge while the sibling .bhead and neighbouring wrapped blocks are inset 24px, producing exactly the ragged left edge section 7.4 set out to remove. On main every .kblock body was flush, so this is a consistency regression introduced by the partial migration.

- `components/analysis/KpiStrip.tsx` @ line 58-61 (kblock > bhead > grid) — grid not wrapped in kblock__body
- `components/analysis/ActionCenter.tsx` @ line 27-35 (kblock > bhead > p/grid) — body not wrapped in kblock__body

**Fix:**
In KpiStrip.tsx wrap the `<div className="grid grid-cols-2 ...">` in `<div className="kblock__body">`. In ActionCenter.tsx wrap both the empty-state <p> and the `<div className="grid ...">` branch in one `<div className="kblock__body">`. Same one-line change the other analysis components already got.

**Risk:** Adds 24px side padding; verify the KPI card grid still fits 4 columns at the lg breakpoint inside the narrower body.

### [NEW] Stagger component and its .stag CSS shipped but never wired to any list

**Root cause:** components/kargah/Stagger.tsx is new and exported, and app/globals.css:1781-1789 defines `.kargah .stag` / `.stag-in` (+ reduced-motion guard), but grep finds zero imports of Stagger under app/ or components/. Spec section 10 required it on .pockets, .ptiles, .plist and the merged-analysis table body. Result: the client-side filter/search stagger-in does not happen, and there is dead CSS + an unused client component in the bundle. No existing behaviour lost - unfinished slice.

- `components/kargah/Stagger.tsx` @ whole file — created, never imported
- `app/globals.css` @ 1781-1789 (.kargah .stag / .stag-in) — dead selectors

**Fix:**
Either wire it - in the client list components that own a filter/search (ProductsView .ptiles/.plist, pocket lists .pockets) render mapped children through `<Stagger className={existingGridClass}>...</Stagger>` - or delete Stagger.tsx and the .stag/.stag-in blocks. Also note count-up was only wired to the 5 GradientStat tiles on the dashboard; BentoTile / BentoGauge numbers in components/BentoStrip.tsx did not get useCountUp as section 10 specified - decide in or out consistently.

**Risk:** If wiring: Stagger adds a wrapper <div> and uses key={i} on children - confirm list reorders (sort) do not cause key-collision flicker; pass the grid/flex class through so layout is unchanged.

### [NEW] Top-bar ::after extended to .gcard and .face beyond the spec - hard accent line over mesh stat cards, and a bar that duplicates the pocket .pill

**Root cause:** app/globals.css:2623-2637 lists `.kargah .gcard::after` and `.kargah .face::after` in the top-bar selector group. Spec 7.2 scoped the bar to .kcard (data-tone only on orders/cheques/deliveries/tasks/runs/payments) and 7.1 said .gcard only inherits border + hover. Effects: (1) a 3px linear-gradient(90deg,var(--accent),var(--accent-2),var(--tint-plum)) strip now cuts across the soft peach/mint/sand mesh of every dashboard .gcard, clashing with that card's aesthetic; (2) on .face the bar duplicates the .pill status word in .foot, and PocketCard.tsx:16 only maps done->good / conf->info, so a draft pocket has data-tone undefined and falls through to the default accent-gradient bar - the least-settled state gets the most active-looking bar.

- `app/globals.css` @ 2623-2637 (::after selector list incl. .gcard::after, .face::after) — bar applied to card types the spec excluded/did not require
- `components/kargah/PocketCard.tsx` @ line 16-19 (STATUS_TONE map) — draft has no tone -> default gradient bar

**Fix:**
Drop `.kargah .gcard::after` and `.kargah .face::after` from the selector list so the mesh stat cards and frosted pocket faces keep a clean top edge. If the pocket bar is wanted, instead add `draft: "warn"` (or a neutral tone) to STATUS_TONE so all three states are explicit and none inherits the accent-gradient default.

**Risk:** Cosmetic only. Verify /sales/dashboard gcards and /sales/pocket faces after removal; if the pocket bar is kept, just complete the tone map.

### [REGRESSION] New group-nav row wraps to multiple lines instead of scrolling; loses the old single-row overflow-x behaviour

**Root cause:** TabPill was rewritten (components/kargah/TabPill.tsx) into a .seg-groups row + a per-group .seg row. The old single .seg row had overflow-x:auto; scrollbar-width:none so 26 tabs stayed one scrollable line. The new `.kargah .seg-groups` rule (app/globals.css ~branch line 384) is display:flex; flex-wrap:wrap; gap:4px with no overflow handling. On a narrow laptop / zoomed view the six long Persian labels wrap onto two rows, making the nav taller and pushing content down; the wrap point also shifts as the webfont loads. Minor: the active group <Link> uses aria-current="true" where aria-current="page" is conventional for a nav location. Keyboard/tab order, the به‌زودی disabled span, and longest-prefix deep-link matching are all preserved (lib/salesNav.ts activeSalesGroup + TabPill visibleTabs filter).

- `app/globals.css` @ .kargah .seg-groups rule (~branch line 384-397) — flex-wrap:wrap, no overflow-x scroll
- `components/kargah/TabPill.tsx` @ lines 82-95 (seg-groups nav render, aria-current) — group links; aria-current=true

**Fix:**
Make the group row behave like the old tab row: `.kargah .seg-groups { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }` plus `.kargah .seg-groups::-webkit-scrollbar { display:none; }`. Optionally change the group <Link> to `aria-current={g.id === activeGroup ? "page" : undefined}`.

**Risk:** Low. Verify the group row stays one line at 1024px and scrolls horizontally on touch; confirm the active-group background is still visible after scroll.

### [REGRESSION] FaNum numeral fonts (--font-num and every picker *-num face) are unreachable inside .kargah - figures render in the proportional UI font

**Root cause:** app/globals.css:1596-1597 keep `--fa: var(--font-fa)` / `--en: var(--font-en)`, and the new alias block points --font-fa and --font-en at --font-ui. Every figure rule in the کارگاه uses var(--en) - .face .amt, .doc .dv, .ptile__price, .gcard .v, .kpi, .mini .v, .day, .stcard__stat .v - so they now resolve to --font-ui (Peyda), and --font-num (PeydaFaNum, the tabular Farsi-numeral face) plus the picker's --font-yekan-num / --font-sansx-num / --font-iran-num are never consumed by any .kargah rule. Consequences: (1) the numeral half of the font picker does nothing - choosing IRANYekanX/IRANSansX swaps body text to a Regular-only .ttf (faux-bold for every 600/700/800 heading) and never applies the paired Bold FaNum digits; (2) figures lost the dedicated numeral face they had on main (Plus Jakarta Sans via --font-en). Spec 4.2's token table says --font-num is for figures/amounts/KPIs and section 12 says numbers stay tabular, so the --font-en -> --font-ui alias line contradicts the spec's intent.

- `app/globals.css` @ diff hunk lines 14-17 (--font-en/--font-fa aliases) and 1596-1597 (--fa/--en) — figures routed to --font-ui, FaNum faces orphaned
- `app/fonts.ts` @ uiNum / yekanNum / sansxNum / iranNum exports — declared, variable injected, never referenced by CSS

**Fix:**
Point the numeral alias at the numeral token: change `--font-en: var(--font-ui)` to `--font-en: var(--font-num)` in the alias block (keep --font-fa: var(--font-ui)), or redefine `.kargah { --en: var(--font-num), system-ui, sans-serif; }`. The :root[data-font=yekan|sans|iran] blocks already remap --font-num to the matching *-num face, so this wires the picker's numeral choice through automatically and restores a tabular numeral face for amounts/KPIs.

**Risk:** Changes the typeface of every amount/figure in /sales. Verify amounts stay tabular-aligned (PeydaFaNum has tabular figures), digits render as Persian numerals, and check the KPI tiles, pocket amounts, calendar day numbers and stock gauges.
