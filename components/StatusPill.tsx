export default function StatusPill({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide"
      style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
