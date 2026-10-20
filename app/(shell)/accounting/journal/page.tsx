import Link from "next/link";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { journalReport, listPeriods } from "@/lib/repo/reports";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Every journal, newest first.
 *
 *  A reversed entry STAYS HERE, struck through and linked to the journal that reverses it.
 *  That is the whole point of an append-only ledger, and it is why this page exists in this
 *  form: a correction you can see is trustworthy, and a correction that quietly replaced a
 *  number is the thing the design exists to refuse. Nothing on this page is deleted, ever.
 *
 *  The strike is a `line-through`, not a filter. Filtering it out would produce exactly the
 *  single clean number that spec decision 2 refuses. */
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; source?: string }>;
}) {
  const { period, source } = await searchParams;
  const organizationId = await requireAccounting("/accounting/journal");
  const report = journalReport(organizationId, { periodKey: period, sourceType: source });
  const periods = listPeriods(organizationId);
  const reversed = report.rows.filter((r) => r.reversedByJournalId !== null).length;

  const link = (active: string, base: string, key: "period" | "source") =>
    `${base}?${key}=${encodeURIComponent(active)}`;

  return (
    <>
      <PageHeader route="/accounting/journal" />
      <SectionHead
        title="دفتر روزنامه"
        sub={`${faNum(report.rows.length)} سند${reversed ? ` — ${faNum(reversed)} سند ابطال‌شده` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2 text-[length:var(--text-sm)]">
            <Link
              href={link(period ?? "", "/accounting/journal", "period")}
              className="rounded-[var(--radius-sm)] border border-border px-2 py-1"
            >
              همهٔ دوره‌ها
            </Link>
            {periods.map((p) => (
              <Link
                key={p.periodKey}
                href={link(p.periodKey, "/accounting/journal", "period")}
                className={`rounded-[var(--radius-sm)] border px-2 py-1 ${
                  period === p.periodKey
                    ? "border-accent text-[var(--accent-text)]"
                    : "border-border"
                }`}
              >
                {p.periodKey}
                {/* A closed period is still READ here. Closing stops posting, not reading. */}
                {p.status === "closed" ? " (بسته)" : ""}
              </Link>
            ))}
          </div>
        }
      />

      <AcctTable head={["سند", "دوره", "تاریخ", "شرح", "ردیف‌ها", "مبلغ"]}>
        {report.rows.map((r) => {
          const struck = r.reversedByJournalId !== null;
          return (
            <tr
              key={r.journalId}
              className={`border-t border-border ${struck ? "opacity-60" : ""}`}
            >
              <td className={`${CELL} tnum`}>#{r.seq}</td>
              <td className={`${CELL} tnum`}>{r.periodKey}</td>
              <td className={CELL}>
                <span className="tnum">{r.postedAt.slice(0, 10)}</span>
              </td>
              <td className={CELL}>
                <span className={struck ? "line-through" : ""}>
                  {r.memo ?? r.sourceType}
                </span>
                {struck ? (
                  /* The reversal is named and reachable. "One number with a hidden edit
                     behind it" is exactly what the append-only design refuses. */
                  <Link
                    href={`/accounting/journal#j${r.reversedByJournalId}`}
                    className="mr-2 text-[length:var(--text-xs)] text-danger"
                  >
                    ابطال‌شده — سند معکوس #{r.reversedByJournalId}
                  </Link>
                ) : null}
                {r.reversesJournalId ? (
                  <span className="mr-2 text-[length:var(--text-xs)] text-text-muted">
                    معکوسِ #{r.reversesJournalId}
                  </span>
                ) : null}
                {r.createdByName ? (
                  <span className="mr-2 text-[length:var(--text-xs)] text-text-muted">
                    {r.createdByName}
                  </span>
                ) : null}
              </td>
              <td className={CELL}>
                {r.legs.map((l) => (
                  <div key={l.code} className="text-[length:var(--text-xs)]">
                    <span className="tnum">{l.code}</span> {l.nameFa}{" "}
                    <span className="tnum text-text-muted">
                      ({l.side === "D" ? "بدهکار" : "بستانکار"}{" "}
                      {faNum(l.amountToman)})
                    </span>
                  </div>
                ))}
              </td>
              <td className={NUM}>
                {faNum(
                  r.legs
                    .filter((l) => l.side === "D")
                    .reduce((s, l) => s + l.amountToman, 0)
                )}
              </td>
            </tr>
          );
        })}
      </AcctTable>
    </>
  );
}