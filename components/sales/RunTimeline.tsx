"use client";

// «بار مسیرها» — every run as one shared grid.
//
// The shared axis IS the value. A column means "the 3rd stop in every van at once", which is
// only readable if all the runs sit in ONE stack. Split them into separate cards and the
// comparison that made this worth having disappears -- which is why this is not "cards plus
// a timeline", it IS the timeline.
//
// Three things it was wrong about, and all three are the same mistake in different clothes:
// showing something precise that is not true.
//
//  1. It summed TOMAN. Money, on the one graphic built to compare how full each van is. A van
//     fills by weight; «۹۲۰ ک.م» is the number you want while splitting a day.
//  2. Empty slots were blank, so a 6-stop lane beside an 8-stop one read as SHORT rather than
//     finished. Ghost rings say "this lane ends here" instead of "something is missing".
//  3. The legend was four colours with no numbers, so a refusal was a mark you might miss.
//     «برگشت خورد ۱» is a thing you can count across the week.

export interface TimelineStop {
  id: number;
  order_no: string;
  customer_name: string;
  status: "pending" | "delivered" | "refused" | "skipped";
  /** Weight this stop contributes. A van fills by weight — see the note above. */
  kg: number;
  /** Money, still shown per stop but never summed into the lane header. */
  total_toman: number;
}

export interface TimelineRun {
  id: number;
  run_date: string;
  driver_name: string | null;
  status: string;
  stops: TimelineStop[];
}

export default function RunTimeline({ runs }: { runs: TimelineRun[] }) {
  // One width for the whole grid, so a column really is the same stop index everywhere.
  const width = Math.max(8, ...runs.map((r) => r.stops.length));

  const tally = runs.reduce(
    (acc, r) => {
      for (const s of r.stops) {
        acc.kg += s.kg;
        acc[s.status] += 1;
      }
      return acc;
    },
    { kg: 0, pending: 0, delivered: 0, refused: 0, skipped: 0 }
  );

  return (
    <div dir="rtl" className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[length:var(--text-xs)]">
          <thead>
            <tr>
              <th className="w-28 text-right font-normal text-text-faint">راننده</th>
              {Array.from({ length: width }, (_, i) => (
                <th key={i} className="w-6 font-normal text-text-faint">
                  {i + 1}
                </th>
              ))}
              <th className="w-24 text-right font-normal text-text-faint">بار</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const kg = r.stops.reduce((n, s) => n + s.kg, 0);
              return (
                <tr key={r.id}>
                  <td className="py-1 pe-2 text-text">{r.driver_name ?? "—"}</td>
                  {Array.from({ length: width }, (_, i) => {
                    const stop = r.stops[i];
                    if (stop) return <Cell key={i} stop={stop} />;
                    // The ghost. A hole in the grid reads as a shortage; a ring reads as
                    // "this lane is finished", which is what it means.
                    return (
                      <td key={i} className="py-1">
                        <span
                          aria-hidden="true"
                          className="mx-auto block size-2.5 rounded-full border border-dashed border-border"
                        />
                      </td>
                    );
                  })}
                  <td className="py-1 pe-2 font-mono text-text-muted">
                    {kg.toLocaleString("fa-IR")} ک.م
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Counts, not colours. A refusal you can add up is a refusal you will notice. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[length:var(--text-xs)] text-text-muted">
        <span className="font-mono text-text">
          {tally.kg.toLocaleString("fa-IR")} ک.م
        </span>
        {tally.delivered > 0 && <span>تحویل‌شده {tally.delivered.toLocaleString("fa-IR")}</span>}
        {tally.refused > 0 && <span>برگشت خورد {tally.refused.toLocaleString("fa-IR")}</span>}
        {tally.skipped > 0 && <span>رد شد {tally.skipped.toLocaleString("fa-IR")}</span>}
        {tally.pending > 0 && <span className="text-text-faint">باقی‌مانده {tally.pending.toLocaleString("fa-IR")}</span>}
      </div>
    </div>
  );
}

const TONE: Record<TimelineStop["status"], string> = {
  delivered: "bg-ok/70",
  pending: "bg-border",
  refused: "bg-[var(--crit)]/70",
  skipped: "bg-text-faint/50",
};

function Cell({ stop }: { stop: TimelineStop }) {
  return (
    <td className="py-1">
      <span
        title={`${stop.customer_name} · ${stop.kg.toLocaleString("fa-IR")} ک.م`}
        className={`mx-auto block size-2.5 rounded-full ${TONE[stop.status]}`}
      />
    </td>
  );
}