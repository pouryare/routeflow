"use client";

// The runs board: real runs above, MY drafts below, map beside the drafts.
//
// Four decisions in here, each of which looks like a detail and is not:
//
//  1. «پیش‌نویس‌های من» — the "my" is the WHOLE privacy signal. No icon, no tooltip, no
//     explanation. First person is unambiguous on its own, and the sentence underneath it
//     («تا وقتی نسازی، هیچ‌کس جز تو این‌ها را نمی‌بیند») exists only to say WHEN the
//     privacy ends: at «سفر را قطعی کن». The heading cannot say that on its own.
//
//  2. Real runs get NO chip. Labelling the normal case makes the other state look like the
//     deviation. A real run speaks only about itself — «در حال اجرا», «آماده» — which is a
//     different fact entirely.
//
//  3. There is NO global commit button. Each lane commits itself, or does not. A single
//     "commit everything" control means there is something to forget, and a draft arranged
//     for twenty minutes and never committed is a draft you did not do.
//
//  4. The map is BESIDE the drafts, not below them. Geography is the entire reasoning
//     behind splitting a day — you are deciding whether five shops are one loop — so the
//     thing you judge with and the thing you are judging must share a glance. Stacked, you
//     scroll away from the lanes to use the map, and the two never inform each other.

import { useCallback, useRef } from "react";
import SectionHead from "@/components/meridian/SectionHead";
import { useCardDrag, type CardDrag } from "@/components/board/useCardDrag";
import { Icon } from "@/components/meridian/Icon";
import type { RunDraft } from "@/lib/repo/runDrafts";

export interface PoolOrder {
  id: number;
  label: string;
  sub?: string | null;
  kg?: number | null;
}

export interface RealRunLane {
  id: number;
  date: string;
  driverName: string | null;
  kg: number;
  stops: number;
  status: string;
}

export interface DayLaneBoardProps {
  pool: PoolOrder[];
  drafts: RunDraft[];
  runs: RealRunLane[];
  /** "pool" or a draft id — where a card currently sits. */
  laneOf: (orderId: number) => string;
  onDropOrder: (orderId: number, toLane: string) => void;
  /** Per-lane, present only when the lane has both a driver and a date. */
  onCommit?: (draftId: number) => void;
  onSelectDraft?: (draftId: number) => void;
  /** Rendered beside the drafts. The caller owns the map; this file owns the layout. */
  map?: React.ReactNode;
}

function setLane(
  refs: React.MutableRefObject<Map<string, HTMLElement>>,
  id: string,
  el: HTMLElement | null
): void {
  if (el) refs.current.set(id, el);
  else refs.current.delete(id);
}

const idOf = (o: PoolOrder) => o.id;

/** Can this lane be made real, and what does its button say if not?
 *
 *  Extracted as a pure function because the wording is the design, and wording is exactly
 *  the thing a render test checks least reliably. The disabled state names the NEXT ACTION
 *  («اول راننده و تاریخ را انتخاب کن») rather than counting what is missing
 *  («دو خانهٔ خالی مانده») — one describes the problem, the other tells you what to do.
 *
 *  Also the definition of "ready": BOTH a driver and a date. A driver alone is not a day. */
