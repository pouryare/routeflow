import { cn } from "@/lib/cn";

/** A rounded textarea -- a smaller radius than the pill controls, since a pill shape
 *  reads wrong on a multi-line box. */
export default function Textarea({
  label,
  className,
  ...rest
}: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[length:var(--text-sm)] text-[var(--text-muted)]">
        {label}
      </span>
      <textarea
        className={cn(
          "w-full rounded-[var(--radius-lg)] border border-[var(--border)]",
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
