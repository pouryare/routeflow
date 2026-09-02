interface Contribution {
  key: string;
  label: string;
  before: number;
  after: number;
  delta: number;
  share: number;
}
export interface Rung {
  dimension_fa: string;
  scope_fa: string | null;
  delta: number;
  pct: number;
  headline: string;
  contributions: Contribution[];
}

const fa = (n: number) => Math.round(n).toLocaleString("fa-IR");
const pct = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n * 100).toLocaleString("fa-IR")}٪`;

/** The ladder as a breadcrumb of rungs, each ending on its headline sentence. */
export default function WhyDrilldown({ chain }: { chain: Rung[] }) {
  if (chain.length === 0) return null;
  return (
    <div
      className="mt-[var(--space-2)] flex flex-col gap-[var(--space-2)] border-t border-[var(--border)] pt-[var(--space-2)]"
      dir="rtl"
    >
      {chain.map((rung, i) => (
        <div key={i}>
          <div className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {rung.scope_fa ? `${rung.scope_fa} ← ` : ""}
            به تفکیک {rung.dimension_fa} · {pct(rung.pct)}
          </div>
          <div className="text-[length:var(--text-sm)] text-[var(--text)]">{rung.headline}</div>
          <ul className="m-0 mt-[var(--space-1)] list-none p-0">
            {rung.contributions.slice(0, 4).map((c) => (
              <li
                key={c.key}
                className="flex justify-between text-[length:var(--text-xs)] tabular-nums text-[var(--text-muted)]"
              >
                <span>{c.label}</span>
                <span style={{ color: c.delta < 0 ? "var(--crit)" : "var(--good)" }}>
                  {c.delta >= 0 ? "+" : ""}
                  {fa(c.delta)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
