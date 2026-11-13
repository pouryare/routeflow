import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { isOwner, MANAGE_ROLES } from "@/lib/roles";
import PageHeader from "@/components/meridian/PageHeader";
import SectionHead from "@/components/meridian/SectionHead";
import ClaimForm from "@/components/expenses/ClaimForm";
import ClaimDecisionCard from "@/components/expenses/ClaimDecisionCard";
import RepayCard from "@/components/expenses/RepayCard";
import { claimsToDecide, myClaims, owedToStaff } from "@/lib/repo/expenseClaims";
import { expenseCategories } from "@/lib/repo/ledgerPostings";
import { CLAIM_LABEL } from "@/lib/expenseClaims";
import { CLAIM_ROLES } from "@/lib/expenseRoles";
import { faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/my-expenses");

export const dynamic = "force-dynamic";

/** F26/F88: costs a person paid for the business. Everyone files and follows their own; a manager or the owner also
 *  sees the ones waiting for them, and the owner sees what is owed to each person and pays it back. */
export default async function MyExpensesPage() {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!CLAIM_ROLES.includes(session.role)) redirect("/my-share");
  const who = { role: session.role, organizationId: session.organizationId, userId: session.user.id, groupId: session.groupId };
  const manager = MANAGE_ROLES.includes(session.role);
  const [categories, mine, toDecide, owed] = await Promise.all([
    expenseCategories(),
    myClaims(session.organizationId, session.user.id),
    manager ? claimsToDecide(who) : Promise.resolve([]),
    isOwner(session.role) ? owedToStaff(session.organizationId) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader route="/my-expenses" />
      <ClaimForm categories={categories} />
      {toDecide.length ? (
        <>
          <SectionHead title="منتظر تأیید شما" />
          {toDecide.map((c) => <ClaimDecisionCard key={c.id} claim={c} />)}
        </>
      ) : null}
      {owed.length ? (
        <>
          <SectionHead title="بدهی به کارکنان" sub="هزینه‌هایی که تأیید شده و هنوز پولش داده نشده." />
          {owed.map((r) => <RepayCard key={r.user_id} row={r} />)}
        </>
      ) : null}
      <SectionHead title="هزینه‌های من" sub={mine.length ? undefined : "هنوز هزینه‌ای ثبت نکرده‌اید."} />
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
        {mine.map((c) => (
          <li key={c.id} className="card flex flex-col gap-[var(--space-1)] p-[var(--space-3)]">
            <div className="flex justify-between gap-2">
              <span>{c.account_name}</span>
              <span className="tnum">{faToman(c.amount_toman)}</span>
            </div>
            <span className="text-[length:var(--text-sm)] text-[var(--muted)]">
              {faJalaliDate(c.incurred_at)} · {CLAIM_LABEL[c.status]}{c.status === "rejected" && c.reject_reason ? `: ${c.reject_reason}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
