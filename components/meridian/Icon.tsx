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
  /* `inline-block` here is not cosmetic — it is load-bearing, and it is the fix for a whole
   * class of layout bug at once.
   *
   * Tailwind's preflight sets `svg { display: block }` (preflight.css:222, "make replaced
   * elements display: block by default"). So an icon sitting beside a text node in ANY box
   * that is not a flex container pushed that text onto its own line: the "+" above
   * «ساخت مسیر», the person glyph above «تأمین نیلوفر پارس», the ↻ above «ورود به‌عنوان».
   * That is all 461 usages, not three pages — so fixing it page by page would have repaired
   * three symptoms and left the cause standing.
   *
   * `align-middle` centres the glyph on the text rather than on the baseline. `shrink-0` stops
   * a flex parent squeezing it. A caller that genuinely wants a block icon (a standalone
   * illustration, not a label) passes className="block", which wins because the caller's
   * className is appended last. */
  const cls = ["inline-block align-middle shrink-0", className].filter(Boolean).join(" ");
  return (
    <Comp
      width={r.size}
      height={r.size}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={r.strokeWidth}
      className={cls}
      aria-hidden={r["aria-hidden"]}
      aria-label={r["aria-label"]}
      role={r.role}
      focusable="false"
    />
  );
}
