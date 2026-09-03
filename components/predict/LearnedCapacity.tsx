export interface CapacityRow {
  condition_code: string;
  stop_factor: number;
  speed_factor: number;
  service_time_factor: number;
  max_duration_factor: number;
  note_fa?: string | null;
  learned_n: number;
}

const CONDITION_FA: Record<string, string> = {
  heavy_rain: "باران شدید",
  snow_ice: "برف و یخ",
  extreme_heat: "گرمای شدید",
  high_wind: "باد شدید",
  dust_storm: "گرد و خاک",
  fog: "مه",
};

const MIN_LEARN_N = 5;
const pct = (n: number) => `${Math.round(n * 100).toLocaleString("fa-IR")}٪`;

/** The resolved capacity factors, with how many of the tenant's own routes each
 *  learned value now rests on. Below 5 observations the shipped value still stands. */
export default function LearnedCapacity({ rows }: { rows: CapacityRow[] }) {
  return (
    <div className="kblock" dir="rtl">
      <div className="bhead">
        <h2>ظرفیت آموخته‌شده از مسیرها</h2>
      </div>
      <div className="kblock__body overflow-x-auto">
        <table className="w-full border-collapse text-[length:var(--text-sm)]">
          <thead>
            <tr className="text-[var(--text-muted)]">
              <th className="border-b border-[var(--border)] py-1 text-right font-medium">شرایط</th>
              <th className="border-b border-[var(--border)] py-1 text-left font-medium">ضریب سرعت</th>
              <th className="border-b border-[var(--border)] py-1 text-left font-medium">ضریب توقف</th>
              <th className="border-b border-[var(--border)] py-1 text-left font-medium">مشاهده‌ها</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.condition_code}>
                <td className="border-b border-[var(--border)] py-1 text-[var(--text)]">
                  {CONDITION_FA[r.condition_code] ?? r.condition_code}
                </td>
                <td className="border-b border-[var(--border)] py-1 text-left tabular-nums text-[var(--text-muted)]">
                  {pct(r.speed_factor)}
                </td>
                <td className="border-b border-[var(--border)] py-1 text-left tabular-nums text-[var(--text-muted)]">
                  {pct(r.stop_factor)}
                </td>
                <td
                  className="border-b border-[var(--border)] py-1 text-left tabular-nums"
                  style={{ color: r.learned_n >= MIN_LEARN_N ? "var(--good)" : "var(--text-faint)" }}
                >
                  {r.learned_n.toLocaleString("fa-IR")}
                  {r.learned_n >= MIN_LEARN_N ? " ✓" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-faint)]">
        زیر {MIN_LEARN_N.toLocaleString("fa-IR")} مشاهده، همان مقدار پیش‌فرض کارخانه استفاده می‌شود.
      </p>
    </div>
  );
}
