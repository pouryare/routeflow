import { cn } from "@/lib/cn";

/** A pill-shaped text input -- the video's rounded form fields. */
export default function Field({
  label,
  className,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[length:var(--text-sm)] text-[var(--text-muted)]">
        {label}
      </span>
      <input
        className={cn(
          "w-full rounded-[var(--radius-pill)] border border-[var(--border)]",
          "bg-[var(--surface)] px-5 py-3 text-[var(--text)]",
          "shadow-[var(--edge-hi)] outline-none transition-colors",
          "focus:border-[var(--accent)]",
          className,
        )}
        {...rest}
      />
    </label>
  );
}
