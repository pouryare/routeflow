import type { ReactNode } from "react";

export type WashTone = "peach" | "mint" | "sand" | "sky";

/** A headline figure on a soft warm mesh (MASTER.md, "Gradient stat card").
 *
 *  The wash is decoration and grouping: it gives a row of figures four identities so it
 *  scans as four things rather than one block. It deliberately does NOT encode good or
 *  bad -- `note` says that in words. Colour and copy both claiming to grade the same
 *  number is how a dashboard ends up saying two contradictory things at once.
 */
export default function GradientStat({
  tone,
  label,
  value,
  note,
  icon,
  className,
}: {
  tone: WashTone;
  label: string;
  /** Pre-formatted on the server -- «۱۲٬۵۰۰ تومان», never a raw number. */
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`gstat gstat--${tone}${className ? ` ${className}` : ""}`}>
      <p className="gstat__label">
        {icon ? (
          <span className="gstat__icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        {label}
      </p>
      <strong className="gstat__value num">{value}</strong>
      {note ? <span className="gstat__note">{note}</span> : null}
    </div>
  );
}
