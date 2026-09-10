import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import Avatar from "@/components/meridian/Avatar";
import SectionHead from "@/components/meridian/SectionHead";

export interface TimelineStop {
  id: number;
  order_no: string;
  customer_name: string;
  status: "pending" | "delivered" | "refused" | "skipped";
  total_toman: number;
}

export interface TimelineRun {
  id: number;
  run_date: string;
  status: string;
  driver_name: string;
  driver_user_id?: number;
  stops: TimelineStop[];
}

const STOP_LABEL: Record<TimelineStop["status"], string> = {
  pending: "در انتظار",
  delivered: "تحویل شد",
  refused: "برگشت خورد",
  skipped: "رد شد",
};

/** «بار مسیرها»: every open run as a lane on one shared axis (item 16, `timeline-multi-track`).
 *
 *  It used to be one long bar per run, a progress bar impersonating a schedule. A run IS
 *  a lane with events along it, so this draws exactly that: one row per run with its
 *  driver at the head, one node per stop, every lane on the same axis so a column is
 *  "the Nth stop" in every van at once and the longer lane is visibly the heavier day.
 *
 *  **The axis is a sequence, not a clock.** `delivery_stops` records the stop order and,
 *  once done, `delivered_at`; nothing records a planned arrival time. Drawing this on a
 *  time axis would invent durations. If planned times are ever added, only the column
 *  placement changes.
 *
 *  Right to left like every other series here: stop 1 sits at the lane's start edge,
 *  where a Persian reader begins. Server component. */
export default function RunTimeline({ runs }: { runs: TimelineRun[] }) {
  if (runs.length === 0) return null;

  const busiest = Math.max(...runs.map((r) => r.stops.length), 1);
  const all = runs.flatMap((r) => r.stops);
  const tally = (Object.keys(STOP_LABEL) as TimelineStop["status"][])
    .map((k) => ({ k, n: all.filter((s) => s.status === k).length }))
    .filter((x) => x.n > 0);
  const cols = { ["--stops" as string]: busiest };

  return (
    <section
      aria-labelledby="timeline-heading"
      className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
    >
      <SectionHead
        id="timeline-heading"
        title="بار مسیرها"
        sub="هر ردیف یک مسیر و هر نقطه یک ایستگاه است، به ترتیب توقف — نه بر حسب ساعت."
        actions={
          tally.length > 0 ? (
            <ul className="mlanes__legend" aria-label="راهنما">
              {tally.map(({ k, n }) => (
                <li key={k}>
                  <span className={`mlanes__swatch mlanes__swatch--${k}`} aria-hidden="true" />
                  {STOP_LABEL[k]} {faNum(n)}
                </li>
              ))}
            </ul>
          ) : null
        }
      />

      <div className="mlanes" style={cols}>
        <div className="mlanes__axis" aria-hidden="true">
          <span className="mlanes__head" />
          <ol className="mlanes__ticks">
            {Array.from({ length: busiest }, (_, i) => (
              <li key={i}>{faNum(i + 1)}</li>
            ))}
          </ol>
        </div>

        {runs.map((run) => {
          const load = run.stops.reduce((a, s) => a + s.total_toman, 0);
          const done = run.stops.filter((s) => s.status !== "pending").length;
          return (
            <article key={run.id} className="mlanes__lane" aria-label={`مسیر ${run.driver_name}`}>
              <header className="mlanes__head">
                <Avatar userId={run.driver_user_id} name={run.driver_name} size={32} />
                <span className="mlanes__who">
                  <span className="mlanes__name">{run.driver_name}</span>
                  <span className="mlanes__meta">
                    {faJalaliDate(run.run_date)} · {faNum(done)}/{faNum(run.stops.length)} · {faToman(load)}
                  </span>
                </span>
              </header>
              {run.stops.length === 0 ? (
                <p className="mlanes__empty">هنوز ایستگاهی روی این مسیر نیست.</p>
              ) : (
                <ol
                  className="mlanes__track"
                  style={{ ["--filled" as string]: run.stops.length }}
                >
                  {run.stops.map((s, i) => (
                    <li key={s.id} className={`mlanes__stop mlanes__stop--${s.status}`} tabIndex={0}>
                      <span className="mlanes__dot" aria-hidden="true" />
                      <span className="mlanes__tip" role="tooltip">
                        <b>
                          {faNum(i + 1)}. {s.customer_name}
                        </b>
                        <span>
                          {s.order_no} · {STOP_LABEL[s.status]}
                        </span>
                      </span>
                      <span className="sr-only">
                        ایستگاه {faNum(i + 1)}: {s.customer_name}، {STOP_LABEL[s.status]}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
