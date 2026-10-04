"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useCardDrag } from "@/components/board/useCardDrag";
import { useToast } from "@/components/ToastProvider";
import SectionHead from "@/components/meridian/SectionHead";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { LeadPoint } from "@/components/LeadsMap";

/* Leaflet reaches for `window` while the module graph is evaluated, so it cannot be in a server
   render. The leads page does this for the same reason; duplicated rather than extracted,
   because a shared wrapper for one call site is a layer with nothing in it. */
const LeadsMap = dynamic(() => import("@/components/LeadsMap"), { ssr: false });

export interface BoardOrder {
  id: number;
  order_no: string;
  customer_name: string;
  total_toman: number;
  order_date: string;
  group_id: number | null;
  lat: number | null;
  lng: number | null;
  /** The day the customer asked for, or null for «در اولین فرصت». */
  requested_day: string | null;
}

export interface BoardRun {
  id: number;
  run_date: string;
  status: string;
  driver_user_id: number;
  driver_name: string;
  stop_count: number;
  remaining: number;
  /* Each stop carries its own label and position rather than an order id to look up. The pool
     query deliberately EXCLUDES orders already on a run, so a lookup against it would render
     every existing lane empty — and an empty lane looks like an empty van. */
  stops: Array<{
    id: number;
    order_no: string;
    customer_name: string;
    lat: number | null;
    lng: number | null;
  }>;
}

export interface OrderRouteBoardProps {
  runs: BoardRun[];
  orders: BoardOrder[];
  navigateHref: (order: BoardOrder) => string;
}

/** Lane ids are strings because `useCardDrag` carries them off a DOM attribute, and the pool is
 *  not a run — it has no id. */
const POOL = "__pool";

const runIdFromLane = (lane: string): number | null =>
  lane.startsWith("run-") ? Number(lane.slice(4)) : null;

/** «مسیرها» — the pool on one side, one lane per open run on the other, and a map underneath.
 *
 *  Replaces the hand-rolled drag that used to live in AssignmentBoard with the shared
 *  `useCardDrag` engine the leads page already uses. That hook is board-agnostic — it asks for a
 *  lane id and what a drop means — and carries the two details that are easy to get wrong by
 *  hand: a travel threshold, so a still finger is a tap and not a drag, and `elementFromPoint`
 *  on every move, so a lane that reflows mid-gesture is still the lane under the pointer.
 *
 *  Lanes are driver-DAY pairs, not drivers. A driver's load is a property of one day; keying on
 *  the driver alone would show Tuesday's work on Wednesday's lane, which is worse than showing
 *  nothing because it looks authoritative. */
