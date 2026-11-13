import Link from "next/link";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { cookies } from "next/headers";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import PeriodsCard from "@/components/accounting/PeriodsCard";
import YearCloseCard from "@/components/accounting/YearCloseCard";
import { yearList } from "@/lib/repo/yearClose";
import ReconcileCard from "@/components/accounting/ReconcileCard";
import { todayJalali } from "@/lib/jalali";
import { isOwner } from "@/lib/roles";
import { hiddenAccountIdsFor } from "@/lib/repo/privateCategories";
import { journalReport, listPeriods } from "@/lib/repo/reports";
import Pager from "@/components/accounting/Pager";
import { faNum } from "@/lib/format";
import ReceiptButton from "@/components/accounting/ReceiptButton";
import { journalsWithReceipt } from "@/lib/repo/expenseReceipts";
import { pagingFor, requestedPage } from "@/lib/paging";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/accounting/journal");

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

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
  searchParams: Promise<{ period?: string; source?: string; page?: string }>;
}) {
  const { period, source, page: pageParam } = await searchParams;
  const organizationId = await requireAccounting("/accounting/journal");
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  const filter = { periodKey: period, sourceType: source, hideAccountIds: session ? await hiddenAccountIdsFor(session.role, organizationId) : [] };
  let report = await journalReport(organizationId, { ...filter, limit: PAGE_SIZE, offset: (requestedPage(pageParam) - 1) * PAGE_SIZE });
  const paging = pagingFor(pageParam, report.total, PAGE_SIZE);
  // A page past the end is clamped to the last one, which needs one more read.
  if (paging.page !== requestedPage(pageParam)) {
    report = await journalReport(organizationId, { ...filter, limit: PAGE_SIZE, offset: paging.offset });
  }
  const periods = await listPeriods(organizationId);
  const years = await yearList(organizationId);
  const withReceipt = await journalsWithReceipt(organizationId, report.rows.map((r) => r.journalId));
  const reversed = report.rows.filter((r) => r.reversedByJournalId !== null).length;

  const link = (active: string, base: string, key: "period" | "source") =>
    `${base}?${key}=${encodeURIComponent(active)}`;

  return (
    <>
      <PageHeader route="/accounting/journal" />
      {session && isOwner(session.role) ? <PeriodsCard periods={periods.map((p) => ({ periodKey: p.periodKey, status: p.status }))} currentKey={`${todayJalali().jy}-${String(todayJalali().jm).padStart(2, "0")}`} /> : null}
      {session && isOwner(session.role) ? <YearCloseCard years={years} currentYear={todayJalali().jy} /> : null}
      {session && isOwner(session.role) ? <ReconcileCard /> : null}
      <SectionHead
        title="دفتر روزنامه"
        sub={`${faNum(report.total)} سند${reversed ? ` — ${faNum(reversed)} سند ابطال‌شده${paging.pageCount > 1 ? " در این صفحه" : ""}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2 text-[length:var(--text-sm)]">
            <Link
              href={link(period ?? "", "/accounting/journal", "period")}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-sm)] border border-border px-3"
            >
              همهٔ دوره‌ها
            </Link>
            {periods.map((p) => (
              <Link
                key={p.periodKey}
                href={link(p.periodKey, "/accounting/journal", "period")}
                className={`inline-flex min-h-11 items-center rounded-[var(--radius-sm)] border px-3 ${
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
                {r.sourceType === "EXPENSE" && !struck ? <ReceiptButton journalId={r.journalId} has={withReceipt.has(r.journalId)} /> : null}
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
                    {/* Only the figure is .tnum (nowrap inside AcctTable): the whole bracket was,
                        and on a phone it ran 80 px past its card. */}
                    <span className="text-text-muted">
                      ({l.side === "D" ? "بدهکار" : "بستانکار"}{" "}
                      <span className="tnum">{faNum(l.amountToman)}</span>)
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
      <Pager base="/accounting/journal" params={{ period, source }} paging={paging} />
    </>
  );
}