export function commitState(d: {
  driver_user_id?: number | null;
  run_date?: string | null;
}): { enabled: boolean; label: string } {
  const hasDriver = d.driver_user_id != null;
  const hasDate = d.run_date != null && d.run_date !== "";
  if (hasDriver && hasDate) return { enabled: true, label: "سفر را قطعی کن" };
  return { enabled: false, label: "اول راننده و تاریخ را انتخاب کن" };
}
export default function DayLaneBoard({
  pool,
  drafts,
  runs,
  laneOf,
  onDropOrder,
  onCommit,
  onSelectDraft,
  map,
}: DayLaneBoardProps) {
  const laneEls = useRef(new Map<string, HTMLElement>());

  const resolveLane = useCallback((x: number, y: number): string | null => {
    for (const [id, el] of laneEls.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  }, []);

  const drag = useCardDrag<PoolOrder>({
    resolveLane,
    // Dropping into the pool means taking it OUT of a lane, not adding a second copy.
    onDrop: (item, _from, to) => onDropOrder(idOf(item), to),
  });

  return (
    <div className="flex flex-col gap-5">
      {/* ── Real runs. No «واقعی» chip anywhere on these. ── */}
      {runs.length > 0 && (
        <section>
          <h2 className="sechead__title mb-2">بار مسیرها</h2>
          <div className="flex flex-col gap-2">
            {runs.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-3"
              >
                <span className="text-[length:var(--text-sm)] text-text">{r.date}</span>
                <span className="text-[length:var(--text-xs)] text-text-muted">
                  {r.driverName ?? "—"}
                </span>
                {/* Kilograms, because a van fills by weight. The old timeline summed toman,
                    which is money, on the one graphic built to compare loads. */}
                <span className="font-mono text-[length:var(--text-xs)] text-text-muted">
                  {r.kg.toLocaleString("fa-IR")} ک.م
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── My drafts, and the map beside them. ── */}
      <section>
        <h2 className="sechead__title mb-1">پیش‌نویس‌های من</h2>
        {/* The heading cannot say when the privacy ENDS, so this one sentence does. */}
        <p className="mb-2 flex items-center gap-1.5 text-[length:var(--text-xs)] text-text-faint">
          <Icon name="info" size="sm" />
          تا وقتی نسازی، هیچ‌کس جز تو این‌ها را نمی‌بیند.
        </p>

        <div className="flex gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {drafts.length === 0 ? (
              // A draft lane cannot be created empty: it comes into being on the first
              // order you drop. So this is an instruction, not a missing feature.
              <p className="rounded-[var(--radius-lg)] border border-dashed border-border p-4 text-[length:var(--text-sm)] text-text-muted">
                یک سفارش را از استخر به اینجا بکشید تا پیش‌نویس ساخته شود.
              </p>
            ) : (
              drafts.map((d) => (
                <DraftLane
                  key={d.id}
                  draft={d}
                  pool={pool}
                  laneOf={laneOf}
                  laneRefs={laneEls}
                  bind={drag.bind}
                  hoverLane={drag.hoverLane}
                  onCommit={onCommit}
                  onSelect={onSelectDraft}
                />
              ))
            )}

            <div>
              <SectionHead
                as="h3"
                title="استخر سفارش‌ها"
                sub={`${pool.length.toLocaleString("fa-IR")} سفارش آزاد`}
              />
              <div
                ref={(el) => setLane(laneEls, "pool", el)}
                className={`flex flex-wrap gap-1.5 rounded-[var(--radius-lg)] border p-2 ${
                  drag.hoverLane === "pool" ? "border-accent bg-accent/5" : "border-border"
                }`}
              >
                {pool.length === 0 ? (
                  // Empty is a STATUS, not an apology. «سفارشی یافت نشد» makes Tuesday's
                  // finished work read as a failure.
                  <p className="px-1 py-1.5 text-[length:var(--text-xs)] text-text-muted">
                    همه چیز تقسیم شده است.
                  </p>
                ) : (
                  pool.map((o) => (
                    <PoolCard
                      key={o.id}
                      order={o}
                      from={laneOf(o.id)}
                      bind={drag.bind}
                      suppressClick={drag.isSuppressed}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Beside, not below. */}
          {map && <div className="w-[38%] shrink-0">{map}</div>}
        </div>
      </section>

      {/* The ghost, fixed to the viewport so it tracks the pointer out of any lane. */}
      {drag.drag && (
        <div
          className="pointer-events-none fixed z-50 opacity-90"
          style={{
            left: drag.drag.x - drag.drag.dx,
            top: drag.drag.y - drag.drag.dy,
            width: drag.drag.width,
          }}
        >
          <PoolCardBody order={drag.drag.item} />
        </div>
      )}
    </div>
  );
}

function DraftLane({
  draft,
  pool,
  laneOf,
  laneRefs,
  bind,
  hoverLane,
  onCommit,
  onSelect,
}: {
  draft: RunDraft;
  pool: PoolOrder[];
  laneOf: (orderId: number) => string;
  laneRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  bind: CardDrag<PoolOrder>["bind"];
  hoverLane: string | null;
  onCommit?: (draftId: number) => void;
  onSelect?: (draftId: number) => void;
}) {
  const laneId = `draft-${draft.id}`;
  const commit = commitState(draft);
  const cards = pool.filter((o) => laneOf(o.id) === laneId);

  return (
    <div
      ref={(el) => setLane(laneRefs, laneId, el)}
      onClick={() => onSelect?.(draft.id)}
      className={`rounded-[var(--radius-lg)] border border-dashed p-3 ${
        hoverLane === laneId ? "border-accent bg-accent/5" : "border-border"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[length:var(--text-sm)] text-text">{draft.run_date ?? "بدون تاریخ"}</span>
        <span className="text-[length:var(--text-xs)] text-text-muted">
          {draft.driver_name ?? "بدون راننده"}
        </span>
        <span className="font-mono text-[length:var(--text-xs)] text-text-faint">
          {cards.length} سفارش
        </span>

        <div className="ms-auto">
          {/* The NEXT ACTION when it cannot be committed, not a count of what is wrong.
              «دو خانهٔ خالی مانده» describes the problem; this names the fix. */}
          <button
            type="button"
            disabled={!commit.enabled || !onCommit}
            onClick={() => onCommit?.(draft.id)}
            className={
              commit.enabled
                ? "rounded-[var(--radius-sm)] border border-accent bg-accent px-2.5 py-1 text-[length:var(--text-xs)] text-accent-ink transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:opacity-90 disabled:opacity-60"
                : "cursor-not-allowed rounded-[var(--radius-sm)] border border-border px-2.5 py-1 text-[length:var(--text-xs)] text-text-faint"
            }
          >
            {/* A check, because that is the whole verb: قطعی کن means "make it final". It also
                carries the disabled state honestly — grey check, not a grey tick that looks
                pressable. */}
            <Icon name="check" size="sm" /> {commit.label}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {cards.length === 0 && <p className="text-[length:var(--text-xs)] text-text-faint">خالی</p>}
        {cards.map((o) => (
          <PoolCard key={o.id} order={o} from={laneId} bind={bind} suppressClick={() => false} />
        ))}
      </div>
    </div>
  );
}

function PoolCard({
  order,
  from,
  bind,
  suppressClick,
}: {
  order: PoolOrder;
  from: string;
  bind: CardDrag<PoolOrder>["bind"];
  suppressClick: () => boolean;
}) {
  return (
    <div
      {...bind(order, from)}
      onClick={() => {
        // A tap that ended a drag must not also fire the click, or dropping a card would
        // also fire whatever it landed on.
        if (suppressClick()) return;
      }}
      className="cursor-grab touch-none select-none rounded-[var(--radius-md)] border border-border bg-surface px-2 py-1.5 active:cursor-grabbing"
    >
      <PoolCardBody order={order} />
    </div>
  );
}

function PoolCardBody({ order }: { order: PoolOrder }) {
  return (
    <>
      <div className="text-[length:var(--text-xs)] text-text">{order.label}</div>
      {order.sub && <div className="text-[length:var(--text-xs)] text-text-faint">{order.sub}</div>}
      {order.kg != null && (
        <div className="font-mono text-[length:var(--text-xs)] text-text-muted">
          {order.kg.toLocaleString("fa-IR")} ک.م
        </div>
      )}
    </>
  );
}