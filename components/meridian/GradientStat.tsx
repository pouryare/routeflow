import type { ReactNode } from "react";

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
}: {
  tone: WashTone;
  label: string;
  /** Pre-formatted on the server — «۱۲٬۴۵۰٬۰۰۰», never a raw number. */
  value: ReactNode;
  /** The quiet word after the figure: «تومان», «میلیون». */
  unit?: string;
  chip?: ReactNode;
  chipTone?: ChipTone;
  icon?: ReactNode;
  small?: boolean;
}) {
  return (
    <div className={`gcard ${tone}${small ? " small" : ""}`}>
      {icon ? <div className="ico" aria-hidden>{icon}</div> : null}
      <div className="k">{label}</div>
      <div className="v mono">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {chip ? <div className={`d${chipTone === "sage" ? "" : ` ${chipTone}`}`}>{chip}</div> : null}
    </div>
  );
}
