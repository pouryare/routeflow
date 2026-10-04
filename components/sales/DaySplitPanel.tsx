"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import CollapsibleSection from "@/components/CollapsibleSection";
import { useToast } from "@/components/ToastProvider";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { planDaySplit, type DayLimit } from "@/lib/dayCapacity";
import type { PlannableOrder, PlannedDay } from "@/lib/repo/dayPlan";

export interface DaySplitPanelProps {
  orders: PlannableOrder[];
  plannedDays: PlannedDay[];
  /** The depot, when there is one. Sorting and labelling both fall back gracefully without it. */
  origin: { lat: number; lng: number } | null;
  /** Who can drive a new day. A day with no driver is not a day, so committing one needs this. */
  drivers?: Array<{ id: number; display_name: string }>;
}

/** One day the split proposed, in the order it will be shown. `day` is blank for a day that does
 *  not exist yet — creating it is a separate, explicit act, not a side effect of looking.
 *
 *  `runId` is what tells the two kinds apart at commit time: set means "load this run", null
 *  means "make one first", and only the second needs a driver and a date. */
interface ProposedLane {
  key: string;
  dayLabel: string;
  driverName: string | null;
  existing: boolean;
  runId: number | null;
  orderIds: string[];
  used: number;
  limit: DayLimit;
  /** The day and driver chosen for a NEW day. Blank until the manager picks both. */
  driverId: number | null;
  isoDay: string;
}

/** Suggests a day plan for the confirmed orders that are not on a run yet.
 *
 *  Mirrors `RouteSection`'s shape on /leads on purpose: a per-day cap, one «پیشنهاد بده» button,
 *  editable lanes, a close button. Two screens doing the same job should look the same, and the
 *  clustering underneath is literally the same function.
 *
 *  All the deciding happens in `planDaySplit`, a pure module with its own tests. This component
 *  renders the answer and lets the manager move cards between lanes. */
export default function DaySplitPanel({ orders, plannedDays, origin, drivers = [] }: DaySplitPanelProps) {
  const [stopsPerDay, setStopsPerDay] = useState(8);
  const [lanes, setLanes] = useState<ProposedLane[] | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
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
          runId: existing.runId,
          orderIds: f.orderIds,
          used: existing.used,
          limit: existing.limit,
          driverId: null,
          isoDay: f.day,
        };
      }),
      ...plan.newDays.map((d, i) => ({
        key: `new-${i}`,
        dayLabel: `روز ${faNum(i + 1)} (پیشنهادی)`,
        driverName: null,
        existing: false,
        runId: null,
        orderIds: d.orderIds,
        used: 0,
        limit: { stops: stopsPerDay },
        driverId: null,
        // Blank, NOT today's date: a proposal that silently books tomorrow is worse than one that
        // asks. The manager picks the day, and the picker refuses a date in the past.
        isoDay: "",
      })),
    ]);
  }

  /** Patches one lane's driver or date. Immutable and keyed, so the other lanes keep their
   *  identity and the drag handlers bound to them are not torn down mid-gesture. */
  function pick(key: string, patch: { driverId?: number | null; isoDay?: string }) {
    setLanes((prev) =>
      prev ? prev.map((l) => (l.key === key ? { ...l, ...patch } : l)) : prev,
    );
  }

  /** A new day cannot be committed without both a driver and a date — `createRun` requires them,
   *  and a UNIQUE(driver, date) means picking silently would collide with a run they cannot see.
   *  The button says which is missing rather than failing on submit. */
  const incomplete = lanes?.filter((l) => !l.existing && (!l.driverId || !l.isoDay)) ?? [];
  const canCommit = lanes != null && lanes.length > 0 && incomplete.length === 0 && !busy;

  /** Sends the whole proposal at once. The lanes arrive already grouped by the manager's own
   *  dragging, so nothing here re-decides which order belongs to which day — a second guess would
   *  be a second source of truth that could disagree with what is on screen. */
  async function commit() {
    if (!lanes || !canCommit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sales/runs/commit-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lanes: lanes.map((l) => ({
            runId: l.runId,
            driverUserId: l.driverId,
            day: l.isoDay,
            orderIds: l.orderIds.map((id) => Number(id)).filter((n) => Number.isInteger(n) && n > 0),
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json.error ?? "ثبت روزها انجام نشد", "error");
        return;
      }
      /* The refusals come back as part of a SUCCESS. A plan of thirty where two sat on a frozen
         route did as well as it could, and the manager needs to know which two to move by hand. */
      if (Array.isArray(json.refused) && json.refused.length > 0) {
        toast(
          `${faNum(json.addedStops ?? 0)} سفارش ثبت شد، ${faNum(json.refused.length)} رد شد`,
          "error",
        );
      } else {
        const created = json.createdRuns > 0 ? ` و ${faNum(json.createdRuns)} مسیر جدید` : "";
        toast(`${faNum(json.addedStops ?? 0)} سفارش ثبت شد${created}`, "success");
      }
      setLanes(null);
      router.refresh();
    } catch {
      toast("ثبت روزها انجام نشد", "error");
    } finally {
      setBusy(false);
    }
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
            <>
              <button
                onClick={commit}
                disabled={!canCommit}
                className="rounded-[var(--radius-sm)] border border-accent bg-accent px-2 py-1 text-[length:var(--text-xs)] text-accent-ink disabled:opacity-40"
              >
                <Icon name="check" size="sm" />
                {busy ? "در حال ثبت…" : `ثبت روزها (${faNum(placedCount)})`}
              </button>
              <button
                onClick={() => setLanes(null)}
                className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
              >
                <Icon name="x" size="sm" />
                بستن پیشنهاد
              </button>
            </>
          )}
          {/* Says what is missing instead of letting the commit fail on submit. */}
          {incomplete.length > 0 && (
            <span className="text-[length:var(--text-xs)] text-warn">
              برای {faNum(incomplete.length)} روزِ جدید، راننده و تاریخ را انتخاب کنید.
            </span>
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
            drivers={drivers}
            onPick={pick}
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
  drivers,
  onPick,
}: {
  lane: ProposedLane;
  lanes: ProposedLane[];
  byId: Map<string, PlannableOrder>;
  dragging: { id: string; from: string } | null;
  setDragging: (v: { id: string; from: string } | null) => void;
  move: (orderId: string, toLane: string) => void;
  drivers: Array<{ id: number; display_name: string }>;
  /** Patches one lane. Immutably, and keyed by lane — the other lanes must not be rebuilt. */
  onPick: (key: string, patch: { driverId?: number | null; isoDay?: string }) => void;
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
          /* A new day needs a driver AND a date before it can be committed, so both live on the
             lane rather than in a dialog. Inline means the manager can see which day is still
             unresolved while fixing them, instead of finding out one submit at a time. */
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={lane.driverId ?? ""}
              onChange={(e) =>
                onPick(lane.key, { driverId: e.target.value ? Number(e.target.value) : null })
              }
              aria-label="رانندهٔ این روز"
              className="rounded-[var(--radius-sm)] border border-border bg-bg px-1.5 py-0.5 text-[length:var(--text-xs)] text-text"
            >
              <option value="">راننده…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.display_name}
                </option>
              ))}
            </select>
            <JalaliDateInput
              value={lane.isoDay}
              onChange={(iso) => onPick(lane.key, { isoDay: iso })}
              aria-label="تاریخ این روز"
              className="w-40"
            />
          </div>
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
