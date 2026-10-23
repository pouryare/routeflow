import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { listApprovals, requestApproval, CreditApprovalError } from "@/lib/repo/creditApprovals";
import type { CreditApprovalRow } from "@/lib/repo/creditApprovals";
import { MANAGE_ROLES } from "@/lib/roles";

const STATUSES: CreditApprovalRow["status"][] = ["pending", "approved", "rejected", "expired"];

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const s = req.nextUrl.searchParams.get("status");
  const status = STATUSES.includes(s as CreditApprovalRow["status"])
    ? (s as CreditApprovalRow["status"])
    : undefined;
  return NextResponse.json({
    ok: true,
    approvals: await listApprovals(guard.session.organizationId, status),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    order_id?: number;
    customer_id?: number;
    customer_balance_toman?: number;
    credit_limit_toman?: number | null;
  } | null;
  if (!body?.order_id || !body?.customer_id || typeof body.customer_balance_toman !== "number") {
    return NextResponse.json({ ok: false, error: "اطلاعات درخواست ناقص است" }, { status: 400 });
  }

  try {
    const id = await requestApproval(guard.session.organizationId, {
      order_id: Number(body.order_id),
      requested_by: guard.session.user.id,
      customer_id: Number(body.customer_id),
      customer_balance_toman: body.customer_balance_toman,
      credit_limit_toman: body.credit_limit_toman ?? null,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof CreditApprovalError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
