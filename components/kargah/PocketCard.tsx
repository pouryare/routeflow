import Link from "next/link";

export interface PocketDoc {
  /** The document's name — «رسید تحویل», «فاکتور», «برگهٔ مسیر». */
  label: string;
  /** The figure that document is actually about, already formatted. */
  value: string;
  /** Two tones: the bars alternate between them, strong first. */
  tone: [string, string];
  /** Four heights, 0–1. Derived from the order, never random — a card that redraws
   *  itself differently on every render is decoration pretending to be data. */
  bars: [number, number, number, number];
}

export type PocketStatus = "done" | "conf" | "draft";

/** An order as a card with its documents tucked behind it — the artifact's `.pocket`.
 *
 *  At rest the documents sit low, peeking. On hover or focus they fan apart and rise
 *  above the frosted face, which is `z-index`, not clipping: two 138px documents do not
 *  fit inside a 268px card, so the fan deliberately overhangs the card's edges and the
 *  raised z-index is what makes that legal.
 *
 *  The documents travel DOWN at rest and up to y:0 on hover, never negative — moving them
 *  up instead puts them outside the card's own box, where the grid's top row gets shaved.
 */
export default function PocketCard({
  href,
  customer,
  meta,
  amount,
  unit = "تومان",
  status,
  statusLabel,
  docs,
}: {
  href: string;
  customer: string;
  meta: string;
  amount: string;
  unit?: string;
  status: PocketStatus;
  statusLabel: string;
  docs: PocketDoc[];
}) {
  return (
    <Link className="pocket" href={href} aria-label={`${customer} — ${statusLabel}`}>
      <div className="docs" aria-hidden>
        {docs.map((d) => (
          <div className="doc" key={d.label}>
            <div className="dt">{d.label}</div>
            <div className="dv">{d.value}</div>
            <div className="bars">
              {d.bars.map((h, i) => (
                <i
                  key={i}
                  style={{ background: d.tone[i % 2 === 0 ? 0 : 1], height: `${Math.round(h * 100)}%` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="face">
        <div className="who">{customer}</div>
        <div className="meta">{meta}</div>
        <div className="amt mono">
          {amount}
          <small>{unit}</small>
        </div>
        <div className="foot">
          <span className={`pill ${status}`}>{statusLabel}</span>
          <span className="more">
            {docs.length > 0 ? `${docs.length === 1 ? "۱" : "۲"} سند ↖` : "هنوز سندی ندارد"}
          </span>
        </div>
      </div>
    </Link>
  );
}
