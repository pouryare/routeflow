import Link from "next/link";
import TaskRow from "./TaskRow";
import BriefingCardTile from "./BriefingCardTile";
import { cardFor, type BriefingCard } from "@/lib/repo/briefingCards";
import type { Briefing as BriefingData, BriefingItem } from "@/lib/repo/briefing";

/** "plain" is the driver's standalone /today (generic tokens, phone-width column).
 *  "meridian" is the /sales/today tab — the same panels dressed in the workshop skin so it
 *  sits flush with every other sales screen. */
type Variant = "plain" | "meridian";

const TONE_PLAIN: Record<string, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  crit: "var(--crit)",
  info: "var(--info)",
};
const TONE_KARGAH: Record<string, string> = {
  good: "var(--sage)",
  warn: "var(--amber)",
  crit: "var(--crit)",
  info: "var(--serie-b)",
};

function Item({ item, variant }: { item: BriefingItem; variant: Variant }) {
  if (item.action?.kind === "task_outcome") {
    return <TaskRow taskId={item.action.task_id} customerId={item.action.customer_id} label={item.label} sub={item.sub} snoozable={item.action.snoozable} />;
  }
  const tone = variant === "meridian" ? TONE_KARGAH : TONE_PLAIN;
  const inner = (
    <span className="flex items-baseline justify-between gap-[var(--space-2)]">
      <span
        className={variant === "meridian" ? "text-[var(--ink)]" : "text-[var(--text)]"}
        style={item.tone ? { color: tone[item.tone] } : undefined}
      >
        {item.label}
      </span>
      {item.sub && (
        <span
          className={
            variant === "meridian"
              ? "text-[length:12px] text-[var(--muted)]"
              : "text-[length:var(--text-xs)] text-[var(--text-faint)]"
          }
        >
          {item.sub}
        </span>
      )}
    </span>
  );
  return (
    <li
      className={
        variant === "meridian"
          ? "border-b border-[var(--line)] py-[10px] last:border-b-0"
          : "border-b border-[var(--border)] py-[var(--space-2)]"
      }
    >
      {item.href ? (
        <Link href={item.href} className="block no-underline hover:opacity-80">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}

/** The panel's header breakdown — «تأییدشده ۵ · تحویل‌شده ۲».
 *
 *  Deliberately NOT a list item. A summary row and a list row are identical in shape and mean
 *  different things — one counts the other — and giving them the same treatment is precisely
 *  how this panel ended up saying «تأییدشده» once per confirmed order instead of once, in the
 *  header, above the list. */
function Summary({ summary, variant }: { summary?: BriefingItem[]; variant: Variant }) {
  if (!summary || summary.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
      {summary.map((s) => (
        <span
          key={s.label}
          className={
            variant === "meridian"
              ? "text-[length:12.5px] text-[var(--muted)]"
              : "text-[length:var(--text-xs)] text-[var(--text-muted)]"
          }
        >
          {s.label}
          <span className="text-[var(--ink-2)]"> {s.sub}</span>
        </span>
      ))}
    </div>
  );
}
/** The panels that are a FIGURE rather than a list. `target` and `credit_waiting` answer a
 *  reader's question with a number; the rest are worklists and stay panels. */
const CARD_KEYS = ["target", "credit_waiting"] as const;

export default function Briefing({
  data,
  variant = "plain",
  showCards = true,
}: {
  data: BriefingData;
  variant?: Variant;
  /** Both call sites want the cards; the prop exists so a future embed can opt out. */
  showCards?: boolean;
}) {
  /* `cardFor` is the SAME function the hero uses, so the count on a card and the count in
   * the hero can never disagree. The title travels on the card object rather than being
   * re-derived from the panel key — a card whose title drifts from its own panel is worse
   * than no card at all. */
  const cards: Array<{ title: string; card: BriefingCard }> = showCards
    ? data.panels
        .filter((p) => (CARD_KEYS as readonly string[]).includes(p.key))
        .map((p) => ({ title: p.title, card: cardFor([p]) }))
        .filter((c): c is { title: string; card: BriefingCard } => c.card !== null)
    : [];
  const cardRow =
    cards.length > 0 ? (
      <div className="tiles">
        {cards.map((c) => (
          <BriefingCardTile key={c.title} title={c.title} card={c.card} />
        ))}
      </div>
    ) : null;

  if (data.panels.length === 0) {
    return variant === "meridian" ? (
      <p
        style={{
          fontSize: 13,
          color: "var(--muted)",
          padding: "28px 22px",
          border: "1px dashed var(--line-2)",
          borderRadius: 14,
        }}
      >
        امروز چیزی نیاز به اقدام شما ندارد.
      </p>
    ) : (
      <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-faint)]">
        امروز چیزی نیاز به اقدام شما ندارد.
      </p>
    );
  }

  if (variant === "meridian") {
    return (
      <>
        {cardRow}
      <div className="briefing-grid" dir="rtl">
        {data.panels.map((p) => (
          <div key={p.key} className="kblock">
            <div className="bhead">
              <div>
                <h2>{p.title}</h2>
                <Summary summary={p.summary} variant="meridian" />
                {p.more ? <div className="n">+ {p.more} مورد بیشتر</div> : null}
              </div>
            </div>
            <ul className="kblock__body m-0 list-none">
              {p.items.map((it, i) => (
                <Item key={i} item={it} variant="meridian" />
              ))}
            </ul>
          </div>
        ))}
      </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-4)]" dir="rtl">
      {cardRow}
      {data.panels.map((p) => (
        <section key={p.key} className="rounded-[var(--radius-lg)] border border-[var(--border)] p-[var(--space-3)]">
          <h3 className="sechead__title sechead__title--minor mb-[var(--space-1)]">
            {p.title}
          </h3>
          <Summary summary={p.summary} variant="plain" />
          <ul className="m-0 list-none p-0">
            {p.items.map((it, i) => (
              <Item key={i} item={it} variant="plain" />
            ))}
          </ul>
          {p.more ? (
            <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
              + {p.more} مورد بیشتر
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}
