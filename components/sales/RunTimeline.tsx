import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { Avatar } from "@/components/AvatarStack";

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
  stops: TimelineStop[];
}

const STOP_TONE: Record<TimelineStop["status"], string> = {
  pending: "var(--neutral)",
  delivered: "var(--good)",
  refused: "var(--crit)",
  skipped: "var(--warn)",
};

const STOP_LABEL: Record<TimelineStop["status"], string> = {
  pending: "در انتظار",
  delivered: "تحویل شد",
  refused: "برگشت خورد",
  skipped: "رد شد",
};

/** Every open run's load on one axis.
 *
 *  **This is a sequence, not a clock.** `delivery_stops` records `sort_order` and, once a
 *  stop is done, `delivered_at` -- there is no planned arrival time anywhere in the
 *  schema. So the axis here is "first stop to last stop", and each block is one stop,
 *  equally wide.
 *
 *  Drawing this against a real time axis would mean inventing durations, and a chart that
 *  invents its own x-values is worse than no chart: it would show a van arriving at 10:40
 *  on the authority of nothing. If planned times are ever added to the schema, this
 *  becomes a real gantt by changing the width calculation and nothing else.
 *
 *  Right to left, like every other series in this app: the first stop of the day is the
 *  rightmost block, because that is where a Persian reader starts.
 */
export default function RunTimeline({ runs }: { runs: TimelineRun[] }) {
  if (runs.length === 0) return null;

  const busiest = Math.max(...runs.map((r) => r.stops.length), 1);

  return (
    <section aria-labelledby="timeline-heading">
      <h2
        id="timeline-heading"
        className="m-0 mb-[var(--space-1)] text-[length:var(--text-md)] font-medium text-[var(--text)]"
      >
        بار مسیرها
      </h2>
      <p className="m-0 mb-[var(--space-4)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
        هر بلوک یک ایستگاه است، به ترتیب توقف — نه بر حسب ساعت.
      </p>

      <div className="board-stagger flex flex-col gap-[var(--space-3)]">
        {runs.map((run) => (
          <article
            key={run.id}
            className="rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
          >
            <header className="mb-[var(--space-3)] flex items-center gap-[var(--space-2)]">
              <Avatar name={run.driver_name} count={run.stops.length} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--text-sm)] text-[var(--text)]">
                  {run.driver_name}
                </span>
                <span className="block font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  {faJalaliDate(run.run_date)}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {faToman(run.stops.reduce((a, s) => a + s.total_toman, 0))}
              </span>
            </header>

            {run.stops.length === 0 ? (
              <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                هنوز ایستگاهی روی این مسیر نیست.
              </p>
            ) : (
              <>
                {/* Width is proportional to the busiest run, so two rows side by side say
                    which van is carrying more. Without it every row fills its container
                    and a three-stop run looks exactly as loaded as a twelve-stop one. */}
                <ol
                  className="m-0 flex list-none gap-[3px] p-0"
                  style={{ width: `${(run.stops.length / busiest) * 100}%` }}
                >
                  {run.stops.map((s, i) => (
                    <li
                      key={s.id}
                      className="run-block group relative flex-1"
                      style={{ ["--block-tone" as string]: STOP_TONE[s.status] }}
                    >
                      <span className="sr-only">
                        {faNum(i + 1)}. {s.customer_name} — {STOP_LABEL[s.status]}
                      </span>
                      <span aria-hidden="true" className="run-block__bar" />
                      <span aria-hidden="true" className="run-block__tip">
                        {faNum(i + 1)}. {s.customer_name}
                        <span className="block font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]">
                          {s.order_no} · {STOP_LABEL[s.status]}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>

                <ul className="m-0 mt-[var(--space-3)] flex list-none flex-wrap gap-x-[var(--space-4)] gap-y-[var(--space-1)] p-0">
                  {(Object.keys(STOP_LABEL) as TimelineStop["status"][])
                    .map((k) => ({ k, n: run.stops.filter((s) => s.status === k).length }))
                    .filter((x) => x.n > 0)
                    .map(({ k, n }) => (
                      <li
                        key={k}
                        className="flex items-center gap-[var(--space-1)] font-mono text-[length:var(--text-xs)] text-[var(--text-muted)]"
                      >
                        <span
                          aria-hidden="true"
                          className="inline-block size-[8px] rounded-[2px]"
                          style={{ backgroundColor: STOP_TONE[k] }}
                        />
                        {STOP_LABEL[k]} {faNum(n)}
                      </li>
                    ))}
                </ul>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
