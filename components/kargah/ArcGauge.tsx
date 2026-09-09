/** A single-value arc gauge -- the video's soft-pastel progress rings. Deliberately
 *  simpler than DonutChart (one value, not a composition needing lib/chartScale's
 *  multi-slice arc-path math): a plain SVG stroke-dasharray arc over a faint track. */
export default function ArcGauge({
  value,
  min = 0,
  max = 100,
  label,
  color = "var(--accent)",
  size = 96,
}: {
  value: number;
  min?: number;
  max?: number;
  label: string;
  color?: string;
  size?: number;
}) {
  const r = size / 2 - 8;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const dash = circumference * pct;

  return (
    <div className="inline-flex flex-col items-center gap-1" role="img" aria-label={`${label}: ${value}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-sunk)"
          strokeWidth={8}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-[var(--text)]"
          fontSize={size * 0.2}
        >
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{label}</span>
    </div>
  );
}
