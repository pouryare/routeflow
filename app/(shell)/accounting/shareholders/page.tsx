import PageHeader from "@/components/meridian/PageHeader";
import ShareholdersPanel from "@/components/accounting/ShareholdersPanel";
import ProfitSplitPanel from "@/components/accounting/ProfitSplitPanel";
import { requireAccounting } from "@/lib/accountingGate";
import { costRulesOf, legalFormIn, partnerBalancesOf, shareholdersOf, sharesInForce } from "@/lib/repo/routeAdapters";
import { expenseCategories } from "@/lib/repo/ledgerPostings";
import { tehranTodayIso, todayJalali } from "@/lib/jalali";
import { listGroups } from "@/lib/repo/groupsAdmin";
import { listUsers } from "@/lib/repo/usersAdmin";

export const dynamic = "force-dynamic";

/** Who owns the company: the shareholders, the shares in force today in the whole company and in
 *  each group, and the company's legal form. Owner only (the accounting gate). */
export default async function ShareholdersPage() {
  const organizationId = await requireAccounting("/accounting/shareholders");
  const today = tehranTodayIso();
  const shareholders = await shareholdersOf(organizationId);
  const groups = (await listGroups(organizationId)).map((g) => ({ id: Number(g.id), name: String(g.name) }));
  const taken = new Set(shareholders.map((s) => s.userId));
  const users = (await listUsers(organizationId))
    .filter((u) => u.active === 1 && !taken.has(Number(u.id)))
    .map((u) => ({ id: Number(u.id), name: String(u.display_name) }));

  const scopes: Record<string, { partyId: number; percentBp: number }[]> = {
    company: await sharesInForce(organizationId, null, today),
  };
  for (const g of groups) scopes[String(g.id)] = await sharesInForce(organizationId, g.id, today);

  const legalForm = await legalFormIn(organizationId);
  const rules = await costRulesOf(organizationId);
  const jy = todayJalali().jy;

  return (
    <>
      <PageHeader route="/accounting/shareholders" />
      <ShareholdersPanel
        legalForm={legalForm}
        shareholders={shareholders}
        groups={groups}
        users={users}
        scopes={scopes}
        today={today}
      />
      <ProfitSplitPanel
        legalForm={legalForm}
        balances={await partnerBalancesOf(organizationId)}
        years={[jy, jy - 1]}
        costAccounts={(await expenseCategories()).map((c) => ({ id: c.id, name: c.nameFa, mode: rules.get(c.id) ?? "sales_share" }))}
        today={today}
        hasShareholders={shareholders.length > 0}
      />
    </>
  );
}
