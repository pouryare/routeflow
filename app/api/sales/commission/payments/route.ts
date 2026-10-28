import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole } from "@/lib/session";
import { userWithRoleInOrg } from "@/lib/repo/orgRefs";
import { payDriver, payManager, paySales } from "@/lib/repo/routeAdapters";
import { isToman } from "@/lib/money";
import { OWNER_ROLES } from "@/lib/roles";
import { LedgerError } from "@/lib/repo/ledgerCore";

const ROLE_FOR_KIND = { sales: "phone_sales", driver: "delivery_driver", manager: "group_manager" } as const;
const NOT_THIS_KIND = { sales: "فروشنده", driver: "راننده", manager: "مدیر گروه" } as const;

/** Owner only. Recording a commission payment is recording that money left.
 *
 *  `kind` picks which of the three ledgers the payment belongs to. Money paid to a
 *  فروشنده, a راننده and a مدیر گروه are the same ACT -- someone left with cash -- even
 *  though what earned it is computed three different ways, so one endpoint with a
 *  discriminator beats three endpoints that would otherwise be identical apart from
 *  which table they insert into.
 */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    kind?: unknown;
    salesperson_user_id?: unknown;
    driver_user_id?: unknown;
    manager_user_id?: unknown;
    amount_toman?: unknown;
    paid_on?: unknown;
    period_from?: unknown;
    period_to?: unknown;
    notes?: unknown;
  } | null;

  const kind: keyof typeof ROLE_FOR_KIND =
    body?.kind === "driver" ? "driver" : body?.kind === "manager" ? "manager" : "sales";

  const amount = Number(body?.amount_toman);
  if (!isToman(amount) || amount === 0) {
    return NextResponse.json(
      { ok: false, error: "مبلغ باید عدد صحیح تومان و غیر صفر باشد" },
      { status: 400 }
    );
  }

  const paidOn = typeof body?.paid_on === "string" ? body.paid_on : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || Number.isNaN(Date.parse(paidOn))) {
    return NextResponse.json({ ok: false, error: "تاریخ پرداخت معتبر نیست" }, { status: 400 });
  }

  const rawId =
    kind === "driver" ? body?.driver_user_id : kind === "manager" ? body?.manager_user_id : body?.salesperson_user_id;
  const personId = Number(rawId);
  // The SET, not the primary column: paying a driver whose primary is something else must
  // still work, or a legitimate payment is refused over a detail the ledger itself ignores.
  // And this company's: an id alone reaches every tenant's staff.
  if (!await userWithRoleInOrg(personId, [ROLE_FOR_KIND[kind]], orgScopeId(guard.session))) {
    return NextResponse.json({ ok: false, error: `این حساب ${NOT_THIS_KIND[kind]} نیست` }, { status: 400 });
  }

  const shared = {
    amount_toman: amount,
    paid_on: paidOn,
    period_from: typeof body?.period_from === "string" ? body.period_from : null,
    period_to: typeof body?.period_to === "string" ? body.period_to : null,
    notes: typeof body?.notes === "string" ? body.notes : null,
    created_by: guard.session.user.id,
  };

  let id: number;
  try {
    id =
      kind === "driver"
        ? await payDriver({ driver_user_id: personId, ...shared })
        : kind === "manager"
          ? await payManager({ manager_user_id: personId, ...shared })
          : await paySales({ salesperson_user_id: personId, ...shared });
  } catch (e) {
    // A closed period refuses the posting; the payment row rolls back with it.
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }

  return NextResponse.json({ ok: true, id }, { status: 201 });
}
