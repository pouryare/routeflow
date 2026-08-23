import { shapeForColor } from "@/lib/types";

/** A colour swatch and its label.
 *
 *  When shaped markers are on, the swatch takes the same shape the marker does --
 *  otherwise the legend teaches a colour the map is no longer relying on, which is the
 *  one thing a legend must not do. */
export default function StatusPill({
  color,
  label,
  shaped = false,
}: {
  color: string;
  label: string;
  shaped?: boolean;
}) {
  const shape = shaped ? shapeForColor(color) : "diamond";
  return (
    <span
      className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide"
      style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      <span
        aria-hidden="true"
        className={`customer-marker customer-marker--${shape} !h-2.5 !w-2.5 shrink-0`}
        style={{ ["--marker-color" as string]: color }}
      >
        <span className="customer-marker__diamond" />
      </span>
      {label}
    </span>
  );
}
