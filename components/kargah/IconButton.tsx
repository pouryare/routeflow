import { cn } from "@/lib/cn";

/** A circular icon button -- the video's grouped share/calendar/expand row. Carries the
 *  milled-edge highlight plus a soft shadow so it reads as a physical disc. */
export default function IconButton({
  icon,
  label,
  className,
  ...rest
}: {
  icon: React.ReactNode;
  label: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-pill)]",
        "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]",
        "shadow-[var(--edge-hi),var(--sh-1)] transition-transform duration-150",
        "hover:scale-[1.05] active:scale-[0.97]",
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
