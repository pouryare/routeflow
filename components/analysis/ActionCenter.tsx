import Link from "next/link";

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
   theme's --crit. The dot below is drawn from `tone`, so the two can no longer
   disagree and the column re-tints with the skin. */
const COLUMN: { bucket: "critical" | "warning" | "opportunity"; label: string; tone: string }[] = [
  { bucket: "critical", label: "بحرانی — همین حالا", tone: "var(--crit)" },
  { bucket: "warning", label: "هشدار — بررسی کن", tone: "var(--warn)" },
  { bucket: "opportunity", label: "فرصت", tone: "var(--good)" },
];

/** The three ranked buckets. Source §5: "the manager should see 30, not 1,000" —
 *  every card here is one decision, ordered by Impact × Probability × Urgency. */
export default function ActionCenter({
  buckets,
}: {
  buckets: Record<"critical" | "warning" | "opportunity", Item[]>;
}) {
  const empty = COLUMN.every((c) => buckets[c.bucket].length === 0);
  return (
    <div className="kblock" dir="rtl">
      <div className="bhead">
        <h2>مرکز اقدام</h2>
      </div>
      {empty ? (
        <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
          چیزی نیاز به تصمیم ندارد — همه‌چیز در جریان است.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-[var(--space-3)] sm:grid-cols-3">
          {COLUMN.map((col) => (
            <section key={col.bucket}>
              <h3
                className="sechead__title sechead__title--minor mb-[var(--space-1)]"
                style={{ color: col.tone }}
              >
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full align-middle" style={{ background: col.tone }} />{" "}
                {col.label} ({buckets[col.bucket].length})
              </h3>
              <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0">
                {buckets[col.bucket].length === 0 && (
                  <li className="text-[length:var(--text-xs)] text-[var(--text-faint)]">—</li>
                )}
                {buckets[col.bucket].map((it) => {
                  const body = (
                    <>
                      <div className="text-[length:var(--text-sm)] text-[var(--text)]">{it.title_fa}</div>
                      {it.sub_fa && (
                        <div className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{it.sub_fa}</div>
                      )}
                    </>
                  );
                  return (
                    <li
                      key={it.key}
                      className="rounded-[var(--radius-sm)] border border-[var(--border)] p-[var(--space-2)]"
                    >
                      {it.href ? (
                        <Link href={it.href} className="block no-underline">
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