export default function OrderRouteBoard({ runs, orders, navigateHref }: OrderRouteBoardProps) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const openRuns = useMemo(() => runs.filter((r) => r.status !== "done"), [runs]);
  const ordersById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  /** Puts an order on a run. A drop back onto the pool is refused rather than faked. */
  const move = useCallback(
    async (orderId: number, toRunId: number | null) => {
      setBusy(true);
      try {
        /* No remove endpoint exists for a single stop — `deleteRun` takes the whole route. So the
           pool says so, rather than offering a gesture that cannot work. */
        if (toRunId == null) {
          toast("برای برداشتن یک سفارش، آن را روی مسیر دیگری بکشید.", "error");
          return;
        }
        const res = await fetch(`/api/sales/runs/${toRunId}/stops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: orderId }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast(json.error ?? "افزودن به مسیر انجام نشد", "error");
          return;
        }
        const order = ordersById.get(orderId);
        toast(`سفارش ${order?.order_no ?? orderId} به مسیر اضافه شد`, "success");
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [ordersById, router, toast],
  );

  const { drag, hoverLane, isSuppressed, bind } = useCardDrag<number>({
    /* `closest`, not a cached rect per lane: a lane can scroll or reflow mid-drag, and a cached
       rectangle would point at where the lane used to be. */
    resolveLane: (x, y) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-lane]")?.dataset.lane ?? null,
    onDrop: (orderId, _from, toLane) => {
      if (isSuppressed()) return;
      void move(orderId, runIdFromLane(toLane));
    },
  });

  /* The map reads the SAME lists the lanes render, so the pins and the cards are one fact shown
     twice. An order with no coordinates is not plotted rather than pinned at (0,0) — the leads
     page has the same rule, and a marker in the Gulf is worse than no marker. */
  const mapPoints = useMemo<LeadPoint[]>(
    () =>
      orders
        .filter((o) => o.lat != null && o.lng != null)
        .map((o) => ({
          id: o.id,
          name: `${o.order_no} — ${o.customer_name}`,
          address: null,
          lat: o.lat!,
          lng: o.lng!,
          runIndex: null,
          km: null,
          statusLabel: o.requested_day ? faJalaliDate(o.requested_day) : "در اولین فرصت",
        })),
    [orders],
  );

  const runPoints = useMemo<[number, number][]>(() => {
    const out: [number, number][] = [];
    for (const run of openRuns) {
      for (const stop of run.stops) {
        if (stop.lat != null && stop.lng != null) out.push([stop.lat, stop.lng]);
      }
    }
    return out;
  }, [openRuns]);
  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* ---- The pool ---- */}
        <section
          aria-labelledby="route-pool"
          className="rounded-[var(--radius-xl)] border border-border bg-surface p-[var(--space-4)]"
        >
          <SectionHead
            id="route-pool"
            title="سفارش‌های بدون مسیر"
            sub={`${faNum(orders.length)} سفارش · بکشید و روی یک مسیر رها کنید.`}
          />

          {orders.length === 0 ? (
            <p className="m-0 text-[length:var(--text-sm)] text-text-muted">
              همهٔ سفارش‌های تأییدشده روی مسیر هستند.
            </p>
          ) : (
            <ul data-lane={POOL} className="flex flex-col gap-2">
              {orders.map((o) => (
                <li
                  key={o.id}
                  data-card
                  {...bind(o.id, POOL)}
                  onClick={() => {
                    if (isSuppressed()) return;
                    setSelectedId(o.id);
                  }}
                  className="cursor-grab touch-none rounded-[var(--radius-md)] border border-border bg-bg px-3 py-2 hover:border-accent"
                >
                  <span className="block text-[length:var(--text-sm)] text-text">{o.order_no}</span>
                  <span className="block text-[length:var(--text-xs)] text-text-muted">
                    {o.customer_name}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-[length:var(--text-xs)]">
                    <span className="text-text-muted">{faToman(o.total_toman)}</span>
                    {/* «در اولین فرصت» is the ABSENCE of a day, so there is no flag to read here —
                        the label is what tells the manager this one is free to move anywhere. */}
                    {o.requested_day ? (
                      <span className="text-accent">{faJalaliDate(o.requested_day)}</span>
                    ) : (
                      <span className="text-text-muted">در اولین فرصت</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {/* ---- One lane per open run ---- */}
        <section className="flex flex-col gap-3">
          {openRuns.length === 0 ? (
            <p className="m-0 rounded-[var(--radius-xl)] border border-border bg-surface p-[var(--space-4)] text-[length:var(--text-sm)] text-text-muted">
              مسیر بازی وجود ندارد. از بخش تقسیم روزها یک روز بسازید.
            </p>
          ) : (
            openRuns.map((run) => {
              const lane = `run-${run.id}`;
              return (
                <article
                  key={run.id}
                  data-lane={lane}
                  className={`rounded-[var(--radius-xl)] border bg-surface p-[var(--space-4)] transition-colors ${
                    hoverLane === lane ? "border-accent" : "border-border"
                  }`}
                >
                  <SectionHead
                    as="h3"
                    title={run.driver_name}
                    sub={`${faJalaliDate(run.run_date)} · ${faNum(run.stop_count)} مقصد`}
                  />

                  {run.stops.length === 0 ? (
                    <p className="m-0 text-[length:var(--text-xs)] text-text-muted">
                      خالی — سفارش‌ها را اینجا رها کنید.
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {run.stops.map((s) => (
                        <li key={s.id} className="text-[length:var(--text-sm)] text-text">
                          {s.order_no} · {s.customer_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })
          )}
        </section>
      </div>
      {/* ---- The map ---- */}
      {mapPoints.length > 0 && (
        <section className="rounded-[var(--radius-xl)] border border-border bg-surface p-[var(--space-4)]">
          <SectionHead title="نقشهٔ مسیرها" />
          <LeadsMap
            leads={mapPoints}
            runPoints={runPoints}
            onAddToRun={(id) => {
              const first = openRuns[0];
              if (!first) {
                toast("اول باید یک مسیر باز بسازید.", "error");
                return;
              }
              void move(id, first.id);
            }}
            onRemoveFromRun={() => {
              /* Single-stop removal has no endpoint (see `move`). Saying so beats a control that
                 appears to work and does nothing. */
              toast("برای برداشتن، سفارش را روی مسیر دیگری بکشید.", "error");
            }}
            navigateHref={(point) => {
              const order = ordersById.get(point.id);
              return order ? navigateHref(order) : "/map";
            }}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </section>
      )}

      {/* The ghost sits exactly where the card was picked up, so the hand does not jump.
          pointer-events:none keeps it from occluding the lane being dropped on. */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 rounded-[var(--radius-md)] border border-accent bg-surface px-3 py-2 shadow-lg"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }}
        >
          <span className="text-[length:var(--text-sm)] text-text">
            {ordersById.get(drag.item)?.order_no}
          </span>
        </div>
      )}

      {busy && (
        <span className="sr-only" role="status">
          در حال ثبت…
        </span>
      )}
    </div>
  );
}