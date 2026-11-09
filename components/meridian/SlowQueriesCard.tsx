import { faNum } from "@/lib/format";
import { faJalaliDateTime } from "@/lib/jalali";
import { readableMs, shortSql, SLOW_MS, type SlowQueryRow } from "@/lib/slowQueries";

const UNIT = { ms: "میلی‌ثانیه", s: "ثانیه", min: "دقیقه" } as const;
const time = (ms: number) => {
  const r = readableMs(ms);
  return `${r.under ? "کمتر از " : ""}${faNum(r.value)} ${UNIT[r.unit]}`;
};

/** «کندترین پرس‌وجوها», on the platform owner's status page: the app's ten slowest database
 *  queries on average, how often each ran and their total time, since the counters were last
 *  reset. Example: «۱۸۰ میلی‌ثانیه · ۴۰ بار · روی هم ۷٫۲ ثانیه». The SQL is shown left to right,
 *  folded to one line; it is for whoever looks after the server, not for daily use. */
export default function SlowQueriesCard({ data }: { data: { rows: SlowQueryRow[]; since: string | null } | null }) {
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="slow-queries">
      <h2 className="sechead__title">کندترین پرس‌وجوهای پایگاه داده</h2>
      {data === null ? (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
          آمار پرس‌وجوها روشن نیست (pg_stat_statements باید در shared_preload_libraries باشد).
        </p>
      ) : data.rows.length === 0 ? (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">هنوز آماری جمع نشده است.</p>
      ) : (
        <>
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
            میانگین هر اجرا، از کندترین. بالای {faNum(SLOW_MS)} میلی‌ثانیه نیاز به نگاه دارد.
            {data.since ? (
              <>
                {" "}از <bdi dir="ltr" className="tabular-nums">{faJalaliDateTime(data.since)}</bdi>
              </>
            ) : null}
          </p>
          <ol className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
            {data.rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] pb-[var(--space-2)]">
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                  <span className="font-medium tabular-nums" style={{ color: r.mean_ms > SLOW_MS ? "var(--warning)" : "var(--foreground)" }}>
                    {time(r.mean_ms)}
                  </span>
                  <span className="tabular-nums text-[var(--muted)]">
                    {faNum(r.calls)} بار · روی هم {time(r.total_ms)}
                  </span>
                </div>
                <code dir="ltr" className="block break-all text-start text-[length:var(--text-xs)] text-[var(--muted)]">
                  {shortSql(r.query)}
                </code>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
