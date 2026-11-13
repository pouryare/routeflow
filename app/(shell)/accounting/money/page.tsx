import Link from "next/link";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { requireAccounting } from "@/lib/accountingGate";
import { listPeriods } from "@/lib/repo/reports";
import { moneyFlow } from "@/lib/repo/moneyFlow";
import { jalaliMonthLength, todayJalali } from "@/lib/jalali";
import { monthSoFar } from "@/lib/moneyFlow";
import { faDigits, faNum } from "@/lib/format";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/accounting/money");

export const dynamic = "force-dynamic";

/** A5: one month of money through cash and bank, from the ledger. */
export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period } = await searchParams;
  const organizationId = await requireAccounting("/accounting/money");
  const periods = await listPeriods(organizationId);
  const t = todayJalali();
  const current = `${t.jy}-${String(t.jm).padStart(2, "0")}`;
  const key = period && /^\d{4}-\d{2}$/.test(period) ? period : current;
  const flow = await moneyFlow(organizationId, key);
  /* Z20: only the running month gets the pace line */
  const sofar = key === current ? monthSoFar(t.jd, jalaliMonthLength(t.jy, t.jm), flow.totalIn) : null;
  const keys = [...new Set([current, ...periods.map((p) => p.periodKey)])].sort().reverse().slice(0, 12);

  return (
    <>
      <PageHeader route="/accounting/money" />
      <SectionHead
        title="ورودی و خروجی پول"
        sub={`ماه ${faDigits(key)}: از ${faNum(flow.opening)} شروع شد و با ${faNum(flow.closing)} تومان تمام می‌شود`}
        actions={
          <div className="flex flex-wrap gap-2 text-[length:var(--text-sm)]">
            {keys.map((k) => (
              <Link key={k} href={`/accounting/money?period=${k}`} className={`rounded-[var(--radius-sm)] border px-2 py-1 ${k === key ? "border-accent text-[var(--accent-text)]" : "border-border"}`}>
                {faDigits(k)}
              </Link>
            ))}
          </div>
        }
      />
      {sofar ? (
        <div className="mb-3" aria-label="پیشرفت ماه">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(sofar.share * 100)}%` }} /></div>
          <p className="m-0 mt-1 text-[length:var(--text-xs)] text-[var(--muted)]">{faNum(Math.round(sofar.share * 100))}٪ از ماه گذشته؛ با همین روند ورودی تا آخر ماه حدود {faNum(sofar.guess)} تومان می‌شود.</p>
        </div>
      ) : null}
      <AcctTable head={["پول وارد‌شده", "مبلغ"]} foot={<tr className="bg-surface"><td className={CELL}>جمع ورودی</td><td className={NUM}>{faNum(flow.totalIn)}</td></tr>}>
        {flow.inRows.map((r) => (
          <tr key={r.label} className="border-t border-border"><td className={CELL}>{r.label}</td><td className={NUM}>{faNum(r.net)}</td></tr>
        ))}
      </AcctTable>
      <AcctTable head={["پول خارج‌شده", "مبلغ"]} foot={<tr className="bg-surface"><td className={CELL}>جمع خروجی</td><td className={NUM}>{faNum(flow.totalOut)}</td></tr>}>
        {flow.outRows.map((r) => (
          <tr key={r.label} className="border-t border-border"><td className={CELL}>{r.label}</td><td className={NUM}>{faNum(r.net)}</td></tr>
        ))}
      </AcctTable>
    </>
  );
}
