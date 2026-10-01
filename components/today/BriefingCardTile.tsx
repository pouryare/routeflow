import Link from "next/link";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import type { BriefingCard } from "@/lib/repo/briefingCards";

/** One statistic: the count, and the ONE thing to do about it.
 *
 *  The pairing is the point. A card showing only "۳" tells the reader they are busy and
 *  nothing about what to do first, so they tap, they scan a list, and they choose — three
 *  steps where one would do. Naming the single most urgent item keeps this a one-glance
 *  screen while still being actionable.
 *
 *  The whole card is one link when there is something to act on, because the tappable
 *  region a thumb actually aims at is the card, not the words inside it.
 *
 *  The class is `actile__*`, NOT `tile__*`. A `.tile` class already exists and is live in
 *  CustomerBento and the planner — reusing it would restyle every existing card on the way
 *  to restyling this one.
 */
export default function BriefingCardTile({
  title,
  card,
  href,
}: {
  title: string;
  card: BriefingCard;
  /** Fallback destination for the whole card when the urgent item has none. */
  href?: string;
}) {
  const target = card.urgent?.href ?? href;
  const body = (
    <>
      <span className="actile__count">{faNum(card.count)}</span>
      <span className="actile__title">{title}</span>
      {card.urgent ? (
        <span className="actile__urgent">
          {/* Decorative: the item's own text is the label, and an arrow beside a truncated
              Persian string adds nothing a screen reader can use. */}
          <Icon name="arrow-left" size="sm" label="" />
          <span className="truncate">{card.urgent.label}</span>
        </span>
      ) : null}
    </>
  );

  if (!target) {
    return <div className="actile">{body}</div>;
  }
  return (
    <Link href={target} className="actile actile--action">
      {body}
    </Link>
  );
}