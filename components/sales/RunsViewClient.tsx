"use client";

// The client half of ?view=runs: it owns draft MUTATIONS and the board's layout, and nothing
// else. The queries all happen on the server.
//
// The split exists for one specific reason: a draft is private to the person who made it, and
// that is a SERVER fact. The browser is handed this user's drafts and is trusted to have been
// given no one else's — so the filtering can never be a client-side check somebody forgets
// to write, and can never be a query a stale bundle happens to omit.

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DayLaneBoard, { type PoolOrder, type RealRunLane } from "@/components/sales/DayLaneBoard";
import type { RunDraft } from "@/lib/repo/runDrafts";
import type { PlannableOrder } from "@/lib/repo/dayPlan";

export default function RunsViewClient({
  drafts: initialDrafts,
  runs,
  plannable,
}: {
  drivers: { id: number; display_name: string }[];
  drafts: RunDraft[];
  runs: RealRunLane[];
  kgByRun: Record<number, number>;
  plannable: PlannableOrder[];
}) {
  const router = useRouter();
  const [drafts] = useState<RunDraft[]>(initialDrafts);

  /** lane id -> order ids, plus the inverse lookup the board needs for each card. */
  const byLane = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const d of drafts) {
      if (d.order_ids.length > 0) map.set(`draft-${d.id}`, d.order_ids);
    }
    return map;
  }, [drafts]);

  const laneOf = useCallback(
    (orderId: number): string => {
      for (const [lane, ids] of byLane) if (ids.includes(orderId)) return lane;
      return "pool";
    },
    [byLane]
  );

  const pool: PoolOrder[] = useMemo(
    () =>
      plannable
        .filter((o) => laneOf(o.orderId) === "pool")
        // `o.id` is a STRING inherited from SplitOrder; `orderId` is the real orders.id.
        // The board works in numbers throughout, so it uses orderId and never `id` -- using
        // the string would silently key every draft stop by the wrong column.
        .map((o) => ({
          id: o.orderId,
          label: o.customerName,
          sub: o.orderNo,
          kg: o.kg,
          // Everything the hover pane needs, mapped here rather than fetched per card: a
          // pane that fires a request shows nothing on a phone with no signal.
          detail: {
            orderNo: o.orderNo,
            customerName: o.customerName,
            kg: o.kg,
            totalToman: o.totalToman,
            paidToman: o.paidToman,
            paymentStatus: o.paymentStatus,
            notes: o.notes,
            phone: o.phone,
            lat: o.lat,
            lng: o.lng,
            // null for a stop with no predecessor: the pool is not a route, so there is no
            // "previous stop" to measure from and a 0 km would be a lie.
            legKm: null,
          },
        })),
    [plannable, laneOf]
  );

  const post = useCallback(
    async (url: string, body: unknown) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      router.refresh();
    },
    [router]
  );

  /** A drop into the pool takes the order OUT; a drop into a lane needs a lane to exist.
   *
   *  A lane is never created empty — it comes into being on the first order. So dropping
   *  into "draft-new" means: if this user's board has no lane with no orders, adopt the
   *  draft that the button already made. That is why there is no "+ new day" control
   *  anywhere: an empty lane has nothing to show and nothing to decide. */
  const onDropOrder = useCallback(
    (orderId: number, toLane: string) => {
      if (toLane === "pool") {
        void post("/api/runs/drafts/move", { orderId, draftId: null });
        return;
      }
      void post("/api/runs/drafts/move", { orderId, draftId: Number(toLane.replace("draft-", "")) });
    },
    [post]
  );

  return (
    <DayLaneBoard
      pool={pool}
      drafts={drafts}
      runs={runs}
      laneOf={laneOf}
      onDropOrder={onDropOrder}
      onCommit={(draftId) => void post("/api/runs/drafts/commit", { draftId })}
    />
  );
}