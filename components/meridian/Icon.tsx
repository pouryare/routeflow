import { resolveIcon, type IconName, type IconSize } from "./icon-map";

export type { IconName, IconSize };
export { ICON_PX, ICON_STROKE, ICONS } from "./icon-map";

/** The one way to render an icon in meridian.
 *
 *  `<Icon name="truck" />` — decorative, `aria-hidden`.
 *  `<Icon name="bell" label="اعلان‌ها" />` — an image with an accessible name.
 *
 *  Colour is always `currentColor` (set `color` on a parent); size is a token, never a
 *  raw px; stroke weight is fixed. Feature code imports this, never `lucide-react`. */
export function Icon({
  name,
  size = "md",
  label,
  className,
  filled = false,
}: {
  name: IconName;
  size?: IconSize;
  label?: string;
  className?: string;
  /** Fills the glyph with `currentColor` instead of leaving it hollow. Only for the
   *  handful of icons whose on/off state IS fill — a rated star, a pinned marker. It is
   *  not a colour knob: filled or not, the icon is still one ink. */
  filled?: boolean;
}) {
  const r = resolveIcon(name, size, label);
  const Comp = r.Comp;
  return (
    <Comp
      width={r.size}
      height={r.size}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={r.strokeWidth}
      className={className}
      aria-hidden={r["aria-hidden"]}
      aria-label={r["aria-label"]}
      role={r.role}
      focusable="false"
    />
  );
}
