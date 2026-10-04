"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import CollapsibleSection from "@/components/CollapsibleSection";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { planDaySplit, type DayLimit } from "@/lib/dayCapacity";
import type { PlannableOrder, PlannedDay } from "@/lib/repo/dayPlan";

export interface DaySplitPanelProps {
  orders: PlannableOrder[];
  plannedDays: PlannedDay[];
  /** The depot, when there is one. Sorting and labelling both fall back gracefully without it. */
  origin: { lat: number; lng: number } | null;
}

/** One day the split proposed, in the order it will be shown. `day` is blank for a day that does
 *  not exist yet — creating it is a separate, explicit act, not a side effect of looking. */
interface ProposedLane {
  key: string;
  dayLabel: string;
  driverName: string | null;
  existing: boolean;
  orderIds: string[];
  used: number;
  limit: DayLimit;
}

/** Suggests a day plan for the confirmed orders that are not on a run yet.
 *
 *  Mirrors `RouteSection`'s shape on /leads on purpose: a per-day cap, one «پیشنهاد بده» button,
 *  editable lanes, a close button. Two screens doing the same job should look the same, and the
 *  clustering underneath is literally the same function.
 *
 *  All the deciding happens in `planDaySplit`, a pure module with its own tests. This component
 *  renders the answer and lets the manager move cards between lanes. */
export default function DaySplitPanel({ orders, plannedDays, origin }: DaySplitPanelProps) {
  const [stopsPerDay, setStopsPerDay] = useState(8);
  const [lanes, setLanes] = useState<ProposedLane[] | null>(null);
  const [dragging, setDragging] = useState<{ id: string; from: string } | null>(null);

  const pinned = useMemo(() => orders.filter((o) => o.requestedDay), [orders]);
  const free = useMemo(() => orders.filter((o) => !o.requestedDay), [orders]);
  const byId = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  /* One blocked order stops the whole proposal. Clustering needs a position, and a partial
     suggestion would show a day that quietly omits somebody's work. */
  const homeless = useMemo(
    () => orders.filter((o) => !o.requestedDay && (o.lat == null || o.lng == null)),
    [orders],
  );

  function propose() {
    if (homeless.length > 0 || free.length === 0) return;

    const plan = planDaySplit({
      free,
      pinned,
      existingDays: plannedDays.map((d) => ({ day: d.day, count: d.used, limit: d.limit })),
      limit: { stops: stopsPerDay },
      origin,
    });

    setLanes([
      ...plan.fill.map((f) => {
        const existing = plannedDays.find((d) => d.day === f.day)!;
        return {
          key: `fill-${f.day}`,
          dayLabel: faJalaliDate(f.day),
          driverName: existing.driverName,
          existing: true,
          orderIds: f.orderIds,
          used: existing.used,
          limit: existing.limit,
        };
      }),
      ...plan.newDays.map((d, i) => ({
        key: `new-${i}`,
        dayLabel: `روز ${faNum(i + 1)} (پیشنهادی)`,
        driverName: null,
        existing: false,
        orderIds: d.orderIds,
        used: 0,
        limit: { stops: stopsPerDay },
      })),
    ]);
  }

  /** Moves an order between lanes. `__pool` is how the manager takes one back out. */
  function move(orderId: string, toLane: string) {
    setLanes((prev) => {
      if (!prev) return prev;
      const from = prev.find((l) => l.orderIds.includes(orderId));
      if (!from || from.key === toLane) return prev;
      return prev.map((l) => {
        if (l.key === from.key) return { ...l, orderIds: l.orderIds.filter((id) => id !== orderId) };
        if (l.key === toLane) return { ...l, orderIds: [...l.orderIds, orderId] };
        return l;
      });
    });
  }

  const unplaced = lanes ? free.filter((o) => !lanes.some((l) => l.orderIds.includes(o.id))) : [];
  const placedCount = lanes ? lanes.reduce((n, l) => n + l.orderIds.length, 0) : 0;

  return (
    <CollapsibleSection title="تقسیم روزها" defaultOpen={false}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[length:var(--text-xs)] text-text-muted">
            تعداد مقصد در هر روز:
            <input
              type="number"
              min={2}
              max={50}
              value={stopsPerDay}
              onChange={(e) => setStopsPerDay(Math.max(2, Number(e.target.value) || 2))}
              className="w-16 rounded-[var(--radius-sm)] border border-border bg-bg px-1.5 py-1 text-center text-text outline-none focus:border-accent"
            />
          </label>
          <button
            onClick={propose}
            disabled={homeless.length > 0 || free.length === 0}
            className="rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent hover:bg-accent hover:text-accent-ink disabled:opacity-40"
          >
            <Icon name="calendar" size="sm" />
            پیشنهاد بده
          </button>
          {lanes && (
            <button
              onClick={() => setLanes(null)}
              className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
            >
              <Icon name="x" size="sm" />
              بستن پیشنهاد
            </button>
          )}
          {pinned.length > 0 && (
            <span className="text-[length:var(--text-xs)] text-text-faint">
              {faNum(pinned.length)} سفارش روزِ مشخص دارد و جابه‌جا نمی‌شود
            </span>
          )}
        </div>

        {/* Named, not swallowed. An order with no coordinates cannot be clustered, and the
            alternative — leaving it out of the suggestion — is how work disappears quietly. */}
        {homeless.length > 0 && (
          <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-warn/40 bg-warn/5 p-2.5">
            <Icon name="warn" size="sm" className="mt-0.5 shrink-0 text-warn" />
            <div className="text-[length:var(--text-xs)] text-text">
              <p>
                {faNum(homeless.length)} سفارش بدون موقعیت مکانی است، پس نمی‌توان روزها را پیشنهاد داد:
              </p>
              <p className="mt-1 text-text-muted">
                {homeless
                  .slice(0, 8)
                  .map((o) => `${o.orderNo} — ${o.customerName}`)
                  .join("، ")}
                {homeless.length > 8 ? "، …" : ""}
              </p>
              <p className="mt-1 text-text-faint">ابتدا موقعیت این مشتریان را در پروفایلشان ثبت کنید.</p>
            </div>
          </div>
        )}

        {lanes && lanes.length === 0 && homeless.length === 0 && (
          <p className="text-[length:var(--text-xs)] text-text-muted">
            همهٔ سفارش‌ها روی روزهای موجود جا شدند؛ روز تازه‌ای لازم نیست.
          </p>
        )}

        {lanes?.map((lane) => (
          <DayLane
            key={lane.key}
            lane={lane}
            lanes={lanes}
            byId={byId}
            dragging={dragging}
            setDragging={setDragging}
            move={move}
          />
        ))}

        {/* An order the manager took OUT of a lane must go somewhere visible, not vanish. */}
        {unplaced.length > 0 && (
          <div className="rounded-[var(--radius-md)] border border-dashed border-border p-2.5">
            <p className="mb-1.5 text-[length:var(--text-xs)] text-text-muted">
              بیرون از روزها ({faNum(unplaced.length)}):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {unplaced.map((o) => (
                <span
                  key={o.id}
                  className="rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[length:var(--text-xs)] text-text"
                >
                  {o.orderNo}
                </span>
              ))}
            </div>
          </div>
        )}

        {lanes && lanes.length > 0 && (
          <p className="text-[length:var(--text-xs)] text-text-faint">
            {faNum(placedCount)} از {faNum(free.length)} سفارش در روزها قرار گرفت.
            {unplaced.length > 0 &&
              ` ${faNum(unplaced.length)} سفارش بیرون مانده و باید دستی تعیین شود.`}
          </p>
        )}
      </div>
    </CollapsibleSection>
  );
}

