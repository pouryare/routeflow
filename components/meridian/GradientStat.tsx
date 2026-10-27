import type { ReactNode } from "react";
import { CardHelp } from "@/components/meridian/CardHelp";
import { Icon, type IconName } from "@/components/meridian/Icon";

export type WashTone = "peach" | "mint" | "sand";
export type ChipTone = "sage" | "sky" | "amber";

/** A headline figure on a warm mesh gradient — the artifact's `.gcard`.
 *
 *  The wash is decoration and grouping: it gives the row three identities so it scans as
 *  three things rather than one block. It deliberately does NOT encode good or bad — the
 *  chip says that in words. Colour and copy both grading the same number is how a
 *  dashboard ends up saying two contradictory things at once.
 *
 *  `small` is the artifact's own modifier: the first card in the row is 1.5fr wide and
 *  prints its figure at 46px, the other two at 32px.
 */
export default function GradientStat({
  tone,
  label,
  value,
  unit,
  chip,
  chipTone = "sage",
  icon,
  small = false,
  help,
}: {
  tone: WashTone;
  label: string;
  /** Pre-formatted on the server — «۱۲٬۴۵۰٬۰۰۰», never a raw number. */
  value: ReactNode;
  /** The quiet word after the figure: «تومان», «میلیون». */
  unit?: string;
  chip?: ReactNode;
  chipTone?: ChipTone;
  /** An icon NAME, not a node.
   *
   *  This was `ReactNode`, and the call sites had filled it with «⇄», «₸», «◎», «⏱» —
   *  and, on one card, the literal string "sparkle", which rendered the English word
   *  inside a 40px tile and pushed 14px of it out past the edge. A prop that accepts any
   *  node accepts a mistake that looks exactly like a success at the call site. */
  icon?: IconName;
  small?: boolean;
  /** A `fig.*` id from lib/help/figures.ts: puts the (?) beside the label. */
  help?: string;
}) {
  return (
    <div className={`gcard ${tone}${small ? " small" : ""}`}>
      {icon ? (
        <div className="ico" aria-hidden>
          <Icon name={icon} />
        </div>
      ) : null}
      <div className="k">
        {label}
        {help ? <CardHelp id={help} /> : null}
      </div>
      <div className="v mono">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {chip ? <div className={`d${chipTone === "sage" ? "" : ` ${chipTone}`}`}>{chip}</div> : null}
    </div>
  );
}
