import { JALALI_MONTHS } from "@/lib/jalali";

interface Point {
  target_period: string;
  horizon: number;
  yhat: number;
  yhat_lo: number;
  yhat_hi: number;
}
export interface DemandEntry {
  entity_type: string;
  entity_id: number;
  label: string;
  metric: string;
  method: string;
  mae: number | null;
  n_obs: number;
  points: Point[];
}

const fa = (n: number) => Math.round(n).toLocaleString("fa-IR");
const monthLabel = (period: string) => {
  const [, m] = period.split("-");
  return JALALI_MONTHS[Number(m) - 1] ?? period;
};

function MethodBadge({ method }: { method: string }) {
  const learning = method === "holt";
  return (
    <span
      className="rounded-[var(--radius-sm)] px-[6px] py-[1px] text-[length:var(--text-xs)]"
      style={{
        color: learning ? "var(--good)" : "var(--warn)",
        border: `1px solid ${learning ? "var(--good)" : "var(--warn)"}`,
      }}
    >
      {learning ? "یادگیری" : "تخمین"}
    </span>
  );
}

/** Next-3-month demand per product (+ an org total), each row labelled with its
 *  method — «تخمین» while it is still a shipped seasonal guess, «یادگیری» once the
 *  model has its own months. */
export default function DemandTable({ entries }: { entries: DemandEntry[] }) {
  const toman = entries.filter((e) => e.metric === "demand_toman");
  const horizons = toman[0]?.points.map((p) => p.target_period) ?? [];

  if (toman.length === 0) {
    return (
      <div className="kblock" dir="rtl">
        <div className="bhead">
          <h2>پیش‌بینی تقاضا</h2>
        </div>
        <p className="kblock__body text-[length:var(--text-sm)] text-[var(--text-muted)]">
          هنوز پیش‌بینی‌ای محاسبه نشده — دکمهٔ «به‌روزرسانی پیش‌بینی» را بزنید.
        </p>
      </div>
    );
  }

  const ordered = [
    ...toman.filter((e) => e.entity_type === "org"),
    ...toman.filter((e) => e.entity_type !== "org").sort((a, b) => (b.points[0]?.yhat ?? 0) - (a.points[0]?.yhat ?? 0)),
  ];

  return (
    <div className="kblock" dir="rtl">
      <div className="bhead">
        <h2>پیش‌بینی تقاضا (تومان)</h2>
      </div>
      <div className="kblock__body overflow-x-auto">
        <table className="w-full border-collapse text-[length:var(--text-sm)]">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="border-b border-[var(--border)] py-1 text-right font-medium">مورد</th>
              {horizons.map((h) => (
                <th key={h} className="border-b border-[var(--border)] py-1 text-left font-medium">
                  {monthLabel(h)}
                </th>
              ))}
              <th className="border-b border-[var(--border)] py-1 text-left font-medium">روش</th>
              <th className="border-b border-[var(--border)] py-1 text-left font-medium">خطا / ماه‌ها</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((e) => (
              <tr key={`${e.entity_type}:${e.entity_id}`}>
                <td className="border-b border-[var(--border)] py-1 text-[var(--text)]">{e.label}</td>
                {e.points.map((p) => (
                  <td
                    key={p.target_period}
                    className="border-b border-[var(--border)] py-1 text-left tabular-nums text-[var(--text-muted)]"
                  >
                    {fa(p.yhat)}
                    <span className="block text-[length:var(--text-xs)] text-[var(--text-faint)]">
                      {fa(p.yhat_lo)}–{fa(p.yhat_hi)}
                    </span>
                  </td>
                ))}
                <td className="border-b border-[var(--border)] py-1 text-left">
                  <MethodBadge method={e.method} />
                </td>
                <td className="border-b border-[var(--border)] py-1 text-left tabular-nums text-[var(--text-faint)]">
                  {e.mae === null ? "—" : fa(e.mae)} / {fa(e.n_obs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
