import { cn } from "@/lib/cn";

/** A pill-shaped select -- same treatment as Field. */
export default function Select({
  label,
  options,
  className,
  ...rest
}: {
  label: string;
  options: { value: string; label: string }[];
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[length:var(--text-sm)] text-[var(--text-muted)]">
        {label}
      </span>
      <select
        className={cn(
          "w-full rounded-[var(--radius-pill)] border border-[var(--border)]",
          "bg-[var(--surface)] px-5 py-3 text-[var(--text)]",
          "shadow-[var(--edge-hi)] outline-none transition-colors",
          "focus:border-[var(--accent)]",
          className,
        )}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
