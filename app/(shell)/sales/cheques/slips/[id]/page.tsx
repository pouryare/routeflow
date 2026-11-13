import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { slipView } from "@/lib/repo/depositSlips";
import { Icon } from "@/components/meridian/Icon";
import PrintButton from "@/components/PrintButton";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/cheques");
export const dynamic = "force-dynamic";

/** D2: one numbered deposit slip, with the count, the total and the list of cheques, to print or save as PDF. */
export default async function SlipPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!MANAGE_ROLES.includes(session.role)) redirect("/sales");
  const { id } = await params;
  if (!isId(id)) notFound();
  const slip = await slipView(session.organizationId, Number(id));
  if (!slip) notFound();
  return (
    <div dir="rtl" className="mx-auto flex max-w-3xl flex-col gap-[var(--space-4)] p-[var(--space-4)]">
      <PageHeader route="/sales/cheques" />
      <SectionHead title={`برگهٔ واریز شمارهٔ ${faNum(slip.slipNo)}`} sub={`${faJalaliDate(slip.createdAt)} · ${faNum(slip.cheques.length)} چک · جمع ${faToman(slip.total)}`} />
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
        {slip.cheques.map((c) => (
          <li key={c.chequeNo} className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]">
            <span>{c.customer} · چک {c.chequeNo}{c.bankName ? ` · ${c.bankName}` : ""}</span>
            <span className="tnum">{faJalaliDate(c.dueDate)} · {faToman(c.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="no-print flex flex-wrap gap-[var(--space-2)]">
        <PrintButton />
        <Link href="/sales/cheques" className="inline-flex min-h-11 items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]"><Icon name="arrow-right" size="md" />بازگشت به چک‌ها</Link>
      </div>
    </div>
  );
}