/** One editable day. Split out so the lane's own markup — the drag handlers and the cap warning —
 *  reads on its own rather than as a wall inside a 200-line component. */
function DayLane({
  lane,
  lanes,
  byId,
  dragging,
  setDragging,
  move,
}: {
  lane: ProposedLane;
  lanes: ProposedLane[];
  byId: Map<string, PlannableOrder>;
  dragging: { id: string; from: string } | null;
  setDragging: (v: { id: string; from: string } | null) => void;
  move: (orderId: string, toLane: string) => void;
}) {
  const laneKg = lane.orderIds.reduce((n, id) => n + (byId.get(id)?.kg ?? 0), 0);
  const overStops = lane.limit.stops != null && lane.used + lane.orderIds.length > lane.limit.stops;

  return (
    <div
      data-day-lane={lane.key}
      className="rounded-[var(--radius-md)] border border-border bg-surface p-2.5"
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[length:var(--text-sm)] text-text">
          {lane.dayLabel}
          {lane.driverName && (
            <span className="ms-2 text-[length:var(--text-xs)] text-text-muted">{lane.driverName}</span>
          )}
          <span className="ms-2 text-[length:var(--text-xs)] text-text-faint">
            {faNum(lane.orderIds.length)} مقصد
            {lane.used > 0 && ` (${faNum(lane.used)} روی مسیر موجود)`}
            {laneKg > 0 && ` — ${faNum(Math.round(laneKg))} کیلو`}
          </span>
        </span>
        {!lane.existing && (
          <span className="rounded-[var(--radius-sm)] bg-accent/10 px-1.5 py-0.5 text-[length:var(--text-xs)] text-accent">
            روز تازه
          </span>
        )}
      </div>

      {overStops && (
        <p className="mb-1.5 text-[length:var(--text-xs)] text-crit">
          این روز از سقف {faNum(lane.limit.stops!)} مقصد بیشتر شده است.
        </p>
      )}

      {lane.orderIds.map((id) => {
        const o = byId.get(id);
        if (!o) return null;
        return (
          <div
            key={id}
            draggable
            onDragStart={() => setDragging({ id, from: lane.key })}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!dragging || dragging.id === id) return;
              move(dragging.id, lane.key);
            }}
            className="flex items-center gap-2 py-1"
          >
            <Icon name="grip-vertical" size="sm" className="shrink-0 text-text-faint" />
            <span className="flex-1 text-[length:var(--text-xs)] text-text">
              {o.orderNo} — {o.customerName}
            </span>
            <select
              value={lane.key}
              onChange={(e) => move(id, e.target.value)}
              className="rounded-[var(--radius-sm)] border border-border bg-bg px-1 py-0.5 text-[length:var(--text-xs)] text-text"
              aria-label={`انتقال ${o.orderNo} به روز دیگر`}
            >
              {lanes.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.dayLabel}
                </option>
              ))}
              <option value="__pool">بیرون روزها</option>
            </select>
            <button
              type="button"
              onClick={() => move(id, "__pool")}
              className="shrink-0 text-text-faint hover:text-crit"
              aria-label={`حذف ${o.orderNo} از روز`}
            >
              <Icon name="trash" size="sm" />
            </button>
          </div>
        );
      })}
      {lane.orderIds.length === 0 && (
        <p className="text-[length:var(--text-xs)] text-text-faint">خالی</p>
      )}
    </div>
  );
}
