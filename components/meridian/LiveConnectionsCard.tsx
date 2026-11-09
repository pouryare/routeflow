import { deviceLabel } from "@/lib/deviceLabel";
import { faNum } from "@/lib/format";
import { faJalaliDateTime } from "@/lib/jalali";
import type { LiveConnectionRow } from "@/lib/repo/liveConnections";

/** Idea L8, on the owner's status page: who has the app open right now, on which device, since
 *  when, and whether their phone is keeping up. It answers "is Reza's phone getting updates?"
 *  without a call. A person with two tabs or two phones shows once per stream. */
export default function LiveConnectionsCard({ rows }: { rows: LiveConnectionRow[] }) {
  const people = new Set(rows.filter((r) => r.user_id != null).map((r) => r.user_id)).size;
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="live-connections">
      <h2 className="sechead__title">چه کسی الان وصل است</h2>
      {rows.length === 0 ? (
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">الان کسی برنامه را باز ندارد.</p>
      ) : (
        <>
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
            {faNum(people)} نفر · {faNum(rows.length)} اتصال
          </p>
          <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] pb-[var(--space-2)]">
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                  <span className="font-medium text-[var(--foreground)]">{r.user_id == null ? "صفحهٔ نمایش" : (r.name ?? "؟")}</span>
                  <span style={{ color: r.slow ? "var(--warning)" : "var(--success)" }}>{r.slow ? "کند، عقب مانده" : "به‌روز"}</span>
                </div>
                <span className="text-[var(--muted)]">
                  {deviceLabel(r.device)} · وصل از <span className="tabular-nums">{faJalaliDateTime(String(r.opened_at))}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
