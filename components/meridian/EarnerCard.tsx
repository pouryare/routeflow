import { faToman, faNum } from "@/lib/format";
import Avatar from "@/components/meridian/Avatar";

export interface EarnerLine {
  key: string | number;
  who: string;
  kg: number;
  amount_toman: number;
}

/** One person's per-kilogram commission card -- شارد between فروشنده and راننده, the
 *  two ledgers whose statement is "weight × rate, itemised by what earned it". A مدیر
 *  گروه's card is a different shape (a percentage of a group total, no itemised weight
 *  of their own) and is built separately on the commission page rather than forced
 *  through this one.
 */
export default function EarnerCard({
  id,
  displayName,
  subLabel,
  accruedToman,
  paidToman,
  owedToman,
  lines,
  lineNoun,
}: {
  id: number;
  displayName: string;
  /** «۱۲ کیلو در این دوره» for a فروشنده, same wording for a راننده -- kept as a prop
   *  rather than hardcoded so the two ledgers can still each phrase it in their own
   *  words later without touching this component again. */
  subLabel: string;
  accruedToman: number;
  paidToman: number;
  owedToman: number;
  lines: EarnerLine[];
  /** «سفارش» or «تحویل» -- what one row of `lines` actually is. */
  lineNoun: string;
}) {
  // How much of what has accrued is still owed. The bar is the point of the card: two
  // people can accrue the same and be settled very differently.
  const settled =
    accruedToman > 0 ? Math.max(0, Math.min(100, ((accruedToman - owedToman) / accruedToman) * 100)) : 100;

  return (
    <article className="pcard" key={id}>
      <header className="pcard__head">
        <Avatar userId={id} name={displayName} size={46} className="pcard__av" />
        <div className="min-w-0">
          <h2>{displayName}</h2>
          <div className="pcard__sub mono">{subLabel}</div>
        </div>
      </header>

      <div className="pcard__big mono">
        {faNum(accruedToman)}
        <small>تومان پورسانت</small>
      </div>

      <div className="pcard__bar" role="img" aria-label={`${Math.round(settled)} درصد تسویه‌شده`}>
        <i style={{ width: `${settled}%` }} />
      </div>

      <dl className="pcard__grid">
        <div>
          <dt>پرداخت‌شده</dt>
          <dd className="mono">{faToman(paidToman)}</dd>
        </div>
        <div>
          <dt>مانده</dt>
          <dd className="mono" style={{ color: owedToman > 0 ? "var(--accent)" : "var(--sage)" }}>
            {faToman(owedToman)}
          </dd>
        </div>
        <div>
          <dt>{lineNoun}</dt>
          <dd className="mono">{faNum(lines.length)}</dd>
        </div>
      </dl>

      {lines.length > 0 && (
        <details className="pcard__more">
          <summary>
            {faNum(lines.length)} {lineNoun} پشت این عدد
          </summary>
          <div className="pcard__rows">
            {lines.slice(0, 8).map((l) => (
              <div className="pcard__row" key={l.key}>
                <span className="pcard__who">{l.who}</span>
                <span className="mono">{faNum(l.kg)} کیلو</span>
                <span className="mono pcard__amt">{faToman(l.amount_toman)}</span>
              </div>
            ))}
            {lines.length > 8 && (
              <p className="pcard__rest">
                و {faNum(lines.length - 8)} {lineNoun} دیگر
              </p>
            )}
          </div>
        </details>
      )}
    </article>
  );
}
