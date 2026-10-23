import type { RunDetail } from "@/lib/delivery";
import { buildReceipt } from "@/lib/deliveryReceipt";
import type { ReceiptData } from "@/lib/receiptLayout";
import { faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";

/** F101: a run's delivery notes in one packet, printed before the van leaves.
 *
 *  One note per stop in stop order, drawn from the same receipt builder the door uses, with the
 *  ORDERED packs (nothing has been delivered yet) and nothing collected, so the «مانده» line is
 *  what to collect. The total is the order's own (reversal lines net out of it, as on the run).
 *  A cover sheet names the driver, the day and
 *  the totals. Stops already finished are left out of the notes but counted on the cover. */

export interface RunNotes {
  cover: {
    driverName: string;
    dateLabel: string;
    vehicle: string | null;
    stops: number;
    pending: number;
    totalLabel: string;
    toCollectLabel: string;
  };
  notes: ReceiptData[];
}

export function runNotes(run: RunDetail, businessName: string, vehicle: string | null = null): RunNotes {
  const pending = run.stops.filter((s) => s.status === "pending");
  const notes = pending.map((stop) =>
    buildReceipt({
      stop,
      packs: Object.fromEntries(stop.lines.map((l) => [l.id, l.packs_ordered])),
      collectedToman: 0,
      runDate: run.run_date,
      driverName: run.driver_name,
      businessName,
    }),
  );
  return {
    cover: {
      driverName: run.driver_name,
      dateLabel: faJalaliDate(run.run_date),
      vehicle,
      stops: run.stops.length,
      pending: pending.length,
      totalLabel: faToman(run.stops.reduce((s, x) => s + x.total_toman, 0)),
      toCollectLabel: faToman(run.to_collect_toman),
    },
    notes,
  };
}
