import Link from "next/link";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";

interface Item {
  key: string;
  kind: string;
  title_fa: string;
  sub_fa?: string;
  priority: number;
  href?: string;
}

/* No `mark` glyph any more. The bucket's meaning was carried twice — once by `tone`
   and once by a 🔴/🟠/🟢 emoji that rendered in the font vendor's red, not the
   theme's --crit. The dot is drawn from the column's tone, so the two can no longer
   disagree and the column re-tints with the skin. */
const COLUMN: { bucket: "critical" | "warning" | "opportunity"; label: string }[] = [
  { bucket: "critical", label: "بحرانی — همین حالا" },
  { bucket: "warning", label: "هشدار — بررسی کن" },
  { bucket: "opportunity", label: "فرصت" },
];

/** The three ranked buckets. Source §5: "the manager should see 30, not 1,000" —
 *  every card here is one decision, ordered by Impact × Probability × Urgency.
 *
 *  Item 10: each decision is an expandable card. The title is the decision; opening it
 *  shows why and where to act, so thirty decisions fit on one screen instead of thirty
 *  paragraphs. Native <details>: keyboard and screen-reader behaviour for free, and it
 *  stays a server component. The tone lives in the column header only; the user turned
 *  down accent stripes on cards (items 5 and 12). */
export default function ActionCenter({
  buckets,
}: {
  buckets: Record<"critical" | "warning" | "opportunity", Item[]>;
}) {
  const empty = COLUMN.every((c) => buckets[c.bucket].length === 0);
  return (
    <div className="kblock" dir="rtl">
      <div className="bhead">
        <div>
          <h2>مرکز اقدام</h2>
          <div className="n">هر کارت یک تصمیم است، به ترتیب اهمیت. برای دلیل و محل اقدام، کارت را باز کنید.</div>
        </div>
      </div>
      {empty ? (
        <p className="kblock__body acenter__empty">چیزی نیاز به تصمیم ندارد — همه‌چیز در جریان است.</p>
      ) : (
        <div className="kblock__body acenter">
          {COLUMN.map((col) => {
            const items = buckets[col.bucket];
            return (
              <section key={col.bucket} className={`acol acol--${col.bucket}`} aria-labelledby={`acol-${col.bucket}`}>
                <header className="acol__head">
                  <span className="acol__dot" aria-hidden="true" />
                  <h3 id={`acol-${col.bucket}`} className="sechead__title sechead__title--minor">
                    {col.label}
                  </h3>
                  <span className="acol__n">{faNum(items.length)}</span>
                </header>
                {items.length === 0 ? (
                  <p className="acol__none">موردی نیست</p>
                ) : (
                  <ul className="acol__list">
                    {items.map((it) => (
                      <li key={it.key}>
                        {it.sub_fa || it.href ? (
                          <details className="acard">
                            <summary>
                              <span className="acard__title">{it.title_fa}</span>
                              <Icon name="chevron-down" size="sm" />
                            </summary>
                            <div className="acard__body">
                              {it.sub_fa ? <p>{it.sub_fa}</p> : null}
                              {it.href ? (
                                <Link className="btn ghost" href={it.href}>
                                  باز کردن <Icon name="chevron-left" size="sm" />
                                </Link>
                              ) : null}
                            </div>
                          </details>
                        ) : (
                          <div className="acard acard--plain">
                            <span className="acard__title">{it.title_fa}</span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
